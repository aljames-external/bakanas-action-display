import { FantasySystemAdapter } from './genre/fantasy-system-adapter.js';
import { localize, toSet } from '../../lib/utils.js';
import { log } from '../../lib/logger.js';
import { MODULE_ID } from '../../constants.js';
import { TabRef } from '../../ui/tab-ref.js';
import { Action } from '../../ui/action.js';

import { Dnd5eSystemContextMenuManager } from './context-menu/dnd5e-system-context-menu-manager.js';
import { Dnd5eSystemTabFilterManager } from './filter/dnd5e-system-tab-filter-manager.js';
import { Dnd5eSystemContextModifier } from './context-modifier/dnd5e-system-context-modifier.js';
import { CombatMovementTracker } from '../../combat/combat-movement-tracker.js';

const ALLOWED_TYPES = new Set(['weapon', 'equipment', 'consumable', 'tool', 'backpack', 'loot', 'feat', 'spell']);
const PASSIVE_ITEM_TYPES = new Set(['equipment', 'weapon', 'consumable', 'tool', 'backpack', 'loot']);
const NON_PREPARED_METHODS = new Set(['innate', 'atwill', 'pact', 'always']);
const INNATE_OR_ATWILL_METHODS = new Set(['innate', 'atwill']);
const PHYSICAL_DAMAGE_TYPES = new Set(['bludgeoning', 'piercing', 'slashing']);
const LIMITED_ITEM_TYPES = new Set(['feat', 'weapon', 'consumable', 'tool']);
const CORE_CHECK_TYPES = new Set(['ability', 'abilityCheck', 'save', 'skill', 'tool']);
const EXCLUDED_SUMMARY_PROPERTIES = new Set(['concentration', 'ritual', 'mgc']);
const SPELL_COMPONENT_KEYS = new Set(['vocal', 'somatic', 'material']);

/**
 * Base system adapter for D&D 5th Edition (v4.0+ baseline).
 * Handles D&D 5e's specific item types, action categories, spell slot calculations,
 * and spell preparation toggles.
 */
export class BaseDnd5eSystemAdapter extends FantasySystemAdapter {
    #actor = null;
    #highestAvailableSlot = 0;
    #ammoQuantities = new Map();
    #resolvedSpellCache = new Map();
    #cachedForMap = new Map();

    constructor(foundry) {
        super('dnd5e', true, foundry);
        this.contextMenuManager = new Dnd5eSystemContextMenuManager(this);
        this.filterManager = new Dnd5eSystemTabFilterManager(this);
        this.contextModifier = new Dnd5eSystemContextModifier(this);
    }

    get actor() {
        return this.#actor;
    }

    /**
     * Initialize adapter context for an actor.
     * Pre-calculates ammo quantities, highest available spell slot, and cached item lookups for O(1) lookups during action modification.
     * @param {Actor} actor
     */
    init(actor) {
        this.#actor = actor;
        this.#highestAvailableSlot = actor ? this.#getHighestAvailableSpellSlot(actor) : 0;
        this.#ammoQuantities = actor ? this.#getAmmoQuantities(actor) : new Map();
        this.#cachedForMap = new Map();
        if (actor?.items) {
            for (const item of actor.items.values()) {
                const cachedFor = item.flags?.dnd5e?.cachedFor ?? item.getFlag?.('dnd5e', 'cachedFor');
                if (cachedFor) {
                    this.#cachedForMap.set(cachedFor, item);
                    const normalized = this.#normalizeCachedForKey(cachedFor);
                    if (normalized) {
                        this.#cachedForMap.set(normalized, item);
                    }
                }
            }
        }
    }

    /**
     * Normalize a D&D 5e cachedFor flag string into a consistent 'itemId.activityId' key.
     * @param {string} cachedFor
     * @returns {string|null}
     */
    #normalizeCachedForKey(cachedFor) {
        if (typeof cachedFor !== 'string' || !cachedFor) return null;
        const match = cachedFor.match(/(?:Item\.)?([^.]+)\.(?:Activity\.)?([^.]+)$/);
        if (match) {
            return `${match[1]}.${match[2]}`;
        }
        return cachedFor;
    }

    get highestAvailableSlot() {
        return this.#highestAvailableSlot;
    }

    // #region Core Action Modification

    /**
     * Determine if a specific item should be extracted as a base action for DnD5e.
     * Prevents allocating objects for unallowed types, cached helper items, and unequipped gear.
     */
    shouldExtractItem(item) {
        const type = item.type;
        if (!ALLOWED_TYPES.has(type)) {
            log.debug(`Dnd5eSystemAdapter.shouldExtractItem | Skipping "${item.name}" (${type}, ID: ${item.id}) — type not in ALLOWED_TYPES`);
            return false;
        }
        const cachedFor = item.getFlag?.('dnd5e', 'cachedFor') ?? item.flags?.dnd5e?.cachedFor;
        if (cachedFor) {
            log.debug(`Dnd5eSystemAdapter.shouldExtractItem | Skipping "${item.name}" (${type}, ID: ${item.id}) — item.flags.dnd5e.cachedFor is set (helper item)`);
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
    async modifyActions(actions, actor) {
        this.init(actor);
        const modified = [];
        const showDepleted = Boolean(game.settings.get(MODULE_ID, 'showDepleted'));

        const showAll = Boolean(actor?.getFlag?.(MODULE_ID, 'showAll'));
        const showUnprepared = Boolean(actor?.getFlag?.(MODULE_ID, 'showUnprepared') || showAll);

        log.group(`Dnd5eSystemAdapter.modifyActions | Filtering and mapping actions for "${actor?.name ?? 'Actor'}"`, 'debug');
        try {
            for (const action of actions) {
                const item = action.originalItem;
                const type = item.type;
                // Extract spell components if it's a spell (for the Spell Components tab)
                const props = item.system?.properties;
                const spellComponents = [];
                if (item.type === 'spell') {
                    spellComponents.push(...this.#getComponentTabs(action));
                }

                // Check if user has hidden this item
                // NOTE(migration): hiddenItems transitioned from legacy string[] to Record<string, boolean> object map.
                // Array check fallback can be removed in a future cleanup once legacy world actor flags have migrated.
                const rawHidden = actor?.getFlag?.(MODULE_ID, 'hiddenItems');
                const isUserHidden = Array.isArray(rawHidden)
                    ? rawHidden.includes(item.id)
                    : Boolean(rawHidden?.[item.id]);

                // 1. Filter out unprepared spells (unless cantrip/innate/at-will/pact/always, showUnprepared/showAll is enabled, or item is user-hidden)
                let isSpellUnprepared = false;
                if (type === 'spell') {
                    const prepMode = item.system.method ?? 'prepared';
                    const isPrepared = Boolean(item.system.prepared);
                    const isCantrip = (item.system.level ?? 0) === 0;
                    isSpellUnprepared = !isCantrip && !NON_PREPARED_METHODS.has(prepMode) && !isPrepared;

                    if (!showUnprepared && isSpellUnprepared && !isUserHidden) {
                        log.debug(`Dnd5eSystemAdapter.modifyActions | Filtering out spell "${item.name}" (ID: ${item.id}) — isPrepared === false and prepMode (${prepMode}) requires preparation; showUnprepared flag is not set`);
                        continue;
                    }
                }

                // 2. Filter out unequipped gear (unless showUnequipped/showAll is enabled or item is user-hidden)
                let isUnequipped = false;
                if (this.getItemEquipped(item) === false) {
                    isUnequipped = true;
                    const showUnequipped = Boolean(actor?.getFlag?.(MODULE_ID, `showUnequipped_${type}`) || showAll);

                    if (!showUnequipped && !isUserHidden) {
                        log.debug(`Dnd5eSystemAdapter.modifyActions | Filtering out ${type} "${item.name}" (ID: ${item.id}) — item.system.equipped === false and showUnequipped_${type} / showAll flag is not set`);
                        continue;
                    }
                }

                // 4. Process activities if they exist (D&D 5e v4+)
                const activities = this.getItemActivities(item);
                let mappedActivities = [];

                if (activities.length > 0) {
                    // Map D&D 5e Activities to sub-actions for the generic HUD item model
                    const rawActivities = await Promise.all(activities.map(async (activity) => {
                        const linkedAction = await this.#resolveActivityLinkedAction(activity, actor, item);
                        const activationType = this.#getActivityActivationType(activity, item, linkedAction);
                        if (!activationType || activationType === 'none') return null;

                        const category = this.#getEconomyCategory(activationType);
                        const subId = this.#getCanonicalSubTab(activationType);
                        const tabRef = TabRef.from('economy', category, subId);

                        const activityName = activity.name?.trim?.() ?? '';
                        const activityImg = activity.img?.trim?.() ?? '';
                        return new Action({
                            id: activity.id,
                            name: (activityName.length > 0 ? activityName : null) ?? linkedAction?.name ?? activity.type?.toUpperCase() ?? 'Action',
                            img: (activityImg.length > 0 ? activityImg : null) ?? linkedAction?.img ?? item.img ?? '',
                            uses: this.#calculateActivityUses(activity, item),
                            right: [tabRef],
                            roll: async (event) => {
                                const proxiedEvent = this._createRollEvent(event);
                                return activity.use({ event: proxiedEvent }, { event: proxiedEvent });
                            },
                            originalItem: item,
                            originalActivity: activity,
                            linkedAction
                        });
                    }));

                    mappedActivities = rawActivities.filter(Boolean);
                }

                if (mappedActivities.length > 0) {
                    // Extract spell components from linked spells on cast activities or item properties if present
                    for (const act of mappedActivities) {
                        const compTabs = this.#getComponentTabs(act);
                        if (compTabs.length > 0) {
                            spellComponents.push(...compTabs);
                            act.right = [...act.right, ...compTabs];
                        }
                    }

                    // Single-pass Resource Filtering: Filter out depleted D&D 5e Activities unless showDepleted is enabled
                    let filteredActivities = mappedActivities;
                    if (!showDepleted) {
                        filteredActivities = mappedActivities.filter(act => {
                            if (act.isDepleted) {
                                log.debug(`Dnd5eSystemAdapter.modifyActions | Filtering out activity "${act.name}" on "${item.name}" (ID: ${item.id}) — act.isDepleted === true (uses.available <= 0) and showDepleted is disabled`);
                                return false;
                            }
                            return true;
                        });

                        // If all activities are depleted, skip this item entirely!
                        if (filteredActivities.length === 0) {
                            log.debug(`Dnd5eSystemAdapter.modifyActions | Filtering out item "${item.name}" (ID: ${item.id}) — all ${mappedActivities.length} activities are depleted and showDepleted is disabled`);
                            continue;
                        }
                    }

                    // Assign to hierarchical item types: [parentType, subType] (for left-side tabs)
                    const left = this.#getItemTabTypes(item, type, filteredActivities);

                    // Calculate main action uses
                    const actionUses = filteredActivities.length === 1
                        ? filteredActivities[0].uses
                        : this.#calculateUses(item);

                    // Create a SINGLE Action instance for the item
                    const activityAction = new Action({
                        ...action,
                        name: item.name, // Keep the clean item name
                        img: item.img, // Use the parent item's icon
                        available: !isSpellUnprepared && !isUnequipped,
                        subactions: filteredActivities,
                        right: this.#collectUniqueTabs(filteredActivities),
                        left,
                        uses: actionUses,
                        roll: async (event) => {
                            // Roll the first active activity directly
                            return filteredActivities[0].roll(event);
                        }
                    });

                    modified.push(activityAction);
                } else if (PASSIVE_ITEM_TYPES.has(type)) {
                    // Passive items (armor, passive shields, containers, loot, passive consumables/tools) are assigned right-side tab 'none' under 'economy'
                    const subType = item.system.type?.value;
                    const passiveAction = new Action({
                        ...action,
                        name: item.name,
                        img: item.img,
                        available: !isUnequipped,
                        right: [TabRef.from('economy', 'none')],
                        left: subType ? [type, subType] : [type],
                        uses: this.#calculateUses(item),
                        roll: async (event) => action.roll?.(event)
                    });
                    modified.push(passiveAction);
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

        return modified;
    }

    extractCheckActions(actor) {
        if (!actor) return [];
        const checkActions = [];
        const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        const abilityNames = {
            str: ['DND5E.AbilityStr', 'Strength'],
            dex: ['DND5E.AbilityDex', 'Dexterity'],
            con: ['DND5E.AbilityCon', 'Constitution'],
            int: ['DND5E.AbilityInt', 'Intelligence'],
            wis: ['DND5E.AbilityWis', 'Wisdom'],
            cha: ['DND5E.AbilityCha', 'Charisma']
        };
        const abilityIcons = {
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

            const saveSub = new Action({
                id: `save-${abl}`,
                name: localize('BAD.page2.savingThrow', 'Saving Throw'),
                type: 'save',
                img,
                right: [TabRef.from('ability', abl)],
                left: ['savingThrow'],
                available: true,
                roll: async (event) => {
                    const rollEvent = this._createRollEvent(event);
                    return actor.rollSavingThrow?.({ ability: abl, event: rollEvent })
                        ?? actor.rollAbilitySave?.({ ability: abl, event: rollEvent });
                }
            });

            const checkSub = new Action({
                id: `check-${abl}`,
                name: localize('BAD.page2.abilityCheck', 'Ability Check'),
                type: 'abilityCheck',
                img,
                right: [TabRef.from('ability', abl)],
                left: ['abilityCheck'],
                available: true,
                roll: async (event) => {
                    const rollEvent = this._createRollEvent(event);
                    return actor.rollAbilityTest?.({ ability: abl, event: rollEvent })
                        ?? actor.rollAbilityCheck?.({ ability: abl, event: rollEvent });
                }
            });

            const coreAction = new Action({
                id: `ability-${abl}`,
                name,
                type: 'ability',
                img,
                page: 2,
                right: [TabRef.from('ability', abl)],
                left: ['savingThrow'],
                itemCategories: [['savingThrow'], ['abilityCheck']],
                available: true,
                uses: { available: null, max: null },
                subactions: [saveSub, checkSub],
                collapseDropdownIfSingle: true,
                extra: { ability: abl }
            });
            checkActions.push(coreAction);
        }

        // 3. Skill Checks
        const cfg = CONFIG?.DND5E;
        const skills = actor.system?.skills ?? {};
        for (const [skillId, skill] of Object.entries(skills)) {
            const abl = skill.ability ?? 'dex';
            const label = skill.label ?? cfg?.skills?.[skillId]?.label ?? skillId;
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
                roll: async (event) => {
                    const rollEvent = this._createRollEvent(event);
                    return actor.rollSkill?.({ skill: skillId, event: rollEvent });
                },
                extra: { ability: abl }
            });
            checkActions.push(skillAction);
        }

        // 4. Tool Checks
        const tools = actor.system?.tools ?? {};
        for (const [toolId, tool] of Object.entries(tools)) {
            const toolConfig = cfg?.tools?.[toolId];
            const label = this.#getToolLabel(toolId, tool, cfg);
            const abl = tool.ability ?? toolConfig?.ability ?? 'int';
            const toolImg = tool.img ?? tool.icon ?? toolConfig?.icon ?? abilityIcons[abl] ?? 'icons/svg/d20.svg';
            const toolAction = new Action({
                id: `tool-${toolId}`,
                name: label,
                type: 'tool',
                img: toolImg,
                page: 2,
                right: [TabRef.from('ability', abl)],
                left: ['tool'],
                available: true,
                uses: { available: null, max: null },
                roll: async (event) => {
                    const rollEvent = this._createRollEvent(event);
                    return actor.rollToolCheck?.({ tool: toolId, event: rollEvent })
                        ?? actor.rollTool?.({ tool: toolId, event: rollEvent });
                },
                extra: { ability: abl, toolId }
            });
            checkActions.push(toolAction);
        }

        return checkActions;
    }


    /**
     * Resolve a human-readable display label for a tool proficiency ID in D&D 5e.
     * @param {string} toolId Tool key or compendium UUID
     * @param {Object} [tool={}] Tool data from actor.system.tools
     * @param {Object} [cfg=CONFIG?.DND5E] System config object
     * @returns {string} Human-readable tool label
     */
    #getToolLabel(toolId, tool = {}, cfg = CONFIG?.DND5E) {
        if (tool.label) return localize(tool.label, tool.label);

        // 1. Try D&D 5e Trait.keyLabel API
        const traitLabel = dnd5e?.documents?.Trait?.keyLabel?.(toolId, { trait: 'tool' })
            ?? dnd5e?.documents?.Trait?.keyLabel?.(toolId);
        if (traitLabel) return localize(traitLabel, traitLabel);

        // 2. Try resolving via fromUuidSync if toolId or config ID is a Compendium UUID
        const compendiumId = toolId.startsWith('Compendium.')
            ? toolId
            : (cfg?.tools?.[toolId]?.id ?? cfg?.toolIds?.[toolId]);
        if (compendiumId?.startsWith?.('Compendium.')) {
            try {
                const doc = this.fromUuidSync(compendiumId);
                if (doc?.name) return doc.name;
            } catch (err) {
                log.debug(`Dnd5eSystemAdapter.#getToolLabel | fromUuidSync failed for "${compendiumId}":`, err);
            }
        }

        // 3. Try standard D&D 5e CONFIG tables
        const toolConfig = cfg?.tools?.[toolId];
        const configLabel = toolConfig?.label ?? (typeof toolConfig === 'string' ? toolConfig : null)
            ?? cfg?.toolProficiencies?.[toolId]
            ?? cfg?.toolTypes?.[toolId]
            ?? cfg?.vehicleTypes?.[toolId];
        if (configLabel) return localize(configLabel, configLabel);

        // 4. Well-known D&D 5e tool categories / abbreviations fallback
        const TOOL_FALLBACKS = {
            art: "Artisan's Tools",
            artisan: "Artisan's Tools",
            disg: 'Disguise Kit',
            forg: 'Forgery Kit',
            game: 'Gaming Set',
            herb: 'Herbalism Kit',
            music: 'Musical Instrument',
            navg: "Navigator's Tools",
            pois: "Poisoner's Kit",
            thief: "Thieves' Tools",
            vehicle: 'Vehicles',
            vehicles: 'Vehicles'
        };
        if (TOOL_FALLBACKS[toolId]) {
            return localize(`DND5E.Tool${toolId.charAt(0).toUpperCase() + toolId.slice(1)}`, TOOL_FALLBACKS[toolId]);
        }

        // 5. Clean string fallback
        return toolId.charAt(0).toUpperCase() + toolId.slice(1);
    }

    // #endregion

    // #region Internal Filtering Logic

    // #endregion

    // #region Localizations & UI Formatting

    /**
     * Map a D&D 5e activation type to its parent category under Action Economy.
     * @param {string} type
     * @returns {string|null} Category identifier ('standard', 'time', 'rest', 'combat', 'monster', 'vehicle') or null if direct
     */
    #getEconomyCategory(type) {
        if (!type) return null;
        const norm = String(type).toLowerCase();
        switch (norm) {
            case 'action':
            case 'bonus':
            case 'reaction':
                return 'standard';
            case 'minute':
            case 'hour':
            case 'day':
                return 'time';
            case 'shortrest':
            case 'short':
            case 'endshortrest':
            case 'longrest':
            case 'long':
            case 'endlongrest':
                return 'rest';
            case 'encounter':
            case 'startencounter':
            case 'turnstart':
            case 'startturn':
            case 'turnend':
            case 'endturn':
                return 'combat';
            case 'legendary':
            case 'mythic':
            case 'lair':
                return 'monster';
            case 'crew':
                return 'vehicle';
            case 'special':
            case 'other':
            default:
                return null;
        }
    }

    /**
     * Map a D&D 5e activation type to its canonical sub-tab identifier.
     * @param {string} type
     * @returns {string} Canonical sub-tab identifier
     */
    #getCanonicalSubTab(type) {
        if (!type) return 'none';
        const norm = String(type).toLowerCase();
        switch (norm) {
            case 'short':
            case 'shortrest':
            case 'endshortrest':
                return 'shortRest';
            case 'long':
            case 'longrest':
            case 'endlongrest':
                return 'longRest';
            case 'encounter':
            case 'startencounter':
                return 'encounter';
            case 'turnstart':
            case 'startturn':
                return 'turnStart';
            case 'turnend':
            case 'endturn':
                return 'turnEnd';
            default:
                return norm;
        }
    }

    /**
     * Get the list of configurable action economy types and default colors for D&D 5e.
     * @returns {{ id: string, label: string, defaultColor: string }[]}
     */
    getEconomyTypes() {
        return [
            { id: 'action', label: this.getActionSubTabLabel('action') ?? 'Action', defaultColor: '#3b82f6', defaultEnabled: true },
            { id: 'bonus', label: this.getActionSubTabLabel('bonus') ?? 'Bonus Action', defaultColor: '#14b8a6', defaultEnabled: true },
            { id: 'reaction', label: this.getActionSubTabLabel('reaction') ?? 'Reaction', defaultColor: '#ef4444', defaultEnabled: true },
            { id: 'minute', label: this.getActionSubTabLabel('minute') ?? 'Minute', defaultColor: '#0284c7', defaultEnabled: false },
            { id: 'hour', label: this.getActionSubTabLabel('hour') ?? 'Hour', defaultColor: '#0369a1', defaultEnabled: false },
            { id: 'day', label: this.getActionSubTabLabel('day') ?? 'Day', defaultColor: '#075985', defaultEnabled: false },
            { id: 'longRest', label: this.getActionSubTabLabel('longRest') ?? 'End of a Long Rest', defaultColor: '#059669', defaultEnabled: false },
            { id: 'shortRest', label: this.getActionSubTabLabel('shortRest') ?? 'End of a Short Rest', defaultColor: '#10b981', defaultEnabled: false },
            { id: 'encounter', label: this.getActionSubTabLabel('encounter') ?? 'Start of Encounter', defaultColor: '#f59e0b', defaultEnabled: false },
            { id: 'turnStart', label: this.getActionSubTabLabel('turnStart') ?? 'Start of Turn', defaultColor: '#84cc16', defaultEnabled: false },
            { id: 'turnEnd', label: this.getActionSubTabLabel('turnEnd') ?? 'End of Turn', defaultColor: '#e11d48', defaultEnabled: false },
            { id: 'legendary', label: this.getActionSubTabLabel('legendary') ?? 'Legendary Action', defaultColor: '#18181b', defaultEnabled: false },
            { id: 'mythic', label: this.getActionSubTabLabel('mythic') ?? 'Mythic Action', defaultColor: '#ec4899', defaultEnabled: false },
            { id: 'lair', label: this.getActionSubTabLabel('lair') ?? 'Lair Action', defaultColor: '#eab308', defaultEnabled: false },
            { id: 'crew', label: this.getActionSubTabLabel('crew') ?? 'Crew Action', defaultColor: '#6366f1', defaultEnabled: false },
            { id: 'special', label: this.getActionSubTabLabel('special') ?? 'Special', defaultColor: '#a855f7', defaultEnabled: true },
            { id: 'other', label: this.getActionSubTabLabel('other') ?? 'Other', defaultColor: '#64748b', defaultEnabled: false }
        ];
    }

    /**
     * Modify the Handlebars rendering context for D&D 5e (categorized checks layout on Page 2, token info showcase on Page 3).
     * @param {Object} context Handlebars template context
     * @param {ApplicationV2} app Active HUD application
     * @returns {Promise<Object>|Object}
     */
    modifyContext(context, app) {
        return super.modifyContext(context, app);
    }

    /**
     * Apply token information layout template for Page 3 showcase.
     * @param {Object} context Handlebars render context
     * @param {Actor} [actor]
     * @param {Token} [token]
     */
    async formatTokenInfoLayout(context, actor = null, token = null) {
        context.layout = 'tokenInfo';
        context.isCategorized = false;
        context.itemTypes = [];
        context.actionTypes = [];
        const targetActor = actor ?? this.actor;
        if (targetActor) {
            context.tokenInfo = await this.getTokenInfo(targetActor, token);
        } else {
            context.tokenInfo = null;
        }
    }

    /**
     * Extract structured token information for Page 3 showcase.
     * @param {Actor} actor
     * @param {Token} [token]
     * @returns {Promise<Object|null>}
     */
    async getTokenInfo(actor, token = null) {
        if (!actor) return null;

        const system = actor.system ?? {};
        const cfg = CONFIG?.DND5E;

        // 1. Name and Image
        const name = token?.name ?? actor.name ?? '';
        const img = token?.texture?.src ?? actor.img ?? 'icons/svg/mystery-man.svg';

        // 1b. Inspiration
        const inspirationInfo = this.getInspiration(actor);

        // 2. Creature Type & Race details
        const typeInfo = this.#extractCreatureType(actor, cfg);

        // 3. Armor Class
        const acInfo = this.#extractArmorClass(actor, cfg);

        // 4. Movement Speeds
        const movementInfo = this.#extractMovement(actor, token);

        // 5. Damage Resistances
        const resistances = this.#extractTraitList(system.traits?.dr, cfg?.damageTypes, cfg?.physicalWeaponBypasses ?? cfg?.itemProperties);

        // 6. Damage Immunities
        const damageImmunities = this.#extractTraitList(system.traits?.di, cfg?.damageTypes, cfg?.physicalWeaponBypasses ?? cfg?.itemProperties);

        // 7. Condition Immunities
        const conditionImmunities = this.#extractConditionImmunities(system.traits?.ci, cfg);

        // 8. Damage Vulnerabilities
        const vulnerabilities = this.#extractTraitList(system.traits?.dv, cfg?.damageTypes, cfg?.physicalWeaponBypasses ?? cfg?.itemProperties);

        // 9. Languages
        const languages = this.#extractLanguages(system.traits?.languages, cfg, system.traits?.communication);

        // 10. Senses
        const senses = this.extractSenses(system.attributes?.senses, cfg);

        // 11. Biography
        const rawBio = system.details?.biography?.value ?? system.details?.biography?.public ?? '';
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
            inspiration: inspirationInfo.value,
            showInspiration: inspirationInfo.supported,
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
     * Determine if an actor supports inspiration and retrieve its current status in D&D 5e.
     * @param {Actor} actor Target actor document
     * @returns {{ supported: boolean, value: boolean }}
     */
    getInspiration(actor) {
        if (!actor) return { supported: false, value: false };
        const system = actor.system ?? {};
        const supported = actor.type === 'character' || system.attributes?.inspiration !== undefined;
        const value = Boolean(system.attributes?.inspiration);
        return { supported, value };
    }

    /**
     * Toggle or set inspiration on an actor in D&D 5e.
     * @param {Actor} actor Target actor document
     * @param {boolean} [force] Optional explicit state to set
     * @returns {Promise<boolean>} Resulting inspiration state
     */
    async toggleInspiration(actor, force) {
        if (!actor) return false;
        const current = Boolean(actor.system?.attributes?.inspiration);
        const next = force ?? !current;
        await actor.update({ 'system.attributes.inspiration': next });
        return next;
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

    #formatLabel(key, configMap = null) {
        if (typeof key !== 'string' || !key) return '';
        const config = configMap?.[key];
        const rawLabel = config?.label ?? config;
        if (rawLabel) {
            if (rawLabel.startsWith?.('DND5E.') || rawLabel.startsWith?.('BAD.')) {
                const localized = localize(rawLabel, null);
                if (localized && localized !== rawLabel) return localized;
            } else {
                return rawLabel;
            }
        }
        return key.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    #extractCreatureType(actor, cfg = CONFIG?.DND5E) {
        const system = actor?.system ?? {};
        const details = system.details ?? {};
        const traits = system.traits ?? {};

        // Size
        const rawSize = traits.size;
        const sizeKey = rawSize?.value ?? rawSize?.label ?? rawSize?.id ?? rawSize ?? 'med';
        const formattedSize = this.#formatLabel(sizeKey, cfg?.actorSizes);
        const sizeLabel = (formattedSize && formattedSize.length > 0) ? formattedSize : 'Medium';

        // Alignment
        const alignment = details.alignment ? localize(details.alignment, details.alignment) : '';

        // CR or Level
        let crLabel = '';
        if (details.cr != null && String(details.cr).length > 0) {
            crLabel = `CR ${details.cr}`;
        } else if (details.level != null && String(details.level).length > 0) {
            crLabel = `Level ${details.level}`;
        }

        // Check if NPC type object or PC race
        const typeData = details.type;
        const rawType = typeData?.value ?? (typeof typeData === 'string' ? typeData : '');
        const subtype = typeData?.subtype ?? '';
        const swarm = typeData?.swarm ?? '';
        const custom = typeData?.custom ?? '';

        const raceData = details.race;
        const raceName = raceData?.name ?? (typeof raceData === 'string' ? raceData : '');

        const typeLabel = this.#formatLabel(rawType, cfg?.creatureTypes);
        const raceLabel = raceName ? (raceName.charAt(0).toUpperCase() + raceName.slice(1)) : '';

        let fullLabel = '';
        if (swarm) {
            const formattedSwarm = this.#formatLabel(swarm, cfg?.actorSizes);
            const swarmSizeLabel = (formattedSwarm && formattedSwarm.length > 0) ? formattedSwarm : swarm;
            fullLabel = `Swarm of ${swarmSizeLabel} ${typeLabel ? typeLabel : 'Creature'}s`;
        } else if (raceLabel && rawType && raceLabel !== typeLabel) {
            fullLabel = `${sizeLabel} ${typeLabel} (${raceLabel})`;
        } else if (raceLabel && !rawType) {
            fullLabel = `${sizeLabel} ${raceLabel}`;
        } else if (subtype && typeLabel) {
            fullLabel = `${sizeLabel} ${typeLabel} (${subtype})`;
        } else if (custom) {
            fullLabel = `${sizeLabel} ${custom}`;
        } else if (typeLabel) {
            fullLabel = `${sizeLabel} ${typeLabel}`;
        } else {
            fullLabel = `${sizeLabel} Creature`;
        }

        return {
            fullLabel: fullLabel.trim(),
            size: sizeLabel,
            type: typeLabel ? typeLabel : (raceLabel ? raceLabel : 'Creature'),
            subtype: subtype ? subtype : raceName,
            alignment,
            crLabel
        };
    }

    #extractArmorClass(actor, cfg = CONFIG?.DND5E) {
        const acData = actor?.system?.attributes?.ac ?? {};
        const value = acData.value ?? 10;
        const calc = acData.calc ?? 'default';
        const formula = acData.formula ?? '';
        const shield = acData.shield ?? 0;

        let label = '';
        const secondaries = [];
        if (calc && calc !== 'default') {
            const calcLabel = this.#formatLabel(calc, cfg?.armorClasses);
            label = calcLabel;
            secondaries.push(calcLabel);
        } else if (formula) {
            label = formula;
            secondaries.push(formula);
        }

        if (shield > 0) {
            const shieldText = `+${shield} Shield`;
            label = label ? `${label} (${shieldText})` : shieldText;
            secondaries.push(shieldText);
        }

        return {
            value,
            label,
            calc,
            shield,
            secondaries
        };
    }

    #extractMovement(actor, token = null) {
        const mov = actor?.system?.attributes?.movement ?? {};
        const units = mov.units ?? 'ft';
        const walk = mov.walk ?? 0;
        const fly = mov.fly ?? 0;
        const swim = mov.swim ?? 0;
        const climb = mov.climb ?? 0;
        const burrow = mov.burrow ?? 0;
        const hover = Boolean(mov.hover);
        const special = mov.special ?? '';

        const primary = `${walk} ${units}`;
        const secondaries = [];
        const speeds = [
            { type: 'walk', label: 'Walk', value: walk, text: `${walk} ${units}`, icon: 'fas fa-walking' }
        ];

        if (fly > 0) {
            const hoverText = hover ? ' (hover)' : '';
            const flyText = `${fly} ${units}${hoverText}`;
            secondaries.push(`Fly ${flyText}`);
            speeds.push({ type: 'fly', label: 'Fly', value: fly, text: flyText, icon: 'fas fa-feather-alt', hover });
        }
        if (swim > 0) {
            secondaries.push(`Swim ${swim} ${units}`);
            speeds.push({ type: 'swim', label: 'Swim', value: swim, text: `${swim} ${units}`, icon: 'fas fa-water' });
        }
        if (climb > 0) {
            secondaries.push(`Climb ${climb} ${units}`);
            speeds.push({ type: 'climb', label: 'Climb', value: climb, text: `${climb} ${units}`, icon: 'fas fa-mountain' });
        }
        if (burrow > 0) {
            secondaries.push(`Burrow ${burrow} ${units}`);
            speeds.push({ type: 'burrow', label: 'Burrow', value: burrow, text: `${burrow} ${units}`, icon: 'fas fa-shovel' });
        }
        if (typeof special === 'string') {
            const specialParts = special.split(';').map(s => s.trim()).filter(Boolean);
            for (const part of specialParts) {
                secondaries.push(part);
            }
        }

        const secondary = secondaries.join(', ');
        const full = secondaries.length > 0 ? `${primary}, ${secondary}` : primary;

        const turnMovement = CombatMovementTracker.getMovementThisTurn(token, actor);
        const movedLabel = turnMovement.inCombat
            ? `${turnMovement.distance} ${turnMovement.units} ${localize('BAD.page3.moved', 'moved')}`
            : '';

        return {
            primary,
            secondary,
            secondaries,
            full,
            speeds,
            units,
            inCombat: turnMovement.inCombat,
            showMoved: turnMovement.inCombat,
            movedDistance: turnMovement.distance,
            movedLabel
        };
    }

    #extractTraitList(traitData, typeMap = CONFIG?.DND5E?.damageTypes, bypassMap = CONFIG?.DND5E?.physicalWeaponBypasses) {
        if (!traitData) return [];
        const result = [];
        const values = toSet(traitData.value);
        const bypasses = toSet(traitData.bypasses);

        let bypassSuffix = '';
        if (bypasses.size > 0) {
            const bypassLabels = Array.from(bypasses, b => this.#formatLabel(b, bypassMap));
            bypassSuffix = ` (non-${bypassLabels.join('/')})`;
        }

        for (const val of values) {
            if (!val) continue;
            const label = this.#formatLabel(val, typeMap);
            const isPhysical = PHYSICAL_DAMAGE_TYPES.has(val);
            if (isPhysical && bypassSuffix) {
                result.push(`${label}${bypassSuffix}`);
            } else {
                result.push(label);
            }
        }

        const customTrait = typeof traitData.custom === 'string' ? traitData.custom.trim() : '';
        if (customTrait) {
            result.push(customTrait);
        }

        return result;
    }

    #extractConditionImmunities(ciData, cfg = CONFIG?.DND5E) {
        if (!ciData) return [];
        const result = [];
        const values = toSet(ciData.value);

        for (const val of values) {
            if (!val) continue;
            let label = this.#formatLabel(val, cfg?.conditionTypes);
            if (!label && CONFIG?.statusEffects) {
                const effect = CONFIG.statusEffects.find(e => e.id === val);
                if (effect?.name) label = localize(effect.name, effect.name);
            }
            result.push((label && label.length > 0 ? label : null) ?? val);
        }

        const customCI = typeof ciData.custom === 'string' ? ciData.custom.trim() : '';
        if (customCI) {
            result.push(customCI);
        }

        return result;
    }

    #extractLanguages(langData, cfg = CONFIG?.DND5E, extraComm = null) {
        if (!langData && !extraComm) return [];
        const result = [];
        const units = langData?.units ?? extraComm?.units ?? 'ft';
        const values = Array.from(toSet(langData?.value));

        const hasAll = values.some(v => typeof v === 'string' && (v.trim().toLowerCase() === 'all' || v.trim().toLowerCase() === 'alllanguages'));

        if (hasAll) {
            result.push('All');
        } else {
            for (const val of values) {
                if (!val) continue;
                const label = this.#formatLabel(val, cfg?.languages);
                result.push(label);
            }
        }

        // Custom Languages (semicolon-separated)
        if (typeof langData?.custom === 'string') {
            const customParts = langData.custom.split(';').map(s => s.trim()).filter(Boolean);
            for (const part of customParts) {
                const isCustomAll = part.toLowerCase() === 'all' || part.toLowerCase() === 'all languages';
                if (isCustomAll) {
                    if (!result.includes('All')) {
                        result.unshift('All');
                    }
                } else if (!result.includes(part)) {
                    result.push(part);
                }
            }
        }

        // Special Communication (semicolon-separated)
        const specialData = langData?.special;
        if (specialData) {
            const list = Array.isArray(specialData) || specialData instanceof Set ? specialData : [specialData];
            for (const item of list) {
                const parts = typeof item === 'string' ? item.split(';').map(s => s.trim()).filter(Boolean) : [];
                for (const part of parts) {
                    if (!result.includes(part)) result.push(part);
                }
            }
        }

        // Communication / Ranged Communication (from langData.communication or extraComm)
        const commSources = [langData?.communication, extraComm].filter(Boolean);
        for (const commData of commSources) {
            if (typeof commData === 'string') {
                const commParts = commData.split(';').map(s => s.trim()).filter(Boolean);
                for (const part of commParts) {
                    if (!result.includes(part)) {
                        result.push(part);
                    }
                }
            } else if (commData && typeof commData === 'object') {
                for (const [commKey, commVal] of Object.entries(commData)) {
                    if (commKey === 'units' || commVal == null || commVal === false) continue;
                    const commLabel = this.#formatLabel(commKey, cfg?.communication ?? cfg?.languages);
                    if (Number.isFinite(commVal) && commVal > 0) {
                        const str = `${commLabel} ${commVal} ${units}`;
                        if (!result.includes(str)) result.push(str);
                    } else if (typeof commVal === 'object' && commVal !== null) {
                        const dist = commVal.value ?? commVal.range ?? commVal.distance;
                        const distUnits = commVal.units ?? units;
                        if (dist && Number(dist) > 0) {
                            const str = `${commLabel} ${dist} ${distUnits}`;
                            if (!result.includes(str)) result.push(str);
                        } else if (typeof commVal.custom === 'string' && commVal.custom.trim()) {
                            if (!result.includes(commVal.custom.trim())) result.push(commVal.custom.trim());
                        }
                    } else if (typeof commVal === 'string' && commVal.trim().length > 0) {
                        const str = !Number.isFinite(Number(commVal)) ? `${commLabel}: ${commVal.trim()}` : `${commLabel} ${commVal.trim()} ${units}`;
                        if (!result.includes(str)) result.push(str);
                    }
                }
            }
        }

        // Ranged Communication from langData.ranges if present
        if (langData?.ranges && typeof langData.ranges === 'object') {
            for (const [rangeKey, rangeVal] of Object.entries(langData.ranges)) {
                if (Number.isFinite(rangeVal) && rangeVal > 0) {
                    const rangeLabel = this.#formatLabel(rangeKey, cfg?.communication ?? cfg?.languages);
                    const str = `${rangeLabel} ${rangeVal} ${units}`;
                    if (!result.includes(str)) result.push(str);
                }
            }
        }

        return result;
    }

    /**
     * Extract senses according to D&D 5e v4.x baseline schema.
     * @param {Object} sensesData
     * @param {Object} [cfg]
     * @returns {string[]}
     */
    extractSenses(sensesData, cfg = CONFIG?.DND5E) {
        if (!sensesData) return [];
        const result = [];
        const units = sensesData.units ?? 'ft';
        const defaultSenseKeys = ['darkvision', 'blindsight', 'tremorsense', 'truesight'];
        const configuredKeys = cfg?.senses ? Object.keys(cfg.senses) : [];
        const senseKeys = [...new Set([...defaultSenseKeys, ...configuredKeys])];

        for (const s of senseKeys) {
            const val = sensesData[s];
            if (val && Number(val) > 0) {
                const label = this.formatSenseLabel(s, cfg?.senses);
                result.push(`${label} ${val} ${units}`);
            }
        }
        const special = typeof sensesData.special === 'string' ? sensesData.special.trim() : '';
        if (special) {
            result.push(special);
        }
        return result;
    }

    /**
     * Format a sense key label using the D&D 5e senses configuration map.
     * @param {string} key
     * @param {Object} [sensesMap]
     * @returns {string}
     */
    formatSenseLabel(key, sensesMap = CONFIG?.DND5E?.senses) {
        const formatted = this.#formatLabel(key, sensesMap);
        return (formatted && formatted.length > 0 ? formatted : null) ?? (key.charAt(0).toUpperCase() + key.slice(1));
    }

    // #endregion

    // #region System Specific Data Extractors & Schema Helpers

    /**
     * Validate if an object is an Item Document.
     * @param {Object} doc
     * @returns {boolean}
     */
    #isItemDocument(doc) {
        return doc instanceof Item;
    }

    /**
     * Extract the spell document from an activity or item reference.
     * @param {Object} obj
     * @returns {Item|null}
     */
    #extractItemSpell(obj) {
        if (!obj) return null;
        if (obj.linkedAction !== undefined) return obj.linkedAction;
        const spell = obj.spell;
        return (this.#isItemDocument(spell) || spell?.type === 'spell') ? spell : null;
    }

    /**
     * Resolve the underlying root spell document for a given activity or linked action.
     * @param {Object} sub Subaction or activity
     * @param {Item} [parentItem] Parent item document
     * @returns {Item|Object|null}
     */
    resolveRootSpellDocument(sub, parentItem) {
        if (!sub) return null;

        let doc = sub.linkedAction;
        const activity = sub.originalActivity;
        if (!doc && activity && activity.type === 'cast') {
            const actId = activity.id;
            const parentItemId = activity.item?.id ?? sub.originalItem?.id ?? parentItem?.id;
            const fullKey = parentItemId && actId ? `${parentItemId}.${actId}` : null;
            if (fullKey) {
                doc = this.#cachedForMap.get(fullKey)
                    ?? this.#actor?.items?.find?.(i => {
                        const cf = i.flags?.dnd5e?.cachedFor ?? i.getFlag?.('dnd5e', 'cachedFor');
                        return this.#normalizeCachedForKey(cf) === fullKey;
                    });
            }
            if (!doc) {
                doc = this.#extractItemSpell(activity);
            }
            if (!doc) {
                const uuid = activity.spell?.uuid ?? (activity.spell?.startsWith?.('Compendium.') ? activity.spell : null);
                if (uuid) {
                    doc = this.fromUuidSync(uuid);
                }
            }
        }

        const maxDepth = 5;
        let depth = 0;
        while (doc && depth < maxDepth) {
            const nextDoc = this.#extractItemSpell(doc);
            if (nextDoc && nextDoc !== doc) {
                doc = nextDoc;
                depth++;
            } else {
                break;
            }
        }

        if (doc && (doc.type === 'spell' || doc.type === 'cast' || doc.spell)) return doc;

        if (activity?.type === 'cast') {
            if (activity.spell && !this.#isItemDocument(activity.spell)) {
                return activity.spell;
            }
            return activity.spell ?? null;
        }

        const origItem = sub.originalItem ?? parentItem;
        if (origItem?.type === 'spell') {
            return origItem;
        }

        return null;
    }

    /**
     * Resolve linked action document for a D&D 5e Activity.
     * @param {Activity} activity
     * @param {Actor} [actor]
     * @param {Item} [item]
     * @returns {Promise<Document|Object|null>}
     */
    async #resolveActivityLinkedAction(activity, actor, item = null) {
        if (activity.type !== 'cast') {
            return null;
        }

        const actId = activity.id;
        const parentItemId = activity.item?.id ?? item?.id;
        const fullKey = parentItemId && actId ? `${parentItemId}.${actId}` : null;

        if (fullKey && this.#cachedForMap.has(fullKey)) {
            return this.#cachedForMap.get(fullKey);
        }

        if (actor && fullKey) {
            const cached = actor.items?.find?.(i => {
                const cf = i.flags?.dnd5e?.cachedFor ?? i.getFlag?.('dnd5e', 'cachedFor');
                return this.#normalizeCachedForKey(cf) === fullKey;
            });
            if (cached) return cached;
        }

        const uuid = activity.spell?.uuid ?? (activity.spell?.startsWith?.('Compendium.') ? activity.spell : null);
        if (uuid) {
            if (this.#resolvedSpellCache.has(uuid)) {
                return this.#resolvedSpellCache.get(uuid);
            }
            const doc = this.fromUuidSync(uuid) ?? await this.fromUuid(uuid);
            if (doc) {
                this.#resolvedSpellCache.set(uuid, doc);
                return doc;
            }
        }
        if (this.#isItemDocument(activity.spell) || activity.spell?.system) {
            return activity.spell;
        }
        return activity.spell ?? null;
    }

    /**
     * Get spell component TabRef objects required by a document.
     * @param {Document} doc
     * @returns {TabRef[]}
     */
    #getComponentTabs(doc) {
        return this.filterManager.getComponentTabs(doc);
    }

    /**
     * Collect unique right-side tabs across a collection of activities.
     * @param {Object[]} activities
     * @returns {TabRef[]}
     */
    #collectUniqueTabs(activities) {
        const uniqueTabsMap = new Map();
        for (const activity of activities) {
            for (const tab of activity.right ?? []) {
                if (tab?.path && !uniqueTabsMap.has(tab.path)) {
                    uniqueTabsMap.set(tab.path, tab);
                }
            }
        }
        return Array.from(uniqueTabsMap.values());
    }

    /**
     * Determine left-side item tab paths for an item.
     * @param {Item} item
     * @param {string} type
     * @param {Object[]} filteredActivities
     * @returns {string[]}
     */
    #getItemTabTypes(item, type, filteredActivities) {
        if (type === 'spell') {
            return ['spell', `level_${item.system.level ?? 0}`];
        }

        const hasLimited = this.#hasLimitedUses(item);
        const hasCastActivity = filteredActivities.some(act => act.originalActivity?.type === 'cast');
        const isItemCharges = (type === 'equipment' && hasLimited)
            || (LIMITED_ITEM_TYPES.has(type) && hasLimited && hasCastActivity);

        if (isItemCharges) {
            return ['spell', 'itemCharges'];
        }
        if (type === 'weapon' || type === 'equipment') {
            const subType = item.system.type?.value;
            return subType ? [type, subType] : [type];
        }
        return [type];
    }

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
     * @returns {Activities[]}
     */
    getItemActivities(item) {
        const activities = item.system?.activities;
        if (!activities) return [];
        if (activities.values) {
            return Array.from(activities.values());
        }
        if (Array.isArray(activities)) {
            return activities;
        }
        return Object.entries(activities).map(([id, act]) => {
            if (act && !act.id) act.id = id;
            return act;
        });
    }

    /**
     * Calculate available and maximum uses for an item.
     */
    calculateUses(item) {
        return this.#calculateUses(item);
    }

    /**
     * Internal implementation to calculate uses and charges for an item.
     * @param {Item} item
     * @returns {{available: number|null, max: number|null}}
     */
    #calculateUses(item) {
        const system = item?.system;
        if (!system) return { available: null, max: null };

        // 1. Limited Uses (standard item charges/uses, innate/monster spells, magic items, features)
        const limitedUses = this.#calculateLimitedUses(system.uses);
        if (limitedUses) {
            // Scale by quantity for consumables
            const quantity = system.quantity ?? 1;
            if (quantity > 1 && item.type === 'consumable') {
                limitedUses.available = limitedUses.available + (quantity - 1) * limitedUses.max;
                limitedUses.max = limitedUses.max * quantity;
            }
            return limitedUses;
        }

        // 2. Recharge feature/spell/monster power
        if (system.recharge?.value) {
            return {
                available: system.recharge.charged ? 1 : 0,
                max: 1
            };
        }

        // 3. Spells (without item-level limited uses -> spell slots)
        if (item.type === 'spell') {
            return this.#calculateSpellSlots(item);
        }

        // 4. Consumable Quantity (if no explicit charges, quantity is the uses)
        if (item.type === 'consumable') {
            return {
                available: system.quantity ?? 1,
                max: null
            };
        }

        // 5. Thrown Weapons (quantity is the uses)
        if (item.type === 'weapon' && this.getProperty(system.properties, 'thr') && !this.getProperty(system.properties, 'ret')) {
            return {
                available: system.quantity ?? 1,
                max: null
            };
        }

        return { available: null, max: null };
    }

    /**
     * Check if an item has limited uses (either at the item level or activity level).
     * @param {Item} item The item to check
     * @returns {boolean} True if the item has limited uses
     */
    #hasLimitedUses(item) {
        if (this.#calculateLimitedUses(item?.system?.uses)) return true;
        if (item?.system?.recharge?.value) return true;
        return this.getItemActivities(item)
            .some(activity => this.#calculateLimitedUses(activity?.uses));
    }

    /**
     * Parse and calculate limited uses configuration.
     * @param {Object} uses
     * @returns {{available: number|null, max: number|null}|null}
     */
    #calculateLimitedUses(uses) {
        if (!uses) return null;

        const rawMax = Number(uses.max);
        if (Number.isFinite(rawMax) && rawMax > 0) {
            const max = rawMax;
            const spent = uses.spent;
            const available = spent != null
                ? Math.max(0, max - spent)
                : (uses.value ?? max);
            return { available, max };
        }

        if (Number.isFinite(uses.value) && uses.value > 0) {
            const available = uses.value;
            const max = uses.max ?? null;
            return { available, max };
        }

        return null;
    }

    /**
     * Resolve target item reference using direct ID or relative UUID.
     * @param {string} targetId
     * @param {Item} item
     * @param {Actor} actor
     * @returns {Item|null}
     */
    #resolveTargetItem(targetId, item, actor) {
        if (!targetId) return null;
        return targetId.includes('.')
            ? (this.fromUuidSync(targetId, { relative: item })
               ?? this.fromUuidSync(targetId, { relative: actor })
               ?? this.fromUuidSync(targetId)
               ?? actor.items.get(targetId))
            : actor.items.get(targetId);
    }

    /**
     * Calculate available and maximum uses for a D&D 5e Activity.
     * @param {Activity} activity The activity instance
     * @param {Item} item The parent item
     * @param {Actor} [actor=this.#actor] The actor
     * @param {Map<string, number>} [ammoQuantities=this.#ammoQuantities] Pre-calculated ammunition quantities
     * @param {number} [highestAvailableSlot=this.#highestAvailableSlot] The highest available spell slot level on the actor
     * @returns {{available: number|null, max: number|null}} The uses count
     */
    #calculateActivityUses(activity, item, actor = this.#actor, ammoQuantities = this.#ammoQuantities, highestAvailableSlot = this.#highestAvailableSlot) {
        const targets = activity.consumption?.targets ?? [];
        
        // 1. If the activity has its own explicit limited uses
        const selfUses = this.#calculateLimitedUses(activity.uses);
        if (selfUses) return selfUses;
        
        // 2. Resolve based on consumption targets
        for (const target of targets) {
            if (target.type === 'activityUses') {
                // Consumes another activity's uses (or self if target is empty)
                const targetActivity = target.target ? item.system?.activities?.get?.(target.target) : activity;
                if (targetActivity) {
                    const actUses = this.#calculateLimitedUses(targetActivity.uses);
                    if (actUses) return actUses;
                }
            } else if (target.type === 'itemUses') {
                // Consumes the parent item's uses
                return this.#calculateUses(item);
            } else if (target.type === 'spellSlots') {
                // If the item itself has limited uses (innate spell, charges, monster 3/day), prioritize item uses over spell slots
                const itemUses = this.#calculateUses(item);
                if (itemUses.available !== null) {
                    return itemUses;
                }

                // If the spell is innate or at-will without limited uses, it is unlimited / at will
                if (INNATE_OR_ATWILL_METHODS.has(item.system?.method)) {
                    return { available: null, max: null };
                }

                // Otherwise, consumes actor spell slots
                const level = target.target ?? item.system?.level; // Fallback to spell's base level if target is empty (dynamic slots)
                return this.#getSpellSlotUses(actor, level, highestAvailableSlot);
            } else if (target.type === 'item' || target.type === 'material') {
                // Consumes quantity of another item (e.g. ammunition / components) or charges of another item
                const targetItem = this.#resolveTargetItem(target.target, item, actor);

                if (targetItem) {
                    const consumed = target.value ?? 1;
                    if (target.type === 'item') {
                        // If the target item has its own limited uses (like a wand), use those
                        const uses = this.#calculateUses(targetItem);
                        if (uses.available !== null) {
                            return {
                                available: Math.floor(uses.available / consumed),
                                max: uses.max !== null ? Math.floor(uses.max / consumed) : null
                            };
                        }
                    }
                    // Otherwise, use its quantity (standard ammo/consumable/material)
                    const qty = targetItem.system?.quantity ?? 0;
                    return {
                        available: Math.floor(qty / consumed),
                        max: null
                    };
                }
            }
        }
        
        // 3. Fallback: Check parent item's uses (e.g. innate spell or magic item without explicit consumption targets)
        const parentItemUses = this.#calculateUses(item);
        if (parentItemUses.available !== null) {
            return parentItemUses;
        }

        // Fallback for weapons requiring ammunition if no explicit consumption target was resolved
        if (item.type === 'weapon' && item.system?.ammunition?.type) {
            return this.#calculateWeaponAmmunition(item, ammoQuantities);
        }

        return { available: null, max: null };
    }

    /**
     * Calculate spell slot uses (pact or standard) for a given slot level, including upcast logic.
     * @param {Actor} actor
     * @param {string|number} level
     * @param {number} highestAvailableSlot
     * @returns {{available: number|string|null, max: number|null, isUpcast?: boolean}}
     */
    #getSpellSlotUses(actor, level, highestAvailableSlot) {
        const actorSpells = actor?.system?.spells;
        const isPact = level === 'pact';
        const numLevel = Number(level);
        const lvl = isPact ? (actorSpells?.pact?.level ?? 0) : (Number.isFinite(numLevel) ? numLevel : 0);

        if (!isPact && lvl <= 0) return { available: null, max: null };

        const slot = isPact ? actorSpells?.pact : actorSpells?.[`spell${lvl}`];
        const available = slot?.value ?? 0;
        const max = slot?.max ?? 0;

        if (available > 0) {
            return { available, max };
        }
        if (highestAvailableSlot >= lvl) {
            return {
                available: localize('BAD.dnd5e.upcast', 'Upcast'),
                max: null,
                isUpcast: true
            };
        }
        return { available: 0, max };
    }

    /**
     * Calculate remaining spell slots for a spell item.
     * @param {Item} item
     * @param {Actor} [actor=this.#actor]
     * @param {number} [highestAvailableSlot=this.#highestAvailableSlot]
     * @returns {{available: number|string|null, max: number|null, isUpcast?: boolean}}
     */
    #calculateSpellSlots(item, actor = this.#actor, highestAvailableSlot = this.#highestAvailableSlot) {
        const system = item.system;
        const prepMode = system.method;
        const level = system.level ?? 0;
        
        if (prepMode === 'pact') {
            return this.#getSpellSlotUses(actor, 'pact', highestAvailableSlot);
        } else if (!INNATE_OR_ATWILL_METHODS.has(prepMode)) {
            return this.#getSpellSlotUses(actor, level, highestAvailableSlot);
        }
        return { available: null, max: null };
    }

    /**
     * Calculate available ammunition quantity for a weapon.
     * @param {Item} item
     * @param {Map<string, number>} ammoQuantities
     * @returns {{available: number, max: null}}
     */
    #calculateWeaponAmmunition(item, ammoQuantities) {
        const ammoType = item.system.ammunition?.type;
        const quantity = ammoQuantities.get(ammoType) ?? 0;
        return {
            available: quantity,
            max: null
        };
    }

    /**
     * Build map of ammunition quantities available on an actor.
     * @param {Actor} actor
     * @returns {Map<string, number>}
     */
    #getAmmoQuantities(actor) {
        const ammoQuantities = new Map();
        for (const i of actor?.items ?? []) {
            if (i.type === 'consumable' && i.system.type?.value === 'ammo') {
                const subtype = i.system.type.subtype;
                if (subtype) {
                    const qty = i.system.quantity ?? 0;
                    ammoQuantities.set(subtype, (ammoQuantities.get(subtype) ?? 0) + qty);
                }
            }
        }
        return ammoQuantities;
    }

    /**
     * Find highest available spell slot level on an actor.
     * @param {Actor} actor
     * @returns {number}
     */
    #getHighestAvailableSpellSlot(actor) {
        const actorSpells = actor?.system?.spells;
        if (!actorSpells) return 0;

        let highest = 0;
        for (let i = 9; i >= 1; i--) {
            if (actorSpells[`spell${i}`]?.value > 0) {
                highest = i;
                break;
            }
        }
        if (actorSpells.pact?.value > 0) {
            highest = Math.max(highest, actorSpells.pact.level ?? 0);
        }
        return highest;
    }

    /**
     * Normalize activation type string.
     * @param {*} type
     * @returns {string|null}
     */
    #normalizeActivationType(type) {
        if (!type || type === true || type === 'none') return null;
        const str = String(type).trim().toLowerCase();
        return str.length > 0 && str !== 'none' ? str : null;
    }

    /**
     * Extract activation type for a D&D 5e activity.
     * @param {Activity} activity
     * @param {Item} item
     * @param {Item|null} [linkedAction=null]
     * @returns {string}
     */
    #getActivityActivationType(activity, item, linkedAction = null) {
        const actOverride = Boolean(activity.activation?.override ?? activity.system?.activation?.override);
        if (actOverride) {
            const overrideType = this.#normalizeActivationType(activity.activation?.type ?? activity.system?.activation?.type);
            if (overrideType) return overrideType;
        }

        const spellDoc = linkedAction ?? this.resolveRootSpellDocument({ originalActivity: activity, linkedAction: activity.spell });
        if (spellDoc) {
            const rawType = spellDoc.system?.activation?.type ?? spellDoc.activation?.type;
            const spellType = this.#normalizeActivationType(rawType);
            if (spellType) return spellType;
        }

        return this.#normalizeActivationType(item.system?.activation?.type)
            ?? this.#normalizeActivationType(activity.activation?.type ?? activity.system?.activation?.type)
            ?? 'none';
    }

    /**
     * Open the sheet or edit dialog for a DnD5e action, activity, or item.
     * Handles opening the DnD5e Activity configuration sheet directly for activities.
     * @param {Object} action
     */
    openEditSheet(action) {
        const activity = action?.originalActivity;
        if (activity) {
            if (activity.sheet?.render) {
                activity.sheet.render(true);
                return;
            }
            if (activity.item?.sheet?.render) {
                activity.item.sheet.render(true, { subtab: "activities", activityId: activity.id });
                return;
            }
        }
        const item = action?.originalItem;
        if (item?.sheet?.render) {
            item.sheet.render(true);
        }
    }

    // #endregion

    // #region Favorites Integration

    /**
     * Whether this system adapter supports native favoriting.
     * @returns {boolean}
     */
    hasFavorites() {
        return true;
    }

    /**
     * Check if an item is favorited on the actor using DnD5e logic.
     *
     * @param {Object} actor Actor document
     * @param {Item} item Item document
     * @returns {boolean} True if favorited in dnd5e
     */
    isFavorite(actor, item) {
        if (!item) return false;

        // 1. Direct system.favorite property (dnd5e 3.x+)
        if (item.system && 'favorite' in item.system) {
            return Boolean(item.system.favorite);
        }

        // 2. Legacy / flag-based favorite (dnd5e 2.x)
        if (item.flags?.dnd5e?.favorite !== undefined) {
            return Boolean(item.flags.dnd5e.favorite);
        }

        // 3. Actor system.favorites set/array (dnd5e 3.x+ actor favorites collection)
        if (actor?.system?.favorites?.some) {
            const relUuid = item.getRelativeUUID?.(actor) ?? null;
            return actor.system.favorites.some(f => f?.id === item.id || (relUuid && f?.id === relUuid) || f?.id === item.uuid);
        }

        return false;
    }

    /**
     * Set or unset favorite status on an item in DnD5e.
     *
     * @param {Object} actor Actor document
     * @param {Item} item Item document
     * @param {boolean} favorite True to favorite, false to unfavorite
     * @returns {Promise<any>|null} Result of update
     */
    async setFavorite(actor, item, favorite) {
        if (!item) return null;
        const isFav = Boolean(favorite);

        // 1. If item has system.favorite field (modern dnd5e 3.x+)
        if (item.system && 'favorite' in item.system && item.update) {
            return await item.update({ 'system.favorite': isFav });
        }

        // 2. If actor has addFavorite / removeFavorite methods (dnd5e 3.x actor methods)
        if (actor?.system?.addFavorite && actor.system.removeFavorite) {
            const uuid = item.getRelativeUUID?.(actor) ?? item.id;
            if (isFav) {
                return await actor.system.addFavorite({ id: uuid, type: 'item' });
            } else {
                return await actor.system.removeFavorite(uuid);
            }
        }

        // 3. Fallback to updating item flags
        if (item.update) {
            return await item.update({ 'flags.dnd5e.favorite': isFav });
        }

        return null;
    }

    /**
     * Get the default HUD categorization structure for D&D 5e.
     * Includes standard fantasy categories plus Base Ability Checks and Skill Checks / Saves with ability subcategories.
     * @param {Object} [overrides={}] Generic category overrides
     * @returns {Object[]} Array of category definition objects
     */
    getDefaultCategories(overrides = {}) {
        const categories = super.getDefaultCategories(overrides);
        const dnd5eCategories = [
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
            },
            {
                id: 'cat_tool_checks',
                name: 'Tools',
                expression: `action.type === "tool"`,
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

        for (const cat of dnd5eCategories) {
            const key = cat.id.replace('cat_', '');
            const catOverride = overrides[cat.id] ?? overrides[key] ?? {};
            categories.push(this.mergeObject(cat, catOverride, { inplace: false, overwrite: true }));
        }

        return categories;
    }

    // #endregion

    // #region Tooltip Item Summary

    /**
     * Build a rich item summary object for D&D 5e tooltips.
     * @param {Object} action The HUD action instance
     * @param {Object} [item] The original item document
     * @param {Object} [actor] The owning actor document
     * @returns {{title: string, subtitle?: string, img?: string, properties?: Array<string|{label?: string, value: string}>, description?: string}|null}
     */
    async getItemSummary(action, item = action?.originalItem, actor = null) {
        if (!action && !item) return null;

        const isPage2Check = action?.page === 2;
        const isCoreCheck = CORE_CHECK_TYPES.has(action?.type) && (isPage2Check || !action?.originalItem);
        if (isCoreCheck) {
            return this.#getCheckSummary(action, actor);
        }

        const targetItem = item ?? action?.originalItem ?? action;
        const activity = action?.originalActivity;
        const linkedItem = action?.linkedAction
            ?? this.resolveRootSpellDocument(action, targetItem)
            ?? activity?.cachedSpell
            ?? null;
        const effectiveItem = linkedItem ?? targetItem;
        const effectiveSystem = effectiveItem?.system ?? {};
        const system = targetItem?.system ?? {};

        const title = action?.name ?? effectiveItem?.name ?? '';
        const img = (action?.img && action.img.length > 0) ? action.img : (effectiveItem?.img ?? '');
        const properties = [];

        // 1. Subtitle & Classification
        let subtitle = '';
        const type = effectiveItem?.type ?? '';
        const activation = activity?.labels?.activation ?? effectiveItem?.labels?.activation ?? '';

        if (type === 'weapon') {
            const weaponType = effectiveSystem.type?.label ?? CONFIG?.DND5E?.weaponTypes?.[effectiveSystem.type?.value] ?? 'Weapon';
            subtitle = `${weaponType}${activation ? ' • ' + activation : ''}`;
        } else if (type === 'spell') {
            const levelLabel = effectiveSystem.level === 0 ? localize('DND5E.SpellCantrip', 'Cantrip') : (CONFIG?.DND5E?.spellLevels?.[effectiveSystem.level] ?? `${effectiveSystem.level}th Level`);
            const schoolLabel = CONFIG?.DND5E?.spellSchools?.[effectiveSystem.school]?.label ?? effectiveSystem.school ?? '';
            subtitle = `${levelLabel} ${schoolLabel}${activation ? ' • ' + activation : ''}`.trim();
        } else if (type === 'feat') {
            const featType = effectiveSystem.type?.label ?? 'Feature';
            subtitle = `${featType}${activation ? ' • ' + activation : ''}`;
        } else if (type === 'consumable') {
            const consumableType = effectiveSystem.type?.label ?? 'Consumable';
            subtitle = `${consumableType}${activation ? ' • ' + activation : ''}`;
        } else if (type) {
            const formattedType = type.charAt(0).toUpperCase() + type.slice(1);
            subtitle = `${formattedType}${activation ? ' • ' + activation : ''}`;
        }

        // 2. Attack / To-Hit Modifier
        const toHit = activity?.labels?.toHit ?? effectiveItem?.labels?.toHit;
        if (toHit) {
            properties.push({ label: 'Attack', value: toHit });
        }

        // 3. Damage / Healing Formula
        const damage = activity?.labels?.damage ?? effectiveItem?.labels?.damage;
        if (damage) {
            properties.push({ label: 'Damage', value: damage });
        }

        // 4. Range / Area
        const range = activity?.labels?.range ?? effectiveItem?.labels?.range;
        if (range) {
            properties.push({ label: 'Range', value: range });
        }

        // 5. Saving Throw DC
        const save = activity?.labels?.save ?? effectiveItem?.labels?.save;
        if (save) {
            properties.push({ label: 'Save', value: save });
        }

        // 6. Duration & Concentration
        const duration = activity?.labels?.duration ?? effectiveItem?.labels?.duration;
        if (duration) {
            properties.push({ label: 'Duration', value: duration });
        }
        if (effectiveSystem.properties?.has?.('concentration') || system.properties?.has?.('concentration')) {
            properties.push({ value: 'Concentration' });
        }

        // 7. Ritual & Components (Spells)
        if (effectiveSystem.properties?.has?.('ritual') || system.properties?.has?.('ritual')) {
            properties.push({ value: 'Ritual' });
        }
        const components = effectiveItem?.labels?.components?.vsm ?? effectiveItem?.labels?.components?.all;
        if (components) {
            properties.push({ label: 'Components', value: components });
        }

        // 8. Physical Item Properties (e.g. Versatile, Finesse, Thrown)
        const itemProps = toSet(effectiveSystem.properties ?? system.properties);
        for (const prop of itemProps) {
            if (EXCLUDED_SUMMARY_PROPERTIES.has(prop)) continue;
            const propLabel = CONFIG?.DND5E?.itemProperties?.[prop]?.label ?? prop;
            properties.push({ value: propLabel });
        }

        // 9. Uses / Quantity
        if (action?.uses?.available != null) {
            const usesStr = `${action.uses.available}${action.uses.max ? ` / ${action.uses.max}` : ''}`;
            properties.push({ label: 'Uses', value: usesStr });
        } else {
            const quantity = effectiveSystem.quantity ?? system.quantity;
            if (quantity && quantity > 1) {
                properties.push({ label: 'Quantity', value: String(quantity) });
            }
        }

        // 10. Recharge
        const recharge = activity?.labels?.recharge ?? effectiveItem?.labels?.recharge;
        if (recharge) {
            properties.push({ label: 'Recharge', value: recharge });
        }

        // 11. Description: prioritize activity-specific description, then linked spell/item description, then parent item description fallback
        const resolveDescription = (desc) => {
            if (!desc) return null;
            const rawText = typeof desc === 'string' ? desc : (desc.value ?? desc.chatFlavor ?? desc.chat);
            const text = typeof rawText === 'string' ? rawText.trim() : '';
            return text || null;
        };

        let description = resolveDescription(activity?.description)
            ?? resolveDescription(linkedItem?.system?.description)
            ?? resolveDescription(system.description)
            ?? '';

        if (description) {
            const descItem = linkedItem ?? targetItem;
            const rollData = activity?.getRollData?.() ?? descItem?.getRollData?.() ?? actor?.getRollData?.() ?? {};
            description = await this.enrichHTML(description, {
                rollData,
                relativeTo: descItem ?? actor,
                secrets: false,
                async: true
            });
        }

        return {
            title,
            subtitle,
            img,
            properties,
            description
        };
    }

    /**
     * Helper to build check/save/skill summary for Page 2 actions.
     * @param {Object} action
     * @param {Object} actor
     * @returns {Object}
     */
    #getCheckSummary(action, actor) {
        const title = action.name ?? '';
        const img = action.img ?? '';
        const properties = [];
        const headerTags = [];
        let subtitle = '';

        if (action.type === 'ability') {
            const ability = action.extra?.ability ?? action.id.replace(/^ability-/, '');
            const ablData = actor?.system?.abilities?.[ability];
            if (ablData?.value !== undefined) {
                headerTags.push({ label: 'Score', value: String(ablData.value) });
            }
            subtitle = 'Ability Check / Saving Throw';
            if (ablData) {
                const mod = ablData.mod ?? 0;
                const rawSave = ablData.save;
                const saveMod = Number.isFinite(rawSave) ? rawSave : (rawSave?.value ?? rawSave?.total ?? ablData.mod ?? 0);

                const checkRow = ['Check:', { label: 'Modifier', value: mod >= 0 ? `+${mod}` : `${mod}` }];
                const isCheckProficient = Boolean(ablData.checkProf?.hasProficiency || ablData.check?.proficient);
                if (isCheckProficient) checkRow.push({ value: 'Proficient' });
                properties.push(checkRow);

                const saveRow = ['Save:', { label: 'Modifier', value: saveMod >= 0 ? `+${saveMod}` : `${saveMod}` }];
                const isSaveProficient = Boolean(ablData.saveProf?.hasProficiency || rawSave?.proficient || ablData.proficient);
                if (isSaveProficient) saveRow.push({ value: 'Proficient' });
                properties.push(saveRow);
            }
        } else if (action.type === 'save') {
            const ability = action.extra?.ability ?? action.id.replace(/^save-/, '');
            const ablData = actor?.system?.abilities?.[ability];
            subtitle = 'Saving Throw';
            if (ablData) {
                const rawSave = ablData.save;
                const saveMod = Number.isFinite(rawSave) ? rawSave : (rawSave?.value ?? rawSave?.total ?? ablData.mod ?? 0);
                properties.push({ label: 'Modifier', value: saveMod >= 0 ? `+${saveMod}` : `${saveMod}` });
                const isProficient = Boolean(ablData.saveProf?.hasProficiency || rawSave?.proficient || ablData.proficient);
                if (isProficient) properties.push({ value: 'Proficient' });
            }
        } else if (action.type === 'skill') {
            const skillId = action.id.replace(/^skill-/, '');
            const skillData = actor?.system?.skills?.[skillId];
            const abl = skillData?.ability ?? '';
            const ablLabel = CONFIG?.DND5E?.abilities?.[abl]?.label ?? abl.toUpperCase();
            subtitle = `Skill Check (${ablLabel})`;
            if (skillData) {
                const total = skillData.total ?? skillData.mod ?? 0;
                properties.push({ label: 'Modifier', value: total >= 0 ? `+${total}` : `${total}` });
                if (skillData.prof?.hasProficiency) properties.push({ value: 'Proficient' });
            }
        } else if (action.type === 'tool') {
            const toolId = action.extra?.toolId ?? action.id.replace(/^tool-/, '');
            const toolData = actor?.system?.tools?.[toolId];
            const abl = toolData?.ability ?? action.extra?.ability ?? '';
            const ablLabel = CONFIG?.DND5E?.abilities?.[abl]?.label ?? (abl ? abl.toUpperCase() : '');
            subtitle = ablLabel ? `Tool Check (${ablLabel})` : 'Tool Check';
            if (toolData) {
                const total = toolData.total ?? toolData.mod ?? 0;
                properties.push({ label: 'Modifier', value: total >= 0 ? `+${total}` : `${total}` });
                if (toolData.prof?.hasProficiency || (Number.isFinite(toolData.value) && toolData.value > 0)) {
                    properties.push({ value: 'Proficient' });
                }
            }
        } else {
            const ability = action.extra?.ability ?? action.id.replace(/^(check|abilityCheck|ability)-/, '');
            const ablData = actor?.system?.abilities?.[ability];
            if (ablData?.value !== undefined) {
                headerTags.push({ label: 'Score', value: String(ablData.value) });
            }
            subtitle = 'Ability Check';
            if (ablData) {
                const mod = ablData.mod ?? 0;
                properties.push({ label: 'Modifier', value: mod >= 0 ? `+${mod}` : `${mod}` });
            }
        }

        return {
            title,
            subtitle,
            img,
            headerTags,
            properties,
            description: ''
        };
    }

    // #endregion

    // #region Auto-Banning by Status Conditions

    /**
     * Extract active status condition IDs from an actor.
     * Inspects actor.statuses and active, non-disabled ActiveEffects.
     * @param {Actor} actor
     * @returns {Set<string>}
     */
    getActorStatuses(actor) {
        if (!actor) return new Set();
        const statuses = new Set();

        if (actor.statuses) {
            for (const s of actor.statuses) statuses.add(s);
        }

        if (actor.effects) {
            for (const effect of actor.effects) {
                if (effect.disabled || effect.isSuppressed) continue;
                if (effect.statuses) {
                    for (const s of effect.statuses) statuses.add(s);
                }
                const statusId = effect.getFlag?.('core', 'statusId') ?? effect.flags?.core?.statusId;
                if (statusId) statuses.add(statusId);
            }
        }
        return statuses;
    }

    /**
     * Update active tabs and filter state for D&D 5e (auto-banning verbal/somatic spell components).
     * @param {Actor} actor
     * @param {HUDTabColumn} [tabColumn]
     */
    updateTabs(actor, tabColumn = null) {
        this.syncActorAutoBans(actor, tabColumn);
    }

    /**
     * Record manual tab toggle for D&D 5e (tracking manual unbanning of vocal/somatic components).
     * @param {Actor} actor
     * @param {string} parentId
     * @param {string} subId
     * @param {boolean} isActive
     */
    recordManualTabToggle(actor, parentId, subId, isActive) {
        if (!actor || parentId !== 'components' || !SPELL_COMPONENT_KEYS.has(subId)) return;
        const autoBanState = actor.getFlag?.(MODULE_ID, 'autoBanState') ?? {};
        const conditions = autoBanState.conditions ?? {};
        const manualUnbans = { ...(autoBanState.manualUnbans ?? {}) };

        // Only write to actor flag if this component actually has active conditions imposing an auto-ban or previous manual unbans
        const hasActiveConditions = Array.isArray(conditions[subId]) && conditions[subId].length > 0;
        if (!hasActiveConditions && !manualUnbans[subId]) {
            return;
        }

        manualUnbans[subId] = !isActive;

        if (actor.isOwner && actor.setFlag) {
            actor.setFlag(MODULE_ID, 'autoBanState', {
                conditions,
                manualUnbans
            }, { badInternal: true }).catch(err => {
                log.debug('Error setting autoBanState flag on manual toggle:', err);
            });
        }
    }

    /**
     * Synchronize auto-banned spell components (vocal / somatic) on an actor based on active status conditions.
     * @param {Actor} actor The actor to evaluate
     * @param {HUDTabColumn} [tabColumn] Right-side tab column if HUD is active
     */
    syncActorAutoBans(actor, tabColumn = null) {
        if (!actor || game.system?.id !== 'dnd5e') return;

        const config = game.settings.get(MODULE_ID, 'dnd5eAutoBanConditions');
        if (!config?.enabled) return;

        const activeStatuses = this.getActorStatuses(actor);
        const autoBanState = actor.getFlag?.(MODULE_ID, 'autoBanState') ?? {};
        const previousConditionsMap = autoBanState.conditions ?? {};
        const previousManualUnbans = autoBanState.manualUnbans ?? {};

        const updatedConditions = { ...previousConditionsMap };
        const updatedManualUnbans = { ...previousManualUnbans };

        const isInitialTabSync = Boolean(tabColumn && !tabColumn.autoBanInitialized);
        let changed = false;

        for (const comp of ['vocal', 'somatic']) {
            const conditionList = Array.isArray(config[comp]) ? config[comp] : [];
            const currentConditions = conditionList.filter(condId => activeStatuses.has(condId));
            const previousConditions = Array.isArray(previousConditionsMap[comp]) ? previousConditionsMap[comp] : [];
            const wasManualUnbanned = Boolean(previousManualUnbans[comp]);

            const hasNewCondition = currentConditions.some(condId => !previousConditions.includes(condId));
            const allConditionsLost = currentConditions.length === 0 && previousConditions.length > 0;
            const conditionsChanged = currentConditions.length !== previousConditions.length ||
                hasNewCondition ||
                previousConditions.some(condId => !currentConditions.includes(condId));

            if (hasNewCondition) {
                // A new status condition was gained -> automatically apply/re-apply ban and reset manual unban
                updatedManualUnbans[comp] = false;
                if (tabColumn) {
                    tabColumn.activeParents.add('components');
                    tabColumn.activeSubTypes.add(comp);
                }
            } else if (allConditionsLost) {
                // All status conditions for this component are cleared -> remove ban and reset manual unban
                updatedManualUnbans[comp] = false;
                if (tabColumn) {
                    tabColumn.activeSubTypes.delete(comp);
                    const remainingComp = ['vocal', 'somatic', 'material'].some(c => c !== comp && tabColumn.activeSubTypes.has(c));
                    if (!remainingComp) {
                        tabColumn.activeParents.delete('components');
                    }
                }
            } else if (isInitialTabSync) {
                // Initial sync for a new HUD tab column instance
                if (currentConditions.length > 0 && !wasManualUnbanned) {
                    tabColumn.activeParents.add('components');
                    tabColumn.activeSubTypes.add(comp);
                }
            }

            if (conditionsChanged) {
                updatedConditions[comp] = currentConditions;
                changed = true;
            }

            if (updatedManualUnbans[comp] !== wasManualUnbanned) {
                changed = true;
            }
        }

        if (tabColumn) {
            tabColumn.autoBanInitialized = true;
        }

        if (changed && actor.isOwner && actor.setFlag) {
            const effectReasons = this.getAutoBanEffectReasons(actor);
            actor.setFlag(MODULE_ID, 'autoBanState', {
                conditions: updatedConditions,
                manualUnbans: updatedManualUnbans,
                effectReasons
            }, { badInternal: true }).catch(err => {
                log.debug('Error setting autoBanState flag:', err);
            });
        }
    }

    /**
     * Resolve the localized display label for a status condition ID.
     * @param {string} condId
     * @returns {string}
     * @private
     */
    #getConditionLabel(condId) {
        const condConfig = CONFIG?.DND5E?.conditionTypes?.[condId];
        const condName = condConfig?.label ?? condConfig?.name ?? condConfig;
        const fallbackStatus = CONFIG?.statusEffects?.find?.(e => e.id === condId)?.name;
        const rawLabel = condName ?? fallbackStatus ?? (condId.charAt(0).toUpperCase() + condId.slice(1));
        return localize(rawLabel, rawLabel);
    }

    /**
     * Retrieve the active status effects and conditions causing automatic verbal and/or somatic spell component bans.
     * @param {Actor} actor The actor document to inspect
     * @returns {Record<'vocal'|'somatic', Array<{ name: string, statuses: string[], isDirectStatus: boolean }>>}
     */
    getAutoBanEffectReasons(actor) {
        const result = { vocal: [], somatic: [] };
        if (!actor || game.system?.id !== 'dnd5e') return result;

        const config = game.settings.get(MODULE_ID, 'dnd5eAutoBanConditions');
        if (!config?.enabled) return result;

        const activeStatuses = this.getActorStatuses(actor);

        // Gather all active, non-disabled, non-suppressed effects on actor
        const activeEffects = Array.from(actor.effects ?? []).filter(eff => !eff.disabled && !eff.isSuppressed);

        for (const comp of ['vocal', 'somatic']) {
            const conditionList = Array.isArray(config[comp]) ? config[comp] : [];
            const matchingConditions = conditionList.filter(condId => activeStatuses.has(condId));
            if (!matchingConditions.length) continue;

            const reasonsMap = new Map();
            const accountedConditions = new Set();

            // 1. Inspect ActiveEffects for matching status subcomponents
            for (const eff of activeEffects) {
                const matchedStatuses = [];
                for (const condId of matchingConditions) {
                    const hasStatus = eff.statuses?.has?.(condId) ||
                        (Array.isArray(eff.statuses) && eff.statuses.includes(condId)) ||
                        eff.getFlag?.('core', 'statusId') === condId ||
                        eff.flags?.core?.statusId === condId;

                    if (hasStatus) {
                        matchedStatuses.push(condId);
                        accountedConditions.add(condId);
                    }
                }

                if (matchedStatuses.length > 0) {
                    const effName = eff.name ?? eff.label ?? '';
                    const condLabel = this.#getConditionLabel(matchedStatuses[0]);
                    const isDirect = matchedStatuses.length === 1 && (
                        effName.toLowerCase() === matchedStatuses[0].toLowerCase() ||
                        effName.toLowerCase() === condLabel.toLowerCase()
                    );

                    const key = isDirect ? matchedStatuses[0] : effName;
                    if (reasonsMap.has(key)) {
                        const existing = reasonsMap.get(key);
                        for (const st of matchedStatuses) {
                            if (!existing.statuses.includes(st)) {
                                existing.statuses.push(st);
                            }
                        }
                    } else {
                        reasonsMap.set(key, {
                            name: isDirect ? condLabel : effName,
                            statuses: matchedStatuses,
                            isDirectStatus: isDirect
                        });
                    }
                }
            }

            // 2. Add any active matching condition that didn't have an ActiveEffect document
            for (const condId of matchingConditions) {
                if (!accountedConditions.has(condId)) {
                    const condLabel = this.#getConditionLabel(condId);
                    reasonsMap.set(condId, {
                        name: condLabel,
                        statuses: [condId],
                        isDirectStatus: true
                    });
                }
            }

            result[comp] = Array.from(reasonsMap.values());
        }

        return result;
    }

    /**
     * Get the enriched HTML content-link for a status condition ID, matching Foundry character sheets.
     * Resolves the condition's compendium journal reference and enriches via TextEditor into a clickable link.
     * @param {string} condId Condition key (e.g. 'petrified', 'silenced', 'grappled')
     * @param {string} [customLabel] Optional custom label override
     * @returns {Promise<string>} Enriched HTML content-link string
     */
    async enrichCondition(condId, customLabel = null) {
        const condConfig = CONFIG?.DND5E?.conditionTypes?.[condId];
        const fallbackStatus = CONFIG?.statusEffects?.find?.(e => e.id === condId);
        const ref = condConfig?.reference ?? fallbackStatus?.reference ?? null;
        const label = customLabel ?? this.#getConditionLabel(condId);

        if (ref) {
            const raw = `@UUID[${ref}]{${label}}`;
            const enriched = await this.enrichHTML(raw, { secrets: false, async: true });
            if (enriched && !enriched.startsWith('@UUID')) {
                return enriched;
            }
            return `<a class="content-link" draggable="true" data-link data-uuid="${ref}"><i class="fas fa-file-lines"></i>${label}</a>`;
        }

        const icon = condConfig?.icon ?? fallbackStatus?.icon ?? null;
        const iconHtml = icon ? `<img src="${icon}" alt="${label}"/>` : '<i class="fas fa-file-lines"></i>';
        return `<a class="content-link" data-link data-type="Condition" data-condition="${condId}">${iconHtml}${label}</a>`;
    }

    /**
     * Format a stylized HTML tooltip for an auto-banned component or components list.
     * Status conditions are rendered as enriched, clickable Foundry content-links matching character sheets.
     * @param {string} comp Component identifier ('vocal'|'somatic'|'components')
     * @param {Array<Object|string>|Record<string, Array<Object|string>>} reasons List of effect reasons or map of component to reasons
     * @returns {Promise<string>} HTML tooltip string
     */
    async formatAutoBanTooltip(comp, reasons) {
        if (!reasons) return '';

        const autoBannedStr = localize('BAD.dnd5eAutoBan.autoBanned', 'Auto-Banned');
        const causingStr = localize('BAD.dnd5eAutoBan.causingEffects', 'Causing Effect(s):');
        const formatEffectHtml = async (r) => {
            if (!r) return '';
            const effectName = r?.name ?? String(r ?? '');
            const rawStatuses = Array.isArray(r?.statuses) && r.statuses.length > 0
                ? r.statuses
                : [effectName];

            const statusLinks = await Promise.all(rawStatuses.map(st => this.enrichCondition(st, st)));

            const chunks = [];
            for (let i = 0; i < statusLinks.length; i += 3) {
                chunks.push(statusLinks.slice(i, i + 3));
            }

            const rowsHtml = chunks.map(chunk => `<div class="bad-autoban-conditions-row">${chunk.join('')}</div>`).join('');

            return `<li class="bad-autoban-effect-item"><span class="bad-autoban-effect-name">${effectName}</span><ul class="bad-autoban-conditions-list"><li><div class="bad-autoban-conditions-container">${rowsHtml}</div></li></ul></li>`;
        };

        if (comp === 'components') {
            // Consolidated tooltip for parent 'components' tab
            const entries = Object.entries(reasons).filter(([k, list]) => Array.isArray(list) && list.length > 0);
            if (!entries.length) return '';

            const listItems = await Promise.all(entries.map(async ([c, list]) => {
                const cLabel = this.getActionSubTabLabel(c);
                const subReasons = await Promise.all(list.map(formatEffectHtml));
                return `<li><strong class="bad-autoban-comp-label">${cLabel}</strong><ul class="bad-autoban-sub-list bad-autoban-effects-list">${subReasons.join('')}</ul></li>`;
            }));

            const title = localize('BAD.dnd5eAutoBan.autoBannedComponents', 'Auto-Banned Components');
            return `<div class="bad-autoban-tooltip"><div class="bad-autoban-header"><i class="fas fa-ban bad-autoban-icon"></i><span class="bad-autoban-title">${title}</span></div><div class="bad-autoban-body"><span class="bad-autoban-reason-label">${causingStr}</span><ul class="bad-autoban-list bad-autoban-components-list">${listItems.join('')}</ul></div></div>`;
        }

        const reasonList = Array.isArray(reasons) ? reasons : [];
        if (!reasonList.length) return '';

        const compLabel = this.getActionSubTabLabel(comp);
        const title = `${autoBannedStr}: ${compLabel}`;
        const listItems = await Promise.all(reasonList.map(formatEffectHtml));

        return `<div class="bad-autoban-tooltip"><div class="bad-autoban-header"><i class="fas fa-ban bad-autoban-icon"></i><span class="bad-autoban-title">${title}</span></div><div class="bad-autoban-body"><span class="bad-autoban-reason-label">${causingStr}</span><ul class="bad-autoban-list bad-autoban-single-comp-list">${listItems.join('')}</ul></div></div>`;
    }

    // #endregion
}

/**
 * System adapter for D&D 5th Edition v5.3+.
 * Overrides senses extraction to target modern senses.ranges schema with zero fallback coalescing.
 */
export class Dnd5eSystemAdapter_5_3 extends BaseDnd5eSystemAdapter {
    /**
     * Extract senses according to D&D 5e v5.3+ schema (senses.ranges.*).
     * @param {Object} sensesData
     * @param {Object} [cfg]
     * @returns {string[]}
     */
    extractSenses(sensesData, cfg = CONFIG?.DND5E) {
        if (!sensesData) return [];
        const result = [];
        const units = sensesData.units ?? 'ft';
        const ranges = sensesData.ranges ?? {};
        const defaultSenseKeys = ['darkvision', 'blindsight', 'tremorsense', 'truesight'];
        const configuredKeys = cfg?.senses ? Object.keys(cfg.senses) : [];
        const senseKeys = [...new Set([...defaultSenseKeys, ...configuredKeys])];

        for (const s of senseKeys) {
            const val = ranges[s];
            if (val && Number(val) > 0) {
                const label = this.formatSenseLabel(s, cfg?.senses);
                result.push(`${label} ${val} ${units}`);
            }
        }
        const special = typeof sensesData.special === 'string' ? sensesData.special.trim() : '';
        if (special) {
            result.push(special);
        }
        return result;
    }
}

/**
 * Dynamic factory entry-point for D&D 5th Edition.
 * Automatically delegates to Dnd5eSystemAdapter_5_3 on v5.3+ and BaseDnd5eSystemAdapter on earlier baseline.
 */
export class Dnd5eSystemAdapter extends BaseDnd5eSystemAdapter {
    constructor(foundry) {
        if (!foundry) {
            throw new Error(`Dnd5eSystemAdapter requires a valid Foundry adapter instance, received: ${foundry}`);
        }
        const version = game.system?.version ?? '4.0.0';
        if (!foundry.isNewerVersion('5.3.0', version) && new.target === Dnd5eSystemAdapter) {
            return new Dnd5eSystemAdapter_5_3(foundry);
        }
        super(foundry);
    }
}
