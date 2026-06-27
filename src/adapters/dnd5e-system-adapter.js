import { BaseSystemAdapter } from './base-system-adapter.js';

/**
 * System adapter for the DnD5e system.
 * Extracts actions, spells, features, and weapons, and calculates their remaining uses.
 */
export class Dnd5eSystemAdapter extends BaseSystemAdapter {
    constructor() {
        super('dnd5e');
    }

    /**
     * Extract and sort actions from a DnD5e actor.
     * @param {Actor} actor 
     * @returns {Object[]} Unified action objects
     */
    getActions(actor) {
        if (!actor) return [];

        const actions = [];
        for (const item of actor.items) {
            const action = this._parseItem(item, actor);
            if (action) {
                actions.push(action);
            }
        }

        // Sort actions: activation type first, then item type, then name
        return actions.sort((a, b) => {
            const actSort = this._getActivationSort(a.activationType) - this._getActivationSort(b.activationType);
            if (actSort !== 0) return actSort;

            const typeSort = this._getTypeSort(a.type) - this._getTypeSort(b.type);
            if (typeSort !== 0) return typeSort;

            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Parse a single DnD5e Item into a unified action.
     * @param {Item} item 
     * @param {Actor} actor 
     * @returns {Object|null} The action object, or null if it's not an action
     */
    _parseItem(item, actor) {
        const activationType = item.system?.activation?.type;
        if (!activationType || activationType === 'none') return null;

        // Filter out unequipped items for weapons/equipment/consumables
        const isEquipped = item.system.equipped !== false;
        if (['weapon', 'equipment', 'consumable'].includes(item.type) && !isEquipped) {
            return null;
        }

        // Filter out unprepared spells (unless they are innate, at-will, or pact magic)
        const prepMode = item.system.preparation?.mode ?? 'prepared';
        const isPrepared = item.system.preparation?.prepared !== false;
        if (item.type === 'spell' && !['innate', 'atwill', 'pact'].includes(prepMode) && !isPrepared) {
            return null;
        }

        const uses = this._calculateUses(item, actor);

        return {
            id: item.id,
            name: item.name,
            type: item.type,
            img: item.img,
            activationType: this._normalizeActivationType(activationType),
            roll: (event) => {
                if (typeof item.use === 'function') {
                    item.use({ event });
                } else if (typeof item.roll === 'function') {
                    item.roll({ event });
                }
            },
            originalItem: item,
            uses: uses,
            systemData: {
                recharge: item.system.recharge
            }
        };
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
