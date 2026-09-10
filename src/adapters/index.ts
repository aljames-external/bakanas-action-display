import { initializeFoundryAdapter, BaseFoundryAdapter } from './foundry/index.js';
import { FoundryV13Adapter } from './foundry/foundry-v13-adapter.js';
import { initializeSystemAdapter, BaseSystemAdapter } from './system/index.js';
import { initializeModuleAdapters, BaseModuleAdapter } from './module/index.js';
import { MODULE_ID } from '../constants.js';
import { log } from '../lib/logger.js';
import { Action } from '../ui/action.js';
import { CombatMovementTracker } from '../combat/combat-movement-tracker.js';

/**
 * Unified Adapter Singleton for Bakana's Action Display.
 * Centralizes and abstracts Foundry-level, System-level, and Module-level capabilities.
 */
class Adapter {
    foundry: BaseFoundryAdapter;
    system: BaseSystemAdapter;
    modules: Map<string, BaseModuleAdapter>;
    private _initialized: boolean;

    constructor() {
        this.foundry = (typeof game !== 'undefined' && game?.release?.generation)
            ? initializeFoundryAdapter()
            : new FoundryV13Adapter();
        this.system = new BaseSystemAdapter('default', false, this.foundry);
        this.modules = new Map();
        this._initialized = false;
    }

    /**
     * Backward-compatible getter for active system adapter.
     * @type {BaseSystemAdapter}
     */
    get activeSystemAdapter() {
        return this.system;
    }

    set activeSystemAdapter(sys) {
        this.system = sys;
    }

    /**
     * Initialize all adapter layers (Foundry, System, Module).
     * @returns {Promise<void>}
     */
    async init() {
        this.foundry = initializeFoundryAdapter();
        this.system = await initializeSystemAdapter(game.system?.id, this.foundry);
        this.modules = initializeModuleAdapters();
        this._initialized = true;
        const systemLabel = this.system.isSupported ? this.system.systemId : `${this.system.systemId} (unsupported)`;
        log.info(`Unified Adapter initialized [Foundry: v${this.foundry.generation}, System: ${systemLabel}, Modules: ${this.modules.size}]`);
    }


    /* -------------------------------------------- */
    /*  Action Processing Pipeline                  */
    /* -------------------------------------------- */

    /**
     * Extract and process all actions for a given actor through System and Module layers.
     * @param {Actor} actor
     * @returns {Promise<Action[]>}
     */
    async getActions(actor: any) {
        if (!actor) return [];

        // 1. Core Base Extraction
        let actions = this._extractBaseActions(actor);

        // 2. System Transformation
        if (this.system) {
            try {
                actions = await this.system.modifyActions(actions, actor);
            } catch (error) {
                log.error(`Error in system adapter "${this.system.systemId}":`, error);
            }
        }

        // 3. Module Transformations
        for (const [moduleId, modAdapter] of this.modules.entries()) {
            try {
                actions = await modAdapter.modifyActions(actions);
            } catch (error) {
                log.error(`Error in module adapter "${moduleId}":`, error);
            }
        }

        // 4. Hidden items filtering
        const rawHidden = actor.getFlag?.(MODULE_ID, 'hiddenItems');
        const hiddenMap = Array.isArray(rawHidden)
            ? rawHidden.reduce((acc, id) => { acc[id] = true; return acc; }, {})
            : (rawHidden ?? {});
        const filtered: any[] = [];

        log.group(`Adapter.getActions | Processing hidden items for "${actor.name ?? 'Actor'}"`, 'debug');
        try {
            for (const action of (actions as any[])) {
                if (action.hidden) {
                    log.debug(`Adapter.getActions | Skipping "${action.name}" (ID: ${action.id}) — action.hidden === true`);
                    continue;
                }

                const itemId = action.originalItem?.id ?? action.id;
                if (Boolean(hiddenMap[itemId])) {
                    log.debug(`Adapter.getActions | Marking "${action.name}" (ID: ${itemId}) as hidden — item is in actor's hiddenItems flag map`);
                    action.isHidden = true;
                    action.left = ['hidden'];
                    action.right = ['all'];
                    filtered.push(action);
                    continue;
                }

                action.isHidden = false;
                filtered.push(action);
            }
        } finally {
            log.groupEnd();
        }

        return filtered;
    }

    /**
     * Internal base action extractor.
     * @param {Actor} actor
     * @returns {Action[]}
     * @private
     */
    _extractBaseActions(actor: any) {
        const actions: any[] = [];
        if (!actor?.items) return actions;

        const items = Array.from(actor.items.values()) as any[];
        log.group(`Adapter._extractBaseActions | Extracting base actions for "${actor.name ?? 'Actor'}"`, 'debug');
        try {
            for (const item of items) {
                if (!item?.name) {
                    log.debug(`Adapter._extractBaseActions | Skipping item (ID: ${item?.id}) — item.name is missing or falsy`);
                    continue;
                }
                if (this.system && !this.system.shouldExtractItem(item)) {
                    continue;
                }
                actions.push(new Action({
                    id: item.id,
                    name: item.name,
                    img: item.img,
                    type: item.type,
                    originalItem: item,
                    left: item.type ? [item.type] : ['other'],
                    roll: (event) => item.use?.({}, { event }) ?? item.roll?.({ event }) ?? item.sheet?.render(true)
                }));
            }
        } finally {
            log.groupEnd();
        }
        return actions;
    }

    /* -------------------------------------------- */
    /*  System Layer Delegates                      */
    /* -------------------------------------------- */

    /**
     * Open the sheet for an item or activity.
     * @param {Object} action
     * @returns {void}
     */
    openEditSheet(action: any) {
        return this.system?.openEditSheet?.(action);
    }

    /**
     * Retrieve system-specific context menu items.
     * @param {ApplicationV2} app Active HUD application
     * @returns {Object[]}
     */
    getContextMenuItems(app: any) {
        return this.system?.getContextMenuItems?.(app) ?? [];
    }

    /**
     * Check if a parent tab acts as an exclusion filter.
     * @param {string} parentId
     * @returns {boolean}
     */
    isExclusionTab(parentId: any) {
        return this.system?.isExclusionTab?.(parentId) ?? false;
    }

    /**
     * Get canonical sub-tabs for an exclusion parent tab.
     * @param {string} parentId
     * @returns {string[]}
     */
    getExclusionSubTabs(parentId: any) {
        return this.system?.getExclusionSubTabs?.(parentId) ?? [];
    }

    /**
     * Delegate tab right-click handling to the system adapter.
     * @param {ApplicationV2} app
     * @param {HTMLElement} tab
     * @param {Event} event
     * @returns {boolean}
     */
    onTabRightClick(app: any, tab: any, event: any) {
        return this.system?.onTabRightClick?.(app, tab, event) ?? false;
    }

    /**
     * Get the localized label for a left-side parent item tab.
     * @param {string} id
     * @returns {string}
     */
    getItemTypeLabel(id: any) {
        return this.system?.getItemTypeLabel?.(id) ?? id;
    }

    /**
     * Get the CSS icon class for a left-side parent item tab.
     * @param {string} id
     * @returns {string}
     */
    getItemTypeIcon(id: any) {
        return this.system?.getItemTypeIcon?.(id) ?? '';
    }

    /**
     * Get the sort priority order for a left-side parent item tab.
     * @param {string} id
     * @returns {number}
     */
    getItemTypeSortOrder(id: any) {
        return this.system?.getItemTypeSortOrder?.(id) ?? 999;
    }

    /**
     * Get the localized label for a left-side item sub-tab.
     * @param {string} parentId
     * @param {string} subId
     * @returns {string}
     */
    getItemSubTabLabel(parentId: any, subId: any) {
        return this.system?.getItemSubTabLabel?.(parentId, subId) ?? subId;
    }

    /**
     * Get the sort priority order for a left-side item sub-tab.
     * @param {string} parentId
     * @param {string} subId
     * @returns {number}
     */
    getItemSubTabSortOrder(parentId: any, subId: any) {
        return this.system?.getItemSubTabSortOrder?.(parentId, subId) ?? 999;
    }

    /**
     * Get the localized label for a right-side action parent tab.
     * @param {string} id
     * @returns {string}
     */
    getActionTypeLabel(id: any) {
        return this.system?.getActionTypeLabel?.(id) ?? id;
    }

    /**
     * Get the CSS icon class for a right-side action parent tab.
     * @param {string} id
     * @returns {string}
     */
    getActionTypeIcon(id: any) {
        return this.system?.getActionTypeIcon?.(id) ?? '';
    }

    /**
     * Get the sort priority order for a right-side action parent tab.
     * @param {string} id
     * @returns {number}
     */
    getActionTypeSortOrder(id: any) {
        return this.system?.getActionTypeSortOrder?.(id) ?? 999;
    }

    /**
     * Get the localized label for a right-side action sub-tab.
     * @param {string} subId
     * @returns {string}
     */
    getActionSubTabLabel(subId: any) {
        return this.system?.getActionSubTabLabel?.(subId) ?? subId;
    }

    /**
     * Get the sort priority order for a right-side action sub-tab.
     * @param {string} parentId
     * @param {string} subId
     * @returns {number}
     */
    getActionSubTabSortOrder(parentId: any, subId: any) {
        return this.system?.getActionSubTabSortOrder?.(parentId, subId) ?? 999;
    }

    /**
     * Get default active left-side sub-tab IDs for initial HUD column state.
     * @returns {string[]}
     */
    getDefaultActiveLeftSubTypes() {
        return this.system?.getDefaultActiveLeftSubTypes?.() ?? [];
    }

    /**
     * Get default active right-side sub-tab IDs for initial HUD column state.
     * @returns {string[]}
     */
    getDefaultActiveSubTypes() {
        return this.system?.getDefaultActiveSubTypes?.() ?? [];
    }

    /**
     * Update active tabs and filter state on actor changes via the active system adapter.
     * @param {Actor} actor
     * @param {HUDTabColumn} [tabColumn]
     */
    updateTabs(actor: any, tabColumn: any = null) {
        this.system?.updateTabs?.(actor, tabColumn);
    }

    /**
     * Record a manual tab/sub-tab user interaction via the active system adapter.
     * @param {Actor} actor
     * @param {string} parentId
     * @param {string} subId
     * @param {boolean} isActive
     */
    recordManualTabToggle(actor: any, parentId: any, subId: any, isActive: any) {
        this.system?.recordManualTabToggle?.(actor, parentId, subId, isActive);
    }

    /**
     * Filter subactions through the system adapter.
     * @param {Actor} actor
     * @param {Object[]} subactions
     * @param {string[]} leftTab
     * @param {string[]} rightTab
     * @returns {Object[]}
     */
    filterSubactions(actor: any, subactions: any, leftTab?: any, rightTab?: any): any[] {
        return (this.system as any)?.filterSubactions?.(subactions, { actor, leftTab, rightTab }) ?? subactions;
    }

    /**
     * Evaluate if an action matches active right-side economy/action tabs.
     * @param {Object} action
     * @param {Object} filterContext
     * @returns {boolean}
     */
    matchesEconomyTabs(action: any, filterContext: any) {
        return this.system?.matchesEconomyTabs?.(action, filterContext) ?? true;
    }

    /**
     * Allow system adapter to modify Handlebars context before rendering.
     * @param {Object} context
     * @param {Object} options
     * @returns {Promise<void>}
     */
    async modifyContext(context: any, options: any) {
        return (await this.system?.modifyContext?.(context, options));
    }

    /**
     * Extract structured token information for showcase display.
     * @param {Actor} actor
     * @param {Token} [token]
     * @returns {Promise<Object|null>}
     */
    async getTokenInfo(actor: any, token: Token | null = null) {
        return (await this.system?.getTokenInfo?.(actor, token)) ?? null;
    }

    /**
     * Determine if an actor supports inspiration and retrieve its current status via the active system adapter.
     * @param {Actor} actor
     * @returns {{ supported: boolean, value: boolean }}
     */
    getInspiration(actor: any) {
        return this.system?.getInspiration?.(actor) ?? { supported: false, value: false };
    }

    /**
     * Toggle or set inspiration on an actor via the active system adapter.
     * @param {Actor} actor
     * @param {boolean} [force]
     * @returns {Promise<boolean>}
     */
    async toggleInspiration(actor: any, force?: boolean) {
        return (await this.system?.toggleInspiration?.(actor, force)) ?? false;
    }

    /**
     * Determine whether a document update operation represents a teleportation.
     * @param {Object} [options={}] Operation options or DatabaseUpdateOperation
     * @returns {boolean}
     */
    isTeleport(options = {}) {
        return this.foundry.isTeleport(options);
    }

    /**
     * Retrieve the distance the token has moved in the current combat turn.
     * @param {Token|null} [token=null]
     * @param {Actor|null} [actor=null]
     * @returns {{ inCombat: boolean, distance: number, units: string }}
     */
    getTurnMovement(token = null, actor = null) {
        return CombatMovementTracker.getMovementThisTurn(token, actor);
    }

    /**
     * Get system-specific page definition configuration.
     * @param {number} [page=1]
     * @param {Actor} [actor=null]
     * @returns {{ page: number, defaultLayout: string, categories: Object[]|null }}
     */
    getPageConfig(page = 1, actor = null) {
        const parsed = Number(page);
        const pageNum = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
        return this.system?.getPageConfig?.(page, actor) ?? { page: pageNum, defaultLayout: 'flat', categories: null };
    }

    /**
     * Apply a categorized section layout to the HUD context.
     * @param {Object} context
     * @param {Object} [options]
     */
    formatCategorizedLayout(context: any, options: any) {
        this.system?.formatCategorizedLayout?.(context, options);
    }

    /**
     * Get system-specific default preset categories.
     * @returns {Object[]|null}
     */
    getDefaultCategories() {
        return this.system?.getDefaultCategories?.() ?? null;
    }

    /**
     * Get system-specific configurable action economy types and default colors.
     * @returns {{ id: string, label: string, defaultColor: string }[]}
     */
    getEconomyTypes() {
        return this.system?.getEconomyTypes?.() ?? [];
    }

    /**
     * Determine if an economy type is enabled.
     * @param {Object} type
     * @param {Record<string, any>} [userColors]
     * @returns {boolean}
     */
    isEconomyTypeEnabled(type: any, userColors: any) {
        return this.system?.isEconomyTypeEnabled?.(type, userColors) ?? false;
    }

    /**
     * Get mapped color for an economy type.
     * @param {string} type
     * @param {Record<string, any>} [userColors]
     * @returns {string|null}
     */
    getEconomyColor(type: any, userColors: any) {
        return this.system?.getEconomyColor?.(type, userColors) ?? null;
    }

    /**
     * Extract economy indicators for a given action.
     * @param {Object} action
     * @param {Record<string, any>} [userColors]
     * @returns {{ type: string, label: string, active: boolean, color: string|null }[]}
     */
    extractEconomyIndicators(action: any, userColors: any) {
        return this.system?.extractEconomyIndicators?.(action, userColors) ?? [];
    }

    /**
     * Format a stylized HTML tooltip for an action economy reminder bar.
     * @param {Object} sysType
     * @param {string|null} [color]
     * @returns {string}
     */
    formatEconomyTooltip(sysType: any, color: any) {
        return this.system?.formatEconomyTooltip?.(sysType, color) ?? '';
    }

    /**
     * Retrieve active status effects causing automatic verbal/somatic spell component bans.
     * @param {Actor} actor
     * @returns {Record<'vocal'|'somatic', string[]>}
     */
    getAutoBanEffectReasons(actor: any) {
        return this.system?.getAutoBanEffectReasons?.(actor) ?? { vocal: [], somatic: [] };
    }

    /**
     * Get the enriched HTML content-link for a status condition ID.
     * @param {string} condId
     * @param {string} [customLabel]
     * @returns {Promise<string>}
     */
    async enrichCondition(condId: any, customLabel = null) {
        return (await this.system?.enrichCondition?.(condId, customLabel)) ?? '';
    }

    /**
     * Format a stylized HTML tooltip for automatically added verbal/somatic bans.
     * @param {string} comp
     * @param {Array<Object|string>|Record<string, Array<Object|string>>} reasons
     * @returns {Promise<string>}
     */
    async formatAutoBanTooltip(comp: any, reasons: any) {
        return (await this.system?.formatAutoBanTooltip?.(comp, reasons)) ?? '';
    }

    /**
     * Get item summary data for rich tooltips.
     * @param {Object} action
     * @param {Object} [item]
     * @param {Object} [actor]
     * @returns {Promise<Object|null>}
     */
    async getItemSummary(action: any, item: any, actor: any) {
        return this.system?.getItemSummary?.(action, item, actor) ?? null;
    }

    /**
     * Enrich an HTML string with Foundry enrichers, roll data, and document links.
     * @param {string} content HTML string to enrich
     * @param {Object} [options={}] Enrichment options (rollData, secrets, relativeTo, etc.)
     * @returns {Promise<string>}
     */
    async enrichHTML(content: any, options = {}) {
        return this.foundry.enrichHTML(content, options);
    }

    /**
     * Safely resolve a document from UUID synchronously via the active Foundry adapter.
     * @param {string} uuid Document UUID
     * @param {Object} [options={}] Resolution options
     * @returns {Document|null}
     */
    fromUuidSync(uuid: any, options = {}) {
        return this.foundry.fromUuidSync(uuid, options);
    }

    /**
     * Safely resolve a document from UUID asynchronously via the active Foundry adapter.
     * @param {string} uuid Document UUID
     * @param {Object} [options={}] Resolution options
     * @returns {Promise<Document|null>}
     */
    async fromUuid(uuid: any, options = {}) {
        return this.foundry.fromUuid(uuid, options);
    }

    /**
     * Merge two objects recursively via the active Foundry adapter.
     * @param {Object} original Target object
     * @param {Object} [other={}] Source object
     * @param {Object} [options={}] Merge options
     * @returns {Object}
     */
    mergeObject(original: any, other = {}, options = {}) {
        return this.foundry.mergeObject(original, other, options);
    }

    /**
     * Deep duplicate an object via the active Foundry adapter.
     * @param {Object} obj Target object
     * @returns {Object}
     */
    duplicate(obj: any) {
        return this.foundry.duplicate(obj);
    }

    /**
     * Retrieve a property from an object by dot path via the active Foundry adapter.
     * @param {Object} obj Target object
     * @param {string} path Dot path
     * @returns {*}
     */
    getProperty(obj: any, path: any) {
        return this.foundry.getProperty(obj, path);
    }

    /**
     * Set a property on an object by dot path via the active Foundry adapter.
     * @param {Object} obj Target object
     * @param {string} path Dot path
     * @param {*} value Property value
     * @returns {boolean}
     */
    setProperty(obj: any, path: any, value: any) {
        return this.foundry.setProperty(obj, path, value);
    }

    /**
     * Generate a random string identifier via the active Foundry adapter.
     * @param {number} [length=16] Length of the identifier
     * @returns {string}
     */
    randomID(length = 16) {
        return this.foundry.randomID(length);
    }

    /**
     * Test whether an object is empty via the active Foundry adapter.
     * @param {Object} obj Target object
     * @returns {boolean}
     */
    isEmpty(obj: any) {
        return this.foundry.isEmpty(obj);
    }

    /**
     * Preload Handlebars templates via the active Foundry platform adapter.
     * @param {string[]} paths Array of template paths
     * @returns {Promise<Function[]>}
     */
    async loadTemplates(paths: any) {
        return this.foundry.loadTemplates(paths);
    }
}

export const adapter = new Adapter();
export { Adapter, BaseFoundryAdapter, BaseSystemAdapter, BaseModuleAdapter };
