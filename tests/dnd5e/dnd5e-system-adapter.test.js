import { FoundryV12Adapter } from "../../src/adapters/foundry/foundry-v12-adapter.js";
import '../setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BaseDnd5eSystemAdapter, Dnd5eSystemAdapter_5_3, Dnd5eSystemAdapter } from '../../src/adapters/system/dnd5e-system-adapter.js';
import { categorizeActions } from '../../src/categorization/categorization-manager.js';
import { Action } from '../../src/ui/action.js';
import { itemHasComponent } from '../../src/adapters/system/filter/dnd5e-system-tab-filter-manager.js';

test('Dnd5eSystemAdapter initialization and labels', () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    assert.equal(adapter.systemId, 'dnd5e');
    assert.equal(adapter.getItemTypeIcon('weapon'), 'fas fa-sword');
    assert.equal(adapter.getItemTypeIcon('equipment'), 'fas fa-shield');
    const defaultCategories = adapter.getDefaultCategories();
    assert.equal(defaultCategories.length, 7);
    assert.equal(defaultCategories[0].name, 'Favorites');
    assert.equal(defaultCategories[1].name, 'Weapons');
    assert.equal(defaultCategories[2].name, 'Spells');
    assert.equal(defaultCategories[2].subcategories.length, 3);
    assert.equal(defaultCategories[3].name, 'Features');
    assert.equal(defaultCategories[4].name, 'Abilities');
    assert.equal(defaultCategories[4].expression, 'action.type === "ability"');
    assert.equal(defaultCategories[4].subcategories.length, 0);
    assert.equal(defaultCategories[5].name, 'Skills');
    assert.equal(defaultCategories[5].expression, 'action.type === "skill"');
    assert.equal(defaultCategories[5].subcategories.length, 6);
    assert.equal(defaultCategories[5].subcategories[0].name, 'Strength');
    assert.equal(defaultCategories[5].subcategories[0].expression, 'action.right.some(t => t.label === "str")');
    assert.equal(defaultCategories[5].subcategories[1].name, 'Dexterity');
    assert.equal(defaultCategories[5].subcategories[1].expression, 'action.right.some(t => t.label === "dex")');
    assert.equal(defaultCategories[5].subcategories[2].name, 'Constitution');
    assert.equal(defaultCategories[5].subcategories[2].expression, 'action.right.some(t => t.label === "con")');
    assert.equal(defaultCategories[5].subcategories[3].name, 'Intelligence');
    assert.equal(defaultCategories[5].subcategories[3].expression, 'action.right.some(t => t.label === "int")');
    assert.equal(defaultCategories[5].subcategories[4].name, 'Wisdom');
    assert.equal(defaultCategories[5].subcategories[4].expression, 'action.right.some(t => t.label === "wis")');
    assert.equal(defaultCategories[5].subcategories[5].name, 'Charisma');
    assert.equal(defaultCategories[5].subcategories[5].expression, 'action.right.some(t => t.label === "cha")');
    assert.equal(defaultCategories[6].name, 'Tools');
    assert.equal(defaultCategories[6].expression, 'action.type === "tool"');
    assert.equal(defaultCategories[6].subcategories.length, 6);
    assert.equal(defaultCategories[6].subcategories[1].name, 'Dexterity');
    assert.equal(defaultCategories[6].subcategories[3].name, 'Intelligence');
});

test('Dnd5eSystemAdapter shouldExtractItem filtering', () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    assert.equal(adapter.shouldExtractItem({ type: 'weapon' }), true);
    assert.equal(adapter.shouldExtractItem({ type: 'spell' }), true);
    assert.equal(adapter.shouldExtractItem({ type: 'feat' }), true);
    assert.equal(adapter.shouldExtractItem({ type: 'class' }), false);
});

test('Dnd5eSystemAdapter spell slot calculation', () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const actor = {
        system: {
            spells: {
                spell1: { value: 3, max: 4 },
                spell2: { value: 0, max: 3 },
                pact: { value: 2, max: 2 }
            }
        }
    };

    adapter.init(actor);

    // Cantrip -> no slots
    const cantrip = { type: 'spell', system: { level: 0, method: 'prepared', prepared: true } };
    assert.deepEqual(adapter.calculateUses(cantrip), { available: null, max: null });

    // Level 1 spell
    const spell1 = { type: 'spell', system: { level: 1, method: 'prepared', prepared: true } };
    assert.deepEqual(adapter.calculateUses(spell1), { available: 3, max: 4 });

    // Pact spell
    const pactSpell = { type: 'spell', system: { level: 2, method: 'pact', prepared: true } };
    assert.deepEqual(adapter.calculateUses(pactSpell), { available: 2, max: 2 });

    // Consumable with quantity > 1 and charges
    const potionWithCharges = {
        type: 'consumable',
        system: {
            uses: { max: '3', spent: 1 },
            quantity: 2
        }
    };
    assert.deepEqual(adapter.calculateUses(potionWithCharges), { available: 5, max: 6 });

    // Consumable without charges (quantity-based)
    const potionQuantityOnly = {
        type: 'consumable',
        system: {
            quantity: 4
        }
    };
    assert.deepEqual(adapter.calculateUses(potionQuantityOnly), { available: 4, max: null });
});

test('Dnd5eSystemAdapter modifyActions full transformation pipeline', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const weaponItem = {
        id: 'weapon-1',
        name: 'Longsword',
        type: 'weapon',
        system: {
            equipped: true,
            activities: [
                {
                    id: 'act-weapon',
                    name: 'Attack',
                    type: 'attack',
                    activation: { type: 'action' }
                }
            ]
        }
    };

    const spellItem = {
        id: 'spell-1',
        name: 'Healing Word',
        type: 'spell',
        system: {
            level: 1,
            method: 'prepared',
            prepared: true,
            properties: new Set(['vocal', 'somatic']),
            activities: [
                {
                    id: 'act-spell',
                    name: 'Cast',
                    type: 'cast',
                    activation: { type: 'bonus' }
                }
            ]
        }
    };

    const featItem = {
        id: 'feat-1',
        name: 'Shield Master Reaction',
        type: 'feat',
        system: {
            activation: { type: 'reaction' },
            uses: { value: 1, max: 2 },
            activities: [
                {
                    id: 'act-feat',
                    name: 'Block',
                    type: 'utility',
                    activation: { type: 'reaction', override: true }
                }
            ]
        }
    };

    const actor = {
        items: new foundry.utils.Collection([weaponItem, spellItem, featItem]),
        system: {
            spells: {
                spell1: { value: 3, max: 4 }
            }
        }
    };

    const rawActions = [
        { id: 'act-weapon', originalItem: weaponItem },
        { id: 'act-spell', originalItem: spellItem },
        { id: 'act-feat', originalItem: featItem }
    ];

    const modified = await adapter.modifyActions(rawActions, actor);
    const page1Actions = modified.filter(a => a.page === 1);
    const page2Actions = modified.filter(a => a.page === 2);

    assert.equal(page1Actions.length, 3, 'Should transform weapon, spell, and feat activities on Page 1');
    assert.equal(page2Actions.length, 6, 'Should extract 6 core ability items on Page 2');

    const weaponAction = page1Actions.find(a => a.id === 'act-weapon');
    assert.equal(weaponAction.subactions[0].right[0].label, 'action');
    assert.deepEqual(weaponAction.right.map(t => t.path), ['economy/standard/action']);
    assert.deepEqual(weaponAction.left, ['weapon']);

    const spellAction = page1Actions.find(a => a.id === 'act-spell');
    assert.equal(spellAction.subactions[0].right[0].label, 'bonus');
    assert.deepEqual(spellAction.right.map(t => t.path), ['economy/standard/bonus', 'components/vocal', 'components/somatic']);
    assert.deepEqual(spellAction.uses, { available: 3, max: 4 });

    const featAction = page1Actions.find(a => a.id === 'act-feat');
    assert.equal(featAction.subactions[0].right[0].label, 'reaction');
    assert.deepEqual(featAction.right.map(t => t.path), ['economy/standard/reaction']);

    const dexAbility = page2Actions.find(a => a.id === 'ability-dex');
    assert.equal(dexAbility.type, 'ability');
    assert.deepEqual(dexAbility.left, ['savingThrow']);
    assert.deepEqual(dexAbility.itemCategories, [['savingThrow'], ['abilityCheck']]);
    assert.equal(dexAbility.subactions.length, 2);
    assert.equal(dexAbility.collapseDropdownIfSingle, true);
});

test('Dnd5eSystemAdapter extractCheckActions generates core saves, core checks, skills, and tool proficiency checks', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    let rolledTool = null;
    const mockActor = {
        system: {
            skills: {
                acr: { ability: 'dex', label: 'Acrobatics' },
                ath: { ability: 'str', label: 'Athletics' }
            },
            tools: {
                thief: { ability: 'dex', label: "Thieves' Tools", value: 1 },
                alchemist: { ability: 'int', label: "Alchemist's Supplies", value: 1 }
            }
        },
        rollToolCheck: async (options) => {
            rolledTool = options?.tool ?? options;
            return { rolled: true };
        }
    };

    const checks = adapter.extractCheckActions(mockActor);
    // 6 core ability items (each with 2 activities) + 2 skills + 2 tools = 10 items
    assert.equal(checks.length, 10);

    const coreAbilities = checks.filter(c => c.type === 'ability');
    assert.equal(coreAbilities.length, 6);
    assert.ok(coreAbilities.every(c => c.page === 2 && c.subactions.length === 2));

    const skills = checks.filter(c => c.type === 'skill');
    assert.equal(skills.length, 2);
    assert.ok(skills.every(s => s.page === 2 && s.left[0] === 'abilityCheck'));

    const tools = checks.filter(c => c.type === 'tool');
    assert.equal(tools.length, 2);
    assert.ok(tools.every(t => t.page === 2 && t.left[0] === 'tool'));

    const thiefTool = tools.find(t => t.id === 'tool-thief');
    assert.equal(thiefTool.name, "Thieves' Tools");
    assert.equal(thiefTool.right[0].label, 'dex');
    assert.deepEqual(thiefTool.left, ['tool']);

    const alchemistTool = tools.find(t => t.id === 'tool-alchemist');
    assert.equal(alchemistTool.name, "Alchemist's Supplies");
    assert.equal(alchemistTool.right[0].label, 'int');
    assert.deepEqual(alchemistTool.left, ['tool']);

    // Test tool rolling
    await thiefTool.roll({});
    assert.equal(rolledTool, 'thief');

    // Test tool check item summary
    const summary = await adapter.getItemSummary(thiefTool, null, mockActor);
    assert.equal(summary.title, "Thieves' Tools");
    assert.ok(summary.subtitle.includes('Tool Check'));
    assert.ok(summary.properties.some(p => p.value === 'Proficient'));
});

test('Dnd5eSystemAdapter resolves clean names for vehicle, jeweler, leatherworker, and Compendium UUIDs', () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    // Setup globalThis.dnd5e with Trait.keyLabel mock
    globalThis.dnd5e = {
        documents: {
            Trait: {
                keyLabel(key, options) {
                    const map = {
                        vehicle: 'Vehicles',
                        jeweler: "Jeweler's Tools",
                        leatherworker: "Leatherworker's Tools"
                    };
                    return map[key] ?? null;
                }
            }
        }
    };

    // Setup fromUuidSync mock
    const origFromUuidSync = foundry.utils.fromUuidSync;
    foundry.utils.fromUuidSync = (uuid) => {
        if (uuid === 'Compendium.dnd5e.equipment24.Item.phbtulJewelersTo') {
            return { name: "Jeweler's Tools" };
        }
        return null;
    };

    const actor = {
        system: {
            skills: {},
            tools: {
                vehicle: { ability: 'int' },
                jeweler: { ability: 'int' },
                leatherworker: { ability: 'dex' },
                'Compendium.dnd5e.equipment24.Item.phbtulJewelersTo': { ability: 'int' }
            }
        }
    };

    const checks = adapter.extractCheckActions(actor);
    const tools = checks.filter(c => c.type === 'tool');
    assert.equal(tools.length, 4);

    const vehicleAction = tools.find(t => t.id === 'tool-vehicle');
    assert.equal(vehicleAction.name, 'Vehicles');
    assert.equal(vehicleAction.right[0].label, 'int');

    const jewelerAction = tools.find(t => t.id === 'tool-jeweler');
    assert.equal(jewelerAction.name, "Jeweler's Tools");
    assert.equal(jewelerAction.right[0].label, 'int');

    const leatherAction = tools.find(t => t.id === 'tool-leatherworker');
    assert.equal(leatherAction.name, "Leatherworker's Tools");
    assert.equal(leatherAction.right[0].label, 'dex');

    const uuidAction = tools.find(t => t.id === 'tool-Compendium.dnd5e.equipment24.Item.phbtulJewelersTo');
    assert.equal(uuidAction.name, "Jeweler's Tools");

    // Clean up globals
    delete globalThis.dnd5e;
    foundry.utils.fromUuidSync = origFromUuidSync;
});

test('Dnd5eSystemAdapter modifyContext triggers categorized checks layout on Page 2', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const items = [
        { id: 'b', name: 'B-Skill', type: 'skill', right: [{ path: 'all', label: 'dex' }] },
        { id: 'a', name: 'A-Core', type: 'ability', right: [{ path: 'all', label: 'str' }] }
    ];

    const ctxStr = { items, itemTypes: [] };
    await adapter.modifyContext(ctxStr, { activePage: '2' });
    assert.equal(ctxStr.layout, 'categorized');
    assert.equal(ctxStr.isCategorized, true);
    assert.ok(Array.isArray(ctxStr.categorizedSections));
    assert.ok(ctxStr.categorizedSections.find(s => s.name === 'Abilities'));
    assert.ok(ctxStr.categorizedSections.find(s => s.name === 'Skills'));

    const ctxNum = { items, itemTypes: [] };
    await adapter.modifyContext(ctxNum, { activePage: 1 });
    assert.equal(ctxNum.layout, 'flat');
});

test('Dnd5eSystemAdapter favorites integration (hasFavorites, isFavorite, setFavorite)', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    assert.equal(adapter.hasFavorites(), true);

    // 1. Direct system.favorite
    const item1 = { id: 'item1', system: { favorite: true }, update: async (data) => { if ('system.favorite' in data) item1.system.favorite = data['system.favorite']; return item1; } };
    assert.equal(adapter.isFavorite({}, item1), true);

    // 2. Legacy flags.dnd5e.favorite
    const item2 = { id: 'item2', flags: { dnd5e: { favorite: true } }, update: async (data) => { if ('flags.dnd5e.favorite' in data) item2.flags.dnd5e.favorite = data['flags.dnd5e.favorite']; return item2; } };
    assert.equal(adapter.isFavorite({}, item2), true);

    // 3. Actor system.favorites collection
    const actor = {
        system: {
            favorites: [{ id: 'item3', type: 'item' }]
        }
    };
    const item3 = { id: 'item3' };
    assert.equal(adapter.isFavorite(actor, item3), true);

    // 4. Unfavorited item
    const item4 = { id: 'item4', system: { favorite: false } };
    assert.equal(adapter.isFavorite(actor, item4), false);

    // 5. setFavorite on item with system.favorite
    await adapter.setFavorite(actor, item1, false);
    assert.equal(item1.system.favorite, false);
    await adapter.setFavorite(actor, item1, true);
    assert.equal(item1.system.favorite, true);

    // 6. setFavorite using actor addFavorite / removeFavorite
    let added = null;
    let removed = null;
    const actorWithMethods = {
        system: {
            addFavorite: async (obj) => { added = obj; },
            removeFavorite: async (id) => { removed = id; }
        }
    };
    const itemWithoutUpdate = { id: 'item5' };
    await adapter.setFavorite(actorWithMethods, itemWithoutUpdate, true);
    assert.deepEqual(added, { id: 'item5', type: 'item' });
    await adapter.setFavorite(actorWithMethods, itemWithoutUpdate, false);
    assert.equal(removed, 'item5');
});

test('Dnd5eSystemAdapter default categorization presets categorize ability and skill actions', () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const actor = {
        getFlag: () => null,
        system: {
            skills: {
                ath: { ability: 'str', label: 'Athletics' },
                ste: { ability: 'dex', label: 'Stealth' }
            },
            tools: {
                thief: { ability: 'dex', label: "Thieves' Tools" },
                jeweler: { ability: 'int', label: "Jeweler's Tools" }
            }
        }
    };
    const actions = adapter.extractCheckActions(actor);
    const presets = adapter.getDefaultCategories();
    const categorized = categorizeActions(actions, { enabled: true, categories: presets }, 'Other Actions', { actor });

    assert.ok(categorized);
    const abilitySection = categorized.find(c => c.name === 'Abilities');
    assert.ok(abilitySection);
    assert.equal(abilitySection.items.length, 6);

    const skillSection = categorized.find(c => c.name === 'Skills');
    assert.ok(skillSection);
    const strSub = skillSection.subsections.find(s => s.name === 'Strength');
    assert.ok(strSub);
    assert.equal(strSub.items.some(i => i.name === 'Athletics'), true);

    const dexSub = skillSection.subsections.find(s => s.name === 'Dexterity');
    assert.ok(dexSub);
    assert.equal(dexSub.items.some(i => i.name === 'Stealth'), true);

    const toolSection = categorized.find(c => c.name === 'Tools');
    assert.ok(toolSection);
    const dexToolSub = toolSection.subsections.find(s => s.name === 'Dexterity');
    assert.ok(dexToolSub);
    assert.equal(dexToolSub.items.some(i => i.name === "Thieves' Tools"), true);

    const intToolSub = toolSection.subsections.find(s => s.name === 'Intelligence');
    assert.ok(intToolSub);
    assert.equal(intToolSub.items.some(i => i.name === "Jeweler's Tools"), true);
});

test('Dnd5eSystemAdapter onTabRightClick toggles actor flags', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const flags = {};
    const mockActor = {
        isOwner: true,
        getFlag: (mod, key) => flags[key] ?? false,
        setFlag: async (mod, key, val) => { flags[key] = val; }
    };
    const mockApp = { actor: mockActor };

    // Parent tab 'all' (All Items) - setting showAll sets all filter flags
    const allParentEl = {
        classList: { contains: (cls) => cls === 'bad-left-tab' },
        dataset: { type: 'all' }
    };
    assert.equal(await adapter.onTabRightClick(mockApp, allParentEl), true);
    assert.equal(flags.showAll, true);
    assert.equal(flags.showUnprepared, true);
    assert.equal(flags.showUnequipped_weapon, true);
    assert.equal(flags.showUnequipped_equipment, true);
    assert.equal(flags.showUnequipped_consumable, true);
    assert.equal(flags.showUnequipped_tool, true);
    assert.equal(flags.showUnequipped_backpack, true);
    assert.equal(flags.showUnequipped_loot, true);

    // Clearing showAll clears all filter flags
    assert.equal(await adapter.onTabRightClick(mockApp, allParentEl), true);
    assert.equal(flags.showAll, false);
    assert.equal(flags.showUnprepared, false);
    assert.equal(flags.showUnequipped_weapon, false);
    assert.equal(flags.showUnequipped_equipment, false);
    assert.equal(flags.showUnequipped_consumable, false);
    assert.equal(flags.showUnequipped_tool, false);
    assert.equal(flags.showUnequipped_backpack, false);
    assert.equal(flags.showUnequipped_loot, false);

    // Parent tab 'spell' (Spells)
    const spellParentEl = {
        classList: { contains: (cls) => cls === 'bad-left-tab' },
        dataset: { type: 'spell' }
    };
    assert.equal(await adapter.onTabRightClick(mockApp, spellParentEl), true);
    assert.equal(flags.showUnprepared, true);

    // Parent tab 'weapon'
    const weaponParentEl = {
        classList: { contains: (cls) => cls === 'bad-left-tab' },
        dataset: { type: 'weapon' }
    };
    assert.equal(await adapter.onTabRightClick(mockApp, weaponParentEl), true);
    assert.equal(flags.showUnequipped_weapon, true);

    // Parent tab 'equipment'
    const equipParentEl = {
        classList: { contains: (cls) => cls === 'bad-left-tab' },
        dataset: { type: 'equipment' }
    };
    assert.equal(await adapter.onTabRightClick(mockApp, equipParentEl), true);
    assert.equal(flags.showUnequipped_equipment, true);

    // Unhandled parent tab 'feat'
    const featParentEl = {
        classList: { contains: (cls) => cls === 'bad-left-tab' },
        dataset: { type: 'feat' }
    };
    assert.equal(await adapter.onTabRightClick(mockApp, featParentEl), false);

    // Sub-tab 'all' under spell
    const spellSubEl = {
        classList: { contains: (cls) => cls === 'bad-left-sub-tab' },
        dataset: { type: 'all' },
        closest: () => ({
            querySelector: () => ({ dataset: { type: 'spell' } })
        })
    };
    assert.equal(await adapter.onTabRightClick(mockApp, spellSubEl), true);
    assert.equal(flags.showUnprepared, false);

    // Non-owner actor should return false
    const nonOwnerApp = { actor: { isOwner: false } };
    assert.equal(await adapter.onTabRightClick(nonOwnerApp, allParentEl), false);
});

test('Dnd5eSystemAdapter modifyActions showAll behavior', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const preparedSpell = {
        id: 'spell-prep',
        name: 'Prepared Spell',
        type: 'spell',
        system: {
            level: 1,
            method: 'prepared',
            prepared: true,
            activities: [{ id: 'act-1', name: 'Cast', type: 'cast', activation: { type: 'action' } }]
        }
    };

    const unpreparedSpell = {
        id: 'spell-unprep',
        name: 'Unprepared Spell',
        type: 'spell',
        system: {
            level: 1,
            method: 'prepared',
            prepared: false,
            activities: [{ id: 'act-2', name: 'Cast', type: 'cast', activation: { type: 'action' } }]
        }
    };

    const equippedWeapon = {
        id: 'wpn-eq',
        name: 'Equipped Sword',
        type: 'weapon',
        system: {
            equipped: true,
            activities: [{ id: 'act-3', name: 'Attack', type: 'attack', activation: { type: 'action' } }]
        }
    };

    const unequippedWeapon = {
        id: 'wpn-uneq',
        name: 'Unequipped Bow',
        type: 'weapon',
        system: {
            equipped: false,
            activities: [{ id: 'act-4', name: 'Shoot', type: 'attack', activation: { type: 'action' } }]
        }
    };

    const unequippedConsumable = {
        id: 'pot-uneq',
        name: 'Unequipped Potion',
        type: 'consumable',
        system: {
            equipped: false,
            activities: [{ id: 'act-5', name: 'Drink', type: 'heal', activation: { type: 'action' } }]
        }
    };

    const unequippedArmor = {
        id: 'armor-uneq',
        name: 'Unequipped Plate',
        type: 'equipment',
        system: {
            equipped: false,
            type: { value: 'heavy' }
        }
    };

    const rawActions = [
        { originalItem: preparedSpell },
        { originalItem: unpreparedSpell },
        { originalItem: equippedWeapon },
        { originalItem: unequippedWeapon },
        { originalItem: unequippedConsumable },
        { originalItem: unequippedArmor }
    ];

    // Case 1: showAll = false, showUnprepared = false
    const actorNormal = {
        getFlag: (mod, key) => null,
        system: { spells: { spell1: { value: 2, max: 2 } }, skills: {} }
    };
    const actionsNormal = await adapter.modifyActions(rawActions, actorNormal);
    assert.equal(actionsNormal.some(a => a.name === 'Prepared Spell'), true);
    assert.equal(actionsNormal.some(a => a.name === 'Unprepared Spell'), false);
    assert.equal(actionsNormal.some(a => a.name === 'Equipped Sword'), true);
    assert.equal(actionsNormal.some(a => a.name === 'Unequipped Bow'), false);
    assert.equal(actionsNormal.some(a => a.name === 'Unequipped Potion'), false);
    assert.equal(actionsNormal.some(a => a.name === 'Unequipped Plate'), false);

    // Case 2: showAll = true -> reveals unprepared spells and unequipped items with available = false
    const actorShowAll = {
        getFlag: (mod, key) => key === 'showAll' ? true : null,
        system: { spells: { spell1: { value: 2, max: 2 } }, skills: {} }
    };
    const actionsShowAll = await adapter.modifyActions(rawActions, actorShowAll);
    const foundUnprep = actionsShowAll.find(a => a.name === 'Unprepared Spell');
    assert.ok(foundUnprep);
    assert.equal(foundUnprep.available, false);

    const foundUneq = actionsShowAll.find(a => a.name === 'Unequipped Bow');
    assert.ok(foundUneq);
    assert.equal(foundUneq.available, false);

    const foundConsumable = actionsShowAll.find(a => a.name === 'Unequipped Potion');
    assert.ok(foundConsumable);
    assert.equal(foundConsumable.available, false);

    const foundArmor = actionsShowAll.find(a => a.name === 'Unequipped Plate');
    assert.ok(foundArmor);
    assert.equal(foundArmor.available, false);

    const foundPrep = actionsShowAll.find(a => a.name === 'Prepared Spell');
    assert.ok(foundPrep);
    assert.equal(foundPrep.available, true);

    const foundEq = actionsShowAll.find(a => a.name === 'Equipped Sword');
    assert.ok(foundEq);
    assert.equal(foundEq.available, true);
});

test('Dnd5eSystemAdapter modifyContext orange indicators for All Items and Spells tabs', () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const makeContext = () => ({
        itemTypes: [
            { id: 'all', label: 'All Items', subTabs: [], addSubTab: function (st) { this.subTabs.push(st); }, updateOrder: () => {} },
            { id: 'spell', label: 'Spells', subTabs: [{ id: 'level_1', label: '1st Level', subTabs: [] }], addSubTab: function (st) { this.subTabs.push(st); }, updateOrder: () => {} },
            { id: 'weapon', label: 'Weapons', subTabs: [], addSubTab: function (st) { this.subTabs.push(st); }, updateOrder: () => {} }
        ]
    });

    // 1. showAll = true: All Items, Spells, Weapons tabs should be orange (showUnprepared = true)
    const context1 = makeContext();
    const app1 = {
        actor: { getFlag: (mod, key) => key === 'showAll' ? true : false },
        leftTabs: { activeParents: new Set(['all']), activeSubTypes: new Set() }
    };
    adapter.modifyContext(context1, app1);

    const allTab1 = context1.itemTypes.find(t => t.id === 'all');
    assert.equal(allTab1.showUnprepared, true);

    const spellTab1 = context1.itemTypes.find(t => t.id === 'spell');
    assert.equal(spellTab1.showUnprepared, true);
    const allSpellsSub1 = spellTab1.subTabs.find(s => s.id === 'all');
    assert.ok(allSpellsSub1);
    assert.equal(allSpellsSub1.showUnprepared, true);

    const weaponTab1 = context1.itemTypes.find(t => t.id === 'weapon');
    assert.equal(weaponTab1.showUnprepared, true);
    const allWeaponsSub1 = weaponTab1.subTabs.find(s => s.id === 'all');
    assert.ok(allWeaponsSub1);
    assert.equal(allWeaponsSub1.showUnprepared, true);

    // 2. showAll = false, showUnprepared = false: All Items and Spells tabs are normal
    const context2 = makeContext();
    const app2 = {
        actor: { getFlag: () => false },
        leftTabs: { activeParents: new Set(['all']), activeSubTypes: new Set() }
    };
    adapter.modifyContext(context2, app2);

    const allTab2 = context2.itemTypes.find(t => t.id === 'all');
    assert.equal(allTab2.showUnprepared, false);

    const spellTab2 = context2.itemTypes.find(t => t.id === 'spell');
    assert.equal(spellTab2.showUnprepared, false);
    const allSpellsSub2 = spellTab2.subTabs.find(s => s.id === 'all');
    assert.ok(allSpellsSub2);
    assert.equal(allSpellsSub2.showUnprepared, false);

    // 3. showAll = false, showUnprepared = true: Only Spells tab is orange
    const context3 = makeContext();
    const app3 = {
        actor: { getFlag: (mod, key) => key === 'showUnprepared' ? true : false },
        leftTabs: { activeParents: new Set(['spell']), activeSubTypes: new Set() }
    };
    adapter.modifyContext(context3, app3);

    const allTab3 = context3.itemTypes.find(t => t.id === 'all');
    assert.equal(allTab3.showUnprepared, false);

    const spellTab3 = context3.itemTypes.find(t => t.id === 'spell');
    assert.equal(spellTab3.showUnprepared, true);
    const allSpellsSub3 = spellTab3.subTabs.find(s => s.id === 'all');
    assert.ok(allSpellsSub3);
    assert.equal(allSpellsSub3.showUnprepared, true);
});

test('Dnd5eSystemAdapter extracts spell component tabs for NPC Spellcasting feats with linked cast activities', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const fireballSpell = {
        id: 'spell-fireball',
        name: 'Fireball',
        type: 'spell',
        system: {
            properties: new Set(['vocal', 'somatic', 'material']),
            activation: { type: 'action' }
        }
    };

    const spellcastingFeat = {
        id: 'feat-spellcasting',
        name: 'Spellcasting',
        type: 'feat',
        system: {
            activities: [
                {
                    id: 'act-fireball',
                    name: 'Cast Fireball',
                    type: 'cast',
                    spell: fireballSpell,
                    activation: { type: 'action' }
                },
                {
                    id: 'act-shield',
                    name: 'Cast Shield',
                    type: 'cast',
                    spell: {
                        properties: ['vocal', 'somatic'],
                        system: { activation: { type: 'reaction' } }
                    },
                    activation: { type: 'reaction' }
                }
            ]
        }
    };

    const actor = {
        items: new foundry.utils.Collection([spellcastingFeat]),
        system: { spells: {} }
    };

    const rawActions = [{ id: 'act-feat', originalItem: spellcastingFeat }];
    const modified = await adapter.modifyActions(rawActions, actor);

    const featAction = modified.find(a => a.id === 'act-feat');
    assert.ok(featAction, 'Should create action for Spellcasting feat');
    assert.equal(featAction.subactions.length, 2);

    const rightPaths = featAction.right.map(t => t.path);
    assert.ok(rightPaths.includes('components/vocal'), 'Should include vocal component tab');
    assert.ok(rightPaths.includes('components/somatic'), 'Should include somatic component tab');
    assert.ok(rightPaths.includes('components/material'), 'Should include material component tab');
});

test('Dnd5eSystemAdapter resolves cached helper spells for NPC Spellcasting feats and extracts components', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const cachedDetectMagic = {
        id: 'spell-detect-magic',
        name: 'Detect Magic',
        type: 'spell',
        flags: {
            dnd5e: { cachedFor: '.Item.feat-spellcasting.Activity.act-detect-magic' }
        },
        system: {
            properties: ['vocal', 'somatic', 'concentration', 'ritual'],
            activation: { type: 'action' }
        }
    };

    const spellcastingFeat = {
        id: 'feat-spellcasting',
        name: 'Spellcasting',
        type: 'feat',
        system: {
            activities: {
                'act-detect-magic': {
                    _id: 'act-detect-magic',
                    name: '',
                    type: 'cast',
                    spell: {
                        uuid: 'Compendium.dnd5e.spells.Item.phbsplDetectMagi',
                        properties: []
                    }
                }
            }
        }
    };

    const actor = {
        items: new foundry.utils.Collection([spellcastingFeat, cachedDetectMagic]),
        system: { spells: {} }
    };

    assert.equal(adapter.shouldExtractItem(cachedDetectMagic), false, 'Cached helper items should be skipped by shouldExtractItem');
    assert.equal(adapter.shouldExtractItem(spellcastingFeat), true, 'Spellcasting feat should be extracted');

    adapter.init(actor);
    const rawActions = [{ id: 'act-feat', originalItem: spellcastingFeat }];
    const modified = await adapter.modifyActions(rawActions, actor);

    const featAction = modified.find(a => a.id === 'act-feat');
    assert.ok(featAction);
    assert.equal(featAction.subactions.length, 1);
    assert.equal(featAction.subactions[0].name, 'Detect Magic', 'Subaction name should fall back to linked spell name');

    const rightPaths = featAction.right.map(t => t.path);
    assert.ok(rightPaths.includes('components/vocal'));
    assert.ok(rightPaths.includes('components/somatic'));
});

test('Dnd5eSystemAdapter modifyActions evaluates spell preparation using SpellData#method and SpellData#prepared strictly', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    let preparationAccessed = false;
    const modernPreparedSpell = {
        id: 'spell-modern-prep',
        name: 'Misty Step',
        type: 'spell',
        system: {
            level: 2,
            method: 'prepared',
            prepared: true,
            get preparation() {
                preparationAccessed = true;
                return { mode: 'prepared', prepared: true };
            },
            activities: {
                'act-misty': {
                    _id: 'act-misty',
                    name: 'Cast',
                    type: 'cast',
                    activation: { type: 'bonus' }
                }
            }
        }
    };

    const modernUnpreparedSpell = {
        id: 'spell-modern-unprep',
        name: 'Scorching Ray',
        type: 'spell',
        system: {
            level: 2,
            method: 'prepared',
            prepared: false,
            get preparation() {
                preparationAccessed = true;
                return { mode: 'prepared', prepared: false };
            },
            activities: {
                'act-scorch': {
                    _id: 'act-scorch',
                    name: 'Cast',
                    type: 'cast',
                    activation: { type: 'action' }
                }
            }
        }
    };

    const innateSpell = {
        id: 'spell-innate',
        name: 'Detect Magic',
        type: 'spell',
        system: {
            level: 1,
            method: 'innate',
            prepared: false,
            activities: {
                'act-detect': {
                    _id: 'act-detect',
                    name: 'Cast',
                    type: 'cast',
                    activation: { type: 'action' }
                }
            }
        }
    };

    const actor = {
        items: new foundry.utils.Collection([modernPreparedSpell, modernUnpreparedSpell, innateSpell]),
        system: { spells: { spell1: { value: 2, max: 2 }, spell2: { value: 2, max: 2 } } },
        getFlag: () => false
    };

    adapter.init(actor);
    const rawActions = [
        { id: 'spell-modern-prep', originalItem: modernPreparedSpell },
        { id: 'spell-modern-unprep', originalItem: modernUnpreparedSpell },
        { id: 'spell-innate', originalItem: innateSpell }
    ];

    const modified = await adapter.modifyActions(rawActions, actor);

    assert.equal(preparationAccessed, false, 'preparation getter should never be accessed');
    const preparedAction = modified.find(a => a.id === 'spell-modern-prep');
    const unpreparedAction = modified.find(a => a.id === 'spell-modern-unprep');
    const innateAction = modified.find(a => a.id === 'spell-innate');

    assert.ok(preparedAction, 'Prepared spell should be included');
    assert.equal(unpreparedAction, undefined, 'Unprepared spell should be filtered out when showUnprepared is false');
    assert.ok(innateAction, 'Innate spell should be included regardless of prepared boolean');
});

test('Dnd5eSystemAdapter modifyActions handles consumable items with quantity > 1 and itemUses without error', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const potion = {
        id: 'potion-healing',
        name: 'Potion of Healing',
        type: 'consumable',
        system: {
            quantity: 3,
            uses: { max: '1', spent: 0 },
            activities: [
                {
                    id: 'act-drink',
                    name: 'Drink',
                    type: 'heal',
                    activation: { type: 'bonus' },
                    consumption: {
                        targets: [
                            { type: 'itemUses', target: '', value: 1 }
                        ]
                    }
                }
            ]
        }
    };

    const actor = {
        items: new foundry.utils.Collection([potion]),
        system: { spells: {} },
        getFlag: () => false
    };

    adapter.init(actor);
    const rawActions = [{ id: 'potion-healing', originalItem: potion }];
    const modified = await adapter.modifyActions(rawActions, actor);

    assert.equal(modified.length, 8, '1 consumable action on Page 1 + 6 core abilities on Page 2 + 1 token info on Page 3');
    const potionAction = modified.find(a => a.id === 'potion-healing');
    assert.ok(potionAction, 'Potion action should be created');
    assert.deepEqual(potionAction.uses, { available: 3, max: 3 }, 'Uses should be scaled by quantity');
});

test('Dnd5eSystemAdapter calculates limited uses correctly for monster/innate spells and recharge abilities', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    // 1. Yeenoghu's Invisibility: 3/day (innate, 1 use spent)
    const invisibility = {
        id: 'spell-invis',
        name: 'Invisibility',
        type: 'spell',
        system: {
            method: 'innate',
            level: 2,
            uses: { max: '3', spent: 1 },
            activities: [
                {
                    id: 'act-invis-cast',
                    name: 'Cast Invisibility',
                    type: 'utility',
                    activation: { type: 'action' },
                    consumption: { targets: [{ type: 'spellSlots', target: '', value: 1 }] }
                }
            ]
        }
    };

    // 2. Yeenoghu's Detect Magic: At will (innate, no limited uses)
    const detectMagic = {
        id: 'spell-detect',
        name: 'Detect Magic',
        type: 'spell',
        system: {
            method: 'atwill',
            level: 1,
            uses: {},
            activities: [
                {
                    id: 'act-detect-cast',
                    name: 'Cast Detect Magic',
                    type: 'utility',
                    activation: { type: 'action' },
                    consumption: { targets: [{ type: 'spellSlots', target: '', value: 1 }] }
                }
            ]
        }
    };

    // 3. Monster Breath Weapon: Recharge 5-6 (charged)
    const breathWeapon = {
        id: 'feat-breath',
        name: 'Breath Weapon',
        type: 'feat',
        system: {
            recharge: { value: 5, charged: true },
            activities: [
                {
                    id: 'act-breath',
                    name: 'Exhale Fire',
                    type: 'save',
                    activation: { type: 'action' },
                    consumption: { targets: [] }
                }
            ]
        }
    };

    // 4. Monster Breath Weapon: Recharge 5-6 (uncharged/depleted)
    const breathWeaponUncharged = {
        id: 'feat-breath-spent',
        name: 'Breath Weapon (Spent)',
        type: 'feat',
        system: {
            recharge: { value: 5, charged: false },
            activities: [
                {
                    id: 'act-breath-spent',
                    name: 'Exhale Fire',
                    type: 'save',
                    activation: { type: 'action' },
                    consumption: { targets: [] }
                }
            ]
        }
    };

    const monsterActor = {
        items: new foundry.utils.Collection([invisibility, detectMagic, breathWeapon, breathWeaponUncharged]),
        system: { spells: {} }, // Monsters have no standard spell slots
        getFlag: () => false
    };

    adapter.init(monsterActor);
    const rawActions = [
        { id: 'spell-invis', originalItem: invisibility },
        { id: 'spell-detect', originalItem: detectMagic },
        { id: 'feat-breath', originalItem: breathWeapon }
    ];
    const modified = await adapter.modifyActions(rawActions, monsterActor);

    // Verify Invisibility uses
    const invisAction = modified.find(a => a.id === 'spell-invis');
    assert.ok(invisAction);
    assert.deepEqual(invisAction.uses, { available: 2, max: 3 }, 'Invisibility should show 2 / 3 available uses');
    assert.deepEqual(invisAction.subactions[0].uses, { available: 2, max: 3 });

    // Verify Detect Magic uses (at will -> null)
    const detectAction = modified.find(a => a.id === 'spell-detect');
    assert.ok(detectAction);
    assert.deepEqual(detectAction.uses, { available: null, max: null }, 'At-will spell should have unlimited/null uses');

    // Verify Breath Weapon uses (charged -> 1 / 1)
    const breathAction = modified.find(a => a.id === 'feat-breath');
    assert.ok(breathAction);
    assert.deepEqual(breathAction.uses, { available: 1, max: 1 }, 'Recharged ability should have 1 / 1 uses');

    // Verify Uncharged Breath Weapon
    assert.deepEqual(adapter.calculateUses(breathWeaponUncharged), { available: 0, max: 1 });

    // Verify Item Summary Tooltip tags
    const invisSummary = await adapter.getItemSummary(invisAction, invisibility, monsterActor);
    assert.ok(invisSummary.properties.some(p => p.label === 'Uses' && p.value === '2 / 3'));
});

test('Dnd5eSystemAdapter extractInfoActions generates a valid token info action for Page 3', () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const actor = {
        id: 'actor-123',
        name: 'Red Dragon',
        img: 'icons/creatures/dragons/red.webp'
    };

    const infoActions = adapter.extractInfoActions(actor);
    assert.equal(infoActions.length, 1, 'Should extract exactly 1 token info action');
    assert.equal(infoActions[0].id, 'token-info-actor-123');
    assert.equal(infoActions[0].name, 'Red Dragon');
    assert.equal(infoActions[0].page, 3, 'Action should belong to Page 3');
    assert.equal(infoActions[0].type, 'info');
    assert.equal(infoActions[0].img, 'icons/creatures/dragons/red.webp');

    // Null actor safety
    assert.deepEqual(adapter.extractInfoActions(null), []);
});

test('Dnd5eSystemAdapter getTokenInfo extracts complete token statistics and details for Page 3 showcase', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    // 1. Monster / NPC Token with complex defenses, movement, and biography
    const adultRedDragon = {
        id: 'dragon-1',
        name: 'Adult Red Dragon',
        img: 'icons/creatures/dragons/red.webp',
        system: {
            attributes: {
                ac: { value: 19, calc: 'natural', shield: 0 },
                movement: {
                    walk: 40,
                    fly: 80,
                    hover: true,
                    climb: 40,
                    burrow: 0,
                    swim: 0,
                    units: 'ft'
                },
                senses: {
                    darkvision: 120,
                    blindsight: 60,
                    units: 'ft',
                    special: 'Passive Perception 23'
                }
            },
            traits: {
                size: 'huge',
                dr: {
                    value: ['bludgeoning', 'piercing', 'slashing'],
                    bypasses: ['mgc'],
                    custom: 'cold iron'
                },
                di: {
                    value: ['fire'],
                    custom: ''
                },
                ci: {
                    value: ['charmed', 'frightened', 'paralyzed'],
                    custom: ''
                },
                dv: {
                    value: ['cold'],
                    custom: ''
                },
                languages: {
                    value: ['common', 'draconic'],
                    custom: 'Telepathy 120 ft.'
                }
            },
            details: {
                type: {
                    value: 'dragon',
                    subtype: 'red',
                    swarm: '',
                    custom: ''
                },
                cr: 17,
                alignment: 'Chaotic Evil',
                biography: {
                    value: '<p>The <strong>Adult Red Dragon</strong> is a fierce master of volcanoes.</p>'
                }
            }
        },
        getRollData: () => ({ name: 'Adult Red Dragon' })
    };

    const token = {
        name: 'Adult Red Dragon (Token)',
        texture: { src: 'tokens/dragon.png' }
    };

    const info = await adapter.getTokenInfo(adultRedDragon, token);

    // Header & Meta
    assert.equal(info.name, 'Adult Red Dragon (Token)');
    assert.equal(info.img, 'tokens/dragon.png');
    assert.equal(info.size, 'Huge');
    assert.equal(info.type, 'Dragon');
    assert.equal(info.subtype, 'red');
    assert.equal(info.crLabel, 'CR 17');
    assert.equal(info.alignment, 'Chaotic Evil');
    assert.equal(info.typeLabel, 'Huge Dragon (red)');

    // Armor Class
    assert.equal(info.ac.value, 19);
    assert.equal(info.ac.calc, 'natural');
    assert.equal(info.ac.label, 'Natural Armor');
    assert.deepEqual(info.ac.secondaries, ['Natural Armor']);

    // Movement Speeds
    assert.equal(info.movement.primary, '40 ft');
    assert.equal(info.movement.secondary, 'Fly 80 ft (hover), Climb 40 ft');
    assert.equal(info.movement.full, '40 ft, Fly 80 ft (hover), Climb 40 ft');
    assert.equal(info.movement.speeds.length, 3);
    assert.equal(info.movement.speeds[1].type, 'fly');
    assert.equal(info.movement.speeds[1].hover, true);

    // Defenses: Resistances, Immunities, Vulnerabilities
    assert.equal(info.hasResistances, true);
    assert.ok(info.resistances.some(r => r.includes('Bludgeoning (non-Magical)')));
    assert.ok(info.resistances.some(r => r.includes('Piercing (non-Magical)')));
    assert.ok(info.resistances.some(r => r.includes('Slashing (non-Magical)')));
    assert.ok(info.resistances.includes('cold iron'));

    assert.equal(info.hasImmunities, true);
    assert.deepEqual(info.damageImmunities, ['Fire']);
    assert.deepEqual(info.conditionImmunities, ['Charmed', 'Frightened', 'Paralyzed']);

    assert.equal(info.hasVulnerabilities, true);
    assert.deepEqual(info.vulnerabilities, ['Cold']);

    // Languages & Senses
    assert.equal(info.hasLanguages, true);
    assert.ok(info.languages.includes('Common'));
    assert.ok(info.languages.includes('Draconic'));
    assert.ok(info.languages.includes('Telepathy 120 ft.'));

    assert.equal(info.hasSenses, true);
    assert.ok(info.senses.includes('Darkvision 120 ft'));
    assert.ok(info.senses.includes('Blindsight 60 ft'));
    assert.ok(info.senses.includes('Passive Perception 23'));

    // Biography details with HTML enrichment
    assert.equal(info.hasBiography, true);
    assert.ok(info.biographyHTML.includes('<strong>Adult Red Dragon</strong>'));
});

test('Dnd5eSystemAdapter getTokenInfo handles Player Character actor schema and fallback defaults', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const pcActor = {
        id: 'hero-1',
        name: 'Valeros',
        img: 'icons/characters/fighter.webp',
        system: {
            attributes: {
                ac: { value: 18, calc: 'armored', shield: 2 },
                movement: {
                    walk: 30,
                    units: 'ft'
                }
            },
            traits: {
                size: 'med',
                dr: { value: [], bypasses: [], custom: '' },
                di: { value: [], custom: '' },
                ci: { value: [], custom: '' },
                dv: { value: [], custom: '' },
                languages: {
                    value: ['common', 'dwarvish'],
                    custom: ''
                }
            },
            details: {
                race: { name: 'Mountain Dwarf' },
                level: 5,
                alignment: 'Neutral Good',
                biography: { value: '<p>A seasoned warrior from the high peaks.</p>' }
            }
        },
        getRollData: () => ({ name: 'Valeros' })
    };

    const info = await adapter.getTokenInfo(pcActor, null);
    assert.equal(info.name, 'Valeros');
    assert.equal(info.img, 'icons/characters/fighter.webp');
    assert.equal(info.crLabel, 'Level 5');
    assert.equal(info.typeLabel, 'Medium Mountain Dwarf');
    assert.equal(info.alignment, 'Neutral Good');
    assert.equal(info.ac.value, 18);
    assert.equal(info.ac.label, 'Armored (+2 Shield)');
    assert.deepEqual(info.ac.secondaries, ['Armored', '+2 Shield']);
    assert.equal(info.movement.primary, '30 ft');
    assert.equal(info.movement.secondary, '');
    assert.equal(info.hasResistances, false);
    assert.equal(info.hasImmunities, false);
    assert.equal(info.hasVulnerabilities, false);
    assert.equal(info.hasLanguages, true);
    assert.deepEqual(info.languages, ['Common', 'Dwarvish']);
    assert.equal(info.hasBiography, true);

    // Null actor handling
    assert.equal(await adapter.getTokenInfo(null), null);
});

test('Dnd5eSystemAdapter modifyContext triggers tokenInfo layout on Page 3', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const actor = {
        id: 'test-pc',
        name: 'Elven Ranger',
        img: 'icons/elf.png',
        system: {
            attributes: {
                ac: { value: 16 },
                movement: { walk: 35, units: 'ft' }
            },
            traits: {
                size: 'med',
                dr: { value: [] },
                di: { value: [] },
                ci: { value: ['charmed'] },
                dv: { value: [] },
                languages: { value: ['common', 'elvish'] }
            },
            details: {
                race: 'Elf',
                biography: { value: 'Forest guardian.' }
            }
        }
    };

    const context = {
        items: [{ id: 'item-1', name: 'Bow' }],
        itemTypes: [{ id: 'weapon' }],
        actionTypes: [{ id: 'economy' }],
        layout: 'flat'
    };

    await adapter.modifyContext(context, { activePage: 3, actor });

    assert.equal(context.layout, 'tokenInfo');
    assert.equal(context.isCategorized, false);
    assert.deepEqual(context.itemTypes, []);
    assert.deepEqual(context.actionTypes, []);
    assert.ok(context.tokenInfo);
    assert.equal(context.tokenInfo.name, 'Elven Ranger');
    assert.equal(context.tokenInfo.ac.value, 16);
    assert.equal(context.tokenInfo.movement.primary, '35 ft');
    assert.deepEqual(context.tokenInfo.languages, ['Common', 'Elvish']);
    assert.deepEqual(context.tokenInfo.conditionImmunities, ['Charmed']);
});

test('Dnd5eSystemAdapter getTokenInfo collapses languages to All when all is selected', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    // 1. Array containing 'all' alongside specific languages
    const actorWithAll = {
        id: 'actor-all-lang',
        name: 'Solar',
        system: {
            attributes: { ac: { value: 21 }, movement: { walk: 50, units: 'ft' } },
            traits: {
                languages: {
                    value: ['all', 'common', 'celestial', 'draconic', 'elvish'],
                    custom: '',
                    communication: 'Telepathy 120 ft.'
                }
            },
            details: {}
        }
    };

    const info1 = await adapter.getTokenInfo(actorWithAll);
    assert.deepEqual(info1.languages, ['All', 'Telepathy 120 ft.']);

    // 2. Custom string indicating all languages
    const actorCustomAll = {
        id: 'actor-custom-all',
        name: 'Omnilingual Being',
        system: {
            attributes: { ac: { value: 10 }, movement: { walk: 30, units: 'ft' } },
            traits: {
                languages: {
                    value: [],
                    custom: 'all languages'
                }
            },
            details: {}
        }
    };

    const info2 = await adapter.getTokenInfo(actorCustomAll);
    assert.deepEqual(info2.languages, ['All']);
});

test('Dnd5eSystemAdapter getTokenInfo extracts senses from modern D&D5e 5.3+ senses.ranges and legacy senses schema', async () => {
    // 1. Modern D&D5e 5.3+ schema with senses.ranges (with throwing legacy getters to ensure zero access)
    game.system = { id: 'dnd5e', version: '5.3.0' };
    const modernAdapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    assert.ok(modernAdapter instanceof Dnd5eSystemAdapter_5_3);

    const modernActor = {
        id: 'actor-modern-senses',
        name: 'Modern Beast',
        system: {
            attributes: {
                ac: { value: 15 },
                movement: { walk: 30, units: 'ft' },
                senses: {
                    ranges: {
                        darkvision: 60,
                        blindsight: 30,
                        tremorsense: 15,
                        truesight: 120
                    },
                    units: 'ft',
                    special: 'Echolocation',
                    get darkvision() { throw new Error('Deprecated since DnD5e 5.3: use ranges.darkvision'); },
                    get blindsight() { throw new Error('Deprecated since DnD5e 5.3: use ranges.blindsight'); },
                    get tremorsense() { throw new Error('Deprecated since DnD5e 5.3: use ranges.tremorsense'); },
                    get truesight() { throw new Error('Deprecated since DnD5e 5.3: use ranges.truesight'); }
                }
            },
            traits: {},
            details: {}
        }
    };

    const modernInfo = await modernAdapter.getTokenInfo(modernActor);
    assert.equal(modernInfo.hasSenses, true);
    assert.ok(modernInfo.senses.includes('Darkvision 60 ft'));
    assert.ok(modernInfo.senses.includes('Blindsight 30 ft'));
    assert.ok(modernInfo.senses.includes('Tremorsense 15 ft'));
    assert.ok(modernInfo.senses.includes('Truesight 120 ft'));
    assert.ok(modernInfo.senses.includes('Echolocation'));

    // 2. Legacy pre-5.3 schema with direct top-level senses
    game.system = { id: 'dnd5e', version: '4.3.0' };
    const legacyAdapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    assert.ok(legacyAdapter instanceof BaseDnd5eSystemAdapter);

    const legacyActor = {
        id: 'actor-legacy-senses',
        name: 'Legacy Beast',
        system: {
            attributes: {
                ac: { value: 12 },
                movement: { walk: 30, units: 'ft' },
                senses: {
                    darkvision: 60,
                    blindsight: 10,
                    tremorsense: 0,
                    truesight: 0,
                    units: 'ft',
                    special: 'Tremorsense awareness'
                }
            },
            traits: {},
            details: {}
        }
    };

    const legacyInfo = await legacyAdapter.getTokenInfo(legacyActor);
    assert.equal(legacyInfo.hasSenses, true);
    assert.ok(legacyInfo.senses.includes('Darkvision 60 ft'));
    assert.ok(legacyInfo.senses.includes('Blindsight 10 ft'));
    assert.ok(!legacyInfo.senses.some(s => s.startsWith('Tremorsense 0')));
    assert.ok(!legacyInfo.senses.some(s => s.startsWith('Truesight')));
    assert.ok(legacyInfo.senses.includes('Tremorsense awareness'));
});

test('Dnd5eSystemAdapter getTokenInfo extracts Special (; separated) and Ranged Communication correctly', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    // 1. Semicolon-separated special languages and communication
    const actorSpecial = {
        id: 'actor-special-lang',
        name: 'Mind Flayer',
        system: {
            attributes: { ac: { value: 15 }, movement: { walk: 30, units: 'ft' } },
            traits: {
                languages: {
                    value: ['deep', 'undercommon'],
                    special: 'understands Common and Goblin but cannot speak; telepathy 120 ft.; communicates through thought projection',
                    units: 'ft'
                }
            },
            details: {}
        }
    };

    const info1 = await adapter.getTokenInfo(actorSpecial);
    assert.deepEqual(info1.languages, [
        'Deep Speech',
        'Undercommon',
        'understands Common and Goblin but cannot speak',
        'telepathy 120 ft.',
        'communicates through thought projection'
    ]);

    // 2. Ranged Communication objects
    const actorRanged = {
        id: 'actor-ranged-comm',
        name: 'Aboleth',
        system: {
            attributes: { ac: { value: 17 }, movement: { walk: 10, swim: 40, units: 'ft' } },
            traits: {
                languages: {
                    value: ['deep'],
                    communication: {
                        telepathy: 120
                    },
                    units: 'ft'
                }
            },
            details: {}
        }
    };

    const info2 = await adapter.getTokenInfo(actorRanged);
    assert.deepEqual(info2.languages, [
        'Deep Speech',
        'Telepathy 120 ft'
    ]);

    // 3. Structured Ranged Communication with custom units
    const actorMetric = {
        id: 'actor-metric-comm',
        name: 'Alien',
        system: {
            attributes: { ac: { value: 12 }, movement: { walk: 9, units: 'm' } },
            traits: {
                languages: {
                    value: ['common'],
                    communication: {
                        telepathy: { value: 30, units: 'm' }
                    }
                }
            },
            details: {}
        }
    };

    const info3 = await adapter.getTokenInfo(actorMetric);
    assert.deepEqual(info3.languages, [
        'Common',
        'Telepathy 30 m'
    ]);
});

test('Dnd5eSystemAdapter and Dnd5eSystemTabFilterManager do not match spell components on non-spell items (weapons, feats, attacks)', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const filterManager = adapter.filterManager;

    const flail = {
        id: 'flail-1',
        name: 'Triple Flail',
        type: 'weapon',
        img: 'icons/flail.png',
        system: {
            equipped: true,
            material: { value: 'steel' },
            properties: new Set(['ver', 'mgc']),
            activities: new Map([
                ['act1', {
                    id: 'act1',
                    name: 'Triple Flail Attack',
                    type: 'attack',
                    activation: { type: 'action', override: false },
                    use: () => {}
                }]
            ])
        }
    };

    const bite = {
        id: 'bite-1',
        name: 'Bite',
        type: 'feat',
        img: 'icons/bite.png',
        system: {
            activities: new Map([
                ['act2', {
                    id: 'act2',
                    name: 'Bite Attack',
                    type: 'attack',
                    activation: { type: 'action', override: false },
                    use: () => {}
                }]
            ])
        }
    };

    const charge = {
        id: 'charge-1',
        name: 'Charge',
        type: 'feat',
        img: 'icons/charge.png',
        system: {
            activities: new Map([
                ['act3', {
                    id: 'act3',
                    name: 'Charge',
                    type: 'utility',
                    activation: { type: 'special', override: false },
                    use: () => {}
                }]
            ])
        }
    };

    const fearSpell = {
        id: 'fear-1',
        name: 'Fear',
        type: 'spell',
        img: 'icons/fear.png',
        system: {
            level: 3,
            method: 'innate',
            prepared: true,
            properties: new Set(['vocal', 'somatic', 'material']),
            activities: new Map([
                ['act4', {
                    id: 'act4',
                    name: 'Cast Fear',
                    type: 'cast',
                    activation: { type: 'action', override: false },
                    use: () => {}
                }]
            ])
        }
    };

    const actor = {
        items: new Map([
            ['flail-1', flail],
            ['bite-1', bite],
            ['charge-1', charge],
            ['fear-1', fearSpell]
        ])
    };

    const actions = [
        { originalItem: flail },
        { originalItem: bite },
        { originalItem: charge },
        { originalItem: fearSpell }
    ];

    const modified = await adapter.modifyActions(actions, actor);
    const flailAction = modified.find(a => a.name === 'Triple Flail');
    const biteAction = modified.find(a => a.name === 'Bite');
    const chargeAction = modified.find(a => a.name === 'Charge');
    const fearAction = modified.find(a => a.name === 'Fear');

    // Verify component tabs are NOT assigned to non-spell actions
    assert.equal(filterManager.requiresComponent(flailAction.subactions[0], 'vocal'), false);
    assert.equal(filterManager.requiresComponent(flailAction.subactions[0], 'somatic'), false);
    assert.equal(filterManager.requiresComponent(flailAction.subactions[0], 'material'), false);
    assert.equal(filterManager.requiresComponent(biteAction.subactions[0], 'vocal'), false);
    assert.equal(filterManager.requiresComponent(chargeAction.subactions[0], 'vocal'), false);

    // Verify component tabs ARE assigned to spell actions
    assert.equal(filterManager.requiresComponent(fearAction.subactions[0], 'vocal'), true);
    assert.equal(filterManager.requiresComponent(fearAction.subactions[0], 'somatic'), true);
    assert.equal(filterManager.requiresComponent(fearAction.subactions[0], 'material'), true);

    const groups = {
        'all': { getAllSubTabIds: () => new Set(['all']) },
        'economy': { getAllSubTabIds: () => new Set(['action', 'bonus', 'reaction', 'special', 'none']) },
        'components': { getAllSubTabIds: () => new Set(['vocal', 'somatic', 'material']) }
    };

    // Filter context with verbal banned
    const filterContextVerbalBanned = {
        right: {
            activeParents: new Set(['all', 'components']),
            activeSubTypes: new Set(['vocal']),
            groups
        }
    };

    assert.equal(filterManager.matchesEconomyTabs(flailAction, filterContextVerbalBanned), true, 'Triple Flail visible when vocal banned');
    assert.equal(filterManager.matchesEconomyTabs(biteAction, filterContextVerbalBanned), true, 'Bite visible when vocal banned');
    assert.equal(filterManager.matchesEconomyTabs(chargeAction, filterContextVerbalBanned), true, 'Charge visible when vocal banned');
    assert.equal(filterManager.matchesEconomyTabs(fearAction, filterContextVerbalBanned), false, 'Fear filtered out when vocal banned');

    // Filter context with somatic banned
    const filterContextSomaticBanned = {
        right: {
            activeParents: new Set(['all', 'components']),
            activeSubTypes: new Set(['somatic']),
            groups
        }
    };

    assert.equal(filterManager.matchesEconomyTabs(flailAction, filterContextSomaticBanned), true, 'Triple Flail visible when somatic banned');
    assert.equal(filterManager.matchesEconomyTabs(biteAction, filterContextSomaticBanned), true, 'Bite visible when somatic banned');
    assert.equal(filterManager.matchesEconomyTabs(fearAction, filterContextSomaticBanned), false, 'Fear filtered out when somatic banned');

    // Filter context with material banned
    const filterContextMaterialBanned = {
        right: {
            activeParents: new Set(['all', 'components']),
            activeSubTypes: new Set(['material']),
            groups
        }
    };

    assert.equal(filterManager.matchesEconomyTabs(flailAction, filterContextMaterialBanned), true, 'Triple Flail visible when material banned');
    assert.equal(filterManager.matchesEconomyTabs(biteAction, filterContextMaterialBanned), true, 'Bite visible when material banned');
    assert.equal(filterManager.matchesEconomyTabs(fearAction, filterContextMaterialBanned), false, 'Fear filtered out when material banned');

    // Filter context after verbal unbanned
    const filterContextUnbanned = {
        right: {
            activeParents: new Set(['all']),
            activeSubTypes: new Set([]),
            groups
        }
    };

    assert.equal(filterManager.matchesEconomyTabs(flailAction, filterContextUnbanned), true, 'Triple Flail visible when unbanned');
    assert.equal(filterManager.matchesEconomyTabs(biteAction, filterContextUnbanned), true, 'Bite visible when unbanned');
    assert.equal(filterManager.matchesEconomyTabs(chargeAction, filterContextUnbanned), true, 'Charge visible when unbanned');
    assert.equal(filterManager.matchesEconomyTabs(fearAction, filterContextUnbanned), true, 'Fear visible when unbanned');
});

test('Dnd5eSystemContextModifier sorts components sub-tabs strictly in order: vocal -> somatic -> material', () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const orderVocal = adapter.getActionSubTabSortOrder('components', 'vocal');
    const orderSomatic = adapter.getActionSubTabSortOrder('components', 'somatic');
    const orderMaterial = adapter.getActionSubTabSortOrder('components', 'material');

    assert.ok(orderVocal < orderSomatic, 'vocal should come before somatic');
    assert.ok(orderSomatic < orderMaterial, 'somatic should come before material');
});

test('Dnd5eSystemTabFilterManager recognizes material components across standard properties and components', () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const filterManager = adapter.filterManager;

    // 1. properties Set with 'material'
    const spellWithMatProp = {
        type: 'spell',
        system: { properties: new Set(['vocal', 'material']) }
    };
    const actionWithMatProp = new Action({
        id: 'spell-mat-prop',
        name: 'Spell With Mat Prop',
        originalItem: spellWithMatProp
    });
    assert.equal(filterManager.requiresComponent(actionWithMatProp, 'material'), true);
    assert.equal(itemHasComponent(spellWithMatProp, 'material'), true);

    // 2. components boolean map { m: true }
    const spellWithCompMap = {
        type: 'spell',
        system: {
            components: { v: true, m: true }
        }
    };
    const actionWithCompMap = new Action({
        id: 'spell-comp-map',
        name: 'Spell With Comp Map',
        originalItem: spellWithCompMap
    });
    assert.equal(filterManager.requiresComponent(actionWithCompMap, 'material'), true);
    assert.equal(itemHasComponent(spellWithCompMap, 'material'), true);
});

test('Dnd5eSystemAdapter recordManualTabToggle handles vocal, somatic, and material toggles', () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    let flagWritten = null;
    const actor = {
        isOwner: true,
        getFlag: (scope, key) => {
            if (key === 'autoBanState') {
                return {
                    conditions: { vocal: ['silenced'], material: ['disarmed'] },
                    manualUnbans: {}
                };
            }
            return null;
        },
        setFlag: async (scope, key, val) => {
            flagWritten = { scope, key, val };
            return actor;
        }
    };

    adapter.recordManualTabToggle(actor, 'components', 'material', false);
    assert.ok(flagWritten !== null);
    assert.equal(flagWritten.val.manualUnbans.material, true);
});

test('Dnd5eSystemAdapter and ActionDisplayApp populate all canonical spell components (vocal, somatic, material) under components tab', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    assert.deepEqual(adapter.getExclusionSubTabs('components'), ['vocal', 'somatic', 'material']);

    const actor = {
        id: 'actor-akra-test',
        isOwner: true,
        flags: {
            'bakana-action-display': {
                autoBanState: {
                    conditions: { vocal: ['incapacitated'], somatic: ['incapacitated'] },
                    manualUnbans: { vocal: true, somatic: true }
                }
            }
        },
        getFlag: (s, k) => actor.flags?.[s]?.[k],
        system: {
            spells: {
                spell1: { value: 0 },
                spell2: { value: 0 },
                pact: { value: 0 }
            }
        },
        items: [
            // Cantrip 1: Vocal only
            {
                id: 'cantrip-thaum',
                name: 'Thaumaturgy',
                type: 'spell',
                system: {
                    level: 0,
                    method: 'spell',
                    prepared: 0,
                    properties: new Set(['vocal']),
                    activities: {
                        a1: { id: 'a1', type: 'utility', activation: { type: 'action' } }
                    }
                }
            },
            // Cantrip 2: Vocal + Somatic
            {
                id: 'cantrip-guide',
                name: 'Guidance',
                type: 'spell',
                system: {
                    level: 0,
                    method: 'spell',
                    prepared: 0,
                    properties: new Set(['vocal', 'somatic']),
                    activities: {
                        a2: { id: 'a2', type: 'utility', activation: { type: 'action' } }
                    }
                }
            },
            // Level 1 spell (depleted because spell1.value === 0): Vocal + Somatic + Material
            {
                id: 'spell-bless',
                name: 'Bless',
                type: 'spell',
                system: {
                    level: 1,
                    method: 'spell',
                    prepared: 1,
                    properties: new Set(['vocal', 'somatic', 'material']),
                    materials: { value: 'A sprinkling of holy water' },
                    activities: {
                        a3: { id: 'a3', type: 'utility', activation: { type: 'action' }, consumption: { spellSlot: true } }
                    }
                }
            }
        ]
    };

    const { ActionDisplayApp } = await import('../../src/ui/action-display-app.js');
    const { actionDisplay } = await import('../../src/action-display.js');
    actionDisplay.registerSystemAdapter(adapter);

    const token = { id: 'tok-akra-test', document: { id: 'tok-akra-test', isOwner: true }, actor };
    const app = new ActionDisplayApp(token);
    const context = await app._prepareContext();

    const componentsTab = context.actionTypes.find(t => t.id === 'components');
    assert.ok(componentsTab !== undefined, 'components tab should be present');
    assert.deepEqual(componentsTab.subTabs.map(s => s.id), ['vocal', 'somatic', 'material'], 'components tab must include vocal, somatic, and material');

    await app.close();
});

test('Dnd5eSystemAdapter getInspiration and toggleInspiration contracts', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    // 1. Character actor with inspiration: true
    const pcInspired = {
        type: 'character',
        system: { attributes: { inspiration: true } }
    };
    assert.deepEqual(adapter.getInspiration(pcInspired), { supported: true, value: true });

    // 2. Character actor with inspiration: false
    const pcUninspired = {
        type: 'character',
        system: { attributes: { inspiration: false } }
    };
    assert.deepEqual(adapter.getInspiration(pcUninspired), { supported: true, value: false });

    // 3. NPC actor without inspiration attribute
    const npc = {
        type: 'npc',
        system: { attributes: {} }
    };
    assert.deepEqual(adapter.getInspiration(npc), { supported: false, value: false });

    // 4. Toggle inspiration flips boolean value via actor.update
    let updatedPayload = null;
    const actorToToggle = {
        type: 'character',
        system: { attributes: { inspiration: false } },
        update: async (data) => {
            updatedPayload = data;
            actorToToggle.system.attributes.inspiration = data['system.attributes.inspiration'];
            return data;
        }
    };

    const nextState1 = await adapter.toggleInspiration(actorToToggle);
    assert.equal(nextState1, true);
    assert.deepEqual(updatedPayload, { 'system.attributes.inspiration': true });

    const nextState2 = await adapter.toggleInspiration(actorToToggle);
    assert.equal(nextState2, false);
    assert.deepEqual(updatedPayload, { 'system.attributes.inspiration': false });

    // 5. Explicit force parameter
    await adapter.toggleInspiration(actorToToggle, true);
    assert.equal(actorToToggle.system.attributes.inspiration, true);

    await adapter.toggleInspiration(actorToToggle, true);
    assert.equal(actorToToggle.system.attributes.inspiration, true);

    // 6. Null actor safety
    assert.deepEqual(adapter.getInspiration(null), { supported: false, value: false });
    assert.equal(await adapter.toggleInspiration(null), false);
});

test('Dnd5eSystemAdapter getTokenInfo extracts inspiration and showInspiration properties', async () => {
    const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const pcActor = {
        id: 'hero-insp',
        type: 'character',
        name: 'Elminster',
        system: {
            attributes: {
                inspiration: true,
                ac: { value: 15 },
                movement: { walk: 30 }
            },
            traits: { size: 'med' },
            details: { biography: { value: '' } }
        }
    };

    const info = await adapter.getTokenInfo(pcActor, null);
    assert.equal(info.inspiration, true);
    assert.equal(info.showInspiration, true);

    const npcActor = {
        id: 'npc-no-insp',
        type: 'npc',
        name: 'Goblin',
        system: {
            attributes: {
                ac: { value: 12 },
                movement: { walk: 30 }
            },
            traits: { size: 'sm' },
            details: { biography: { value: '' } }
        }
    };

    const npcInfo = await adapter.getTokenInfo(npcActor, null);
    assert.equal(npcInfo.inspiration, false);
    assert.equal(npcInfo.showInspiration, false);
});


