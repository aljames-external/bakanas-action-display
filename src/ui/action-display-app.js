import { actionDisplay } from '../action-display.js';
import { log } from '../lib/logger.js';

/**
 * Helper to safely localize a key, falling back to a default string if the key is not found.
 */
function localize(key, fallback) {
    return (game.i18n && game.i18n.has(key)) ? game.i18n.localize(key) : fallback;
}

/**
 * Modern ApplicationV2-based HUD overlay for Bakana's Action Display.
 * Uses HandlebarsApplicationMixin for rendering and the Actions API for event handling.
 * Positions itself dynamically relative to the selected token, or floats freely if detached.
 * Supports dragging and persists its position and attachment state.
 */
export class ActionDisplayApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    constructor(token, options = {}) {
        super(options);
        this.token = token;
        this.actor = token.actor;
        
        // Active filter states - Left Side (Item Types)
        this.activeLeftParentType = 'all'; // Default to show all item types
        this.activeLeftSubType = null;     // Default to no sub-type

        // Active filter states - Right Side (Action Types)
        this.activeParentType = 'all';     // Default to show all action types
        this.activeSubType = null;

        // HUD Attachment/Position Mode (persisted client-side)
        this.positionMode = game.settings.get('bakanas-action-display', 'hudPositionMode') || 'attached';
        this.isAttached = this.positionMode === 'attached';
        
        // Dragging state
        this._dragData = null;
    }

    /**
     * Close the application, logging the transition.
     */
    async close(options = {}) {
        log.debug(`ActionDisplayApp.close() initiated for token: ${this.token?.name}, state: ${this.state}`);
        // Hide the element instantly to prevent any default close animations/transitions
        // from causing visual glitches (like shifting and covering the token).
        if (this.element) {
            this.element.style.display = 'none';
        }
        const result = await super.close(options);
        log.debug(`ActionDisplayApp.close() completed, new state: ${this.state}`);
        return result;
    }

    /**
     * Configure default options for the ApplicationV2.
     */
    static DEFAULT_OPTIONS = {
        id: 'bakanas-action-display-app',
        classes: ['bakanas-action-display-window'],
        tag: 'div',
        window: {
            frame: false, // BORDERLESS! Removes the default window frame
            title: "Bakana's Action Display"
        },
        position: {
            width: 320,
            height: 'auto'
        },
        // Declarative Actions API - maps data-action attributes in HTML to static handlers
        actions: {
            changeLeftItemType: ActionDisplayApp._onChangeLeftItemType,
            changeLeftSubItemType: ActionDisplayApp._onChangeLeftSubItemType,
            changeActionType: ActionDisplayApp._onChangeActionType,
            changeSubActionType: ActionDisplayApp._onChangeSubActionType,
            toggleAnchor: ActionDisplayApp._onToggleAnchor,
            rollAction: ActionDisplayApp._onRollAction,
            toggleFilterResources: ActionDisplayApp._onToggleFilterResources
        }
    };

    /**
     * Define the templates (parts) that make up this application.
     */
    static PARTS = {
        hud: {
            template: 'modules/bakanas-action-display/templates/action-display.html'
        }
    };

    /**
     * Prepare the rendering context (equivalent to getData in AppV1).
     */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const rawActions = actionDisplay.getActions(this.actor);

        // 1. Extract unique Item Types (for Left-side Tabs)
        const existingItemCombinations = new Set();
        for (const action of rawActions) {
            if (action.itemTypes && Array.isArray(action.itemTypes)) {
                if (action.itemTypes.length === 2) {
                    existingItemCombinations.add(`${action.itemTypes[0]}/${action.itemTypes[1]}`);
                } else if (action.itemTypes.length === 1) {
                    existingItemCombinations.add(action.itemTypes[0]);
                }
            }
        }

        const itemParentLabels = {
            'all': 'All Items',
            'weapon': localize('DND5E.ItemTypeWeapon', 'Weapon'),
            'equipment': localize('DND5E.ItemTypeEquipment', 'Equipment'),
            'consumable': localize('DND5E.ItemTypeConsumable', 'Consumable'),
            'tool': localize('DND5E.ItemTypeTool', 'Tool'),
            'backpack': localize('DND5E.ItemTypeContainer', 'Container'),
            'loot': localize('DND5E.ItemTypeLoot', 'Loot'),
            'feat': localize('DND5E.ItemTypeFeat', 'Feature'),
            'spell': localize('DND5E.ItemTypeSpell', 'Spell'),
            'other': localize('DND5E.Other', 'Other')
        };

        const itemParentIcons = {
            'all': 'fas fa-border-all',
            'weapon': 'fas fa-sword',
            'spell': 'fas fa-wand-magic-sparkles',
            'feat': 'fas fa-award',
            'equipment': 'fas fa-shield',
            'consumable': 'fas fa-flask',
            'tool': 'fas fa-hammer',
            'backpack': 'fas fa-sack',
            'loot': 'fas fa-gem',
            'other': 'fas fa-ellipsis'
        };

        // Build the left-side hierarchy
        const leftGroups = {};
        
        // Always ensure 'all' parent is present if we have actions
        if (rawActions.length > 0) {
            leftGroups['all'] = {
                id: 'all',
                label: itemParentLabels['all'],
                icon: itemParentIcons['all'],
                active: this.activeLeftParentType === 'all',
                expanded: this.activeLeftParentType === 'all',
                activeParent: false,
                subTabs: []
            };
        }

        for (const combo of existingItemCombinations) {
            const parts = combo.split('/');
            const parentId = parts[0];
            const subId = parts[1]; // might be undefined (spell level)

            if (!leftGroups[parentId]) {
                leftGroups[parentId] = {
                    id: parentId,
                    label: itemParentLabels[parentId] ?? parentId.toUpperCase(),
                    icon: itemParentIcons[parentId] ?? 'fas fa-question',
                    active: parentId === this.activeLeftParentType,
                    expanded: parentId === this.activeLeftParentType,
                    activeParent: parentId === this.activeLeftParentType && this.activeLeftSubType && this.activeLeftSubType !== 'all',
                    subTabs: []
                };
            }

            if (parentId === 'spell' && subId) {
                const levelLabel = subId === '0' 
                    ? (game.i18n.localize('DND5E.SpellCantrip') || 'Cantrip')
                    : (game.i18n.localize(`DND5E.SpellLevel${subId}`) || `${subId} Level`);
                
                leftGroups[parentId].subTabs.push({
                    id: subId,
                    label: levelLabel,
                    active: this.activeLeftParentType === 'spell' && subId === this.activeLeftSubType
                });
            }
        }

        // Convert to array and sort by a predefined order
        const leftOrder = ['all', 'weapon', 'spell', 'feat', 'equipment', 'consumable', 'tool', 'backpack', 'loot', 'other'];
        const itemTypes = Object.values(leftGroups);
        itemTypes.sort((a, b) => leftOrder.indexOf(a.id) - leftOrder.indexOf(b.id));

        // Sort spell sub-tabs (levels 0 to 9) and add 'All Spells'
        const spellParent = leftGroups['spell'];
        if (spellParent && spellParent.subTabs.length > 0) {
            spellParent.subTabs.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
            spellParent.subTabs.unshift({
                id: 'all',
                label: 'All Spells',
                active: this.activeLeftParentType === 'spell' && this.activeLeftSubType === 'all'
            });
        }

        // If active left parent type is no longer available, default to 'all'
        if (itemTypes.length && !itemTypes.some(p => p.id === this.activeLeftParentType)) {
            this.activeLeftParentType = 'all';
            const allTab = itemTypes.find(t => t.id === 'all');
            if (allTab) {
                allTab.active = true;
                allTab.expanded = true;
            }
            this.activeLeftSubType = null;
        }

        // 2. Extract unique Action Types (for Right-side Tabs)
        const existingCombinations = new Set();
        for (const action of rawActions) {
            if (action.tabs && Array.isArray(action.tabs)) {
                if (action.tabs.length === 2) {
                    existingCombinations.add(`${action.tabs[0]}/${action.tabs[1]}`);
                } else if (action.tabs.length === 1) {
                    existingCombinations.add(action.tabs[0]);
                }
            }
        }

        const parentLabels = {
            'all': localize('BAD.actions.all', 'All Actions'),
            'standard': localize('BAD.actions.standard', 'Standard'),
            'time': localize('BAD.actions.time', 'Time'),
            'monster': localize('BAD.actions.monster', 'Monster'),
            'vehicle': localize('BAD.actions.vehicle', 'Vehicle'),
            'special': localize('BAD.actions.special', 'Special'),
            'none': localize('BAD.actions.none', 'None')
        };

        const parentIcons = {
            'all': 'fas fa-border-all',
            'standard': 'fas fa-hand-fist',
            'time': 'fas fa-clock',
            'monster': 'fas fa-dragon',
            'vehicle': 'fas fa-ship',
            'special': 'fas fa-star',
            'none': 'fas fa-ban'
        };

        const subLabels = {
            'action': localize('DND5E.Action', 'Action'),
            'bonus': localize('DND5E.BonusAction', 'Bonus Action'),
            'reaction': localize('DND5E.Reaction', 'Reaction'),
            'minute': localize('DND5E.TimeMinute', 'Minute'),
            'hour': localize('DND5E.TimeHour', 'Hour'),
            'day': localize('DND5E.TimeDay', 'Day'),
            'legendary': localize('DND5E.LegendaryAction', 'Legendary'),
            'mythic': localize('DND5E.MythicAction', 'Mythic'),
            'lair': localize('DND5E.LairAction', 'Lair'),
            'crew': localize('DND5E.CrewAction', 'Crew')
        };

        // Build the right-side hierarchy dynamically
        const parentGroups = {};
        
        // Always ensure 'all' parent is present if we have actions
        if (rawActions.length > 0) {
            parentGroups['all'] = {
                id: 'all',
                label: parentLabels['all'],
                icon: parentIcons['all'],
                active: this.activeParentType === 'all',
                expanded: this.activeParentType === 'all',
                activeParent: false,
                subTabs: []
            };
        }

        for (const combo of existingCombinations) {
            const parts = combo.split('/');
            const parentId = parts[0];
            const subId = parts[1]; // might be undefined

            if (!parentGroups[parentId]) {
                parentGroups[parentId] = {
                    id: parentId,
                    label: parentLabels[parentId] ?? parentId.toUpperCase(),
                    icon: parentIcons[parentId] ?? 'fas fa-question',
                    active: parentId === this.activeParentType,
                    expanded: parentId === this.activeParentType,
                    activeParent: parentId === this.activeParentType && this.activeSubType && this.activeSubType !== 'all',
                    subTabs: []
                };
            }

            if (subId) {
                parentGroups[parentId].subTabs.push({
                    id: subId,
                    label: subLabels[subId] ?? subId.toUpperCase(),
                    active: parentId === this.activeParentType && subId === this.activeSubType
                });
            }
        }

        // Convert to array and sort by a predefined order
        const parentOrder = ['all', 'standard', 'time', 'monster', 'vehicle', 'special', 'none'];
        const actionTypes = Object.values(parentGroups);
        actionTypes.sort((a, b) => parentOrder.indexOf(a.id) - parentOrder.indexOf(b.id));

        // Sort sub-tabs within each parent and add 'All'
        const subOrder = {
            'standard': ['all', 'action', 'bonus', 'reaction'],
            'time': ['all', 'minute', 'hour', 'day'],
            'monster': ['all', 'legendary', 'mythic', 'lair'],
            'vehicle': ['all', 'crew']
        };

        for (const parent of actionTypes) {
            if (parent.subTabs.length > 0) {
                parent.subTabs.unshift({
                    id: 'all',
                    label: 'All',
                    active: parent.id === this.activeParentType && this.activeSubType === 'all'
                });
                
                const order = subOrder[parent.id] ?? [];
                parent.subTabs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
            }
        }

        // If the active parent type is no longer available, default to the first available
        if (actionTypes.length && !actionTypes.some(p => p.id === this.activeParentType)) {
            this.activeParentType = actionTypes[0].id;
            actionTypes[0].active = true;
            actionTypes[0].expanded = true;
            this.activeSubType = actionTypes[0].subTabs.length > 0 ? 'all' : null;
            if (actionTypes[0].subTabs.length > 0) {
                actionTypes[0].subTabs[0].active = true;
            }
        }

        // 3. Filter actions by both active Left-side (Item Type/Spell Level) and active Right-side (Action/Sub-action)
        const filteredActions = rawActions.filter(action => {
            // Filter by Left Side (Item Type)
            if (!action.itemTypes || !Array.isArray(action.itemTypes)) return false;
            const itemParentId = action.itemTypes[0];
            const itemSubId = action.itemTypes[1];

            const matchesLeftParent = this.activeLeftParentType === 'all' || itemParentId === this.activeLeftParentType;
            
            let matchesLeftSub = true;
            if (this.activeLeftParentType === 'spell' && this.activeLeftSubType && this.activeLeftSubType !== 'all') {
                matchesLeftSub = itemSubId === this.activeLeftSubType;
            }

            // Filter by Right Side (Action Type)
            if (!action.tabs || !Array.isArray(action.tabs)) return false;
            const actionParentId = action.tabs[0];
            const actionSubId = action.tabs[1];

            const matchesRightParent = this.activeParentType === 'all' || actionParentId === this.activeParentType;
            
            let matchesRightSub = true;
            if (this.activeParentType !== 'all' && this.activeSubType && this.activeSubType !== 'all') {
                matchesRightSub = actionSubId === this.activeSubType;
            }

            return matchesLeftParent && matchesLeftSub && matchesRightParent && matchesRightSub;
        });

        // Inject data and attachment state into context
        context.itemTypes = itemTypes;
        context.actionTypes = actionTypes;
        context.items = filteredActions;
        context.isAttached = this.isAttached;
        context.filterNoResources = game.settings.get('bakanas-action-display', 'filterNoResources');

        return context;
    }

    /* -------------------------------------------- */
    /*  Actions Handlers                            */
    /* -------------------------------------------- */

    /**
     * Handle left-side item type (parent) selection clicks.
     * 'this' refers to the application instance.
     */
    static async _onChangeLeftItemType(event, target) {
        event.preventDefault();
        const parentId = target.dataset.type;
        const hasSubTabs = target.dataset.hasSubTabs === 'true';
        
        this.activeLeftParentType = parentId;
        this.activeLeftSubType = hasSubTabs ? 'all' : null;
        
        log.debug(`Changed item parent filter to: ${this.activeLeftParentType}, sub: ${this.activeLeftSubType}`);
        this.render();
    }

    /**
     * Handle left-side sub-item type (spell level) selection clicks.
     * 'this' refers to the application instance.
     */
    static async _onChangeLeftSubItemType(event, target) {
        event.preventDefault();
        this.activeLeftSubType = target.dataset.type;
        log.debug(`Changed item sub filter to: ${this.activeLeftSubType}`);
        this.render();
    }

    /**
     * Handle parent action type (right tab) selection clicks.
     * 'this' refers to the application instance.
     */
    static async _onChangeActionType(event, target) {
        event.preventDefault();
        const parentId = target.dataset.type;
        const hasSubTabs = target.dataset.hasSubTabs === 'true';
        
        this.activeParentType = parentId;
        this.activeSubType = hasSubTabs ? 'all' : null;
        
        log.debug(`Changed action parent filter to: ${this.activeParentType}, sub: ${this.activeSubType}`);
        this.render();
    }

    /**
     * Handle sub-action type selection clicks.
     * 'this' refers to the application instance.
     */
    static async _onChangeSubActionType(event, target) {
        event.preventDefault();
        this.activeSubType = target.dataset.type;
        log.debug(`Changed action sub filter to: ${this.activeSubType}`);
        this.render();
    }

    /**
     * Toggle between attached (token-tracking) and detached (floating) modes.
     * 'this' refers to the application instance.
     */
    static async _onToggleAnchor(event, target) {
        event.preventDefault();
        this.isAttached = !this.isAttached;
        this.positionMode = this.isAttached ? 'attached' : 'detached';
        
        if (!this.isAttached) {
            // Detaching: Save current screen position
            const el = this.element;
            if (el) {
                const rect = el.getBoundingClientRect();
                const pos = { left: rect.left, top: rect.top };
                await game.settings.set('bakanas-action-display', 'hudDetachedPosition', pos);
            }
        }
        
        await game.settings.set('bakanas-action-display', 'hudPositionMode', this.positionMode);
        log.debug(`Toggled HUD anchor mode to: ${this.positionMode}`);
        
        // Re-render to update the control bar icon and re-position
        this.render();
    }

    /**
     * Handle action item clicks to roll them.
     * 'this' refers to the application instance.
     */
    static async _onRollAction(event, target) {
        event.preventDefault();
        const actionId = target.dataset.actionId;
        const actions = actionDisplay.getActions(this.actor);
        const action = actions.find(a => a.id === actionId);
        
        if (action) {
            action.roll(event);
        }
    }

    /**
     * Toggle the "Filter Out of Resources" setting.
     * 'this' refers to the application instance.
     */
    static async _onToggleFilterResources(event, target) {
        const checked = target.checked;
        await game.settings.set('bakanas-action-display', 'filterNoResources', checked);
        log.debug(`Toggled filterNoResources to: ${checked}`);
        this.render();
    }

    /* -------------------------------------------- */
    /*  Positioning & Dragging                      */
    /* -------------------------------------------- */

    /**
     * Hook into the render lifecycle to position the element and set up drag listeners.
     */
    _onRender(context, options) {
        super._onRender(context, options);
        log.debug(`_onRender | token: ${this.token?.name}, state: ${this.state}, isAttached: ${this.isAttached}`);
        this.setPosition();
        this._setupDragListeners();
        this._adjustMinHeight();

        // Prevent clicks and right-clicks inside the HUD from bubbling up to the document,
        // which would trigger Foundry's click-off detection and close the HUD.
        this.element.addEventListener('click', event => event.stopPropagation());
        this.element.addEventListener('contextmenu', event => event.stopPropagation());
    }

    /**
     * Adjust the min-height of the main container to ensure it is at least
     * as tall as the tallest tab column, keeping them visually connected.
     */
    _adjustMinHeight() {
        const el = this.element;
        if (!el) return;

        const container = el.querySelector('.bakanas-action-display-container');
        const leftTabs = el.querySelector('.bad-left-tabs');
        const rightTabs = el.querySelector('.bad-right-tabs');

        if (!container) return;

        // Reset min-height to measure natural layout first
        container.style.minHeight = '';

        const leftHeight = leftTabs ? leftTabs.offsetHeight : 0;
        const rightHeight = rightTabs ? rightTabs.offsetHeight : 0;
        const maxTabHeight = Math.max(leftHeight, rightHeight);
        
        log.debug(`_adjustMinHeight | leftHeight: ${leftHeight}px, rightHeight: ${rightHeight}px, maxTabHeight: ${maxTabHeight}px`);

        if (maxTabHeight > 0) {
            const targetMinHeight = maxTabHeight + 24;
            log.debug(`_adjustMinHeight | Applying min-height: ${targetMinHeight}px to container`);
            // Add 24px safety margin (12px top/bottom) to match container padding
            container.style.minHeight = `${targetMinHeight}px`;
        }
    }

    /**
     * Set up mouse listeners for dragging the HUD.
     */
    _setupDragListeners() {
        const el = this.element;
        if (!el) return;
        
        const handle = el.querySelector('.bad-drag-handle');
        if (!handle) return;
        
        // Remove existing listener to prevent duplicates on re-render
        handle.removeEventListener('mousedown', this._onDragStart);
        
        this._onDragStart = this._onDragStart.bind(this);
        handle.addEventListener('mousedown', this._onDragStart);
    }

    _onDragStart(event) {
        event.preventDefault();
        const el = this.element;
        if (!el) return;

        // Record starting mouse and window coordinates
        this._dragData = {
            startX: event.clientX,
            startY: event.clientY,
            startLeft: el.offsetLeft,
            startTop: el.offsetTop
        };

        this._onDragMove = this._onDragMove.bind(this);
        this._onDragEnd = this._onDragEnd.bind(this);

        document.addEventListener('mousemove', this._onDragMove);
        document.addEventListener('mouseup', this._onDragEnd);
        
        log.debug("Drag started");
    }

    _onDragMove(event) {
        event.preventDefault();
        const el = this.element;
        if (!el || !this._dragData) return;

        // Calculate delta
        const dx = event.clientX - this._dragData.startX;
        const dy = event.clientY - this._dragData.startY;

        // Calculate new coordinates
        let left = this._dragData.startLeft + dx;
        let top = this._dragData.startTop + dy;

        // Clamp to screen bounds
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        left = Math.max(10, Math.min(window.innerWidth - width - 10, left));
        top = Math.max(10, Math.min(window.innerHeight - height - 10, top));

        // Apply styles directly for ultra-smooth 60fps dragging
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.bottom = ''; // Clear bottom to prevent layout conflicts

        // Dragging immediately detaches the HUD from the token
        if (this.isAttached) {
            this.isAttached = false;
            this.positionMode = 'detached';
        }
    }

    async _onDragEnd(event) {
        event.preventDefault();
        document.removeEventListener('mousemove', this._onDragMove);
        document.removeEventListener('mouseup', this._onDragEnd);

        const el = this.element;
        if (el && this._dragData) {
            const rect = el.getBoundingClientRect();
            const pos = { left: rect.left, top: rect.top };
            
            // Persist the new detached coordinates and mode
            await game.settings.set('bakanas-action-display', 'hudDetachedPosition', pos);
            await game.settings.set('bakanas-action-display', 'hudPositionMode', 'detached');
            
            log.debug("Drag ended, saved position:", pos);
        }
        
        this._dragData = null;
        
        // Re-render to update the anchor icon/tooltip in the control bar
        this.render();
    }

    /**
     * Position the application window.
     * In Attached mode, anchors dynamically above/below the token.
     * In Detached mode, places it at the user's last dragged screen coordinates.
     */
    setPosition(position = {}) {
        const el = this.element;
        if (!el) return super.setPosition(position);

        if (this.isAttached && this.token) {
            // --- ATTACHED MODE (Tracks Token) ---
            const tokenTransform = this.token.worldTransform;
            const scale = game.canvas.stage?.scale?.x ?? 1;
            const tokenWidth = this.token.w * scale;
            const tokenHeight = this.token.h * scale;

            const tokenLeft = tokenTransform.tx;
            const tokenTop = tokenTransform.ty;
            
            const appWidth = this.options.position.width || 320;

            const spaceAbove = tokenTop;
            const spaceBelow = window.innerHeight - (tokenTop + tokenHeight);
            const side = spaceAbove > spaceBelow ? 'above' : 'below';

            // Leave 150px safety margin on both sides for slide-out tabs
            const tabExtension = 150;
            let left = tokenLeft + (tokenWidth / 2) - (appWidth / 2);
            left = Math.max(tabExtension, Math.min(window.innerWidth - appWidth - tabExtension, left));

            const targetPosition = foundry.utils.mergeObject(position, {
                left,
                width: appWidth,
                height: 'auto'
            });

            const result = super.setPosition(targetPosition);

            // Force the window wrapper to auto-size so it grows/shrinks dynamically with the container,
            // allowing it to grow upwards (when bottom-anchored) or downwards (when top-anchored).
            el.style.height = 'auto';

            // Apply top/bottom manually to anchor the window stably
            if (side === 'above') {
                const bottomOffset = window.innerHeight - tokenTop + 10;
                log.debug(`setPosition (Attached/Above) | token: ${this.token.name}, left: ${left}px, bottomOffset: ${bottomOffset}px (tokenTop: ${tokenTop}px, windowHeight: ${window.innerHeight}px)`);
                el.style.bottom = `${bottomOffset}px`;
                el.style.top = '';
            } else {
                const topOffset = tokenTop + tokenHeight + 10;
                log.debug(`setPosition (Attached/Below) | token: ${this.token.name}, left: ${left}px, topOffset: ${topOffset}px (tokenTop: ${tokenTop}px, tokenHeight: ${tokenHeight}px)`);
                el.style.top = `${topOffset}px`;
                el.style.bottom = '';
            }

            return result;
        } else {
            // --- DETACHED MODE (Floating / Fixed Position) ---
            const savedPos = game.settings.get('bakanas-action-display', 'hudDetachedPosition');
            const appWidth = this.options.position.width || 320;
            
            let left = savedPos?.left ?? 100;
            let top = savedPos?.top ?? 100;
            
            log.debug(`setPosition (Detached) | left: ${left}px, top: ${top}px, appWidth: ${appWidth}px`);

            // Clamp to screen bounds to ensure it's always visible (handles resolution changes)
            left = Math.max(10, Math.min(window.innerWidth - appWidth - 10, left));
            top = Math.max(10, Math.min(window.innerHeight - (el.offsetHeight || 200) - 10, top));

            const targetPosition = foundry.utils.mergeObject(position, {
                left,
                top,
                width: appWidth,
                height: 'auto'
            });

            // Clear bottom styling since we are using absolute top/left
            el.style.bottom = '';

            return super.setPosition(targetPosition);
        }
    }
}
