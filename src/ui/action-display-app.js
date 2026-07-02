import { actionDisplay } from '../action-display.js';
import { log } from '../lib/logger.js';
import { MODULE_ID } from '../constants.js';
import { HUDTabColumn } from './hud-tab-column.js';
import { HUDTab } from './hud-tab.js';
import { ContextMenu } from '../lib/compat.js';

// Cache to persist tab states per actor across HUD rebuilds
const activeTabCache = new Map();

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
        this.actions = [];
        
        const cached = activeTabCache.get(this.actor?.uuid);

        // Encapsulated tab side state managers
        this.leftTabs = new HUDTabColumn({
            side: 'left',
            cached: cached?.left,
            getDefaultSubTypes: () => actionDisplay.activeSystemAdapter?.getDefaultActiveLeftSubTypes() ?? []
        });

        this.rightTabs = new HUDTabColumn({
            side: 'right',
            cached: cached?.right,
            getDefaultSubTypes: () => actionDisplay.activeSystemAdapter?.getDefaultActiveSubTypes() ?? []
        });

        // HUD Attachment/Position Mode (persisted client-side)
        this.positionMode = game.settings.get(MODULE_ID, 'hudPositionMode');
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
        this.actions = []; // Reset actions array to release references
        
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
                template: `${path}/templates/action-display.html`,
                scrollable: ['.bad-tab-content']
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
            if (action.itemTypes?.length) {
                existingItemCombinations.add(action.itemTypes.join('/'));
            }

            if (action.tabs) {
                for (const tab of action.tabs) {
                    existingCombinations.add(tab.path);
                }
            }
        }

        // Always ensure 'hidden' tab is present if we are currently viewing it,
        // even if it is empty, to prevent jarring automatic tab switches when unhiding the last item.
        if (this.leftTabs.activeParents.has('hidden')) {
            existingItemCombinations.add('hidden');
        }

        // 2. Build the left-side hierarchy dynamically using the adapter
        const leftGroups = {};
        
        // Always ensure 'all' parent is present if we have actions
        if (rawActions.length > 0) {
            leftGroups['all'] = new HUDTab({
                id: 'all',
                label: adapter.getItemTypeLabel('all'),
                icon: adapter.getItemTypeIcon('all'),
                active: this.leftTabs.activeParents.has('all'),
                expanded: this.leftTabs.activeParents.has('all'),
                activeParent: false,
                subTabs: []
            });
        }

        for (const combo of existingItemCombinations) {
            const parts = combo.split('/');
            const parentId = parts[0];
            const subId = parts[1]; // might be undefined (spell level)

            if (!leftGroups[parentId]) {
                const isActive = this.leftTabs.activeParents.has(parentId);
                leftGroups[parentId] = new HUDTab({
                    id: parentId,
                    label: adapter.getItemTypeLabel(parentId),
                    icon: adapter.getItemTypeIcon(parentId),
                    active: isActive,
                    expanded: isActive,
                    activeParent: false, // Will compute post-loop
                    subTabs: []
                });
            }

            if (subId) {
                const isActive = this.leftTabs.activeParents.has(parentId);
                const isSubActive = this.leftTabs.activeSubTypes.has(subId);
                leftGroups[parentId].addSubTab({
                    id: subId,
                    label: adapter.getItemSubTabLabel(parentId, subId),
                    active: isActive && isSubActive
                });
            }
        }

        // Convert to array and sort by system adapter order
        const itemTypes = Object.values(leftGroups);
        itemTypes.sort((a, b) => adapter.getItemTypeSortOrder(a.id) - adapter.getItemTypeSortOrder(b.id));

        // Post-process leftGroups to set active, expanded, and activeParent, and sort sub-tabs
        for (const parent of itemTypes) {
            const validSubIds = new Set(parent.subTabs.map(t => t.id));
            const activeSubsForParent = Array.from(this.leftTabs.activeSubTypes).filter(id => validSubIds.has(id));
            
            parent.active = this.leftTabs.activeParents.has(parent.id);
            if (parent.subTabs.length > 0 && parent.active && activeSubsForParent.length > 0) {
                parent.activeParent = true;
            }
            parent.expanded = parent.id === this.leftTabs.focusedParent || activeSubsForParent.length > 0;
            
            if (parent.subTabs.length > 0) {
                parent.subTabs.sort((a, b) => adapter.getItemSubTabSortOrder(parent.id, a.id) - adapter.getItemSubTabSortOrder(parent.id, b.id));
            }
        }

        // Cache leftGroups on the instance for use in event handlers/action rolling
        this.leftGroups = leftGroups;

        // Prune active left sub-tabs that are no longer available in any active parent
        this.leftTabs.prune(leftGroups);

        // If no active left parent type is available, default to 'all'
        if (itemTypes.length && !itemTypes.some(p => this.leftTabs.activeParents.has(p.id))) {
            this.leftTabs.resetToDefault();
            const allTab = itemTypes.find(t => t.id === 'all');
            if (allTab) {
                allTab.active = true;
                allTab.expanded = true;
            }
        }

        // 3. Build the right-side hierarchy dynamically using the adapter
        const parentGroups = {};
        
        // Always ensure 'all' parent is present if we have actions
        if (rawActions.length > 0) {
            parentGroups['all'] = new HUDTab({
                id: 'all',
                label: adapter.getActionTypeLabel('all'),
                icon: adapter.getActionTypeIcon('all'),
                active: this.rightTabs.activeParents.has('all'),
                expanded: this.rightTabs.activeParents.has('all'),
                activeParent: false,
                subTabs: []
            });
        }

        for (const combo of existingCombinations) {
            const parts = combo.split('/');
            const parentId = parts[0];
            const subId = parts[1]; // might be undefined

            if (!parentGroups[parentId]) {
                const isActive = this.rightTabs.activeParents.has(parentId);
                parentGroups[parentId] = new HUDTab({
                    id: parentId,
                    label: adapter.getActionTypeLabel(parentId),
                    icon: adapter.getActionTypeIcon(parentId),
                    active: isActive,
                    expanded: isActive,
                    activeParent: false, // Will compute post-loop
                    subTabs: []
                });
            }

            if (subId) {
                const isActive = this.rightTabs.activeParents.has(parentId);
                const isSubActive = this.rightTabs.activeSubTypes.has(subId);
                const isComponents = parentId === 'components';
                parentGroups[parentId].addSubTab({
                    id: subId,
                    label: adapter.getActionSubTabLabel(subId),
                    active: !isComponents && isActive && isSubActive,
                    excluded: isComponents && isActive && isSubActive
                });
            }
        }

        // Convert to array and sort by system adapter order
        const actionTypes = Object.values(parentGroups);
        actionTypes.sort((a, b) => adapter.getActionTypeSortOrder(a.id) - adapter.getActionTypeSortOrder(b.id));

        // Sort sub-tabs within each parent using system adapter order
        for (const parent of actionTypes) {
            const skipAll = ['components'].includes(parent.id);
            
            if (parent.subTabs.length > 0 && !skipAll) {
                const isActive = parent.id === this.rightTabs.focusedParent;
                const validSubIds = new Set(parent.subTabs.map(t => t.id));
                const activeSubsForParent = Array.from(this.rightTabs.activeSubTypes).filter(id => validSubIds.has(id));

                parent.addSubTab({
                    id: 'all',
                    label: adapter.getActionSubTabLabel('all'),
                    active: isActive && activeSubsForParent.length === 0
                });
                parent.subTabs.sort((a, b) => adapter.getActionSubTabSortOrder(parent.id, a.id) - adapter.getActionSubTabSortOrder(parent.id, b.id));
            }
        }

        // Post-process parentGroups to set active, expanded, and activeParent
        for (const parent of actionTypes) {
            if (parent.id === 'components') continue; // Exclude components from activeParent calculation
            const validSubIds = new Set(parent.subTabs.map(t => t.id));
            const activeSubsForParent = Array.from(this.rightTabs.activeSubTypes).filter(id => validSubIds.has(id));
            
            parent.active = this.rightTabs.activeParents.has(parent.id);
            if (parent.subTabs.length > 0 && parent.active && activeSubsForParent.length > 0) {
                parent.activeParent = true;
            }
            parent.expanded = parent.id === this.rightTabs.focusedParent || activeSubsForParent.length > 0;
        }

        // Cache parentGroups on the instance for use in event handlers/action rolling
        this.parentGroups = parentGroups;

        // Prune active sub-tabs that are no longer available in any active parent
        this.rightTabs.prune(parentGroups);

        // If no active parent type is available, default to 'all'
        if (actionTypes.length && !actionTypes.some(p => this.rightTabs.activeParents.has(p.id))) {
            this.rightTabs.resetToDefault();
            const allTab = actionTypes.find(t => t.id === 'all');
            if (allTab) {
                allTab.active = true;
                allTab.expanded = true;
            }
        }

        // 4. Filter actions based on state
        const visibleActions = rawActions.filter(action => this._matchesFilters(action));

        context.itemTypes = itemTypes;
        context.actionTypes = actionTypes;
        context.items = visibleActions;
        context.isAttached = this.isAttached;
        context.filterNoResources = game.settings.get(MODULE_ID, 'filterNoResources');

        // Delegate to system adapter to allow system-specific context modifications
        adapter?.modifyContext?.(context, this);

        return context;
    }

    /**
     * Helper method to evaluate if an action card matches current left and right tab filter selections.
     * 
     * @param {Object} action The action card to evaluate
     * @returns {boolean} True if the action card should be rendered
     * @private
     */
    _matchesFilters(action) {
        if (!action) return false;

        // Hidden Filter: If 'hidden' tab is selected, ONLY show actions that have action.isHidden === true
        const isHiddenActive = this.leftTabs.activeParents.has('hidden');
        if (isHiddenActive) {
            return action.isHidden === true;
        } else if (action.isHidden === true) {
            return false; // Hide hidden actions from all other tabs
        }

        // Filter by Left Side (Item Type)
        if (!action.itemTypes || !Array.isArray(action.itemTypes)) return false;
        
        const matchesLeft = action.itemTypes.some(type => {
            if (this.leftTabs.activeParents.has(type)) {
                const parentGroup = this.leftGroups?.[type];
                const validSubIds = parentGroup ? new Set(parentGroup.subTabs.map(t => t.id)) : new Set();
                const activeSubsForParent = Array.from(this.leftTabs.activeSubTypes).filter(id => validSubIds.has(id));
                
                if (activeSubsForParent.length === 0) {
                    return true;
                } else {
                    const actionSubId = action.itemTypes[1];
                    return this.leftTabs.activeSubTypes.has(actionSubId);
                }
            }
            
            if (this.leftTabs.activeParents.has('all')) {
                const isParentActive = this.leftTabs.activeParents.has(type);
                if (!isParentActive) {
                    return true;
                } else {
                    const parentGroup = this.leftGroups?.[type];
                    const validSubIds = parentGroup ? new Set(parentGroup.subTabs.map(t => t.id)) : new Set();
                    const activeSubsForParent = Array.from(this.leftTabs.activeSubTypes).filter(id => validSubIds.has(id));
                    if (activeSubsForParent.length === 0) {
                        return true;
                    }
                }
            }
            
            return false;
        });

        if (!matchesLeft) return false;

        // Filter by Right Side (Action Type)
        if (!action.tabs) return false;

        // Spell Components Filter (restrictive AND-filter, only for spells)
        if (action.originalItem?.type === 'spell') {
            const isComponentsActive = this.rightTabs.activeParents.has('components');
            if (isComponentsActive) {
                const parentGroup = this.parentGroups?.['components'];
                const validSubIds = parentGroup ? new Set(parentGroup.subTabs.map(t => t.id)) : new Set();
                const activeCompSubs = Array.from(this.rightTabs.activeSubTypes).filter(id => validSubIds.has(id));
                
                if (activeCompSubs.length > 0) {
                    const spellCompSubs = new Set(
                        action.tabs
                            .filter(tab => tab.root === 'components')
                            .map(tab => tab.label)
                    );
                    const hasBannedComponent = Array.from(spellCompSubs).some(comp => activeCompSubs.includes(comp));
                    if (hasBannedComponent) return false;
                }
            }
        }

        // Check if we have any active economy/time parents
        const activeEconomyParents = Array.from(this.rightTabs.activeParents).filter(p => p !== 'components' && p !== 'all');
        
        let matchesRight = true;
        if (activeEconomyParents.length > 0 || this.rightTabs.activeParents.has('all')) {
            matchesRight = action.tabs.some(tab => {
                const actionParentId = tab.root;
                const actionSubId = tab.parent ? tab.label : undefined;

                // Ignore components parent in the OR-filter
                if (actionParentId === 'components') return false;

                let matchesParent = false;
                
                // 1. Direct parent match
                if (this.rightTabs.activeParents.has(actionParentId)) {
                    const parentGroup = this.parentGroups?.[actionParentId];
                    const validSubIds = parentGroup ? new Set(parentGroup.subTabs.map(t => t.id)) : new Set();
                    const activeSubsForParent = Array.from(this.rightTabs.activeSubTypes).filter(id => validSubIds.has(id));
                    
                    if (activeSubsForParent.length === 0) {
                        matchesParent = true;
                    } else {
                        matchesParent = this.rightTabs.activeSubTypes.has(actionSubId);
                    }
                }
                
                // 2. 'all' parent match
                if (!matchesParent && this.rightTabs.activeParents.has('all')) {
                    const isParentActive = this.rightTabs.activeParents.has(actionParentId);
                    if (!isParentActive) {
                        matchesParent = true;
                    } else {
                        const parentGroup = this.parentGroups?.[actionParentId];
                        const validSubIds = parentGroup ? new Set(parentGroup.subTabs.map(t => t.id)) : new Set();
                        const activeSubsForParent = Array.from(this.rightTabs.activeSubTypes).filter(id => validSubIds.has(id));
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
        const tab = this.leftGroups?.[target.dataset.type];
        tab?.onLeftClick(this, this.leftTabs, this.leftGroups, event);
        this.render();
    }

    static async _onChangeLeftSubItemType(event, target) {
        event.preventDefault();
        this._clearMenuState();
        const parentGroup = target.closest('.bad-left-tab-group');
        const parentId = parentGroup?.querySelector('.bad-left-tab')?.dataset.type;
        const subTab = this.leftGroups?.[parentId]?.getSubTab(target.dataset.type);
        subTab?.onLeftClick(this, this.leftTabs, this.leftGroups, event);
        this.render();
    }

    _onToggleLeftParent(parentId) {
        const tab = this.leftGroups?.[parentId];
        tab?.onRightClick(this, this.leftTabs, this.leftGroups);
        this.render();
    }

    _onToggleLeftSub(target, type) {
        const parentGroup = target.closest('.bad-left-tab-group');
        const parentId = parentGroup?.querySelector('.bad-left-tab')?.dataset.type;
        const subTab = this.leftGroups?.[parentId]?.getSubTab(type);
        subTab?.onRightClick(this, this.leftTabs, this.leftGroups);
        this.render();
    }

    static async _onChangeActionType(event, target) {
        event.preventDefault();
        this._clearMenuState();
        const tab = this.parentGroups?.[target.dataset.type];
        tab?.onLeftClick(this, this.rightTabs, this.parentGroups, event);
        this.render();
    }

    static async _onChangeSubActionType(event, target) {
        event.preventDefault();
        this._clearMenuState();
        const parentGroup = target.closest('.bad-right-tab-group');
        const parentId = parentGroup?.querySelector('.bad-right-tab')?.dataset.type;
        const subTab = this.parentGroups?.[parentId]?.getSubTab(target.dataset.type);
        subTab?.onLeftClick(this, this.rightTabs, this.parentGroups, event);
        this.render();
    }

    _onToggleRightParent(parentId) {
        const tab = this.parentGroups?.[parentId];
        tab?.onRightClick(this, this.rightTabs, this.parentGroups);
        this.render();
    }

    _onToggleRightSub(target, type) {
        const parentGroup = target.closest('.bad-right-tab-group');
        const parentId = parentGroup?.querySelector('.bad-right-tab')?.dataset.type;
        const subTab = this.parentGroups?.[parentId]?.getSubTab(type);
        subTab?.onRightClick(this, this.rightTabs, this.parentGroups);
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
        const action = this.actions?.find(a => a.id === actionId);
        
        if (action) {
            const itemActivities = action.activities;
            if (itemActivities && itemActivities.length > 0) {
                // Filter sub-actions to only those that match the currently active right-side tabs
                const activeParents = this.rightTabs.activeParents;
                const activeSubs = this.rightTabs.activeSubTypes;
                const filterNoResources = game.settings.get(MODULE_ID, 'filterNoResources');

                const activeEconomyParents = Array.from(activeParents).filter(p => p !== 'components' && p !== 'all');

                const qualifyingSubActions = itemActivities.filter(sub => {
                    const tab = sub.tabs;
                    const actionParentId = tab.root;
                    const actionSubId = tab.parent ? tab.label : undefined;

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

                const showDropdown = qualifyingSubActions.length > 1 || (itemActivities.length > 1 && qualifyingSubActions.length === 1);

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
                    const container = this.element.querySelector('.bakana-action-display-container') ?? this.element;
                    menu = new ContextMenu.implementation(container, null, menuItems, options);
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
                    itemActivities[0].roll(event);
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
        const container = this.element.querySelector('.bakana-action-display-container');
        const leftTabs = this.element.querySelector('.bad-left-tabs');
        const rightTabs = this.element.querySelector('.bad-right-tabs');

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
        
        const targetItem = event.target.closest('.bad-action-item, .bad-left-sub-tab, .bad-left-tab');
        const activeItem = this._activeMenuTarget?.closest('.bad-action-item, .bad-left-sub-tab, .bad-left-tab') ?? this._activeMenuTarget;
        
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



        const targetItem = event.target.closest('.bad-action-item, .bad-left-sub-tab, .bad-left-tab');
        const activeItem = this._activeMenuTarget?.closest('.bad-action-item, .bad-left-sub-tab, .bad-left-tab') ?? this._activeMenuTarget;
        
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
                    const action = this.actions?.find(a => a.id === el.dataset.actionId);
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
                    const action = this.actions?.find(a => a.id === el.dataset.actionId);
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

        return new ContextMenu.implementation(this.element, ".bad-action-item", menuItems, options);
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

        const action = this.actions?.find(a => a.id === actionId);
        if (!action) return;

        const itemId = action.originalItem?.id ?? action.id;
        const hiddenItems = this.actor.getFlag(MODULE_ID, 'hiddenItems') ?? [];
        
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
            const appWidth = this._width ?? (el.offsetWidth || 320 * scale);

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
            const appWidth = this._width ?? (el.offsetWidth || 320 * scale);
            const appHeight = this._height ?? (el.offsetHeight || 200 * scale);
            
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
