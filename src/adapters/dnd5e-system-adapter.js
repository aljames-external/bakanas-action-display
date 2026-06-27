import { BaseSystemAdapter } from './base-system-adapter.js';

/**
 * System adapter for the DnD5e system.
 * Modifies the base actions list by filtering out passive items, calculating resource uses, and sorting them into tabs.
 */
export class Dnd5eSystemAdapter extends BaseSystemAdapter {
    constructor() {
        super('dnd5e');
    }

    /**
     * Filter, map, and sort the base actions list for DnD5e.
     * @param {Object[]} actions Base action list from the core
     * @param {Actor} actor 
     * @returns {Object[]} The modified actions list
     */
    modifyActions(actions, actor) {
        const modified = [];

        for (const action of actions) {
            const item = action.originalItem;
            const activationType = item.system?.activation?.type;

            // 1. Filter out items without activation types (passive items)
            if (!activationType || activationType === 'none') continue;

            // 2. Filter out unequipped items for weapons, equipment, and consumables
            const isEquipped = item.system.equipped !== false;
            if (['weapon', 'equipment', 'consumable'].includes(item.type) && !isEquipped) {
                continue;
            }

            // 3. Filter out unprepared spells (unless they are innate, at-will, or pact magic)
            const prepMode = item.system.preparation?.mode ?? 'prepared';
            const isPrepared = item.system.preparation?.prepared !== false;
            if (item.type === 'spell' && !['innate', 'atwill', 'pact'].includes(prepMode) && !isPrepared) {
                continue;
            }

            // 4. Calculate resource uses
            action.uses = this._calculateUses(item, actor);

            // 5. Assign to tabs based on normalized activation type
            const tab = this._normalizeActivationType(activationType);
            action.tabs = [tab];

            // Maintain system-specific data
            action.systemData = {
                recharge: item.system.recharge
            };

            modified.push(action);
        }

        // Sort actions: activation type first, then item type, then name
        return modified.sort((a, b) => {
            const actSort = this._getActivationSort(a.tabs[0]) - this._getActivationSort(b.tabs[0]);
            if (actSort !== 0) return actSort;

            const typeSort = this._getTypeSort(a.type) - this._getTypeSort(b.type);
            if (typeSort !== 0) return typeSort;

            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Normalize DnD5e activation types to our core types.
     */
    _normalizeActivationType(type) {
        switch (type) {
            case 'action': return 'action';
            case 'bonus': return 'bonus';
            case 'reaction': return 'reaction';
            case 'legendary': return 'legendary';
            case 'lair': return 'lair';
            case 'special': return 'special';
            case 'crew': return 'crew';
            default: return 'other';
        }
    }

    _getActivationSort(type) {
        const order = {
            'action': 1,
            'bonus': 2,
            'reaction': 3,
            'legendary': 4,
            'lair': 5,
            'crew': 6,
            'special': 7,
            'other': 8
        };
        return order[type] ?? 99;
    }

    _getTypeSort(type) {
        const order = {
            'weapon': 1,
            'equipment': 2,
            'consumable': 3,
            'feat': 4,
            'spell': 5,
            'other': 6
        };
        return order[type] ?? 99;
    }

    /**
     * Calculate available and maximum uses for an item.
     */
    _calculateUses(item, actor) {
        const system = item.system;

        // 1. Consume Target (e.g. ammunition, attributes, charges)
        if (system.consume?.target) {
            return this._calculateConsumeUses(actor, system.consume);
        }

        // 2. Limited Uses (standard item charges/uses)
        if (system.uses && (system.uses.max || system.uses.value)) {
            let available = system.uses.value ?? 0;
            let max = system.uses.max ?? 0;
            if (typeof max === 'string') {
                max = parseInt(max, 10) || 0;
            }

            // Scale by quantity for consumables
            const quantity = system.quantity ?? 1;
            if (quantity > 1 && item.type === 'consumable') {
                available = available + (quantity - 1) * max;
                max = max * quantity;
            }
            return { available, max };
        }

        // 3. Feat Recharge
        if (item.type === 'feat' && system.recharge?.value) {
            return {
                available: system.recharge.charged ? 1 : 0,
                max: 1
            };
        }

        // 4. Consumable Quantity (if no explicit charges, quantity is the uses)
        if (item.type === 'consumable') {
            return {
                available: system.quantity ?? 0,
                max: null
            };
        }

        // 5. Spells (slot-based spells)
        if (item.type === 'spell') {
            const prepMode = system.preparation?.mode;
            const actorSpells = actor.system.spells;
            if (prepMode === 'pact') {
                return {
                    available: actorSpells?.pact?.value ?? 0,
                    max: actorSpells?.pact?.max ?? 0
                };
            } else if (!['innate', 'atwill'].includes(prepMode)) {
                const level = system.level ?? 0;
                if (level > 0) {
                    const spellSlot = actorSpells?.[`spell${level}`];
                    return {
                        available: spellSlot?.value ?? 0,
                        max: spellSlot?.max ?? 0
                    };
                }
            }
        }

        // 6. Thrown Weapons (quantity is the uses)
        if (item.type === 'weapon' && foundry.utils.getProperty(system.properties, 'thr') && !foundry.utils.getProperty(system.properties, 'ret')) {
            return {
                available: system.quantity ?? 0,
                max: null
            };
        }

        return { available: null, max: null };
    }

    /**
     * Calculate uses that consume other resources (ammo, attributes, or charges of another item).
     */
    _calculateConsumeUses(actor, consume) {
        let available = 0;
        let max = null;

        if (consume.type === 'attribute') {
            const val = foundry.utils.getProperty(actor.system, consume.target);
            available = typeof val === 'number' ? val : 0;
        } else if (consume.type === 'ammo' || consume.type === 'material') {
            const targetItem = actor.items.get(consume.target);
            available = targetItem?.system?.quantity ?? 0;
        } else if (consume.type === 'charges') {
            const targetItem = actor.items.get(consume.target);
            if (targetItem) {
                const uses = this._calculateUses(targetItem, actor);
                available = uses.available ?? 0;
                max = uses.max;
            }
        }

        if (consume.amount && consume.amount > 1) {
            available = Math.floor(available / consume.amount);
            if (max !== null) {
                max = Math.floor(max / consume.amount);
            }
        }

        return { available, max };
    }
}
