import { FantasySystemAdapter } from './genre/fantasy-system-adapter.js';
import { localize } from '../../lib/utils.js';
import { log } from '../../lib/logger.js';
import { MODULE_ID } from '../../constants.js';
import { TabRef } from '../../ui/tab-ref.js';

const SORT_ORDERS = {
    tabs: {
        'spell': {
            'all': 0, 'level_0': 1, 'level_1': 2, 'level_2': 3, 'level_3': 4,
            'level_4': 5, 'level_5': 6, 'level_6': 7, 'level_7': 8, 'level_8': 9,
            'level_9': 10, 'itemCharges': 99
        },
        'weapon': {
            'all': 0, 'simpleM': 1, 'martialM': 2, 'simpleR': 3, 'martialR': 4,
            'natural': 5, 'improv': 6, 'siege': 7
        },
        'equipment': {
            'all': 0, 'light': 1, 'medium': 2, 'heavy': 3, 'shield': 4,
            'clothing': 5, 'trinket': 6, 'ring': 7, 'rod': 8, 'wand': 9,
            'wondrous': 10, 'vehicle': 11, 'natural': 12
        },
        'economy': {
            'all': 0, 'action': 1, 'bonus': 2, 'reaction': 3, 'other': 4,
            'special': 5, 'legendary': 6, 'mythic': 7, 'crew': 8, 'lair': 9,
            'minute': 10, 'hour': 11, 'day': 12, 'none': 13
        },
        'components': { 'vocal': 0, 'somatic': 1, 'material': 2 }
    },
    item_type: {
        'weapon': 1,
        'equipment': 2,
        'spell': 3,
        'consumable': 4,
        'tool': 5,
        'backpack': 6,
        'loot': 7,
        'feat': 8
    }
};

const ALLOWED_TYPES = new Set(['weapon', 'equipment', 'consumable', 'tool', 'backpack', 'loot', 'feat', 'spell']);

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
     * Determine if a specific item should be extracted as a base action for DnD5e.
     * Prevents allocating objects for unallowed types, cached helper items, and unequipped gear.
     */
    shouldExtractItem(item) {
        const type = item.type;
        if (!ALLOWED_TYPES.has(type)) return false;
        if (item.getFlag('dnd5e', 'cachedFor')) return false;

        const isEquipped = this.getItemEquipped(item);
        if (['consumable', 'tool'].includes(type) && !isEquipped) {
            return false;
        }
        return true;
    }

    /**
     * Filter, map, and sort the base actions list for DnD5e.
     * @param {Object[]} actions Base action list from the core
     * @param {Actor} actor 
     * @returns {Object[]} The modified actions list
     */
    modifyActions(actions, actor) {
        const modified = [];
        const filterNoResources = game.settings.get(MODULE_ID, 'filterNoResources');

        // Pre-calculate ammunition quantities by subtype in a single pass to avoid nested loops (O(I) complexity)
        const ammoQuantities = new Map();
        for (const i of actor.items) {
            if (i.type === 'consumable' && i.system.type?.value === 'ammo') {
                const subtype = i.system.type.subtype;
                if (subtype) {
                    const qty = i.system.quantity ?? 0;
                    ammoQuantities.set(subtype, (ammoQuantities.get(subtype) ?? 0) + qty);
                }
            }
        }

        // Pre-calculate the highest available spell slot level in a single pass (O(1) upcast checks later)
        let highestAvailableSlot = 0;
        const actorSpells = actor.system.spells;
        if (actorSpells) {
            for (let i = 1; i <= 9; i++) {
                if (actorSpells[`spell${i}`]?.value > 0) {
                    highestAvailableSlot = i; // Since we loop 1 to 9, this naturally finds the highest
                }
            }
            const pact = actorSpells.pact;
            if (pact?.value > 0) {
                highestAvailableSlot = Math.max(highestAvailableSlot, pact.level ?? 0);
            }
        }

        for (const action of actions) {
            const item = action.originalItem;
            const type = item.type;
            // Extract spell components for the Spell Components tab (spells or feats with Cast activities)
            const spellComponents = [];
            const compRoot = new TabRef({ label: 'components' });

            // Collect properties from the item itself
            const propSources = [item.system?.properties];

            // Check if any activity is a Cast activity linked to a spell target or has properties
            const itemActivities = this.getItemActivities(item);
            if (itemActivities) {
                for (const activity of itemActivities.values()) {
                    if (activity.type === 'cast') {
                        // Resolve linked spell document from UUID to get its true component properties
                        const spellUuid = activity.spell?.uuid || activity.spell?.id || activity.spellItem?.uuid;
                        const spellTarget = this._resolveTargetItem(spellUuid, item, actor);
                        if (spellTarget?.system?.properties) {
                            propSources.push(spellTarget.system.properties);
                        } else if (activity.spell?.properties && Array.isArray(activity.spell.properties) && activity.spell.properties.length < 3) {
                            propSources.push(activity.spell.properties);
                        }
                    } else if (activity.properties) {
                        propSources.push(activity.properties);
                    }
                }
            }

            const hasProp = prop => propSources.some(p => p?.has?.(prop) || (Array.isArray(p) && p.includes(prop)));

            if (hasProp('vocal')) spellComponents.push(new TabRef({ label: 'vocal', parent: compRoot }));
            if (hasProp('somatic')) spellComponents.push(new TabRef({ label: 'somatic', parent: compRoot }));
            if (hasProp('material')) spellComponents.push(new TabRef({ label: 'material', parent: compRoot }));

            // Check if user has hidden this item
            const hiddenIds = actor.getFlag(MODULE_ID, 'hiddenItems') ?? [];
            const isUserHidden = hiddenIds.includes(item.id);

            // 1. Filter out unprepared spells (unless innate/at-will/pact, showUnprepared is enabled, or item is user-hidden)
            let isSpellUnprepared = false;
            if (type === 'spell') {
                const prepMode = item.system.method;
                const isPrepared = !!item.system.prepared;
                const showUnprepared = actor.getFlag(MODULE_ID, 'showUnprepared');
                
                if (!['innate', 'atwill', 'pact'].includes(prepMode) && !isPrepared) {
                    isSpellUnprepared = true;
                }
                
                if (!showUnprepared && isSpellUnprepared && !isUserHidden) {
                    continue;
                }
            }

            // 2. Filter out unequipped weapons and equipment (unless showUnequipped is enabled or item is user-hidden)
            let isUnequipped = false;
            if (['weapon', 'equipment'].includes(type)) {
                const isEquipped = this.getItemEquipped(item);
                const showUnequipped = actor.getFlag(MODULE_ID, `showUnequipped_${type}`);
                
                if (!isEquipped) {
                    isUnequipped = true;
                }
                
                if (!showUnequipped && isUnequipped && !isUserHidden) {
                    continue;
                }
            }

            // 4. Process activities if they exist (D&D 5e v4+)
            const activities = this.getItemActivities(item);
            const activeActivities = activities 
                ? Array.from(activities.values()).filter(a => a.activation?.type && a.activation.type !== 'none')
                : [];

            if (activeActivities.length > 0) {
                // Map D&D 5e Activities to sub-actions for the generic HUD item model
                const mappedActivities = activeActivities.map(activity => {
                    const activationType = activity.activation.type;
                    const parentId = this._getParentTab(activationType);
                    const subId = this._getSubTab(activationType);
                    const parentRef = new TabRef({ label: parentId });
                    const tabRef = subId !== 'none' ? new TabRef({ label: subId, parent: parentRef }) : parentRef;

                    // Extract activity-specific spell component tabs (prefer true resolved spell document properties)
                    const actPropSources = [];
                    if (activity.type === 'cast') {
                        const spellUuid = activity.spell?.uuid || activity.spell?.id || activity.spellItem?.uuid;
                        const spellTarget = this._resolveTargetItem(spellUuid, item, actor);
                        if (spellTarget?.system?.properties) {
                            actPropSources.push(spellTarget.system.properties);
                        } else if (activity.spell?.properties && Array.isArray(activity.spell.properties) && activity.spell.properties.length < 3) {
                            actPropSources.push(activity.spell.properties);
                        }
                    } else if (activity.properties) {
                        actPropSources.push(activity.properties);
                    }
                    const actHasProp = prop => actPropSources.some(p => p?.has?.(prop) || (Array.isArray(p) && p.includes(prop)));
                    const actSpellComponents = [];
                    if (actHasProp('vocal')) actSpellComponents.push(new TabRef({ label: 'vocal', parent: compRoot }));
                    if (actHasProp('somatic')) actSpellComponents.push(new TabRef({ label: 'somatic', parent: compRoot }));
                    if (actHasProp('material')) actSpellComponents.push(new TabRef({ label: 'material', parent: compRoot }));
                    
                    return {
                        id: activity.id,
                        name: activity.name ?? activity.type.toUpperCase(),
                        img: activity.img ?? item.img,
                        uses: this._calculateActivityUses(activity, item, actor, ammoQuantities, highestAvailableSlot),
                        tabs: tabRef,
                        componentTabs: actSpellComponents,
                        roll: async (event) => {
                            const proxiedEvent = this._createRollEvent(event);
                            return activity.use({ event: proxiedEvent }, { event: proxiedEvent });
                        },
                        originalActivity: activity // Store for module adapters (like midi-qol)
                    };
                });

                // Single-pass Resource Filtering: Filter out depleted D&D 5e Activities if enabled
                let filteredActivities = mappedActivities;
                if (filterNoResources) {
                    filteredActivities = mappedActivities.filter(sub => {
                        // Spells are exempt from depletion if they are upcastable (handled in uses.isUpcast)
                        const isDepleted = sub.uses && sub.uses.available !== null && sub.uses.available <= 0 && !sub.uses.isUpcast;
                        return !isDepleted;
                    });

                    // If all activities are depleted, skip this item entirely!
                    if (filteredActivities.length === 0) {
                        continue;
                    }
                }

                // Create a SINGLE action for the item, representing all its active/non-depleted activities
                const activityAction = {
                    ...action,
                    name: item.name, // Keep the clean item name
                    img: item.img, // Use the parent item's icon
                    unprepared: isSpellUnprepared || isUnequipped,
                    activities: filteredActivities,
                    roll: async (event) => {
                        // Roll the first active activity directly
                        return filteredActivities[0].roll(event);
                    }
                };

                // Collect all unique tabs and componentTabs from the remaining non-depleted activities
                const uniqueTabsMap = new Map();
                const activityCompTabsMap = new Map();

                for (const activity of filteredActivities) {
                    const key = activity.tabs.path;
                    if (!uniqueTabsMap.has(key)) {
                        uniqueTabsMap.set(key, activity.tabs);
                    }
                    if (activity.componentTabs) {
                        for (const compTab of activity.componentTabs) {
                            if (!activityCompTabsMap.has(compTab.path)) {
                                activityCompTabsMap.set(compTab.path, compTab);
                            }
                        }
                    }
                }

                const activeSpellComponents = activityCompTabsMap.size > 0 
                    ? [...activityCompTabsMap.values()] 
                    : spellComponents;

                activityAction.tabs = [...uniqueTabsMap.values(), ...activeSpellComponents];

                // Assign to hierarchical item types: [parentType, subType] (for left-side tabs)
                const hasCastActivity = filteredActivities.some(sub => sub.originalActivity?.type === 'cast');
                const isItemCharges = (type === 'equipment' && this._hasLimitedUses(item))
                    || (['feat', 'weapon', 'consumable', 'tool'].includes(type) && this._hasLimitedUses(item) && hasCastActivity);

                if (type === 'spell') {
                    const level = item.system.level ?? 0;
                    activityAction.itemTypes = ['spell', `level_${level}`];
                } else if (isItemCharges) {
                    activityAction.itemTypes = ['spell', 'itemCharges'];
                } else if (type === 'weapon') {
                    const subType = item.system.type?.value;
                    activityAction.itemTypes = subType ? ['weapon', subType] : ['weapon'];
                } else if (type === 'equipment') {
                    const subType = item.system.type?.value;
                    activityAction.itemTypes = subType ? ['equipment', subType] : ['equipment'];
                } else {
                    activityAction.itemTypes = [type];
                }

                // Roll up uses to the main action
                if (filteredActivities.length === 1) {
                    activityAction.uses = filteredActivities[0].uses;
                } else {
                    // For multiple activities, use item-level uses (e.g. wand charges)
                    // Spells fall back to spell slots
                    if (type === 'spell') {
                        activityAction.uses = this._calculateSpellSlots(item, actor, highestAvailableSlot);
                    } else {
                        activityAction.uses = this._calculateUses(item);
                    }
                }

                modified.push(activityAction);
            } else if (['equipment', 'weapon', 'backpack', 'loot'].includes(type)) {
                // Passive items (armor, passive shields, containers, loot) are assigned right-side tab 'none' under 'economy'
                const subType = item.system.type?.value;
                const econRoot = new TabRef({ label: 'economy' });
                const passiveAction = {
                    ...action,
                    unprepared: isSpellUnprepared || isUnequipped,
                    tabs: [new TabRef({ label: 'none', parent: econRoot })],
                    itemTypes: subType ? [type, subType] : [type],
                    uses: { available: null, max: null }
                };
                modified.push(passiveAction);
            }
        }

        return modified;
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
        return type ?? 'none';
    }

    modifyContext(context, app) {
        super.modifyContext(context, app);
        
        const spellParent = context.itemTypes.find(t => t.id === 'spell');
        if (spellParent && spellParent.subTabs.length > 0) {
            const showUnprepared = app.actor.getFlag(MODULE_ID, 'showUnprepared') ?? false;
            spellParent.addSubTab({
                id: 'all',
                label: localize('BAD.dnd5e.allSpells', 'All Spells'),
                active: app.leftTabs.activeParents.has('spell') && app.leftTabs.activeSubTypes.size === 0,
                showUnprepared: showUnprepared
            });
            spellParent.updateOrder(Object.keys(SORT_ORDERS.tabs['spell']));
        }

        const weaponParent = context.itemTypes.find(t => t.id === 'weapon');
        if (weaponParent) {
            const showUnequipped = app.actor.getFlag(MODULE_ID, 'showUnequipped_weapon') ?? false;
            weaponParent.addSubTab({
                id: 'all',
                label: localize('BAD.dnd5e.allWeapons', 'All Weapons'),
                active: app.leftTabs.activeParents.has('weapon') && app.leftTabs.activeSubTypes.size === 0,
                showUnprepared: showUnequipped
            });
            weaponParent.updateOrder(Object.keys(SORT_ORDERS.tabs['weapon']));
        }

        const equipmentParent = context.itemTypes.find(t => t.id === 'equipment');
        if (equipmentParent) {
            const showUnequipped = app.actor.getFlag(MODULE_ID, 'showUnequipped_equipment') ?? false;
            equipmentParent.addSubTab({
                id: 'all',
                label: localize('BAD.dnd5e.allEquipment', 'All Equipment'),
                active: app.leftTabs.activeParents.has('equipment') && app.leftTabs.activeSubTypes.size === 0,
                showUnprepared: showUnequipped
            });
            equipmentParent.updateOrder(Object.keys(SORT_ORDERS.tabs['equipment']));
        }
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
                    const action = app.actions.find(a => a.id === el.dataset.actionId);
                    if (!action) return false;
                    const item = action.originalItem;
                    if (item?.type !== 'spell') return false;
                    
                    const prepMode = item.system.method;
                    const isPrepared = !!item.system.prepared;
                    return !['innate', 'atwill', 'pact'].includes(prepMode) && !isPrepared;
                },
                callback: async el => {
                    const action = app.actions.find(a => a.id === el.dataset.actionId);
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
                    const action = app.actions.find(a => a.id === el.dataset.actionId);
                    if (!action) return false;
                    const item = action.originalItem;
                    if (item?.type !== 'spell') return false;
                    
                    const prepMode = item.system.method;
                    return !['innate', 'atwill', 'pact'].includes(prepMode) && item.system.prepared === 1;
                },
                callback: async el => {
                    const action = app.actions.find(a => a.id === el.dataset.actionId);
                    const item = action?.originalItem;
                    if (item) {
                        log.debug(`Unpreparing spell: ${item.name}`);
                        await item.update({ "system.prepared": 0 });
                    }
                }
            },
            {
                name: "BAD.dnd5e.equipItem",
                icon: '<i class="fas fa-shield-halved"></i>',
                condition: el => {
                    if (!app.actor?.isOwner) return false;
                    const action = app.actions.find(a => a.id === el.dataset.actionId);
                    if (!action) return false;
                    const item = action.originalItem;
                    if (!item || !['weapon', 'equipment'].includes(item.type)) return false;
                    return !this.getItemEquipped(item);
                },
                callback: async el => {
                    const action = app.actions.find(a => a.id === el.dataset.actionId);
                    const item = action?.originalItem;
                    if (item) {
                        log.debug(`Equipping item: ${item.name}`);
                        await item.update({ "system.equipped": true });
                    }
                }
            },
            {
                name: "BAD.dnd5e.unequipItem",
                icon: '<i class="fas fa-shield-slash"></i>',
                condition: el => {
                    if (!app.actor?.isOwner) return false;
                    const action = app.actions.find(a => a.id === el.dataset.actionId);
                    if (!action) return false;
                    const item = action.originalItem;
                    if (!item || !['weapon', 'equipment'].includes(item.type)) return false;
                    return this.getItemEquipped(item);
                },
                callback: async el => {
                    const action = app.actions.find(a => a.id === el.dataset.actionId);
                    const item = action?.originalItem;
                    if (item) {
                        log.debug(`Unequipping item: ${item.name}`);
                        await item.update({ "system.equipped": false });
                    }
                }
            }
        ];
    }

    /**
     * Handle right-click on "All" sub-tabs (Spells, Weapons, Equipment) to toggle unprepared/unequipped items.
     * @param {ApplicationV2} app The ActionDisplayApp instance
     * @param {HTMLElement} el The tab element that was right-clicked
     * @param {Event} event The event
     * @returns {boolean} True if handled
     */
    onTabRightClick(app, el, event) {
        if (el.dataset.type === 'all') {
            const parentGroup = el.closest('.bad-left-tab-group');
            const parentTab = parentGroup?.querySelector('.bad-left-tab');
            const parentType = parentTab?.dataset.type;

            if (parentType === 'spell' && app.actor?.isOwner) {
                const showUnprepared = app.actor.getFlag(MODULE_ID, 'showUnprepared') ?? false;
                app.actor.setFlag(MODULE_ID, 'showUnprepared', !showUnprepared);
                return true;
            }

            if (['weapon', 'equipment'].includes(parentType) && app.actor?.isOwner) {
                const flagKey = `showUnequipped_${parentType}`;
                const showUnequipped = app.actor.getFlag(MODULE_ID, flagKey) ?? false;
                app.actor.setFlag(MODULE_ID, flagKey, !showUnequipped);
                return true;
            }
        }
        return false;
    }

    getItemTypeSortOrder(parentId) {
        return SORT_ORDERS.item_type[parentId] ?? super.getItemTypeSortOrder(parentId);
    }

    getActionSubTabSortOrder(parentId, subId) {
        return SORT_ORDERS.tabs[parentId]?.[subId] ?? super.getActionSubTabSortOrder(parentId, subId);
    }



    getItemTypeLabel(parentId) {
        const labels = {
            'all': localize('BAD.hud.allItems', 'All Items'),
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
            if (subId === 'all') {
                return localize('BAD.dnd5e.allSpells', 'All Spells');
            }
            if (subId === 'itemCharges') {
                return localize('BAD.dnd5e.itemCharges', 'Item Charges');
            }
            if (subId.startsWith('level_')) {
                const num = subId.replace('level_', '');
                if (num === '0') return localize('DND5E.SpellCantrip', 'Cantrip');
                const key = `DND5E.SpellLevel${num}`;
                const ordinals = { '1': '1st', '2': '2nd', '3': '3rd' };
                const ord = ordinals[num] || `${num}th`;
                return localize(key, `${ord} Level`);
            }
        }
        if (parentId === 'weapon') {
            if (subId === 'all') return localize('BAD.dnd5e.allWeapons', 'All Weapons');
            const key = `DND5E.Weapon${subId.charAt(0).toUpperCase() + subId.slice(1)}`;
            return localize(key, CONFIG?.DND5E?.weaponTypes?.[subId] ?? subId);
        }
        if (parentId === 'equipment') {
            if (subId === 'all') return localize('BAD.dnd5e.allEquipment', 'All Equipment');
            const key = `DND5E.Equipment${subId.charAt(0).toUpperCase() + subId.slice(1)}`;
            return localize(key, CONFIG?.DND5E?.equipmentTypes?.[subId] ?? subId);
        }
        return super.getItemSubTabLabel(parentId, subId);
    }

    /**
     * Get the localized label for a right-side action type (parent tab) for DnD5e.
     */
    getActionTypeLabel(parentId) {
        const labels = {
            'economy': localize('BAD.common.actionEconomy', 'Action Economy'),
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

    /* ------------------------------------------------------------------------- */
    /*  System Data Structure Accessors / Schema Extraction Helpers              */
    /* ------------------------------------------------------------------------- */

    /**
     * Check if a D&D 5e item is equipped.
     * @param {Item} item
     * @returns {boolean}
     */
    getItemEquipped(item) {
        return item.system.equipped !== false;
    }

    /**
     * Get activities collection from a D&D 5e item.
     * @param {Item} item
     * @returns {Map|undefined}
     */
    getItemActivities(item) {
        return item.system.activities;
    }

    /**
     * Calculate available and maximum uses for an item.
     */
    _calculateUses(item) {
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
     * @returns {boolean} True if the item has limited uses
     * @private
     */
    _hasLimitedUses(item) {
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
     * Parse and calculate limited uses configuration.
     * @private
     */
    _calculateLimitedUses(uses) {
        if (uses && uses.max && uses.max !== "0") {
            let max = uses.max;
            if (typeof max === 'string') {
                max = parseInt(max, 10) || 0;
            }
            if (max > 0) {
                const spent = uses.spent ?? 0;
                const available = uses.value ?? (max - spent);
                return { available, max };
            }
        }
        return null;
    }

    /**
     * Resolve target item reference using direct ID or relative UUID.
     * @private
     */
    _resolveTargetItem(targetId, item, actor) {
        if (!targetId) return null;
        try {
            // 1. Try standard synchronous resolution via Foundry fromUuidSync
            let resolved = targetId.includes('.')
                ? (foundry.utils.fromUuidSync(targetId, { relative: item })
                   || foundry.utils.fromUuidSync(targetId, { relative: actor })
                   || actor?.items?.get(targetId))
                : actor?.items?.get(targetId);

            // 2. Dynamic Fallback: If targetId is a UUID and fromUuidSync returned null, search all game packs index by document ID
            if (!resolved && targetId.includes('.')) {
                const parts = targetId.split('.');
                const docId = parts[parts.length - 1];

                for (const pack of game.packs.values()) {
                    if (pack.index?.has(docId)) {
                        resolved = pack.index.get(docId);
                        break;
                    }
                }
            }

            if (!resolved) {
                log.warn(`Could not resolve target item "${targetId}" for item "${item?.name ?? item?.id}" on actor "${actor?.name}". Treating as missing item.`);
            }
            return resolved ?? null;
        } catch (error) {
            log.warn(`Error resolving target item "${targetId}" for item "${item?.name ?? item?.id}" on actor "${actor?.name}":`, error);
            return null;
        }
    }

    /**
     * Calculate available and maximum uses for a D&D 5e Activity.
     * @param {Activity} activity The activity instance
     * @param {Item} item The parent item
     * @param {Actor} actor The actor
     * @param {Map<string, number>} ammoQuantities Pre-calculated ammunition quantities
     * @param {number} highestAvailableSlot The highest available spell slot level on the actor
     * @returns {{available: number|null, max: number|null}} The uses count
     * @private
     */
    _calculateActivityUses(activity, item, actor, ammoQuantities, highestAvailableSlot) {
        const targets = activity.consumption?.targets ?? [];
        
        // 1. If the activity has its own explicit limited uses
        const selfUses = this._calculateLimitedUses(activity.uses);
        if (selfUses) return selfUses;
        
        // 2. Resolve based on consumption targets
        for (const target of targets) {
            if (target.type === 'activityUses') {
                // Consumes another activity's uses (or self if target is empty)
                const targetActivity = target.target ? item.system.activities.get(target.target) : activity;
                if (targetActivity) {
                    const actUses = this._calculateLimitedUses(targetActivity.uses);
                    if (actUses) return actUses;
                }
            } else if (target.type === 'itemUses') {
                // Consumes the parent item's uses
                return this._calculateUses(item);
            } else if (target.type === 'spellSlots') {
                // Consumes actor spell slots
                const level = target.target ?? item.system.level; // Fallback to spell's base level if target is empty (dynamic slots)
                return this._getSpellSlotUses(actor, level, highestAvailableSlot);
            } else if (target.type === 'item') {
                // Consumes quantity of another item (e.g. ammunition) or charges of another item
                const targetItem = this._resolveTargetItem(target.target, item, actor);

                if (targetItem) {
                    const consumed = target.value || 1;
                    // If the target item has its own limited uses (like a wand), use those
                    const uses = this._calculateUses(targetItem);
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
                const targetItem = this._resolveTargetItem(target.target, item, actor);

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
            return this._calculateSpellSlots(item, actor, highestAvailableSlot);
        }

        // Fallback for weapons requiring ammunition if no explicit consumption target was resolved
        if (item.type === 'weapon' && item.system.ammunition?.type) {
            return this._calculateWeaponAmmunition(item, ammoQuantities);
        }

        return { available: null, max: null };
    }

    /**
     * Calculate spell slot uses (pact or standard) for a given slot level, including upcast logic.
     * @private
     */
    _getSpellSlotUses(actor, level, highestAvailableSlot) {
        const actorSpells = actor.system.spells;
        
        if (level === 'pact') {
            const pact = actorSpells?.pact;
            const available = pact?.value ?? 0;
            const max = pact?.max ?? 0;
            
            if (available > 0) {
                return { available, max };
            }
            
            if (this._hasAvailableUpcastSlots(pact?.level ?? 0, highestAvailableSlot)) {
                return {
                    available: localize('BAD.dnd5e.upcast', 'Upcast'),
                    max: null,
                    isUpcast: true
                };
            }
            return { available: 0, max };
        } else {
            const lvl = Number(level) || 0;
            if (lvl <= 0) return { available: null, max: null };
            
            const spellSlot = actorSpells?.[`spell${lvl}`];
            const available = spellSlot?.value ?? 0;
            const max = spellSlot?.max ?? 0;
            
            if (available > 0) {
                return { available, max };
            }
            
            if (this._hasAvailableUpcastSlots(lvl, highestAvailableSlot)) {
                return {
                    available: localize('BAD.dnd5e.upcast', 'Upcast'),
                    max: null,
                    isUpcast: true
                };
            }
            return { available: 0, max };
        }
    }

    /**
     * Check if the actor has any available spell slots (standard or pact) of a given level or higher.
     * Optimized to O(1) by comparing against the pre-calculated highest available slot.
     * @private
     */
    _hasAvailableUpcastSlots(level, highestAvailableSlot) {
        return highestAvailableSlot >= level;
    }

    /**
     * Fallback method to calculate spell slots for standard slot-based spells.
     * Used when the Cast activity doesn't have an explicit spellSlots consumption target.
     * @param {Item} item The spell item
     * @param {Actor} actor The actor
     * @param {number} highestAvailableSlot The highest available spell slot level on the actor
     * @private
     */
    _calculateSpellSlots(item, actor, highestAvailableSlot) {
        const system = item.system;
        const prepMode = system.method;
        const level = system.level ?? 0;
        
        if (prepMode === 'pact') {
            return this._getSpellSlotUses(actor, 'pact', highestAvailableSlot);
        } else if (!['innate', 'atwill'].includes(prepMode)) {
            return this._getSpellSlotUses(actor, level, highestAvailableSlot);
        }
        return { available: null, max: null };
    }

    /**
     * Fallback method to calculate ammunition quantity for ranged weapons.
     * Used when the Attack activity doesn't have a working item consumption target.
     * @private
     */
    _calculateWeaponAmmunition(item, ammoQuantities) {
        const ammoType = item.system.ammunition?.type;
        const quantity = ammoQuantities.get(ammoType) ?? 0;
        return {
            available: quantity,
            max: null
        };
    }
}
