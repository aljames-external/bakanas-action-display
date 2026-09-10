import { MODULE_ID } from '../../constants.js';
import { log } from '../../lib/logger.js';
import { localize, deepFreeze } from '../../lib/utils.js';
import { Action } from '../../ui/action.js';
import { BaseFoundryAdapter } from '../foundry/base-foundry-adapter.js';
import { BaseSystemContextMenuManager } from './context-menu/base-system-context-menu-manager.js';
import { BaseSystemTabFilterManager } from './filter/base-system-tab-filter-manager.js';
import { BaseSystemContextModifier } from './context-modifier/base-system-context-modifier.js';
import { categorizeActions } from '../../categorization/categorization-manager.js';

const MODIFIER_KEY_MAP = {
    altKey: 'ALT',
    ctrlKey: 'CONTROL',
    shiftKey: 'SHIFT',
    metaKey: 'CONTROL'
} as const;

const EXCLUDED_ECONOMY_LABELS = new Set(['economy', 'none', 'all']);
const DEFAULT_ECONOMY_OTHER = deepFreeze({ id: 'other', defaultColor: '#64748b', defaultEnabled: false });

export interface ItemSummaryProperty {
    label?: string;
    value: string;
}

export interface ItemSummary {
    title: string;
    subtitle?: string;
    img?: string;
    properties?: Array<string | ItemSummaryProperty>;
    description?: string;
    [key: string]: unknown;
}

/**
 * Base class for all system-specific adapters.
 * System adapters are responsible for modifying, filtering, and sorting
 * the base list of usable items extracted by the core.
 * They also define the localization labels and icons for the HUD tabs.
 */
export class BaseSystemAdapter {
    systemId: string;
    isSupported: boolean;
    foundry: BaseFoundryAdapter;
    contextMenuManager: BaseSystemContextMenuManager;
    filterManager: BaseSystemTabFilterManager;
    contextModifier: BaseSystemContextModifier;

    /**
     * @param {string} systemId
     * @param {boolean} [isSupported=false]
     * @param {BaseFoundryAdapter} foundry
     */
    constructor(systemId: string, isSupported: boolean = false, foundry: BaseFoundryAdapter) {
        if (!(foundry instanceof BaseFoundryAdapter)) {
            throw new Error(`BaseSystemAdapter requires a valid BaseFoundryAdapter instance, received: ${foundry}`);
        }
        this.systemId = systemId;
        this.isSupported = Boolean(isSupported);
        this.foundry = foundry;
        this.contextMenuManager = new BaseSystemContextMenuManager(this);
        this.filterManager = new BaseSystemTabFilterManager(this);
        this.contextModifier = new BaseSystemContextModifier(this);
    }

    /**
     * Test whether version v1 is strictly newer than version v0 using the Foundry platform adapter.
     * @param {string|number} v1 Target version
     * @param {string|number} v0 Reference version to compare against
     * @param {object} [options] Comparison options
     * @returns {boolean}
     */
    isNewerVersion(v1: string | number, v0: string | number, options?: { majorOnly?: boolean }): boolean {
        return this.foundry.isNewerVersion(v1, v0, options);
    }

    /**
     * Enrich an HTML string using the Foundry platform adapter.
     * @param {string} content HTML string to enrich
     * @param {Record<string, unknown>} [options={}] Enrichment options
     * @returns {Promise<string>}
     */
    async enrichHTML(content: string, options: Record<string, unknown> = {}): Promise<string> {
        return this.foundry.enrichHTML(content, options);
    }

    /**
     * Safely resolve a document from UUID synchronously using the Foundry platform adapter.
     * @param {string} uuid Document UUID
     * @param {FromUuidOptions} [options={}] Resolution options
     * @returns {foundry.abstract.Document.Any|null}
     */
    fromUuidSync(uuid: string, options: FromUuidOptions = {}): foundry.abstract.Document.Any | null {
        return this.foundry.fromUuidSync(uuid, options);
    }

    /**
     * Safely resolve a document from UUID asynchronously using the Foundry platform adapter.
     * @param {string} uuid Document UUID
     * @param {FromUuidOptions} [options={}] Resolution options
     * @returns {Promise<foundry.abstract.Document.Any|null>}
     */
    async fromUuid(uuid: string, options: FromUuidOptions = {}): Promise<foundry.abstract.Document.Any | null> {
        return this.foundry.fromUuid(uuid, options);
    }

    /**
     * Merge two objects recursively using the Foundry platform adapter.
     * @param {Object} original Target object
     * @param {Object} [other={}] Source object
     * @param {Record<string, unknown>} [options={}] Merge options
     * @returns {Object}
     */
    mergeObject<T extends object, U extends object>(original: T, other: U = {} as U, options: Record<string, unknown> = {}): T & U {
        return this.foundry.mergeObject(original, other, options);
    }

    /**
     * Deep duplicate an object using the Foundry platform adapter.
     * @param {*} obj Target object
     * @returns {*}
     */
    duplicate<T>(obj: T): T {
        return this.foundry.duplicate(obj);
    }

    /**
     * Retrieve a property from an object by dot path using the Foundry platform adapter.
     * @param {object} obj Target object
     * @param {string} path Dot path
     * @returns {*}
     */
    getProperty(obj: object, path: string): unknown {
        return this.foundry.getProperty(obj, path);
    }

    /**
     * Set a property on an object by dot path using the Foundry platform adapter.
     * @param {object} obj Target object
     * @param {string} path Dot path
     * @param {*} value Property value
     * @returns {boolean}
     */
    setProperty(obj: object, path: string, value: unknown): boolean {
        return this.foundry.setProperty(obj, path, value);
    }

    getContextMenuItems(app: unknown): unknown[] {
        return this.contextMenuManager.getContextMenuItems(app);
    }

    onTabRightClick(app: unknown, el: HTMLElement, event: Event | MouseEvent): boolean {
        return this.contextMenuManager.onTabRightClick(app, el, event);
    }

    // #region User Interaction Events & Helpers

    /**
     * Create a proxy around a browser event to inject keyboard modifiers (Alt/Ctrl/Shift)
     * while preserving all other native event properties and methods (like target, preventDefault).
     * @param {Event} [event] The original browser event
     * @returns {unknown} A proxy event or empty object
     * @protected
     */
    _createRollEvent(event?: unknown): any {
        if (!event) return {};

        return new Proxy(event, {
            get: (target, prop) => {
                const propStr = String(prop);
                if (propStr in MODIFIER_KEY_MAP) {
                    const keyProp = propStr as keyof typeof MODIFIER_KEY_MAP;
                    const eventVal = Boolean((target as Record<string, unknown>)[keyProp]);
                    if (eventVal) return true;

                    try {
                        const isDown = game.keyboard?.isModifierActive?.(MODIFIER_KEY_MAP[keyProp]);
                        return Boolean(isDown);
                    } catch {
                        return false;
                    }
                }
                const val = Reflect.get(target, prop);
                return typeof val === 'function' ? val.bind(target) : val;
            }
        });
    }

    // #endregion

    // #region Core Action Modification

    /**
     * Determine if a specific item should be extracted as a base action.
     * Overridden by system adapters to prevent allocating objects for items that will be discarded.
     * @param {Item} item The Foundry Item instance
     * @returns {boolean} True if the item should be extracted
     */
    shouldExtractItem(item: Item): boolean {
        return true;
    }

    /**
     * Determine whether an item is currently equipped.
     * Overridden by system adapters to query system-specific equip data structures.
     * @param {Item} item The Foundry Item instance
     * @returns {boolean} True if the item is equipped
     */
    getItemEquipped(item: Item): boolean {
        return true;
    }

    /**
     * Check if an action's uses resource is completely depleted.
     * @param {Action} action The action or subaction item
     * @returns {boolean} True if available uses is 0 or less
     * @protected
     */
    _isResourceDepleted(action: Action): boolean {
        return this.filterManager.isResourceDepleted(action);
    }

    /**
     * Modify the base list of actions.
     * @param {Action[]} actions Base actions extracted by the core
     * @param {Actor} actor The actor these actions belong to
     * @returns {Promise<Action[]>} The modified/filtered/sorted actions list
     */
    async modifyActions(actions: Action[], actor: Actor): Promise<Action[]> {
        if (Boolean(game?.settings?.get(MODULE_ID, 'showDepleted'))) return actions;

        log.group(`BaseSystemAdapter.modifyActions | Filtering depleted actions for "${actor?.name ?? 'Actor'}"`, 'debug');
        try {
            return actions.filter((action: Action) => {
                // Never hide weapons, even if they are out of ammo or charges
                if (action.originalItem?.type === 'weapon') return true;
                if (this._isResourceDepleted(action)) {
                    log.debug(`BaseSystemAdapter.modifyActions | Filtering out "${action.name}" (ID: ${action.id}) — action.uses.available (${action.uses?.available}) <= 0 and showDepleted is disabled`);
                    return false;
                }
                return true;
            });
        } finally {
            log.groupEnd();
        }
    }

    extractCheckActions(actor?: Actor): Action[] {
        return [];
    }

    /**
     * Extract token information showcase actions for Page 3.
     * @param {Actor} [actor]
     * @returns {Action[]}
     */
    extractInfoActions(actor?: Actor): Action[] {
        if (!actor) return [];
        const infoAction = new Action({
            id: `token-info-${actor.id ?? 'actor'}`,
            name: actor.name ?? localize('BAD.page3.tokenInfo', 'Token Info'),
            type: 'info',
            img: actor.img ?? 'icons/svg/mystery-man.svg',
            available: true,
            page: 3,
            uses: { available: null, max: null }
        });
        return [infoAction];
    }

    /**
     * Extract structured token information for showcase display.
     * @param {Actor|null} actor
     * @param {Token|null} [token]
     * @returns {Promise<Object|null>}
     */
    async getTokenInfo(actor: Actor | null, token: Token | null = null): Promise<any> {
        return null;
    }

    /**
     * Determine if an actor supports inspiration and retrieve its current status.
     * Legacy NOP contract: Non-5e systems return supported: false.
     * @param {Actor} actor Target actor document
     * @returns {{ supported: boolean, value: boolean }}
     */
    getInspiration(actor: Actor): { supported: boolean; value: boolean } {
        return { supported: false, value: false };
    }

    /**
     * Toggle or set inspiration on an actor.
     * Legacy NOP contract: Non-5e systems return false.
     * @param {Actor} actor Target actor document
     * @param {boolean} [force] Optional explicit state to set
     * @returns {Promise<boolean>} Resulting inspiration state
     */
    async toggleInspiration(actor: Actor, force?: boolean): Promise<boolean> {
        return false;
    }

    /**
     * Retrieve the distance the token has moved in the current combat turn.
     * Legacy NOP contract: returns non-combat 0 distance.
     * @param {Token|null} [token=null]
     * @param {Actor|null} [actor=null]
     * @returns {{ inCombat: boolean, distance: number, units: string }}
     */
    getTurnMovement(token: Token | null = null, actor: Actor | null = null): { inCombat: boolean; distance: number; units: string } {
        return { inCombat: false, distance: 0, units: 'ft' };
    }

    /**
     * Open the sheet or edit dialog for an action or its underlying item/activity.
     * @param {Action} action The Action instance to edit
     */
    openEditSheet(action: Action): void {
        const entity = (action.originalActivity ?? action.originalItem) as { sheet?: { render: (force: boolean) => void }; edit?: () => void } | null;
        if (entity?.sheet?.render) {
            entity.sheet.render(true);
        } else if (entity?.edit) {
            entity.edit();
        } else if (action.originalItem?.sheet?.render) {
            action.originalItem.sheet.render(true);
        }
    }

    /**
     * Get the page definition configuration for a given page number.
     * Overridable by system adapters to specify whether a page defaults to flat, categorized, or info showcase.
     * By default, returns a flat layout for all pages.
     *
     * @param {number} [page=1] Page number (1-indexed)
     * @param {Actor|null} [actor=null] Target actor document
     * @returns {{ page: number, defaultLayout: string, categories: Object[]|null }}
     */
    getPageConfig(page: number = 1, actor: Actor | null = null): { page: number; defaultLayout: string; categories: Record<string, any>[] | null } {
        const pageNum = Number.isFinite(page) && page > 0 ? page : 1;
        return {
            page: pageNum,
            defaultLayout: 'flat',
            categories: null
        };
    }

    /**
     * Apply a flat layout template to the HUD context.
     * @param {Record<string, any>} context The Handlebars render context
     */
    formatFlatLayout(context: Record<string, any>): void {
        context.layout = 'flat';
    }

    /**
     * Apply a categorized section layout template to the HUD context using default or provided categories.
     * Removes subcategories from default categories so it only displays the main categorization sections.
     *
     * @param {Record<string, any>} context The Handlebars render context
     * @param {Object} [options]
     * @param {Record<string, any>[]|null} [options.categories] Category definitions to apply (defaults to getDefaultCategories() without subcategories)
     * @param {string|null} [options.catchAllLabel] Localized label for uncategorized items
     * @param {Actor|null} [options.actor] Actor document
     * @param {Token|null} [options.token] Token document
     * @param {User|null} [options.user] User document
     */
    formatCategorizedLayout(context: Record<string, unknown>, { categories = null, catchAllLabel = null, actor = null, token = null, user = null }: { categories?: Record<string, unknown>[] | null; catchAllLabel?: string | null; actor?: Actor | null; token?: Token | null; user?: User | null } = {}): void {
        context.layout = 'categorized';
        const rawCats = categories ?? this.getDefaultCategories();
        const cats = (rawCats ?? []).map(cat => (categories ? cat : { ...cat, subcategories: [] }));
        const others = catchAllLabel ?? localize('BAD.categorization.others', 'Other Actions');
        const categorized = categorizeActions((context.items as Action[]) ?? [], { enabled: true, categories: cats }, others, {
            actor: actor ?? (context.actor as Actor | null),
            token: token ?? (context.token as Token | null),
            user: user ?? game.user
        });
        context.isCategorized = true;
        context.categorizedSections = categorized ?? [];
    }

    /**
     * Apply a token information layout template to the HUD context.
     * @param {Record<string, unknown>} context The Handlebars render context
     * @param {Actor|null} [actor]
     * @param {Token|null} [token]
     */
    async formatTokenInfoLayout(context: Record<string, unknown>, actor: Actor | null = null, token: Token | null = null): Promise<void> {
        context.layout = 'tokenInfo';
        context.isCategorized = false;
        context.itemTypes = [];
        context.actionTypes = [];
        context.tokenInfo = await this.getTokenInfo(actor, token);
    }

    // #endregion

    // #region Internal Filtering Logic

    /**
     * Set-algebraic filter tree evaluator.
     * Evaluates an Action instance against active UI filter groups using parent tab combinators:
     * - 'difference' (AND NOT): If action matches any active difference sub-tab, return false.
     * - 'union' (OR): Action must match at least one active union parent group.
     * - 'intersection' (AND): Action must match all active intersection sub-tabs.
     * 
     * @param {Action} action Action instance to evaluate
     * @param {FilterContext} filterContext Current HUD filter context { left, right, filterNoResources }
     * @returns {boolean} True if the action matches current filter selection
     */
    matchesEconomyTabs(action: Action, filterContext: FilterContext): boolean {
        return this.filterManager.matchesEconomyTabs(action, filterContext);
    }

    getActiveExclusionSubs(filterContext: FilterContext): string[] {
        return this.filterManager.getActiveExclusionSubs(filterContext);
    }

    filterSubactions(subactions: Action[], filterContext: FilterContext, itemLeft?: string[]): Action[] {
        return this.filterManager.filterSubactions(subactions, filterContext, itemLeft);
    }

    getTabCombinator(parentId: string): 'union' | 'intersection' | 'difference' {
        return this.filterManager.getTabCombinator(parentId);
    }

    isExclusionTab(parentId: string): boolean {
        return this.filterManager.isExclusionTab(parentId);
    }

    getExclusionSubTabs(parentId: string): string[] {
        return this.filterManager.getExclusionSubTabs(parentId);
    }

    isIntersectionTab(parentId: string): boolean {
        return this.filterManager.isIntersectionTab(parentId);
    }

    // #endregion

    // #region Localizations & UI Formatting

    /**
     * Modify the UI context object before template rendering.
     * Overridable by system adapters to augment context or apply custom page layouts.
     * @param {Record<string, unknown>} context The Handlebars render context
     * @param {{ activePage?: number; actor?: Actor | null; token?: Token | null; [key: string]: unknown }} app The UI application instance
     * @returns {Promise<Record<string, unknown>>|Record<string, unknown>} The modified context
     */
    modifyContext(context: Record<string, unknown>, app: { activePage?: number; actor?: Actor | null; token?: Token | null; [key: string]: unknown }): Promise<Record<string, unknown>> | Record<string, unknown> {
        const activePage = Number(app?.activePage ?? 1);
        const pageConfig = this.getPageConfig(activePage, app?.actor);

        if (pageConfig.defaultLayout === 'tokenInfo') {
            return this.formatTokenInfoLayout(context, app?.actor, app?.token).then(() => context);
        } else if (pageConfig.defaultLayout === 'categorized' && !context.isCategorized) {
            this.formatCategorizedLayout(context, {
                categories: pageConfig.categories,
                actor: app?.actor,
                token: app?.token
            });
        } else if (!context.layout) {
            this.formatFlatLayout(context);
        }

        const res = this.contextModifier.modifyContext(context, app);
        if (res instanceof Promise) {
            return res.then(() => context);
        }
        return context;
    }

    getItemTypeSortOrder(parentId: string): number {
        return this.contextModifier.getItemTypeSortOrder(parentId);
    }

    getItemSubTabSortOrder(parentId: string, subId: string): number {
        return this.contextModifier.getItemSubTabSortOrder(parentId, subId);
    }

    getActionTypeSortOrder(parentId: string): number {
        return this.contextModifier.getActionTypeSortOrder(parentId);
    }

    getActionSubTabSortOrder(parentId: string, subId: string): number {
        return this.contextModifier.getActionSubTabSortOrder(parentId, subId);
    }

    getItemTypeLabel(parentId: string): string {
        return this.contextModifier.getItemTypeLabel(parentId);
    }

    getItemTypeIcon(parentId: string): string {
        return this.contextModifier.getItemTypeIcon(parentId);
    }

    getItemSubTabLabel(parentId: string, subId: string): string {
        return this.contextModifier.getItemSubTabLabel(parentId, subId);
    }

    getActionTypeLabel(parentId: string): string {
        return this.contextModifier.getActionTypeLabel(parentId);
    }

    getActionTypeIcon(parentId: string): string {
        return this.contextModifier.getActionTypeIcon(parentId);
    }

    getActionSubTabLabel(subId: string): string {
        return this.contextModifier.getActionSubTabLabel(subId);
    }

    getDefaultActiveLeftSubTypes(): string[] {
        return [];
    }

    getDefaultActiveSubTypes(): string[] {
        return [];
    }

    /**
     * Update active tabs and filter state on actor changes (e.g. status conditions, spell components, resources).
     * Subclasses override to provide system-specific tab synchronization (e.g. D&D 5e spell component auto-banning).
     * @param {Actor} actor
     * @param {HUDTabColumn} [tabColumn]
     */
    updateTabs(actor: Actor, tabColumn: HUDTabColumn | null = null): void {
        // NOP for base system adapter
    }

    /**
     * Record a manual tab/sub-tab user interaction for system-specific override tracking.
     * Subclasses override if they manage manual state (e.g. D&D 5e manual unbanning).
     * @param {Actor} actor
     * @param {string} parentId
     * @param {string} subId
     * @param {boolean} isActive
     */
    recordManualTabToggle(actor: Actor, parentId: string, subId: string, isActive: boolean) {
        // NOP for base system adapter
    }

    /**
     * Get the list of configurable action economy types and default colors for this system.
     * @returns {{ id: string, label: string, defaultColor: string, defaultEnabled: boolean }[]}
     */
    getEconomyTypes() {
        return [
            { id: 'action', label: this.getActionSubTabLabel('action') ?? 'Action', defaultColor: '#3b82f6', defaultEnabled: true },
            { id: 'bonus', label: this.getActionSubTabLabel('bonus') ?? 'Bonus Action', defaultColor: '#14b8a6', defaultEnabled: true },
            { id: 'reaction', label: this.getActionSubTabLabel('reaction') ?? 'Reaction', defaultColor: '#ef4444', defaultEnabled: true },
            { id: 'special', label: this.getActionSubTabLabel('special') ?? 'Special', defaultColor: '#a855f7', defaultEnabled: true },
            { id: 'other', label: this.getActionSubTabLabel('other') ?? 'Other', defaultColor: '#64748b', defaultEnabled: false }
        ];
    }

    /**
     * Determine if an economy type is currently enabled based on system defaults and user configuration.
     * @param {Object} type Economy type definition from getEconomyTypes()
     * @param {Record<string, any>} [userColors={}] User configured colors & enablement
     * @returns {boolean}
     */
    isEconomyTypeEnabled(type: { id: string; defaultEnabled?: boolean }, userColors: Record<string, any> = {}): boolean {
        if (!type?.id || type.id === 'none' || type.id === 'all') return false;

        const disabled = userColors.disabled;
        const isDisabled = Boolean(disabled?.has?.(type.id) ?? disabled?.includes?.(type.id) ?? disabled?.[type.id]);
        if (isDisabled) return false;

        const enabled = userColors.enabled;
        const isEnabled = Boolean(enabled?.has?.(type.id) ?? enabled?.includes?.(type.id) ?? enabled?.[type.id]);
        if (isEnabled) return true;

        return Boolean(type.defaultEnabled);
    }

    /**
     * Get the mapped color for an action economy type.
     * @param {string} type Economy type identifier
     * @param {Record<string, any>} [userColors={}] User configured color overrides
     * @returns {string|null} Hex color string or null if unmapped or disabled
     */
    getEconomyColor(type: string, userColors: Record<string, any> = {}): string | null {
        if (!type || type === 'none' || type === 'all') return null;

        const types = this.getEconomyTypes() ?? [];
        const found = types.find(t => t.id === type);
        const otherDef = types.find(t => t.id === 'other') ?? DEFAULT_ECONOMY_OTHER;
        const typeDef = found ?? otherDef;

        if (!this.isEconomyTypeEnabled(typeDef, userColors)) {
            return null;
        }

        if (userColors[type]) return userColors[type];
        if (found?.defaultColor) return found.defaultColor;
        return userColors['other'] ?? otherDef.defaultColor ?? '#64748b';
    }

    /**
     * Extract economy indicators for a given action.
     * Returns an array of fixed indicator slots for all enabled economy types in canonical sort order,
     * allowing the allocated indicator space to be divided equally among all enabled bars.
     * @param {Action} action HUD Action object
     * @param {Record<string, any>} [userColors={}] User configured color overrides
     * @returns {{ type: string, label: string, active: boolean, color: string|null, tooltip: string }[]}
     */
    extractEconomyIndicators(action: Action, userColors: Record<string, any> = {}): { type: string; label: string; active: boolean; color: string | null; tooltip: string }[] {
        if (!action) return [];

        const systemTypes = this.getEconomyTypes() ?? [];
        const enabledTypes = systemTypes.filter(t => this.isEconomyTypeEnabled(t, userColors));
        if (!enabledTypes.length) return [];

        const activeTypes = new Set<string>();
        if (action.subactions?.length) {
            for (const sub of action.subactions) {
                const econRef = sub.right?.find(r => r?.root === 'economy');
                const subType = econRef?.label;
                if (subType && !EXCLUDED_ECONOMY_LABELS.has(subType)) {
                    activeTypes.add(subType);
                }
            }
        } else if (action.right?.length) {
            const econRef = action.right.find(r => r?.root === 'economy');
            const subType = econRef?.label;
            if (subType && !EXCLUDED_ECONOMY_LABELS.has(subType)) {
                activeTypes.add(subType);
            }
        }

        // Map any unmapped active types to 'other' if 'other' is enabled
        const otherDef = systemTypes.find(t => t.id === 'other') ?? DEFAULT_ECONOMY_OTHER;
        let hasUnmapped = false;
        for (const t of activeTypes) {
            if (!systemTypes.some(st => st.id === t)) {
                hasUnmapped = true;
                break;
            }
        }
        if (hasUnmapped && this.isEconomyTypeEnabled(otherDef, userColors)) {
            activeTypes.add('other');
        }

        const indicators: { type: string; label: string; active: boolean; color: string | null; tooltip: string }[] = [];
        for (const sysType of enabledTypes) {
            const isActive = activeTypes.has(sysType.id);
            const color = isActive ? this.getEconomyColor(sysType.id, userColors) : null;
            const tooltip = isActive ? this.formatEconomyTooltip(sysType, color) : '';
            indicators.push({
                type: sysType.id,
                label: sysType.label,
                active: isActive,
                color,
                tooltip
            });
        }
        return indicators;
    }

    /**
     * Format a stylized HTML tooltip for an action economy reminder bar.
     * @param {Object} sysType System economy type definition
     * @param {string|null} [color=null] Active bar color
     * @returns {string} HTML string for the tooltip
     */
    formatEconomyTooltip(sysType: { id?: string; label?: string; defaultColor?: string }, color: string | null = null): string {
        const econColor = color ?? sysType?.defaultColor ?? '#64748b';
        const label = sysType?.label ?? sysType?.id ?? '';
        return `<div class="bad-economy-tooltip"><div class="bad-economy-tooltip-header"><span class="bad-economy-tooltip-bar" style="background-color: ${econColor}; box-shadow: 0 0 6px ${econColor};"></span><span class="bad-economy-tooltip-label">${label}</span></div></div>`;
    }

    /**
     * Get the default HUD categorization structure for this system.
     * @returns {Object[]} Array of category definition objects
     */
    getDefaultCategories(): Record<string, unknown>[] {
        return [
            {
                id: 'cat_favorites',
                name: 'Favorites',
                expression: `actor.getFlag('bakana-action-display', 'favorites')?.[item.id]`,
                subcategories: []
            },
            {
                id: 'cat_weapons',
                name: 'Weapons',
                expression: `item.type === 'weapon'`,
                subcategories: []
            },
            {
                id: 'cat_spells',
                name: 'Spells',
                expression: `item.type === 'spell'`,
                subcategories: []
            },
            {
                id: 'cat_features',
                name: 'Features',
                expression: `item.type === 'feat'`,
                subcategories: []
            }
        ];
    }

    // #endregion

    // #region Favorites Integration

    /**
     * Whether this system adapter supports native favoriting.
     * @returns {boolean}
     */
    hasFavorites(): boolean {
        return false;
    }

    /**
     * Check if an item is favorited on the actor using system-specific logic.
     *
     * @param {Actor} actor Actor document
     * @param {Item} item Item document
     * @returns {boolean} True if the item is favorited
     */
    isFavorite(actor: Actor, item: Item): boolean {
        return false;
    }

    /**
     * Set or unset favorite status on an item in a system-specific manner.
     *
     * @param {Actor} actor Actor document
     * @param {Item} item Item document
     * @param {boolean} favorite True to favorite, false to unfavorite
     * @returns {Promise<any>|null} Result of update or null if unsupported
     */
    async setFavorite(actor: Actor, item: Item, favorite: boolean): Promise<any> {
        return null;
    }

    // #endregion

    // #region Tooltip Item Summary

    /**
     * Build an item summary object for rich tooltips.
     * @param {Action} action The HUD action instance
     * @param {Item|null} [item] The original item document
     * @param {Actor|null} [actor] The owning actor document
     * @returns {{title: string, subtitle?: string, img?: string, properties?: Array<string|{label?: string, value: string}>, description?: string}|null}
     */
    async getItemSummary(action: Action, item: Item | null = action?.originalItem ?? null, actor: Actor | null = null): Promise<ItemSummary | null> {
        if (!action && !item) return null;
        const targetItem = (item ?? action?.originalItem ?? action);
        const title = action?.name ?? targetItem?.name ?? '';
        const img = (action?.img && action.img.length > 0) ? action.img : (targetItem?.img ?? '');
        const itemType = targetItem?.type;
        const type = itemType ? (itemType.charAt(0).toUpperCase() + itemType.slice(1)) : '';
        const properties: Array<string | ItemSummaryProperty> = [];

        const range = targetItem?.system?.range?.value
            ? `${targetItem.system.range.value} ${targetItem.system.range.units ?? ''}`.trim()
            : null;
        if (range) properties.push({ label: 'Range', value: range });

        const damage = targetItem?.system?.damage?.value ?? targetItem?.system?.damage?.parts?.[0]?.[0] ?? null;
        if (damage) properties.push({ label: 'Damage', value: damage });

        if (action?.uses?.available != null) {
            const usesStr = `${action.uses.available}${action.uses.max ? ` / ${action.uses.max}` : ''}`;
            properties.push({ label: 'Uses', value: usesStr });
        }

        let description = targetItem?.system?.description?.value ?? targetItem?.system?.description ?? '';
        if (description) {
            const rollData = targetItem?.getRollData?.() ?? actor?.getRollData?.() ?? {};
            description = await this.enrichHTML(description, {
                rollData,
                relativeTo: targetItem ?? actor,
                secrets: false,
                async: true
            });
        }

        return {
            title,
            subtitle: type,
            img,
            properties,
            description
        };
    }

    // #endregion

    // #region AutoBan Contracts (Default NOP)

    /**
     * Retrieve active status effects causing automatic verbal/somatic spell component bans.
     * Legacy NOP contract: Non-5e systems return empty vocal/somatic arrays.
     * @param {Actor} [actor]
     * @returns {Record<'vocal'|'somatic', Array<*>>}
     */
    getAutoBanEffectReasons(actor?: Actor): Record<'vocal'|'somatic', any[]> {
        return { vocal: [], somatic: [] };
    }

    /**
     * Get the enriched HTML content-link for a status condition ID.
     * Legacy NOP contract: Non-5e systems return empty string.
     * @param {string} condId
     * @param {string|null} [customLabel]
     * @returns {Promise<string>}
     */
    async enrichCondition(condId: string, customLabel: string | null = null): Promise<string> {
        return '';
    }

    /**
     * Format a stylized HTML tooltip for automatically added verbal/somatic bans.
     * Legacy NOP contract: Non-5e systems return empty string.
     * @param {string} comp
     * @param {Array<Object|string>|Record<string, Array<Object|string>>} reasons
     * @returns {Promise<string>}
     */
    async formatAutoBanTooltip(comp: string, reasons: unknown): Promise<string> {
        return '';
    }

    // #endregion
}
