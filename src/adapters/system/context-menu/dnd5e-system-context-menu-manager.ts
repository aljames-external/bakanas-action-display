import { BaseSystemContextMenuManager } from './base-system-context-menu-manager.js';
import type { Dnd5eSystemAdapter } from '../dnd5e-system-adapter.js';
import type { Item5e } from '../../../types/systems.js';
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

const EQUIPPABLE_ITEM_TYPES = deepFreeze(new Set([
    'weapon',
    'equipment',
    'tool',
    'consumable',
    'backpack',
    'loot'
]));

const INNATE_OR_PACT_METHODS = deepFreeze(new Set(['innate', 'pact', 'atwill', 'always']));

/**
 * Manages D&D 5e-specific context menu options (Prepare/Unprepare, Equip/Unequip)
 * and tab right-click filters (showUnprepared, showUnequipped_*).
 */
export class Dnd5eSystemContextMenuManager extends BaseSystemContextMenuManager {
    declare adapter: Dnd5eSystemAdapter;

    /**
     * @param {Dnd5eSystemAdapter} adapter Owning D&D 5e adapter instance
     */
    constructor(adapter: Dnd5eSystemAdapter) {
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
     * Retrieve system-specific context menu items for D&D 5e items.
     * @param {{ actor?: Actor; actions?: Array<{ id: string; originalItem?: Item | null }> }} app Active HUD application
     * @returns {unknown[]} Context menu items definition
     */
    override getContextMenuItems(app: { actor?: Actor; actions?: Array<{ id: string; originalItem?: Item | null }> }): unknown[] {
        return [
            {
                name: "BAD.common.prepareSpell",
                icon: '<i class="fas fa-book"></i>',
                condition: (el: HTMLElement): boolean => {
                    const item = this.#getOwnerItem(app, el);
                    if (!item || (item.type as string) !== 'spell') return false;
                    const item5e = item as Item5e;
                    const method = item5e.system?.method ?? 'prepared';
                    const prepared = Boolean(item5e.system?.prepared);
                    return !INNATE_OR_PACT_METHODS.has(method) && !prepared;
                },
                callback: async (el: HTMLElement): Promise<void> => {
                    const item = this.#getOwnerItem(app, el);
                    if (item) {
                        await item.update({ "system.prepared": 1 } as Record<string, unknown>);
                    }
                }
            },
            {
                name: "BAD.common.unprepareSpell",
                icon: '<i class="fas fa-book-dead"></i>',
                condition: (el: HTMLElement): boolean => {
                    const item = this.#getOwnerItem(app, el);
                    if (!item || (item.type as string) !== 'spell') return false;
                    const item5e = item as Item5e;
                    const method = item5e.system?.method ?? 'prepared';
                    const prepared = Boolean(item5e.system?.prepared);
                    return !INNATE_OR_PACT_METHODS.has(method) && prepared;
                },
                callback: async (el: HTMLElement): Promise<void> => {
                    const item = this.#getOwnerItem(app, el);
                    if (item) {
                        await item.update({ "system.prepared": 0 } as Record<string, unknown>);
                    }
                }
            },
            {
                name: "BAD.common.equipItem",
                icon: '<i class="fas fa-shield-halved"></i>',
                condition: (el: HTMLElement): boolean => {
                    const item = this.#getOwnerItem(app, el);
                    if (!item || !EQUIPPABLE_ITEM_TYPES.has(item.type as string)) return false;
                    const item5e = item as Item5e;
                    return item5e.system?.equipped !== undefined && !this.adapter.getItemEquipped(item);
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
                    const item5e = item as Item5e;
                    return item5e.system?.equipped !== undefined && this.adapter.getItemEquipped(item);
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
     * Handle right-click on tabs to toggle showAll/showUnprepared/showUnequipped actor flags.
     * @param {{ actor?: Actor }} app Active HUD application
     * @param {HTMLElement} el Clicked DOM element
     * @param {Event | MouseEvent} [_event] Triggering event
     * @returns {boolean} True if handled
     */
    override onTabRightClick(app: { actor?: Actor }, el: HTMLElement, _event?: Event | MouseEvent): boolean {
        return this.handleFilterTabRightClick(app, el, DND5E_TAB_FLAG_MAP, ALL_FILTER_FLAGS);
    }
}
