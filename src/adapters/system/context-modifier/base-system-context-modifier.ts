import { localize, deepFreeze } from '../../../lib/utils.js';

const ICONS = deepFreeze({
    item_type: {
        'all': 'fas fa-border-all',
        'weapon': 'fas fa-sword',
        'spell': 'fas fa-wand-magic-sparkles',
        'feat': 'fas fa-award',
        'equipment': 'fas fa-shield-halved',
        'consumable': 'fas fa-flask-potion',
        'tool': 'fas fa-hammer',
        'tools': 'fas fa-hammer',
        'savingThrow': 'fas fa-shield-alt',
        'abilityCheck': 'fas fa-dice-d20',
        'other': 'fas fa-ellipsis',
        'hidden': 'fas fa-eye-slash'
    },
    action_type: {
        'all': 'fas fa-border-all',
        'ability': 'fas fa-fist-raised',
        'none': 'fas fa-ban'
    }
});

const SORT_ORDERS = deepFreeze({
    item_type: {
        'all': 0,
        'weapon': 1,
        'spell': 2,
        'feat': 3,
        'buff': 4,
        'equipment': 5,
        'consumable': 6,
        'tool': 7,
        'tools': 7,
        'backpack': 8,
        'loot': 9,
        'other': 10,
        'hidden': 11
    },
    action_type: {
        'all': 0,
        'economy': 1,
        'none': 2
    }
});

const ABILITY_LABEL_CONFIGS = deepFreeze({
    all: { key: 'BAD.core.allActions', fallback: 'All' },
    str: { key: 'DND5E.AbilityStr', fallback: 'Strength' },
    dex: { key: 'DND5E.AbilityDex', fallback: 'Dexterity' },
    con: { key: 'DND5E.AbilityCon', fallback: 'Constitution' },
    int: { key: 'DND5E.AbilityInt', fallback: 'Intelligence' },
    wis: { key: 'DND5E.AbilityWis', fallback: 'Wisdom' },
    cha: { key: 'DND5E.AbilityCha', fallback: 'Charisma' }
});

/**
 * Manages UI context modifications, tab label/icon localization, and sort orders
 * for a system adapter.
 */
export class BaseSystemContextModifier {
    adapter: BaseSystemAdapter;

    /**
     * @param {BaseSystemAdapter} adapter Owning system adapter instance
     */
    constructor(adapter: BaseSystemAdapter) {
        this.adapter = adapter;
    }

    /**
     * Hook to modify the rendering context before template rendering.
     * @param {Record<string, unknown>} context The Handlebars rendering context
     * @param {unknown} app Active HUD application
     */
    modifyContext(context: Record<string, unknown>, app: unknown): Promise<void> | void {}

    /**
     * Get the sort priority order for a left-side parent item tab.
     * @param {string} parentId
     * @returns {number}
     */
    getItemTypeSortOrder(parentId: string): number {
        return (SORT_ORDERS.item_type as Record<string, number>)[parentId] ?? 999;
    }

    /**
     * Get the sort priority order for a left-side item sub-tab.
     * @param {string} parentId
     * @param {string} subId
     * @returns {number}
     */
    getItemSubTabSortOrder(parentId: string, subId: string): number {
        if (subId === 'all') return 0;
        if (subId === 'itemCharges') return 99;
        const num = Number.parseInt(subId, 10);
        return Number.isFinite(num) ? num + 1 : 999;
    }

    /**
     * Get the sort priority order for a right-side action parent tab.
     * @param {string} parentId
     * @returns {number}
     */
    getActionTypeSortOrder(parentId: string): number {
        return (SORT_ORDERS.action_type as Record<string, number>)[parentId] ?? 999;
    }

    /**
     * Get the sort priority order for a right-side action sub-tab.
     * @param {string} parentId
     * @param {string} subId
     * @returns {number}
     */
    getActionSubTabSortOrder(parentId: string, subId: string): number {
        return subId === 'all' ? 0 : 999;
    }

    /**
     * Get the localized display label for a left-side parent item tab.
     * @param {string} parentId
     * @returns {string}
     */
    getItemTypeLabel(parentId: string): string {
        switch (parentId) {
            case 'all': return localize('BAD.core.allItems', 'All Items');
            case 'other': return localize('BAD.core.other', 'Other');
            case 'hidden': return localize('BAD.core.hidden', 'Hidden');
            case 'savingThrow': return localize('BAD.page2.savingThrow', 'Saving Throw');
            case 'abilityCheck': return localize('BAD.page2.abilityCheck', 'Ability Check');
            case 'tool':
            case 'tools':
                return localize('BAD.page2.tools', 'Tools');
            default: {
                const configLabel = CONFIG.Item?.typeLabels?.[parentId];
                if (configLabel) {
                    const localized = localize(configLabel);
                    if (localized) return localized;
                }
                return parentId.charAt(0).toUpperCase() + parentId.slice(1);
            }
        }
    }

    /**
     * Get the CSS icon class for a left-side parent item tab.
     * @param {string} parentId
     * @returns {string}
     */
    getItemTypeIcon(parentId: string): string {
        return (ICONS.item_type as Record<string, string>)[parentId] ?? 'fas fa-question';
    }

    /**
     * Get the localized display label for a left-side item sub-tab.
     * @param {string} parentId
     * @param {string} subId
     * @returns {string}
     */
    getItemSubTabLabel(parentId: string, subId: string): string {
        return subId.toUpperCase();
    }

    /**
     * Get the localized display label for a right-side action parent tab.
     * @param {string} parentId
     * @returns {string}
     */
    getActionTypeLabel(parentId: string): string {
        switch (parentId) {
            case 'all': return localize('BAD.core.allActions', 'All Actions');
            case 'none': return localize('BAD.core.none', 'None');
            case 'ability': return localize('BAD.page2.ability', 'Ability');
            default: return parentId.toUpperCase();
        }
    }

    /**
     * Get the CSS icon class for a right-side action parent tab.
     * @param {string} parentId
     * @returns {string}
     */
    getActionTypeIcon(parentId: string): string {
        return (ICONS.action_type as Record<string, string>)[parentId] ?? 'fas fa-question';
    }

    /**
     * Get the localized display label for a right-side action sub-tab.
     * @param {string} subId
     * @returns {string}
     */
    getActionSubTabLabel(subId: string): string {
        const config = (ABILITY_LABEL_CONFIGS as Record<string, { key: string; fallback: string }>)[subId];
        return config ? localize(config.key, config.fallback) : subId.toUpperCase();
    }
}
