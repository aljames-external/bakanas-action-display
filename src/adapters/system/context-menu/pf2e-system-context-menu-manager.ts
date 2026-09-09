import { BaseSystemContextMenuManager } from './base-system-context-menu-manager.js';
import { MODULE_ID } from '../../../constants.js';
import { deepFreeze } from '../../../lib/utils.js';

const ALL_FILTER_FLAGS = deepFreeze([
    'showAll',
    'showUnequipped_weapon',
    'showUnequipped_equipment',
    'showUnequipped_consumable'
]);

const PF2E_TAB_FLAG_MAP = deepFreeze({
    weapon: 'showUnequipped_weapon',
    equipment: 'showUnequipped_equipment',
    consumable: 'showUnequipped_consumable'
});

/**
 * Manages PF2e-specific context menu options (Equip/Unequip) and tab right-click filters.
 */
export class Pf2eSystemContextMenuManager extends BaseSystemContextMenuManager {
    /**
     * @param {Pf2eSystemAdapter} adapter Owning PF2e adapter instance
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
    #getOwnerItem(app: any, el: any): any {
        if (!app.actor?.isOwner) return null;
        return this.getContextItem(app, el);
    }

    /**
     * Check if a PF2e item has an equip/carry state that can be updated.
     * Natural attacks, unarmed strikes, and non-physical items do not have an equip state.
     * @param {Item} item
     * @param {ApplicationV2} [app=null]
     * @returns {boolean}
     */
    #isEquippable(item: any, app: any = null): boolean {
        if (!item?.system) return false;
        if (app?.actor?.items && item.id && !app.actor.items.has(item.id)) return false;
        const traits = item.system.traits?.value;
        if (traits instanceof Set ? traits.has('unarmed') : (Array.isArray(traits) ? traits.includes('unarmed') : false)) return false;
        return Boolean(item.system.equipped?.carryType);
    }

    /**
     * Safely update an item's carry type ensuring it exists in the actor's embedded collection.
     * @param {ApplicationV2} app Active HUD application
     * @param {Item} item Target item document
     * @param {Object} updates Update data payload
     */
    async #safeUpdateItem(app, item, updates) {
        if (!item) return;
        if (app?.actor?.items && item.id && !app.actor.items.has(item.id)) return;
        const targetItem = app?.actor?.items?.get(item.id) ?? item;
        await targetItem?.update?.(updates);
    }

    /**
     * Retrieve system-specific context menu items for PF2e physical items (Update Equip State submenu).
     * @param {ApplicationV2} app Active HUD application
     * @returns {Object[]} Context menu items definition
     */
    getContextMenuItems(app) {
        return [
            {
                name: "PF2E.Actor.Inventory.CarryType.OpenMenu",
                icon: '<i class="fas fa-shield-halved"></i>',
                condition: el => {
                    const item = this.#getOwnerItem(app, el);
                    return Boolean(this.#isEquippable(item, app));
                },
                submenu: [
                    {
                        name: "PF2E.CarryType.held1",
                        icon: '<i class="fas fa-hand"></i>',
                        active: (item) => item?.system?.equipped?.carryType === 'held' && item?.system?.equipped?.handsHeld === 1,
                        condition: (item) => item?.type !== 'armor',
                        callback: async (item) => {
                            await this.#safeUpdateItem(app, item, {
                                "system.equipped.carryType": "held",
                                "system.equipped.handsHeld": 1
                            });
                        }
                    },
                    {
                        name: "PF2E.CarryType.held2",
                        icon: '<i class="fas fa-hands"></i>',
                        active: (item) => item?.system?.equipped?.carryType === 'held' && item?.system?.equipped?.handsHeld === 2,
                        condition: (item) => item?.type === 'weapon' || item?.type === 'equipment',
                        callback: async (item) => {
                            await this.#safeUpdateItem(app, item, {
                                "system.equipped.carryType": "held",
                                "system.equipped.handsHeld": 2
                            });
                        }
                    },
                    {
                        name: "PF2E.CarryType.worn",
                        icon: '<i class="fas fa-shirt"></i>',
                        active: (item) => item?.system?.equipped?.carryType === 'worn',
                        condition: () => true,
                        callback: async (item) => {
                            await this.#safeUpdateItem(app, item, {
                                "system.equipped.carryType": "worn",
                                "system.equipped.handsHeld": 0
                            });
                        }
                    },
                    {
                        name: "PF2E.CarryType.stowed",
                        icon: '<i class="fas fa-box-archive"></i>',
                        active: (item) => item?.system?.equipped?.carryType === 'stowed',
                        condition: () => true,
                        callback: async (item) => {
                            await this.#safeUpdateItem(app, item, {
                                "system.equipped.carryType": "stowed",
                                "system.equipped.handsHeld": 0
                            });
                        }
                    },
                    {
                        name: "PF2E.CarryType.dropped",
                        icon: '<i class="fas fa-arrow-down"></i>',
                        active: (item) => item?.system?.equipped?.carryType === 'dropped',
                        condition: () => true,
                        callback: async (item) => {
                            await this.#safeUpdateItem(app, item, {
                                "system.equipped.carryType": "dropped",
                                "system.equipped.handsHeld": 0
                            });
                        }
                    }
                ]
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
        return this.handleFilterTabRightClick(app, el, PF2E_TAB_FLAG_MAP, ALL_FILTER_FLAGS);
    }
}
