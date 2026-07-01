import { BaseSystemAdapter } from '../base-system-adapter.js';

const SPELL_SUB_SORT_ORDER = {
    'all': 0,
    'level_0': 1,
    'level_1': 2,
    'level_2': 3,
    'level_3': 4,
    'level_4': 5,
    'level_5': 6,
    'level_7': 7,
    'level_8': 8,
    'level_9': 9,
    'itemCharges': 99
};

/**
 * Intermediate adapter for fantasy-based systems (D&D 5e, PF1e, PF2e).
 * Provides shared fantasy defaults like common item type labels (Weapons, Spells, Feats, Consumables),
 * their corresponding icons, and numerical spell level sorting.
 */
export class FantasySystemAdapter extends BaseSystemAdapter {
    constructor(systemId) {
        super(systemId);
    }

    /**
     * Get the default CSS icon class for a left-side item type (parent tab) in fantasy systems.
     */
    getItemTypeIcon(parentId) {
        const icons = {
            'weapon': 'fas fa-sword',
            'spell': 'fas fa-wand-magic-sparkles',
            'feat': 'fas fa-award',
            'consumable': 'fas fa-flask'
        };
        return icons[parentId] ?? super.getItemTypeIcon(parentId);
    }

    /**
     * Get the sort index for left-side item sub-tabs in fantasy systems.
     * Easily readable list determining the exact display order for spell levels.
     */
    getItemSubTabSortOrder(parentId, subId) {
        if (parentId === 'spell') {
            return SPELL_SUB_SORT_ORDER[subId] ?? 999;
        }
        return super.getItemSubTabSortOrder(parentId, subId);
    }
}
