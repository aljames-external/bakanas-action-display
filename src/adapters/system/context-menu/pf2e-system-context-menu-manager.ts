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
    declare adapter: Pf2eSystemAdapter;

    /**
     * @param {Pf2eSystemAdapter} adapter Owning PF2e adapter instance
     */
    constructor(adapter: Pf2eSystemAdapter) {
        super(adapter);
    }

    /**
     * Resolve the Item document if owned by the current user.
     * @param {{ actor?: Actor; actions?: Array<{ id: string; originalItem?: Item | null }> }} app Active HUD application
     * @param {HTMLElement} el Clicked DOM element
     * @returns {Item|null}
     */
    #getOwnerItem(app: { actor?: Actor; actions?: Array<{ id: string; originalItem?: Item | null }> }, el: HTMLElement): Item | null {
        if (!app.actor?.isOwner) return null;
        return this.getContextItem(app, el);
    }

    /**
     * Check if a PF2e item has an equip/carry state that can be updated.
     * Natural attacks, unarmed strikes, and non-physical items do not have an equip state.
     * @param {Item|null} item
     * @param {{ actor?: Actor }|null} [app=null]
     * @returns {boolean}
     */
    #isEquippable(item: Item | null, app: { actor?: Actor } | null = null): boolean {
        if (!item?.system) return false;
        if (app?.actor?.items && item.id && !app.actor.items.has(item.id)) return false;
        const itemPF2e = item as ItemPF2e;
        if (itemPF2e.system.traits?.value?.includes('unarmed')) return false;
        return Boolean(itemPF2e.system.equipped?.carryType);
    }

    /**
     * Safely update an item's carry type ensuring it exists in the actor's embedded collection.
     * @param {{ actor?: Actor }} app Active HUD application
     * @param {Item} item Target item document
     * @param {Record<string, unknown>} updates Update data payload
     */
    async #safeUpdateItem(app: { actor?: Actor }, item: Item, updates: Record<string, unknown>): Promise<void> {
        if (!item) return;
        if (app?.actor?.items && item.id && !app.actor.items.has(item.id)) return;
        const targetItem = (app?.actor?.items && item.id) ? app.actor.items.get(item.id) : item;
        await targetItem?.update(updates as Record<string, unknown>);
    }

    /**
     * Retrieve system-specific context menu items for PF2e physical items (Update Equip State submenu).
     * @param {{ actor?: Actor; actions?: Array<{ id: string; originalItem?: Item | null }> }} app Active HUD application
     * @returns {unknown[]} Context menu items definition
     */
    override getContextMenuItems(app: { actor?: Actor; actions?: Array<{ id: string; originalItem?: Item | null }> }): unknown[] {
        return [
            {
                name: "PF2E.Actor.Inventory.CarryType.OpenMenu",
                icon: '<i class="fas fa-shield-halved"></i>',
                condition: (el: HTMLElement): boolean => {
                    const item = this.#getOwnerItem(app, el);
                    return Boolean(this.#isEquippable(item, app));
                },
                submenu: [
                    {
                        name: "PF2E.CarryType.held1",
                        icon: '<i class="fas fa-hand"></i>',
                        active: (item: Item): boolean => {
                            const itemPF2e = item as ItemPF2e;
                            return itemPF2e?.system?.equipped?.carryType === 'held' && itemPF2e?.system?.equipped?.handsHeld === 1;
                        },
                        condition: (item: Item): boolean => (item.type as string) !== 'armor',
                        callback: async (item: Item): Promise<void> => {
                            await this.#safeUpdateItem(app, item, {
                                "system.equipped.carryType": "held",
                                "system.equipped.handsHeld": 1
                            });
                        }
                    },
                    {
                        name: "PF2E.CarryType.held2",
                        icon: '<i class="fas fa-hands"></i>',
                        active: (item: Item): boolean => {
                            const itemPF2e = item as ItemPF2e;
                            return itemPF2e?.system?.equipped?.carryType === 'held' && itemPF2e?.system?.equipped?.handsHeld === 2;
                        },
                        condition: (item: Item): boolean => (item.type as string) === 'weapon' || (item.type as string) === 'equipment',
                        callback: async (item: Item): Promise<void> => {
                            await this.#safeUpdateItem(app, item, {
                                "system.equipped.carryType": "held",
                                "system.equipped.handsHeld": 2
                            });
                        }
                    },
                    {
                        name: "PF2E.CarryType.worn",
                        icon: '<i class="fas fa-shirt"></i>',
                        active: (item: Item): boolean => (item as ItemPF2e)?.system?.equipped?.carryType === 'worn',
                        condition: (): boolean => true,
                        callback: async (item: Item): Promise<void> => {
                            await this.#safeUpdateItem(app, item, {
                                "system.equipped.carryType": "worn",
                                "system.equipped.handsHeld": 0
                            });
                        }
                    },
                    {
                        name: "PF2E.CarryType.stowed",
                        icon: '<i class="fas fa-box-archive"></i>',
                        active: (item: Item): boolean => (item as ItemPF2e)?.system?.equipped?.carryType === 'stowed',
                        condition: (): boolean => true,
                        callback: async (item: Item): Promise<void> => {
                            await this.#safeUpdateItem(app, item, {
                                "system.equipped.carryType": "stowed",
                                "system.equipped.handsHeld": 0
                            });
                        }
                    },
                    {
                        name: "PF2E.CarryType.dropped",
                        icon: '<i class="fas fa-arrow-down"></i>',
                        active: (item: Item): boolean => (item as ItemPF2e)?.system?.equipped?.carryType === 'dropped',
                        condition: (): boolean => true,
                        callback: async (item: Item): Promise<void> => {
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
     * @param {{ actor?: Actor }} app Active HUD application
     * @param {HTMLElement} el Clicked DOM element
     * @param {Event | MouseEvent} [_event] Triggering event
     * @returns {boolean} True if handled
     */
    override onTabRightClick(app: { actor?: Actor }, el: HTMLElement, _event?: Event | MouseEvent): boolean {
        return this.handleFilterTabRightClick(app, el, PF2E_TAB_FLAG_MAP, ALL_FILTER_FLAGS);
    }
}
