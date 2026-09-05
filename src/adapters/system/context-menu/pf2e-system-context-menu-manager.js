import { BaseSystemContextMenuManager } from './base-system-context-menu-manager.js';
import { MODULE_ID } from '../../../constants.js';

const ALL_FILTER_FLAGS = [
    'showAll',
    'showUnequipped_weapon',
    'showUnequipped_equipment',
    'showUnequipped_consumable'
];

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
    #getOwnerItem(app, el) {
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
    #isEquippable(item, app = null) {
        if (!item || !item.system) return false;
        if (app?.actor?.items && item.id && !app.actor.items.has(item.id)) return false;
        if (item.isEmbedded === false) return false;
        if (item.isPhysical === false) return false;
        if (item.category === 'unarmed' || item.system?.category?.value === 'unarmed') return false;
        if (item.system?.traits?.value?.includes?.('unarmed')) return false;
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
                        condition: (item) => ['weapon', 'equipment'].includes(item?.type),
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
        if (!app.actor?.isOwner) return false;

        const isParentTab = el.classList?.contains?.('bad-left-tab');
        const isSubTab = el.classList?.contains?.('bad-left-sub-tab');
        const parentType = isParentTab
            ? el.dataset?.type
            : (isSubTab && el.dataset?.type === 'all'
                ? el.closest?.('.bad-left-tab-group')?.querySelector?.('.bad-left-tab')?.dataset?.type
                : null);

        if (!parentType) return false;

        if (parentType === 'all') {
            const current = app.actor.getFlag(MODULE_ID, 'showAll') ?? false;
            const nextState = !current;
            const flagUpdates = {};
            for (const key of ALL_FILTER_FLAGS) {
                flagUpdates[key] = nextState;
            }
            this.updateActorFlagsOptimistic(app.actor, MODULE_ID, flagUpdates);
            return true;
        }

        const flagMap = {
            weapon: 'showUnequipped_weapon',
            equipment: 'showUnequipped_equipment',
            consumable: 'showUnequipped_consumable'
        };

        const flagKey = flagMap[parentType];
        if (flagKey) {
            const current = app.actor.getFlag(MODULE_ID, flagKey) ?? false;
            this.setActorFlagOptimistic(app.actor, MODULE_ID, flagKey, !current);
            return true;
        }

        return false;
    }
}
