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
    declare adapter: Pf1SystemAdapter;

    /**
     * @param {Pf1SystemAdapter} adapter Owning PF1e adapter instance
     */
    constructor(adapter: Pf1SystemAdapter) {
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
     * Retrieve system-specific context menu items for PF1e items.
     * @param {{ actor?: Actor; actions?: Array<{ id: string; originalItem?: Item | null }> }} app Active HUD application
     * @returns {unknown[]} Context menu items definition
     */
    override getContextMenuItems(app: { actor?: Actor; actions?: Array<{ id: string; originalItem?: Item | null }> }): unknown[] {
        return [
            {
                name: "BAD.common.equipItem",
                icon: '<i class="fas fa-shield-halved"></i>',
                condition: (el: HTMLElement): boolean => {
                    const item = this.#getOwnerItem(app, el);
                    if (!item || !EQUIPPABLE_ITEM_TYPES.has(item.type as string)) return false;
                    const itemPF = item as ItemPF;
                    return itemPF.system?.equipped !== undefined && !this.adapter.getItemEquipped(item);
                },
                callback: async (el: HTMLElement): Promise<void> => {
                    const item = this.#getOwnerItem(app, el);
                    if (item) {
                        await item.update({ "system.equipped": true } as Record<string, unknown>);
                    }
                }
            },
            {
                name: "BAD.common.unequipItem",
                icon: '<i class="fas fa-shield-slash"></i>',
                condition: (el: HTMLElement): boolean => {
                    const item = this.#getOwnerItem(app, el);
                    if (!item || !EQUIPPABLE_ITEM_TYPES.has(item.type as string)) return false;
                    const itemPF = item as ItemPF;
                    return itemPF.system?.equipped !== undefined && this.adapter.getItemEquipped(item);
                },
                callback: async (el: HTMLElement): Promise<void> => {
                    const item = this.#getOwnerItem(app, el);
                    if (item) {
                        await item.update({ "system.equipped": false } as Record<string, unknown>);
                    }
                }
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
    override onTabRightClick(app: { actor?: Actor }, el: HTMLElement, _event?: MouseEvent): boolean {
        return this.handleFilterTabRightClick(app, el, PF1_TAB_FLAG_MAP, ALL_FILTER_FLAGS);
    }
}
