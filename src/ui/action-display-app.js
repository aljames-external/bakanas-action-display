import { actionDisplay } from '../action-display.js';

/**
 * Modern ApplicationV2-based HUD overlay for Bakana's Action Display.
 * Uses HandlebarsApplicationMixin for rendering and the Actions API for event handling.
 * Positions itself dynamically relative to the selected token.
 */
export class ActionDisplayApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    constructor(token, options = {}) {
        super(options);
        this.token = token;
        this.actor = token.actor;
        this.activeTab = 'action'; // Default tab
        this.expandedCategories = new Set(['weapon', 'feat', 'spell']); // Default expanded categories
    }

    /**
     * Configure default options for the ApplicationV2.
     */
    static DEFAULT_OPTIONS = {
        id: 'bakanas-action-display-app',
        classes: ['bakanas-action-display-window'],
        tag: 'div',
        window: {
            frame: false, // BORDERLESS! Removes the default window frame (header, borders, etc.)
            title: "Bakana's Action Display"
        },
        position: {
            width: 320,
            height: 'auto'
        },
        // Declarative Actions API - maps data-action attributes in HTML to static handlers
        actions: {
            changeTab: ActionDisplayApp._onChangeTab,
            toggleCategory: ActionDisplayApp._onToggleCategory,
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
        // Essential: Await and preserve the base context from the parent class/mixin
        const context = await super._prepareContext(options);
        const rawActions = actionDisplay.getActions(this.actor);

        // 1. Extract all unique tab IDs present in the actions
        const uniqueTabs = new Set();
        for (const action of rawActions) {
            if (action.tabs && Array.isArray(action.tabs)) {
                for (const tabId of action.tabs) {
                    uniqueTabs.add(tabId);
                }
            }
        }

        // Define standard tab labels
        const tabLabels = {
            'all': game.i18n.localize('BAD.tabs.all') || 'All Items',
            'action': game.i18n.localize('DND5E.Action') || 'Action',
            'bonus': game.i18n.localize('DND5E.BonusAction') || 'Bonus Action',
            'reaction': game.i18n.localize('DND5E.Reaction') || 'Reaction',
            'legendary': game.i18n.localize('DND5E.LegendaryAction') || 'Legendary',
            'lair': game.i18n.localize('DND5E.LairAction') || 'Lair',
            'special': game.i18n.localize('DND5E.Special') || 'Special',
            'crew': game.i18n.localize('DND5E.CrewAction') || 'Crew',
            'other': game.i18n.localize('DND5E.Other') || 'Other'
        };

        // Build the tabs array
        const tabs = Array.from(uniqueTabs).map(tabId => ({
            id: tabId,
            label: tabLabels[tabId] ?? tabId.toUpperCase(),
            active: tabId === this.activeTab
        }));

        // Sort tabs by a predefined order
        const tabOrder = ['all', 'action', 'bonus', 'reaction', 'legendary', 'lair', 'crew', 'special', 'other'];
        tabs.sort((a, b) => tabOrder.indexOf(a.id) - tabOrder.indexOf(b.id));

        // If the active tab is no longer available, default to the first available
        if (tabs.length && !uniqueTabs.has(this.activeTab)) {
            this.activeTab = tabs[0].id;
            tabs[0].active = true;
        }

        // 2. Filter actions for the active tab
        const filteredActions = rawActions.filter(a => a.tabs && a.tabs.includes(this.activeTab));

        // 3. Group filtered actions by item type (categories)
        const categoriesMap = new Map();
        const categoryLabels = {
            'weapon': game.i18n.localize('DND5E.ItemTypeWeaponPl') || 'Weapons',
            'equipment': game.i18n.localize('DND5E.ItemTypeEquipmentPl') || 'Equipment',
            'consumable': game.i18n.localize('DND5E.ItemTypeConsumablePl') || 'Consumables',
            'feat': game.i18n.localize('DND5E.ItemTypeFeatPl') || 'Features/Actions',
            'spell': game.i18n.localize('DND5E.ItemTypeSpellPl') || 'Spells',
            'other': game.i18n.localize('DND5E.Other') || 'Other'
        };

        for (const action of filteredActions) {
            const type = action.type ?? 'other';
            if (!categoriesMap.has(type)) {
                categoriesMap.set(type, {
                    id: type,
                    label: categoryLabels[type] ?? type.toUpperCase(),
                    expanded: this.expandedCategories.has(type),
                    items: []
                });
            }
            categoriesMap.get(type).items.push(action);
        }

        const categories = Array.from(categoriesMap.values());
        const categoryOrder = ['weapon', 'equipment', 'consumable', 'feat', 'spell', 'other'];
        categories.sort((a, b) => categoryOrder.indexOf(a.id) - categoryOrder.indexOf(b.id));

        // Inject our custom data into the base context
        context.tabs = tabs;
        context.categories = categories;

        return context;
    }

    /* -------------------------------------------- */
    /*  Actions Handlers                            */
    /* -------------------------------------------- */

    /**
     * Handle tab selection clicks.
     * 'this' refers to the application instance.
     */
    static async _onChangeTab(event, target) {
        event.preventDefault();
        this.activeTab = target.dataset.tab;
        this.render(); // Re-render the application reactively
    }

    /**
     * Handle expanding/collapsing categories.
     * 'this' refers to the application instance.
     */
    static async _onToggleCategory(event, target) {
        event.preventDefault();
        const categoryId = target.closest('.bad-category').dataset.category;
        if (this.expandedCategories.has(categoryId)) {
            this.expandedCategories.delete(categoryId);
        } else {
            this.expandedCategories.add(categoryId);
        }
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
     * Hook into the render lifecycle to position the element and register event listeners.
     */
    _onRender(context, options) {
        super._onRender(context, options);
        this.setPosition();

        // Register global right-click listener on the next tick to prevent the opening
        // right-click event from bubbling up and immediately triggering the close handler.
        setTimeout(() => {
            if (!this.element || !document.body.contains(this.element)) return;

            this._externalRightClickListener = (event) => {
                if (this.element && this.element.contains(event.target)) return;
                this.close();
            };
            document.addEventListener('contextmenu', this._externalRightClickListener);
        }, 0);
    }

    /**
     * Hook into the close lifecycle to clean up global event listeners.
     */
    _onClose(options) {
        super._onClose(options);
        if (this._externalRightClickListener) {
            document.removeEventListener('contextmenu', this._externalRightClickListener);
            this._externalRightClickListener = null;
        }
    }

    /**
     * Position the application window dynamically relative to the token.
     * Determines the side (above/below) based on where there is more available screen space,
     * anchoring the HUD stably on that side.
     */
    setPosition(position = {}) {
        if (!this.token) return super.setPosition(position);

        const el = this.element; // In AppV2, this.element is the native HTMLElement
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
        const appHeight = el.offsetHeight || 150; // Current height of the active tab

        // 1. Calculate available space above and below the token
        const spaceAbove = tokenTop;
        const spaceBelow = window.innerHeight - (tokenTop + tokenHeight);

        // 2. Decide the side based on where there is more space.
        // This is 100% stable since the token's position doesn't change when switching tabs!
        const side = spaceAbove > spaceBelow ? 'above' : 'below';

        // 3. Calculate the actual top coordinate based on the chosen side and current height.
        let top;
        if (side === 'above') {
            // Anchored to the bottom (just above the token, growing/shrinking upwards)
            top = tokenTop - appHeight - 10;
        } else {
            // Anchored to the top (just below the token, growing/shrinking downwards)
            top = tokenTop + tokenHeight + 10;
        }

        // Center horizontally and clamp to screen bounds
        let left = tokenLeft + (tokenWidth / 2) - (appWidth / 2);
        left = Math.max(10, Math.min(window.innerWidth - appWidth - 10, left));

        // Merge our calculated coordinates and delegate to the base class.
        const targetPosition = foundry.utils.mergeObject(position, {
            left,
            top,
            width: appWidth,
            height: 'auto'
        });

        return super.setPosition(targetPosition);
    }
}
