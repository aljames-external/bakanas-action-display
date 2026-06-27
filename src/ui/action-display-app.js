import { actionDisplay } from '../action-display.js';
import { log } from '../lib/logger.js';

/**
 * Modern ApplicationV2-based HUD overlay for Bakana's Action Display.
 * Uses HandlebarsApplicationMixin for rendering and the Actions API for event handling.
 * Positions itself dynamically relative to the selected token, with hierarchical slide-out tabs.
 */
export class ActionDisplayApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    constructor(token, options = {}) {
        super(options);
        this.token = token;
        this.actor = token.actor;
        
        // Active filter states
        this.activeItemType = 'all';       // Top tabs (spell, weapon, feat, etc.)
        this.activeParentType = 'standard'; // Right-side parent tabs (standard, time, monster, etc.)
        this.activeSubType = 'all';         // Right-side sub-tabs (action, bonus, reaction, etc.)
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
            changeItemType: ActionDisplayApp._onChangeItemType,
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

        // 1. Extract unique Item Types (for Top Tabs)
        const uniqueItemTypes = new Set();
        for (const action of rawActions) {
            if (action.type) {
                uniqueItemTypes.add(action.type);
            } else {
                uniqueItemTypes.add('other');
            }
        }

        const itemTypeLabels = {
            'all': game.i18n.localize('BAD.tabs.all') || 'All',
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

        const itemTypes = Array.from(uniqueItemTypes).map(typeId => ({
            id: typeId,
            label: itemTypeLabels[typeId] ?? typeId.toUpperCase(),
            active: typeId === this.activeItemType
        }));

        // Sort item types by a predefined order
        const itemTypeOrder = ['all', 'weapon', 'spell', 'feat', 'equipment', 'consumable', 'tool', 'backpack', 'loot', 'other'];
        
        // Ensure 'all' is always present if we have actions
        if (!uniqueItemTypes.has('all') && rawActions.length > 0) {
            itemTypes.unshift({
                id: 'all',
                label: itemTypeLabels['all'],
                active: this.activeItemType === 'all'
            });
        }
        itemTypes.sort((a, b) => itemTypeOrder.indexOf(a.id) - itemTypeOrder.indexOf(b.id));

        // If the active item type is no longer available, default to 'all'
        if (itemTypes.length && !itemTypes.some(t => t.id === this.activeItemType)) {
            this.activeItemType = 'all';
            const allTab = itemTypes.find(t => t.id === 'all');
            if (allTab) allTab.active = true;
        }

        // 2. Extract unique Action Types (for Right-side Tabs)
        // We build a hierarchy: Parent -> Sub-tabs based on what actually exists in the actor's actions
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
            'standard': 'Standard',
            'time': 'Time',
            'monster': 'Monster',
            'vehicle': 'Vehicle',
            'special': 'Special',
            'none': 'None'
        };

        const parentIcons = {
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

        // Build the hierarchy dynamically
        const parentGroups = {};
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
        const parentOrder = ['standard', 'time', 'monster', 'vehicle', 'special', 'none'];
        const actionTypes = Object.values(parentGroups);
        actionTypes.sort((a, b) => parentOrder.indexOf(a.id) - parentOrder.indexOf(b.id));

        // Sort sub-tabs within each parent and add 'All' if sub-tabs exist
        const subOrder = {
            'standard': ['all', 'action', 'bonus', 'reaction'],
            'time': ['all', 'minute', 'hour', 'day'],
            'monster': ['all', 'legendary', 'mythic', 'lair'],
            'vehicle': ['all', 'crew']
        };

        for (const parent of actionTypes) {
            if (parent.subTabs.length > 0) {
                // Add an 'All' sub-tab
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

        // 3. Filter actions by both active Item Type (top) and active Action/Parent/Sub Type (right)
        const filteredActions = rawActions.filter(action => {
            // Filter by Item Type (Top Tab)
            const matchesItemType = this.activeItemType === 'all' || 
                                   (action.type === this.activeItemType) || 
                                   (this.activeItemType === 'other' && !action.type);
            
            // Filter by Action Type (Right Tab)
            if (!action.tabs || !Array.isArray(action.tabs)) return false;
            
            const parentId = action.tabs[0];
            const subId = action.tabs[1]; // might be undefined

            const matchesParent = parentId === this.activeParentType;
            
            let matchesSub = true;
            if (this.activeSubType && this.activeSubType !== 'all') {
                matchesSub = subId === this.activeSubType;
            }

            return matchesItemType && matchesParent && matchesSub;
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
     * Handle item type (top tab) selection clicks.
     * 'this' refers to the application instance.
     */
    static async _onChangeItemType(event, target) {
        event.preventDefault();
        this.activeItemType = target.dataset.type;
        log.debug(`Changed item type filter to: ${this.activeItemType}`);
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
        // We leave 150px of extra margin on the right to prevent the slide-out tabs from going off-screen.
        const tabExtension = 150;
        let left = tokenLeft + (tokenWidth / 2) - (appWidth / 2);
        left = Math.max(10, Math.min(window.innerWidth - appWidth - 10 - tabExtension, left));

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
