import { adapter } from '../adapters/index.js';
import { actionDisplay } from '../action-display.js';
import { log } from '../lib/logger.js';
import { MODULE_ID } from '../constants.js';
import { HUDTabColumn } from './hud-tab-column.js';
import { HUDTab } from './hud-tab.js';
import { createActionContextMenu } from './app/context-menu-manager.js';
import { showActivityDropdown } from './app/dropdown-manager.js';
import { ControlBarManager } from './app/control-bar-manager.js';
import { categorizeActions } from '../categorization/categorization-manager.js';
import { syncActorFavorites } from '../favorites/favorites-manager.js';
import { setExplicitlyClosedTokenId } from '../module.js';

// Cache to persist tab states per actor across HUD rebuilds
const activeTabCache = new Map();
let lastActiveTabState = null;

/**
 * Modern ApplicationV2-based HUD overlay for Bakana's Action Display.
 * Uses HandlebarsApplicationMixin for rendering and the Actions API for event handling.
 * Positions itself dynamically relative to the selected token, or floats freely if detached.
 * Supports dragging and persists its position and attachment state.
 */
export class ActionDisplayApp extends adapter.foundry.HandlebarsApplicationMixin(adapter.foundry.ApplicationV2) {
    // #region Application Initialization & Lifecycle

    /**
     * Active HUD application instances.
     * @type {Set<ActionDisplayApp>}
     */
    static instances = new Set();

    /**
     * Default page for newly opened HUDs (internal module setting, resets on reload).
     * Delegates to actionDisplay.defaultPage.
     * @type {number}
     */
    static get defaultPage() {
        return actionDisplay.defaultPage;
    }

    static set defaultPage(val) {
        actionDisplay.defaultPage = val;
    }

    /**
     * Update the active page for all cached HUD states (in-memory, active instances, and persisted settings).
     * Also updates the internal defaultPage module setting for newly opened HUDs.
     * @param {number} targetPage Target page number
     * @param {ActionDisplayApp|null} [callerInstance=null] The instance initiating the change
     */
    static setAllCachedHUDsPage(targetPage, callerInstance = null) {
        const parsed = parseInt(targetPage, 10);
        const page = (!isNaN(parsed) && parsed > 0) ? parsed : 1;

        // 0. Update internal defaultPage module setting for newly opened HUDs
        ActionDisplayApp.defaultPage = page;

        // 1. Update in-memory active tab cache entries
        for (const [key, state] of activeTabCache.entries()) {
            if (state && typeof state === 'object') {
                state.activePage = page;
            }
        }

        // 2. Update the lastActiveTabState fallback
        if (lastActiveTabState && typeof lastActiveTabState === 'object') {
            lastActiveTabState.activePage = page;
        }

        // 3. Update any active/open HUD instances
        for (const instance of ActionDisplayApp.instances) {
            const maxPage = instance.totalPages ?? page;
            instance.activePage = Math.min(Math.max(1, page), maxPage);
            if (instance !== callerInstance && instance.rendered) {
                instance.render();
            }
        }

        // 4. Update persisted tab states in client settings if enabled
        let persistEnabled = false;
        try {
            persistEnabled = Boolean(game.settings?.get?.(MODULE_ID, 'persistTabState'));
        } catch {
            persistEnabled = false;
        }

        if (persistEnabled) {
            try {
                const rawStates = game.settings.get(MODULE_ID, 'hudTabStates');
                const allStates = (rawStates && typeof rawStates === 'object')
                    ? adapter.foundry.duplicate(rawStates)
                    : {};
                for (const state of Object.values(allStates)) {
                    if (state && typeof state === 'object') {
                        state.activePage = page;
                    }
                }
                game.settings.set(MODULE_ID, 'hudTabStates', allStates);
            } catch (err) {
                log.error("Failed to update persisted tab states for all cached HUDs:", err);
            }
        }
    }

    /**
     * Retrieve the in-memory active tab cache map (for inspection or testing).
     * @returns {Map<string, Object>}
     */
    static getActiveTabCache() {
        return activeTabCache;
    }

    /**
     * Clear all cached tab and HUD states across memory, instances, and settings.
     */
    static clearTabCache() {
        activeTabCache.clear();
        lastActiveTabState = null;
        ActionDisplayApp.instances.clear();
        ActionDisplayApp.defaultPage = 1;
    }

    constructor(token, options = {}) {
        super(options);
        ActionDisplayApp.instances.add(this);
        this.token = token;
        this.actor = token?.actor;
        this.actions = [];
        this.totalPages = 1;

        const actorKey = this.actor?.uuid ?? this.actor?.id;
        const hasActorCache = Boolean(activeTabCache.has(actorKey) || (actorKey && game.settings.get(MODULE_ID, 'persistTabState') && game.settings.get(MODULE_ID, 'hudTabStates')?.[actorKey]));
        const cached = this.retrieveActorTabCache(actorKey);
        const parsedPage = Number((hasActorCache ? cached?.activePage : null) ?? ActionDisplayApp.defaultPage);
        this.activePage = (!isNaN(parsedPage) && parsedPage > 0) ? parsedPage : ActionDisplayApp.defaultPage;
        this._cachedPages = cached?.pages ?? {
            '1-left': cached?.left,
            '1-right': cached?.right
        };
        this._tabColumns = {};

        // HUD Attachment State (true = attached to token, false = detached floating)
        this.isAttached = Boolean(game.settings.get(MODULE_ID, 'isAttached') ?? true);

        // Dragging state
        this._dragData = null;

        // Search filtering state
        this.searchQuery = '';
        this._isSearching = false;
        this._searchSelectionStart = null;
        this._searchSelectionEnd = null;

        // Bind listeners once for event delegation and capture phases to prevent GC churn
        this._boundOnPointerDownCapture = this._onPointerDownCapture.bind(this);
        this._boundOnContextMenuCapture = this._onContextMenuCapture.bind(this);
        this._onDragStart = this._onDragStart.bind(this);
        this._onDragMove = this._onDragMove.bind(this);
        this._onDragEnd = this._onDragEnd.bind(this);

        // Item summary tooltip state and bound listeners
        this._hoveredActionItem = null;
        this._isQuestionMarkHeld = false;
        this._activeSummaryTooltip = null;
        this._boundOnPointerOver = this._onPointerOver.bind(this);
        this._boundOnPointerOut = this._onPointerOut.bind(this);
        this._boundOnKeyDown = this._onKeyDown.bind(this);
        this._boundOnKeyUp = this._onKeyUp.bind(this);
        this._boundOnWindowBlur = this._onWindowBlur.bind(this);
        this._boundOnWheel = this._onWheel.bind(this);
        this._boundOnWindowWheel = this._onWindowWheel.bind(this);
        this._boundOnAutobanPointerOverCapture = this._onAutobanPointerOverCapture.bind(this);
        this._lockedTooltipTarget = null;
        this._boundOnMiddleClickCapture = this._onMiddleClickCapture.bind(this);
        this._boundOnAuxClickCapture = this._onAuxClickCapture.bind(this);
    }

    /**
     * Retrieve or initialize a HUDTabColumn instance for a given side and page number.
     * @param {'left'|'right'} side Left or right side identifier
     * @param {number} [page=this.activePage] Page number
     * @returns {HUDTabColumn}
     */
    getTabColumn(side, page = this.activePage) {
        const parsedPage = Number(page ?? 1);
        const pageNum = (!isNaN(parsedPage) && parsedPage > 0) ? parsedPage : 1;
        if (!this._tabColumns) this._tabColumns = {};
        const key = `${pageNum}-${side}`;
        if (!this._tabColumns[key]) {
            this._tabColumns[key] = new HUDTabColumn({
                side,
                defaultParent: 'all',
                cached: this._cachedPages?.[key],
                getDefaultSubTypes: () => {
                    return side === 'left'
                        ? adapter.getDefaultActiveLeftSubTypes()
                        : adapter.getDefaultActiveSubTypes();
                }
            });
        }
        return this._tabColumns[key];
    }

    /**
     * Active left-side HUDTabColumn for the current active page.
     * @type {HUDTabColumn}
     */
    get leftTabs() {
        return this.getTabColumn('left', this.activePage);
    }

    /**
     * Active right-side HUDTabColumn for the current active page.
     * @type {HUDTabColumn}
     */
    get rightTabs() {
        return this.getTabColumn('right', this.activePage);
    }

    /**
     * Ensure at least one tab is active in the column, falling back to 'all'.
     * @param {HUDTab[]} tabs
     * @param {HUDTabColumn} column
     * @private
     */
    _ensureDefaultTab(tabs, column) {
        if (tabs.length && !tabs.some(p => column.activeParents.has(p.id))) {
            column.resetToDefault();
            const allTab = tabs.find(t => t.id === 'all');
            if (allTab) {
                allTab.active = true;
                allTab.expanded = true;
            }
        }
    }

    /**
     * Resolve the combatant associated with the current HUD token/actor.
     * @param {Combat} [combat=game.combat]
     * @returns {Combatant|null}
     * @private
     */
    _getCombatant(combat = game.combat) {
        if (!combat) return null;
        return adapter.foundry.getCombatantByToken(combat, this.token)
            ?? (this.actor ? combat.combatants?.find?.(c => c.actorId === this.actor.id) : null)
            ?? this.actor?.combatant
            ?? null;
    }

    /**
     * Helper to toggle a boolean setting and re-render the HUD.
     * @param {string} settingKey
     * @param {Event} [event]
     * @param {HTMLElement} [target]
     * @returns {Promise<boolean>} The new boolean setting value
     * @protected
     */
    async _toggleBooleanSetting(settingKey, event, target) {
        event?.preventDefault?.();
        target?.blur?.();
        const current = Boolean(game.settings.get(MODULE_ID, settingKey));
        const next = target?.checked ?? !current;
        await game.settings.set(MODULE_ID, settingKey, next);
        await this.render();
        return next;
    }

    /**
     * Navigate to the previous HUD page and re-render.
     * @param {Object} [options={}]
     * @param {boolean} [options.shiftKey=false] Whether shift was held to update all cached HUDs
     */
    previousPage({ shiftKey = false } = {}) {
        const parsed = Number(this.activePage);
        const current = (!isNaN(parsed) && parsed > 0) ? parsed : 1;
        if (this.totalPages <= 1) {
            this.activePage = 1;
        } else if (current <= 1) {
            this.activePage = this.totalPages;
        } else {
            this.activePage = current - 1;
        }
        this._saveTabState();
        if (shiftKey) {
            ActionDisplayApp.setAllCachedHUDsPage(this.activePage, this);
        }
        this.render();
    }

    /**
     * Navigate to the next HUD page and re-render.
     * @param {Object} [options={}]
     * @param {boolean} [options.shiftKey=false] Whether shift was held to update all cached HUDs
     */
    nextPage({ shiftKey = false } = {}) {
        const parsed = Number(this.activePage);
        const current = (!isNaN(parsed) && parsed > 0) ? parsed : 1;
        if (this.totalPages <= 1) {
            this.activePage = 1;
        } else if (current >= this.totalPages) {
            this.activePage = 1;
        } else {
            this.activePage = current + 1;
        }
        this._saveTabState();
        if (shiftKey) {
            ActionDisplayApp.setAllCachedHUDsPage(this.activePage, this);
        }
        this.render();
    }

    /**
     * Navigate to a specific HUD page number and re-render.
     * @param {number} targetPage Target page number
     * @param {Object} [options={}]
     * @param {boolean} [options.shiftKey=false] Whether shift was held to update all cached HUDs
     */
    changePage(targetPage, { shiftKey = false } = {}) {
        const parsed = Number(targetPage);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= this.totalPages) {
            const pageChanged = parsed !== this.activePage;
            this.activePage = parsed;
            this._saveTabState();
            if (shiftKey) {
                ActionDisplayApp.setAllCachedHUDsPage(parsed, this);
            }
            if (pageChanged) {
                this.render();
            }
        }
    }

    /**
     * Is the HUD in detached (floating) mode?
     * @type {boolean}
     */
    get isDetached() {
        return !this.isAttached;
    }

    /**
     * Is the HUD tracking token position (attached mode)?
     * @type {boolean}
     */
    get isTracked() {
        return this.isAttached;
    }

    // #endregion

    // #region Application Context & Rendering

    /**
     * Save active tab states for this actor to in-memory cache and client setting if enabled.
     * Capped to at most 25 most-recently-used actors using LRU pruning.
     */
    _saveTabState() {
        const actorKey = this.actor?.uuid ?? this.actor?.id;

        if (!this._cachedPages) this._cachedPages = {};
        this._cachedPages[`${this.activePage}-left`] = this.leftTabs.serialize();
        this._cachedPages[`${this.activePage}-right`] = this.rightTabs.serialize();

        const serialized = {
            activePage: this.activePage,
            left: this.leftTabs.serialize(),
            right: this.rightTabs.serialize(),
            pages: this._cachedPages
        };

        // Track most recent active tab selections for seamless actor switching
        lastActiveTabState = {
            activePage: ActionDisplayApp.defaultPage,
            left: this.leftTabs.serialize(),
            right: this.rightTabs.serialize(),
            pages: this._cachedPages
        };

        if (!actorKey) return;

        // Always update in-memory cache for fast session lookups
        activeTabCache.set(actorKey, serialized);

        // Persist client-side across refreshes if enabled (capped at 25 actors)
        if (game.settings.get(MODULE_ID, 'persistTabState')) {
            try {
                const MAX_PERSISTED_ACTORS = 25;
                const rawStates = game.settings.get(MODULE_ID, 'hudTabStates');
                const allStates = (rawStates && typeof rawStates === 'object')
                    ? adapter.foundry.duplicate(rawStates)
                    : {};

                // Re-insert key to refresh its LRU position (most recent at end)
                delete allStates[actorKey];
                allStates[actorKey] = serialized;

                // Enforce LRU cap of 25 actors by pruning oldest entries from front
                const keys = Object.keys(allStates);
                if (keys.length > MAX_PERSISTED_ACTORS) {
                    const toPrune = keys.slice(0, keys.length - MAX_PERSISTED_ACTORS);
                    for (const key of toPrune) {
                        delete allStates[key];
                    }
                }

                game.settings.set(MODULE_ID, 'hudTabStates', allStates);
            } catch (err) {
                log.error("Failed to save persisted tab state:", err);
            }
        }
    }

    /**
     * Retrieve active tab states for this actor from in-memory cache or client setting.
     */
    retrieveActorTabCache(actorKey) {
        let cached = activeTabCache.get(actorKey);
        if (!cached && game.settings.get(MODULE_ID, 'persistTabState')) {
            const rawStates = game.settings.get(MODULE_ID, 'hudTabStates');
            const allStates = (rawStates && typeof rawStates === 'object') ? rawStates : {};
            cached = (actorKey ? allStates[actorKey] : null) ?? (lastActiveTabState ? { ...lastActiveTabState } : null);
            if (cached && actorKey) {
                activeTabCache.set(actorKey, cached);
            }
        } else if (!cached && lastActiveTabState) {
            cached = { ...lastActiveTabState };
        }
        return cached;
    }

    /**
     * Close the application, logging the transition.
     */
    async close(options = {}) {
        // Hide the element instantly to prevent any default close animations/transitions
        // from causing visual glitches (like shifting and covering the token).
        if (this.element) {
            this.element.style.display = 'none';
        }

        // Clean up menu states and close any open dropdowns/context menus to prevent visual leaks
        this._clearMenuState({ force: true });
        if (this._boundOutsidePointerDown) {
            window.removeEventListener('pointerdown', this._boundOutsidePointerDown, { capture: true });
        }
        if (this._boundWindowStackPointerDown) {
            window.removeEventListener('pointerdown', this._boundWindowStackPointerDown, { capture: true });
        }
        if (this._boundOnAutobanPointerOverCapture) {
            window.removeEventListener('pointerover', this._boundOnAutobanPointerOverCapture, { capture: true });
        }
        if (this._boundOnMiddleClickCapture) {
            window.removeEventListener('pointerdown', this._boundOnMiddleClickCapture, { capture: true });
        }
        if (this._boundOnAuxClickCapture) {
            window.removeEventListener('auxclick', this._boundOnAuxClickCapture, { capture: true });
        }
        this._closeLockedTooltips();
        this._lockedTooltipTarget = null;
        this._hideItemSummaryTooltip();
        if (this._boundOnKeyDown) {
            window.removeEventListener('keydown', this._boundOnKeyDown);
        }
        if (this._boundOnKeyUp) {
            window.removeEventListener('keyup', this._boundOnKeyUp);
        }
        if (this._boundOnWindowBlur) {
            window.removeEventListener('blur', this._boundOnWindowBlur);
        }
        if (this._boundOnWheel) {
            this.element?.removeEventListener?.('wheel', this._boundOnWheel, { passive: false });
        }
        if (this._boundOnWindowWheel) {
            window.removeEventListener('wheel', this._boundOnWindowWheel, { passive: false });
        }
        this._hoveredActionItem = null;
        this._isQuestionMarkHeld = false;
        this._contextMenu = null;
        this.actions = []; // Reset actions array to release references

        if (actionDisplay.activeApp === this) {
            actionDisplay.activeApp = null;
        }

        if (!options.switchingTokens && !options.hudClosing) {
            setExplicitlyClosedTokenId(this.token?.id ?? null);
        }

        ActionDisplayApp.instances.delete(this);
        const result = await super.close(options);
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
            changeLeftItemType: ActionDisplayApp.prototype._onChangeLeftItemType,
            changeLeftSubItemType: ActionDisplayApp.prototype._onChangeLeftSubItemType,
            changeActionType: ActionDisplayApp.prototype._onChangeActionType,
            changeSubActionType: ActionDisplayApp.prototype._onChangeSubActionType,
            toggleAnchor: ActionDisplayApp.prototype._onToggleAnchor,
            closeHUD: ActionDisplayApp.prototype._onCloseHUD,
            rollAction: ActionDisplayApp.prototype._onRollAction,
            toggleFilterResources: ActionDisplayApp.prototype._onToggleFilterResources,
            toggleCombatAutoTrack: ActionDisplayApp.prototype._onToggleCombatAutoTrack,
            toggleItemSummaries: ActionDisplayApp.prototype._onToggleItemSummaries,
            recenterToken: ActionDisplayApp.prototype._onRecenterToken,
            clearSearch: ActionDisplayApp.prototype._onClearSearch,
            rollInitiative: ActionDisplayApp.prototype._onRollInitiative,
            endCombatTurn: ActionDisplayApp.prototype._onEndCombatTurn,
            previousPage: ActionDisplayApp.prototype._onPreviousPage,
            nextPage: ActionDisplayApp.prototype._onNextPage,
            changePage: ActionDisplayApp.prototype._onChangePage,
            toggleInspiration: ActionDisplayApp.prototype._onToggleInspiration
        },
        // Declarative Context Actions API - maps data-context-action attributes to static right-click handlers
        contextActions: {
            toggleAutoCenter: ActionDisplayApp.prototype._onRightClickRecenterToken,
            toggleHUDPersistence: ActionDisplayApp.prototype._onRightClickToggleAnchor,
            toggleCombatAutoToggle: ActionDisplayApp.prototype._onRightClickCombatAutoTrack
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
        const allActions = await (actionDisplay.getActions ? actionDisplay.getActions(this.actor) : adapter.getActions(this.actor));
        this.actions = allActions; // Cache all processed actions for high-performance UI lookups
        this.totalPages = allActions.reduce((max, a) => Math.max(max, a.page ?? 1), 1);
        if (this.activePage > this.totalPages) {
            this.activePage = this.totalPages;
        }
        if (this.activePage < 1) {
            this.activePage = 1;
        }
        const rawActions = allActions.filter(a => (a.page ?? 1) === this.activePage);

        const existingItemCombinations = new Set();
        const existingCombinations = new Set();

        // 1. Single-pass loop: Extract unique tabs and filter actions simultaneously (O(N) vs O(3N))
        for (const action of rawActions) {
            const categories = action.itemCategories ?? (action.left?.length ? [action.left] : []);
            for (const cat of categories) {
                if (cat?.length) {
                    existingItemCombinations.add(cat.join('/'));
                }
            }

            if (action.right) {
                for (const tab of action.right) {
                    if (tab?.path) existingCombinations.add(tab.path);
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
            if (!combo) continue;
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
            const validSubIds = parent.getAllSubTabIds();
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
        this._ensureDefaultTab(itemTypes, this.leftTabs);

        // Update active tabs and filter state based on actor status
        if (this.actor) {
            adapter.updateTabs(this.actor, this.rightTabs);
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
            if (!combo) continue;
            const parts = combo.split('/');
            const parentId = parts[0];

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

            if (parts.length === 2) {
                const subId = parts[1];
                let subTab = parentGroups[parentId].subTabs.find(t => t.id === subId);
                const isActive = this.rightTabs.activeParents.has(parentId);
                const isSubActive = this.rightTabs.activeSubTypes.has(subId);
                const isExclusion = adapter.isExclusionTab(parentId);

                if (!subTab) {
                    parentGroups[parentId].addSubTab({
                        id: subId,
                        label: adapter.getActionSubTabLabel(subId),
                        active: !isExclusion && isActive && isSubActive,
                        excluded: isExclusion && isActive && isSubActive
                    });
                }
            } else if (parts.length >= 3) {
                const categoryId = parts[1];
                const subId = parts[2];
                let catTab = parentGroups[parentId].subTabs.find(t => t.id === categoryId);
                const isActive = this.rightTabs.activeParents.has(parentId);
                const isCatActive = this.rightTabs.activeSubTypes.has(categoryId);
                const isExclusion = adapter.isExclusionTab(parentId);

                if (!catTab) {
                    catTab = parentGroups[parentId].addSubTab({
                        id: categoryId,
                        label: adapter.getActionSubTabLabel(categoryId),
                        active: !isExclusion && isActive && isCatActive,
                        excluded: isExclusion && isActive && isCatActive
                    });
                }

                let subTab = catTab.subTabs.find(t => t.id === subId);
                if (!subTab) {
                    const isSubActive = this.rightTabs.activeSubTypes.has(subId);
                    catTab.addSubTab({
                        id: subId,
                        label: adapter.getActionSubTabLabel(subId),
                        active: !isExclusion && isActive && (isSubActive || isCatActive),
                        excluded: isExclusion && isActive && (isSubActive || isCatActive)
                    });
                }
            }
        }

        // Ensure all canonical sub-tabs exist for exclusion groups (e.g. vocal, somatic, material under components)
        const autoBanReasons = adapter.getAutoBanEffectReasons?.(this.actor) ?? {};
        for (const parent of Object.values(parentGroups)) {
            if (adapter.isExclusionTab(parent.id)) {
                const canonicalSubs = adapter.getExclusionSubTabs(parent.id);
                for (const subId of canonicalSubs) {
                    let subTab = parent.subTabs.find(t => t.id === subId);
                    const isActive = this.rightTabs.activeParents.has(parent.id);
                    const isSubActive = this.rightTabs.activeSubTypes.has(subId);
                    const isExcluded = isActive && isSubActive;

                    const subReasons = autoBanReasons[subId] ?? [];
                    const subTooltip = (isExcluded && subReasons.length > 0)
                        ? (await adapter.formatAutoBanTooltip?.(subId, subReasons)) ?? ''
                        : '';

                    if (!subTab) {
                        parent.addSubTab({
                            id: subId,
                            label: adapter.getActionSubTabLabel(subId),
                            active: false,
                            excluded: isExcluded,
                            tooltip: subTooltip
                        });
                    } else if (subTooltip) {
                        subTab.tooltip = subTooltip;
                    }
                }

                if (parent.id === 'components') {
                    const activeAutoBans = {};
                    for (const [comp, reasons] of Object.entries(autoBanReasons)) {
                        if (this.rightTabs.activeSubTypes.has(comp) && reasons?.length > 0) {
                            activeAutoBans[comp] = reasons;
                        }
                    }
                    if (Object.keys(activeAutoBans).length > 0) {
                        parent.tooltip = (await adapter.formatAutoBanTooltip?.('components', activeAutoBans)) ?? '';
                    }
                }
            }
        }

        // Convert to array and sort by system adapter order
        const actionTypes = Object.values(parentGroups);
        actionTypes.sort((a, b) => adapter.getActionTypeSortOrder(a.id) - adapter.getActionTypeSortOrder(b.id));

        // Sort sub-tabs within each parent using system adapter order
        for (const parent of actionTypes) {
            const skipAll = adapter.isExclusionTab(parent.id);

            if (parent.subTabs.length > 0) {
                if (!skipAll) {
                    const isActive = parent.id === this.rightTabs.focusedParent;
                    const validSubIds = parent.getAllSubTabIds();
                    const activeSubsForParent = Array.from(this.rightTabs.activeSubTypes).filter(id => validSubIds.has(id));

                    parent.addSubTab({
                        id: 'all',
                        label: adapter.getActionSubTabLabel('all'),
                        active: isActive && activeSubsForParent.length === 0
                    });
                }

                parent.subTabs.sort((a, b) => adapter.getActionSubTabSortOrder(parent.id, a.id) - adapter.getActionSubTabSortOrder(parent.id, b.id));

                for (const sub of parent.subTabs) {
                    if (sub.subTabs.length > 0) {
                        sub.subTabs.sort((a, b) => adapter.getActionSubTabSortOrder(sub.id, a.id) - adapter.getActionSubTabSortOrder(sub.id, b.id));
                    }
                }
            }
        }

        // Post-process parentGroups to set active, expanded, and activeParent
        for (const parent of actionTypes) {
            const isExclusion = adapter.isExclusionTab(parent.id);
            const validSubIds = parent.getAllSubTabIds();
            const activeSubsForParent = Array.from(this.rightTabs.activeSubTypes).filter(id => validSubIds.has(id));

            parent.active = this.rightTabs.activeParents.has(parent.id);
            if (!isExclusion && parent.subTabs.length > 0 && parent.active && activeSubsForParent.length > 0) {
                parent.activeParent = true;
            }
            parent.expanded = parent.id === this.rightTabs.focusedParent || activeSubsForParent.length > 0;
        }

        // Cache parentGroups on the instance for use in event handlers/action rolling
        this.parentGroups = parentGroups;

        // Prune active sub-tabs that are no longer available in any active parent
        this.rightTabs.prune(parentGroups, id => adapter.isExclusionTab(id));

        // If no active parent type is available, default to 'all'
        this._ensureDefaultTab(actionTypes, this.rightTabs);

        // 4. Extract action economy indicators and filter actions based on state & search query
        const showEconomyIndicators = Boolean(game.settings.get(MODULE_ID, 'enableEconomyIndicators'));
        context.showEconomyIndicators = showEconomyIndicators;

        if (showEconomyIndicators) {
            const userColors = game.settings.get(MODULE_ID, 'economyColors') ?? {};
            for (const action of rawActions) {
                action.economyIndicators = adapter.extractEconomyIndicators(action, userColors);
            }
        } else {
            for (const action of rawActions) {
                action.economyIndicators = [];
            }
        }

        let visibleActions = [];
        log.group(`ActionDisplayApp._prepareContext | Filtering actions for "${this.actor?.name ?? 'Actor'}"`, 'debug');
        try {
            const query = (this.searchQuery ?? '').trim().toLowerCase();
            visibleActions = rawActions.filter(action => {
                if (!this._matchesFilters(action)) return false;
                if (!query) return true;
                const matchesQuery = this._matchesSearchQuery(action, query);
                if (!matchesQuery) {
                    log.debug(`ActionDisplayApp._prepareContext | Skipping action "${action.name}" (${action.id}) — does not match search query "${query}"`);
                    return false;
                }
                return true;
            });
            visibleActions.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
            this.displayedActions = visibleActions;
        } finally {
            log.groupEnd();
        }

        context.itemTypes = itemTypes;
        context.actionTypes = actionTypes;
        context.items = visibleActions;
        context.layout = 'flat'; // Default layout template mode
        context.isAttached = this.isAttached;
        context.isDetached = this.isDetached;
        context.showDepleted = game.settings.get(MODULE_ID, 'showDepleted') ?? false;
        context.showItemSummaries = game.settings.get(MODULE_ID, 'showItemSummaries') ?? false;
        context.showTooltips = Boolean(game.settings.get(MODULE_ID, 'showTooltips'));
        context.enableCenterOnToken = game.settings.get(MODULE_ID, 'enableCenterOnToken') ?? false;
        context.autoCenterOnToken = Boolean(game.settings.get(MODULE_ID, 'autoCenterOnToken'));
        context.persistHUD = Boolean(game.settings.get(MODULE_ID, 'persistHUD'));
        context.enableItemSummaryButton = game.settings.get(MODULE_ID, 'enableItemSummaryButton') ?? false;
        context.enableCombatAutoTrackButton = game.settings.get(MODULE_ID, 'enableCombatAutoTrackButton') ?? false;
        context.autoTrackCombat = game.settings.get(MODULE_ID, 'autoTrackCombat') ?? false;
        context.autoToggleCombat = game.settings.get(MODULE_ID, 'autoToggleCombat') ?? false;
        context.searchQuery = this.searchQuery ?? '';

        // Synchronize favorites if system supports them and user is owner
        if (this.actor?.isOwner) {
            syncActorFavorites(this.actor);
        }

        // Apply categorization if enabled or if page defaults to categorized
        const pageConfig = adapter.getPageConfig(this.activePage, this.actor);
        const rawCatConfig = game.settings.get(MODULE_ID, 'categorizationConfig');
        const isCategorizationEnabled = Boolean(rawCatConfig?.enabled);
        const useCategorization = isCategorizationEnabled || pageConfig?.defaultLayout === 'categorized';

        if (useCategorization) {
            const rawCategories = pageConfig?.categories ?? adapter.getDefaultCategories() ?? [];
            const fallbackCategories = pageConfig?.categories ? rawCategories : rawCategories.map(cat => ({ ...cat, subcategories: [] }));
            const catConfig = isCategorizationEnabled ? rawCatConfig : { enabled: true, categories: fallbackCategories };
            const othersLabel = game.i18n?.localize?.('BAD.categorization.others') ?? 'Other Actions';
            context.isCategorized = true;
            context.categorizedSections = categorizeActions(visibleActions, catConfig, othersLabel, {
                actor: this.actor,
                token: this.token,
                user: game.user
            }) ?? [];
            context.layout = 'categorized';
        } else {
            context.isCategorized = false;
            context.categorizedSections = null;
            context.layout = (pageConfig?.defaultLayout === 'tokenInfo' || pageConfig?.defaultLayout === 'info')
                ? 'tokenInfo'
                : (pageConfig?.defaultLayout ?? 'flat');
        }

        const parsedActivePage = Number(this.activePage);
        const currentActivePage = (!isNaN(parsedActivePage) && parsedActivePage > 0) ? parsedActivePage : 1;
        const pages = [];
        for (let i = 1; i <= this.totalPages; i++) {
            pages.push({
                page: i,
                active: i === currentActivePage
            });
        }
        context.pages = pages;
        context.activePage = currentActivePage;
        context.totalPages = this.totalPages;
        context.hasMultiplePages = this.totalPages > 1;

        // Check if the current actor / token is in combat and if combat action buttons should be shown
        const enableCombatButtons = Boolean(game.settings.get(MODULE_ID, 'enableCombatButtons'));

        let showRollInitiativeButton = false;
        let showEndTurnButton = false;
        let isCurrentCombatant = false;

        if (enableCombatButtons) {
            const combat = game.combat;
            const combatant = this._getCombatant(combat);

            if (combatant) {
                const canInteract = Boolean(this.actor?.isOwner || this.token?.document?.isOwner || game.user?.isGM);
                if (canInteract) {
                    const needsInitiative = combatant.initiative === null || combatant.initiative === undefined;
                    showRollInitiativeButton = needsInitiative;

                    if (!needsInitiative && combat.started) {
                        const currentCombatant = combat.combatant;
                        if (currentCombatant) {
                            const isTokenMatch = Boolean(this.token && (currentCombatant.token === this.token || currentCombatant.token?.id === this.token.id || currentCombatant.tokenId === this.token.id));
                            const isActorMatch = Boolean(this.actor && (currentCombatant.actor === this.actor || currentCombatant.actor?.id === this.actor.id || currentCombatant.actorId === this.actor.id));
                            isCurrentCombatant = isTokenMatch || isActorMatch;
                        }
                        showEndTurnButton = isCurrentCombatant;
                    }
                }
            }
        }

        context.enableCombatButtons = enableCombatButtons;
        context.showRollInitiativeButton = showRollInitiativeButton;
        context.showEndTurnButton = showEndTurnButton;
        context.isCurrentCombatant = showEndTurnButton || isCurrentCombatant;

        // Delegate to system adapter to allow system-specific context modifications and layout selection
        await adapter?.modifyContext?.(context, this);

        // Save serialized tab selections for active actor
        this._saveTabState();

        // Standardize control bar button models for declarative UI rendering
        context.controlButtons = ControlBarManager.prepareControlButtons(context, this.isAttached);

        return context;
    }

    // #endregion

    // #region Internal Filtering Logic

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
            if (!action.isHidden) {
                log.debug(`ActionDisplayApp._matchesFilters | Skipping action "${action.name}" (${action.id}) — "hidden" tab is active and action is not hidden`);
                return false;
            }
            return true;
        } else if (action.isHidden) {
            log.debug(`ActionDisplayApp._matchesFilters | Skipping action "${action.name}" (${action.id}) — action is hidden`);
            return false;
        }

        // Filter by Left Side (Item Type)
        const categories = action.itemCategories ?? (action.left?.length ? [action.left] : []);
        if (categories.length === 0) {
            log.debug(`ActionDisplayApp._matchesFilters | Skipping action "${action.name}" (${action.id}) — action has no categories or left tab properties`);
            return false;
        }

        const matchesLeft = categories.some(leftSub => {
            return leftSub.some(type => {
                if (this.leftTabs.activeParents.has(type)) {
                    const parentGroup = this.leftGroups?.[type];
                    const validSubIds = parentGroup?.getAllSubTabIds?.() ?? new Set();
                    const activeSubsForParent = Array.from(this.leftTabs.activeSubTypes).filter(id => validSubIds.has(id));

                    if (activeSubsForParent.length === 0 || activeSubsForParent.includes('all')) {
                        return true;
                    } else {
                        const actionSubId = leftSub[1];
                        return this.leftTabs.activeSubTypes.has(actionSubId);
                    }
                }

                if (this.leftTabs.activeParents.has('all')) {
                    const isParentActive = this.leftTabs.activeParents.has(type);
                    if (!isParentActive) {
                        return true;
                    } else {
                        const parentGroup = this.leftGroups?.[type];
                        const validSubIds = parentGroup?.getAllSubTabIds?.() ?? new Set();
                        const activeSubsForParent = Array.from(this.leftTabs.activeSubTypes).filter(id => validSubIds.has(id));
                        if (activeSubsForParent.length === 0 || activeSubsForParent.includes('all')) {
                            return true;
                        }
                    }
                }

                return false;
            });
        });

        if (!matchesLeft) {
            const activeLeft = Array.from(this.leftTabs.activeParents).join(', ');
            const activeLeftSubs = Array.from(this.leftTabs.activeSubTypes).join(', ');
            log.debug(`ActionDisplayApp._matchesFilters | Skipping action "${action.name}" (${action.id}) — does not match active left tabs (parents: [${activeLeft}], sub-types: [${activeLeftSubs}])`);
            return false;
        }

        // Filter by Right Side (Action Type & Economy Tabs)
        if (!action.right || action.right.length === 0) {
            log.debug(`ActionDisplayApp._matchesFilters | Skipping action "${action.name}" (${action.id}) — action has no right tab properties`);
            return false;
        }

        const filterContext = this._getFilterContext();
        const matchesEconomy = adapter.matchesEconomyTabs(action, filterContext);
        if (!matchesEconomy) {
            const activeRight = Array.from(this.rightTabs.activeParents).join(', ');
            const activeRightSubs = Array.from(this.rightTabs.activeSubTypes).join(', ');
            log.debug(`ActionDisplayApp._matchesFilters | Skipping action "${action.name}" (${action.id}) — does not match active right economy tabs (parents: [${activeRight}], sub-types: [${activeRightSubs}]):`, { action });
            return false;
        }

        return true;
    }

    /**
     * Helper method to evaluate if an action matches the active text search query.
     * @param {Object} action The action to evaluate
     * @param {string} query Lowercase search query string
     * @returns {boolean} True if matching
     * @private
     */
    _matchesSearchQuery(action, query) {
        if (!action || !query) return true;
        if (action.name?.toLowerCase().includes(query)) return true;
        if (action.originalItem?.name?.toLowerCase().includes(query)) return true;
        if (action.subactions?.some(sub => sub.name?.toLowerCase().includes(query))) return true;
        return false;
    }

    /**
     * Build the standard HUD filter context object containing active left/right tab states and settings.
     * @returns {Object} Structured filter context { left, right, filterNoResources }
     * @private
     */
    _getFilterContext() {
        return {
            actor: this.actor,
            token: this.token,
            left: {
                activeParents: this.leftTabs.activeParents,
                activeSubTypes: this.leftTabs.activeSubTypes,
                groups: this.leftGroups
            },
            right: {
                activeParents: this.rightTabs.activeParents,
                activeSubTypes: this.rightTabs.activeSubTypes,
                groups: this.parentGroups
            },
            showDepleted: game.settings.get(MODULE_ID, 'showDepleted') ?? false
        };
    }

    // #endregion

    // #region User Interaction Events & Helpers

    /* -------------------------------------------- */
    /*  Actions Handlers                            */
    /* -------------------------------------------- */

    /**
     * Unified handler for parent tab click interactions.
     * @private
     */
    _handleParentTabClick(side, target, event) {
        event?.preventDefault?.();
        this._clearMenuState({ force: true });
        const isLeft = side === 'left';
        const column = isLeft ? this.leftTabs : this.rightTabs;
        const groups = isLeft ? this.leftGroups : this.parentGroups;
        const clickedId = target?.dataset?.type;

        if (event?.shiftKey) {
            this._handleParentTabToggle(side, clickedId);
            return;
        }
        const tab = groups?.[clickedId];
        tab?.onLeftClick(this, column, groups, event);
        this.render();
    }

    /**
     * Unified handler for parent tab toggle interactions.
     * @private
     */
    _handleParentTabToggle(side, parentId) {
        const isLeft = side === 'left';
        const column = isLeft ? this.leftTabs : this.rightTabs;
        const groups = isLeft ? this.leftGroups : this.parentGroups;
        const tab = groups?.[parentId];
        tab?.onRightClick(this, column, groups);
        this.render();
    }

    /**
     * Unified handler for sub-tab click interactions.
     * @private
     */
    _handleSubTabClick(side, target, event) {
        event?.preventDefault?.();
        this._clearMenuState({ force: true });
        const isLeft = side === 'left';
        const column = isLeft ? this.leftTabs : this.rightTabs;
        const groups = isLeft ? this.leftGroups : this.parentGroups;
        const groupSelector = isLeft ? '.bad-left-tab-group' : '.bad-right-tab-group';
        const parentSelector = isLeft ? '.bad-left-tab' : '.bad-right-tab';

        const parentGroup = target?.closest?.(groupSelector);
        const parentId = parentGroup?.querySelector(parentSelector)?.dataset?.type;
        const subId = target?.dataset?.type;

        if (event?.shiftKey) {
            this._handleSubTabToggle(side, target, subId);
            return;
        }

        const subTab = groups?.[parentId]?.getSubTab(subId);
        subTab?.onLeftClick(this, column, groups, event);
        if (!isLeft && this.actor && parentId) {
            adapter.recordManualTabToggle(this.actor, parentId, subId, column.activeSubTypes.has(subId));
        }
        this.render();
    }

    /**
     * Unified handler for sub-tab toggle interactions.
     * @private
     */
    _handleSubTabToggle(side, target, subId) {
        const isLeft = side === 'left';
        const column = isLeft ? this.leftTabs : this.rightTabs;
        const groups = isLeft ? this.leftGroups : this.parentGroups;
        const groupSelector = isLeft ? '.bad-left-tab-group' : '.bad-right-tab-group';
        const parentSelector = isLeft ? '.bad-left-tab' : '.bad-right-tab';

        const parentGroup = target?.closest?.(groupSelector);
        const parentId = parentGroup?.querySelector(parentSelector)?.dataset?.type;
        const subTab = groups?.[parentId]?.getSubTab(subId);
        subTab?.onRightClick(this, column, groups);
        if (!isLeft && this.actor && parentId) {
            adapter.recordManualTabToggle(this.actor, parentId, subId, column.activeSubTypes.has(subId));
        }
        this.render();
    }

    _onChangeLeftItemType(event, target) { return this._handleParentTabClick('left', target, event); }
    _onChangeLeftSubItemType(event, target) { return this._handleSubTabClick('left', target, event); }
    _onToggleLeftParent(parentId) { return this._handleParentTabToggle('left', parentId); }
    _onToggleLeftSub(target, type) { return this._handleSubTabToggle('left', target, type); }
    _onChangeActionType(event, target) { return this._handleParentTabClick('right', target, event); }
    _onChangeSubActionType(event, target) { return this._handleSubTabClick('right', target, event); }
    _onToggleRightParent(parentId) { return this._handleParentTabToggle('right', parentId); }
    _onToggleRightSub(target, type) { return this._handleSubTabToggle('right', target, type); }

    /**
     * Toggle between Attached (dynamic token tracking) and Detached (floating) modes.
     */
    async _onToggleAnchor(event, target) {
        event.preventDefault();
        const el = this.element;

        this.isAttached = !this.isAttached;

        if (!this.isAttached && el) {
            const rect = el.getBoundingClientRect();
            const pos = { left: rect.left, top: rect.top };
            await game.settings.set(MODULE_ID, 'hudDetachedPosition', pos);
        }

        await game.settings.set(MODULE_ID, 'isAttached', this.isAttached);
        this.render();
    }

    /**
     * Right-click handler on the Anchor/Pin button.
     * Toggles HUD persistence across outside left-clicks.
     * When toggled off, the HUD closes if you left click outside the HUD.
     * When toggled on, the HUD stays open until you right click on the token or otherwise close it.
     * @param {Event} [event] Triggering event
     * @param {HTMLElement} [target] Triggering element
     */
    async _onRightClickToggleAnchor(event, target) {
        return this._toggleBooleanSetting('persistHUD', event, target);
    }

    /**
     * Handle close button click on the HUD.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    async _onCloseHUD(event, target) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        await this.close();
    }

    /**
     * Handle previous page button click.
     * @param {Event} event Click event
     * @param {HTMLElement} target Clicked element
     */
    async _onPreviousPage(event, target) {
        event.preventDefault();
        this._clearMenuState({ force: true });
        this.previousPage({ shiftKey: Boolean(event?.shiftKey) });
    }

    /**
     * Handle next page button click.
     * @param {Event} event Click event
     * @param {HTMLElement} target Clicked element
     */
    async _onNextPage(event, target) {
        event.preventDefault();
        this._clearMenuState({ force: true });
        this.nextPage({ shiftKey: Boolean(event?.shiftKey) });
    }

    /**
     * Handle specific page number selection click.
     * @param {Event} event Click event
     * @param {HTMLElement} target Clicked element
     */
    async _onChangePage(event, target) {
        event.preventDefault();
        this._clearMenuState({ force: true });
        const targetPage = Number(target?.dataset?.page ?? 1);
        this.changePage(targetPage, { shiftKey: Boolean(event?.shiftKey) });
    }

    /**
     * Handle action item clicks to roll them.
     * @param {Event} event Click event
     * @param {HTMLElement} target Clicked element
     */
    async _onRollAction(event, target) {
        event.preventDefault();

        if (this._preventReopen) {
            this._preventReopen = false;
            this._clearMenuState({ force: true });
            return;
        }

        this._closeLockedTooltips();

        // Close any existing open menu state before rolling or opening dropdown
        this._clearMenuState({ force: true });

        const actionId = target.dataset.actionId;
        const action = (this.displayedActions ?? this.actions)?.find(a => a.id === actionId);

        if (action) {
            const item = action.originalItem ?? action;
            const actor = this.actor;
            const token = this.token;
            const user = game.user;
            log.debug(`_onRollAction | Left-clicked action "${action.name}" (${action.id}):`, { action, item, actor, token, user });
            const itemActivities = action.subactions;

            if (itemActivities?.length > 0) {
                // Filter sub-actions to only those that match the currently active right-side tabs
                const filterContext = this._getFilterContext();
                log.group(`ActionDisplayApp._onRollAction | Filtering activities for "${action.name}" (${action.id})`, 'debug');
                let qualifyingSubActions;
                try {
                    qualifyingSubActions = adapter.system.filterSubactions(itemActivities, filterContext, action.left);
                } finally {
                    log.groupEnd();
                }

                const subsToShow = qualifyingSubActions.length > 0 ? qualifyingSubActions : itemActivities;
                const showDropdown = subsToShow.length > 1 || (!action.collapseDropdownIfSingle && itemActivities.length > 1 && subsToShow.length === 1);

                if (showDropdown) {
                    this._showActivityDropdown(target, subsToShow, event, action);
                } else if (subsToShow.length === 1) {
                    const chosenSub = subsToShow[0];
                    const chosenItem = chosenSub.originalItem ?? action.originalItem;
                    if (itemActivities.length > 1) {
                        log.debug(`ActionDisplayApp._onRollAction | Auto-rolling single qualifying activity "${chosenSub.name}" (${chosenSub.id}) on "${action.name}" — ${itemActivities.length - 1} other activities filtered out`);
                    }
                    log.debug(`_onRollAction | Rolling subaction "${chosenSub.name}":`, { action: chosenSub, item: chosenItem, actor, token, user });
                    chosenSub.roll(event);
                } else {
                    log.debug(`_onRollAction | Rolling action "${action.name}":`, { action, item, actor, token, user });
                    action.roll(event);
                }
            } else {
                // No sub-actions: roll directly
                log.debug(`_onRollAction | Rolling action "${action.name}":`, { action, item, actor, token, user });
                action.roll(event);
            }
        }
    }

    /**
     * Show the activity dropdown menu for an action with multiple subactions.
     * @param {HTMLElement} target The target action DOM element
     * @param {Action[]} subactions List of subactions to display
     * @param {Event} event The triggering click event
     * @param {Object} [parentAction=null] Optional parent action card object
     * @private
     */
    _showActivityDropdown(target, subactions, event, parentAction = null) {
        showActivityDropdown(this, target, subactions, event, parentAction);
    }

    /**
     * Toggle the "Show Depleted Items" setting.
     */
    async _onToggleFilterResources(event, target) {
        return this._toggleBooleanSetting('showDepleted', event, target);
    }

    /**
     * Toggle the "Auto-Track Combat Turn" setting.
     * When toggled on during active combat, immediately switches the HUD to the current combatant if permitted.
     */
    async _onToggleCombatAutoTrack(event, target) {
        event?.preventDefault?.();
        target?.blur?.();
        const current = Boolean(game.settings.get(MODULE_ID, 'autoTrackCombat'));
        const next = target?.checked ?? !current;
        await game.settings.set(MODULE_ID, 'autoTrackCombat', next);

        if (next) {
            const combat = game.combat;
            if (combat?.started && combat.combatant) {
                const token = adapter.foundry.getTokenFromCombatant(combat.combatant);

                if (token && adapter.foundry.isUserInCharge(token)) {
                    adapter.foundry.selectToken(token);
                    const isCenterEnabled = Boolean(game.settings.get(MODULE_ID, 'enableCenterOnToken'));
                    const isAutoCenterActive = isCenterEnabled && Boolean(game.settings.get(MODULE_ID, 'autoCenterOnToken'));
                    if (isAutoCenterActive) {
                        adapter.foundry.centerCanvasOnToken(token);
                    }
                    if (this.token !== token && this.token?.id !== token.id) {
                        if (this.element) {
                            this.element.style.display = 'none';
                        }
                        this.close();
                        actionDisplay.activeApp = null;

                        if (token.actor) {
                            syncActorFavorites(token.actor);
                        }
                        const newApp = new ActionDisplayApp(token);
                        actionDisplay.activeApp = newApp;
                        newApp.render(true);
                        return;
                    }
                }
            }
        }
        await this.render();
    }

    /**
     * Right-click handler on the Combat Auto-Track (sword) button.
     * Toggles the "Auto-Toggle Combat Turn Visibility" setting.
     * Enabling or disabling the feature does not close the HUD; transitions occur on combat turn changes.
     * @param {Event} [event] Triggering event
     * @param {HTMLElement} [target] Triggering element
     */
    async _onRightClickCombatAutoTrack(event, target) {
        return this._toggleBooleanSetting('autoToggleCombat', event, target);
    }

    /**
     * Toggle the "Show Item Summaries" setting.
     */
    async _onToggleItemSummaries(event, target) {
        const next = await this._toggleBooleanSetting('showItemSummaries', event, target);
        if (next) {
            if (this._hoveredActionItem) {
                await this._showItemSummaryTooltip(this._hoveredActionItem);
            }
        } else if (!this._isQuestionMarkHeld) {
            this._hideItemSummaryTooltip();
        }
    }

    /**
     * Recenter the canvas view on the current combatant (or active HUD token).
     * Does not change auto-center state.
     * @param {Event} [event] Triggering event
     * @param {HTMLElement} [target] Triggering element
     */
    async _onRecenterToken(event, target) {
        event?.preventDefault?.();
        const combatToken = adapter.foundry.getTokenFromCombatant(game.combat?.combatant);
        const targetToken = combatToken ?? this.token;
        if (targetToken) {
            await adapter.foundry.centerCanvasOnToken(targetToken);
        }
    }

    /**
     * Right-click handler on the Recenter (crosshairs) button.
     * Toggles automatic canvas centering on tokens the user is in charge of.
     * @param {Event} [event] Triggering event
     * @param {HTMLElement} [target] Triggering element
     */
    async _onRightClickRecenterToken(event, target) {
        const next = await this._toggleBooleanSetting('autoCenterOnToken', event, target);
        if (next) {
            const isCenterEnabled = Boolean(game.settings.get(MODULE_ID, 'enableCenterOnToken'));
            if (isCenterEnabled) {
                const combat = game.combat;
                if (combat?.started && combat.combatant) {
                    const token = adapter.foundry.getTokenFromCombatant(combat.combatant);
                    if (token && adapter.foundry.isUserInCharge(token)) {
                        await adapter.foundry.centerCanvasOnToken(token);
                    }
                }
            }
        }
        return next;
    }

    /**
     * Clear the search filter query and re-render.
     */
    _onClearSearch(event, target) {
        this.searchQuery = '';
        this._isSearching = false;
        this.render();
    }

    /**
     * Roll initiative for the active token/actor in combat.
     * @param {PointerEvent} event Triggering click event
     * @param {HTMLElement} target Target button element
     * @protected
     */
    async _onRollInitiative(event, target) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const combat = game.combat;
        if (!combat) return;

        const combatant = this._getCombatant(combat);
        if (!combatant) return;
        log.info(`Rolling initiative for "${this.actor?.name ?? 'Token'}" (Combatant ID: ${combatant.id})`);
        try {
            await combat.rollInitiative([combatant.id]);
        } catch (err) {
            log.error("Failed to roll initiative:", err);
        }
    }

    /**
     * Advance the combat tracker to the next turn when the End Turn button is clicked.
     * @param {PointerEvent} event Triggering click event
     * @param {HTMLElement} target Target button element
     * @protected
     */
    async _onEndCombatTurn(event, target) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const combat = game.combat;
        if (!combat || !combat.started) return;
        log.info(`Ending combat turn for "${this.actor?.name ?? 'Token'}" (Token ID: ${this.token?.id})`);
        try {
            await combat.nextTurn();
        } catch (err) {
            log.error("Failed to advance combat turn:", err);
        }
    }

    /**
     * Toggle inspiration on the currently active actor when the inspiration element is clicked.
     * @param {PointerEvent} event Triggering click event
     * @param {HTMLElement} target Target button element
     * @protected
     */
    async _onToggleInspiration(event, target) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!this.actor) return;

        const canModify = this.actor.canUserModify?.(game.user, 'update') ?? this.actor.isOwner ?? game.user?.isGM;
        if (!canModify) {
            log.warn(`ActionDisplayApp._onToggleInspiration | User "${game.user?.name}" lacks permission to update actor "${this.actor.name}"`);
            return;
        }

        try {
            const nextState = await adapter.toggleInspiration(this.actor);
            log.info(`ActionDisplayApp._onToggleInspiration | Toggled inspiration for "${this.actor.name}": ${nextState}`);
        } catch (err) {
            log.error(`ActionDisplayApp._onToggleInspiration | Failed to toggle inspiration for "${this.actor.name}":`, err);
        }
    }

    /**
     * Attach input listeners to the search input field for real-time filtering.
     * @private
     */
    _attachSearchListeners() {
        const searchInput = this.element?.querySelector('.bad-search-input');
        if (!searchInput) return;

        searchInput.addEventListener('input', (event) => {
            const query = event.target.value ?? '';
            this.searchQuery = query;
            this._searchSelectionStart = event.target.selectionStart;
            this._searchSelectionEnd = event.target.selectionEnd;
            this._isSearching = true;
            this.render();
        });

        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.searchQuery = '';
                this._isSearching = false;
                this.render();
            }
        });
    }

    /**
     * Restore input focus and cursor selection range to the search input after re-render.
     * @private
     */
    _restoreSearchFocus() {
        if (!this._isSearching || !this.element) return;
        const searchInput = this.element.querySelector('.bad-search-input');
        if (searchInput) {
            searchInput.focus();
            if (this._searchSelectionStart !== null && this._searchSelectionEnd !== null) {
                searchInput.setSelectionRange(this._searchSelectionStart, this._searchSelectionEnd);
            }
        }
        this._isSearching = false;
    }



    /* -------------------------------------------- */
    /*  Positioning & Dragging                      */
    /* -------------------------------------------- */

    /**
     * Hook into the first render to set up permanent event listeners and context menus.
     */
    _onFirstRender(context, options) {
        super._onFirstRender(context, options);

        // Prevent clicks inside the HUD from bubbling up to the canvas/document, and auto-blur action buttons immediately
        this.element.addEventListener('click', (event) => {
            const actionBtn = event.target?.closest?.('button[data-action], a[data-action]');
            if (actionBtn) {
                actionBtn.blur?.();
            }
            event.stopPropagation();
        });

        // Intercept right-click pointerdown and contextmenu events in the capture phase to support toggling the menu off
        this.element.addEventListener('pointerdown', this._boundOnPointerDownCapture, { capture: true });
        this.element.addEventListener('contextmenu', this._boundOnContextMenuCapture, { capture: true });

        // Event Delegation for Dragging: attach mousedown to the outer element and filter by the handle
        this.element.addEventListener('mousedown', (event) => {
            const handle = event.target.closest('.bad-drag-handle');
            if (handle) this._onDragStart(event);
        });

        // Close dropdown when dragging or clicking outside the active menu/item
        this._boundOutsidePointerDown = (event) => {
            // While the tooltip is focused/locked or the user is interacting with it (e.g. scrollbar), keep the context menu open
            if (this.isTooltipFocused || this._isInsideTooltip(event?.target)) {
                return;
            }

            const activeTarget = this._activeContextMenuTarget ?? this._activeMenuTarget;
            const clickedInsideMenu = Boolean(event.target?.closest?.('#context-menu, .context-menu'));
            const clickedActiveItem = Boolean(activeTarget && event.target?.closest?.('.bad-action-item') === activeTarget);

            if ((this._activeLeftClickMenu || this._activeContextMenuTarget || this._activeMenuTarget) && !clickedInsideMenu && !clickedActiveItem) {
                this._clearMenuState();
            }
        };
        window.addEventListener('pointerdown', this._boundOutsidePointerDown, { capture: true });

        // Window Stacking Management:
        // Ensure that whichever window (our HUD or any other Foundry sheet/dialog) was interacted with most recently is placed on top.
        this.bringToFront();
        this._boundWindowStackPointerDown = (event) => {
            if (!this.element) return;
            const targetWindow = event.target?.closest?.('.window-app, .application, .app, .dialog, .sidebar-popout');
            if (!targetWindow) return;

            if (targetWindow === this.element || this.element.contains(targetWindow)) {
                this.bringToFront();
            } else {
                if (targetWindow.closest?.('#context-menu, .context-menu, .bad-item-summary-tooltip')) return;
                const hudZ = parseInt(this.element.style?.zIndex, 10) || 100;
                const targetZ = parseInt(targetWindow.style?.zIndex, 10) || 0;
                if (targetZ <= hudZ) {
                    const newZ = hudZ + 1;
                    targetWindow.style.zIndex = `${newZ}`;
                }
            }
        };
        window.addEventListener('pointerdown', this._boundWindowStackPointerDown, { capture: true });

        // Intercept pointerover on enriched content-links inside autoban tooltips to prevent preview popups unless focused/locked
        window.addEventListener('pointerover', this._boundOnAutobanPointerOverCapture, { capture: true });

        // Intercept middle-click on tabs and elements to enforce single-focus tooltip discipline
        window.addEventListener('pointerdown', this._boundOnMiddleClickCapture, { capture: true });
        window.addEventListener('auxclick', this._boundOnAuxClickCapture, { capture: true });

        // Attach item summary tooltip event listeners
        this.element.addEventListener('pointerover', this._boundOnPointerOver);
        this.element.addEventListener('pointerout', this._boundOnPointerOut);

        window.addEventListener('keydown', this._boundOnKeyDown);
        window.addEventListener('keyup', this._boundOnKeyUp);
        window.addEventListener('blur', this._boundOnWindowBlur);

        this.element.addEventListener('wheel', this._boundOnWheel, { passive: false });
        window.addEventListener('wheel', this._boundOnWindowWheel, { passive: false });

        // Initialize the context menu for action items once
        this._contextMenu = this._createContextMenu();
    }

    /**
     * Bring this application to the front of the z-index stack (ApplicationV2 standard).
     * Computes the maximum z-index across all open windows and applications in the DOM.
     * @returns {number} The newly assigned z-index
     */
    bringToFront() {
        if (!this.element) return 100;

        // Delegate to super.bringToFront() if available on ApplicationV2
        try {
            super.bringToFront?.();
        } catch (_) {}

        // Query open application windows in the DOM to calculate highest active z-index
        let maxZ = 100;
        const currentZ = parseInt(this.element.style?.zIndex, 10);
        if (!isNaN(currentZ)) maxZ = Math.max(maxZ, currentZ);

        if (typeof document !== 'undefined' && document.querySelectorAll) {
            const windows = document.querySelectorAll('.window-app, .application, .app, .dialog, .sidebar-popout');
            for (const win of windows) {
                if (win === this.element) continue;
                const rawZ = win.style?.zIndex ?? (typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(win)?.zIndex : null);
                const z = parseInt(rawZ, 10);
                if (!isNaN(z) && z < 900000) { // Keep below context menus (999999) and tooltips (1000001)
                    maxZ = Math.max(maxZ, z);
                }
            }
        }

        const newZ = maxZ + 1;
        if (this.element.style) {
            this.element.style.zIndex = `${newZ}`;
        }
        return newZ;
    }

    /**
     * Hook into the render lifecycle to position the element and measure its dimensions.
     */
    _onRender(context, options) {
        super._onRender(context, options);

        this._attachSearchListeners();
        this._restoreSearchFocus();

        // Synchronize tab widths so tabs of a given depth share the maximal length of that depth
        this._syncTabWidths();

        // Adjust min-height first so container dimensions reflect the full expanded layout
        this._adjustMinHeight();

        const container = this.element?.querySelector('.bakana-action-display-container');
        this._width = container?.offsetWidth ?? this.element.offsetWidth;
        this._height = container?.offsetHeight ?? this.element.offsetHeight;

        this.setPosition();
    }

    /**
     * Clear all active context menu and dropdown target styling and close any open menus.
     * @param {object} [options]
     * @param {boolean} [options.force=false] Force closing even if a tooltip is focused/locked
     */
    _clearMenuState(options = {}) {
        if (this.isTooltipFocused && !options.force) {
            return;
        }

        const activeContextTarget = this._activeContextMenuTarget;
        const activeMenuTarget = this._activeMenuTarget;
        const activeLeftMenu = this._activeLeftClickMenu;
        const contextMenu = this._contextMenu;

        this._activeContextMenuTarget = null;
        this._activeMenuTarget = null;
        this._activeLeftClickMenu = null;

        activeContextTarget?.classList?.remove?.('bad-menu-active');
        activeMenuTarget?.classList?.remove?.('bad-dropdown-active');

        this._hideItemSummaryTooltip();

        if (contextMenu) {
            try {
                contextMenu.close({ animate: false, force: true })?.catch?.(err => {
                    log.debug("ContextMenu.close promise rejected (expected during re-render):", err);
                });
            } catch (err) {
                log.debug("ContextMenu.close threw synchronously:", err);
            }
        }

        if (activeLeftMenu) {
            try {
                activeLeftMenu.close({ animate: false, force: true })?.catch?.(err => {
                    log.debug("LeftClickMenu.close promise rejected:", err);
                });
            } catch (err) {
                log.debug("LeftClickMenu.close threw synchronously:", err);
            }
        }

        // Clean up any lingering context-menu or sub-context-menu DOM elements
        const openMenus = document.querySelectorAll('#context-menu.bad-context-menu, .context-menu.bad-context-menu, .bad-sub-context-menu');
        openMenus.forEach(el => {
            el.classList?.remove?.('bad-context-menu');
            el.remove?.();
        });
        document.querySelectorAll('#context-menu.bad-context-menu, .context-menu.bad-context-menu').forEach(el => el.classList?.remove?.('bad-context-menu'));

        const container = this.element?.querySelector?.('.bakana-action-display-container');
        container?.classList?.remove?.('has-context-menu');
    }

    /* -------------------------------------------- */
    /*  Item Summary Tooltips                       */
    /* -------------------------------------------- */

    /**
     * Handle pointerover events on action items to track hovered element for tooltip.
     * @param {PointerEvent} event
     * @protected
     */
    _onPointerOver(event) {
        const itemEl = event.target?.closest?.('.bad-action-item');
        if (!itemEl) {
            if (this._hoveredActionItem) {
                this._hoveredActionItem = null;
                this._hideItemSummaryTooltip();
            }
            return;
        }
        if (itemEl !== this._hoveredActionItem) {
            this._hoveredActionItem = itemEl;
            const showSummaries = this._isQuestionMarkHeld || Boolean(game.settings.get(MODULE_ID, 'showItemSummaries'));
            if (showSummaries) {
                return this._showItemSummaryTooltip(itemEl);
            }
        }
    }

    /**
     * Handle pointerout events on action items to clear hovered state and hide tooltip.
     * @param {PointerEvent} event
     * @protected
     */
    _onPointerOut(event) {
        const itemEl = event.target?.closest?.('.bad-action-item');
        const relatedItemEl = event.relatedTarget?.closest?.('.bad-action-item');
        if (itemEl && itemEl !== relatedItemEl) {
            if (this._hoveredActionItem === itemEl) {
                this._hoveredActionItem = null;
                this._hideItemSummaryTooltip();
            }
        }

        // When leaving a tab (e.g. Verbal, Somatic, Components), close the tooltip immediately if not focused/locked
        const tabEl = event.target?.closest?.('.bad-right-tab, .bad-right-sub-tab, .bad-tab');
        const relatedTabEl = event.relatedTarget?.closest?.('.bad-right-tab, .bad-right-sub-tab, .bad-tab');
        if (tabEl && tabEl !== relatedTabEl) {
            if (!this.isTooltipFocused) {
                game.tooltip?.deactivate?.();
            }
        }
    }

    /**
     * Handle keydown events to detect when '?' (or Shift+/) is held down.
     * @param {KeyboardEvent} event
     * @protected
     */
    _onKeyDown(event) {
        if (!event) return;
        // Ignore when typing inside search inputs or textareas
        if (event.target?.tagName === 'INPUT' || event.target?.tagName === 'TEXTAREA') {
            return;
        }

        const isQuestionMark = event.key === '?' || (event.shiftKey && (event.code === 'Slash' || event.key === '/'));
        if (isQuestionMark) {
            this._isQuestionMarkHeld = true;
            if (this._hoveredActionItem && !this._activeSummaryTooltip) {
                return this._showItemSummaryTooltip(this._hoveredActionItem);
            }
        }
    }

    /**
     * Handle keyup events to release '?' tooltip mode.
     * @param {KeyboardEvent} event
     * @protected
     */
    _onKeyUp(event) {
        if (!event) return;
        const isRelease = event.key === '?' || event.key === 'Shift' || event.code === 'Slash' || event.key === '/' || !event.shiftKey;
        if (isRelease) {
            this._isQuestionMarkHeld = false;
            const showSummaries = Boolean(game.settings.get(MODULE_ID, 'showItemSummaries'));
            if (!showSummaries) {
                this._hideItemSummaryTooltip();
            }
        }
    }

    /**
     * Handle window blur to clear key hold state and hide tooltip.
     * @protected
     */
    _onWindowBlur() {
        this._isQuestionMarkHeld = false;
        const showSummaries = Boolean(game.settings.get(MODULE_ID, 'showItemSummaries'));
        if (!showSummaries) {
            this._hideItemSummaryTooltip();
        }
    }

    /**
     * Intercept pointerover on enriched content-links inside autoban tooltips.
     * Prevents Foundry from triggering preview tooltips on content-links unless the tooltip is focused/locked.
     * @param {PointerEvent} event
     * @protected
     */
    _onAutobanPointerOverCapture(event) {
        const link = event.target?.closest?.('.bad-autoban-tooltip .content-link');
        if (link && !this.isTooltipFocused) {
            event.stopImmediatePropagation?.();
            event.preventDefault?.();
        }
    }

    /**
     * Intercept middle-click (auxclick with button === 1) events in the capture phase.
     * Enforces single-focus discipline: if a tab tooltip is already focused/locked,
     * middle-clicking another tab will close the previous locked tooltip so two tabs
     * can never be focused simultaneously.
     * @param {MouseEvent} event
     * @protected
     */
    _onMiddleClickCapture(event) {
        if (event.button !== 1) return;

        // Check if middle-click is on or inside an already-locked tooltip
        const isInsideLockedTooltip = Boolean(event.target?.closest?.('.locked-tooltip, #tooltip.locked, aside#tooltip.locked, div#tooltip.locked, [data-tooltip-locked="true"]'));
        if (isInsideLockedTooltip) {
            this._closeLockedTooltips();
            game.tooltip?.deactivate?.();
            this._lockedTooltipTarget = null;
            event.stopImmediatePropagation?.();
            event.preventDefault?.();
            return;
        }

        // Check if middle-click is on a tab or tooltip-bearing element inside the HUD
        const tabTarget = event.target?.closest?.('.bad-right-tab, .bad-right-sub-tab, .bad-tab, .bad-action-item, [data-tooltip]');
        if (!tabTarget) return;

        // Stop browser default middle-click behaviors (auto-scroll/paste) and Foundry default handler
        event.stopImmediatePropagation?.();
        event.preventDefault?.();

        // 3. If this same tab is already the locked target, middle-clicking it toggles/dismisses the lock
        if (this.isTooltipFocused && this._lockedTooltipTarget === tabTarget) {
            this._closeLockedTooltips();
            game.tooltip?.deactivate?.();
            this._lockedTooltipTarget = null;
            return;
        }

        // 4. Verify that the target element actually has a non-empty tooltip
        const tooltipContent = tabTarget.getAttribute?.('data-tooltip') ?? tabTarget.dataset?.tooltip;
        if (!tooltipContent || !tooltipContent.trim()) {
            return;
        }

        // 5. Verify that Foundry TooltipManager is active or #tooltip has content
        const tooltipEl = document.querySelector?.('#tooltip, aside#tooltip, div#tooltip');
        const hasTooltipContent = Boolean(tooltipEl?.textContent?.trim() || tooltipEl?.children?.length);
        if (!game.tooltip?.active && !hasTooltipContent) {
            return;
        }

        // 6. If another tab or element was already locked/focused, close it before the new one locks
        if (this.isTooltipFocused) {
            this._closeLockedTooltips();
        }

        // 7. Lock the active tooltip for this tab
        if (game.tooltip?.lockTooltip) {
            try {
                game.tooltip.lockTooltip();
            } catch (_) {}
        } else if (game.tooltip) {
            game.tooltip.locked = true;
            document.querySelector?.('#tooltip')?.classList?.add?.('locked');
        }

        this._lockedTooltipTarget = tabTarget;
    }

    /**
     * Intercept auxclick events on HUD elements to prevent browser middle-click side-effects.
     * @param {MouseEvent} event
     * @protected
     */
    _onAuxClickCapture(event) {
        if (event.button !== 1) return;
        const isOurTarget = Boolean(event.target?.closest?.('.bad-right-tab, .bad-right-sub-tab, .bad-tab, .bad-action-item, [data-tooltip], .locked-tooltip, #tooltip.locked'));
        if (isOurTarget) {
            event.stopImmediatePropagation?.();
            event.preventDefault?.();
        }
    }

    /**
     * Close and dismiss any existing locked or focused tooltips across the DOM and Foundry TooltipManager.
     * @param {HTMLElement} [except] Optional tooltip element or target to exclude from closing
     * @protected
     */
    _closeLockedTooltips(except = null) {
        if (game.tooltip) {
            game.tooltip.locked = false;
        }

        const lockedSelectors = [
            '.locked-tooltip',
            'aside.locked-tooltip',
            'div.locked-tooltip',
            '.locked:not(#tooltip)',
            '[data-tooltip-locked="true"]:not(#tooltip)'
        ].join(', ');

        const lockedElements = document.querySelectorAll?.(lockedSelectors) ?? [];
        for (const el of lockedElements) {
            if (except && (el === except || el.contains?.(except))) continue;
            try {
                const closeBtn = el.querySelector?.('button.close, a.close, [data-action="close"], .close-button, i.fa-times, i.fa-xmark');
                if (closeBtn?.click) {
                    closeBtn.click();
                } else {
                    el.remove?.();
                }
            } catch (_) {
                el.remove?.();
            }
        }

        const primaryTooltip = document.querySelector?.('#tooltip, aside#tooltip, div#tooltip');
        if (primaryTooltip && primaryTooltip !== except) {
            primaryTooltip.classList?.remove?.('locked');
            if (primaryTooltip.dataset) {
                delete primaryTooltip.dataset.tooltipLocked;
            }
        }

        try {
            if (game.tooltip?.lockedTooltips) {
                if (game.tooltip.lockedTooltips instanceof Map) {
                    for (const [id, tooltip] of game.tooltip.lockedTooltips.entries()) {
                        if (except && tooltip === except) continue;
                        tooltip?.remove?.();
                        game.tooltip.lockedTooltips.delete(id);
                    }
                } else if (Array.isArray(game.tooltip.lockedTooltips) || game.tooltip.lockedTooltips instanceof Set) {
                    for (const tooltip of Array.from(game.tooltip.lockedTooltips)) {
                        if (except && tooltip === except) continue;
                        tooltip?.remove?.();
                    }
                    if (Array.isArray(game.tooltip.lockedTooltips)) {
                        game.tooltip.lockedTooltips.length = 0;
                    } else {
                        game.tooltip.lockedTooltips.clear?.();
                    }
                }
            }
        } catch (_) {}

        this._lockedTooltipTarget = null;
    }

    /**
     * Choose the optimal tooltip direction (LEFT or RIGHT) based on viewport position.
     * @param {HTMLElement} element
     * @returns {string}
     * @protected
     */
    _chooseTooltipDirection(element, hasTable = false, targetWidth = 360) {
        if (!element) return 'RIGHT';
        try {
            const rect = element.getBoundingClientRect?.();
            if (rect) {
                const windowWidth = typeof window !== 'undefined' ? (window.innerWidth ?? 1920) : 1920;
                const neededSpace = hasTable ? Math.max(targetWidth + 20, 400) : 360;
                const spaceRight = windowWidth - rect.right;
                const spaceLeft = rect.left;

                if (spaceRight < neededSpace && spaceLeft > spaceRight) {
                    return 'LEFT';
                }
                if (rect.left > windowWidth / 2 && spaceLeft >= neededSpace) {
                    return 'LEFT';
                }
            }
        } catch (e) {
            log.debug('_chooseTooltipDirection | getBoundingClientRect error:', e);
        }
        return 'RIGHT';
    }

    /**
     * Format a structured item summary object into HTML.
     * @param {Object} summary
     * @param {number|null} targetWidth
     * @param {boolean} needsHorizontalScroll
     * @returns {string}
     * @protected
     */
    _formatItemSummaryHtml(summary, targetWidth = null, needsHorizontalScroll = false) {
        if (!summary) return '';
        const title = summary.title ?? '';
        const subtitle = summary.subtitle ?? '';
        const img = summary.img ?? '';
        const properties = Array.isArray(summary.properties) ? summary.properties.filter(Boolean) : [];
        const description = summary.description ?? '';
        const hasTable = Boolean(description && /<table[\s>]/i.test(description));
        let tableClass = '';
        if (hasTable) {
            tableClass = ' bad-summary-has-table' + (needsHorizontalScroll ? ' bad-summary-overflow-x' : '');
        }
        const widthStyle = targetWidth ? ` style="--bad-tooltip-width: ${targetWidth}px; --bad-tooltip-max-width: ${targetWidth}px;"` : '';

        let html = `<div class="bad-item-summary-tooltip${tableClass}"${widthStyle}>`;
        html += '<div class="bad-summary-header">';
        const formatTag = tag => typeof tag === 'string' ? tag : (tag?.label ? `${tag.label}: ${tag.value}` : tag?.value);
        const headerTags = Array.isArray(summary.headerTags) ? summary.headerTags : (summary.headerTag ? [summary.headerTag] : []);
        let headerTagsHtml = '';
        for (const tag of headerTags) {
            const text = formatTag(tag);
            if (text) {
                headerTagsHtml += `<span class="bad-summary-tag">${text}</span>`;
            }
        }

        html += '<div class="bad-summary-title-group">';
        html += '<div class="bad-summary-title-row">';
        html += `<span class="bad-summary-title">${title}</span>`;
        if (headerTagsHtml) {
            html += headerTagsHtml;
        }
        html += '</div>';
        if (subtitle) {
            html += `<span class="bad-summary-subtitle">${subtitle}</span>`;
        }
        html += '</div></div>';

        if (properties.length > 0) {
            html += '<div class="bad-summary-tags">';
            for (const prop of properties) {
                if (Array.isArray(prop)) {
                    html += '<div class="bad-summary-tag-row">';
                    for (const item of prop) {
                        if (typeof item === 'string' && item.endsWith(':')) {
                            html += `<span class="bad-summary-row-label">${item}</span>`;
                        } else {
                            const text = formatTag(item);
                            if (text) html += `<span class="bad-summary-tag">${text}</span>`;
                        }
                    }
                    html += '</div>';
                } else {
                    const text = formatTag(prop);
                    if (text) html += `<span class="bad-summary-tag">${text}</span>`;
                }
            }
            html += '</div>';
        }

        if (description) {
            const descClass = needsHorizontalScroll ? 'bad-summary-desc bad-summary-overflow-x' : 'bad-summary-desc';
            html += `<div class="${descClass}">${description}</div>`;
        }

        html += '</div>';
        return html;
    }

    /**
     * Determine whether an item summary tooltip is currently focused/locked.
     * @type {boolean}
     */
    get isTooltipFocused() {
        if (Boolean(this._lockedTooltipTarget)) return true;
        if (Boolean(game.tooltip?.locked)) return true;
        const lockedEl = document.querySelector?.('#tooltip.locked, aside#tooltip.locked, div#tooltip.locked, .tooltip.locked, .locked-tooltip, [data-tooltip-locked="true"]');
        return Boolean(lockedEl?.classList?.contains?.('locked') || lockedEl?.classList?.contains?.('locked-tooltip') || lockedEl?.dataset?.tooltipLocked === 'true');
    }

    /**
     * Determine if a DOM element or event target is inside an item summary tooltip.
     * @param {EventTarget|HTMLElement} target
     * @returns {boolean}
     * @protected
     */
    _isInsideTooltip(target) {
        if (!target?.closest) return false;
        return Boolean(target.closest('#tooltip, aside#tooltip, div#tooltip, .tooltip, .bad-item-summary-tooltip, .bad-item-summary-tooltip-wrapper'));
    }

    /**
     * Display the item summary tooltip for an action item element.
     * @param {HTMLElement} itemEl
     * @protected
     */
    async _showItemSummaryTooltip(itemEl) {
        if (!itemEl) return;
        const actionId = itemEl.dataset?.actionId;
        const action = itemEl._badSubaction ?? this.actions.find(a => a.id === actionId);
        if (!action) return;

        const summary = await adapter.getItemSummary(action, action.originalItem, this.actor);
        if (!summary) return;

        const showSummaries = this._isQuestionMarkHeld || Boolean(game.settings.get(MODULE_ID, 'showItemSummaries'));
        if (this._hoveredActionItem !== itemEl || !showSummaries) return;

        const rawDesc = typeof summary === 'string' ? summary : (summary.description ?? '');
        const hasTable = Boolean(rawDesc && /<table[\s>]/i.test(rawDesc));

        let tableMetrics = { targetWidth: null, needsHorizontalScroll: false };
        if (hasTable) {
            tableMetrics = this._calculateTableTooltipWidth(rawDesc);
        }

        const html = typeof summary === 'string' ? summary : this._formatItemSummaryHtml(summary, tableMetrics.targetWidth, tableMetrics.needsHorizontalScroll);
        this._activeSummaryTooltip = { element: itemEl, actionId: action.id, summary, html, targetWidth: tableMetrics.targetWidth };

        let cssClass = 'bad-item-summary-tooltip-wrapper';
        if (hasTable) {
            cssClass += ' bad-summary-has-table-wrapper';
            if (tableMetrics.needsHorizontalScroll) {
                cssClass += ' bad-summary-overflow-x-wrapper';
            }
        }

        if (game.tooltip?.activate) {
            game.tooltip.activate(itemEl, {
                html,
                direction: this._chooseTooltipDirection(itemEl, hasTable, tableMetrics.targetWidth ?? 360),
                cssClass
            });

            if (hasTable && tableMetrics.targetWidth) {
                this._applyTooltipWidth(tableMetrics.targetWidth);
            }
        }
    }

    /**
     * Measure the minimal width required by tables in an item description
     * so title rows and column 1 do not wrap, clamped between 340px and 680px.
     * @param {string} descriptionHtml
     * @returns {{ targetWidth: number, needsHorizontalScroll: boolean }}
     * @protected
     */
    _calculateTableTooltipWidth(descriptionHtml) {
        const normalWidth = 340;
        const maxAllowedWidth = Math.min(680, Math.floor((typeof window !== 'undefined' ? (window.innerWidth ?? 1920) : 1920) * 0.92));

        if (!descriptionHtml || typeof document === 'undefined' || !document.body) {
            return { targetWidth: normalWidth, needsHorizontalScroll: false };
        }

        try {
            const sandbox = document.createElement('div');
            sandbox.style.cssText = 'position: absolute; left: -9999px; top: -9999px; visibility: hidden; pointer-events: none; width: max-content; max-width: none; min-width: 0;';
            sandbox.className = 'bad-summary-desc';
            sandbox.innerHTML = descriptionHtml;
            document.body.appendChild(sandbox);

            const tables = sandbox.querySelectorAll('table');
            let measuredTableWidth = normalWidth;

            tables.forEach(table => {
                table.style.setProperty('width', 'max-content', 'important');
                table.style.setProperty('min-width', '0', 'important');
                table.style.setProperty('max-width', 'none', 'important');
                table.style.setProperty('display', 'table', 'important');

                const ths = table.querySelectorAll('th, thead td, tr:first-child th, tr:first-child td');
                ths.forEach(th => th.style.setProperty('white-space', 'nowrap', 'important'));

                const firstColCells = table.querySelectorAll('td:first-child, th:first-child');
                firstColCells.forEach(td => td.style.setProperty('white-space', 'nowrap', 'important'));

                const rect = table.getBoundingClientRect?.();
                const w = Math.ceil(rect?.width ?? table.offsetWidth ?? table.scrollWidth ?? normalWidth);
                if (w > measuredTableWidth) measuredTableWidth = w;
            });

            sandbox.remove();

            const requiredWidth = measuredTableWidth + 36;
            const needsHorizontalScroll = requiredWidth > maxAllowedWidth;
            const targetWidth = Math.max(normalWidth, Math.min(requiredWidth, maxAllowedWidth));

            return { targetWidth, needsHorizontalScroll };
        } catch (e) {
            log.debug('_calculateTableTooltipWidth error:', e);
            return { targetWidth: normalWidth, needsHorizontalScroll: false };
        }
    }

    /**
     * Apply custom width to the tooltip DOM element and schedule follow-ups
     * in case of asynchronous TooltipManager positioning.
     * @param {number} targetWidth
     * @protected
     */
    _applyTooltipWidth(targetWidth) {
        const apply = () => {
            const tooltipEl = document.querySelector?.('#tooltip, aside#tooltip, div#tooltip');
            if (tooltipEl) {
                tooltipEl.style?.setProperty?.('--bad-tooltip-width', `${targetWidth}px`);
                tooltipEl.style?.setProperty?.('--bad-tooltip-max-width', `${targetWidth}px`);
                tooltipEl.style?.setProperty?.('width', `${targetWidth}px`, 'important');
                tooltipEl.style?.setProperty?.('max-width', `${targetWidth}px`, 'important');
                tooltipEl.style?.setProperty?.('min-width', '340px', 'important');
                tooltipEl.style?.setProperty?.('box-sizing', 'border-box', 'important');
            }
        };

        apply();
        requestAnimationFrame(apply);
        setTimeout(apply, 20);
    }

    /**
     * Hide the currently active item summary tooltip.
     * @protected
     */
    _hideItemSummaryTooltip() {
        if (this.isTooltipFocused) return;

        this._activeSummaryTooltip = null;
        const tooltipEl = document.querySelector?.('#tooltip, aside#tooltip, div#tooltip');
        if (tooltipEl) {
            tooltipEl.style?.removeProperty?.('--bad-tooltip-width');
            tooltipEl.style?.removeProperty?.('--bad-tooltip-max-width');
            tooltipEl.style?.removeProperty?.('width');
            tooltipEl.style?.removeProperty?.('max-width');
            tooltipEl.style?.removeProperty?.('min-width');
            tooltipEl.style?.removeProperty?.('box-sizing');
        }
        if (game.tooltip?.deactivate) {
            game.tooltip.deactivate();
        }
    }

    /**
     * Handle wheel events occurring inside the HUD element.
     * When a rich item summary tooltip is focused/locked via middle-click, forward wheel scrolling
     * directly to the tooltip's description container instead of scrolling the action display tab content.
     * @param {WheelEvent} event
     * @protected
     */
    _onWheel(event) {
        if (!event) return;
        if (this.isTooltipFocused) {
            const descEl = document.querySelector?.('#tooltip.locked .bad-summary-desc, aside#tooltip.locked .bad-summary-desc, #tooltip .bad-summary-desc, aside#tooltip .bad-summary-desc, .bad-item-summary-tooltip .bad-summary-desc');
            if (descEl) {
                event.preventDefault?.();
                event.stopPropagation?.();
                if (descEl.classList?.contains?.('bad-summary-overflow-x') && (event.shiftKey || event.deltaX)) {
                    descEl.scrollLeft = (descEl.scrollLeft ?? 0) + (event.deltaX || (event.shiftKey ? event.deltaY : 0));
                } else {
                    descEl.scrollTop = (descEl.scrollTop ?? 0) + (event.deltaY ?? 0);
                }
            }
        }
    }

    /**
     * Handle wheel events occurring on the window.
     * If the event target is inside an active/locked item summary tooltip, ensure scrolling is applied
     * directly to its description container without propagating or chaining to underlying windows.
     * @param {WheelEvent} event
     * @protected
     */
    _onWindowWheel(event) {
        if (!event) return;
        const tooltipEl = event.target?.closest?.('#tooltip, aside#tooltip, .bad-item-summary-tooltip, .bad-item-summary-tooltip-wrapper');
        if (tooltipEl) {
            const descEl = tooltipEl.querySelector?.('.bad-summary-desc') ?? (event.target?.classList?.contains?.('bad-summary-desc') ? event.target : null);
            if (descEl) {
                event.preventDefault?.();
                event.stopPropagation?.();
                if (descEl.classList?.contains?.('bad-summary-overflow-x') && (event.shiftKey || event.deltaX)) {
                    descEl.scrollLeft = (descEl.scrollLeft ?? 0) + (event.deltaX || (event.shiftKey ? event.deltaY : 0));
                } else {
                    descEl.scrollTop = (descEl.scrollTop ?? 0) + (event.deltaY ?? 0);
                }
            }
        }
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
        const leftBottom = leftTabs?.children.length > 0 ? (leftTabs.offsetTop + leftTabs.offsetHeight) : 0;
        const rightBottom = rightTabs?.children.length > 0 ? (rightTabs.offsetTop + rightTabs.offsetHeight) : 0;
        const maxTabBottom = Math.max(leftBottom, rightBottom);

        if (maxTabBottom > 0) {
            // Lazy-load and cache the container's bottom padding to prevent expensive getComputedStyle calls
            if (this._containerPaddingBottom === undefined) {
                const containerStyle = window.getComputedStyle(container);
                const parsedPadding = parseFloat(containerStyle.paddingBottom);
                this._containerPaddingBottom = !isNaN(parsedPadding) ? parsedPadding : 0;
            }

            const targetMinHeight = maxTabBottom + this._containerPaddingBottom;
            container.style.minHeight = `${targetMinHeight}px`;
        }
    }

    /**
     * Synchronize tab widths so that all tabs at a given depth level share the same width
     * as the maximal width of a tab at that depth level.
     */
    _syncTabWidths() {
        if (!this.element) return;

        const leftTabs = this.element.querySelector?.('.bad-left-tabs');
        if (leftTabs) {
            this._syncColumnTabWidths(leftTabs, '.bad-left-sub-tab');
        }

        const rightTabs = this.element.querySelector?.('.bad-right-tabs');
        if (rightTabs) {
            this._syncColumnTabWidths(rightTabs, '.bad-right-sub-tab');
        }
    }

    /**
     * Measure natural widths of sub-tabs at Depth 2 and Depth 3 within a tab column
     * and apply CSS custom properties (--bad-depth-2-width, --bad-depth-3-width) to enforce uniform widths.
     * @param {HTMLElement} columnElement Tab column container (.bad-left-tabs or .bad-right-tabs)
     * @param {string} subTabSelector CSS class selector for sub-tabs
     */
    _syncColumnTabWidths(columnElement, subTabSelector) {
        if (!columnElement || !columnElement.style) return;

        // Temporarily clear custom properties so natural/unconstrained dimensions can be measured
        columnElement.style.removeProperty?.('--bad-depth-2-width');
        columnElement.style.removeProperty?.('--bad-depth-3-width');

        const expandedGroups = columnElement.querySelectorAll?.('.bad-left-tab-group.expanded, .bad-right-tab-group.expanded') ?? [];
        const scope = expandedGroups.length > 0
            ? `.bad-left-tab-group.expanded ${subTabSelector}, .bad-right-tab-group.expanded ${subTabSelector}`
            : subTabSelector;

        const depth2Tabs = columnElement.querySelectorAll?.(`${scope}:not(.bad-nested-sub-tab)`) ?? [];
        const depth3Tabs = columnElement.querySelectorAll?.(`${scope}.bad-nested-sub-tab`) ?? [];

        let maxDepth2 = 0;
        for (const tab of depth2Tabs) {
            const width = tab.offsetWidth ?? tab.scrollWidth ?? 0;
            if (width > maxDepth2) maxDepth2 = width;
        }

        let maxDepth3 = 0;
        for (const tab of depth3Tabs) {
            const width = tab.offsetWidth ?? tab.scrollWidth ?? 0;
            if (width > maxDepth3) maxDepth3 = width;
        }

        if (maxDepth2 > 0) {
            columnElement.style.setProperty?.('--bad-depth-2-width', `${Math.ceil(maxDepth2)}px`);
        }
        if (maxDepth3 > 0) {
            columnElement.style.setProperty?.('--bad-depth-3-width', `${Math.ceil(maxDepth3)}px`);
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
        const activeTarget = event.button === 2 ? this._activeContextMenuTarget : this._activeMenuTarget;
        const activeItem = activeTarget?.closest('.bad-action-item, .bad-left-sub-tab, .bad-left-tab') ?? activeTarget;

        if (targetItem && activeItem === targetItem) {
            this._preventReopen = true;
        }
    }

    /**
     * Intercept contextmenu events in the capture phase to toggle the menu off
     * if the same item is right-clicked again.
     * @param {Event} event The triggering contextmenu event
     * @private
     */
    async _onContextMenuCapture(event) {
        if (event.target?.closest?.('#context-menu, .context-menu, .context-item')) return;

        // Delegate control button right-clicks declaratively via ControlBarManager
        const handled = await ControlBarManager.dispatchContextAction(this, event);
        if (handled) return;

        if (this._preventReopen) {
            this._preventReopen = false;

            // Safe close in capture phase (catch promise rejections)
            this._contextMenu?.close()?.catch?.(err => { });

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return;
        }

        // Intercept right-clicks on left/right parent/sub tabs
        const tabTarget = event.target?.closest?.('.bad-left-tab, .bad-right-tab, .bad-left-sub-tab, .bad-right-sub-tab');
        if (tabTarget) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            const isLeft = tabTarget.classList.contains('bad-left-tab') || tabTarget.classList.contains('bad-left-sub-tab');
            const isParent = tabTarget.classList.contains('bad-left-tab') || tabTarget.classList.contains('bad-right-tab');
            const side = isLeft ? 'left' : 'right';

            const handled = isLeft && await adapter.onTabRightClick(this, tabTarget, event);
            if (handled) {
                this.render();
            } else if (isParent) {
                this._handleParentTabToggle(side, tabTarget.dataset.type);
            } else if (tabTarget.dataset.type !== 'all') {
                this._handleSubTabToggle(side, tabTarget, tabTarget.dataset.type);
            }
            return;
        }



        const targetItem = event.target.closest('.bad-action-item, .bad-left-sub-tab, .bad-left-tab');
        const activeTarget = this._activeContextMenuTarget;
        const activeItem = activeTarget?.closest('.bad-action-item, .bad-left-sub-tab, .bad-left-tab') ?? activeTarget;

        if (targetItem && activeItem === targetItem) {
            this._clearMenuState({ force: true });
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
        return createActionContextMenu(this, this.element);
    }

    /**
     * Toggle the hidden state of an action.
     * @param {string} actionId The ID of the action to toggle
     * @param {boolean} shouldHide Whether the action should be hidden
     */
    async _toggleActionHidden(actionId, shouldHide) {
        if (!actionId || !this.actor) return;

        const action = this.actions?.find(a => a.id === actionId);
        if (!action) return;

        const itemId = action.originalItem?.id ?? action.id;
        // NOTE(migration): hiddenItems transitioned from legacy string[] to Record<string, boolean> object map.
        // Array normalization can be removed in a future cleanup once legacy world actor flags have migrated.
        const rawHidden = this.actor.getFlag(MODULE_ID, 'hiddenItems');
        const currentHidden = Array.isArray(rawHidden)
            ? rawHidden.reduce((acc, id) => { acc[id] = true; return acc; }, {})
            : { ...(rawHidden ?? {}) };

        if (shouldHide) {
            currentHidden[itemId] = true;
            await this.actor.setFlag(MODULE_ID, 'hiddenItems', currentHidden);
        } else {
            delete currentHidden[itemId];
            if (this.actor.update) {
                await this.actor.update({
                    [`flags.${MODULE_ID}.hiddenItems.-=${itemId}`]: null
                });
            } else if (this.actor.setFlag) {
                await this.actor.setFlag(MODULE_ID, 'hiddenItems', currentHidden);
            }
        }

        this.render();
    }



    /**
     * Initialize drag state on mousedown on the drag handle.
     * @param {MouseEvent} event
     */
    _onDragStart(event) {
        event.preventDefault();
        this._clearMenuState();
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
    }

    /**
     * Update HUD window position during active mouse drag.
     * @param {MouseEvent} event
     */
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
        left = Math.clamp(left, 10, window.innerWidth - width - 10);
        top = Math.clamp(top, 10, window.innerHeight - height - 10);

        // Apply styles directly for ultra-smooth 60fps dragging
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.bottom = '';
        el.style.right = '';

        // Dragging while in Attached mode automatically switches to Detached mode
        if (this.isAttached) {
            this.isAttached = false;
        }
    }

    /**
     * Finalize window position and persist settings on mouseup after dragging.
     * @param {MouseEvent} event
     */
    async _onDragEnd(event) {
        event.preventDefault();
        document.removeEventListener('mousemove', this._onDragMove);
        document.removeEventListener('mouseup', this._onDragEnd);

        const el = this.element;
        if (el && this._dragData) {
            const rect = el.getBoundingClientRect();
            const pos = { left: rect.left, top: rect.top };
            await game.settings.set(MODULE_ID, 'hudDetachedPosition', pos);
            await game.settings.set(MODULE_ID, 'isAttached', false);
        }

        this._dragData = null;

        // Re-render to update the control bar icon and tooltip
        this.render();
    }

    /**
     * Position the application window.
     * In Attached mode, anchors dynamically around token in preference order (above/below or right/left).
     * In Detached mode, places it at the user's last dragged screen coordinates.
     */
    setPosition(position = {}) {
        if (this._activeLeftClickMenu || this._activeContextMenuTarget) {
            this._clearMenuState({ force: true });
        }
        const el = this.element;
        if (!el) return super.setPosition(position);

        const scale = game.settings.get(MODULE_ID, 'hudScale') ?? 1.0;
        const appWidth = this._width ?? el.offsetWidth;
        const appHeight = this._height ?? el.offsetHeight;
        const tabExtension = 150 * scale;

        if (this.isAttached && this.token) {
            // --- ATTACHED MODE (Dynamic Token Placement) ---
            const tokenTransform = this.token.worldTransform ?? { tx: this.token.x ?? 0, ty: this.token.y ?? 0 };
            const canvasScale = game.canvas.stage?.scale?.x ?? 1;
            const gridSize = game.canvas.grid?.size ?? 100;
            const anchorSide = game.settings.get(MODULE_ID, 'hudAnchorSide') ?? 'vertical';

            const tokenWidth = (this.token.w ?? 100) * canvasScale;
            const tokenHeight = (this.token.h ?? 100) * canvasScale;

            const tokenLeft = tokenTransform.tx ?? 0;
            const tokenTop = tokenTransform.ty ?? 0;

            const isHorizontal = anchorSide === 'horizontal';
            const gridOffset = game.settings.get(MODULE_ID, isHorizontal ? 'hudGridOffsetHorizontal' : 'hudGridOffset') ?? 0.5;
            const pixelOffset = gridOffset * gridSize * canvasScale;

            const extraMargin = isHorizontal ? appWidth + tabExtension : appHeight;
            const room1 = (isHorizontal ? tokenLeft : tokenTop) - pixelOffset - extraMargin;
            const room2 = (isHorizontal ? window.innerWidth - (tokenLeft + tokenWidth) : window.innerHeight - (tokenTop + tokenHeight)) - pixelOffset - extraMargin;

            const side1 = isHorizontal ? 'left' : 'above';
            const side2 = isHorizontal ? 'right' : 'below';
            const label1 = isHorizontal ? 'left' : 'top';
            const label2 = isHorizontal ? 'right' : 'bottom';
            const positionSide = this._chooseAttachedSide(room1, room2, side1, side2, gridOffset, label1, label2);

            let top, left;
            const targetPosition = { width: 'auto', height: 'auto' };

            if (isHorizontal) {
                top = Math.clamp(tokenTop + (tokenHeight / 2) - (appHeight / 2), 10, window.innerHeight - appHeight - 10);
                const sideLeft = positionSide === 'left'
                    ? tokenLeft - pixelOffset - appWidth
                    : tokenLeft + tokenWidth + pixelOffset;
                targetPosition.top = top;
                targetPosition.left = sideLeft;
            } else {
                const minLeft = Math.max(10, tabExtension);
                const maxLeft = Math.min(window.innerWidth - appWidth - 10, window.innerWidth - appWidth - tabExtension);
                left = Math.clamp(tokenLeft + (tokenWidth / 2) - (appWidth / 2), minLeft, maxLeft);
                const sideTop = positionSide === 'above'
                    ? tokenTop - pixelOffset - appHeight
                    : tokenTop + tokenHeight + pixelOffset;
                targetPosition.left = left;
                targetPosition.top = sideTop;
            }

            const result = super.setPosition(adapter.foundry.mergeObject(position, targetPosition));
            el.style.height = 'auto';

            if (isHorizontal) {
                el.style.top = `${top}px`;
                el.style.bottom = '';
                if (positionSide === 'left') {
                    el.style.left = '';
                    el.style.right = `${window.innerWidth - tokenLeft + pixelOffset}px`;
                } else {
                    el.style.right = '';
                    el.style.left = `${tokenLeft + tokenWidth + pixelOffset}px`;
                }
            } else {
                el.style.left = `${left}px`;
                el.style.right = '';
                if (positionSide === 'above') {
                    el.style.top = '';
                    el.style.bottom = `${window.innerHeight - tokenTop + pixelOffset}px`;
                } else {
                    el.style.bottom = '';
                    el.style.top = `${tokenTop + tokenHeight + pixelOffset}px`;
                }
            }

            return result;

        } else {
            // --- DETACHED MODE (Floating / Fixed Screen Position) ---
            const savedPos = game.settings.get(MODULE_ID, 'hudDetachedPosition');

            // Clamp to screen bounds to ensure it's always visible (handles resolution changes)
            const left = Math.clamp(savedPos?.left ?? 100, 10, window.innerWidth - appWidth - 10);
            const top = Math.clamp(savedPos?.top ?? 100, 10, window.innerHeight - appHeight - 10);

            const targetPosition = adapter.foundry.mergeObject(position, {
                left,
                top,
                width: 'auto',
                height: 'auto'
            });

            el.style.bottom = '';
            el.style.right = '';

            return super.setPosition(targetPosition);
        }
    }

    /**
     * Choose the best side to anchor the HUD based on available space.
     * @private
     */
    _chooseAttachedSide(room1, room2, side1, side2, gridOffset, label1 = side1, label2 = side2) {
        if (room1 >= 0 && room2 >= 0) return room1 >= room2 ? side1 : side2;
        if (room1 >= 0) return side1;
        if (room2 >= 0) return side2;
        log.error(`HUD position with grid offset ${gridOffset} exceeds screen bounds on both ${label1} and ${label2}.`);
        return side2;
    }

    // #endregion
}
