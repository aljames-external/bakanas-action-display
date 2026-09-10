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

interface Pf2eSpellcastingEntry {
    name?: string;
    isFocusPool?: boolean;
    isInnate?: boolean;
    isRitual?: boolean;
    isSpontaneous?: boolean;
    actor?: { system?: { resources?: { focus?: { value?: number; max?: number } } } } | null;
    system?: { slots?: Record<string, { value?: number; max?: number }> };
    spells?: Array<{ id: string; [key: string]: unknown }>;
    cast?: (spell: Item, options?: unknown) => unknown;
    [key: string]: unknown;
}

interface Pf2eStrike {
    slug?: string;
    label: string;
    item?: { img?: string; type?: string; system?: { ammo?: { baseType?: string } } } | null;
    variants?: Array<{ roll?: (options?: unknown) => unknown }>;
    roll?: (options?: unknown) => unknown;
    [key: string]: unknown;
}

interface Pf2eConfig {
    actorSizes?: Record<string, string>;
    creatureTraits?: Record<string, string>;
    damageTypes?: Record<string, string>;
    immunityTypes?: Record<string, string>;
    weaknessTypes?: Record<string, string>;
    languages?: Record<string, string>;
    senses?: Record<string, string>;
    [key: string]: unknown;
}

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
    constructor(foundry: BaseFoundryAdapter) {
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
    override getItemEquipped(item: Item): boolean {
        if (!item?.system) return true;
        const itemPF2e = item as ItemPF2e;
        if (itemPF2e.isPhysical === false) return true;
        if (itemPF2e.category === 'unarmed' || itemPF2e.system.category === 'unarmed' || (itemPF2e.system.category as { value?: string })?.value === 'unarmed') return true;

        const traits = itemPF2e.system.traits?.value;
        if (traits?.includes('unarmed') || traits?.includes('natural')) {
            return true;
        }

        const carryType = itemPF2e.system.equipped?.carryType;
        if (carryType) {
            return carryType === 'held' || carryType === 'worn';
        }
        if (itemPF2e.isEquipped !== undefined) {
            return Boolean(itemPF2e.isEquipped);
        }
        return true;
    }

    // #region Core Action Modification

    /**
     * Determine if a specific item should be extracted as a base action for PF2e.
     * Prevents allocating objects for unhandled item types (like equipment/consumables).
     */
    override shouldExtractItem(item: Item): boolean {
        return EXTRACTABLE_TYPES.has(item.type);
    }

    /**
     * Filter, map, inject, and sort actions for PF2e.
     * @param {Action[]} actions Base action list from the core
     * @param {Actor} actor 
     * @returns {Promise<Action[]>} The modified actions list
     */
    override async modifyActions(actions: Action[], actor: Actor): Promise<Action[]> {
        const modified: Action[] = [];

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

        const finalActions: Action[] = [];
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
     * @param {Actor} [actor]
     * @returns {Action[]}
     */
    override extractCheckActions(actor?: Actor): Action[] {
        if (!actor) return [];
        const act = actor as ActorPF2e;
        const checkActions: Action[] = [];

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
                return (act.saves?.fortitude ?? act.system?.saves?.fortitude)?.roll?.({ event: rollEvent });
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
                return (act.saves?.reflex ?? act.system?.saves?.reflex)?.roll?.({ event: rollEvent });
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
                return (act.saves?.will ?? act.system?.saves?.will)?.roll?.({ event: rollEvent });
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
                return (act.perception ?? act.system?.attributes?.perception)?.roll?.({ event: rollEvent });
            },
            extra: { ability: 'wis' }
        });
        checkActions.push(perception);

        // 2. Skills
        const actorSkills = act.skills ?? act.system?.skills ?? {};
        const skillEntries: [string, unknown][] = (actorSkills as any)?.entries ? Array.from((actorSkills as any).entries()) : Object.entries(actorSkills);

        for (const [key, rawSkill] of skillEntries) {
            const skill = rawSkill as Pf2eStatistic;
            const slug = skill.slug ?? key;
            const abl = (PF2E_SKILL_ABILITY_MAP as Record<string, string>)[slug] ?? skill.ability ?? 'dex';
            const label = skill.label ?? skill.name ?? (CONFIG as any)?.PF2E?.skills?.[slug] ?? slug;
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
                    if (act.rollSkill) {
                        try {
                            return await act.rollSkill({ skill: slug, event: rollEvent });
                        } catch {
                            return act.rollSkill(slug, { event: rollEvent });
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
    override getItemTypeLabel(parentId: string): string {
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
    override getItemSubTabLabel(parentId: string, subId: string): string {
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
    override getActionTypeLabel(parentId: string): string {
        return parentId === 'economy'
            ? localize('BAD.common.actionEconomy', 'Action Economy')
            : super.getActionTypeLabel(parentId);
    }

    override getItemTypeSortOrder(parentId: string): number {
        return (SORT_ORDERS.item_type as Record<string, number>)[parentId] ?? super.getItemTypeSortOrder(parentId);
    }

    override getActionSubTabSortOrder(parentId: string, subId: string): number {
        return (SORT_ORDERS.tabs as Record<string, any>)[parentId]?.[subId] ?? super.getActionSubTabSortOrder(parentId, subId);
    }

    /**
     * Get the CSS icon class for a right-side action type (parent tab) in PF2e.
     */
    override getActionTypeIcon(parentId: string): string {
        return (ICONS.action_type as Record<string, string>)[parentId] ?? super.getActionTypeIcon(parentId);
    }

    /**
     * Get the localized label for a right-side action sub-tab in PF2e.
     */
    override getActionSubTabLabel(subId: string): string {
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
    override getEconomyTypes() {
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
    override modifyContext(
        context: Record<string, unknown> & { itemTypes?: Array<{ id: string; showUnprepared?: boolean; tooltip?: string; subTabs?: Array<{ id: string; [key: string]: unknown }> }>; showTooltips?: boolean },
        app: { activePage?: number; actor?: Actor | null; token?: Token | null; [key: string]: unknown }
    ) {
        const result = super.modifyContext?.(context, app);

        const showAll = Boolean(app?.actor?.getFlag?.(MODULE_ID, 'showAll'));

        const allParent = context.itemTypes?.find(g => g.id === 'all');
        if (allParent) {
            allParent.showUnprepared = showAll;
            if (context.showTooltips) {
                allParent.tooltip = localize('BAD.tabs.allTooltip', '<b>Right Click:</b> Toggle Show All (Equipped & Unequipped Items, Prepared & Unprepared Spells)');
            }
        }

        for (const [type, cfg] of Object.entries(PF2E_UNEQUIPPED_TAB_CONFIG)) {
            const parent = context.itemTypes?.find(g => g.id === type);
            if (parent) {
                const showFlag = Boolean(app?.actor?.getFlag?.(MODULE_ID, cfg.flag));
                parent.showUnprepared = Boolean(showFlag || showAll);
                if (context.showTooltips) {
                    parent.tooltip = localize(cfg.tooltip, cfg.defaultTooltip);
                }
            }
        }

        const spellGroup = context.itemTypes?.find(g => g.id === 'spell');
        if (spellGroup?.subTabs?.length) {
            spellGroup.subTabs.sort((a, b) =>
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
    override async getTokenInfo(actor: Actor | null, token: Token | null = null): Promise<Record<string, unknown> | null> {
        if (!actor) return null;

        const act = actor as ActorPF2e;
        const system = act.system ?? {};
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
        const conditionImmunities: string[] = [];

        // 7. Weaknesses (PF2e vulnerabilities)
        const vulnerabilities = this.#extractWeaknesses(actor, cfg);

        // 8. Languages
        const languages = this.#extractLanguages(actor, cfg);

        // 9. Senses
        const senses = this.#extractSenses(actor, cfg);

        // 10. Biography / Description
        const rawBio = (system as any).details?.biography?.value ?? (system as any).details?.biography?.public ?? (system as any).details?.publicNotes ?? (system as any).details?.description?.value ?? '';
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
    override getTurnMovement(token: Token | null = null, actor: Actor | null = null) {
        return CombatMovementTracker.getMovementThisTurn(token, actor);
    }

    #extractCreatureType(actor: Actor, cfg: Pf2eConfig = (CONFIG as unknown as { PF2E?: Pf2eConfig })?.PF2E ?? {}) {
        const act = actor as ActorPF2e;
        const system = act?.system ?? {};
        const details = (system as any).details ?? {};
        const traits = (system as any).traits ?? {};

        // Size
        const rawSize = traits.size;
        const sizeStr = rawSize?.value ?? rawSize?.label ?? rawSize?.id ?? rawSize ?? 'med';
        const sizeLabel = cfg?.actorSizes?.[sizeStr] ? localize(cfg.actorSizes[sizeStr], sizeStr) : ((PF2E_SIZE_MAP as Record<string, string>)[sizeStr.toLowerCase()] ?? (sizeStr ? sizeStr.charAt(0).toUpperCase() + sizeStr.slice(1) : 'Medium'));

        // Level / CR
        const level = (act as any).level ?? details.level?.value ?? 1;
        const crLabel = (actor.type as string) === 'npc' ? `Creature ${level}` : `Level ${level}`;

        // Alignment
        const alignment = details.alignment?.value ? localize(`PF2E.Alignment${details.alignment.value}`, details.alignment.value) : '';

        // Traits / Creature Type / Ancestry
        const traitList: string[] = Array.isArray(traits.value) ? traits.value : [];
        const ancestry = details.ancestry?.name ?? details.heritage?.name ?? '';
        const creatureType = details.creatureType ? localize(details.creatureType, details.creatureType) : '';

        let typeStr = creatureType.length > 0 ? creatureType : ancestry;
        if (!typeStr && traitList.length > 0) {
            typeStr = traitList.map((t: string) => cfg?.creatureTraits?.[t] ? localize(cfg.creatureTraits[t], t) : (t.charAt(0).toUpperCase() + t.slice(1))).join(', ');
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

    #extractArmorClass(actor: Actor) {
        const act = actor as ActorPF2e;
        const ac = (act as any)?.armorClass?.value ?? (act as any)?.system?.attributes?.ac?.value ?? 10;
        const shield = (act as any)?.system?.attributes?.shield;

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

    #extractMovement(actor: Actor, token: Token | null = null) {
        const act = actor as ActorPF2e;
        const speed = (act as any)?.system?.attributes?.speed ?? {};
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

    #extractResistances(actor: Actor, cfg: Pf2eConfig = (CONFIG as unknown as { PF2E?: Pf2eConfig })?.PF2E ?? {}): string[] {
        const act = actor as ActorPF2e;
        const resistances = (act as any)?.system?.attributes?.resistances ?? [];
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

    #extractImmunities(actor: Actor, cfg: Pf2eConfig = (CONFIG as unknown as { PF2E?: Pf2eConfig })?.PF2E ?? {}): string[] {
        const act = actor as ActorPF2e;
        const immunities = (act as any)?.system?.attributes?.immunities ?? [];
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

    #extractWeaknesses(actor: Actor, cfg: Pf2eConfig = (CONFIG as unknown as { PF2E?: Pf2eConfig })?.PF2E ?? {}): string[] {
        const act = actor as ActorPF2e;
        const weaknesses = (act as any)?.system?.attributes?.weaknesses ?? [];
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

    #extractLanguages(actor: Actor, cfg: Pf2eConfig = (CONFIG as unknown as { PF2E?: Pf2eConfig })?.PF2E ?? {}): string[] {
        const act = actor as ActorPF2e;
        const langData = (act as any)?.system?.details?.languages;
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

    #extractSenses(actor: Actor, cfg: Pf2eConfig = (CONFIG as unknown as { PF2E?: Pf2eConfig })?.PF2E ?? {}): string[] {
        const act = actor as ActorPF2e;
        const sensesData = (act as any)?.system?.traits?.senses ?? (act as any)?.perception?.senses;
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

    #buildAmmoQuantitiesMap(actor: Actor): Map<string, number> {
        const ammoQuantities = new Map<string, number>();
        for (const i of actor.items ?? []) {
            const { baseItem, quantity } = this.#getAmmoInfo(i);
            if (baseItem) {
                ammoQuantities.set(baseItem, (ammoQuantities.get(baseItem) ?? 0) + quantity);
            }
        }
        return ammoQuantities;
    }

    #buildSpellToEntryMap(actor: Actor): Map<string, Pf2eSpellcastingEntry> {
        const spellToEntryMap = new Map<string, Pf2eSpellcastingEntry>();
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
    #getAmmoInfo(item: Item): { baseItem: string | undefined; quantity: number } {
        const itemPF2e = item as ItemPF2e;
        return (item.type as string) === 'ammo'
            ? { baseItem: itemPF2e.system.baseItem, quantity: itemPF2e.system.quantity ?? 0 }
            : { baseItem: undefined, quantity: 0 };
    }

    /**
     * Translate PF2e action cost structures into core activation types.
     * @param {Item} item
     * @returns {string|null}
     */
    #getActionType(item: Item): string | null {
        const itemPF2e = item as ItemPF2e;
        const actionTypeValue = itemPF2e.system.actionType?.value;
        return actionTypeValue ? (PF2E_ACTION_TYPE_MAP as Record<string, string>)[actionTypeValue] ?? null : null;
    }

    /**
     * Get spellcasting entries from a PF2e Actor.
     * @param {Actor} actor
     * @returns {Pf2eSpellcastingEntry[]}
     */
    #getSpellcastingEntries(actor: Actor): Pf2eSpellcastingEntry[] {
        const act = actor as ActorPF2e;
        return (act as unknown as { spellcasting?: Pf2eSpellcastingEntry[] }).spellcasting ?? [];
    }

    /**
     * Get Strikes (attacks) registered on a PF2e Actor.
     * @param {Actor} actor
     * @returns {Pf2eStrike[]}
     */
    #getActorStrikes(actor: Actor): Pf2eStrike[] {
        const act = actor as ActorPF2e;
        return (act.system as unknown as { actions?: Pf2eStrike[] })?.actions ?? [];
    }

    #getSpellSubTab(entry: Pf2eSpellcastingEntry, spellLevel: number | string): string {
        if (entry.isFocusPool) return 'focus';
        if (entry.isInnate) return 'innate';
        if (entry.isRitual) return 'ritual';
        return spellLevel.toString();
    }

    #executeFeatRoll(item: Item, event: unknown) {
        const proxiedEvent = this._createRollEvent(event);
        const actItem = item as unknown as { toMessage?: () => unknown; use?: (options?: unknown) => unknown };
        if (actItem.toMessage) {
            return actItem.toMessage();
        }
        return actItem.use?.({ event: proxiedEvent });
    }

    #executeSpellRoll(entry: Pf2eSpellcastingEntry | null | undefined, item: Item, event: unknown) {
        const proxiedEvent = this._createRollEvent(event);
        if (entry?.cast) {
            return entry.cast(item, { event: proxiedEvent });
        }
        return (item as unknown as { toMessage?: () => unknown }).toMessage?.();
    }

    #executeStrikeRoll(strike: Pf2eStrike, event: unknown) {
        const proxiedEvent = this._createRollEvent(event);
        return (strike.variants?.[0] ?? strike)?.roll?.({ event: proxiedEvent });
    }

    #executeConsumableRoll(item: Item, event: unknown) {
        const proxiedEvent = this._createRollEvent(event);
        const consItem = item as unknown as { consume?: () => unknown; toMessage?: () => unknown; use?: (options?: unknown) => unknown };
        if (consItem.consume) {
            return consItem.consume();
        }
        if (consItem.toMessage) {
            return consItem.toMessage();
        }
        return consItem.use?.({ event: proxiedEvent });
    }

    #executeEquipmentRoll(item: Item, event: unknown) {
        const proxiedEvent = this._createRollEvent(event);
        const equipItem = item as unknown as { toMessage?: () => unknown; use?: (options?: unknown) => unknown };
        if (equipItem.toMessage) {
            return equipItem.toMessage();
        }
        return equipItem.use?.({ event: proxiedEvent });
    }

    #createStrikeAction(strike: Pf2eStrike, ammoQuantities: Map<string, number>): Action {
        return new Action({
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
            roll: (event: unknown) => this.#executeStrikeRoll(strike, event),
            originalItem: (strike.item as unknown as Item) ?? null,
            extra: { pf2eStrike: strike }
        });
    }

    #formatActionRow(action: Action, spellToEntryMap: Map<string, Pf2eSpellcastingEntry>): boolean {
        const item = action.originalItem;
        if (!item) return false;
        const itemType = item.type as string;
        if (itemType === 'action' || itemType === 'feat') {
            return this.#formatFeatAction(action, item);
        }
        if (itemType === 'spell') {
            return this.#formatSpellAction(action, item, spellToEntryMap.get(item.id ?? ''));
        }
        if (itemType === 'consumable') {
            return this.#formatConsumableAction(action, item);
        }
        if (itemType === 'equipment') {
            return this.#formatEquipmentAction(action, item);
        }
        return false;
    }

    #formatFeatAction(action: Action, item: Item): boolean {
        const activationType = this.#getActionType(item);
        if (!activationType) {
            const rawType = (item as ItemPF2e).system.actionType?.value;
            log.debug(`Pf2eSystemAdapter.#formatFeatAction | Filtering out "${item.name}" (${item.type}, ID: ${item.id}) — item.system.actionType.value ("${rawType}") is not in PF2E_ACTION_TYPE_MAP`);
            return false;
        }

        action.activationType = activationType;
        action.right = [TabRef.from('economy', activationType)];
        action.left = [(item.type as string) === 'action' ? 'feat' : item.type];
        action.uses = this.#getUses(item);
        action.roll = (event: unknown) => this.#executeFeatRoll(item, event);
        return true;
    }

    #formatSpellAction(action: Action, item: Item, entry: Pf2eSpellcastingEntry | null | undefined): boolean {
        if (!entry) {
            log.debug(`Pf2eSystemAdapter.#formatSpellAction | Filtering out spell "${item.name}" (ID: ${item.id}) — no spellcasting entry found in spellToEntryMap (spell is not registered in any spellcasting entry on this actor)`);
            return false;
        }

        const spellLevel = (item as unknown as { rank?: number }).rank ?? 0;
        action.right = [TabRef.from('economy', 'action')];
        action.activationType = 'action';
        action.left = ['spell', this.#getSpellSubTab(entry, spellLevel)];
        action.roll = (event: unknown) => this.#executeSpellRoll(entry, item, event);
        action.uses = this.#getSpellUses(entry, item);
        action.name = `${item.name} (${entry.name})`;
        return true;
    }

    #formatConsumableAction(action: Action, item: Item): boolean {
        action.name = action.name ?? item.name;
        const activationType = this.#getActionType(item) ?? 'action';
        action.activationType = activationType;
        action.right = [TabRef.from('economy', activationType)];
        action.left = ['consumable'];
        action.uses = this.#getConsumableUses(item);
        action.roll = (event: unknown) => this.#executeConsumableRoll(item, event);
        return true;
    }

    #formatEquipmentAction(action: Action, item: Item): boolean {
        action.name = action.name ?? item.name;
        const activationType = this.#getActionType(item) ?? 'action';
        action.activationType = activationType;
        action.right = [TabRef.from('economy', activationType)];
        action.left = ['equipment'];
        action.uses = this.#getUses(item);
        action.roll = (event: unknown) => this.#executeEquipmentRoll(item, event);
        return true;
    }

    #getConsumableUses(item: Item): { available: number | null; max: number | null } {
        const itemPF2e = item as ItemPF2e;
        const uses = itemPF2e.system.uses;
        if (uses && (uses.max ?? 0) > 0) {
            return { available: uses.value ?? 0, max: uses.max ?? null };
        }
        const quantity = itemPF2e.system.quantity;
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
    #getUses(item: Item): { available: number | null; max: number | null } {
        const itemPF2e = item as ItemPF2e;
        const freq = itemPF2e.system.frequency;
        return freq
            ? { available: freq.value ?? 0, max: freq.max ?? 0 }
            : { available: null, max: null };
    }

    /**
     * Calculate spell slot / focus pool uses for PF2e spells.
     * @param {Pf2eSpellcastingEntry} entry Spellcasting entry
     * @param {Item} spell Spell item
     * @returns {{ available: number|null, max: number|null }}
     */
    #getSpellUses(entry: Pf2eSpellcastingEntry, spell: Item): { available: number | null; max: number | null } {
        if (entry.isFocusPool) {
            const focus = entry.actor?.system?.resources?.focus;
            return { available: focus?.value ?? 0, max: focus?.max ?? 0 };
        }

        const level = (spell as unknown as { rank?: number }).rank ?? 0;
        if (entry.isSpontaneous && level > 0) {
            const slot = entry.system?.slots?.[`slot${level}`];
            return { available: slot?.value ?? 0, max: slot?.max ?? 0 };
        }

        return { available: null, max: null };
    }

    /**
     * Calculate ammo uses for a PF2e strike if applicable.
     * @param {Pf2eStrike} strike
     * @param {Map<string, number>} ammoQuantities
     * @returns {{ available: number|null, max: number|null }}
     */
    #getStrikeAmmoUses(strike: Pf2eStrike, ammoQuantities: Map<string, number>): { available: number | null; max: number | null } {
        const baseType = (strike.item?.type as string) === 'weapon' && strike.item?.system?.ammo?.baseType;
        return baseType
            ? { available: ammoQuantities.get(baseType) ?? 0, max: null }
            : { available: null, max: null };
    }

    /**
     * Get the default HUD categorization structure for PF2e.
     * @param {Object} [overrides={}] Generic category overrides
     * @returns {Object[]} Array of category definition objects
     */
    override getDefaultCategories(overrides: Record<string, unknown> = {}) {
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
    override async getItemSummary(action: Action, item: Item | null = action?.originalItem ?? null, actor: Actor | null = null): Promise<ItemSummary | null> {
        if (!action && !item) return null;
        const targetItem = item ?? action?.originalItem;
        const title = action?.name ?? targetItem?.name ?? '';
        const img = (action?.img && action.img.length > 0) ? action.img : (targetItem?.img ?? '');
        const itemPF2e = targetItem as ItemPF2e | null;
        const system = (itemPF2e?.system as any) ?? {};
        const type = targetItem?.type ? (targetItem.type.charAt(0).toUpperCase() + targetItem.type.slice(1)) : '';
        const properties: Array<string | ItemSummaryProperty> = [];

        if (system.damage?.dice && system.damage?.die) {
            properties.push({ label: 'Damage', value: `${system.damage.dice}${system.damage.die} ${system.damage.damageType ?? ''}`.trim() });
        }
        if (system.range) {
            const rangeStr = (system.range?.value != null || system.range?.unit != null) ? `${system.range.value ?? ''} ${system.range.unit ?? ''}`.trim() : String(system.range);
            if (rangeStr) properties.push({ label: 'Range', value: rangeStr });
        }
        if (Array.isArray(system.traits?.value)) {
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
    constructor(foundry: BaseFoundryAdapter) {
        if (!foundry) {
            throw new Error(`Pf2eSystemAdapter requires a valid Foundry adapter instance, received: ${foundry}`);
        }
        if (new.target === Pf2eSystemAdapter) {
            return new BasePf2eSystemAdapter(foundry);
        }
        super(foundry);
    }
}
