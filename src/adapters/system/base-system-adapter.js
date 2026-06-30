/**
 * Helper to safely localize a key, falling back to a default string if the key is not found.
 */
export function localize(key, fallback) {
    return (game.i18n && game.i18n.has(key)) ? game.i18n.localize(key) : fallback;
}

/**
 * Base class for all system-specific adapters.
 * System adapters are responsible for modifying, filtering, and sorting
 * the base list of usable items extracted by the core.
 * They also define the localization labels and icons for the HUD tabs.
 */
export class BaseSystemAdapter {
    constructor(systemId) {
        this.systemId = systemId;
    }

    /**
     * Determine if this adapter is compatible with the current system.
     * @returns {boolean}
     */
    isCompatible() {
        return game.system.id === this.systemId;
    }

    /**
     * Modify the base list of actions.
     * @param {Object[]} actions Base actions extracted by the core
     * @param {Actor} actor The actor these actions belong to
     * @returns {Object[]} The modified/filtered/sorted actions list
     */
    modifyActions(actions, actor) {
        // Default system-agnostic resource filtering
        const filterNoResources = game.settings.get('bakanas-action-display', 'filterNoResources');
        if (filterNoResources) {
            return actions.filter(action => {
                // Never hide weapons, even if they are out of ammo or charges
                if (action.originalItem?.type === 'weapon') return true;

                return !(action.uses && action.uses.available !== null && action.uses.available <= 0);
            });
        }
        return actions;
    }

    /**
     * Get the localized label for a left-side item type (parent tab).
     * @param {string} parentId 
     * @returns {string}
     */
    getItemTypeLabel(parentId) {
        const labels = {
            'all': 'All Items',
            'weapon': 'Weapon',
            'equipment': 'Equipment',
            'consumable': 'Consumable',
            'tool': 'Tool',
            'backpack': 'Container',
            'loot': 'Loot',
            'feat': 'Feature',
            'spell': 'Spell',
            'other': 'Other',
            'hidden': localize('BAD.hud.hidden', 'Hidden')
        };
        return labels[parentId] || parentId.toUpperCase();
    }

    /**
     * Get the CSS icon class for a left-side item type (parent tab).
     * @param {string} parentId 
     * @returns {string}
     */
    getItemTypeIcon(parentId) {
        const icons = {
            'all': 'fas fa-border-all',
            'weapon': 'fas fa-sword',
            'spell': 'fas fa-wand-magic-sparkles',
            'feat': 'fas fa-award',
            'equipment': 'fas fa-shield',
            'consumable': 'fas fa-flask',
            'tool': 'fas fa-hammer',
            'backpack': 'fas fa-sack',
            'loot': 'fas fa-gem',
            'other': 'fas fa-ellipsis',
            'hidden': 'fas fa-eye-slash'
        };
        return icons[parentId] || 'fas fa-question';
    }

    /**
     * Get the localized label for a spell level (left-side sub-tab).
     * @param {string} level 
     * @returns {string}
     */
    getSpellLevelLabel(level) {
        return `${level} Level`;
    }

    /**
     * Get the localized label for a right-side action type (parent tab).
     * @param {string} parentId 
     * @returns {string}
     */
    getActionTypeLabel(parentId) {
        const labels = {
            'all': 'All Actions',
            'none': 'None'
        };
        return labels[parentId] || parentId.toUpperCase();
    }

    /**
     * Get the CSS icon class for a right-side action type (parent tab).
     * @param {string} parentId 
     * @returns {string}
     */
    getActionTypeIcon(parentId) {
        const icons = {
            'all': 'fas fa-border-all',
            'none': 'fas fa-ban'
        };
        return icons[parentId] || 'fas fa-question';
    }

    /**
     * Get the localized label for a right-side action sub-tab.
     * @param {string} subId 
     * @returns {string}
     */
    getActionSubTabLabel(subId) {
        return subId.toUpperCase();
    }

    /**
     * Get system-specific context menu items for action items.
     * @param {ApplicationV2} app The ActionDisplayApp instance
     * @returns {Object[]} An array of context menu item configurations
     */
    getContextMenuItems(app) {
        return [];
    }

    /**
     * Modify the template context before rendering.
     * @param {Object} context The template context
     * @param {ApplicationV2} app The ActionDisplayApp instance
     */
    modifyContext(context, app) {
        // Default implementation does nothing
    }

    /**
     * Handle right-click on a tab.
     * @param {ApplicationV2} app The ActionDisplayApp instance
     * @param {HTMLElement} el The tab element that was right-clicked
     * @param {Event} event The event
     * @returns {boolean} True if the event was handled and default behavior should be prevented
     */
    onTabRightClick(app, el, event) {
        return false;
    }
}
