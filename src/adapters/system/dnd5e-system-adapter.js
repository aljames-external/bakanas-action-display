import { FantasySystemAdapter } from './genre/fantasy-system-adapter.js';
import { localize } from '../../lib/utils.js';
import { log } from '../../lib/logger.js';

import { MODULE_ID } from '../../constants.js';

/**
 * System adapter for D&D 5th Edition.
 * Handles D&D 5e's specific item types, action categories, spell slot calculations,
 * and spell preparation toggles.
 */
export class Dnd5eSystemAdapter extends FantasySystemAdapter {
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
            
            // Extract spell components if it's a spell (for the Spell Components tab)
            const props = item.system?.properties;
            const spellComponents = [];
            if (item.type === 'spell' && props) {
                const hasProp = (p) => {
                    if (props instanceof Set) return props.has(p);
                    if (Array.isArray(props)) return props.includes(p);
                    if (typeof props === 'object') return !!props[p];
                    return false;
                };
                if (hasProp('vocal')) spellComponents.push(['components', 'vocal']);
                if (hasProp('somatic')) spellComponents.push(['components', 'somatic']);
                if (hasProp('material')) spellComponents.push(['components', 'material']);
            }

            // 1. Filter by allowed item types
            if (!allowedTypes.includes(item.type)) continue;

            // Filter out cached helper items (e.g. spells cached for activities on feats/equipment)
            if (item.getFlag('dnd5e', 'cachedFor')) continue;

            // 2. Filter out unequipped items for weapons, equipment, consumables, and tools
            const isEquipped = item.system.equipped !== false;
            if (['weapon', 'equipment', 'consumable', 'tool'].includes(item.type) && !isEquipped) {
                continue;
            }

            // 3. Filter out unprepared spells (unless they are innate, at-will, or pact magic, or showUnprepared is enabled)
            let isSpellUnprepared = false;
            if (item.type === 'spell') {
                const prepMode = item.system.method;
                const isPrepared = !!item.system.prepared;
                const showUnprepared = actor.getFlag(MODULE_ID, 'showUnprepared');
                
                if (!['innate', 'atwill', 'pact'].includes(prepMode) && !isPrepared) {
                    isSpellUnprepared = true;
                }
                
                if (!showUnprepared && isSpellUnprepared) {
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
                    unprepared: isSpellUnprepared,
                    roll: async (event) => {
                        // Default roll behavior (rolls the first activity directly)
                        const proxiedEvent = this._createRollEvent(event);
                        return activeActivities[0].use({ event: proxiedEvent }, { event: proxiedEvent });
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

                // Add spell components to the action's tabs
                for (const comp of spellComponents) {
                    uniqueTabs.push(comp);
                }

                activityAction.tabs = uniqueTabs; // Store the array of tabs!

                // Assign to hierarchical item types: [parentType, subType] (for left-side tabs)
                // - Equipment with limited uses goes to Item Charges.
                // - Other item types (feats, weapons, consumables, tools) with limited uses ONLY go to Item Charges if they cast spells.
                const hasCastActivity = activeActivities.some(a => a.type === 'cast');
                const isItemCharges = (item.type === 'equipment' && this._hasLimitedUses(item, actor))
                    || (['feat', 'weapon', 'consumable', 'tool'].includes(item.type) && this._hasLimitedUses(item, actor) && hasCastActivity);

                if (item.type === 'spell') {
                    const level = item.system.level ?? 0;
                    activityAction.itemTypes = ['spell', level.toString()];
                } else if (isItemCharges) {
                    activityAction.itemTypes = ['spell', 'itemCharges'];
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
                        roll: async (event) => {
                            const proxiedEvent = this._createRollEvent(event);
                            return activity.use({ event: proxiedEvent }, { event: proxiedEvent });
                        },
                        originalActivity: activity // Store for module adapters (like midi-qol)
                    };
                });

                // If there is only one active activity, roll up its uses to the main action
                if (activeActivities.length === 1) {
                    activityAction.uses = activityAction.subActions[0].uses;
                } else {
                    // For multiple activities, use item-level uses (e.g. wand charges)
                    // Spells fall back to spell slots
                    if (item.type === 'spell') {
                        activityAction.uses = this._calculateSpellSlots(item, actor);
                    } else {
                        activityAction.uses = this._calculateUses(item, actor);
                    }
                }

                modified.push(activityAction);
            } else if (['backpack', 'loot'].includes(item.type)) {
                // Passive containers and loot (no activities) are shown in the inventory
                const passiveAction = {
                    ...action,
                    tabs: [['economy', 'none']],
                    itemTypes: [item.type],
                    uses: { available: null, max: null }
                };
                modified.push(passiveAction);
            }
        }

        // Resource Filtering: Filter out actions with depleted resources if enabled
        let filtered = modified;
        const filterNoResources = game.settings.get(MODULE_ID, 'filterNoResources');
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
        // Everything (including times, actions, legendary, special, none)
        // now goes under 'economy' (Action Economy)
        return 'economy';
    }

    /**
     * Determine the sub-action tab based on DnD5e activation type.
     */
    _getSubTab(type) {
        if (!type || type === 'none') return 'none'; // 'none' activation becomes 'none' sub-tab
        
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
            case 'special': return 'special';
            default: return 'none'; // Default to 'none' sub-tab for any unhandled
        }
    }

    _getParentSort(type) {
        const order = {
            'economy': 1
        };
        return order[type] ?? 99;
    }

    _getSubSort(parent, sub) {
        const orders = {
            'economy': {
                'action': 1,
                'bonus': 2,
                'reaction': 3,
                'special': 4,
                'legendary': 5,
                'mythic': 6,
                'crew': 7,
                'lair': 8,
                'minute': 9,
                'hour': 10,
                'day': 11,
                'none': 12
            }
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
     * Check if an item has limited uses (either at the item level or activity level).
     * @param {Item} item The item to check
     * @param {Actor} actor The actor
     * @returns {boolean} True if the item has limited uses
     * @private
     */
    _hasLimitedUses(item, actor) {
        const system = item.system;
        
        // 1. Check item-level uses
        if (system.uses && system.uses.max && system.uses.max !== "0") {
            const max = parseInt(system.uses.max, 10) || 0;
            if (max > 0) return true;
        }
        
        // 2. Check activity-level uses
        const activities = system.activities;
        if (activities) {
            for (const activity of activities.values()) {
                if (activity.uses && activity.uses.max && activity.uses.max !== "0") {
                    const max = parseInt(activity.uses.max, 10) || 0;
                    if (max > 0) return true;
                }
            }
        }
        
        return false;
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
                const spent = activity.uses.spent ?? 0;
                const available = activity.uses.value !== undefined ? activity.uses.value : (max - spent);
                return { available, max };
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
                        const spent = targetActivity.uses.spent ?? 0;
                        const available = targetActivity.uses.value !== undefined ? targetActivity.uses.value : (max - spent);
                        return { available, max };
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
                // Robust resolution: Check if the target is a UUID or a plain ID, resolving relative to item/actor
                const targetItem = target.target?.includes('.')
                    ? (foundry.utils.fromUuidSync(target.target, { relative: item })
                       || foundry.utils.fromUuidSync(target.target, { relative: actor })
                       || actor.items.get(target.target))
                    : actor.items.get(target.target);

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
                const targetItem = target.target?.includes('.')
                    ? (foundry.utils.fromUuidSync(target.target, { relative: item })
                       || foundry.utils.fromUuidSync(target.target, { relative: actor })
                       || actor.items.get(target.target))
                    : actor.items.get(target.target);

                if (targetItem) {
                    const qty = targetItem.system.quantity ?? 0;
                    const consumed = target.value || 1;
                    return {
                        available: Math.floor(qty / consumed),
                        max: null
                    };
                }
            }
        }
        
        // Fallback for standard spells if no explicit spellSlots consumption target was resolved
        if (item.type === 'spell') {
            return this._calculateSpellSlots(item, actor);
        }

        // Fallback for weapons requiring ammunition if no explicit consumption target was resolved
        if (item.type === 'weapon' && item.system.ammunition?.type) {
            return this._calculateWeaponAmmunition(item, actor);
        }

        return { available: null, max: null };
    }

    /**
     * Fallback method to calculate spell slots for standard slot-based spells.
     * Used when the Cast activity doesn't have an explicit spellSlots consumption target.
     * @private
     */
    _calculateSpellSlots(item, actor) {
        const system = item.system;
        const prepMode = system.method;
        const actorSpells = actor.system.spells;
        const level = system.level ?? 0;
        
        if (prepMode === 'pact') {
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
        } else if (!['innate', 'atwill'].includes(prepMode)) {
            if (level > 0) {
                const spellSlot = actorSpells?.[`spell${level}`];
                const available = spellSlot?.value ?? 0;
                const max = spellSlot?.max ?? 0;
                
                if (available > 0) {
                    return { available, max };
                }
                
                if (this._hasAvailableUpcastSlots(actor, level)) {
                    return {
                        available: localize('BAD.dnd5e.upcast', 'Upcast'),
                        max: null,
                        isUpcast: true
                    };
                }
                
                return { available: 0, max };
            }
        }
        return { available: null, max: null };
    }

    /**
     * Fallback method to calculate ammunition quantity for ranged weapons.
     * Used when the Attack activity doesn't have a working item consumption target.
     * @private
     */
    _calculateWeaponAmmunition(item, actor) {
        const ammoType = item.system.ammunition.type;
        let quantity = 0;
        if (actor) {
            const ammoItems = actor.items.filter(i => 
                i.type === 'consumable' && 
                i.system.type?.value === 'ammo' && 
                i.system.type?.subtype === ammoType
            );
            for (const ammoItem of ammoItems) {
                quantity += ammoItem.system.quantity ?? 0;
            }
        }
        return {
            available: quantity,
            max: null
        };
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
            'other': localize('DND5E.ActionOther', 'Other'),
            'hidden': localize('BAD.hud.hidden', 'Hidden')
        };
        return labels[parentId] ?? super.getItemTypeLabel(parentId);
    }

    getItemTypeIcon(parentId) {
        const icons = {
            'equipment': 'fas fa-shield',
            'tool': 'fas fa-hammer',
            'backpack': 'fas fa-sack',
            'loot': 'fas fa-gem'
        };
        return icons[parentId] ?? super.getItemTypeIcon(parentId);
    }

    /**
     * Get the localized label for a left-side item sub-tab for DnD5e.
     */
    getItemSubTabLabel(parentId, subId) {
        if (parentId === 'spell') {
            if (subId === 'itemCharges') {
                return localize('BAD.dnd5e.itemCharges', 'Item Charges');
            }
            if (subId === '0') {
                return localize('DND5E.SpellCantrip', 'Cantrip');
            }
            const key = `DND5E.SpellLevel${subId}`;
            return (game.i18n && game.i18n.has(key)) ? game.i18n.localize(key) : `${subId} Level`;
        }
        return super.getItemSubTabLabel(parentId, subId);
    }



    /**
     * Get the localized label for a right-side action type (parent tab) for DnD5e.
     */
    getActionTypeLabel(parentId) {
        const labels = {
            'economy': localize('BAD.dnd5e.actionEconomy', 'Action Economy'),
            'components': localize('BAD.dnd5e.spellComponents', 'Spell Components')
        };
        return labels[parentId] ?? super.getActionTypeLabel(parentId);
    }

    /**
     * Get the CSS icon class for a right-side action type (parent tab) for DnD5e.
     */
    getActionTypeIcon(parentId) {
        const icons = {
            'economy': 'fas fa-stopwatch',
            'components': 'fas fa-magic'
        };
        return icons[parentId] ?? super.getActionTypeIcon(parentId);
    }

    getActionSubTabLabel(subId) {
        const labels = {
            'all': localize('BAD.hud.allActions', 'All Actions'),
            'action': localize('DND5E.Action', 'Action'),
            'bonus': localize('DND5E.BonusAction', 'Bonus Action'),
            'reaction': localize('DND5E.Reaction', 'Reaction'),
            'minute': localize('DND5E.TimeMinute', 'Minute'),
            'hour': localize('DND5E.TimeHour', 'Hour'),
            'day': localize('DND5E.TimeDay', 'Day'),
            'legendary': localize('DND5E.LegendaryAction', 'Legendary'),
            'mythic': localize('DND5E.MythicAction', 'Mythic'),
            'lair': localize('DND5E.LairAction', 'Lair'),
            'crew': localize('DND5E.CrewAction', 'Crew'),
            'special': localize('DND5E.Special', 'Special'),
            'none': localize('DND5E.None', 'None'),
            'vocal': localize('DND5E.ComponentVerbal', 'Verbal'),
            'somatic': localize('DND5E.ComponentSomatic', 'Somatic'),
            'material': localize('DND5E.ComponentMaterial', 'Material')
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

    /**
     * Get D&D 5e-specific context menu items for spells (Prepare/Unprepare).
     * @param {ApplicationV2} app The ActionDisplayApp instance
     * @returns {Object[]} An array of context menu item configurations
     */
    getContextMenuItems(app) {
        return [
            {
                name: "BAD.dnd5e.prepareSpell",
                icon: '<i class="fas fa-book"></i>',
                condition: el => {
                    if (!app.actor?.isOwner) return false;
                    const actionId = el.dataset.actionId;
                    const actions = app.actions || [];
                    const action = actions.find(a => a.id === actionId);
                    if (!action) return false;
                    const item = action.originalItem;
                    if (item?.type !== 'spell') return false;
                    
                    const prepMode = item.system.method;
                    const isPrepared = !!item.system.prepared;
                    return !['innate', 'atwill', 'pact'].includes(prepMode) && !isPrepared;
                },
                callback: async el => {
                    const actionId = el.dataset.actionId;
                    const actions = app.actions || [];
                    const action = actions.find(a => a.id === actionId);
                    const item = action?.originalItem;
                    if (item) {
                        log.debug(`Preparing spell: ${item.name}`);
                        await item.update({ "system.prepared": 1 });
                    }
                }
            },
            {
                name: "BAD.dnd5e.unprepareSpell",
                icon: '<i class="fas fa-book-dead"></i>',
                condition: el => {
                    if (!app.actor?.isOwner) return false;
                    const actionId = el.dataset.actionId;
                    const actions = app.actions || [];
                    const action = actions.find(a => a.id === actionId);
                    if (!action) return false;
                    const item = action.originalItem;
                    if (item?.type !== 'spell') return false;
                    
                    const prepMode = item.system.method;
                    return !['innate', 'atwill', 'pact'].includes(prepMode) && item.system.prepared === 1;
                },
                callback: async el => {
                    const actionId = el.dataset.actionId;
                    const actions = app.actions || [];
                    const action = actions.find(a => a.id === actionId);
                    const item = action?.originalItem;
                    if (item) {
                        log.debug(`Unpreparing spell: ${item.name}`);
                        await item.update({ "system.prepared": 0 });
                    }
                }
            }
        ];
    }

    modifyContext(context, app) {
        super.modifyContext(context, app); // Automatically sorts spell sub-tabs!
        const spellParent = context.itemTypes.find(t => t.id === 'spell');
        if (spellParent && spellParent.subTabs.length > 0) {
            // Inject "All Spells" at the beginning
            const showUnprepared = app.actor.getFlag(MODULE_ID, 'showUnprepared') ?? false;
            spellParent.subTabs.unshift({
                id: 'all',
                label: 'All Spells',
                active: app.activeLeftParentTypes.has('spell') && app.activeLeftSubTypes.size === 0,
                showUnprepared: showUnprepared
            });
        }
    }

    /**
     * Handle right-click on the "All Spells" tab to toggle unprepared spells.
     * @param {ApplicationV2} app The ActionDisplayApp instance
     * @param {HTMLElement} el The tab element that was right-clicked
     * @param {Event} event The event
     * @returns {boolean} True if handled
     */
    /**
     * Create a proxy around a browser event to inject keyboard modifiers (Alt/Ctrl/Shift)
     * while preserving all other native event properties and methods (like target, preventDefault).
     * @param {Event} event The original browser event
     * @returns {Event|object} A proxy event or empty object
     * @private
     */
    _createRollEvent(event) {
        if (!event) return {};
        return new Proxy(event, {
            get: (target, prop) => {
                if (prop === 'altKey') {
                    return event.altKey || game.keyboard.isModifierActive(KeyboardManager.MODIFIER_KEYS.ALT);
                }
                if (prop === 'ctrlKey') {
                    return event.ctrlKey || game.keyboard.isModifierActive(KeyboardManager.MODIFIER_KEYS.CONTROL);
                }
                if (prop === 'shiftKey') {
                    return event.shiftKey || game.keyboard.isModifierActive(KeyboardManager.MODIFIER_KEYS.SHIFT);
                }
                const val = Reflect.get(target, prop);
                if (typeof val === 'function') {
                    return val.bind(target);
                }
                return val;
            }
        });
    }

    onTabRightClick(app, el, event) {
        if (el.dataset.type === 'all') {
            const parentGroup = el.closest('.bad-left-tab-group');
            const parentTab = parentGroup?.querySelector('.bad-left-tab');
            if (parentTab?.dataset.type === 'spell' && app.actor?.isOwner) {
                const showUnprepared = app.actor.getFlag(MODULE_ID, 'showUnprepared') ?? false;
                
                log.group("BAD | Right-Click 'All Spells' Tab (Adapter)", "debug");
                log.debug("Current showUnprepared state:", showUnprepared);
                
                app.actor.setFlag(MODULE_ID, 'showUnprepared', !showUnprepared);
                
                log.debug("New showUnprepared state set to:", !showUnprepared);
                log.groupEnd();
                return true; // Handled!
            }
        }
        return false;
    }
}
