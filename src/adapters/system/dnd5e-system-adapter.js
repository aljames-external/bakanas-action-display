import { BaseSystemAdapter, localize } from './base-system-adapter.js';

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

                // Store all active activities as generic subActions
                activityAction.subActions = activeActivities.map(activity => {
                    const activationType = activity.activation.type;
                    const parentTab = this._getParentTab(activationType);
                    const subTab = this._getSubTab(activationType);
                    return {
                        id: activity.id,
                        name: activity.name || activity.type.toUpperCase(),
                        img: activity.img || item.img,
                        uses: this._calculateActivityUses(activity, item, actor),
                        tabs: subTab ? [parentTab, subTab] : [parentTab],
                        roll: async (event) => activity.use({ event }),
                        originalActivity: activity // Store for module adapters (like midi-qol)
                    };
                });

                // If there is only one active activity, roll up its uses to the main action
                if (activeActivities.length === 1) {
                    activityAction.uses = activityAction.subActions[0].uses;
                } else {
                    // For multiple activities, use item-level uses (e.g. wand charges)
                    activityAction.uses = this._calculateUses(item, actor);
                }

                modified.push(activityAction);
            } else if (['backpack', 'loot'].includes(item.type)) {
                // Passive containers and loot (no activities) are shown in the inventory
                const passiveAction = {
                    ...action,
                    tabs: ['none'],
                    itemTypes: [item.type],
                    uses: { available: null, max: null }
                };
                modified.push(passiveAction);
            }
        }

        // Resource Filtering: Filter out actions with depleted resources if enabled
        let filtered = modified;
        const filterNoResources = game.settings.get('bakanas-action-display', 'filterNoResources');
        if (filterNoResources) {
            filtered = modified.filter(action => {
                // 1. If it has item-level uses, check if they are depleted (exempt upcastable spells)
                const itemDepleted = action.uses && action.uses.available !== null && action.uses.available <= 0 && !action.uses.isUpcast;
                if (itemDepleted) return false;
                
                // 2. If it has activities, check if ALL activities are depleted
                const activities = action.systemData?.activities;
                if (activities && activities.length > 0) {
                    const allActivitiesDepleted = activities.every(entry => {
                        return entry.uses && entry.uses.available !== null && entry.uses.available <= 0;
                    });
                    if (allActivitiesDepleted) return false;
                }
                
                return true;
            });
        }

        // Sort actions: parent activation type first, then sub-activation, then item type, then name
        return filtered.sort((a, b) => {
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

        // 1. Limited Uses (standard item charges/uses)
        if (system.uses && system.uses.max && system.uses.max !== "0") {
            let max = system.uses.max;
            if (typeof max === 'string') {
                max = parseInt(max, 10) || 0;
            }

            if (max > 0) {
                let available = system.uses.value ?? 0;
                // Scale by quantity for consumables
                const quantity = system.quantity ?? 1;
                if (quantity > 1 && item.type === 'consumable') {
                    available = available + (quantity - 1) * max;
                    max = max * quantity;
                }
                return { available, max };
            }
        }

        // 2. Consumable Quantity (if no explicit charges, quantity is the uses)
        if (item.type === 'consumable') {
            return {
                available: system.quantity ?? 0,
                max: null
            };
        }

        // 3. Thrown Weapons (quantity is the uses)
        if (item.type === 'weapon' && foundry.utils.getProperty(system.properties, 'thr') && !foundry.utils.getProperty(system.properties, 'ret')) {
            return {
                available: system.quantity ?? 0,
                max: null
            };
        }

        return { available: null, max: null };
    }

    /**
     * Calculate available and maximum uses for a D&D 5e Activity.
     * @param {Activity} activity The activity instance
     * @param {Item} item The parent item
     * @param {Actor} actor The actor
     * @returns {{available: number|null, max: number|null}} The uses count
     * @private
     */
    _calculateActivityUses(activity, item, actor) {
        const targets = activity.consumption?.targets || [];
        
        // 1. If the activity has its own explicit limited uses
        if (activity.uses && activity.uses.max && activity.uses.max !== "0") {
            let max = activity.uses.max;
            if (typeof max === 'string') {
                max = parseInt(max, 10) || 0;
            }
            if (max > 0) {
                return { available: activity.uses.value ?? 0, max: max };
            }
        }
        
        // 2. Resolve based on consumption targets
        for (const target of targets) {
            if (target.type === 'activityUses') {
                // Consumes another activity's uses (or self if target is empty)
                const targetActivity = target.target ? item.system.activities.get(target.target) : activity;
                if (targetActivity && targetActivity.uses && targetActivity.uses.max && targetActivity.uses.max !== "0") {
                    let max = targetActivity.uses.max;
                    if (typeof max === 'string') {
                        max = parseInt(max, 10) || 0;
                    }
                    if (max > 0) {
                        return {
                            available: targetActivity.uses.value ?? 0,
                            max: max
                        };
                    }
                }
            } else if (target.type === 'itemUses') {
                // Consumes the parent item's uses
                return this._calculateUses(item, actor);
            } else if (target.type === 'spellSlots') {
                // Consumes actor spell slots
                const actorSpells = actor.system.spells;
                const level = target.target || item.system.level; // Fallback to spell's base level if target is empty (dynamic slots)
                if (level === 'pact') {
                    const pact = actorSpells?.pact;
                    const available = pact?.value ?? 0;
                    const max = pact?.max ?? 0;
                    
                    if (available > 0) {
                        return { available, max };
                    }
                    
                    if (this._hasAvailableUpcastSlots(actor, pact?.level ?? 0)) {
                        return {
                            available: localize('BAD.dnd5e.upcast', 'Upcast'),
                            max: null,
                            isUpcast: true
                        };
                    }
                    return { available: 0, max };
                } else {
                    const lvl = parseInt(level, 10) || 0;
                    const spellSlot = actorSpells?.[`spell${lvl}`];
                    const available = spellSlot?.value ?? 0;
                    const max = spellSlot?.max ?? 0;
                    
                    if (available > 0) {
                        return { available, max };
                    }
                    
                    if (this._hasAvailableUpcastSlots(actor, lvl)) {
                        return {
                            available: localize('BAD.dnd5e.upcast', 'Upcast'),
                            max: null,
                            isUpcast: true
                        };
                    }
                    return { available: 0, max };
                }
            } else if (target.type === 'item') {
                // Consumes quantity of another item (e.g. ammunition) or charges of another item
                const targetItem = actor.items.get(target.target);
                if (targetItem) {
                    const consumed = target.value || 1;
                    // If the target item has its own limited uses (like a wand), use those
                    const uses = this._calculateUses(targetItem, actor);
                    if (uses.available !== null) {
                        return {
                            available: Math.floor(uses.available / consumed),
                            max: uses.max !== null ? Math.floor(uses.max / consumed) : null
                        };
                    }
                    // Otherwise, use its quantity (standard ammo/consumable)
                    const qty = targetItem.system.quantity ?? 0;
                    return {
                        available: Math.floor(qty / consumed),
                        max: null
                    };
                }
            } else if (target.type === 'material') {
                // Consumes quantity of another item (specifically spell components)
                const targetItem = actor.items.get(target.target);
                const qty = targetItem?.system?.quantity ?? 0;
                const consumed = target.value || 1;
                return {
                    available: Math.floor(qty / consumed),
                    max: null
                };
            }
        }
        
        return { available: null, max: null };
    }

    getItemTypeLabel(parentId) {
        const labels = {
            'all': 'All Items',
            'weapon': localize('DND5E.ItemTypeWeapon', 'Weapon'),
            'equipment': localize('DND5E.ItemTypeEquipment', 'Equipment'),
            'consumable': localize('DND5E.ItemTypeConsumable', 'Consumable'),
            'tool': localize('DND5E.ItemTypeTool', 'Tool'),
            'backpack': localize('DND5E.ItemTypeContainer', 'Container'),
            'loot': localize('DND5E.ItemTypeLoot', 'Loot'),
            'feat': localize('DND5E.ItemTypeFeat', 'Feature'),
            'spell': localize('DND5E.ItemTypeSpell', 'Spell'),
            'other': localize('DND5E.Other', 'Other'),
            'hidden': localize('BAD.hud.hidden', 'Hidden')
        };
        return labels[parentId] ?? super.getItemTypeLabel(parentId);
    }

    getSpellLevelLabel(level) {
        if (level === '0') {
            return localize('DND5E.SpellCantrip', 'Cantrip');
        }
        const key = `DND5E.SpellLevel${level}`;
        return (game.i18n && game.i18n.has(key)) ? game.i18n.localize(key) : super.getSpellLevelLabel(level);
    }

    getActionSubTabLabel(subId) {
        const labels = {
            'action': localize('DND5E.Action', 'Action'),
            'bonus': localize('DND5E.BonusAction', 'Bonus Action'),
            'reaction': localize('DND5E.Reaction', 'Reaction'),
            'minute': localize('DND5E.TimeMinute', 'Minute'),
            'hour': localize('DND5E.TimeHour', 'Hour'),
            'day': localize('DND5E.TimeDay', 'Day'),
            'legendary': localize('DND5E.LegendaryAction', 'Legendary'),
            'mythic': localize('DND5E.MythicAction', 'Mythic'),
            'lair': localize('DND5E.LairAction', 'Lair'),
            'crew': localize('DND5E.CrewAction', 'Crew')
        };
        return labels[subId] ?? super.getActionSubTabLabel(subId);
    }

    /**
     * Check if the actor has any available spell slots (standard or pact) of a given level or higher.
     * @private
     */
    _hasAvailableUpcastSlots(actor, level) {
        if (!actor) return false;
        const actorSpells = actor.system.spells;
        if (!actorSpells) return false;

        // 1. Check standard spell slots of equal or higher level (up to 9)
        for (let i = level; i <= 9; i++) {
            const slot = actorSpells[`spell${i}`];
            if (slot && slot.value > 0) {
                return true;
            }
        }

        // 2. Check Pact Magic slots
        const pact = actorSpells.pact;
        if (pact && pact.value > 0 && (pact.level ?? 0) >= level) {
            return true;
        }

        return false;
    }
}
