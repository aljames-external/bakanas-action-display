import { BaseSystemContextMenuManager } from './base-system-context-menu-manager.js';
import { log } from '../../../lib/logger.js';
import { MODULE_ID } from '../../../constants.js';
import { deepFreeze } from '../../../lib/utils.js';

const ALL_FILTER_FLAGS = deepFreeze([
    'showAll',
    'showUnprepared',
    'showUnequipped_weapon',
    'showUnequipped_equipment',
    'showUnequipped_consumable',
    'showUnequipped_tool',
    'showUnequipped_backpack',
    'showUnequipped_loot'
]);

const DND5E_TAB_FLAG_MAP = deepFreeze({
    spell: 'showUnprepared',
    weapon: 'showUnequipped_weapon',
    equipment: 'showUnequipped_equipment',
    consumable: 'showUnequipped_consumable',
    tool: 'showUnequipped_tool',
    backpack: 'showUnequipped_backpack',
    loot: 'showUnequipped_loot'
});

const INNATE_OR_PACT_METHODS = new Set(['innate', 'atwill', 'pact']);
const EQUIPPABLE_ITEM_TYPES = new Set(['weapon', 'equipment', 'consumable', 'tool', 'backpack', 'loot']);

/**
 * Manages D&D 5e-specific context menu options (Equip/Unequip, Prepare/Unprepare).
 */
export class Dnd5eSystemContextMenuManager extends BaseSystemContextMenuManager {
    /**
     * @param {Dnd5eSystemAdapter} adapter Owning D&D 5e adapter instance
     */
    constructor(adapter: any) {
        super(adapter);
    }

    /**
     * Resolve the Item document if owned by the current user.
     * @param {ApplicationV2} app Active HUD application
     * @param {HTMLElement} el Clicked DOM element
     * @returns {Item|null}
     */
    #getOwnerItem(app: any, el: any) {
        if (!app.actor?.isOwner) return null;
        return this.getContextItem(app, el);
    }

    /**
     * Retrieve system-specific context menu items for D&D 5e items.
     * @param {ApplicationV2} app Active HUD application
     * @returns {Object[]} Context menu items definition
     */
    getContextMenuItems(app: any) {
        return [
            {
                name: "BAD.common.prepareSpell",
                icon: '<i class="fas fa-book"></i>',
                condition: (el: any) => {
                    const item = this.#getOwnerItem(app, el);
                    return Boolean(item?.type === 'spell' && !INNATE_OR_PACT_METHODS.has(item.system.method) && !item.system.prepared);
                },
                callback: async (el: any) => {
                    const item = this.#getOwnerItem(app, el);
                    if (item) {
                        await item.update({ "system.prepared": 1 });
                    }
                }
            },
            {
                name: "BAD.common.unprepareSpell",
                icon: '<i class="fas fa-book-dead"></i>',
                condition: (el: any) => {
                    const item = this.#getOwnerItem(app, el);
                    return Boolean(item?.type === 'spell' && !INNATE_OR_PACT_METHODS.has(item.system.method) && item.system.prepared);
                },
                callback: async (el: any) => {
                    const item = this.#getOwnerItem(app, el);
                    if (item) {
                        await item.update({ "system.prepared": 0 });
                    }
                }
            },
            {
                name: "BAD.common.equipItem",
                icon: '<i class="fas fa-shield-halved"></i>',
                condition: (el: any) => {
                    const item = this.#getOwnerItem(app, el);
                    return Boolean(item && EQUIPPABLE_ITEM_TYPES.has(item.type) && item.system?.equipped !== undefined && !this.adapter.getItemEquipped(item));
                },
                callback: async (el: any) => {
                    const item = this.#getOwnerItem(app, el);
                    if (item) {
                        await item.update({ "system.equipped": true });
                    }
                }
            },
            {
                name: "BAD.common.unequipItem",
                icon: '<i class="fas fa-shield-slash"></i>',
                condition: (el: any) => {
                    const item = this.#getOwnerItem(app, el);
                    return Boolean(item && EQUIPPABLE_ITEM_TYPES.has(item.type) && item.system?.equipped !== undefined && this.adapter.getItemEquipped(item));
                },
                callback: async (el: any) => {
                    const item = this.#getOwnerItem(app, el);
                    if (item) {
                        await item.update({ "system.equipped": false });
                    }
                }
            }
        ];
    }

    /**
     * Handle right-click on tabs to toggle showAll/showUnprepared/showUnequipped actor flags.
     * @param {ApplicationV2} app Active HUD application
     * @param {HTMLElement} el Clicked DOM element
     * @param {Event} event Triggering event
     * @returns {boolean} True if handled
     */
    onTabRightClick(app: any, el: any, event: any) {
        return this.handleFilterTabRightClick(app, el, DND5E_TAB_FLAG_MAP, ALL_FILTER_FLAGS);
    }
}
