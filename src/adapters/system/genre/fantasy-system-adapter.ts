import { BaseSystemAdapter } from '../base-system-adapter.js';
import type { BaseFoundryAdapter } from '../../foundry/base-foundry-adapter.js';

const SORT_ORDERS = {
    spell_subtab: {
        'all': 0,
        '0': 1, 'level_0': 1,
        '1': 2, 'level_1': 2,
        '2': 3, 'level_2': 3,
        '3': 4, 'level_3': 4,
        '4': 5, 'level_4': 5,
        '5': 6, 'level_5': 6,
        '6': 7, 'level_6': 7,
        '7': 8, 'level_7': 8,
        '8': 9, 'level_8': 9,
        '9': 10, 'level_9': 10,
        'itemCharges': 99
    }
};

const ICONS = {
    item_type: {
        'weapon': 'fas fa-sword',
        'equipment': 'fas fa-shield',
        'spell': 'fas fa-wand-magic-sparkles',
        'feat': 'fas fa-award',
        'consumable': 'fas fa-flask'
    }
};

const DEFAULT_CATEGORIES = [
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
        subcategories: [
            {
                id: 'sub_low_level',
                name: 'Low Level',
                expression: `item.system.level < 3`
            },
            {
                id: 'sub_mid_level',
                name: 'Mid Level',
                expression: `item.system.level < 6`
            },
            {
                id: 'sub_high_level',
                name: 'High Level',
                expression: `item.system.level < 10`
            }
        ]
    },
    {
        id: 'cat_features',
        name: 'Features',
        expression: `item.type === 'feat'`,
        subcategories: []
    }
];

/**
 * Intermediate adapter for fantasy-based systems (D&D 5e, PF1e, PF2e).
 * Provides shared fantasy defaults like common item type labels (Weapons, Spells, Feats, Consumables),
 * their corresponding icons, and numerical spell level sorting.
 */
export class FantasySystemAdapter extends BaseSystemAdapter {
    constructor(systemId: string, isSupported: boolean = false, foundry: BaseFoundryAdapter) {
        super(systemId, isSupported, foundry);
    }

    /**
     * Get the default CSS icon class for a left-side item type (parent tab) in fantasy systems.
     */
    override getItemTypeIcon(parentId: string): string {
        return (ICONS.item_type as Record<string, string>)[parentId] ?? super.getItemTypeIcon(parentId);
    }

    /**
     * Get the sort index for left-side item sub-tabs in fantasy systems.
     * Easily readable list determining the exact display order for spell levels.
     */
    override getItemSubTabSortOrder(parentId: string, subId: string): number {
        return parentId === 'spell'
            ? ((SORT_ORDERS.spell_subtab as Record<string, number>)[subId] ?? 999)
            : super.getItemSubTabSortOrder(parentId, subId);
    }

    /**
     * Get the page definition configuration for a given page number in fantasy-based systems.
     * Page 1 is flat, Page 2 is categorized (abilities / saves / skills / tools), and Page 3 is tokenInfo.
     *
     * @param {number} [page=1] Page number (1-indexed)
     * @param {Actor|null} [actor=null] Target actor document
     * @returns {{ page: number, defaultLayout: string, categories: Object[]|null }}
     */
    override getPageConfig(page: number = 1, actor: Actor | null = null) {
        const pageNum = Number.isFinite(page) && page > 0 ? page : 1;
        switch (pageNum) {
            case 1:
                return {
                    page: 1,
                    defaultLayout: 'flat',
                    categories: null
                };
            case 2:
                return {
                    page: 2,
                    defaultLayout: 'categorized',
                    categories: null
                };
            case 3:
                return {
                    page: 3,
                    defaultLayout: 'tokenInfo',
                    categories: null
                };
            default:
                return {
                    page: pageNum,
                    defaultLayout: 'flat',
                    categories: null
                };
        }
    }

    /**
     * Get the default HUD categorization structure for fantasy-based systems.
     * Pulls from DEFAULT_CATEGORIES and uses foundry.utils.mergeObject to apply overrides.
     * @param {Record<string, any>} [overrides={}] Generic category overrides
     * @returns {Object[]} Array of category definition objects
     */
    override getDefaultCategories(overrides: Record<string, unknown> = {}): Record<string, unknown>[] {
        return DEFAULT_CATEGORIES.map(defaultCat => {
            const key = defaultCat.id.replace('cat_', '').replace(/s$/, ''); // e.g. 'weapon', 'spell', 'feature'
            const catOverride = (overrides[defaultCat.id] ?? overrides[key] ?? {}) as Record<string, unknown>;
            return this.mergeObject(defaultCat, catOverride, { inplace: false, overwrite: true }) as Record<string, unknown>;
        });
    }
}
