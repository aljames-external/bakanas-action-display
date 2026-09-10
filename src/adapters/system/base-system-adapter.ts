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
    altKey: 'Alt',
    ctrlKey: 'Control',
    shiftKey: 'Shift'
};

const EXCLUDED_ECONOMY_LABELS = new Set(['economy', 'none', 'all']);
const DEFAULT_ECONOMY_OTHER = deepFreeze({ id: 'other', defaultColor: '#64748b', defaultEnabled: false });

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
     * Test whether version a is strictly newer than version b using the Foundry platform adapter.
     * @param {string} a Primary version string
     * @param {string} b Target version string to compare against
     * @returns {boolean}
     */
    isNewerVersion(a: any, b: any) {
        return this.foundry.isNewerVersion(a, b);
    }

    /**
     * Enrich an HTML string using the Foundry platform adapter.
     * @param {string} content HTML string to enrich
     * @param {Object} [options={}] Enrichment options
     * @returns {Promise<string>}
     */
    async enrichHTML(content: any, options = {}) {
        return this.foundry.enrichHTML(content, options);
    }

    /**
     * Safely resolve a document from UUID synchronously using the Foundry platform adapter.
     * @param {string} uuid Document UUID
     * @param {Object} [options={}] Resolution options
     * @returns {Document|null}
     */
    fromUuidSync(uuid: any, options = {}) {
        return this.foundry.fromUuidSync(uuid, options);
    }

    /**
     * Safely resolve a document from UUID asynchronously using the Foundry platform adapter.
     * @param {string} uuid Document UUID
     * @param {Object} [options={}] Resolution options
     * @returns {Promise<Document|null>}
     */
    async fromUuid(uuid: any, options = {}) {
        return this.foundry.fromUuid(uuid, options);
    }

    /**
     * Merge two objects recursively using the Foundry platform adapter.
     * @param {Object} original Target object
     * @param {Object} [other={}] Source object
     * @param {Object} [options={}] Merge options
     * @returns {Object}
     */
    mergeObject(original: any, other = {}, options = {}) {
        return this.foundry.mergeObject(original, other, options);
    }

    /**
     * Deep duplicate an object using the Foundry platform adapter.
     * @param {Object} obj Target object
     * @returns {Object}
     */
    duplicate(obj: any) {
        return this.foundry.duplicate(obj);
    }

    /**
     * Retrieve a property from an object by dot path using the Foundry platform adapter.
     * @param {Object} obj Target object
     * @param {string} path Dot path
     * @returns {*}
     */
    getProperty(obj: any, path: any) {
        return this.foundry.getProperty(obj, path);
    }

    /**
     * Set a property on an object by dot path using the Foundry platform adapter.
     * @param {Object} obj Target object
     * @param {string} path Dot path
     * @param {*} value Property value
     * @returns {boolean}
     */
    setProperty(obj: any, path: any, value: any) {
        return this.foundry.setProperty(obj, path, value);
    }

    getContextMenuItems(app: any) {
        return this.contextMenuManager.getContextMenuItems(app);
    }

    onTabRightClick(app: any, el: any, event: any) {
        return this.contextMenuManager.onTabRightClick(app, el, event);
    }

    // #region User Interaction Events & Helpers

    /**
     * Create a proxy around a browser event to inject keyboard modifiers (Alt/Ctrl/Shift)
     * while preserving all other native event properties and methods (like target, preventDefault).
     * @param {Event} event The original browser event
     * @returns {Event|object} A proxy event or empty object
     * @protected
     */
    _createRollEvent(event: any) {
        if (!event) return {};

        return new Proxy(event, {
            get: (target, prop) => {
                if (prop in MODIFIER_KEY_MAP) {
                    return Boolean((event as any)[prop] || game.keyboard?.isModifierActive((MODIFIER_KEY_MAP as Record<string, any>)[prop as string]));
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
    shouldExtractItem(item: any) {
        return true;
    }

    /**
     * Check if an action's uses resource is completely depleted.
     * @param {Object} action The action or subaction item
     * @returns {boolean} True if available uses is 0 or less
     * @protected
     */
    _isResourceDepleted(action: any) {
        return this.filterManager.isResourceDepleted(action);
    }

    /**
     * Modify the base list of actions.
     * @param {Object[]} actions Base actions extracted by the core
     * @param {Actor} actor The actor these actions belong to
     * @returns {Object[]} The modified/filtered/sorted actions list
     */
    async modifyActions(actions: any, actor: any) {
        if (Boolean(game?.settings?.get(MODULE_ID, 'showDepleted'))) return actions;

        log.group(`BaseSystemAdapter.modifyActions | Filtering depleted actions for "${actor?.name ?? 'Actor'}"`, 'debug');
        try {
            return actions.filter((action: any) => {
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

    extractCheckActions(actor?: any): any[] {
        return [];
    }

    /**
     * Extract token information showcase actions for Page 3.
     * @param {Actor} actor
     * @returns {Action[]}
     */
    extractInfoActions(actor?: any): any[] {
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
     * @param {Actor} actor
     * @param {Token} [token]
     * @returns {Promise<Object|null>}
     */
    async getTokenInfo(actor: any, token: Token | null = null): Promise<any> {
        return null;
    }

    /**
     * Determine if an actor supports inspiration and retrieve its current status.
     * Legacy NOP contract: Non-5e systems return supported: false.
     * @param {Actor} actor Target actor document
     * @returns {{ supported: boolean, value: boolean }}
     */
    getInspiration(actor: any) {
        return { supported: false, value: false };
    }

    /**
     * Toggle or set inspiration on an actor.
     * Legacy NOP contract: Non-5e systems return false.
     * @param {Actor} actor Target actor document
     * @param {boolean} [force] Optional explicit state to set
     * @returns {Promise<boolean>} Resulting inspiration state
     */
    async toggleInspiration(actor: any, force: any) {
        return false;
    }

    /**
     * Retrieve the distance the token has moved in the current combat turn.
     * Legacy NOP contract: returns non-combat 0 distance.
     * @param {Token|null} [token=null]
     * @param {Actor|null} [actor=null]
     * @returns {{ inCombat: boolean, distance: number, units: string }}
     */
    getTurnMovement(token = null, actor = null) {
        return { inCombat: false, distance: 0, units: 'ft' };
    }

    /**
     * Open the sheet or edit dialog for an action or its underlying item/activity.
     * @param {Object} action The Action instance to edit
     */
    openEditSheet(action: any) {
        const entity = action?.originalActivity ?? action?.originalItem;
        if (entity?.sheet?.render) {
            entity.sheet.render(true);
        } else if (entity?.edit) {
            entity.edit();
        } else if (action?.originalItem?.sheet?.render) {
            action.originalItem.sheet.render(true);
        }
    }

    /**
     * Get the page definition configuration for a given page number.
     * Overridable by system adapters to specify whether a page defaults to flat, categorized, or info showcase.
     * By default, returns a flat layout for all pages.
     *
     * @param {number} [page=1] Page number (1-indexed)
     * @param {Actor} [actor=null] Target actor document
     * @returns {{ page: number, defaultLayout: string, categories: Object[]|null }}
     */
    getPageConfig(page = 1, actor = null) {
        const parsed = Number(page);
        const pageNum = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
        return {
            page: pageNum,
            defaultLayout: 'flat',
            categories: null
        };
    }

    /**
     * Apply a flat layout template to the HUD context.
     * @param {Object} context The Handlebars render context
     */
    formatFlatLayout(context: any) {
        context.layout = 'flat';
    }

    /**
     * Apply a categorized section layout template to the HUD context using default or provided categories.
     * Removes subcategories from default categories so it only displays the main categorization sections.
     *
     * @param {Object} context The Handlebars render context
     * @param {Object} [options]
     * @param {Object[]} [options.categories] Category definitions to apply (defaults to getDefaultCategories() without subcategories)
     * @param {string} [options.catchAllLabel] Localized label for uncategorized items
     * @param {Actor} [options.actor] Actor document
     * @param {Token} [options.token] Token document
     * @param {User} [options.user] User document
     */
    formatCategorizedLayout(context: any, { categories = null, catchAllLabel = null, actor = null, token = null, user = null } = {}) {
        context.layout = 'categorized';
        const rawCats = categories ?? this.getDefaultCategories();
        const cats = (rawCats ?? []).map(cat => (categories ? cat : { ...cat, subcategories: [] }));
        const others = catchAllLabel ?? localize('BAD.categorization.others', 'Other Actions');
        const categorized = categorizeActions(context.items ?? [], { enabled: true, categories: cats }, others, {
            actor: actor ?? context.actor,
            token: token ?? context.token,
            user: user ?? game.user
        });
        context.isCategorized = true;
        context.categorizedSections = categorized ?? [];
    }

    /**
     * Apply a token information layout template to the HUD context.
     * @param {Object} context The Handlebars render context
     * @param {Actor} [actor]
     * @param {Token} [token]
     */
    async formatTokenInfoLayout(context: any, actor = null, token: Token | null = null) {
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
     * @param {Object} filterContext Current HUD filter context { left, right, filterNoResources }
     * @returns {boolean} True if the action matches current filter selection
     */
    matchesEconomyTabs(action: any, filterContext: any) {
        return this.filterManager.matchesEconomyTabs(action, filterContext);
    }

    getActiveExclusionSubs(filterContext: any) {
        return this.filterManager.getActiveExclusionSubs(filterContext);
    }

    filterSubactions(subactions: any, filterContext: any, itemLeft?: any) {
        return this.filterManager.filterSubactions(subactions, filterContext, itemLeft);
    }

    getTabCombinator(parentId: any) {
        return this.filterManager.getTabCombinator(parentId);
    }

    isExclusionTab(parentId: any) {
        return this.filterManager.isExclusionTab(parentId);
    }

    getExclusionSubTabs(parentId: any) {
        return this.filterManager.getExclusionSubTabs(parentId);
    }

    isIntersectionTab(parentId: any) {
        return this.filterManager.isIntersectionTab(parentId);
    }

    // #endregion

    // #region Localizations & UI Formatting

    /**
     * Modify the UI context object before template rendering.
     * Overridable by system adapters to augment context or apply custom page layouts.
     * @param {Object} context The Handlebars render context
     * @param {ActionDisplayApp} app The UI application instance
     * @returns {Promise<Object>|Object} The modified context
     */
    modifyContext(context: any, app: any) {
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

        return this.contextModifier.modifyContext(context, app) ?? context;
    }

    getItemTypeSortOrder(parentId: any) {
        return this.contextModifier.getItemTypeSortOrder(parentId);
    }

    getItemSubTabSortOrder(parentId: any, subId: any) {
        return this.contextModifier.getItemSubTabSortOrder(parentId, subId);
    }

    getActionTypeSortOrder(parentId: any) {
        return this.contextModifier.getActionTypeSortOrder(parentId);
    }

    getActionSubTabSortOrder(parentId: any, subId: any) {
        return this.contextModifier.getActionSubTabSortOrder(parentId, subId);
    }

    getItemTypeLabel(parentId: any) {
        return this.contextModifier.getItemTypeLabel(parentId);
    }

    getItemTypeIcon(parentId: any) {
        return this.contextModifier.getItemTypeIcon(parentId);
    }

    getItemSubTabLabel(parentId: any, subId: any) {
        return this.contextModifier.getItemSubTabLabel(parentId, subId);
    }

    getActionTypeLabel(parentId: any) {
        return this.contextModifier.getActionTypeLabel(parentId);
    }

    getActionTypeIcon(parentId: any) {
        return this.contextModifier.getActionTypeIcon(parentId);
    }

    getActionSubTabLabel(subId: any) {
        return this.contextModifier.getActionSubTabLabel(subId);
    }

    getDefaultActiveLeftSubTypes(): any[] {
        return [];
    }

    getDefaultActiveSubTypes(): any[] {
        return [];
    }

    /**
     * Update active tabs and filter state on actor changes (e.g. status conditions, spell components, resources).
     * Subclasses override to provide system-specific tab synchronization (e.g. D&D 5e spell component auto-banning).
     * @param {Actor} actor
     * @param {HUDTabColumn} [tabColumn]
     */
    updateTabs(actor: any, tabColumn = null) {
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
    recordManualTabToggle(actor: any, parentId: any, subId: any, isActive: any) {
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
    isEconomyTypeEnabled(type: any, userColors: any = {}) {
        if (!type?.id || type.id === 'none' || type.id === 'all') return false;

        const disabled = userColors.disabled;
        if (disabled instanceof Set ? disabled.has(type.id) : (Array.isArray(disabled) ? disabled.includes(type.id) : Boolean(disabled?.[type.id]))) return false;

        const enabled = userColors.enabled;
        if (enabled instanceof Set ? enabled.has(type.id) : (Array.isArray(enabled) ? enabled.includes(type.id) : Boolean(enabled?.[type.id]))) return true;

        return Boolean(type.defaultEnabled);
    }

    /**
     * Get the mapped color for an action economy type.
     * @param {string} type Economy type identifier
     * @param {Record<string, any>} [userColors={}] User configured color overrides
     * @returns {string|null} Hex color string or null if unmapped or disabled
     */
    getEconomyColor(type: string, userColors: any = {}) {
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
     * @param {Object} action HUD Action object
     * @param {Record<string, any>} [userColors={}] User configured color overrides
     * @returns {{ type: string, label: string, active: boolean, color: string|null }[]}
     */
    extractEconomyIndicators(action: any, userColors = {}) {
        if (!action) return [];

        const systemTypes = this.getEconomyTypes() ?? [];
        const enabledTypes = systemTypes.filter(t => this.isEconomyTypeEnabled(t, userColors));
        if (!enabledTypes.length) return [];

        const activeTypes = new Set();
        if (action.subactions?.length) {
            for (const sub of action.subactions) {
                const econRef = sub.right?.find((r: any) => r?.root === 'economy');
                const subType = econRef?.label;
                if (subType && !EXCLUDED_ECONOMY_LABELS.has(subType)) {
                    activeTypes.add(subType);
                }
            }
        } else if (action.right?.length) {
            const econRef = action.right.find((r: any) => r?.root === 'economy');
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

        const indicators: any[] = [];
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
    formatEconomyTooltip(sysType: any, color = null) {
        const econColor = color ?? sysType?.defaultColor ?? '#64748b';
        const label = sysType?.label ?? sysType?.id ?? '';
        return `<div class="bad-economy-tooltip"><div class="bad-economy-tooltip-header"><span class="bad-economy-tooltip-bar" style="background-color: ${econColor}; box-shadow: 0 0 6px ${econColor};"></span><span class="bad-economy-tooltip-label">${label}</span></div></div>`;
    }

    /**
     * Get the default HUD categorization structure for this system.
     * @returns {Object[]} Array of category definition objects
     */
    getDefaultCategories(): any[] {
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
    hasFavorites() {
        return false;
    }

    /**
     * Check if an item is favorited on the actor using system-specific logic.
     *
     * @param {Object} actor Actor document
     * @param {Item} item Item document
     * @returns {boolean} True if the item is favorited
     */
    isFavorite(actor: any, item: any) {
        return false;
    }

    /**
     * Set or unset favorite status on an item in a system-specific manner.
     *
     * @param {Object} actor Actor document
     * @param {Item} item Item document
     * @param {boolean} favorite True to favorite, false to unfavorite
     * @returns {Promise<any>|null} Result of update or null if unsupported
     */
    async setFavorite(actor: any, item: any, favorite: any) {
        return null;
    }

    // #endregion

    // #region Tooltip Item Summary

    /**
     * Build an item summary object for rich tooltips.
     * @param {Object} action The HUD action instance
     * @param {Object} [item] The original item document
     * @param {Object} [actor] The owning actor document
     * @returns {{title: string, subtitle?: string, img?: string, properties?: Array<string|{label?: string, value: string}>, description?: string}|null}
     */
    async getItemSummary(action: any, item: any = action?.originalItem, actor: any = null) {
        if (!action && !item) return null;
        const targetItem = item ?? action?.originalItem ?? action;
        const title = action?.name ?? targetItem?.name ?? '';
        const img = (action?.img && action.img.length > 0) ? action.img : (targetItem?.img ?? '');
        const type = targetItem?.type ? (targetItem.type.charAt(0).toUpperCase() + targetItem.type.slice(1)) : '';
        const properties: any[] = [];

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
     * @param {Actor} actor
     * @returns {Record<'vocal'|'somatic', Array<*>>}
     */
    getAutoBanEffectReasons(actor?: any): Record<'vocal'|'somatic', any[]> {
        return { vocal: [], somatic: [] };
    }

    /**
     * Get the enriched HTML content-link for a status condition ID.
     * Legacy NOP contract: Non-5e systems return empty string.
     * @param {string} condId
     * @param {string} [customLabel]
     * @returns {Promise<string>}
     */
    async enrichCondition(condId: any, customLabel = null) {
        return '';
    }

    /**
     * Format a stylized HTML tooltip for automatically added verbal/somatic bans.
     * Legacy NOP contract: Non-5e systems return empty string.
     * @param {string} comp
     * @param {Array<Object|string>|Record<string, Array<Object|string>>} reasons
     * @returns {Promise<string>}
     */
    async formatAutoBanTooltip(comp: any, reasons: any) {
        return '';
    }

    // #endregion
}
