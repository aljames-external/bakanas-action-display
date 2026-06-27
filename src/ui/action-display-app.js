import { actionDisplay } from '../action-display.js';
import { log } from '../lib/logger.js';

/**
 * Modern ApplicationV2-based HUD overlay for Bakana's Action Display.
 * Uses HandlebarsApplicationMixin for rendering and the Actions API for event handling.
 * Positions itself dynamically relative to the selected token, with symmetrical slide-out tabs on both sides.
 */
export class ActionDisplayApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    constructor(token, options = {}) {
        super(options);
        this.token = token;
        this.actor = token.actor;
        
        // Active filter states - Left Side (Item Types)
        this.activeLeftParentType = 'all'; // Default to show all item types
        this.activeLeftSubType = null;     // Default to no sub-type (unless 'spell' is selected)

        // Active filter states - Right Side (Action Types)
        this.activeParentType = 'all';     // Default to show all action types (no filter)
        this.activeSubType = null;
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
            rollAction: ActionDisplayApp._onRollAction
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
        // We build a hierarchy: Parent -> Sub-tabs (for spells) based on what actually exists
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
            'weapon': game.i18n.localize('DND5E.ItemTypeWeaponPl') || 'Weapons',
            'equipment': game.i18n.localize('DND5E.ItemTypeEquipmentPl') || 'Equipment',
            'consumable': game.i18n.localize('DND5E.ItemTypeConsumablePl') || 'Consumables',
            'tool': game.i18n.localize('DND5E.ItemTypeToolPl') || 'Tools',
            'backpack': game.i18n.localize('DND5E.ItemTypeContainerPl') || 'Containers',
            'loot': game.i18n.localize('DND5E.ItemTypeLootPl') || 'Loot',
            'feat': game.i18n.localize('DND5E.ItemTypeFeatPl') || 'Features',
            'spell': game.i18n.localize('DND5E.ItemTypeSpellPl') || 'Spells',
            'other': game.i18n.localize('DND5E.Other') || 'Other'
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
        // We build a hierarchy: Parent -> Sub-tabs based on what actually exists
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
            'all': 'All Actions',
            'standard': 'Standard',
            'time': 'Time',
            'monster': 'Monster',
            'vehicle': 'Vehicle',
            'special': 'Special',
            'none': 'None'
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
            'action': 'Action',
            'bonus': 'Bonus Action',
            'reaction': 'Reaction',
            'minute': 'Minute',
            'hour': 'Hour',
            'day': 'Day',
            'legendary': 'Legendary',
            'mythic': 'Mythic',
            'lair': 'Lair',
            'crew': 'Crew'
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

        // Inject data into context
        context.itemTypes = itemTypes;
        context.actionTypes = actionTypes;
        context.items = filteredActions;

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
        this.render(); // Re-render the application reactively
    }

    /**
     * Handle left-side sub-item type (spell level) selection clicks.
     * 'this' refers to the application instance.
     */
    static async _onChangeLeftSubItemType(event, target) {
        event.preventDefault();
        this.activeLeftSubType = target.dataset.type;
        log.debug(`Changed item sub filter to: ${this.activeLeftSubType}`);
        this.render(); // Re-render the application reactively
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
        this.render(); // Re-render the application reactively
    }

    /**
     * Handle sub-action type selection clicks.
     * 'this' refers to the application instance.
     */
    static async _onChangeSubActionType(event, target) {
        event.preventDefault();
        this.activeSubType = target.dataset.type;
        log.debug(`Changed action sub filter to: ${this.activeSubType}`);
        this.render(); // Re-render the application reactively
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
            // Execute the roll, passing the click event (to capture Shift/Ctrl/Alt)
            action.roll(event);
            
            // If not holding Shift, close the overlay after rolling
            if (!event.shiftKey) {
                this.close();
            }
        }
    }

    /* -------------------------------------------- */
    /*  Positioning & Lifecycle                     */
    /* -------------------------------------------- */

    /**
     * Hook into the render lifecycle to position the element after it is added to the DOM.
     */
    _onRender(context, options) {
        super._onRender(context, options);
        this.setPosition();
    }

    /**
     * Position the application window dynamically relative to the token.
     * Determines the side (above/below) based on where there is more available screen space,
     * anchoring the HUD stably on that side.
     */
    setPosition(position = {}) {
        if (!this.token) return super.setPosition(position);

        const el = this.element;
        if (!el) return super.setPosition(position);

        // Position calculations relative to the token on the screen
        const tokenTransform = this.token.worldTransform;
        const scale = game.canvas.stage?.scale?.x ?? 1;
        const tokenWidth = this.token.w * scale;
        const tokenHeight = this.token.h * scale;

        // Get screen coordinates of the token
        const tokenLeft = tokenTransform.tx;
        const tokenTop = tokenTransform.ty;
        
        // App dimensions
        const appWidth = this.options.position.width || 320;

        // 1. Calculate available space above and below the token
        const spaceAbove = tokenTop;
        const spaceBelow = window.innerHeight - (tokenTop + tokenHeight);
        const side = spaceAbove > spaceBelow ? 'above' : 'below';

        // Center horizontally and clamp to screen bounds.
        // We leave 150px of extra margin on BOTH sides to prevent the left/right slide-out tabs from going off-screen.
        const tabExtension = 150;
        let left = tokenLeft + (tokenWidth / 2) - (appWidth / 2);
        left = Math.max(tabExtension, Math.min(window.innerWidth - appWidth - tabExtension, left));

        // Set width and left via super.setPosition, but handle top/bottom manually
        // to avoid layout thrashing (reading offsetHeight)
        const targetPosition = foundry.utils.mergeObject(position, {
            left,
            width: appWidth,
            height: 'auto'
        });

        const result = super.setPosition(targetPosition);

        // Apply top/bottom manually to anchor the window stably
        if (side === 'above') {
            // Anchor bottom just above the token (grows upwards)
            const bottomOffset = window.innerHeight - tokenTop + 10;
            el.style.bottom = `${bottomOffset}px`;
            el.style.top = '';
        } else {
            // Anchor top just below the token (grows downwards)
            el.style.top = `${tokenTop + tokenHeight + 10}px`;
            el.style.bottom = '';
        }

        return result;
    }
}
