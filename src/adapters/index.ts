import { initializeFoundryAdapter, BaseFoundryAdapter } from './foundry/index.js';
import { FoundryV13Adapter } from './foundry/foundry-v13-adapter.js';
import { initializeSystemAdapter, BaseSystemAdapter } from './system/index.js';
import { initializeModuleAdapters, BaseModuleAdapter } from './module/index.js';
import { MODULE_ID } from '../constants.js';
import { log } from '../lib/logger.js';
import { Action } from '../ui/action.js';
import { TabRef } from '../ui/tab-ref.js';
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
    async getActions(actor: Actor): Promise<Action[]> {
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
            ? rawHidden.reduce((acc: Record<string, boolean>, id: string) => { acc[id] = true; return acc; }, {})
            : ((rawHidden as Record<string, boolean>) ?? {});
        const filtered: Action[] = [];

        log.group(`Adapter.getActions | Processing hidden items for "${actor.name ?? 'Actor'}"`, 'debug');
        try {
            for (const action of actions) {
                if (action.hidden) {
                    log.debug(`Adapter.getActions | Skipping "${action.name}" (ID: ${action.id}) — action.hidden === true`);
                    continue;
                }

                const itemId = action.originalItem?.id ?? action.id;
                if (Boolean(hiddenMap[itemId])) {
                    log.debug(`Adapter.getActions | Marking "${action.name}" (ID: ${itemId}) as hidden — item is in actor's hiddenItems flag map`);
                    action.isHidden = true;
                    action.left = ['hidden'];
                    action.right = [TabRef.from('all')];
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
    _extractBaseActions(actor: Actor): Action[] {
        const actions: Action[] = [];
        if (!actor?.items) return actions;

        const items = Array.from(actor.items.values()) as Item[];
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
                    id: item.id ?? '',
                    name: item.name,
                    img: item.img ?? undefined,
                    type: item.type,
                    originalItem: item,
                    left: item.type ? [item.type] : ['other'],
                    roll: (event) => (item as any).use?.({}, { event }) ?? (item as any).roll?.({ event }) ?? item.sheet?.render(true)
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
     * @param {Action} action
     * @returns {void}
     */
    openEditSheet(action: Action): void {
        return this.system?.openEditSheet?.(action);
    }

    /**
     * Retrieve system-specific context menu items.
     * @param {unknown} app Active HUD application
     * @returns {Object[]}
     */
    getContextMenuItems(app: unknown): unknown[] {
        return this.system?.getContextMenuItems?.(app) ?? [];
    }

    /**
     * Check if a parent tab acts as an exclusion filter.
     * @param {string} parentId
     * @returns {boolean}
     */
    isExclusionTab(parentId: string): boolean {
        return this.system?.isExclusionTab?.(parentId) ?? false;
    }

    /**
     * Get canonical sub-tabs for an exclusion parent tab.
     * @param {string} parentId
     * @returns {string[]}
     */
    getExclusionSubTabs(parentId: string): string[] {
        return this.system?.getExclusionSubTabs?.(parentId) ?? [];
    }

    /**
     * Delegate tab right-click handling to the system adapter.
     * @param {unknown} app
     * @param {HTMLElement} tab
     * @param {Event|MouseEvent} event
     * @returns {boolean}
     */
    onTabRightClick(app: unknown, tab: HTMLElement, event: Event | MouseEvent): boolean {
        return this.system?.onTabRightClick?.(app, tab, event) ?? false;
    }

    /**
     * Get the localized label for a left-side parent item tab.
     * @param {string} id
     * @returns {string}
     */
    getItemTypeLabel(id: string): string {
        return this.system?.getItemTypeLabel?.(id) ?? id;
    }

    /**
     * Get the CSS icon class for a left-side parent item tab.
     * @param {string} id
     * @returns {string}
     */
    getItemTypeIcon(id: string): string {
        return this.system?.getItemTypeIcon?.(id) ?? '';
    }

    /**
     * Get the sort priority order for a left-side parent item tab.
     * @param {string} id
     * @returns {number}
     */
    getItemTypeSortOrder(id: string): number {
        return this.system?.getItemTypeSortOrder?.(id) ?? 999;
    }

    /**
     * Get the localized label for a left-side item sub-tab.
     * @param {string} parentId
     * @param {string} subId
     * @returns {string}
     */
    getItemSubTabLabel(parentId: string, subId: string): string {
        return this.system?.getItemSubTabLabel?.(parentId, subId) ?? subId;
    }

    /**
     * Get the sort priority order for a left-side item sub-tab.
     * @param {string} parentId
     * @param {string} subId
     * @returns {number}
     */
    getItemSubTabSortOrder(parentId: string, subId: string): number {
        return this.system?.getItemSubTabSortOrder?.(parentId, subId) ?? 999;
    }

    /**
     * Get the localized label for a right-side action parent tab.
     * @param {string} id
     * @returns {string}
     */
    getActionTypeLabel(id: string): string {
        return this.system?.getActionTypeLabel?.(id) ?? id;
    }

    /**
     * Get the CSS icon class for a right-side action parent tab.
     * @param {string} id
     * @returns {string}
     */
    getActionTypeIcon(id: string): string {
        return this.system?.getActionTypeIcon?.(id) ?? '';
    }

    /**
     * Get the sort priority order for a right-side action parent tab.
     * @param {string} id
     * @returns {number}
     */
    getActionTypeSortOrder(id: string): number {
        return this.system?.getActionTypeSortOrder?.(id) ?? 999;
    }

    /**
     * Get the localized label for a right-side action sub-tab.
     * @param {string} subId
     * @returns {string}
     */
    getActionSubTabLabel(subId: string): string {
        return this.system?.getActionSubTabLabel?.(subId) ?? subId;
    }

    /**
     * Get the sort priority order for a right-side action sub-tab.
     * @param {string} parentId
     * @param {string} subId
     * @returns {number}
     */
    getActionSubTabSortOrder(parentId: string, subId: string): number {
        return this.system?.getActionSubTabSortOrder?.(parentId, subId) ?? 999;
    }

    /**
     * Get default active left-side sub-tab IDs for initial HUD column state.
     * @returns {string[]}
     */
    getDefaultActiveLeftSubTypes(): string[] {
        return this.system?.getDefaultActiveLeftSubTypes?.() ?? [];
    }

    /**
     * Get default active right-side sub-tab IDs for initial HUD column state.
     * @returns {string[]}
     */
    getDefaultActiveSubTypes(): string[] {
        return this.system?.getDefaultActiveSubTypes?.() ?? [];
    }

    /**
     * Update active tabs and filter state on actor changes via the active system adapter.
     * @param {Actor} actor
     * @param {HUDTabColumn | null} [tabColumn]
     */
    updateTabs(actor: Actor, tabColumn: HUDTabColumn | null = null): void {
        this.system?.updateTabs?.(actor, tabColumn);
    }

    /**
     * Record a manual tab/sub-tab user interaction via the active system adapter.
     * @param {Actor} actor
     * @param {string} parentId
     * @param {string} subId
     * @param {boolean} isActive
     */
    recordManualTabToggle(actor: Actor, parentId: string, subId: string, isActive: boolean): void {
        this.system?.recordManualTabToggle?.(actor, parentId, subId, isActive);
    }

    /**
     * Filter subactions through the system adapter.
     * @param {Actor} actor
     * @param {Action[]} subactions
     * @param {string[]} [leftTab]
     * @param {string[]} [rightTab]
     * @returns {Action[]}
     */
    filterSubactions(actor: Actor, subactions: Action[], leftTab?: string[], rightTab?: string[]): Action[] {
        return this.system?.filterSubactions?.(subactions, { actor, leftTab, rightTab }) ?? subactions;
    }

    /**
     * Evaluate if an action matches active right-side economy/action tabs.
     * @param {Action} action
     * @param {Record<string, unknown>} filterContext
     * @returns {boolean}
     */
    matchesEconomyTabs(action: Action, filterContext: Record<string, unknown>): boolean {
        return this.system?.matchesEconomyTabs?.(action, filterContext) ?? true;
    }

    /**
     * Allow system adapter to modify Handlebars context before rendering.
     * @param {Record<string, unknown>} context
     * @param {Record<string, unknown>} [options]
     * @returns {Promise<void>}
     */
    async modifyContext(context: Record<string, unknown>, options: Record<string, unknown> = {}): Promise<void> {
        await this.system?.modifyContext?.(context, options);
    }

    /**
     * Extract structured token information for showcase display.
     * @param {Actor} actor
     * @param {Token | null} [token]
     * @returns {Promise<Record<string, unknown> | null>}
     */
    async getTokenInfo(actor: Actor, token: Token | null = null): Promise<Record<string, unknown> | null> {
        return (await this.system?.getTokenInfo?.(actor, token)) ?? null;
    }

    /**
     * Determine if an actor supports inspiration and retrieve its current status via the active system adapter.
     * @param {Actor} actor
     * @returns {{ supported: boolean, value: boolean }}
     */
    getInspiration(actor: Actor): { supported: boolean; value: boolean } {
        return this.system?.getInspiration?.(actor) ?? { supported: false, value: false };
    }

    /**
     * Toggle or set inspiration on an actor via the active system adapter.
     * @param {Actor} actor
     * @param {boolean} [force]
     * @returns {Promise<boolean>}
     */
    async toggleInspiration(actor: Actor, force?: boolean): Promise<boolean> {
        return (await this.system?.toggleInspiration?.(actor, force)) ?? false;
    }

    /**
     * Determine whether a document update operation represents a teleportation.
     * @param {Record<string, unknown>} [options={}] Operation options or DatabaseUpdateOperation
     * @returns {boolean}
     */
    isTeleport(options: Record<string, unknown> = {}): boolean {
        return this.foundry.isTeleport(options);
    }

    /**
     * Retrieve the distance the token has moved in the current combat turn.
     * @param {Token|null} [token=null]
     * @param {Actor|null} [actor=null]
     * @returns {{ inCombat: boolean, distance: number, units: string }}
     */
    getTurnMovement(token: Token | null = null, actor: Actor | null = null): { inCombat: boolean; distance: number; units: string } {
        return CombatMovementTracker.getMovementThisTurn(token, actor);
    }

    /**
     * Get system-specific page definition configuration.
     * @param {number} [page=1]
     * @param {Actor | null} [actor=null]
     * @returns {{ page: number, defaultLayout: string, categories: unknown[] | null }}
     */
    getPageConfig(page: number = 1, actor: Actor | null = null): { page: number; defaultLayout: string; categories: Record<string, unknown>[] | null } {
        const parsed = Number(page);
        const pageNum = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
        return (this.system?.getPageConfig?.(page, actor) as { page: number; defaultLayout: string; categories: Record<string, unknown>[] | null }) ?? { page: pageNum, defaultLayout: 'flat', categories: null };
    }

    /**
     * Apply a categorized section layout to the HUD context.
     * @param {Record<string, unknown>} context
     * @param {Record<string, unknown>} [options]
     */
    formatCategorizedLayout(context: Record<string, unknown>, options?: Record<string, unknown>): void {
        this.system?.formatCategorizedLayout?.(context, options);
    }

    /**
     * Get system-specific default preset categories.
     * @returns {Record<string, unknown>[] | null}
     */
    getDefaultCategories(): Record<string, unknown>[] | null {
        return (this.system?.getDefaultCategories?.() as Record<string, unknown>[] | null) ?? null;
    }

    /**
     * Get system-specific configurable action economy types and default colors.
     * @returns {{ id: string, label: string, defaultColor: string }[]}
     */
    getEconomyTypes(): { id: string; label: string; defaultColor: string }[] {
        return this.system?.getEconomyTypes?.() ?? [];
    }

    /**
     * Determine if an economy type is enabled.
     * @param {object} type
     * @param {Record<string, unknown>} [userColors]
     * @returns {boolean}
     */
    isEconomyTypeEnabled(type: { id: string }, userColors?: Record<string, unknown>): boolean {
        return this.system?.isEconomyTypeEnabled?.(type, userColors) ?? false;
    }

    /**
     * Get mapped color for an economy type.
     * @param {string} type
     * @param {Record<string, unknown>} [userColors]
     * @returns {string|null}
     */
    getEconomyColor(type: string, userColors?: Record<string, unknown>): string | null {
        return this.system?.getEconomyColor?.(type, userColors) ?? null;
    }

    /**
     * Extract economy indicators for a given action.
     * @param {Action} action
     * @param {Record<string, unknown>} [userColors]
     * @returns {{ type: string, label: string, active: boolean, color: string|null, tooltip: string }[]}
     */
    extractEconomyIndicators(action: Action, userColors?: Record<string, unknown>): { type: string; label: string; active: boolean; color: string | null; tooltip: string }[] {
        return this.system?.extractEconomyIndicators?.(action, userColors) ?? [];
    }

    /**
     * Format a stylized HTML tooltip for an action economy reminder bar.
     * @param {{ id?: string, label?: string, defaultColor?: string }} sysType
     * @param {string|null} [color]
     * @returns {string}
     */
    formatEconomyTooltip(sysType: { id?: string; label?: string; defaultColor?: string }, color?: string | null): string {
        return this.system?.formatEconomyTooltip?.(sysType, color) ?? '';
    }

    /**
     * Retrieve active status effects causing automatic verbal/somatic spell component bans.
     * @param {Actor} actor
     * @returns {Record<'vocal'|'somatic', string[]>}
     */
    getAutoBanEffectReasons(actor: Actor): Record<'vocal' | 'somatic', string[]> {
        return this.system?.getAutoBanEffectReasons?.(actor) ?? { vocal: [], somatic: [] };
    }

    /**
     * Get the enriched HTML content-link for a status condition ID.
     * @param {string} condId
     * @param {string | null} [customLabel=null]
     * @returns {Promise<string>}
     */
    async enrichCondition(condId: string, customLabel: string | null = null): Promise<string> {
        return (await this.system?.enrichCondition?.(condId, customLabel)) ?? '';
    }

    /**
     * Format a stylized HTML tooltip for automatically added verbal/somatic bans.
     * @param {string} comp
     * @param {Array<unknown> | Record<string, Array<unknown>>} reasons
     * @returns {Promise<string>}
     */
    async formatAutoBanTooltip(comp: string, reasons: Array<unknown> | Record<string, Array<unknown>>): Promise<string> {
        return (await this.system?.formatAutoBanTooltip?.(comp, reasons)) ?? '';
    }

    /**
     * Get item summary data for rich tooltips.
     * @param {Action} action
     * @param {Item | null} [item=null]
     * @param {Actor | null} [actor=null]
     * @returns {Promise<ItemSummary | null>}
     */
    async getItemSummary(action: Action, item: Item | null = null, actor: Actor | null = null): Promise<ItemSummary | null> {
        return this.system?.getItemSummary?.(action, item, actor) ?? null;
    }

    /**
     * Enrich an HTML string with Foundry enrichers, roll data, and document links.
     * @param {string} content HTML string to enrich
     * @param {Record<string, unknown>} [options={}] Enrichment options (rollData, secrets, relativeTo, etc.)
     * @returns {Promise<string>}
     */
    async enrichHTML(content: string, options: Record<string, unknown> = {}): Promise<string> {
        return this.foundry.enrichHTML(content, options);
    }

    /**
     * Safely resolve a document from UUID synchronously via the active Foundry adapter.
     * @param {string} uuid Document UUID
     * @param {FromUuidOptions} [options={}] Resolution options
     * @returns {foundry.abstract.Document.Any | null}
     */
    fromUuidSync(uuid: string, options: FromUuidOptions = {}): foundry.abstract.Document.Any | null {
        return this.foundry.fromUuidSync(uuid, options);
    }

    /**
     * Safely resolve a document from UUID asynchronously via the active Foundry adapter.
     * @param {string} uuid Document UUID
     * @param {FromUuidOptions} [options={}] Resolution options
     * @returns {Promise<foundry.abstract.Document.Any | null>}
     */
    async fromUuid(uuid: string, options: FromUuidOptions = {}): Promise<foundry.abstract.Document.Any | null> {
        return this.foundry.fromUuid(uuid, options);
    }

    /**
     * Merge two objects recursively via the active Foundry adapter.
     * @param {object} original Target object
     * @param {object} [other={}] Source object
     * @param {Record<string, unknown>} [options={}] Merge options
     * @returns {object}
     */
    mergeObject<T extends object, U extends object>(original: T, other: U = {} as U, options: Record<string, unknown> = {}): T & U {
        return this.foundry.mergeObject(original, other, options);
    }

    /**
     * Deep duplicate an object via the active Foundry adapter.
     * @param {T} obj Target object
     * @returns {T}
     */
    duplicate<T>(obj: T): T {
        return this.foundry.duplicate(obj);
    }

    /**
     * Retrieve a property from an object by dot path via the active Foundry adapter.
     * @param {object} obj Target object
     * @param {string} path Dot path
     * @returns {unknown}
     */
    getProperty(obj: object, path: string): unknown {
        return this.foundry.getProperty(obj, path);
    }

    /**
     * Set a property on an object by dot path via the active Foundry adapter.
     * @param {object} obj Target object
     * @param {string} path Dot path
     * @param {unknown} value Property value
     * @returns {boolean}
     */
    setProperty(obj: object, path: string, value: unknown): boolean {
        return this.foundry.setProperty(obj, path, value);
    }

    /**
     * Generate a random string identifier via the active Foundry adapter.
     * @param {number} [length=16] Length of the identifier
     * @returns {string}
     */
    randomID(length: number = 16): string {
        return this.foundry.randomID(length);
    }

    /**
     * Test whether an object is empty via the active Foundry adapter.
     * @param {object} obj Target object
     * @returns {boolean}
     */
    isEmpty(obj: object): boolean {
        return this.foundry.isEmpty(obj);
    }

    /**
     * Test whether version v1 is strictly newer than version v0 via the active Foundry platform adapter.
     * @param {string|number} v1 Target version
     * @param {string|number} v0 Reference version to compare against
     * @param {object} [options] Comparison options
     * @returns {boolean}
     */
    isNewerVersion(v1: string | number, v0: string | number, options?: { majorOnly?: boolean }): boolean {
        return this.foundry.isNewerVersion(v1, v0, options);
    }

    /**
     * Preload Handlebars templates via the active Foundry platform adapter.
     * @param {string[]} paths Array of template paths
     * @returns {Promise<Function[]>}
     */
    async loadTemplates(paths: string[]): Promise<Function[]> {
        return this.foundry.loadTemplates(paths);
    }

    /**
     * Determine if the active user has execution/update authority over a document.
     * @param {Token} token
     * @param {User} [user]
     * @returns {boolean}
     */
    isUserInCharge(token: Token, user: User = game.user): boolean {
        return this.foundry.isUserInCharge(token, user);
    }

    /**
     * Test whether a token is visible to a user.
     * @param {Token} token
     * @param {User} [user]
     * @returns {boolean}
     */
    isTokenVisible(token: Token, user: User = game.user): boolean {
        return this.foundry.isTokenVisible(token, user);
    }

    /**
     * Select a token on canvas.
     * @param {Token} token
     */
    selectToken(token: Token): void {
        this.foundry.selectToken(token);
    }

    /**
     * Pan canvas center to token.
     * @param {Token} token
     * @returns {Promise<void>}
     */
    async centerCanvasOnToken(token: Token): Promise<void> {
        return this.foundry.centerCanvasOnToken(token);
    }
}

export const adapter = new Adapter();
export { Adapter, BaseFoundryAdapter, BaseSystemAdapter, BaseModuleAdapter };
