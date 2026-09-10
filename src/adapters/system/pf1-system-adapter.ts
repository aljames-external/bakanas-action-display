import { FantasySystemAdapter } from './genre/fantasy-system-adapter.js';
import { localize } from '../../lib/utils.js';
import { log } from '../../lib/logger.js';
import { TabRef } from '../../ui/tab-ref.js';
import { Action } from '../../ui/action.js';
import { MODULE_ID } from '../../constants.js';
import { Pf1SystemContextMenuManager } from './context-menu/pf1-system-context-menu-manager.js';
import { CombatMovementTracker } from '../../combat/combat-movement-tracker.js';

interface Pf1Subaction {
    id: string;
    name: string;
    img?: string | null;
    activationType: string;
    right: TabRef[];
    uses: { available: number | null; max: number | null };
    roll: (event: unknown) => unknown;
    [key: string]: unknown;
}

const SORT_ORDERS = {
    tabs: {
        'economy': {
            'all': 0, 'action': 1, 'bonus': 2, 'reaction': 3, 'other': 4
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
        'attack': 3,
        'equipment': 4,
        'spell': 5,
        'feat': 6,
        'buff': 7,
        'consumable': 8
    }
};

const EXTRACTABLE_TYPES = new Set(['spell', 'attack', 'weapon', 'consumable', 'feat', 'buff', 'equipment']);
const EQUIPPABLE_TYPES = new Set(['weapon', 'equipment', 'consumable', 'loot', 'attack']);
const ACTION_BEARING_TYPES = new Set(['consumable', 'feat', 'equipment']);

const SPELL_SUB_TAB_ORDER = new Map(
    ['cantrip', 'orison', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'sla'].map((id, i) => [id, i])
);

const ICONS = {
    action_type: {
        'all': 'fas fa-border-all',
        'economy': 'fas fa-stopwatch',
        'ability': 'fas fa-fist-raised'
    }
};

/**
 * Base system adapter for Pathfinder 1st Edition (PF1e) (legacy baseline).
 * Handles PF1e's multi-action items, prepared/spontaneous spellcasting, and toggleable buffs.
 */
export class BasePf1SystemAdapter extends FantasySystemAdapter {
    constructor(foundry: BaseFoundryAdapter) {
        super('pf1', true, foundry);
        this.contextMenuManager = new Pf1SystemContextMenuManager(this);
    }

    /**
     * Check if a PF1e item is equipped.
     * @param {Item} item
     * @returns {boolean}
     */
    override getItemEquipped(item: Item): boolean {
        if (!item?.system) return true;
        const itemPF = item as ItemPF;
        if (itemPF.system?.equipped !== undefined) {
            return Boolean(itemPF.system.equipped);
        }
        return true;
    }

    // #region Core Action Modification

    /**
     * Determine if a specific item should be extracted as a base action for PF1e.
     * Prevents allocating objects for unhandled item types (like containers).
     */
    override shouldExtractItem(item: Item): boolean {
        return EXTRACTABLE_TYPES.has(item.type);
    }

    /**
     * Filter, map, and sort the base actions list for PF1e.
     * @param {Action[]} actions Base action list from the core
     * @param {Actor} actor 
     * @returns {Promise<Action[]>} The modified actions list
     */
    override async modifyActions(actions: Action[], actor: Actor): Promise<Action[]> {
        const modified: Action[] = [];
        const showAll = Boolean(actor?.getFlag?.(MODULE_ID, 'showAll'));

        const { attackToWeaponMap, weaponLinkedAttacks } = this.#buildWeaponAttackLinks(actor);

        log.group(`Pf1SystemAdapter.modifyActions | Filtering and mapping actions for "${actor?.name ?? 'Actor'}"`, 'debug');
        try {
            for (const action of actions) {
                const item = action.originalItem;
                if (!item) continue;
                const itemPF = item as ItemPF;
                const type = item.type as string;

                let isUnequipped = false;
                if (EQUIPPABLE_TYPES.has(type) && itemPF.system?.equipped !== undefined) {
                    if (!this.getItemEquipped(item)) {
                        isUnequipped = true;
                        const showUnequipped = Boolean(actor?.getFlag?.(MODULE_ID, `showUnequipped_${type}`) || showAll);
                        const isUserHidden = Boolean(actor?.getFlag?.(MODULE_ID, 'hiddenItems')?.[item.id ?? '']);
                        if (!showUnequipped && !isUserHidden) {
                            log.debug(`Pf1SystemAdapter.modifyActions | Filtering out unequipped ${type} "${item.name}" (ID: ${item.id}) — item.system.equipped is falsy and showUnequipped_${type} / showAll flag is not set`);
                            continue;
                        }
                    }
                }

                if (type === 'spell') {
                    // 1. Spells in PF1e
                    const spellbookId = itemPF.system.spellbook ?? 'primary';
                    const spellbook = this.#getSpellbook(actor, spellbookId);
                    if (!spellbook) {
                        log.debug(`Pf1SystemAdapter.modifyActions | Filtering out spell "${item.name}" (ID: ${item.id}) — no spellbook found for spellbook ID "${spellbookId}" (item.system.spellbook)`);
                        continue;
                    }

                    action.right = [TabRef.from('economy', 'action')];
                    action.activationType = 'action';

                    const level = itemPF.system.level ?? 0;
                    const subTab = this.#getSpellSubTab(spellbookId, spellbook, level);
                    action.left = ['spell', subTab];

                    // Calculate uses (slots or prepared casts)
                    action.uses = this.#calculateSpellUses(spellbook, item);

                    // Roll function
                    action.roll = (event: unknown) => this.#executeItemRoll(item, null, event);

                    modified.push(action);
                } else if (type === 'attack') {
                    // 2. Attacks in PF1e (if not linked to a weapon)
                    if (attackToWeaponMap.has(item.id ?? '')) {
                        log.debug(`Pf1SystemAdapter.modifyActions | Skipping attack "${item.name}" (${item.id}) because it is linked to a weapon.`);
                        continue;
                    }

                    const itemActions = this.#getItemActions(item);
                    if (itemActions.length === 0) {
                        log.debug(`Pf1SystemAdapter.modifyActions | Filtering out attack "${item.name}" (ID: ${item.id}) — item.system.actions is empty`);
                        continue;
                    }

                    const uses = this.#calculateUses(item, actor);

                    const subactions = this.#buildSubactions(item, itemActions, uses);
                    if (subactions.length === 0) {
                        log.debug(`Pf1SystemAdapter.modifyActions | Filtering out attack "${item.name}" (ID: ${item.id}) — no subactions had a recognized activationType`);
                        continue;
                    }

                    this.#promoteFirstSubaction(action, subactions, ['weapon'], uses);
                    if (isUnequipped) action.available = false;
                    modified.push(action);

                } else if (type === 'weapon') {
                    // 3. Weapons (with ammo resolution and linked attacks merging)
                    const uses = this.#calculateUses(item, actor);
                    const linkedAttacks = weaponLinkedAttacks.get(item.id ?? '') ?? [];

                    const itemActionsList = linkedAttacks.length > 0
                        ? this.#buildLinkedAttackSubactions(linkedAttacks, item, uses)
                        : this.#buildSubactions(item, this.#getItemActions(item), uses);

                    if (itemActionsList.length === 0) {
                        log.debug(`Pf1SystemAdapter.modifyActions | Filtering out weapon "${item.name}" (ID: ${item.id}) — no subactions had a recognized activationType`);
                        continue;
                    }

                    this.#promoteFirstSubaction(action, itemActionsList, ['weapon'], uses);
                    if (isUnequipped) action.available = false;
                    modified.push(action);

                } else if (ACTION_BEARING_TYPES.has(type)) {
                    // 4. Consumables, Feats, and Equipment
                    const itemActions = this.#getItemActions(item);
                    if (itemActions.length === 0) {
                        if (type === 'equipment') {
                            // Passive or standard equipment item
                            action.right = [TabRef.from('economy', 'other')];
                            action.activationType = 'other';
                            action.left = ['equipment'];
                            action.uses = { available: null, max: null };
                            action.available = !isUnequipped;
                            action.roll = (event: unknown) => this.#executeItemRoll(item, null, event);
                            modified.push(action);
                            continue;
                        }
                        log.debug(`Pf1SystemAdapter.modifyActions | Filtering out ${type} "${item.name}" (ID: ${item.id}) — item.system.actions is empty`);
                        continue;
                    }

                    const uses = this.#calculateUses(item, actor);

                    const subactions = this.#buildSubactions(item, itemActions, uses);
                    if (subactions.length === 0) {
                        log.debug(`Pf1SystemAdapter.modifyActions | Filtering out ${type} "${item.name}" (ID: ${item.id}) — no subactions had a recognized activationType`);
                        continue;
                    }

                    this.#promoteFirstSubaction(action, subactions, [type], uses);
                    if (isUnequipped) action.available = false;
                    modified.push(action);

                } else if (type === 'buff') {
                    // 5. Buffs
                    action.right = [TabRef.from('economy', 'other')];
                    action.activationType = 'other';
                    action.left = ['buff'];

                    action.roll = async () => {
                        const active = this.#getBuffActiveState(item);
                        await (item.update as Function)({ "system.active": !active });
                    };

                    action.isActive = this.#getBuffActiveState(item);
                    action.uses = { available: null, max: null };
                    action.excludeFromAll = true; // Exclude buffs from the 'All Items' tab in PF1e

                    modified.push(action);
                }
            }
        } finally {
            log.groupEnd();
        }

        for (const act of modified) {
            act.page = 1;
        }

        modified.push(...this.extractCheckActions(actor));
        modified.push(...this.extractInfoActions(actor));

        // Apply default resource filtering (e.g. hiding depleted actions)
        return super.modifyActions(modified, actor);
    }

    /**
     * Extract Page 2 ability checks, saving throws, and skill checks for PF1e.
     * @param {Actor} actor
     * @returns {Action[]}
     */
    override extractCheckActions(actor?: Actor): Action[] {
        if (!actor) return [];
        const act = actor as ActorPF;
        const checkActions: Action[] = [];
        const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        const abilityNames: Record<string, string[]> = {
            str: ['PF1.AbilityStr', 'Strength'],
            dex: ['PF1.AbilityDex', 'Dexterity'],
            con: ['PF1.AbilityCon', 'Constitution'],
            int: ['PF1.AbilityInt', 'Intelligence'],
            wis: ['PF1.AbilityWis', 'Wisdom'],
            cha: ['PF1.AbilityCha', 'Charisma']
        };
        const abilityIcons: Record<string, string> = {
            str: 'icons/svg/sword.svg',
            dex: 'icons/svg/wing.svg',
            con: 'icons/svg/shield.svg',
            int: 'icons/svg/book.svg',
            wis: 'icons/svg/eye.svg',
            cha: 'icons/svg/paralysis.svg'
        };

        for (const abl of abilities) {
            const labelKey = abilityNames[abl];
            const name = localize(labelKey[0], labelKey[1]);
            const img = abilityIcons[abl];

            const subactions: Action[] = [];

            if (abl === 'con' || abl === 'dex' || abl === 'wis') {
                const saveMap: Record<string, string> = { con: 'fort', dex: 'ref', wis: 'will' };
                const saveKey = saveMap[abl];
                const saveSub = new Action({
                    id: `save-${abl}`,
                    name: localize('BAD.page2.savingThrow', 'Saving Throw'),
                    type: 'save',
                    img,
                    right: [TabRef.from('ability', abl)],
                    left: ['savingThrow'],
                    available: true,
                    roll: async (event?: Event) => {
                        const rollEvent = this._createRollEvent(event);
                        return act.rollSavingThrow?.(saveKey, { event: rollEvent }) ??
                            act.rollSave?.(saveKey, { event: rollEvent });
                    }
                });
                subactions.push(saveSub);
            }

            const checkSub = new Action({
                id: `check-${abl}`,
                name: localize('BAD.page2.abilityCheck', 'Ability Check'),
                type: 'abilityCheck',
                img,
                right: [TabRef.from('ability', abl)],
                left: ['abilityCheck'],
                available: true,
                roll: async (event?: Event) => {
                    const rollEvent = this._createRollEvent(event);
                    return act.rollAbilityTest?.(abl, { event: rollEvent }) ??
                        act.rollAbilityCheck?.(abl, { event: rollEvent }) ??
                        act.rollAbility?.(abl, { event: rollEvent });
                }
            });
            subactions.push(checkSub);

            const coreAction = new Action({
                id: `ability-${abl}`,
                name,
                type: 'ability',
                img,
                page: 2,
                right: [TabRef.from('ability', abl)],
                left: subactions.some(s => s.type === 'save') ? ['savingThrow'] : ['abilityCheck'],
                itemCategories: subactions.some(s => s.type === 'save') ? [['savingThrow'], ['abilityCheck']] : [['abilityCheck']],
                available: true,
                uses: { available: null, max: null },
                subactions,
                collapseDropdownIfSingle: true,
                extra: { ability: abl }
            });
            checkActions.push(coreAction);
        }

        // Skills
        const skills = act.system?.skills ?? {};
        const pf1Config = CONFIG?.PF1;
        for (const [skillId, rawSkill] of Object.entries(skills)) {
            const skill = rawSkill as Pf1Skill;
            const abl = skill.ability ?? pf1Config?.skills?.[skillId]?.ability ?? 'dex';
            const rawConfigSkill = pf1Config?.skills?.[skillId];
            const configLabel = typeof rawConfigSkill === 'string' ? rawConfigSkill : rawConfigSkill?.label;
            const label = skill.name ?? configLabel ?? skill.label ?? skillId;
            const skillImg = abilityIcons[abl] ?? 'icons/svg/d20.svg';
            const skillAction = new Action({
                id: `skill-${skillId}`,
                name: label,
                type: 'skill',
                img: skillImg,
                page: 2,
                right: [TabRef.from('ability', abl)],
                left: ['abilityCheck'],
                available: true,
                uses: { available: null, max: null },
                roll: async (event?: Event) => {
                    const rollEvent = this._createRollEvent(event);
                    return act.rollSkill?.(skillId, { event: rollEvent });
                },
                extra: { ability: abl }
            });
            checkActions.push(skillAction);

            if (skill.subSkills) {
                for (const [subId, rawSub] of Object.entries(skill.subSkills)) {
                    const subSkill = rawSub as Pf1Skill;
                    const subAbl = subSkill.ability ?? abl;
                    const subLabel = subSkill.name ?? `${label} (${subId})`;
                    const subAction = new Action({
                        id: `skill-${skillId}-${subId}`,
                        name: subLabel,
                        type: 'skill',
                        img: abilityIcons[subAbl] ?? skillImg,
                        page: 2,
                        right: [TabRef.from('ability', subAbl)],
                        left: ['abilityCheck'],
                        available: true,
                        uses: { available: null, max: null },
                        roll: async (event?: Event) => {
                            const rollEvent = this._createRollEvent(event);
                            return act.rollSkill?.(`${skillId}.subSkills.${subId}`, { event: rollEvent });
                        },
                        extra: { ability: subAbl }
                    });
                    checkActions.push(subAction);
                }
            }
        }

        return checkActions;
    }

    // #endregion

    /**
     * Modify the rendering context before it is sent to the template.
     * Used here to sort the spell sub-tabs (Cantrips, Orisons, Levels, SLAs), format Page 2 categorized checks, Page 3 token info, and display showUnprepared indicators.
     */
    override modifyContext(
        context: Record<string, unknown> & { itemTypes?: Array<{ id: string; showUnprepared?: boolean; tooltip?: string; subTabs?: Array<{ id: string; [key: string]: unknown }> }>; showTooltips?: boolean },
        app: { actor?: Actor | null; [key: string]: unknown }
    ) {
        const result = super.modifyContext?.(context, app);

        const showAll = Boolean(app?.actor?.getFlag?.(MODULE_ID, 'showAll'));

        const unequippedTabMap = {
            weapon: { flag: 'showUnequipped_weapon', tooltip: 'BAD.tabs.unequippedWeaponsTooltip', defaultTooltip: '<b>Right Click:</b> Toggle Show Unequipped Weapons' },
            buff: { flag: 'showInactive_buff', tooltip: 'BAD.tabs.inactiveBuffsTooltip', defaultTooltip: '<b>Right Click:</b> Toggle Show Inactive Buffs' },
            equipment: { flag: 'showUnequipped_equipment', tooltip: 'BAD.tabs.unequippedEquipmentTooltip', defaultTooltip: '<b>Right Click:</b> Toggle Show Unequipped Equipment' }
        };

        const allParent = context.itemTypes?.find(g => g.id === 'all');
        if (allParent) {
            allParent.showUnprepared = showAll;
            if (context.showTooltips) {
                allParent.tooltip = localize('BAD.tabs.allTooltip', '<b>Right Click:</b> Toggle Show All (Equipped & Unequipped Items, Prepared & Unprepared Spells)');
            }
        }

        for (const [type, cfg] of Object.entries(unequippedTabMap)) {
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
                (SPELL_SUB_TAB_ORDER.get(a.id) ?? 999) - (SPELL_SUB_TAB_ORDER.get(b.id) ?? 999)
            );
        }

        return result instanceof Promise ? result.then(() => context) : (result ?? context);
    }

    /**
     * Extract structured token information for Page 3 showcase in PF1e.
     * @param {Actor} actor
     * @param {Token} [token]
     * @returns {Promise<Object|null>}
     */
    override async getTokenInfo(actor: Actor | null, token: Token | null = null): Promise<Record<string, unknown> | null> {
        if (!actor) return null;

        const act = actor as ActorPF;
        const system = (act.system as Record<string, unknown>) ?? {};
        const cfg: Pf1Config = CONFIG?.PF1 ?? {};

        // 1. Name and Image
        const name = token?.name ?? actor.name ?? '';
        const img = token?.document?.texture?.src ?? (token as { texture?: { src?: string } } | null)?.texture?.src ?? actor.img ?? 'icons/svg/mystery-man.svg';

        // 2. Creature Type, Race, Size, Alignment, CR / Level
        const typeInfo = this.#extractCreatureType(actor, cfg);

        // 3. Armor Class (Normal, Touch, Flat-Footed)
        const acInfo = this.#extractArmorClass(actor);

        // 4. Movement Speeds (Land, Fly with Maneuverability, Swim, Climb, Burrow)
        const movementInfo = this.#extractMovement(actor, cfg, token);

        // 5. Damage Resistances (DR + Energy Resistances)
        const resistances = this.#extractResistances(actor, cfg);

        // 6. Damage Immunities
        const damageImmunities = this.#extractDamageImmunities(actor, cfg);

        // 7. Condition Immunities
        const conditionImmunities = this.#extractConditionImmunities(actor, cfg);

        // 8. Damage Vulnerabilities
        const vulnerabilities = this.#extractVulnerabilities(actor, cfg);

        // 9. Languages
        const languages = this.#extractLanguages(actor, cfg);

        // 10. Senses
        const senses = this.#extractSenses(actor, cfg);

        // 11. Biography / Notes
        const details = (system.details as Record<string, unknown>) ?? {};
        const rawBio = String(((details.biography as Record<string, unknown>)?.value ?? (details.notes as Record<string, unknown>)?.value ?? (details.biography as Record<string, unknown>)?.public ?? ''));
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
            hasImmunities: damageImmunities.length > 0 || conditionImmunities.length > 0,
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

    #extractCreatureType(actor: Actor, cfg: Pf1Config = CONFIG?.PF1 ?? {}) {
        const act = actor as ActorPF;
        const system = (act?.system as Record<string, unknown>) ?? {};
        const details = (system.details as Record<string, unknown>) ?? {};
        const traits = (system.traits as Record<string, unknown>) ?? {};

        // Size
        const rawSize = traits.size as { value?: string; label?: string; id?: string } | string | undefined;
        const sizeStr = (typeof rawSize === 'object' && rawSize !== null ? (rawSize.value ?? rawSize.label ?? rawSize.id) : rawSize) ?? 'med';
        const sizeMap: Record<string, string> = {
            fine: 'Fine', dim: 'Diminutive', tiny: 'Tiny', sm: 'Small',
            med: 'Medium', lg: 'Large', huge: 'Huge', grg: 'Gargantuan', col: 'Colossal'
        };
        const sizeLabel = cfg?.actorSizes?.[sizeStr] ? localize(cfg.actorSizes[sizeStr], cfg.actorSizes[sizeStr]) : (sizeMap[sizeStr.toLowerCase()] ?? (sizeStr ? sizeStr.charAt(0).toUpperCase() + sizeStr.slice(1) : 'Medium'));

        // Alignment
        const alignKey = details.alignment as string | undefined;
        const alignLabel = alignKey ? (cfg?.alignments?.[alignKey] ? localize(cfg.alignments[alignKey], alignKey) : alignKey) : '';

        // CR / Level
        const level = act.level ?? (details.level as { value?: number } | undefined)?.value ?? 1;
        const crObj = details.cr as { total?: string | number; base?: string | number } | string | number | undefined;
        const cr = (typeof crObj === 'object' && crObj !== null ? (crObj.total ?? crObj.base) : crObj) ?? '';
        const crLabel = (actor.type as string) === 'npc' && cr !== '' ? `CR ${cr}` : `Level ${level}`;

        // Creature Type, Subtypes, Race
        const rawType = traits.type as { value?: string } | string | undefined;
        const rawSubTypes = traits.subTypes as { value?: string[] } | string[] | string | undefined;
        const mainTypeKey = (typeof rawType === 'object' && rawType !== null ? rawType.value : rawType) ?? '';
        const mainTypeLabel = cfg?.creatureTypes?.[mainTypeKey] ? localize(cfg.creatureTypes[mainTypeKey], mainTypeKey) : (mainTypeKey ? mainTypeKey.charAt(0).toUpperCase() + mainTypeKey.slice(1) : '');

        let subTypesList: string[] = [];
        if (typeof rawSubTypes === 'object' && rawSubTypes !== null && 'value' in rawSubTypes && Array.isArray(rawSubTypes.value)) {
            subTypesList = rawSubTypes.value;
        } else if (Array.isArray(rawSubTypes)) {
            subTypesList = rawSubTypes;
        } else if (typeof rawSubTypes === 'string' && rawSubTypes.trim()) {
            subTypesList = rawSubTypes.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean);
        }

        const subTypeLabels = subTypesList.map((st: string) => cfg?.subTypes?.[st] ? localize(cfg.subTypes[st], st) : (st.charAt(0).toUpperCase() + st.slice(1)));
        const race = details.race ? String(details.race) : '';

        const typeParts = [mainTypeLabel];
        if (subTypeLabels.length > 0) {
            typeParts.push(`(${subTypeLabels.join(', ')})`);
        }
        const fullType = typeParts.filter(Boolean).join(' ');

        const fullParts = [sizeLabel, fullType].filter(Boolean);
        if (race && !fullType.toLowerCase().includes(race.toLowerCase())) {
            fullParts.push(`(${race})`);
        }
        const fullLabel = fullParts.join(' ');

        return {
            size: sizeLabel,
            alignment: alignLabel,
            type: mainTypeLabel,
            subtype: subTypeLabels.join(', '),
            race,
            crLabel,
            fullLabel
        };
    }

    #extractArmorClass(actor: Actor) {
        const act = actor as ActorPF;
        const ac = ((act?.system as Record<string, unknown>)?.attributes as Record<string, unknown>)?.ac as {
            normal?: { total?: number };
            value?: number;
            total?: number;
            touch?: { total?: number };
            flatFooted?: { total?: number };
        } | undefined;
        const normal = ac?.normal?.total ?? ac?.value ?? ac?.total ?? 10;
        const touch = ac?.touch?.total;
        const flatFooted = ac?.flatFooted?.total;

        const subParts: string[] = [];
        if (touch != null) subParts.push(`Touch: ${touch}`);
        if (flatFooted != null) subParts.push(`Flat-Footed: ${flatFooted}`);

        return {
            value: normal,
            label: subParts.join(', '),
            secondaries: subParts
        };
    }

    #extractMovement(actor: Actor, cfg: Pf1Config = CONFIG?.PF1 ?? {}, token: Token | null = null) {
        const act = actor as ActorPF;
        const speed = (((act?.system as Record<string, unknown>)?.attributes as Record<string, unknown>)?.speed as {
            land?: { total?: number; value?: number };
            fly?: { total: number; maneuverability?: string };
            swim?: { total: number };
            climb?: { total: number };
            burrow?: { total: number };
        }) ?? {};
        const land = speed.land?.total ?? speed.land?.value ?? 30;
        const primary = `${land} ft`;
        const secondaries: string[] = [];

        if ((speed.fly?.total ?? 0) > 0) {
            const manKey = speed.fly!.maneuverability;
            const manLabel = manKey ? (cfg?.flyManeuverabilities?.[manKey] ? localize(cfg.flyManeuverabilities[manKey], manKey) : manKey) : '';
            secondaries.push(`Fly ${speed.fly!.total} ft${manLabel ? ` (${manLabel})` : ''}`);
        }
        if ((speed.swim?.total ?? 0) > 0) secondaries.push(`Swim ${speed.swim!.total} ft`);
        if ((speed.climb?.total ?? 0) > 0) secondaries.push(`Climb ${speed.climb!.total} ft`);
        if ((speed.burrow?.total ?? 0) > 0) secondaries.push(`Burrow ${speed.burrow!.total} ft`);

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

    /**
     * Extract trait entries according to legacy PF1 (< v11) schema.
     * @param {Pf1TraitData|null|undefined} [traitData]
     * @param {Record<string, string>} [configMap]
     * @returns {string[]}
     */
    extractTraitEntries(traitData: Pf1TraitData | null | undefined, configMap: Record<string, string> | null = null): string[] {
        if (!traitData) return [];
        const results: string[] = [];

        const rawValue = traitData.value;
        if (Array.isArray(rawValue)) {
            for (const key of rawValue) {
                const label = configMap?.[key] ? localize(configMap[key], key) : (key ? key.charAt(0).toUpperCase() + key.slice(1) : '');
                if (label) results.push(label);
            }
        } else if (rawValue) {
            results.push(...rawValue.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean));
        }

        // Custom entries (comma or semicolon-separated string)
        if (traitData.custom) {
            results.push(...traitData.custom.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean));
        }

        return Array.from(new Set(results));
    }

    #extractResistances(actor: Actor, cfg: Pf1Config = CONFIG?.PF1 ?? {}): string[] {
        const act = actor as ActorPF;
        const traits = ((act?.system as Record<string, unknown>)?.traits as { dr?: Pf1TraitData; eres?: Pf1TraitData }) ?? {};
        const results: string[] = [];

        // Damage Reduction (DR)
        const drEntries = this.extractTraitEntries(traits.dr, cfg?.damageReductionTypes ?? null);
        for (const dr of drEntries) {
            results.push(dr.startsWith('DR ') ? dr : `DR ${dr}`);
        }

        // Energy Resistance (ER)
        const eresEntries = this.extractTraitEntries(traits.eres, cfg?.damageTypes ?? null);
        for (const eres of eresEntries) {
            results.push(eres);
        }

        return Array.from(new Set(results));
    }

    #extractDamageImmunities(actor: Actor, cfg: Pf1Config = CONFIG?.PF1 ?? {}): string[] {
        const act = actor as ActorPF;
        return this.extractTraitEntries(((act?.system as Record<string, unknown>)?.traits as { di?: Pf1TraitData })?.di, cfg?.damageTypes ?? null);
    }

    #extractConditionImmunities(actor: Actor, cfg: Pf1Config = CONFIG?.PF1 ?? {}): string[] {
        const act = actor as ActorPF;
        return this.extractTraitEntries(((act?.system as Record<string, unknown>)?.traits as { ci?: Pf1TraitData })?.ci, cfg?.conditionTypes ?? cfg?.conditions ?? null);
    }

    #extractVulnerabilities(actor: Actor, cfg: Pf1Config = CONFIG?.PF1 ?? {}): string[] {
        const act = actor as ActorPF;
        return this.extractTraitEntries(((act?.system as Record<string, unknown>)?.traits as { dv?: Pf1TraitData })?.dv, cfg?.damageTypes ?? null);
    }

    #extractLanguages(actor: Actor, cfg: Pf1Config = CONFIG?.PF1 ?? {}): string[] {
        const act = actor as ActorPF;
        return this.extractTraitEntries(((act?.system as Record<string, unknown>)?.traits as { languages?: Pf1TraitData })?.languages, cfg?.languages ?? null);
    }

    #extractSenses(actor: Actor, _cfg: Pf1Config = CONFIG?.PF1 ?? {}): string[] {
        const act = actor as ActorPF;
        const sensesData = ((act?.system as Record<string, unknown>)?.traits as { senses?: unknown })?.senses as {
            custom?: string;
            darkvision?: number | string;
            lowLight?: boolean;
            lowlight?: boolean;
            blindsight?: number | string;
            blindSense?: number | string;
            blindsense?: number | string;
            tremorsense?: number | string;
            scent?: boolean;
            seeInDarkness?: boolean;
        } | string | undefined;
        if (!sensesData) return [];

        const results: string[] = [];
        if (typeof sensesData === 'string') {
            return sensesData.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean);
        }

        if (typeof sensesData.custom === 'string') {
            results.push(...sensesData.custom.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean));
        }

        if (sensesData.darkvision) {
            results.push(`Darkvision ${sensesData.darkvision} ft`);
        }
        if (sensesData.lowLight || sensesData.lowlight) {
            results.push('Low-Light Vision');
        }
        if (sensesData.blindsight) {
            results.push(`Blindsight ${sensesData.blindsight} ft`);
        }
        if (sensesData.blindSense || sensesData.blindsense) {
            results.push(`Blindsense ${sensesData.blindSense ?? sensesData.blindsense} ft`);
        }
        if (sensesData.tremorsense) {
            results.push(`Tremorsense ${sensesData.tremorsense} ft`);
        }
        if (sensesData.scent) {
            results.push('Scent');
        }
        if (sensesData.seeInDarkness) {
            results.push('See in Darkness');
        }

        return Array.from(new Set(results));
    }

    /**
     * Get the localized label for a right-side action type (parent tab) in PF1e.
     */
    override getActionTypeLabel(parentId: string): string {
        const labels: Record<string, string> = {
            'economy': localize('BAD.common.actionEconomy', 'Action Economy')
        };
        return labels[parentId] ?? super.getActionTypeLabel(parentId);
    }

    /**
     * Get the CSS icon class for a right-side action type (parent tab) in PF1e.
     */
    override getActionTypeIcon(parentId: string): string {
        return (ICONS.action_type as Record<string, string>)[parentId] ?? super.getActionTypeIcon(parentId);
    }

    /**
     * Get the localized label for a right-side action sub-tab in PF1e.
     */
    override getActionSubTabLabel(subId: string): string {
        const abilityLabels: Record<string, string> = {
            str: localize('PF1.AbilityStr', 'Strength'),
            dex: localize('PF1.AbilityDex', 'Dexterity'),
            con: localize('PF1.AbilityCon', 'Constitution'),
            int: localize('PF1.AbilityInt', 'Intelligence'),
            wis: localize('PF1.AbilityWis', 'Wisdom'),
            cha: localize('PF1.AbilityCha', 'Charisma')
        };
        if (abilityLabels[subId]) return abilityLabels[subId];

        switch (subId) {
            case 'all': return localize('BAD.core.allActions', 'All Actions');
            case 'action': return localize('PF1.Activation.action.Plural', 'Actions');
            case 'bonus': return localize('PF1.Activation.swift.Single', 'Swift');
            case 'reaction': return localize('PF1.Activation.immediate.Single', 'Immediate');
            case 'other': return localize('PF1.Activation.free.Single', 'Free');
            default: return super.getActionSubTabLabel(subId);
        }
    }

    /**
     * Get the list of configurable action economy types and default colors for PF1.
     * @returns {{ id: string, label: string, defaultColor: string }[]}
     */
    override getEconomyTypes() {
        return [
            { id: 'action', label: this.getActionSubTabLabel('action') ?? 'Actions', defaultColor: '#3b82f6', defaultEnabled: true },
            { id: 'bonus', label: this.getActionSubTabLabel('bonus') ?? 'Swift', defaultColor: '#14b8a6', defaultEnabled: true },
            { id: 'reaction', label: this.getActionSubTabLabel('reaction') ?? 'Immediate', defaultColor: '#ef4444', defaultEnabled: true },
            { id: 'other', label: this.getActionSubTabLabel('other') ?? 'Free', defaultColor: '#64748b', defaultEnabled: true }
        ];
    }

    /**
     * Get the localized label for a left-side item type (parent tab) in PF1e.
     */
    override getItemTypeLabel(parentId: string): string {
        switch (parentId) {
            case 'weapon': return localize('PF1.InventoryWeapons', 'Weapons');
            case 'equipment': return localize('PF1.InventoryEquipment', localize('PF1.Equipment', 'Equipment'));
            case 'spell': return localize('PF1.Spells', 'Spells');
            case 'feat': return localize('PF1.Feats', 'Feats');
            case 'buff': return localize('PF1.Buffs', 'Buffs');
            case 'consumable': return localize('PF1.InventoryConsumables', 'Consumables');
            default: return super.getItemTypeLabel(parentId);
        }
    }

    /**
     * Get the localized label for a left-side item sub-tab (spell level/spellbook) in PF1e.
     */
    override getItemSubTabLabel(parentId: string, subId: string): string {
        if (parentId !== 'spell') return super.getItemSubTabLabel(parentId, subId);

        switch (subId) {
            case 'sla':
                return localize('PF1.SpellBookSpelllike', 'Spell-like');
            case 'cantrip':
                return localize('PF1.Cantrip', localize('PF1.Cantrips', 'Cantrips'));
            case 'orison':
                return localize('PF1.Orison', localize('PF1.Orisons', 'Orisons'));
            default:
                return localize(`PF1.SpellLevels.${subId}`, `${subId} Level`);
        }
    }

    /**
     * Get the CSS icon class for a left-side item type (parent tab) in PF1e.
     */
    override getItemTypeIcon(parentId: string): string {
        if (parentId === 'buff') return 'fas fa-sparkles';
        if (parentId === 'equipment') return 'fas fa-shield';
        return super.getItemTypeIcon(parentId);
    }

    override getItemTypeSortOrder(parentId: string): number {
        return (SORT_ORDERS.item_type as Record<string, number>)[parentId] ?? super.getItemTypeSortOrder(parentId);
    }

    override getActionSubTabSortOrder(parentId: string, subId: string): number {
        return (SORT_ORDERS.tabs as Record<string, Record<string, number>>)[parentId]?.[subId] ?? super.getActionSubTabSortOrder(parentId, subId);
    }



    /* ------------------------------------------------------------------------- */
    /*  System Data Structure Accessors / Schema Extraction Helpers              */
    /* ------------------------------------------------------------------------- */

    // #endregion

    // #region System Specific Data Extractors & Schema Helpers

    #executeItemRoll(item: Item, actionId: string | null, event: unknown) {
        const proxiedEvent = this._createRollEvent(event);
        const options = actionId ? { actionId, event: proxiedEvent } : { event: proxiedEvent };
        const rollableItem = item as ItemPF;
        if (rollableItem.use) {
            rollableItem.use(options);
        } else if (rollableItem.roll) {
            rollableItem.roll(options);
        }
    }

    #buildSubactions(item: Item, itemActions: Pf1ItemAction[], uses: { available: number | null; max: number | null }): Action[] {
        const subactions: Action[] = [];
        for (const itemAction of itemActions) {
            const activationType = this.#parseActivationType(itemAction.activation?.type);
            if (!activationType) continue;

            subactions.push(new Action({
                id: itemAction.id,
                name: itemAction.name ?? item.name,
                img: item.img ?? undefined,
                activationType,
                right: [TabRef.from('economy', activationType)],
                uses,
                roll: (event?: Event | MouseEvent) => this.#executeItemRoll(item, itemAction.id, event)
            }));
        }
        return subactions;
    }

    #buildLinkedAttackSubactions(linkedAttacks: Item[], weapon: Item, uses: { available: number | null; max: number | null }): Action[] {
        const subactions: Action[] = [];
        for (const attackItem of linkedAttacks) {
            for (const itemAction of this.#getItemActions(attackItem)) {
                const activationType = this.#parseActivationType(itemAction.activation?.type);
                if (!activationType) continue;

                const name = linkedAttacks.length > 1
                    ? `${attackItem.name}: ${itemAction.name ?? localize('PF1.Attack', 'Attack')}`
                    : (itemAction.name ?? attackItem.name);

                subactions.push(new Action({
                    id: itemAction.id,
                    name,
                    img: attackItem.img ?? weapon.img ?? undefined,
                    activationType,
                    right: [TabRef.from('economy', activationType)],
                    uses,
                    roll: (event?: Event | MouseEvent) => this.#executeItemRoll(attackItem, itemAction.id, event)
                }));
            }
        }
        return subactions;
    }

    /**
     * Translate PF1e activation types into our core activation types.
     * Maps Swift -> bonus, Immediate -> reaction, Free/Nonaction -> other.
     * @param {string} actType Raw PF1e activation type
     * @returns {string|null} Normalized activation type
     * @private
     */
    #parseActivationType(actType: unknown): string | null {
        if (!actType || typeof actType !== 'string') return null;

        switch (actType.toLowerCase()) {
            case 'standard':
            case 'attack':
                return 'action';
            case 'swift':
                return 'bonus';
            case 'immediate':
                return 'reaction';
            case 'free':
            case 'nonaction':
                return 'other';
            default:
                return null;
        }
    }

    #buildWeaponAttackLinks(actor: Actor): { attackToWeaponMap: Map<string, Item>; weaponLinkedAttacks: Map<string, Item[]> } {
        const attackToWeaponMap = new Map<string, Item>();
        const weaponLinkedAttacks = new Map<string, Item[]>();

        const weapons = Array.from(actor.items.values()).filter((i: Item) => (i.type as string) === 'weapon');

        for (const weapon of weapons) {
            const children = this.#getWeaponLinkChildren(weapon);
            const linked: Item[] = [];
            for (const child of children) {
                if (!child.uuid) continue;

                let childItem: Item | null = null;
                try {
                    childItem = this.fromUuidSync(child.uuid, { relative: actor }) as Item | null;
                } catch (e) {
                    log.error(`Pf1SystemAdapter.modifyActions | Failed to resolve child UUID ${child.uuid}:`, e);
                }

                if ((childItem?.type as string) === 'attack' && childItem && childItem.id) {
                    attackToWeaponMap.set(childItem.id, weapon);
                    linked.push(childItem);
                }
            }
            if (linked.length > 0) {
                weaponLinkedAttacks.set(weapon.id, linked);
            }
        }

        return { attackToWeaponMap, weaponLinkedAttacks };
    }

    /**
     * Extract weapon link children for a PF1e weapon item.
     * @param {Item} weapon
     * @returns {Object[]} Link children objects
     */
    #getWeaponLinkChildren(weapon: Item): Pf1WeaponLink[] {
        const itemPF = weapon as ItemPF;
        return itemPF.system?.links?.children ?? [];
    }

    /**
     * Get a spellbook from a PF1e Actor by ID.
     * @param {Actor} actor
     * @param {string} spellbookId
     * @returns {Pf1Spellbook|undefined}
     */
    #getSpellbook(actor: Actor, spellbookId: string): Pf1Spellbook | undefined {
        const act = actor as ActorPF;
        return act.system?.attributes?.spells?.spellbooks?.[spellbookId];
    }

    #getSpellSubTab(spellbookId: string, spellbook: Pf1Spellbook | null | undefined, level: number | string): string {
        if (spellbookId === 'spelllike' || spellbookId === 'sla') return 'sla';
        if (level === 0 && spellbook?.kind === 'arcane') return 'cantrip';
        if (level === 0 && spellbook?.kind === 'divine') return 'orison';
        return level.toString();
    }

    #promoteFirstSubaction(action: Action, subactions: Action[], left: string[], uses: { available: number | null; max: number | null }) {
        const firstSub = subactions[0];
        action.subactions = subactions;
        action.activationType = firstSub.activationType;
        action.right = firstSub.right;
        action.left = left;
        action.uses = uses;
    }

    /**
     * Extract sub-actions attached to a PF1e item or attack.
     * @param {Item} item
     * @returns {Pf1ItemAction[]} Sub-action objects
     */
    #getItemActions(item: Item): Pf1ItemAction[] {
        const itemPF = item as ItemPF;
        return itemPF.system?.actions ?? [];
    }

    /**
     * Extract active state of a PF1e Buff item.
     * @param {Item} item
     * @returns {boolean}
     */
    #getBuffActiveState(item: Item): boolean {
        const itemPF = item as ItemPF;
        return Boolean((itemPF.system as Record<string, unknown>)?.active);
    }

    /**
     * Calculate remaining charges/uses for PF1e items.
     */
    #calculateUses(item: Item, actor: Actor | null): { available: number | null; max: number | null } {
        const itemPF = item as ItemPF;
        const system = (itemPF.system as Record<string, unknown> & {
            weaponSubtype?: string;
            ammo?: { type?: string; default?: string };
            uses?: { max?: number; value?: number };
            quantity?: number;
        }) ?? {};

        // 1. Ranged weapon ammunition tracking
        if ((item.type as string) === 'weapon' && system.weaponSubtype === 'ranged' && system.ammo?.type) {
            const ammoId = system.ammo?.default;
            const ammoItem = ammoId ? actor?.items.get(ammoId) as ItemPF | undefined : undefined;
            const rawQuantity = ammoItem?.system?.quantity;
            const quantity = rawQuantity ?? 0;
            return { available: quantity, max: null };
        }

        // 2. Standard charges/uses
        const max = system.uses?.max ?? 0;
        const value = system.uses?.value;

        if (max > 0 || (value ?? 0) > 0) {
            return { available: value ?? max, max };
        }

        // Fallback for consumables: use quantity if uses are not defined
        if ((item.type as string) === 'consumable' && system.quantity !== undefined) {
            return {
                available: system.quantity ?? 0,
                max: null
            };
        }

        return { available: null, max: null };
    }

    /**
     * Calculate spell slot / prepared uses for PF1e spells.
     */
    #calculateSpellUses(spellbook: Pf1Spellbook | null | undefined, spell: Item): { available: number | null; max: number | null } {
        const itemPF = spell as ItemPF;
        const level = (itemPF.system as Record<string, unknown>)?.level as number ?? 0;
        if (level === 0) return { available: null, max: null }; // Cantrips have infinite uses

        // 1. Prepared Spellcasting (Wizard, Cleric, Alchemist, etc.)
        if (spellbook?.spellPreparationMode === 'prepared') {
            const prep = (itemPF.system as Record<string, unknown>)?.preparation as { max?: number; value?: number } | undefined;
            if (prep && (prep.max ?? 0) > 0) {
                return { available: prep.value ?? prep.max ?? 0, max: prep.max ?? 0 };
            }
            return { available: 0, max: 0 }; // Not prepared
        }

        // 2. Spontaneous Spellcasting (Sorcerer, Bard, etc.)
        // Uses the spellbook's slots for that level on the actor
        const slot = spellbook?.spells?.[`spell${level}`];
        if (slot) {
            return {
                available: slot.value ?? 0,
                max: slot.max ?? 0
            };
        }

        return { available: null, max: null };
    }

    /**
     * Get the default HUD categorization structure for PF1e.
     * @param {Object} [overrides={}] Generic category overrides
     * @returns {Object[]} Array of category definition objects
     */
    override getDefaultCategories(overrides: Record<string, unknown> = {}) {
        const categories = super.getDefaultCategories(this.mergeObject({
            weapon: {
                expression: `item.type === 'weapon' || item.type === 'attack' || item.type === 'equipment'`
            },
            feature: {
                expression: `item.type === 'feat' || item.type === 'buff'`
            }
        }, overrides, { inplace: false, overwrite: true }));

        const pf1Categories = [
            {
                id: 'cat_ability_checks',
                name: 'Abilities',
                expression: `action.type === "ability"`,
                subcategories: []
            },
            {
                id: 'cat_skill_checks',
                name: 'Skills',
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

        for (const cat of pf1Categories) {
            const key = cat.id.replace('cat_', '');
            const catOverride = overrides[cat.id] ?? overrides[key] ?? {};
            categories.push(this.mergeObject(cat, catOverride, { inplace: false, overwrite: true }));
        }

        return categories;
    }

    // #endregion

    // #region Tooltip Item Summary

    /**
     * Build an item summary object for PF1e tooltips.
     * @param {Object} action The HUD action instance
     * @param {Object} [item] The original item document
     * @param {Object} [actor] The owning actor document
     * @returns {{title: string, subtitle?: string, img?: string, properties?: Array<string|{label?: string, value: string}>, description?: string}|null}
     */
    override async getItemSummary(action: Action, item: Item | null = action?.originalItem ?? null, actor: Actor | null = null): Promise<ItemSummary | null> {
        if (!action && !item) return null;
        const targetItem = item ?? action?.originalItem ?? null;
        const title = action?.name ?? targetItem?.name ?? '';
        const img = (action?.img && action.img.length > 0) ? action.img : (targetItem?.img ?? '');
        const itemPF = targetItem as ItemPF | null;
        const system = (itemPF?.system as Record<string, unknown>) ?? {};
        const type = targetItem?.type ? (targetItem.type.charAt(0).toUpperCase() + targetItem.type.slice(1)) : '';
        const properties: Array<string | ItemSummaryProperty> = [];

        if (itemPF?.labels?.toHit) {
            properties.push({ label: 'Attack', value: itemPF.labels.toHit });
        }
        if (itemPF?.labels?.damage) {
            properties.push({ label: 'Damage', value: itemPF.labels.damage });
        }
        if (itemPF?.labels?.range) {
            properties.push({ label: 'Range', value: itemPF.labels.range });
        }
        if (itemPF?.labels?.save) {
            properties.push({ label: 'Save', value: itemPF.labels.save });
        }
        if (action?.uses?.available != null) {
            const usesStr = `${action.uses.available}${action.uses.max ? ` / ${action.uses.max}` : ''}`;
            properties.push({ label: 'Uses', value: usesStr });
        }

        let description = ((system.description as { value?: string })?.value) ?? '';
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
 * System adapter for Pathfinder 1st Edition v11.0+.
 * Overrides trait extraction to target modern .values schema with zero access to deprecated .value.
 */
export class Pf1SystemAdapter_11_0 extends BasePf1SystemAdapter {
    /**
     * Extract trait entries according to modern PF1 (v11+) schema.
     * @param {Pf1TraitData|null|undefined} [traitData]
     * @param {Record<string, string>} [configMap]
     * @returns {string[]}
     */
    override extractTraitEntries(traitData: Pf1TraitData | null | undefined, configMap: Record<string, string> | null = null): string[] {
        if (!traitData) return [];
        const results: string[] = [];

        for (const key of traitData.values ?? []) {
            const label = configMap?.[key] ? localize(configMap[key], key) : (key ? key.charAt(0).toUpperCase() + key.slice(1) : '');
            if (label) results.push(label);
        }

        if (traitData.custom) {
            results.push(...traitData.custom.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean));
        }

        return Array.from(new Set(results));
    }
}

/**
 * Dynamic factory entry-point for Pathfinder 1st Edition.
 * Automatically delegates to Pf1SystemAdapter_11_0 on v11+ and BasePf1SystemAdapter on legacy versions.
 */
export class Pf1SystemAdapter extends BasePf1SystemAdapter {
    constructor(foundry: BaseFoundryAdapter) {
        if (!foundry) {
            throw new Error(`Pf1SystemAdapter requires a valid Foundry adapter instance, received: ${foundry}`);
        }
        const version = game.system?.version ?? '11.0.0';
        if (!foundry.isNewerVersion('11.0.0', version) && new.target === Pf1SystemAdapter) {
            return new Pf1SystemAdapter_11_0(foundry);
        }
        super(foundry);
    }
}
