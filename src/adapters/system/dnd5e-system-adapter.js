import { BaseSystemAdapter } from './base-system-adapter.js';

/**
 * System adapter for the DnD5e system.
 * Modifies the base actions list by filtering, calculating resource uses,
 * and sorting them into hierarchical action tabs (right) and item types (left).
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
        const allowedTypes = ['weapon', 'equipment', 'consumable', 'tool', 'backpack', 'loot', 'feat', 'spell'];

        for (const action of actions) {
            const item = action.originalItem;
            
            // 1. Filter by allowed item types
            if (!allowedTypes.includes(item.type)) continue;

            // 2. Filter out unequipped items for weapons, equipment, consumables, and tools
            const isEquipped = item.system.equipped !== false;
            if (['weapon', 'equipment', 'consumable', 'tool'].includes(item.type) && !isEquipped) {
                continue;
            }

            // 3. Filter out unprepared spells (unless they are innate, at-will, or pact magic)
            if (item.type === 'spell') {
                const prepMode = item.system.method;
                const isPrepared = item.system.prepared !== false;
                if (!['innate', 'atwill', 'pact'].includes(prepMode) && !isPrepared) {
                    continue;
                }
            }

            // 4. Process activities if they exist (D&D 5e v4+)
            const activities = item.system.activities;
            const activeActivities = activities 
                ? Array.from(activities.values()).filter(a => a.activation?.type && a.activation.type !== 'none')
                : [];

            if (activeActivities.length > 0) {
                // Create a SINGLE action for the item, representing all its active activities
                const activityAction = {
                    ...action,
                    name: item.name, // Keep the clean item name
                    img: item.img, // Use the parent item's icon
                    uses: this._calculateUses(item, actor), // Use item-level uses
                    roll: async (event) => {
                        // Default roll behavior (rolls the first activity directly)
                        return activeActivities[0].use({ event });
                    }
                };

                // Collect all unique tabs this item's activities belong to
                const uniqueTabs = [];
                const seenTabKeys = new Set();

                for (const activity of activeActivities) {
                    const activationType = activity.activation.type;
                    const parentTab = this._getParentTab(activationType);
                    const subTab = this._getSubTab(activationType);
                    
                    const key = subTab ? `${parentTab}/${subTab}` : parentTab;
                    if (!seenTabKeys.has(key)) {
                        seenTabKeys.add(key);
                        uniqueTabs.push(subTab ? [parentTab, subTab] : [parentTab]);
                    }
                }

                activityAction.tabs = uniqueTabs; // Store the array of tabs!

                // Assign to hierarchical item types: [parentType, subType] (for left-side tabs)
                if (item.type === 'spell') {
                    const level = item.system.level ?? 0;
                    activityAction.itemTypes = ['spell', level.toString()];
                } else {
                    activityAction.itemTypes = [item.type];
                }

                // Store all active activities wrapped with their resolved tabs for context-aware rolling
                activityAction.systemData = {
                    recharge: item.system.recharge,
                    activities: activeActivities.map(activity => ({
                        activity,
                        parentTab: this._getParentTab(activity.activation.type),
                        subTab: this._getSubTab(activity.activation.type)
                    }))
                };

                modified.push(activityAction);
            } else {
                // 5. Fallback/Legacy: Process as a single action (for items without activities, or passive containers/loot)
                let activationType = item.system?.activation?.type;
                
                const isPassive = !activationType || activationType === 'none';
                if (isPassive && !['backpack', 'loot'].includes(item.type)) {
                    continue;
                }

                // Calculate resource uses
                action.uses = this._calculateUses(item, actor);

                // Assign to hierarchical action tabs: [parentTab, subTab]
                const parentTab = this._getParentTab(activationType);
                const subTab = this._getSubTab(activationType);
                action.tabs = subTab ? [parentTab, subTab] : [parentTab];

                // Assign to hierarchical item types: [parentType, subType]
                if (item.type === 'spell') {
                    const level = item.system.level ?? 0;
                    action.itemTypes = ['spell', level.toString()];
                } else {
                    action.itemTypes = [item.type];
                }

                action.systemData = {
                    recharge: item.system.recharge
                };

                modified.push(action);
            }
        }

        // Sort actions: parent activation type first, then sub-activation, then item type, then name
        return modified.sort((a, b) => {
            const aParent = a.tabs[0];
            const bParent = b.tabs[0];
            const parentSort = this._getParentSort(aParent) - this._getParentSort(bParent);
            if (parentSort !== 0) return parentSort;

            const aSub = a.tabs[1] ?? '';
            const bSub = b.tabs[1] ?? '';
            const subSort = this._getSubSort(aParent, aSub) - this._getSubSort(bParent, bSub);
            if (subSort !== 0) return subSort;

            const aItemParent = a.itemTypes[0];
            const bItemParent = b.itemTypes[0];
            const typeSort = this._getTypeSort(aItemParent) - this._getTypeSort(bItemParent);
            if (typeSort !== 0) return typeSort;

            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Determine the parent action tab based on DnD5e activation type.
     */
    _getParentTab(type) {
        if (!type || type === 'none') return 'none';
        
        switch (type) {
            case 'action':
            case 'bonus':
            case 'reaction':
                return 'standard';
            
            case 'minute':
            case 'hour':
            case 'day':
                return 'time';
                
            case 'legendary':
            case 'mythic':
            case 'lair':
                return 'monster';
                
            case 'crew':
                return 'vehicle';
                
            case 'special':
                return 'special';
                
            default:
                return 'none';
        }
    }

    /**
     * Determine the sub-action tab based on DnD5e activation type.
     */
    _getSubTab(type) {
        if (!type || type === 'none') return null;
        
        switch (type) {
            case 'action': return 'action';
            case 'bonus': return 'bonus';
            case 'reaction': return 'reaction';
            case 'minute': return 'minute';
            case 'hour': return 'hour';
            case 'day': return 'day';
            case 'legendary': return 'legendary';
            case 'mythic': return 'mythic';
            case 'lair': return 'lair';
            case 'crew': return 'crew';
            default: return null;
        }
    }

    _getParentSort(type) {
        const order = {
            'standard': 1,
            'time': 2,
            'monster': 3,
            'vehicle': 4,
            'special': 5,
            'none': 6
        };
        return order[type] ?? 99;
    }

    _getSubSort(parent, sub) {
        const orders = {
            'standard': { 'action': 1, 'bonus': 2, 'reaction': 3 },
            'time': { 'minute': 1, 'hour': 2, 'day': 3 },
            'monster': { 'legendary': 1, 'mythic': 2, 'lair': 3 },
            'vehicle': { 'crew': 1 }
        };
        return orders[parent]?.[sub] ?? 99;
    }

    _getTypeSort(type) {
        const order = {
            'weapon': 1,
            'equipment': 2,
            'consumable': 3,
            'tool': 4,
            'backpack': 5,
            'loot': 6,
            'feat': 7,
            'spell': 8
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
            const prepMode = system.method;
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
