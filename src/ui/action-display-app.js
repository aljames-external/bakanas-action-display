import { actionDisplay } from '../action-display.js';
import { log } from '../lib/logger.js';

import { MODULE_ID } from '../constants.js';

// Cache to persist tab states per actor across HUD rebuilds
const activeTabCache = new Map();

// Static sort order maps for high-performance O(1) tab sorting (prevents GC allocations on every render)
const LEFT_ORDER_MAP = {
    'all': 0, 'weapon': 1, 'spell': 2, 'feat': 3, 'buff': 4,
    'equipment': 5, 'consumable': 6, 'tool': 7, 'backpack': 8,
    'loot': 9, 'other': 10, 'hidden': 11
};

const RIGHT_ORDER_MAP = {
    'all': 0, 'economy': 1, 'components': 2, 'standard': 3, 'action': 4, 'bonus': 5,
    'reaction': 6, 'free': 7, 'time': 8, 'monster': 9, 'vehicle': 10, 'special': 11, 'none': 12
};

// Static sub-tab sort order maps for high-performance O(1) sorting
const SUB_TAB_ORDER_MAPS = {
    'economy': {
        'all': 0, 'action': 1, 'bonus': 2, 'reaction': 3, 'other': 4, 'special': 5,
        'legendary': 6, 'mythic': 7, 'crew': 8, 'lair': 9, 'minute': 10, 'hour': 11,
        'day': 12, 'none': 13
    },
    'components': { 'vocal': 0, 'somatic': 1, 'material': 2 },
    'standard': { 'all': 0, 'action': 1, 'bonus': 2, 'reaction': 3 },
    'time': { 'all': 0, 'minute': 1, 'hour': 2, 'day': 3 },
    'monster': { 'all': 0, 'legendary': 1, 'mythic': 2, 'lair': 3 },
    'vehicle': { 'all': 0, 'crew': 1 }
};

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
        const cached = activeTabCache.get(this.actor?.uuid);
        
        let initialLeftParents = ['all'];
        if (cached?.leftParents) initialLeftParents = cached.leftParents;
        else if (cached?.leftParent) initialLeftParents = [cached.leftParent];
        this.activeLeftParentTypes = new Set(initialLeftParents);
        
        // Migrate from single string to Set for multi-select support
        let initialLeftSubs = [];
        if (cached?.leftSubTypes) initialLeftSubs = cached.leftSubTypes;
        else if (cached?.leftSub) initialLeftSubs = [cached.leftSub];
        this.activeLeftSubTypes = new Set(initialLeftSubs);

        // Active filter states - Right Side (Action Types)
        let initialRightParents = ['all'];
        if (cached?.rightParents) initialRightParents = cached.rightParents;
        else if (cached?.rightParent) initialRightParents = [cached.rightParent];
        this.activeParentTypes = new Set(initialRightParents);

        // Track the explicitly focused parent tab
        this.focusedParentType = cached?.focusedParent || (initialRightParents.includes('all') ? 'all' : initialRightParents[0]);
        
        let initialRightSubs = [];
        if (cached?.subTypes) initialRightSubs = cached.subTypes;
        else if (cached?.rightSub) initialRightSubs = [cached.rightSub];
        this.activeSubTypes = new Set(initialRightSubs);

        // Default active sub-types from system adapter (e.g. VSM active by default in D&D)
        if (!cached) {
            const defaults = actionDisplay.activeSystemAdapter?.getDefaultActiveSubTypes() ?? [];
            for (const sub of defaults) {
                this.activeSubTypes.add(sub);
            }
        }

        // HUD Attachment/Position Mode (persisted client-side)
        this.positionMode = game.settings.get(MODULE_ID, 'hudPositionMode') || 'attached';
        this.isAttached = this.positionMode === 'attached';
        
        // Dragging state
        this._dragData = null;

        // Bind listeners once for event delegation and capture phases to prevent GC churn
        this._boundOnPointerDownCapture = this._onPointerDownCapture.bind(this);
        this._boundOnContextMenuCapture = this._onContextMenuCapture.bind(this);
        this._onDragStart = this._onDragStart.bind(this);
        this._onDragMove = this._onDragMove.bind(this);
        this._onDragEnd = this._onDragEnd.bind(this);
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
        
        // Clean up menu states and close any open dropdowns/context menus to prevent visual leaks
        this._clearMenuState();
        this._contextMenu = null;
        this.actions = null; // Clear actions cache to release memory
        
        const result = await super.close(options);
        log.debug(`ActionDisplayApp.close() completed, new state: ${this.state}`);
        return result;
    }

    /**
     * Configure default options for the ApplicationV2.
     */
    static DEFAULT_OPTIONS = {
        id: 'bakana-action-display-app',
        classes: ['bakana-action-display-window'],
        tag: 'div',
        window: {
            frame: false, // BORDERLESS! Removes the default window frame
            title: "Bakana's Action Display"
        },
        position: {
            width: 'auto',
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
    static get PARTS() {
        const path = game.modules.get(MODULE_ID)?.path ?? `modules/${MODULE_ID}`;
        return {
            hud: {
                template: `${path}/templates/action-display.html`
            }
        };
    }

    /**
     * Prepare the rendering context (equivalent to getData in AppV1).
     */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const rawActions = actionDisplay.getActions(this.actor);
        this.actions = rawActions; // Cache the processed actions for high-performance UI lookups
        const adapter = actionDisplay.activeSystemAdapter;

        const existingItemCombinations = new Set();
        const existingCombinations = new Set();

        // 1. Single-pass loop: Extract unique tabs and filter actions simultaneously (O(N) vs O(3N))
        for (const action of rawActions) {
            // Extract unique Item Types (for Left-side Tabs)
            if (action.itemTypes && Array.isArray(action.itemTypes)) {
                if (action.itemTypes.length === 2) {
                    existingItemCombinations.add(`${action.itemTypes[0]}/${action.itemTypes[1]}`);
                } else if (action.itemTypes.length === 1) {
                    existingItemCombinations.add(action.itemTypes[0]);
                }
            }

            // Extract unique Action Types (for Right-side Tabs)
            if (action.tabs && Array.isArray(action.tabs)) {
                // Support both single tab [parent, sub] and multiple tabs [[parent1, sub1], ...]
                const tabsList = Array.isArray(action.tabs[0]) ? action.tabs : null;
                if (tabsList) {
                    for (const tab of tabsList) {
                        if (tab.length === 2) {
                            existingCombinations.add(`${tab[0]}/${tab[1]}`);
                        } else if (tab.length === 1) {
                            existingCombinations.add(tab[0]);
                        }
                    }
                } else {
                    const tab = action.tabs;
                    if (tab.length === 2) {
                        existingCombinations.add(`${tab[0]}/${tab[1]}`);
                    } else if (tab.length === 1) {
                        existingCombinations.add(tab[0]);
                    }
                }
            }
        }

        // Always ensure 'hidden' tab is present if we are currently viewing it,
        // even if it is empty, to prevent jarring automatic tab switches when unhiding the last item.
        if (this.activeLeftParentTypes.has('hidden')) {
            existingItemCombinations.add('hidden');
        }

        // 2. Build the left-side hierarchy dynamically using the adapter
        const leftGroups = {};
        
        // Always ensure 'all' parent is present if we have actions
        if (rawActions.length > 0) {
            leftGroups['all'] = {
                id: 'all',
                label: adapter.getItemTypeLabel('all'),
                icon: adapter.getItemTypeIcon('all'),
                active: this.activeLeftParentTypes.has('all'),
                expanded: this.activeLeftParentTypes.has('all'),
                activeParent: false,
                subTabs: []
            };
        }

        for (const combo of existingItemCombinations) {
            const parts = combo.split('/');
            const parentId = parts[0];
            const subId = parts[1]; // might be undefined (spell level)

            if (!leftGroups[parentId]) {
                const isActive = this.activeLeftParentTypes.has(parentId);
                leftGroups[parentId] = {
                    id: parentId,
                    label: adapter.getItemTypeLabel(parentId),
                    icon: adapter.getItemTypeIcon(parentId),
                    active: isActive,
                    expanded: isActive,
                    activeParent: false, // Will compute post-loop
                    subTabs: []
                };
            }

            if (subId) {
                const isActive = this.activeLeftParentTypes.has(parentId);
                const isSubActive = this.activeLeftSubTypes.has(subId);
                leftGroups[parentId].subTabs.push({
                    id: subId,
                    label: adapter.getItemSubTabLabel(parentId, subId),
                    active: isActive && isSubActive
                });
            }
        }

        // Convert to array and sort by our static O(1) order map
        const itemTypes = Object.values(leftGroups);
        itemTypes.sort((a, b) => {
            const sortA = LEFT_ORDER_MAP[a.id] ?? 999;
            const sortB = LEFT_ORDER_MAP[b.id] ?? 999;
            return sortA - sortB;
        });

        // Post-process leftGroups to set activeParent
        for (const parent of itemTypes) {
            if (parent.subTabs.length > 0) {
                const validSubIds = new Set(parent.subTabs.map(t => t.id));
                const activeSubsForParent = Array.from(this.activeLeftSubTypes).filter(id => validSubIds.has(id));
                if (parent.active && activeSubsForParent.length > 0) {
                    parent.activeParent = true;
                }
            }
        }

        // Cache leftGroups on the instance for use in event handlers/action rolling
        this.leftGroups = leftGroups;

        // Prune active left sub-tabs that are no longer available in any active parent
        const allAvailableLeftSubs = new Set();
        for (const parentId of this.activeLeftParentTypes) {
            const group = leftGroups[parentId];
            if (group && group.subTabs.length > 0) {
                for (const sub of group.subTabs) {
                    allAvailableLeftSubs.add(sub.id);
                }
            }
        }
        for (const activeSub of this.activeLeftSubTypes) {
            if (activeSub !== 'all' && !allAvailableLeftSubs.has(activeSub)) {
                this.activeLeftSubTypes.delete(activeSub);
            }
        }

        // If no active left parent type is available, default to 'all'
        if (itemTypes.length && !itemTypes.some(p => this.activeLeftParentTypes.has(p.id))) {
            this.activeLeftParentTypes.clear();
            this.activeLeftParentTypes.add('all');
            const allTab = itemTypes.find(t => t.id === 'all');
            if (allTab) {
                allTab.active = true;
                allTab.expanded = true;
            }
            this.activeLeftSubTypes.clear();
        }

        // 3. Build the right-side hierarchy dynamically using the adapter
        const parentGroups = {};
        
        // Always ensure 'all' parent is present if we have actions
        if (rawActions.length > 0) {
            parentGroups['all'] = {
                id: 'all',
                label: adapter.getActionTypeLabel('all'),
                icon: adapter.getActionTypeIcon('all'),
                active: this.activeParentTypes.has('all'),
                expanded: this.activeParentTypes.has('all'),
                activeParent: false,
                subTabs: []
            };
        }

        for (const combo of existingCombinations) {
            const parts = combo.split('/');
            const parentId = parts[0];
            const subId = parts[1]; // might be undefined

            if (!parentGroups[parentId]) {
                const isActive = this.activeParentTypes.has(parentId);
                parentGroups[parentId] = {
                    id: parentId,
                    label: adapter.getActionTypeLabel(parentId),
                    icon: adapter.getActionTypeIcon(parentId),
                    active: isActive,
                    expanded: isActive,
                    activeParent: false, // Will compute post-loop
                    subTabs: []
                };
            }

            if (subId) {
                const isActive = this.activeParentTypes.has(parentId);
                const isSubActive = this.activeSubTypes.has(subId);
                const isComponents = parentId === 'components';
                parentGroups[parentId].subTabs.push({
                    id: subId,
                    label: adapter.getActionSubTabLabel(subId),
                    active: !isComponents && isActive && isSubActive,
                    excluded: isComponents && isActive && isSubActive
                });
            }
        }

        // Convert to array and sort by our static O(1) order map
        const actionTypes = Object.values(parentGroups);
        actionTypes.sort((a, b) => {
            const sortA = RIGHT_ORDER_MAP[a.id] ?? 999;
            const sortB = RIGHT_ORDER_MAP[b.id] ?? 999;
            return sortA - sortB;
        });

        // Sort sub-tabs within each parent and add 'All'
        for (const parent of actionTypes) {
            const skipAll = ['components'].includes(parent.id);
            
            if (parent.subTabs.length > 0 && !skipAll) {
                const isActive = parent.id === this.focusedParentType;
                const validSubIds = new Set(parent.subTabs.map(t => t.id));
                const activeSubsForParent = Array.from(this.activeSubTypes).filter(id => validSubIds.has(id));

                parent.subTabs.unshift({
                    id: 'all',
                    label: adapter.getActionSubTabLabel('all') ?? 'All',
                    active: isActive && activeSubsForParent.length === 0
                });
                
                const orderMap = SUB_TAB_ORDER_MAPS[parent.id] ?? {};
                parent.subTabs.sort((a, b) => {
                    const sortA = orderMap[a.id] ?? 999;
                    const sortB = orderMap[b.id] ?? 999;
                    return sortA - sortB;
                });
            } else if (skipAll) {
                const orderMap = SUB_TAB_ORDER_MAPS[parent.id] ?? {};
                parent.subTabs.sort((a, b) => {
                    const sortA = orderMap[a.id] ?? 999;
                    const sortB = orderMap[b.id] ?? 999;
                    return sortA - sortB;
                });
            }
        }

        // Post-process parentGroups to set active, expanded, and activeParent
        const parentsWithFilters = new Set();
        for (const parent of actionTypes) {
            if (parent.subTabs.length > 0) {
                const validSubIds = new Set(parent.subTabs.map(t => t.id));
                const activeSubsForParent = Array.from(this.activeSubTypes).filter(id => validSubIds.has(id));
                
                if (activeSubsForParent.length > 0) {
                    parent.activeParent = true;
                    parentsWithFilters.add(parent.id);
                }
                
                parent.active = parent.id === this.focusedParentType;
                parent.expanded = parent.active || activeSubsForParent.length > 0;
            } else {
                parent.active = parent.id === this.focusedParentType;
                parent.expanded = parent.active;
            }
        }

        // Dynamically update activeParentTypes for filtering
        this.activeParentTypes.clear();
        this.activeParentTypes.add(this.focusedParentType);
        for (const pId of parentsWithFilters) {
            this.activeParentTypes.add(pId);
        }

        // Cache parentGroups on the instance
        this.parentGroups = parentGroups;

        // Prune active right sub-tabs that are no longer available in any parent group
        const allAvailableRightSubs = new Set();
        for (const group of Object.values(parentGroups)) {
            if (group.subTabs.length > 0) {
                for (const sub of group.subTabs) {
                    allAvailableRightSubs.add(sub.id);
                }
            }
        }
        for (const activeSub of this.activeSubTypes) {
            if (activeSub !== 'all' && !allAvailableRightSubs.has(activeSub)) {
                this.activeSubTypes.delete(activeSub);
            }
        }

        // If the active parent type is no longer available, default to the first available
        if (actionTypes.length && !actionTypes.some(p => this.activeParentTypes.has(p.id))) {
            this.activeParentTypes.clear();
            this.activeParentTypes.add(actionTypes[0].id);
            actionTypes[0].active = true;
            actionTypes[0].expanded = true;
            this.activeSubTypes.clear();
        }

        // 4. Second pass: Filter actions now that tab groups are fully populated
        const filteredActions = [];
        for (const action of rawActions) {
            if (this._matchesFilters(action)) {
                filteredActions.push(action);
            }
        }
        // Inject data and attachment state into context
        context.itemTypes = itemTypes;
        context.actionTypes = actionTypes;
        context.items = filteredActions;
        context.isAttached = this.isAttached;
        context.filterNoResources = game.settings.get(MODULE_ID, 'filterNoResources');

        // Persist the validated tab states for this actor
        if (this.actor?.uuid) {
            activeTabCache.set(this.actor.uuid, {
                leftParents: Array.from(this.activeLeftParentTypes),
                leftSubTypes: Array.from(this.activeLeftSubTypes),
                rightParents: Array.from(this.activeParentTypes),
                subTypes: Array.from(this.activeSubTypes),
                focusedParent: this.focusedParentType
            });
        }

        // Delegate to system adapter to allow system-specific context modifications
        adapter?.modifyContext?.(context, this);

        return context;
    }

    /**
     * Check if an action matches the currently active left and right tab filters.
     * @param {Object} action The action to check
     * @returns {boolean} True if the action matches the filters
     * @private
     */
    _matchesFilters(action) {
        // Filter by Left Side (Item Type)
        if (!action.itemTypes || !Array.isArray(action.itemTypes)) return false;
        const itemParentId = action.itemTypes[0];
        const itemSubId = action.itemTypes[1];

        // If the item is hidden, it only matches if the "Hidden" tab is selected.
        // If the "Hidden" tab is selected, only hidden items match.
        const isHiddenActive = this.activeLeftParentTypes.has('hidden');
        if (itemParentId === 'hidden' && !isHiddenActive) return false;
        if (itemParentId !== 'hidden' && isHiddenActive) return false;

        let matchesLeft = false;
        
        // 1. Direct parent match
        if (this.activeLeftParentTypes.has(itemParentId)) {
            const parentGroup = this.leftGroups?.[itemParentId];
            const validSubIds = parentGroup ? new Set(parentGroup.subTabs.map(t => t.id)) : new Set();
            const activeSubsForParent = Array.from(this.activeLeftSubTypes).filter(id => validSubIds.has(id));
            
            if (activeSubsForParent.length === 0) {
                matchesLeft = true;
            } else {
                matchesLeft = this.activeLeftSubTypes.has(itemSubId);
            }
        }
        
        // 2. 'all' parent match (shows other items, but respects specific sub-tab filters on active parents)
        if (!matchesLeft && this.activeLeftParentTypes.has('all') && !action.excludeFromAll) {
            const isParentActive = this.activeLeftParentTypes.has(itemParentId);
            if (!isParentActive) {
                matchesLeft = true;
            } else {
                const parentGroup = this.leftGroups?.[itemParentId];
                const validSubIds = parentGroup ? new Set(parentGroup.subTabs.map(t => t.id)) : new Set();
                const activeSubsForParent = Array.from(this.activeLeftSubTypes).filter(id => validSubIds.has(id));
                if (activeSubsForParent.length === 0) {
                    matchesLeft = true;
                }
            }
        }
        
        if (!matchesLeft) return false;

        // Filter by Right Side (Action Type)
        if (!action.tabs || !Array.isArray(action.tabs)) return false;
        const tabsList = Array.isArray(action.tabs[0]) ? action.tabs : [action.tabs];

        // Spell Components Filter (restrictive AND-filter, only for spells)
        if (action.originalItem?.type === 'spell') {
            const isComponentsActive = this.activeParentTypes.has('components');
            if (isComponentsActive) {
                const parentGroup = this.parentGroups?.['components'];
                const validSubIds = parentGroup ? new Set(parentGroup.subTabs.map(t => t.id)) : new Set();
                const activeCompSubs = Array.from(this.activeSubTypes).filter(id => validSubIds.has(id));
                
                if (activeCompSubs.length > 0) {
                    const spellCompSubs = new Set(
                        tabsList
                            .filter(tab => tab[0] === 'components')
                            .map(tab => tab[1])
                    );
                    const hasBannedComponent = Array.from(spellCompSubs).some(comp => activeCompSubs.includes(comp));
                    if (hasBannedComponent) return false;
                }
            }
        }

        // Check if we have any active economy/time parents
        const activeEconomyParents = Array.from(this.activeParentTypes).filter(p => p !== 'components' && p !== 'all');
        
        let matchesRight = true;
        if (activeEconomyParents.length > 0 || this.activeParentTypes.has('all')) {
            matchesRight = tabsList.some(tab => {
                const actionParentId = tab[0];
                const actionSubId = tab[1];

                // Ignore components parent in the OR-filter
                if (actionParentId === 'components') return false;

                let matchesParent = false;
                
                // 1. Direct parent match
                if (this.activeParentTypes.has(actionParentId)) {
                    const parentGroup = this.parentGroups?.[actionParentId];
                    const validSubIds = parentGroup ? new Set(parentGroup.subTabs.map(t => t.id)) : new Set();
                    const activeSubsForParent = Array.from(this.activeSubTypes).filter(id => validSubIds.has(id));
                    
                    if (activeSubsForParent.length === 0) {
                        matchesParent = true;
                    } else {
                        matchesParent = this.activeSubTypes.has(actionSubId);
                    }
                }
                
                // 2. 'all' parent match
                if (!matchesParent && this.activeParentTypes.has('all')) {
                    const isParentActive = this.activeParentTypes.has(actionParentId);
                    if (!isParentActive) {
                        matchesParent = true;
                    } else {
                        const parentGroup = this.parentGroups?.[actionParentId];
                        const validSubIds = parentGroup ? new Set(parentGroup.subTabs.map(t => t.id)) : new Set();
                        const activeSubsForParent = Array.from(this.activeSubTypes).filter(id => validSubIds.has(id));
                        if (activeSubsForParent.length === 0) {
                            matchesParent = true;
                        }
                    }
                }
                
                return matchesParent;
            });
        }
        
        return matchesRight;
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
        this._clearMenuState();
        const parentId = target.dataset.type;
        
        this.activeLeftParentTypes.clear();
        this.activeLeftParentTypes.add(parentId);
        this.activeLeftSubTypes.clear();
        
        log.debug(`Changed item parent filter to:`, Array.from(this.activeLeftParentTypes));
        this.render();
    }

    /**
     * Handle left-side sub-item type (spell level) selection clicks (left-click).
     * 'this' refers to the application instance.
     */
    static async _onChangeLeftSubItemType(event, target) {
        event.preventDefault();
        this._clearMenuState();
        const type = target.dataset.type;
        
        const parentGroup = target.closest('.bad-left-tab-group');
        const parentId = parentGroup?.querySelector('.bad-left-tab')?.dataset.type;
        
        if (parentId) {
            this.activeLeftParentTypes.clear();
            this.activeLeftParentTypes.add(parentId);
        }
        
        if (type === 'all') {
            this.activeLeftSubTypes.clear();
        } else if (this.activeLeftSubTypes.has(type) && this.activeLeftSubTypes.size === 1) {
            this.activeLeftSubTypes.clear();
        } else {
            this.activeLeftSubTypes.clear();
            this.activeLeftSubTypes.add(type);
        }
        
        log.debug(`Changed item sub filter to:`, Array.from(this.activeLeftSubTypes));
        this.render();
    }

    /**
     * Toggle a left-side parent tab in the active set (for right-click multi-select).
     */
    _onToggleLeftParent(parentId) {
        // Right-click on a left parent tab: clear all its sub-tab filters (resets to defaults!)
        if (parentId === 'all') {
            this.activeLeftSubTypes.clear();
            this.activeLeftParentTypes.clear();
            this.activeLeftParentTypes.add('all');
        } else {
            const parentGroup = this.leftGroups?.[parentId];
            if (parentGroup) {
                const validSubIds = new Set(parentGroup.subTabs.map(t => t.id));
                for (const subId of this.activeLeftSubTypes) {
                    if (validSubIds.has(subId)) {
                        this.activeLeftSubTypes.delete(subId);
                    }
                }
            }
            this.activeLeftParentTypes.add(parentId); // Ensure it remains open!
            this.activeLeftParentTypes.delete('all'); // Remove 'all' if we have a specific one
        }
        log.debug(`Reset left parent ${parentId} to defaults`);
        this.render();
    }

    /**
     * Toggle a left-side sub-tab (spell level) in the active set (for right-click multi-select).
     */
    _onToggleLeftSub(target, type) {
        const parentGroup = target.closest('.bad-left-tab-group');
        const parentId = parentGroup?.querySelector('.bad-left-tab')?.dataset.type;
        
        if (parentId) {
            this.activeLeftParentTypes.add(parentId);
        }

        if (type === 'all') {
            this.activeLeftSubTypes.clear();
        } else {
            if (this.activeLeftSubTypes.has(type)) {
                this.activeLeftSubTypes.delete(type);
            } else {
                this.activeLeftSubTypes.add(type);
            }
        }
        log.debug(`Toggled left sub filter:`, Array.from(this.activeLeftSubTypes));
        this.render();
    }

    /**
     * Handle parent action type (right tab) selection clicks.
     * 'this' refers to the application instance.
     */
    static async _onChangeActionType(event, target) {
        event.preventDefault();
        this._clearMenuState();
        const parentId = target.dataset.type;
        
        this.focusedParentType = parentId;
        
        log.debug(`Focused action parent to: ${parentId}`);
        this.render();
    }

    /**
     * Toggle a right-side parent tab in the active set (for right-click multi-select).
     */
    _onToggleRightParent(parentId) {
        // Right-click on a parent tab: clear all its sub-tab filters (resets both to their defaults!)
        this.focusedParentType = parentId; // Set as focused so it remains open!
        
        if (parentId === 'all') {
            this.activeSubTypes.clear();
        } else {
            const parentGroup = this.parentGroups?.[parentId];
            if (parentGroup) {
                const validSubIds = new Set(parentGroup.subTabs.map(t => t.id));
                for (const subId of this.activeSubTypes) {
                    if (validSubIds.has(subId)) {
                        this.activeSubTypes.delete(subId);
                    }
                }
            }
        }
        log.debug(`Reset parent ${parentId} to defaults`);
        this.render();
    }

    /**
     * Handle sub-action type selection clicks (left-click).
     * 'this' refers to the application instance.
     */
    static async _onChangeSubActionType(event, target) {
        event.preventDefault();
        this._clearMenuState();
        const type = target.dataset.type;
        
        const parentGroup = target.closest('.bad-right-tab-group');
        const parentId = parentGroup?.querySelector('.bad-right-tab')?.dataset.type;
        
        if (parentId) {
            this.focusedParentType = parentId;
        }
        
        if (type === 'all') {
            // Clear all sub-tabs for this parent
            if (parentId) {
                const group = this.parentGroups?.[parentId];
                if (group) {
                    const validSubIds = new Set(group.subTabs.map(t => t.id));
                    for (const subId of this.activeSubTypes) {
                        if (validSubIds.has(subId)) {
                            this.activeSubTypes.delete(subId);
                        }
                    }
                }
            }
        } else {
            // Left-click is exclusive within its own parent tab
            if (parentId) {
                const group = this.parentGroups?.[parentId];
                log.debug(`_onChangeSubActionType | parentId: ${parentId}, group found: ${!!group}`, group);
                if (group) {
                    const validSubIds = new Set(group.subTabs.map(t => t.id));
                    const activeSubsForParent = Array.from(this.activeSubTypes).filter(id => validSubIds.has(id));
                    log.debug(`_onChangeSubActionType | type: ${type}, validSubIds:`, Array.from(validSubIds), `activeSubsForParent:`, activeSubsForParent);
                    
                    if (activeSubsForParent.length > 1) {
                        log.debug(`_onChangeSubActionType | Multiple selected, isolating: ${type}`);
                        for (const subId of activeSubsForParent) {
                            if (subId !== type) {
                                this.activeSubTypes.delete(subId);
                            }
                        }
                        this.activeSubTypes.add(type); // Ensure it is selected
                    } else if (activeSubsForParent.length === 1 && activeSubsForParent[0] === type) {
                        log.debug(`_onChangeSubActionType | Sole selected, toggling off: ${type}`);
                        this.activeSubTypes.delete(type);
                    } else {
                        log.debug(`_onChangeSubActionType | None or different selected, making sole: ${type}`);
                        for (const subId of activeSubsForParent) {
                            this.activeSubTypes.delete(subId);
                        }
                        this.activeSubTypes.add(type);
                    }
                }
            }
        }
        
        log.debug(`Changed action sub filter to:`, Array.from(this.activeSubTypes));
        this.render();
    }

    /**
     * Toggle a right-side sub-tab in the active set (for right-click multi-select).
     */
    _onToggleRightSub(target, type) {
        const parentGroup = target.closest('.bad-right-tab-group');
        const parentId = parentGroup?.querySelector('.bad-right-tab')?.dataset.type;
        
        if (parentId) {
            this.focusedParentType = parentId;
        }

        if (type === 'all') {
            // Clear all sub-tabs for this parent
            if (parentId) {
                const group = this.parentGroups?.[parentId];
                if (group) {
                    const validSubIds = new Set(group.subTabs.map(t => t.id));
                    for (const subId of this.activeSubTypes) {
                        if (validSubIds.has(subId)) {
                            this.activeSubTypes.delete(subId);
                        }
                    }
                }
            }
        } else {
            if (this.activeSubTypes.has(type)) {
                this.activeSubTypes.delete(type);
            } else {
                this.activeSubTypes.add(type);
            }
        }
        log.debug(`Toggled right sub filter:`, Array.from(this.activeSubTypes));
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
                await game.settings.set(MODULE_ID, 'hudDetachedPosition', pos);
            }
        }
        
        await game.settings.set(MODULE_ID, 'hudPositionMode', this.positionMode);
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
        
        if (this._preventReopen) {
            log.debug("_onRollAction | preventReopen is true, toggling off and closing menu");
            this._preventReopen = false;
            this._activeLeftClickMenu?.close();
            this._activeLeftClickMenu = null;
            return;
        }

        // Close any existing left-click menu if we clicked a different item
        this._activeLeftClickMenu?.close();
        this._activeLeftClickMenu = null;

        const actionId = target.dataset.actionId;
        const actions = this.actions || [];
        const action = actions.find(a => a.id === actionId);
        
        if (action) {
            const subActions = action.subActions;
            if (subActions && subActions.length > 0) {
                // Filter sub-actions to only those that match the currently active right-side tabs
                const activeParents = this.activeParentTypes;
                const activeSubs = this.activeSubTypes;
                const filterNoResources = game.settings.get(MODULE_ID, 'filterNoResources');

                const activeEconomyParents = Array.from(activeParents).filter(p => p !== 'components' && p !== 'all');

                const qualifyingSubActions = subActions.filter(sub => {
                    const actionParentId = sub.tabs[0];
                    const actionSubId = sub.tabs[1];

                    if (actionParentId === 'components') return false;

                    if (activeEconomyParents.length === 0 && !activeParents.has('all')) {
                        return true; // Bypass economy filter if only components is active
                    }
                    
                    let matchesParent = false;
                    
                    // 1. Direct parent match
                    if (activeParents.has(actionParentId)) {
                        const parentGroup = this.parentGroups?.[actionParentId];
                        const validSubIds = parentGroup ? new Set(parentGroup.subTabs.map(t => t.id)) : new Set();
                        const activeSubsForParent = Array.from(activeSubs).filter(id => validSubIds.has(id));
                        
                        if (activeSubsForParent.length === 0) {
                            matchesParent = true;
                        } else {
                            matchesParent = activeSubs.has(actionSubId);
                        }
                    }
                    
                    // 2. 'all' parent match
                    if (!matchesParent && activeParents.has('all')) {
                        const isParentActive = activeParents.has(actionParentId);
                        if (!isParentActive) {
                            matchesParent = true;
                        } else {
                            const parentGroup = this.parentGroups?.[actionParentId];
                            const validSubIds = parentGroup ? new Set(parentGroup.subTabs.map(t => t.id)) : new Set();
                            const activeSubsForParent = Array.from(activeSubs).filter(id => validSubIds.has(id));
                            if (activeSubsForParent.length === 0) {
                                matchesParent = true;
                            }
                        }
                    }
                    
                    if (!matchesParent) return false;
                    
                    // Filter out depleted sub-actions if Hide Depleted is enabled
                    if (filterNoResources && sub.uses && sub.uses.available !== null && sub.uses.available <= 0) {
                        return false;
                    }
                    
                    return true;
                });

                log.debug(`_onRollAction | activeParents: ${Array.from(activeParents).join(', ')}, activeSubs: ${Array.from(activeSubs).join(', ')}, qualifying: ${qualifyingSubActions.length}`, qualifyingSubActions);

                const showDropdown = qualifyingSubActions.length > 1 || (subActions.length > 1 && qualifyingSubActions.length === 1);

                if (showDropdown) {
                    // Show a left-click dropdown menu.
                    const menuItems = qualifyingSubActions.map(sub => {
                        const uses = sub.uses;
                        const name = sub.name;
                        
                        const iconHtml = sub.img 
                            ? `<img src="${sub.img}" style="width: 16px; height: 16px; border: none; vertical-align: middle; margin-right: 8px; border-radius: 4px;" />` 
                            : '<i class="fas fa-play" style="margin-right: 8px;"></i>';
                        
                        let usesHtml = "";
                        if (uses && uses.available !== null) {
                            const isDepleted = uses.available <= 0 && !uses.isUpcast;
                            const depletedClass = isDepleted ? ' depleted' : '';
                            const upcastClass = uses.isUpcast ? ' upcast' : '';
                            const usesText = uses.max ? `${uses.available}/${uses.max}` : `${uses.available}`;
                            usesHtml = `<span class="bad-menu-uses${depletedClass}${upcastClass}">${usesText}</span>`;
                        }
                        
                        // Workaround: Foundry escapes 'name' but renders 'icon' as unescaped HTML.
                        // We pack the entire HTML (icon + name + uses) into 'icon' and leave 'name' empty!
                        return {
                            name: "",
                            icon: `${iconHtml}<span class="bad-menu-name">${name}</span>${usesHtml}`,
                            callback: () => {
                                log.debug(`Rolling sub-action: ${sub.name} via dropdown`);
                                sub.roll(event);
                            }
                        };
                    });

                    let menu; // Declare menu here so it can be captured in the onClose closure
                    const targetRow = target; // Capture the target in a local variable to prevent race conditions
                    log.debug(`_onRollAction | Creating menu for: ${targetRow.dataset.actionId}`, targetRow);
                    const options = {
                        jQuery: false, // Opt-out of jQuery for callbacks
                        onClose: () => {
                            log.debug(`onClose | Target: ${targetRow.dataset.actionId}`, targetRow);
                            targetRow.classList.remove('bad-menu-active'); // Safely remove class from the correct row
                            log.debug(`onClose | Removed class from target: ${targetRow.dataset.actionId}. Classes now:`, targetRow.className);
                            
                            // Only clear global references and classes if this specific menu is still the active one
                            if (this._activeLeftClickMenu === menu) {
                                log.debug(`onClose | Clearing global active menu reference`);
                                this._activeLeftClickMenu = null;
                                this.element.querySelector('.bakana-action-display-container')?.classList.remove('has-context-menu');
                            }
                            if (this._activeMenuTarget === targetRow) {
                                log.debug(`onClose | Clearing global active target reference`);
                                this._activeMenuTarget = null;
                            }
                        }
                    };

                    // Create and render a temporary ContextMenu at the clicked element (passing raw HTMLElement)
                    const container = this.element.querySelector('.bakana-action-display-container') || this.element;
                    menu = new foundry.applications.ux.ContextMenu.implementation(container, null, menuItems, options);
                    this._activeMenuTarget = target; // Set target directly to ensure toggle-off tracking works
                    this._activeLeftClickMenu = menu; // Store the menu instance directly
                    log.debug(`_onRollAction | Rendering menu for: ${targetRow.dataset.actionId}`);
                    menu.render(target);

                    // Add classes synchronously since V12 ContextMenu.render() doesn't trigger onOpen programmatically
                    targetRow.classList.add('bad-menu-active');
                    this.element.querySelectorAll('.bad-action-item').forEach(el => {
                        if (el !== targetRow) {
                            el.classList.remove('bad-menu-active');
                        }
                    });
                    this.element.querySelector('.bakana-action-display-container')?.classList.add('has-context-menu');
                    log.debug(`_onRollAction | Synchronously applied bad-menu-active to: ${targetRow.dataset.actionId}`);
                } else if (qualifyingSubActions.length === 1) {
                    // Natively only 1 option, and it qualifies: roll directly!
                    qualifyingSubActions[0].roll(event);
                } else {
                    // Fallback: roll the first sub-action
                    subActions[0].roll(event);
                }
            } else {
                // No sub-actions: roll directly
                action.roll(event);
            }
        }
    }

    /**
     * Toggle the "Filter Out of Resources" setting.
     * 'this' refers to the application instance.
     */
    static async _onToggleFilterResources(event, target) {
        const checked = target.checked;
        await game.settings.set(MODULE_ID, 'filterNoResources', checked);
        log.debug(`Toggled filterNoResources to: ${checked}`);
        this.render();
    }



    /* -------------------------------------------- */
    /*  Positioning & Dragging                      */
    /* -------------------------------------------- */

    /**
     * Hook into the first render to set up permanent event listeners and context menus.
     */
    _onFirstRender(context, options) {
        super._onFirstRender(context, options);
        log.debug(`_onFirstRender | token: ${this.token?.name}`);

        // Prevent clicks inside the HUD from bubbling up to the canvas/document
        this.element.addEventListener('click', (event) => event.stopPropagation());

        // Intercept right-click pointerdown and contextmenu events in the capture phase to support toggling the menu off
        this.element.addEventListener('pointerdown', this._boundOnPointerDownCapture, { capture: true });
        this.element.addEventListener('contextmenu', this._boundOnContextMenuCapture, { capture: true });

        // Event Delegation for Dragging: attach mousedown to the outer element and filter by the handle
        this.element.addEventListener('mousedown', (event) => {
            const handle = event.target.closest('.bad-drag-handle');
            if (handle) this._onDragStart(event);
        });

        // Initialize the context menu for action items once
        this._contextMenu = this._createContextMenu();

        // Cache DOM elements to prevent querySelector calls during renders
        this._containerEl = this.element.querySelector('.bakana-action-display-container');
        this._leftTabsEl = this.element.querySelector('.bad-left-tabs');
        this._rightTabsEl = this.element.querySelector('.bad-right-tabs');
    }

    /**
     * Hook into the render lifecycle to position the element and measure its dimensions.
     */
    _onRender(context, options) {
        super._onRender(context, options);
        log.debug(`_onRender | token: ${this.token?.name}, state: ${this.state}, isAttached: ${this.isAttached}`);
        
        // Measure and cache the fresh dimensions after rendering to prevent layout thrashing at 60fps
        this._width = this.element.offsetWidth;
        this._height = this.element.offsetHeight;

        this.setPosition();
        this._adjustMinHeight();
    }

    _clearMenuState() {
        log.debug("_clearMenuState | Clearing menu state and closing open menus");
        
        // Close any open context menus if we have an active target
        if (this._activeMenuTarget) {
            if (this._contextMenu) {
                try {
                    this._contextMenu.close()?.catch?.(err => {
                        log.debug("ContextMenu.close promise rejected (expected during re-render):", err);
                    });
                } catch (err) {
                    log.debug("ContextMenu.close threw synchronously:", err);
                }
            }

        }

        this._activeLeftClickMenu?.close();
        this._activeLeftClickMenu = null;
        this._activeMenuTarget = null;
        this._preventReopen = false;
    }

    /**
     * Adjust the min-height of the main container to ensure it is at least
    
     * as tall as the tallest tab column, keeping them visually connected.
     */
    _adjustMinHeight() {
        const container = this._containerEl;
        const leftTabs = this._leftTabsEl;
        const rightTabs = this._rightTabsEl;

        if (!container) return;

        // Reset min-height to measure natural layout first
        container.style.minHeight = '';

        // Measure the bottom reach of the tabs relative to the container (only if they have children)
        const leftBottom = (leftTabs && leftTabs.children.length > 0) ? (leftTabs.offsetTop + leftTabs.offsetHeight) : 0;
        const rightBottom = (rightTabs && rightTabs.children.length > 0) ? (rightTabs.offsetTop + rightTabs.offsetHeight) : 0;
        const maxTabBottom = Math.max(leftBottom, rightBottom);
        
        log.debug(`_adjustMinHeight | leftBottom: ${leftBottom}px, rightBottom: ${rightBottom}px, maxTabBottom: ${maxTabBottom}px`);

        if (maxTabBottom > 0) {
            // Lazy-load and cache the container's bottom padding to prevent expensive getComputedStyle calls
            if (this._containerPaddingBottom === undefined) {
                const containerStyle = window.getComputedStyle(container);
                this._containerPaddingBottom = parseFloat(containerStyle.paddingBottom) || 0;
            }
            
            const targetMinHeight = maxTabBottom + this._containerPaddingBottom;
            log.debug(`_adjustMinHeight | Applying min-height: ${targetMinHeight}px to container (paddingBottom: ${this._containerPaddingBottom}px)`);
            container.style.minHeight = `${targetMinHeight}px`;
        }
    }

    /**
     * Intercept pointerdown events in the capture phase to detect clicks (left or right)
     * on the active menu target, preparing to prevent it from reopening.
     * @param {PointerEvent} event The triggering pointerdown event
     * @private
     */
    _onPointerDownCapture(event) {
        if (event.button !== 2 && event.button !== 0) return; // Only care about right-clicks (2) or left-clicks (0)
        
        const targetItem = event.target.closest('.bad-action-item') 
            || event.target.closest('.bad-left-sub-tab') 
            || event.target.closest('.bad-left-tab');
        const activeItem = this._activeMenuTarget?.closest('.bad-action-item') 
            || this._activeMenuTarget?.closest('.bad-left-sub-tab') 
            || this._activeMenuTarget?.closest('.bad-left-tab') 
            || this._activeMenuTarget;
        
        log.debug(`_onPointerDownCapture | button: ${event.button}, targetItem:`, targetItem, `activeItem:`, activeItem);
        
        if (targetItem && activeItem === targetItem) {
            log.debug("Pointerdown click on active target, preparing to prevent reopen");
            this._preventReopen = true;
        }
    }

    /**
     * Intercept contextmenu events in the capture phase to toggle the menu off
     * if the same item is right-clicked again.
     * @param {Event} event The triggering contextmenu event
     * @private
     */
    _onContextMenuCapture(event) {
        log.debug(`_onContextMenuCapture | preventReopen: ${this._preventReopen}`);
        if (this._preventReopen) {
            log.debug("Preventing context menu from reopening (toggled off)");
            this._preventReopen = false;
            
            // Safe close in capture phase (catch promise rejections)
            this._contextMenu?.close()?.catch?.(err => {});
            
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return;
        }

        // Intercept right-clicks on left parent tabs
        const leftParentTarget = event.target.closest(".bad-left-tab");
        if (leftParentTarget) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            this._onToggleLeftParent(leftParentTarget.dataset.type);
            return;
        }

        // Intercept right-clicks on right parent tabs
        const rightParentTarget = event.target.closest(".bad-right-tab");
        if (rightParentTarget) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            this._onToggleRightParent(rightParentTarget.dataset.type);
            return;
        }

        // Intercept right-clicks on left sub-tabs
        const leftSubTarget = event.target.closest(".bad-left-sub-tab");
        if (leftSubTarget) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            
            // Delegate to system adapter for custom right-click behavior (e.g. toggling unprepared spells in dnd5e)
            const handled = actionDisplay.activeSystemAdapter?.onTabRightClick?.(this, leftSubTarget, event) ?? false;
            if (!handled) {
                if (leftSubTarget.dataset.type !== 'all') {
                    // Default fallback: multi-select toggle for other sub-tabs
                    this._onToggleLeftSub(leftSubTarget, leftSubTarget.dataset.type);
                }
            }
            return;
        }

        // Intercept right-clicks on right sub-tabs
        const rightSubTarget = event.target.closest(".bad-right-sub-tab");
        if (rightSubTarget && rightSubTarget.dataset.type !== 'all') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            this._onToggleRightSub(rightSubTarget, rightSubTarget.dataset.type);
            return;
        }



        const targetItem = event.target.closest('.bad-action-item') 
            || event.target.closest('.bad-left-sub-tab') 
            || event.target.closest('.bad-left-tab');
        const activeItem = this._activeMenuTarget?.closest('.bad-action-item') 
            || this._activeMenuTarget?.closest('.bad-left-sub-tab') 
            || this._activeMenuTarget?.closest('.bad-left-tab') 
            || this._activeMenuTarget;
        
        log.debug(`_onContextMenuCapture | targetItem:`, targetItem, `activeItem:`, activeItem);

        if (targetItem && activeItem === targetItem) {
            log.debug("Right-clicked the same item, toggling context menu off (fallback)");
            
            this._contextMenu?.close()?.catch?.(err => {
                log.debug("ContextMenu.close promise rejected in fallback:", err);
            });
            
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }
    }



    /**
     * Create and bind the Foundry ContextMenu for action items.
     * @returns {ContextMenu} The created ContextMenu instance
     * @private
     */
    _createContextMenu() {
        const menuItems = [
            {
                name: "BAD.hud.hideAction",
                icon: '<i class="fas fa-eye-slash"></i>',
                condition: el => {
                    if (!this.actor?.isOwner) return false;
                    const actionId = el.dataset.actionId;
                    const actions = this.actions || [];
                    const action = actions.find(a => a.id === actionId);
                    return action && !action.isHidden;
                },
                callback: el => {
                    this._toggleActionHidden(el.dataset.actionId, true);
                }
            },
            {
                name: "BAD.hud.unhideAction",
                icon: '<i class="fas fa-eye"></i>',
                condition: el => {
                    if (!this.actor?.isOwner) return false;
                    const actionId = el.dataset.actionId;
                    const actions = this.actions || [];
                    const action = actions.find(a => a.id === actionId);
                    return action && action.isHidden;
                },
                callback: el => {
                    this._toggleActionHidden(el.dataset.actionId, false);
                }
            },
        ];

        // Delegate to system adapter to add system-specific context menu items
        if (actionDisplay.activeSystemAdapter?.getContextMenuItems) {
            const systemItems = actionDisplay.activeSystemAdapter.getContextMenuItems(this);
            menuItems.push(...systemItems);
        }

        const options = {
            jQuery: false,
            onOpen: (target) => {
                log.debug("Context menu opened on target:", target);
                this._activeContextMenuTarget = target; // Use separate property to prevent race conditions
                // Fail-safe: Ensure no other item has the active menu class
                this.element.querySelectorAll('.bad-action-item').forEach(el => {
                    if (el !== target) el.classList.remove('bad-menu-active');
                });
                target.classList.add('bad-menu-active'); // Add active class to lift z-index
                this.element.querySelector('.bakana-action-display-container')?.classList.add('has-context-menu');
            },
            onClose: () => {
                log.debug("Context menu closed");
                if (this._activeContextMenuTarget) {
                    this._activeContextMenuTarget.classList.remove('bad-menu-active'); // Remove active class
                }
                this._activeContextMenuTarget = null;
                this.element.querySelector('.bakana-action-display-container')?.classList.remove('has-context-menu');
            }
        };

        return new foundry.applications.ux.ContextMenu.implementation(this.element, ".bad-action-item", menuItems, options);
    }

    /**
     * Create and bind the ContextMenu for the left-side tabs (specifically Spells).
     * @returns {ContextMenu} The created ContextMenu instance
     * @private
     */


    /**
     * Toggle the hidden state of an action.
     * @param {string} actionId The ID of the action to toggle
     * @param {boolean} shouldHide Whether the action should be hidden
     * @private
     */
    async _toggleActionHidden(actionId, shouldHide) {
        if (!actionId || !this.actor) return;

        const actions = this.actions || [];
        const action = actions.find(a => a.id === actionId);
        if (!action) return;

        const itemId = action.originalItem?.id || action.id;
        const hiddenItems = this.actor.getFlag(MODULE_ID, 'hiddenItems') || [];
        
        let newHiddenItems = [...hiddenItems];
        if (shouldHide) {
            if (!newHiddenItems.includes(itemId)) {
                newHiddenItems.push(itemId);
                log.debug(`Hiding item: ${action.name} (ID: ${itemId})`);
            }
        } else {
            const index = newHiddenItems.indexOf(itemId);
            if (index > -1) {
                newHiddenItems.splice(index, 1);
                log.debug(`Unhiding item: ${action.name} (ID: ${itemId})`);
            }
        }

        await this.actor.setFlag(MODULE_ID, 'hiddenItems', newHiddenItems);
        this.render();
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
            await game.settings.set(MODULE_ID, 'hudDetachedPosition', pos);
            await game.settings.set(MODULE_ID, 'hudPositionMode', 'detached');
            
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

        const scale = game.settings.get(MODULE_ID, 'hudScale') ?? 1.0;

        if (this.isAttached && this.token) {
            // --- ATTACHED MODE (Tracks Token) ---
            const tokenTransform = this.token.worldTransform;
            const canvasScale = game.canvas.stage?.scale?.x ?? 1;
            const tokenWidth = this.token.w * canvasScale;
            const tokenHeight = this.token.h * canvasScale;

            const tokenLeft = tokenTransform.tx;
            const tokenTop = tokenTransform.ty;
            
            // Use cached width if available to prevent layout thrashing (reflow) at 60fps
            const appWidth = this._width || el.offsetWidth || (320 * scale);

            const spaceAbove = tokenTop;
            const spaceBelow = window.innerHeight - (tokenTop + tokenHeight);
            const side = spaceAbove > spaceBelow ? 'above' : 'below';

            // Leave safety margin on both sides for slide-out tabs, scaled proportionally
            const tabExtension = 150 * scale;
            let left = tokenLeft + (tokenWidth / 2) - (appWidth / 2);
            left = Math.max(tabExtension, Math.min(window.innerWidth - appWidth - tabExtension, left));

            const targetPosition = foundry.utils.mergeObject(position, {
                left,
                width: 'auto', // Let CSS control the width via ems
                height: 'auto'
            });

            const result = super.setPosition(targetPosition);

            // Force the window wrapper to auto-size so it grows/shrinks dynamically with the container,
            // allowing it to grow upwards (when bottom-anchored) or downwards (when top-anchored).
            el.style.height = 'auto';

            if (side === 'above') {
                const bottomOffset = window.innerHeight - tokenTop + 10;
                el.style.bottom = `${bottomOffset}px`;
                el.style.top = '';
            } else {
                const topOffset = tokenTop + tokenHeight + 10;
                el.style.top = `${topOffset}px`;
                el.style.bottom = '';
            }

            return result;
        } else {
            // --- DETACHED MODE (Floating / Fixed Position) ---
            const savedPos = game.settings.get(MODULE_ID, 'hudDetachedPosition');
            
            // Use cached dimensions if available to prevent layout thrashing (reflow) at 60fps
            const appWidth = this._width || el.offsetWidth || (320 * scale);
            const appHeight = this._height || (el.offsetHeight || 200) * (el.offsetHeight ? 1 : scale);
            
            let left = savedPos?.left ?? 100;
            let top = savedPos?.top ?? 100;

            // Clamp to screen bounds to ensure it's always visible (handles resolution changes)
            left = Math.max(10, Math.min(window.innerWidth - appWidth - 10, left));
            top = Math.max(10, Math.min(window.innerHeight - appHeight - 10, top));

            const targetPosition = foundry.utils.mergeObject(position, {
                left,
                top,
                width: 'auto', // Let CSS control the width via ems
                height: 'auto'
            });

            // Clear bottom styling since we are using absolute top/left
            el.style.bottom = '';

            return super.setPosition(targetPosition);
        }
    }
}
