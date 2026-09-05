import { BaseSystemContextMenuManager } from './base-system-context-menu-manager.js';
import { log } from '../../../lib/logger.js';
import { MODULE_ID } from '../../../constants.js';

const ALL_FILTER_FLAGS = [
    'showAll',
    'showUnprepared',
    'showUnequipped_weapon',
    'showUnequipped_equipment',
    'showUnequipped_consumable',
    'showUnequipped_tool',
    'showUnequipped_backpack',
    'showUnequipped_loot'
];

/**
 * Manages D&D 5e-specific context menu options (Equip/Unequip, Prepare/Unprepare).
 */
export class Dnd5eSystemContextMenuManager extends BaseSystemContextMenuManager {
    /**
     * @param {Dnd5eSystemAdapter} adapter Owning D&D 5e adapter instance
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
     * Retrieve system-specific context menu items for D&D 5e items.
     * @param {ApplicationV2} app Active HUD application
     * @returns {Object[]} Context menu items definition
     */
    getContextMenuItems(app) {
        return [
            {
                name: "BAD.common.prepareSpell",
                icon: '<i class="fas fa-book"></i>',
                condition: el => {
                    const item = this.#getOwnerItem(app, el);
                    return Boolean(item?.type === 'spell' && !['innate', 'atwill', 'pact'].includes(item.system.method) && !item.system.prepared);
                },
                callback: async el => {
                    const item = this.#getOwnerItem(app, el);
                    if (item) {
                        await item.update({ "system.prepared": 1 });
                    }
                }
            },
            {
                name: "BAD.common.unprepareSpell",
                icon: '<i class="fas fa-book-dead"></i>',
                condition: el => {
                    const item = this.#getOwnerItem(app, el);
                    return Boolean(item?.type === 'spell' && !['innate', 'atwill', 'pact'].includes(item.system.method) && item.system.prepared);
                },
                callback: async el => {
                    const item = this.#getOwnerItem(app, el);
                    if (item) {
                        await item.update({ "system.prepared": 0 });
                    }
                }
            },
            {
                name: "BAD.common.equipItem",
                icon: '<i class="fas fa-shield-halved"></i>',
                condition: el => {
                    const item = this.#getOwnerItem(app, el);
                    return Boolean(item && ['weapon', 'equipment', 'consumable', 'tool', 'backpack', 'loot'].includes(item.type) && item.system?.equipped !== undefined && !this.adapter.getItemEquipped(item));
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
                    return Boolean(item && ['weapon', 'equipment', 'consumable', 'tool', 'backpack', 'loot'].includes(item.type) && item.system?.equipped !== undefined && this.adapter.getItemEquipped(item));
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
     * Handle right-click on tabs to toggle showAll/showUnprepared/showUnequipped actor flags.
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
            spell: 'showUnprepared',
            weapon: 'showUnequipped_weapon',
            equipment: 'showUnequipped_equipment',
            consumable: 'showUnequipped_consumable',
            tool: 'showUnequipped_tool',
            backpack: 'showUnequipped_backpack',
            loot: 'showUnequipped_loot'
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
