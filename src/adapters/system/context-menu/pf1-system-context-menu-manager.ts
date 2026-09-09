import { BaseSystemContextMenuManager } from './base-system-context-menu-manager.js';
import { MODULE_ID } from '../../../constants.js';
import { deepFreeze } from '../../../lib/utils.js';

const ALL_FILTER_FLAGS = deepFreeze([
    'showAll',
    'showUnequipped_weapon',
    'showUnequipped_equipment',
    'showUnequipped_consumable'
]);

const PF1_TAB_FLAG_MAP = deepFreeze({
    weapon: 'showUnequipped_weapon',
    equipment: 'showUnequipped_equipment',
    consumable: 'showUnequipped_consumable'
});

const EQUIPPABLE_ITEM_TYPES = new Set(['weapon', 'equipment', 'consumable', 'attack']);

/**
 * Manages PF1e-specific context menu options (Equip/Unequip) and tab right-click filters.
 */
export class Pf1SystemContextMenuManager extends BaseSystemContextMenuManager {
    /**
     * @param {Pf1SystemAdapter} adapter Owning PF1e adapter instance
     */
    constructor(adapter) {
        super(adapter);
    }

    /**
     * Resolve the Item document if owned by the current user.
     * @param {ApplicationV2} app Active HUD application
     * @param {HTMLElement} el Clicked DOM element
     * @returns {Item|null}
     */
    #getOwnerItem(app, el) {
        if (!app.actor?.isOwner) return null;
        return this.getContextItem(app, el);
    }

    /**
     * Retrieve system-specific context menu items for PF1e items.
     * @param {ApplicationV2} app Active HUD application
     * @returns {Object[]} Context menu items definition
     */
    getContextMenuItems(app) {
        return [
            {
                name: "BAD.common.equipItem",
                icon: '<i class="fas fa-shield-halved"></i>',
                condition: el => {
                    const item = this.#getOwnerItem(app, el);
                    return Boolean(item && EQUIPPABLE_ITEM_TYPES.has(item.type) && item.system?.equipped !== undefined && !this.adapter.getItemEquipped(item));
                },
                callback: async el => {
                    const item = this.#getOwnerItem(app, el);
                    if (item) {
                        await item.update({ "system.equipped": true });
                    }
                }
            },
            {
                name: "BAD.common.unequipItem",
                icon: '<i class="fas fa-shield-slash"></i>',
                condition: el => {
                    const item = this.#getOwnerItem(app, el);
                    return Boolean(item && EQUIPPABLE_ITEM_TYPES.has(item.type) && item.system?.equipped !== undefined && this.adapter.getItemEquipped(item));
                },
                callback: async el => {
                    const item = this.#getOwnerItem(app, el);
                    if (item) {
                        await item.update({ "system.equipped": false });
                    }
                }
            }
        ];
    }

    /**
     * Handle right-click on tabs to toggle showAll/showUnequipped actor flags.
     * @param {ApplicationV2} app Active HUD application
     * @param {HTMLElement} el Clicked DOM element
     * @param {Event} event Triggering event
     * @returns {boolean} True if handled
     */
    onTabRightClick(app, el, event) {
        return this.handleFilterTabRightClick(app, el, PF1_TAB_FLAG_MAP, ALL_FILTER_FLAGS);
    }
}
