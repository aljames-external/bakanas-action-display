import { localize } from '../../lib/utils.js';

import { MODULE_ID } from '../../constants.js';

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
     * Determine if a specific item should be extracted as a base action.
     * Overridden by system adapters to prevent allocating objects for items that will be discarded.
     * @param {Item} item The Foundry Item instance
     * @returns {boolean} True if the item should be extracted
     */
    shouldExtractItem(item) {
        return true;
    }

    /**
     * Modify the base list of actions.
     * @param {Object[]} actions Base actions extracted by the core
     * @param {Actor} actor The actor these actions belong to
     * @returns {Object[]} The modified/filtered/sorted actions list
     */
    modifyActions(actions, actor) {
        // Default system-agnostic resource filtering
        const filterNoResources = game.settings.get(MODULE_ID, 'filterNoResources');
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
            'all': localize('BAD.hud.allItems', 'All Items'),
            'other': localize('BAD.hud.other', 'Other'),
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
            'other': 'fas fa-ellipsis',
            'hidden': 'fas fa-eye-slash'
        };
        return icons[parentId] || 'fas fa-question';
    }

    /**
     * Get the localized label for a left-side item sub-tab.
     * @param {string} parentId The parent tab ID (e.g. 'spell', 'weapon')
     * @param {string} subId The sub-tab ID (e.g. '0', 'melee')
     * @returns {string}
     */
    getItemSubTabLabel(parentId, subId) {
        return subId.toUpperCase();
    }

    /**
     * Get the localized label for a right-side action type (parent tab).
     * @param {string} parentId 
     * @returns {string}
     */
    getActionTypeLabel(parentId) {
        const labels = {
            'all': localize('BAD.hud.allActions', 'All Actions'),
            'none': localize('BAD.hud.none', 'None')
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
     * Get the default active sub-tabs for this system.
     * @returns {string[]}
     */
    getDefaultActiveSubTypes() {
        return [];
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
