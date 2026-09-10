import { FantasySystemAdapter } from './genre/fantasy-system-adapter.js';
import { localize, toSet, deepFreeze } from '../../lib/utils.js';
import { log } from '../../lib/logger.js';
import { TabRef } from '../../ui/tab-ref.js';
import { Action } from '../../ui/action.js';
import { MODULE_ID } from '../../constants.js';
import { Pf2eSystemContextMenuManager } from './context-menu/pf2e-system-context-menu-manager.js';
import { CombatMovementTracker } from '../../combat/combat-movement-tracker.js';

const SORT_ORDERS = deepFreeze({
    tabs: {
        'economy': {
            'all': 0, 'action': 1, 'reaction': 2, 'free': 3, 'other': 4
        },
        'ability': {
            'all': 0, 'str': 1, 'dex': 2, 'con': 3, 'int': 4, 'wis': 5, 'cha': 6
        }
    },
    item_type: {
        'all': 0,
        'savingThrow': 1,
        'abilityCheck': 2,
        'weapon': 3,
        'equipment': 4,
        'consumable': 5,
        'feat': 6,
        'spell': 7,
        'other': 8
    }
});

const EXTRACTABLE_TYPES = new Set(['action', 'feat', 'spell', 'consumable', 'equipment']);

const PF2E_SPELL_SUB_TAB_ORDER = new Map(
    ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'focus', 'innate', 'ritual'].map((id, i) => [id, i])
);

const ICONS = deepFreeze({
    action_type: {
        'all': 'fas fa-border-all',
        'economy': 'fas fa-stopwatch',
        'ability': 'fas fa-fist-raised'
    },
    default_strike: 'systems/pf2e/icons/default-icons/melee.svg'
});

const PF2E_ACTION_TYPE_MAP = deepFreeze({
    'reaction': 'reaction',
    'free': 'other',
    'action': 'action'
});

const PF2E_SKILL_ABILITY_MAP = deepFreeze({
    acrobatics: 'dex',
    arcana: 'int',
    athletics: 'str',
    crafting: 'int',
    deception: 'cha',
    diplomacy: 'cha',
    intimidation: 'cha',
    medicine: 'wis',
    nature: 'wis',
    occultism: 'int',
    performance: 'cha',
    religion: 'wis',
    society: 'int',
    stealth: 'dex',
    survival: 'wis',
    thievery: 'dex'
});

const PF2E_ABILITY_ICONS = deepFreeze({
    str: 'icons/svg/sword.svg',
    dex: 'icons/svg/wing.svg',
    con: 'icons/svg/shield.svg',
    int: 'icons/svg/book.svg',
    wis: 'icons/svg/eye.svg',
    cha: 'icons/svg/paralysis.svg'
});

const PF2E_UNEQUIPPED_TAB_CONFIG = deepFreeze({
    weapon: { flag: 'showUnequipped_weapon', tooltip: 'BAD.tabs.unequippedWeaponsTooltip', defaultTooltip: '<b>Right Click:</b> Toggle Show Unequipped Weapons' },
    consumable: { flag: 'showUnequipped_consumable', tooltip: 'BAD.tabs.unequippedItemsTooltip', defaultTooltip: '<b>Right Click:</b> Toggle Show Unequipped Items' },
    equipment: { flag: 'showUnequipped_equipment', tooltip: 'BAD.tabs.unequippedEquipmentTooltip', defaultTooltip: '<b>Right Click:</b> Toggle Show Unequipped Equipment' }
});

const PF2E_SIZE_MAP = deepFreeze({
    tiny: 'Tiny', sm: 'Small', med: 'Medium', lg: 'Large', huge: 'Huge', grg: 'Gargantuan'
});

/**
 * Base system adapter for Pathfinder 2nd Edition (PF2e) (baseline).
 * Modifies the base actions list by mapping feats and spells, and injecting Strikes (attacks).
 */
export class BasePf2eSystemAdapter extends FantasySystemAdapter {
    constructor(foundry: any) {
        super('pf2e', true, foundry);
        this.contextMenuManager = new Pf2eSystemContextMenuManager(this);
    }

    /**
     * Check if a PF2e item is equipped.
     * Natural attacks, unarmed strikes, and non-physical items are always considered equipped.
     * Items marked as 'stowed' or 'dropped' are unequipped.
     * Items marked as 'held' or 'worn' are equipped.
     * @param {Item} item
     * @returns {boolean}
     */
    getItemEquipped(item: any) {
        if (!item?.system) return true;
        if (item.isPhysical === false) return true;
        if (item.category === 'unarmed' || item.system.category?.value === 'unarmed') return true;

        const traits = item.system.traits?.value;
        const hasTrait = (trait: any) => Boolean(traits instanceof Set ? traits.has(trait) : traits?.includes?.(trait));
        if (hasTrait('unarmed') || hasTrait('natural')) {
            return true;
        }

        const carryType = item.system.equipped?.carryType;
        if (carryType) {
            return carryType === 'held' || carryType === 'worn';
        }
        if (item.isEquipped !== undefined) {
            return Boolean(item.isEquipped);
        }
        return true;
    }

    // #region Core Action Modification

    /**
     * Determine if a specific item should be extracted as a base action for PF2e.
     * Prevents allocating objects for unhandled item types (like equipment/consumables).
     */
    shouldExtractItem(item: any) {
        return EXTRACTABLE_TYPES.has(item.type);
    }

    /**
     * Filter, map, inject, and sort actions for PF2e.
     * @param {Object[]} actions Base action list from the core
     * @param {Actor} actor 
     * @returns {Object[]} The modified actions list
     */
    async modifyActions(actions: any[], actor: any) {
        const modified: any[] = [];

        const ammoQuantities = this.#buildAmmoQuantitiesMap(actor);
        const spellToEntryMap = this.#buildSpellToEntryMap(actor);

        // 1. Process existing items (Feats, Actions, Spells)
        log.group(`Pf2eSystemAdapter.modifyActions | Formatting actions for "${actor?.name ?? 'Actor'}"`, 'debug');
        try {
            for (const action of actions) {
                if (this.#formatActionRow(action, spellToEntryMap)) {
                    modified.push(action);
                }
            }
        } finally {
            log.groupEnd();
        }

        // 2. Inject Strikes (attacks)
        for (const strike of this.#getActorStrikes(actor)) {
            modified.push(this.#createStrikeAction(strike, ammoQuantities));
        }

        // 3. Filter unequipped items (stowed/dropped) unless showAll / showUnequipped flag is enabled
        const showAll = Boolean(actor?.getFlag?.(MODULE_ID, 'showAll'));
        const showUnequippedMap: Record<string, boolean> = {
            weapon: Boolean(actor?.getFlag?.(MODULE_ID, 'showUnequipped_weapon')),
            equipment: Boolean(actor?.getFlag?.(MODULE_ID, 'showUnequipped_equipment')),
            consumable: Boolean(actor?.getFlag?.(MODULE_ID, 'showUnequipped_consumable'))
        };

        const finalActions: any[] = [];
        for (const action of modified) {
            action.available = true;
            const item = action.originalItem;
            if (item) {
                const isEquipped = this.getItemEquipped(item);
                if (!isEquipped) {
                    const type = item.type ?? action.type;
                    const canShowUnequipped = Boolean(showAll || showUnequippedMap[type] || showUnequippedMap.weapon);
                    if (!canShowUnequipped) {
                        continue;
                    }
                    action.available = false;
                }
            }
            finalActions.push(action);
        }

        for (const action of finalActions) {
            action.page = 1;
        }

        finalActions.push(...this.extractCheckActions(actor));
        finalActions.push(...this.extractInfoActions(actor));

        // 4. Apply default resource filtering (e.g. hiding depleted actions)
        return super.modifyActions(finalActions, actor);
    }

    /**
     * Extract Page 2 ability checks, saving throws, and skill checks for PF2e.
     * In PF2e, saving throws are Fortitude, Reflex, and Will, and perception is a core check.
     * Raw ability checks do not exist in PF2e (skills are rolled instead).
     * @param {Actor} actor
     * @returns {Action[]}
     */
    extractCheckActions(actor: any): any[] {
        if (!actor) return [];
        const checkActions: any[] = [];

        // 1. Core Saves (Fortitude, Reflex, Will) and Perception
        const fortitude = new Action({
            id: 'save-fortitude',
            name: localize('PF2E.SavesFortitude', 'Fortitude'),
            type: 'save',
            img: 'icons/svg/shield.svg',
            page: 2,
            right: [TabRef.from('ability', 'con')],
            left: ['savingThrow'],
            available: true,
            uses: { available: null, max: null },
            roll: async (event) => {
                const rollEvent = this._createRollEvent(event);
                return (actor.saves?.fortitude ?? actor.system?.saves?.fortitude)?.roll?.({ event: rollEvent });
            },
            extra: { ability: 'con' }
        });
        checkActions.push(fortitude);

        const reflex = new Action({
            id: 'save-reflex',
            name: localize('PF2E.SavesReflex', 'Reflex'),
            type: 'save',
            img: 'icons/svg/wing.svg',
            page: 2,
            right: [TabRef.from('ability', 'dex')],
            left: ['savingThrow'],
            available: true,
            uses: { available: null, max: null },
            roll: async (event) => {
                const rollEvent = this._createRollEvent(event);
                return (actor.saves?.reflex ?? actor.system?.saves?.reflex)?.roll?.({ event: rollEvent });
            },
            extra: { ability: 'dex' }
        });
        checkActions.push(reflex);

        const will = new Action({
            id: 'save-will',
            name: localize('PF2E.SavesWill', 'Will'),
            type: 'save',
            img: 'icons/svg/eye.svg',
            page: 2,
            right: [TabRef.from('ability', 'wis')],
            left: ['savingThrow'],
            available: true,
            uses: { available: null, max: null },
            roll: async (event) => {
                const rollEvent = this._createRollEvent(event);
                return (actor.saves?.will ?? actor.system?.saves?.will)?.roll?.({ event: rollEvent });
            },
            extra: { ability: 'wis' }
        });
        checkActions.push(will);

        const perception = new Action({
            id: 'check-perception',
            name: localize('PF2E.PerceptionLabel', 'Perception'),
            type: 'skill',
            img: 'icons/svg/eye.svg',
            page: 2,
            right: [TabRef.from('ability', 'wis')],
            left: ['abilityCheck'],
            available: true,
            uses: { available: null, max: null },
            roll: async (event) => {
                const rollEvent = this._createRollEvent(event);
                return (actor.perception ?? actor.system?.attributes?.perception)?.roll?.({ event: rollEvent });
            },
            extra: { ability: 'wis' }
        });
        checkActions.push(perception);

        // 2. Skills
        const actorSkills = actor.skills ?? actor.system?.skills ?? {};
        const skillEntries = actorSkills instanceof Map ? Array.from(actorSkills.entries()) : Object.entries(actorSkills);

        for (const [key, skill] of skillEntries) {
            const slug = (skill as any).slug ?? key;
            const abl = (PF2E_SKILL_ABILITY_MAP as Record<string, string>)[slug] ?? (skill as any).ability ?? 'dex';
            const label = (skill as any).label ?? (skill as any).name ?? (CONFIG as any)?.PF2E?.skills?.[slug] ?? slug;
            const skillImg = (PF2E_ABILITY_ICONS as Record<string, string>)[abl] ?? 'icons/svg/d20.svg';
            const skillAction = new Action({
                id: `skill-${slug}`,
                name: label,
                type: 'skill',
                img: skillImg,
                page: 2,
                right: [TabRef.from('ability', abl)],
                left: ['abilityCheck'],
                available: true,
                uses: { available: null, max: null },
                roll: async (event) => {
                    const rollEvent = this._createRollEvent(event);
                    if (skill.roll) {
                        return skill.roll({ event: rollEvent });
                    }
                    if (actor.rollSkill) {
                        try {
                            return await actor.rollSkill({ skill: slug, event: rollEvent });
                        } catch {
                            return actor.rollSkill(slug, { event: rollEvent });
                        }
                    }
                },
                extra: { ability: abl }
            });
            checkActions.push(skillAction);
        }

        return checkActions;
    }

    // #endregion

    // #region Localizations & UI Formatting

    /**
     * Get the localized label for a left-side item type (parent tab) in PF2e.
     */
    getItemTypeLabel(parentId: any) {
        switch (parentId) {
            case 'feat': return localize('PF2E.Item.Feat.Plural', 'Feats');
            case 'spell': return localize('PF2E.Item.Spell.Plural', 'Spells');
            case 'weapon': return localize('PF2E.TraitWeapons', 'Weapons');
            case 'consumable': return localize('PF2E.Item.Consumable.Plural', localize('PF2E.Item.Physical.Consumable', 'Consumables'));
            case 'equipment': return localize('PF2E.CompendiumBrowser.TabEquipment', localize('PF2E.NPC.AddEquipment', 'Equipment'));
            default: return super.getItemTypeLabel(parentId);
        }
    }

    /**
     * Get the localized label for a left-side item sub-tab (spell rank) in PF2e.
     */
    getItemSubTabLabel(parentId: any, subId: any) {
        if (parentId === 'spell') {
            switch (subId) {
                case 'focus': return localize('PF2E.Focus.Spells', 'Focus Spells');
                case 'innate': return localize('PF2E.PreparationTypeInnate', 'Innate Spells');
                case 'ritual': return localize('PF2E.Actor.Character.Spellcasting.Tab.Rituals', 'Rituals');
                case '0': return localize('PF2E.TraitCantrip', 'Cantrip');
                default: return localize(`PF2E.Item.Spell.Rank.${subId}`, `${subId} Rank`);
            }
        }
        return super.getItemSubTabLabel(parentId, subId);
    }

    /**
     * Get the localized label for a right-side action type (parent tab) in PF2e.
     */
    getActionTypeLabel(parentId: any) {
        return parentId === 'economy'
            ? localize('BAD.common.actionEconomy', 'Action Economy')
            : super.getActionTypeLabel(parentId);
    }

    getItemTypeSortOrder(parentId: any) {
        return (SORT_ORDERS.item_type as Record<string, number>)[parentId] ?? super.getItemTypeSortOrder(parentId);
    }

    getActionSubTabSortOrder(parentId: any, subId: any) {
        return (SORT_ORDERS.tabs as Record<string, any>)[parentId]?.[subId] ?? super.getActionSubTabSortOrder(parentId, subId);
    }

    /**
     * Get the CSS icon class for a right-side action type (parent tab) in PF2e.
     */
    getActionTypeIcon(parentId: any) {
        return (ICONS.action_type as Record<string, string>)[parentId] ?? super.getActionTypeIcon(parentId);
    }

    /**
     * Get the localized label for a right-side action sub-tab in PF2e.
     */
    getActionSubTabLabel(subId: any) {
        const abilityLabels: Record<string, string> = {
            str: localize('PF2E.AbilityStr', 'Strength'),
            dex: localize('PF2E.AbilityDex', 'Dexterity'),
            con: localize('PF2E.AbilityCon', 'Constitution'),
            int: localize('PF2E.AbilityInt', 'Intelligence'),
            wis: localize('PF2E.AbilityWis', 'Wisdom'),
            cha: localize('PF2E.AbilityCha', 'Charisma')
        };
        if (abilityLabels[subId]) return abilityLabels[subId];

        switch (subId) {
            case 'all': return localize('BAD.core.allActions', 'All Actions');
            case 'action': return localize('PF2E.TabActionsLabel', 'Actions');
            case 'reaction': return localize('PF2E.ActionsReactionsHeader', 'Reactions');
            case 'other': return localize('PF2E.ActionsFreeActionsHeader', 'Free Actions');
            default: return super.getActionSubTabLabel(subId);
        }
    }

    /**
     * Get the list of configurable action economy types and default colors for PF2e.
     * @returns {{ id: string, label: string, defaultColor: string }[]}
     */
    getEconomyTypes() {
        return [
            { id: 'action', label: this.getActionSubTabLabel('action') ?? 'Actions', defaultColor: '#3b82f6', defaultEnabled: true },
            { id: 'reaction', label: this.getActionSubTabLabel('reaction') ?? 'Reactions', defaultColor: '#ef4444', defaultEnabled: true },
            { id: 'other', label: this.getActionSubTabLabel('other') ?? 'Free Actions', defaultColor: '#22c55e', defaultEnabled: true }
        ];
    }

    /**
     * Modify the rendering context before it is sent to the template.
     * Used here to sort the spell sub-tabs (Cantrips, Ranks 1-10, Focus, Innate, Rituals), format Page 2 categorized checks, Page 3 token info, and display showUnprepared tab indicators.
     */
    modifyContext(context: any, app: any) {
        const result = super.modifyContext?.(context, app);

        const showAll = Boolean(app?.actor?.getFlag?.(MODULE_ID, 'showAll'));

        const allParent = context.itemTypes?.find((g: any) => g.id === 'all');
        if (allParent) {
            allParent.showUnprepared = showAll;
            if (context.showTooltips) {
                allParent.tooltip = localize('BAD.tabs.allTooltip', '<b>Right Click:</b> Toggle Show All (Equipped & Unequipped Items, Prepared & Unprepared Spells)');
            }
        }

        for (const [type, cfg] of Object.entries(PF2E_UNEQUIPPED_TAB_CONFIG)) {
            const parent = context.itemTypes?.find((g: any) => g.id === type);
            if (parent) {
                const showFlag = Boolean(app?.actor?.getFlag?.(MODULE_ID, cfg.flag));
                parent.showUnprepared = Boolean(showFlag || showAll);
                if (context.showTooltips) {
                    parent.tooltip = localize(cfg.tooltip, cfg.defaultTooltip);
                }
            }
        }

        const spellGroup = context.itemTypes?.find((g: any) => g.id === 'spell');
        if (spellGroup?.subTabs?.length) {
            spellGroup.subTabs.sort((a: any, b: any) =>
                (PF2E_SPELL_SUB_TAB_ORDER.get(a.id) ?? 999) - (PF2E_SPELL_SUB_TAB_ORDER.get(b.id) ?? 999)
            );
        }

        return result instanceof Promise ? result.then(() => context) : (result ?? context);
    }

    /**
     * Extract structured token information for Page 3 showcase in PF2e.
     * @param {Actor} actor
     * @param {Token} [token]
     * @returns {Promise<Object|null>}
     */
    async getTokenInfo(actor: any, token: Token | null = null): Promise<any> {
        if (!actor) return null;

        const system = actor.system ?? {};
        const cfg = (CONFIG as any)?.PF2E;

        // 1. Name and Image
        const name = token?.name ?? actor.name ?? '';
        const img = token?.document?.texture?.src ?? (token as any)?.texture?.src ?? actor.img ?? 'icons/svg/mystery-man.svg';

        // 2. Creature Type, Traits, Size, Alignment, Level / Creature
        const typeInfo = this.#extractCreatureType(actor, cfg);

        // 3. Armor Class & Shield stats
        const acInfo = this.#extractArmorClass(actor);

        // 4. Movement Speeds (Land, other speeds)
        const movementInfo = this.#extractMovement(actor, token);

        // 5. Resistances
        const resistances = this.#extractResistances(actor, cfg);

        // 6. Immunities
        const damageImmunities = this.#extractImmunities(actor, cfg);
        const conditionImmunities: any[] = [];

        // 7. Weaknesses (PF2e vulnerabilities)
        const vulnerabilities = this.#extractWeaknesses(actor, cfg);

        // 8. Languages
        const languages = this.#extractLanguages(actor, cfg);

        // 9. Senses
        const senses = this.#extractSenses(actor, cfg);

        // 10. Biography / Description
        const rawBio = system.details?.biography?.value ?? system.details?.biography?.public ?? system.details?.publicNotes ?? system.details?.description?.value ?? '';
        let biographyHTML = '';
        if (rawBio.trim()) {
            biographyHTML = await this.enrichHTML(rawBio, {
                relativeTo: actor,
                rollData: actor.getRollData?.() ?? {},
                secrets: false,
                async: true
            });
        }

        return {
            name,
            img,
            typeLabel: typeInfo.fullLabel,
            type: typeInfo.type,
            subtype: typeInfo.subtype,
            size: typeInfo.size,
            crLabel: typeInfo.crLabel,
            alignment: typeInfo.alignment,
            ac: acInfo,
            movement: movementInfo,
            resistances,
            hasResistances: resistances.length > 0,
            damageImmunities,
            conditionImmunities,
            hasImmunities: damageImmunities.length > 0,
            vulnerabilities,
            hasVulnerabilities: vulnerabilities.length > 0,
            languages,
            hasLanguages: languages.length > 0,
            senses,
            hasSenses: senses.length > 0,
            biography: rawBio,
            biographyHTML,
            hasBiography: Boolean(biographyHTML || rawBio.trim())
        };
    }

    /**
     * Retrieve the distance the token has moved in the current combat turn.
     * @param {Token|null} [token=null]
     * @param {Actor|null} [actor=null]
     * @returns {{ inCombat: boolean, distance: number, units: string }}
     */
    getTurnMovement(token = null, actor = null) {
        return CombatMovementTracker.getMovementThisTurn(token, actor);
    }

    #extractCreatureType(actor: any, cfg: any = (CONFIG as any)?.PF2E) {
        const system = actor?.system ?? {};
        const details = system.details ?? {};
        const traits = system.traits ?? {};

        // Size
        const rawSize = traits.size;
        const sizeStr = rawSize?.value ?? rawSize?.label ?? rawSize?.id ?? rawSize ?? 'med';
        const sizeLabel = cfg?.actorSizes?.[sizeStr] ? localize(cfg.actorSizes[sizeStr], sizeStr) : ((PF2E_SIZE_MAP as Record<string, string>)[sizeStr.toLowerCase()] ?? (sizeStr ? sizeStr.charAt(0).toUpperCase() + sizeStr.slice(1) : 'Medium'));

        // Level / CR
        const level = actor.level ?? details.level?.value ?? 1;
        const crLabel = actor.type === 'npc' ? `Creature ${level}` : `Level ${level}`;

        // Alignment
        const alignment = details.alignment?.value ? localize(`PF2E.Alignment${details.alignment.value}`, details.alignment.value) : '';

        // Traits / Creature Type / Ancestry
        const traitList = Array.isArray(traits.value) ? traits.value : [];
        const ancestry = details.ancestry?.name ?? details.heritage?.name ?? '';
        const creatureType = details.creatureType ? localize(details.creatureType, details.creatureType) : '';

        let typeStr = creatureType.length > 0 ? creatureType : ancestry;
        if (!typeStr && traitList.length > 0) {
            typeStr = traitList.map((t: any) => cfg?.creatureTraits?.[t] ? localize(cfg.creatureTraits[t], t) : (t.charAt(0).toUpperCase() + t.slice(1))).join(', ');
        }

        const fullLabel = [sizeLabel, typeStr].filter(Boolean).join(' ');

        return {
            size: sizeLabel,
            alignment,
            type: creatureType.length > 0 ? creatureType : (traitList[0] ?? ''),
            subtype: ancestry,
            crLabel,
            fullLabel
        };
    }

    #extractArmorClass(actor: any) {
        const ac = actor?.armorClass?.value ?? actor?.system?.attributes?.ac?.value ?? 10;
        const shield = actor?.system?.attributes?.shield;

        const parts: string[] = [];
        let shieldLabel = '';
        if (shield?.raised || (shield?.hp?.value ?? 0) > 0) {
            if (shield.ac) parts.push(`+${shield.ac} Shield AC`);
            if (shield.hardness) parts.push(`Hardness ${shield.hardness}`);
            if (parts.length > 0) shieldLabel = `Shield: ${parts.join(', ')}`;
        }

        return {
            value: ac,
            label: shieldLabel,
            secondaries: parts
        };
    }

    #extractMovement(actor: any, token: Token | null = null) {
        const speed = actor?.system?.attributes?.speed ?? {};
        const primaryVal = speed.value ?? speed.total ?? 25;
        const primary = `${primaryVal} ft`;
        const secondaries: string[] = [];

        const otherSpeeds = Array.isArray(speed.otherSpeeds) ? speed.otherSpeeds : [];
        for (const s of otherSpeeds) {
            const typeLabel = s.type ? (s.type.charAt(0).toUpperCase() + s.type.slice(1)) : 'Special';
            const val = s.value ?? s.total;
            if (val) {
                secondaries.push(`${typeLabel} ${val} ft`);
            }
        }

        const turnMovement = CombatMovementTracker.getMovementThisTurn(token, actor);
        const movedLabel = turnMovement.inCombat
            ? `${turnMovement.distance} ${turnMovement.units} ${localize('BAD.page3.moved', 'moved')}`
            : '';

        return {
            primary,
            secondaries,
            inCombat: turnMovement.inCombat,
            showMoved: turnMovement.inCombat,
            movedDistance: turnMovement.distance,
            movedLabel
        };
    }

    #extractResistances(actor: any, cfg: any = (CONFIG as any)?.PF2E) {
        const resistances = actor?.system?.attributes?.resistances ?? [];
        const results: string[] = [];

        for (const res of resistances) {
            if (!res?.type) {
                if (res) results.push(String(res));
                continue;
            }
            const typeKey = res.type;
            const typeLabel = cfg?.damageTypes?.[typeKey] ? localize(cfg.damageTypes[typeKey], typeKey) : (typeKey.charAt(0).toUpperCase() + typeKey.slice(1));
            const value = res.value ?? '';
            const exceptions = Array.isArray(res.exceptions) && res.exceptions.length > 0 ? ` (except ${res.exceptions.join(', ')})` : '';
            results.push(`${typeLabel} ${value}${exceptions}`.trim());
        }

        return results;
    }

    #extractImmunities(actor: any, cfg: any = (CONFIG as any)?.PF2E) {
        const immunities = actor?.system?.attributes?.immunities ?? [];
        const results: string[] = [];

        for (const imm of immunities) {
            if (!imm?.type) {
                if (imm) results.push(String(imm));
                continue;
            }
            const typeKey = imm.type;
            const typeLabel = cfg?.immunityTypes?.[typeKey] ? localize(cfg.immunityTypes[typeKey], typeKey) : (typeKey.charAt(0).toUpperCase() + typeKey.slice(1));
            const exceptions = Array.isArray(imm.exceptions) && imm.exceptions.length > 0 ? ` (except ${imm.exceptions.join(', ')})` : '';
            results.push(`${typeLabel}${exceptions}`.trim());
        }

        return results;
    }

    #extractWeaknesses(actor: any, cfg: any = (CONFIG as any)?.PF2E) {
        const weaknesses = actor?.system?.attributes?.weaknesses ?? [];
        const results: string[] = [];

        for (const weak of weaknesses) {
            if (!weak?.type) {
                if (weak) results.push(String(weak));
                continue;
            }
            const typeKey = weak.type;
            const typeLabel = cfg?.weaknessTypes?.[typeKey] ? localize(cfg.weaknessTypes[typeKey], typeKey) : (typeKey.charAt(0).toUpperCase() + typeKey.slice(1));
            const value = weak.value ?? '';
            const exceptions = Array.isArray(weak.exceptions) && weak.exceptions.length > 0 ? ` (except ${weak.exceptions.join(', ')})` : '';
            results.push(`${typeLabel} ${value}${exceptions}`.trim());
        }

        return results;
    }

    #extractLanguages(actor: any, cfg: any = (CONFIG as any)?.PF2E) {
        const langData = actor?.system?.details?.languages;
        if (!langData) return [];

        const results: string[] = [];
        const langMap = cfg?.languages ?? {};

        for (const key of toSet(langData.value)) {
            const label = langMap[key] ? localize(langMap[key], key) : (key.charAt(0).toUpperCase() + key.slice(1));
            if (label) results.push(label);
        }

        if (typeof langData.custom === 'string' && langData.custom.trim()) {
            const customItems = langData.custom.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean);
            results.push(...customItems);
        }

        if (typeof langData.details === 'string' && langData.details.trim()) {
            const detailsItems = langData.details.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean);
            results.push(...detailsItems);
        }

        return Array.from(new Set(results));
    }

    #extractSenses(actor: any, cfg: any = (CONFIG as any)?.PF2E) {
        const sensesData = actor?.system?.traits?.senses ?? actor?.perception?.senses;
        if (!sensesData) return [];

        const results: string[] = [];
        if (Array.isArray(sensesData)) {
            for (const sense of sensesData) {
                if (!sense?.type) {
                    if (sense) results.push(String(sense));
                    continue;
                }
                const typeKey = sense.type;
                const typeLabel = cfg?.senses?.[typeKey] ? localize(cfg.senses[typeKey], typeKey) : (typeKey.charAt(0).toUpperCase() + typeKey.slice(1));
                const range = sense.value ? ` ${sense.value} ft` : '';
                results.push(`${typeLabel}${range}`.trim());
            }
        }

        return Array.from(new Set(results));
    }

    // #endregion

    // #region System Specific Data Extractors & Schema Helpers

    #buildAmmoQuantitiesMap(actor: any) {
        const ammoQuantities = new Map();
        for (const i of actor.items ?? []) {
            const { baseItem, quantity } = this.#getAmmoInfo(i);
            if (baseItem) {
                ammoQuantities.set(baseItem, (ammoQuantities.get(baseItem) ?? 0) + quantity);
            }
        }
        return ammoQuantities;
    }

    #buildSpellToEntryMap(actor: any) {
        const spellToEntryMap = new Map();
        for (const entry of this.#getSpellcastingEntries(actor)) {
            for (const spell of entry.spells ?? []) {
                spellToEntryMap.set(spell.id, entry);
            }
        }
        return spellToEntryMap;
    }

    /**
     * Extract ammunition quantity and base item ID from a PF2e item.
     * @param {Item} item
     * @returns {{ baseItem: string|undefined, quantity: number }}
     */
    #getAmmoInfo(item: any) {
        return item.type === 'ammo'
            ? { baseItem: item.system.baseItem, quantity: item.system.quantity ?? 0 }
            : { baseItem: undefined, quantity: 0 };
    }

    /**
     * Translate PF2e action cost structures into core activation types.
     * @param {Item} item
     * @returns {string|null}
     */
    #getActionType(item: any) {
        return (PF2E_ACTION_TYPE_MAP as Record<string, string>)[item.system.actionType?.value] ?? null;
    }

    /**
     * Get spellcasting entries from a PF2e Actor.
     * @param {Actor} actor
     * @returns {Object[]}
     */
    #getSpellcastingEntries(actor: any) {
        return actor.spellcasting ?? [];
    }

    /**
     * Get Strikes (attacks) registered on a PF2e Actor.
     * @param {Actor} actor
     * @returns {Object[]}
     */
    #getActorStrikes(actor: any) {
        return actor.system.actions ?? [];
    }

    #getSpellSubTab(entry: any, spellLevel: any) {
        if (entry.isFocusPool) return 'focus';
        if (entry.isInnate) return 'innate';
        if (entry.isRitual) return 'ritual';
        return spellLevel.toString();
    }

    #executeFeatRoll(item: any, event: any) {
        const proxiedEvent = this._createRollEvent(event);
        if (item.toMessage) {
            return item.toMessage();
        }
        return item.use?.({ event: proxiedEvent });
    }

    #executeSpellRoll(entry: any, item: any, event: any) {
        const proxiedEvent = this._createRollEvent(event);
        if (entry?.cast) {
            return entry.cast(item, { event: proxiedEvent });
        }
        return item.toMessage?.();
    }

    #executeStrikeRoll(strike: any, event: any) {
        const proxiedEvent = this._createRollEvent(event);
        return (strike.variants?.[0] ?? strike)?.roll?.({ event: proxiedEvent });
    }

    #executeConsumableRoll(item: any, event: any) {
        const proxiedEvent = this._createRollEvent(event);
        if (item.consume) {
            return item.consume();
        }
        if (item.toMessage) {
            return item.toMessage();
        }
        return item.use?.({ event: proxiedEvent });
    }

    #executeEquipmentRoll(item: any, event: any) {
        const proxiedEvent = this._createRollEvent(event);
        if (item.toMessage) {
            return item.toMessage();
        }
        return item.use?.({ event: proxiedEvent });
    }

    #createStrikeAction(strike: any, ammoQuantities: any) {
        return {
            id: `strike-${strike.slug ?? strike.label}`,
            name: strike.label,
            type: 'weapon',
            img: strike.item?.img ?? ICONS.default_strike,
            activationType: 'action',
            right: [TabRef.from('economy', 'action')],
            left: ['weapon'],
            hidden: false,
            available: true,
            uses: this.#getStrikeAmmoUses(strike, ammoQuantities),
            roll: (event: any) => this.#executeStrikeRoll(strike, event),
            originalItem: strike.item,
            extra: { pf2eStrike: strike }
        };
    }

    #formatActionRow(action: any, spellToEntryMap: any) {
        const item = action.originalItem;
        if (!item) return false;
        if (item.type === 'action' || item.type === 'feat') {
            return this.#formatFeatAction(action, item);
        }
        if (item.type === 'spell') {
            return this.#formatSpellAction(action, item, spellToEntryMap.get(item.id));
        }
        if (item.type === 'consumable') {
            return this.#formatConsumableAction(action, item);
        }
        if (item.type === 'equipment') {
            return this.#formatEquipmentAction(action, item);
        }
        return false;
    }

    #formatFeatAction(action: any, item: any) {
        const activationType = this.#getActionType(item);
        if (!activationType) {
            const rawType = item.system.actionType?.value;
            log.debug(`Pf2eSystemAdapter.#formatFeatAction | Filtering out "${item.name}" (${item.type}, ID: ${item.id}) — item.system.actionType.value ("${rawType}") is not in PF2E_ACTION_TYPE_MAP`);
            return false;
        }

        action.activationType = activationType;
        action.right = [TabRef.from('economy', activationType)];
        action.left = [item.type === 'action' ? 'feat' : item.type];
        action.uses = this.#getUses(item);
        action.roll = (event: any) => this.#executeFeatRoll(item, event);
        return true;
    }

    #formatSpellAction(action: any, item: any, entry: any) {
        if (!entry) {
            log.debug(`Pf2eSystemAdapter.#formatSpellAction | Filtering out spell "${item.name}" (ID: ${item.id}) — no spellcasting entry found in spellToEntryMap (spell is not registered in any spellcasting entry on this actor)`);
            return false;
        }

        const spellLevel = item.rank ?? 0;
        action.right = [TabRef.from('economy', 'action')];
        action.activationType = 'action';
        action.left = ['spell', this.#getSpellSubTab(entry, spellLevel)];
        action.roll = (event: any) => this.#executeSpellRoll(entry, item, event);
        action.uses = this.#getSpellUses(entry, item);
        action.name = `${item.name} (${entry.name})`;
        return true;
    }

    #formatConsumableAction(action: any, item: any) {
        action.name = action.name ?? item.name;
        const activationType = this.#getActionType(item) ?? 'action';
        action.activationType = activationType;
        action.right = [TabRef.from('economy', activationType)];
        action.left = ['consumable'];
        action.uses = this.#getConsumableUses(item);
        action.roll = (event: any) => this.#executeConsumableRoll(item, event);
        return true;
    }

    #formatEquipmentAction(action: any, item: any) {
        action.name = action.name ?? item.name;
        const activationType = this.#getActionType(item) ?? 'action';
        action.activationType = activationType;
        action.right = [TabRef.from('economy', activationType)];
        action.left = ['equipment'];
        action.uses = this.#getUses(item);
        action.roll = (event: any) => this.#executeEquipmentRoll(item, event);
        return true;
    }

    #getConsumableUses(item: any) {
        const uses = item.system.uses;
        if (uses && uses.max > 0) {
            return { available: uses.value ?? 0, max: uses.max };
        }
        const quantity = item.system.quantity;
        if (quantity != null) {
            return { available: quantity, max: null };
        }
        return { available: null, max: null };
    }

    /**
     * Calculate frequency limits (uses) for PF2e actions/feats.
     * @param {Item} item
     * @returns {{ available: number|null, max: number|null }}
     */
    #getUses(item: any) {
        const freq = item.system.frequency;
        return freq
            ? { available: freq.value ?? 0, max: freq.max ?? 0 }
            : { available: null, max: null };
    }

    /**
     * Calculate spell slot / focus pool uses for PF2e spells.
     * @param {Object} entry Spellcasting entry
     * @param {Item} spell Spell item
     * @returns {{ available: number|null, max: number|null }}
     */
    #getSpellUses(entry: any, spell: any) {
        if (entry.isFocusPool) {
            const focus = entry.actor?.system?.resources?.focus;
            return { available: focus?.value ?? 0, max: focus?.max ?? 0 };
        }

        const level = spell.rank ?? 0;
        if (entry.isSpontaneous && level > 0) {
            const slot = entry.system.slots?.[`slot${level}`];
            return { available: slot?.value ?? 0, max: slot?.max ?? 0 };
        }

        return { available: null, max: null };
    }

    /**
     * Calculate ammo uses for a PF2e strike if applicable.
     * @param {Object} strike
     * @param {Map<string, number>} ammoQuantities
     * @returns {{ available: number|null, max: number|null }}
     */
    #getStrikeAmmoUses(strike: any, ammoQuantities: any) {
        const baseType = strike.item?.type === 'weapon' && strike.item.system.ammo?.baseType;
        return baseType
            ? { available: ammoQuantities.get(baseType) ?? 0, max: null }
            : { available: null, max: null };
    }

    /**
     * Get the default HUD categorization structure for PF2e.
     * @param {Object} [overrides={}] Generic category overrides
     * @returns {Object[]} Array of category definition objects
     */
    getDefaultCategories(overrides: Record<string, any> = {}) {
        const categories = super.getDefaultCategories(this.mergeObject({
            weapon: {
                name: 'Weapons & Strikes',
                expression: `item.type === 'weapon' || action.left.includes('weapon')`
            },
            spell: {
                subcategories: [
                    {
                        id: 'sub_cantrips',
                        name: 'Cantrips',
                        expression: `item.rank === 0 || item.isCantrip || item.system?.traits?.value?.includes('cantrip')`
                    },
                    {
                        id: 'sub_ranked_spells',
                        name: 'Ranked Spells',
                        expression: `item.rank > 0`
                    }
                ]
            },
            feature: {
                name: 'Feats & Actions',
                expression: `item.type === 'feat' || item.type === 'action'`
            }
        }, overrides, { inplace: false, overwrite: true }));

        const pf2eCategories = [
            {
                id: 'cat_saves',
                name: 'Saving Throws',
                expression: `action.type === "save"`,
                subcategories: []
            },
            {
                id: 'cat_skill_checks',
                name: 'Skills & Perception',
                expression: `action.type === "skill"`,
                subcategories: [
                    {
                        id: 'sub_strength',
                        name: 'Strength',
                        expression: `action.right.some(t => t.label === "str")`
                    },
                    {
                        id: 'sub_dexterity',
                        name: 'Dexterity',
                        expression: `action.right.some(t => t.label === "dex")`
                    },
                    {
                        id: 'sub_constitution',
                        name: 'Constitution',
                        expression: `action.right.some(t => t.label === "con")`
                    },
                    {
                        id: 'sub_intelligence',
                        name: 'Intelligence',
                        expression: `action.right.some(t => t.label === "int")`
                    },
                    {
                        id: 'sub_wisdom',
                        name: 'Wisdom',
                        expression: `action.right.some(t => t.label === "wis")`
                    },
                    {
                        id: 'sub_charisma',
                        name: 'Charisma',
                        expression: `action.right.some(t => t.label === "cha")`
                    }
                ]
            }
        ];

        for (const cat of pf2eCategories) {
            const key = cat.id.replace('cat_', '');
            const catOverride = overrides[cat.id] ?? overrides[key] ?? {};
            categories.push(this.mergeObject(cat, catOverride, { inplace: false, overwrite: true }));
        }

        return categories;
    }

    // #endregion

    // #region Tooltip Item Summary

    /**
     * Build an item summary object for PF2e tooltips.
     * @param {Object} action The HUD action instance
     * @param {Object} [item] The original item document
     * @param {Object} [actor] The owning actor document
     * @returns {{title: string, subtitle?: string, img?: string, properties?: Array<string|{label?: string, value: string}>, description?: string}|null}
     */
    async getItemSummary(action: any, item: any = action?.originalItem, actor: any = null): Promise<any> {
        if (!action && !item) return null;
        const targetItem = item ?? action?.originalItem ?? action;
        const title = action?.name ?? targetItem?.name ?? '';
        const img = (action?.img && action.img.length > 0) ? action.img : (targetItem?.img ?? '');
        const system = targetItem?.system ?? {};
        const type = targetItem?.type ? (targetItem.type.charAt(0).toUpperCase() + targetItem.type.slice(1)) : '';
        const properties: any[] = [];

        if (system.damage?.dice && system.damage?.die) {
            properties.push({ label: 'Damage', value: `${system.damage.dice}${system.damage.die} ${system.damage.damageType ?? ''}`.trim() });
        }
        if (system.range) {
            const rangeStr = (system.range?.value != null || system.range?.unit != null) ? `${system.range.value ?? ''} ${system.range.unit ?? ''}`.trim() : String(system.range);
            if (rangeStr) properties.push({ label: 'Range', value: rangeStr });
        }
        if (system.traits?.value && Array.isArray(system.traits.value)) {
            for (const trait of system.traits.value) {
                properties.push({ value: trait });
            }
        }
        if (action?.uses?.available != null) {
            const usesStr = `${action.uses.available}${action.uses.max ? ` / ${action.uses.max}` : ''}`;
            properties.push({ label: 'Uses', value: usesStr });
        }

        let description = system.description?.value ?? '';
        if (description) {
            const rollData = targetItem?.getRollData?.() ?? actor?.getRollData?.() ?? {};
            description = await this.enrichHTML(description, {
                rollData,
                relativeTo: targetItem ?? actor,
                secrets: false,
                async: true
            });
        }

        return {
            title,
            subtitle: type,
            img,
            properties,
            description
        };
    }

    // #endregion
}

/**
 * Dynamic factory entry-point for Pathfinder 2nd Edition.
 * Dynamically instantiates the appropriate version subclass based on game.system.version.
 */
export class Pf2eSystemAdapter extends BasePf2eSystemAdapter {
    constructor(foundry: any) {
        if (!foundry) {
            throw new Error(`Pf2eSystemAdapter requires a valid Foundry adapter instance, received: ${foundry}`);
        }
        if (new.target === Pf2eSystemAdapter) {
            return new BasePf2eSystemAdapter(foundry);
        }
        super(foundry);
    }
}
