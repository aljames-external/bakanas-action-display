import { actionDisplay } from '../action-display.js';

/**
 * Custom Application that displays the tabbed, collapsible quick actions menu.
 * Positions itself dynamically relative to the selected token.
 */
export class ActionDisplayApp extends Application {
    constructor(token, options = {}) {
        super(options);
        this.token = token;
        this.actor = token.actor;
        this.activeTab = 'action'; // Default tab
        this.expandedCategories = new Set(['weapon', 'feat', 'spell']); // Default expanded categories
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'bakanas-action-display-app',
            template: 'modules/bakanas-action-display/templates/action-display.html',
            popOut: true,
            minimizable: false,
            resizable: false,
            title: "Bakana's Action Display",
            classes: ['bakanas-action-display-window'],
            width: 320,
            height: 'auto'
        });
    }

    /**
     * Prepare data for the Handlebars template.
     */
    getData(options) {
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

        // Define standard tab labels (with localization where possible)
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

        // Sort tabs by a predefined order (fallback 'all' appears first)
        const tabOrder = ['all', 'action', 'bonus', 'reaction', 'legendary', 'lair', 'crew', 'special', 'other'];
        tabs.sort((a, b) => tabOrder.indexOf(a.id) - tabOrder.indexOf(b.id));

        // If the active tab is no longer available (e.g. actor changed), default to the first available
        if (tabs.length && !uniqueTabs.has(this.activeTab)) {
            this.activeTab = tabs[0].id;
            tabs[0].active = true;
        }

        // 2. Filter actions for the active tab (since an action can be in multiple tabs, we check if it includes it)
        const filteredActions = rawActions.filter(a => a.tabs && a.tabs.includes(this.activeTab));

        // 3. Group filtered actions by item type (categories)
        const categoriesMap = new Map();
        
        // System-independent fallback labels, using DnD5e as primary if available
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
        // Sort categories by a predefined order
        const categoryOrder = ['weapon', 'equipment', 'consumable', 'feat', 'spell', 'other'];
        categories.sort((a, b) => categoryOrder.indexOf(a.id) - categoryOrder.indexOf(b.id));

        return {
            tabs,
            categories
        };
    }

    /**
     * Bind interactive elements in the HTML.
     */
    activateListeners(html) {
        super.activateListeners(html);

        // Tab selection
        html.find('.bad-tab-btn').click(event => {
            event.preventDefault();
            this.activeTab = event.currentTarget.dataset.tab;
            this.render(true);
        });

        // Category expand/collapse toggle
        html.find('.bad-category-header').click(event => {
            event.preventDefault();
            const categoryId = event.currentTarget.closest('.bad-category').dataset.category;
            if (this.expandedCategories.has(categoryId)) {
                this.expandedCategories.delete(categoryId);
            } else {
                this.expandedCategories.add(categoryId);
            }
            this.render(true);
        });

        // Action roll execution
        html.find('.bad-action-item').click(async (event) => {
            event.preventDefault();
            const actionId = event.currentTarget.dataset.actionId;
            const actions = actionDisplay.getActions(this.actor);
            const action = actions.find(a => a.id === actionId);
            
            if (action) {
                // Execute the roll, passing the click event (for modifier keys)
                action.roll(event);
                
                // If not holding Shift, close the overlay after rolling
                if (!event.shiftKey) {
                    this.close();
                }
            }
        });
    }

    /**
     * Position the application window dynamically relative to the token.
     */
    setPosition(options = {}) {
        if (!this.token) return super.setPosition(options);

        const el = this.element[0];
        if (!el) return;

        // Position calculations relative to the token on the screen
        const tokenTransform = this.token.worldTransform;
        const scale = game.canvas.stage?.scale?.x ?? 1;
        const tokenWidth = this.token.w * scale;
        const tokenHeight = this.token.h * scale;

        // Get screen coordinates of the token
        const tokenLeft = tokenTransform.tx;
        const tokenTop = tokenTransform.ty;
        
        // App dimensions
        const appWidth = this.options.width;
        
        // Position the app centered above the token by default
        let left = tokenLeft + (tokenWidth / 2) - (appWidth / 2);
        // Position it 10px above the token
        let top = tokenTop - el.offsetHeight - 10;

        // If it goes off the top of the screen, position it below the token instead
        if (top < 10) {
            top = tokenTop + tokenHeight + 10;
        }

        // Keep it within screen boundaries horizontally
        left = Math.max(10, Math.min(window.innerWidth - appWidth - 10, left));

        // Apply styles directly
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.height = 'auto'; // Ensure it auto-fits content
        el.style.position = 'fixed';
        
        // Update Foundry's internal position object
        this.position.left = left;
        this.position.top = top;
        this.position.width = appWidth;
        this.position.height = el.offsetHeight;
    }

    /**
     * Overrides render to run positioning after HTML injection.
     */
    async _render(force = false, options = {}) {
        await super._render(force, options);
        // Run positioning after the element is added to the DOM and has dimensions
        this.setPosition();
    }
}
