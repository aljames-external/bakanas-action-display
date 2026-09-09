import { BaseSystemContextModifier } from './base-system-context-modifier.js';
import { localize, deepFreeze } from '../../../lib/utils.js';
import { MODULE_ID } from '../../../constants.js';

const SORT_ORDERS = deepFreeze({
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
            'all': 0,
            'standard': 1,
            'time': 2,
            'rest': 3,
            'combat': 4,
            'monster': 5,
            'vehicle': 6,
            'special': 7,
            'other': 8,
            'none': 9
        },
        'standard': { 'all': 0, 'action': 1, 'bonus': 2, 'reaction': 3 },
        'time': { 'all': 0, 'minute': 1, 'hour': 2, 'day': 3 },
        'rest': { 'all': 0, 'longRest': 1, 'shortRest': 2, 'long': 1, 'short': 2 },
        'combat': { 'all': 0, 'encounter': 1, 'turnStart': 2, 'turnEnd': 3 },
        'monster': { 'all': 0, 'legendary': 1, 'mythic': 2, 'lair': 3 },
        'vehicle': { 'all': 0, 'crew': 1 },
        'components': { 'vocal': 0, 'somatic': 1, 'material': 2 },
        'ability': { 'all': 0, 'str': 1, 'dex': 2, 'con': 3, 'int': 4, 'wis': 5, 'cha': 6 }
    },
    item_type: {
        'savingThrow': 1,
        'abilityCheck': 2,
        'weapon': 3,
        'equipment': 4,
        'spell': 5,
        'consumable': 6,
        'tool': 7,
        'tools': 7,
        'backpack': 8,
        'loot': 9,
        'feat': 10
    }
});

const ICONS = deepFreeze({
    item_type: {
        'equipment': 'fas fa-shield',
        'tool': 'fas fa-hammer',
        'tools': 'fas fa-hammer',
        'backpack': 'fas fa-sack',
        'loot': 'fas fa-gem'
    },
    action_type: {
        'economy': 'fas fa-stopwatch',
        'components': 'fas fa-magic'
    }
});

const LABEL_KEYS = deepFreeze({
    item_type: {
        'all': { key: 'BAD.core.allItems', fallback: 'All Items' },
        'weapon': { key: 'DND5E.ItemTypeWeapon', fallback: 'Weapon' },
        'equipment': { key: 'DND5E.ItemTypeEquipment', fallback: 'Equipment' },
        'consumable': { key: 'DND5E.ItemTypeConsumable', fallback: 'Consumable' },
        'tool': { key: 'DND5E.ItemTypeToolPlural', fallback: 'Tools' },
        'tools': { key: 'DND5E.ItemTypeToolPlural', fallback: 'Tools' },
        'backpack': { key: 'DND5E.ItemTypeContainer', fallback: 'Container' },
        'loot': { key: 'DND5E.ItemTypeLoot', fallback: 'Loot' },
        'feat': { key: 'DND5E.ItemTypeFeat', fallback: 'Feature' },
        'spell': { key: 'DND5E.ItemTypeSpell', fallback: 'Spell' },
        'other': { key: 'DND5E.ActionOther', fallback: 'Other' },
        'hidden': { key: 'BAD.core.hidden', fallback: 'Hidden' }
    },
    action_type: {
        'economy': { key: 'BAD.common.actionEconomy', fallback: 'Action Economy' },
        'components': { key: 'BAD.common.spellComponents', fallback: 'Spell Components' }
    },
    action_subtab: {
        'all': { key: 'BAD.core.allActions', fallback: 'All Actions' },
        'standard': { key: 'DND5E.ACTIVATION.Category.Standard', fallback: 'Standard', altKey: 'DND5E.Standard' },
        'time': { key: 'DND5E.ACTIVATION.Category.Time', fallback: 'Time', altKey: 'DND5E.Time' },
        'rest': { key: 'DND5E.ACTIVATION.Category.Rest', fallback: 'Rest', altKey: 'DND5E.Rest' },
        'combat': { key: 'DND5E.ACTIVATION.Category.Combat', fallback: 'Combat', altKey: 'DND5E.Combat' },
        'monster': { key: 'DND5E.ACTIVATION.Category.Monster', fallback: 'Monster', altKey: 'DND5E.Monster' },
        'vehicle': { key: 'DND5E.ACTIVATION.Category.Vehicle', fallback: 'Vehicle', altKey: 'DND5E.Vehicle' },
        'action': { key: 'DND5E.Action', fallback: 'Action', altKey: 'DND5E.ActionAction' },
        'bonus': { key: 'DND5E.BonusAction', fallback: 'Bonus Action', altKey: 'DND5E.ActionBonus' },
        'reaction': { key: 'DND5E.Reaction', fallback: 'Reaction', altKey: 'DND5E.ActionReaction' },
        'minute': { key: 'DND5E.TimeMinute', fallback: 'Minute' },
        'hour': { key: 'DND5E.TimeHour', fallback: 'Hour' },
        'day': { key: 'DND5E.TimeDay', fallback: 'Day' },
        'shortRest': { key: 'DND5E.ActivityActivationShortRest', fallback: 'End of a Short Rest', altKey: 'DND5E.ShortRest' },
        'longRest': { key: 'DND5E.ActivityActivationLongRest', fallback: 'End of a Long Rest', altKey: 'DND5E.LongRest' },
        'short': { key: 'DND5E.ActivityActivationShortRest', fallback: 'End of a Short Rest', altKey: 'DND5E.ShortRest' },
        'long': { key: 'DND5E.ActivityActivationLongRest', fallback: 'End of a Long Rest', altKey: 'DND5E.LongRest' },
        'encounter': { key: 'DND5E.ActivityActivationStartEncounter', fallback: 'Start of Encounter' },
        'turnStart': { key: 'DND5E.ActivityActivationTurnStart', fallback: 'Start of Turn' },
        'turnEnd': { key: 'DND5E.ActivityActivationTurnEnd', fallback: 'End of Turn' },
        'legendary': { key: 'DND5E.LegendaryAction', fallback: 'Legendary Action' },
        'mythic': { key: 'DND5E.MythicAction', fallback: 'Mythic Action' },
        'lair': { key: 'DND5E.LairAction', fallback: 'Lair Action' },
        'crew': { key: 'DND5E.CrewAction', fallback: 'Crew Action' },
        'special': { key: 'DND5E.ACTIVATION.Category.Special', fallback: 'Special', altKey: 'DND5E.Special' },
        'other': { key: 'DND5E.ActionOther', fallback: 'Other' },
        'none': { key: 'DND5E.None', fallback: 'None' },
        'vocal': { key: 'DND5E.ComponentVerbal', fallback: 'Verbal' },
        'somatic': { key: 'DND5E.ComponentSomatic', fallback: 'Somatic' },
        'material': { key: 'DND5E.ComponentMaterial', fallback: 'Material' }
    }
});

const LEVEL_ORDINALS = deepFreeze({ '1': '1st', '2': '2nd', '3': '3rd' });

const GEAR_TYPES = deepFreeze(['weapon', 'equipment', 'consumable', 'tool', 'backpack', 'loot']);
const GENERIC_GEAR_TYPES = deepFreeze(['consumable', 'tool', 'backpack', 'loot']);

export class Dnd5eSystemContextModifier extends BaseSystemContextModifier {
    constructor(adapter) {
        super(adapter);
    }

    modifyContext(context, app) {
        const findParent = id => context.itemTypes?.find(t => t.id === id);

        const showAll = app?.actor?.getFlag?.(MODULE_ID, 'showAll') ?? false;

        const allParent = findParent('all');
        if (allParent) {
            allParent.showUnprepared = showAll;
        }

        const spellParent = findParent('spell');
        if (spellParent) {
            spellParent.showUnprepared = Boolean(app?.actor?.getFlag?.(MODULE_ID, 'showUnprepared') || showAll);
        }

        for (const type of GEAR_TYPES) {
            const parent = findParent(type);
            if (parent) {
                parent.showUnprepared = Boolean(app?.actor?.getFlag?.(MODULE_ID, `showUnequipped_${type}`) || showAll);
            }
        }

        const weaponParent = findParent('weapon');
        const equipmentParent = findParent('equipment');

        const showTooltips = Boolean(context.showTooltips);
        if (showTooltips) {
            if (allParent) {
                allParent.tooltip = localize('BAD.tabs.allTooltip', '<b>Right Click:</b> Toggle Show All (Equipped & Unequipped Items, Prepared & Unprepared Spells)');
            }
            if (spellParent) {
                spellParent.tooltip = localize('BAD.tabs.unpreparedSpellsTooltip', '<b>Right Click:</b> Toggle Show Unprepared Spells');
            }
            if (weaponParent) {
                weaponParent.tooltip = localize('BAD.tabs.unequippedWeaponsTooltip', '<b>Right Click:</b> Toggle Show Unequipped Weapons');
            }
            if (equipmentParent) {
                equipmentParent.tooltip = localize('BAD.tabs.unequippedEquipmentTooltip', '<b>Right Click:</b> Toggle Show Unequipped Equipment');
            }
            for (const gearType of GENERIC_GEAR_TYPES) {
                const p = findParent(gearType);
                if (p) {
                    p.tooltip = localize('BAD.tabs.unequippedItemsTooltip', '<b>Right Click:</b> Toggle Show Unequipped Items');
                }
            }
        }

        this.#ensureAllSubTab(
            spellParent,
            app,
            localize('BAD.common.allSpells', 'All Spells'),
            'showUnprepared',
            true,
            showAll,
            showTooltips ? localize('BAD.tabs.unpreparedSpellsTooltip', '<b>Right Click:</b> Toggle Show Unprepared Spells') : ''
        );
        this.#ensureAllSubTab(
            weaponParent,
            app,
            localize('BAD.common.allWeapons', 'All Weapons'),
            'showUnequipped_weapon',
            false,
            showAll,
            showTooltips ? localize('BAD.tabs.unequippedWeaponsTooltip', '<b>Right Click:</b> Toggle Show Unequipped Weapons') : ''
        );
        this.#ensureAllSubTab(
            equipmentParent,
            app,
            localize('BAD.common.allEquipment', 'All Equipment'),
            'showUnequipped_equipment',
            false,
            showAll,
            showTooltips ? localize('BAD.tabs.unequippedEquipmentTooltip', '<b>Right Click:</b> Toggle Show Unequipped Equipment') : ''
        );
    }

    /**
     * Helper to inject an "All" sub-tab into a parent tab group.
     * @param {HUDTab} parent Parent tab group
     * @param {ApplicationV2} app Active HUD application
     * @param {string} label Localized tab label
     * @param {string} flagKey Actor flag key for unprepared/unequipped display toggle
     * @param {boolean} [requireSubTabs=false] Only inject if parent has existing subtabs
     * @param {boolean} [forceShow=false] Force orange indicator if showAll is true
     * @param {string} [tooltip=''] Contextual tooltip when showTooltips is enabled
     */
    #ensureAllSubTab(parent, app, label, flagKey, requireSubTabs = false, forceShow = false, tooltip = '') {
        if (!parent || !parent.addSubTab || (requireSubTabs && parent.subTabs?.length === 0)) return;
        const flagValue = app?.actor?.getFlag?.(MODULE_ID, flagKey) ?? false;
        const showUnprepared = Boolean(forceShow || flagValue);
        parent.addSubTab({
            id: 'all',
            label,
            active: Boolean(app?.leftTabs?.activeParents?.has(parent.id) && app?.leftTabs?.activeSubTypes?.size === 0),
            showUnprepared,
            tooltip
        });
        parent.updateOrder?.(Object.keys(SORT_ORDERS.tabs[parent.id]));
    }

    /**
     * Get the sort priority order for a left-side parent item tab in D&D 5e.
     * @param {string} parentId
     * @returns {number}
     */
    getItemTypeSortOrder(parentId) {
        return SORT_ORDERS.item_type[parentId] ?? super.getItemTypeSortOrder(parentId);
    }

    /**
     * Get the sort priority order for a right-side action sub-tab in D&D 5e.
     * @param {string} parentId
     * @param {string} subId
     * @returns {number}
     */
    getActionSubTabSortOrder(parentId, subId) {
        return SORT_ORDERS.tabs[parentId]?.[subId] ?? super.getActionSubTabSortOrder(parentId, subId);
    }

    /**
     * Get the localized display label for a left-side parent item tab in D&D 5e.
     * @param {string} parentId
     * @returns {string}
     */
    getItemTypeLabel(parentId) {
        const config = LABEL_KEYS.item_type[parentId];
        return config ? localize(config.key, config.fallback) : super.getItemTypeLabel(parentId);
    }

    /**
     * Get the CSS icon class for a left-side parent item tab in D&D 5e.
     * @param {string} parentId
     * @returns {string}
     */
    getItemTypeIcon(parentId) {
        return ICONS.item_type[parentId] ?? super.getItemTypeIcon(parentId);
    }

    /**
     * Get the localized display label for a left-side item sub-tab in D&D 5e.
     * @param {string} parentId
     * @param {string} subId
     * @returns {string}
     */
    getItemSubTabLabel(parentId, subId) {
        if (parentId === 'spell') {
            if (subId === 'all') {
                return localize('BAD.common.allSpells', 'All Spells');
            }
            if (subId === 'itemCharges') {
                return localize('BAD.common.itemCharges', 'Item Charges');
            }
            if (subId.startsWith('level_')) {
                const num = subId.replace('level_', '');
                if (num === '0') return localize('DND5E.SpellCantrip', 'Cantrip');
                const key = `DND5E.SpellLevel${num}`;
                const ord = LEVEL_ORDINALS[num] ?? `${num}th`;
                return localize(key, `${ord} Level`);
            }
        }
        if (parentId === 'weapon' || parentId === 'equipment') {
            if (subId === 'all') {
                const labelKey = parentId === 'weapon' ? 'allWeapons' : 'allEquipment';
                const fallback = parentId === 'weapon' ? 'All Weapons' : 'All Equipment';
                return localize(`BAD.common.${labelKey}`, fallback);
            }
            const prefix = parentId.charAt(0).toUpperCase() + parentId.slice(1);
            const subTitle = subId.charAt(0).toUpperCase() + subId.slice(1);
            const configMap = parentId === 'weapon' ? CONFIG?.DND5E?.weaponTypes : CONFIG?.DND5E?.equipmentTypes;
            return localize(`DND5E.${prefix}${subTitle}`, configMap?.[subId] ?? subId);
        }
        return super.getItemSubTabLabel(parentId, subId);
    }

    /**
     * Get the localized display label for a right-side action parent tab in D&D 5e.
     * @param {string} parentId
     * @returns {string}
     */
    getActionTypeLabel(parentId) {
        const config = LABEL_KEYS.action_type[parentId];
        return config ? localize(config.key, config.fallback) : super.getActionTypeLabel(parentId);
    }

    /**
     * Get the CSS icon class for a right-side action parent tab in D&D 5e.
     * @param {string} parentId
     * @returns {string}
     */
    getActionTypeIcon(parentId) {
        return ICONS.action_type[parentId] ?? super.getActionTypeIcon(parentId);
    }

    /**
     * Get the localized display label for a right-side action sub-tab in D&D 5e.
     * @param {string} subId
     * @returns {string}
     */
    getActionSubTabLabel(subId) {
        const config = LABEL_KEYS.action_subtab[subId];
        const fallback = config?.fallback ?? subId;

        const cfg = CONFIG?.DND5E;
        const configLabel = cfg?.activityActivationCategories?.[subId]
            ?? cfg?.activityActivationTypes?.[subId];
        if (configLabel) {
            const label = configLabel.label ?? configLabel.name ?? configLabel;
            const localized = localize(label, null);
            if (localized) return localized;
        }

        if (config) {
            const primaryKey = config.key;
            const localized = localize(primaryKey, null);
            if (localized) return localized;
            if (config.altKey) {
                const altLocalized = localize(config.altKey, null);
                if (altLocalized) return altLocalized;
            }
            return localize(primaryKey, fallback);
        }

        return super.getActionSubTabLabel(subId);
    }
}


