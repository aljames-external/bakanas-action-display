import { FoundryV12Adapter } from "../../src/adapters/foundry/foundry-v12-adapter.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import '../setup.js';
import { MODULE_ID } from '../../src/constants.js';
import { BaseSystemAdapter } from '../../src/adapters/system/base-system-adapter.js';
import { Dnd5eSystemAdapter } from '../../src/adapters/system/dnd5e/index.js';
import { Pf1SystemAdapter } from '../../src/adapters/system/pf1-system-adapter.js';
import { Pf2eSystemAdapter } from '../../src/adapters/system/pf2e-system-adapter.js';
import { adapter } from '../../src/adapters/index.js';
import { TabRef } from '../../src/ui/tab-ref.js';
import { ActionDisplayApp } from '../../src/ui/action-display-app.js';
import { EconomyColorsConfigApp } from '../../src/ui/economy-colors-config-app.js';
import { buildSubactionMenuItem, showActivityDropdown } from '../../src/ui/app/dropdown-manager.js';

test('BaseSystemAdapter provides default economy types, colors, and grey fallback for undefined', () => {
    const baseAdapter = new BaseSystemAdapter('generic', false, new FoundryV12Adapter());
    const types = baseAdapter.getEconomyTypes();
    assert.ok(Array.isArray(types));
    assert.ok(types.some(t => t.id === 'action' && t.defaultColor === '#3b82f6'));
    assert.ok(types.some(t => t.id === 'bonus' && t.defaultColor === '#14b8a6'));
    assert.ok(types.some(t => t.id === 'reaction' && t.defaultColor === '#ef4444'));

    // Default colors
    assert.equal(baseAdapter.getEconomyColor('action'), '#3b82f6');
    assert.equal(baseAdapter.getEconomyColor('bonus'), '#14b8a6');
    assert.equal(baseAdapter.getEconomyColor('reaction'), '#ef4444');
    assert.equal(baseAdapter.getEconomyColor('special'), '#a855f7');
    
    // User color overrides
    assert.equal(baseAdapter.getEconomyColor('action', { action: '#ff00ff' }), '#ff00ff');

    // Unmapped/undefined types fallback to other / grey when other is enabled
    assert.equal(baseAdapter.getEconomyColor('unknown_type', { enabled: { other: true } }), '#64748b');
    assert.equal(baseAdapter.getEconomyColor('unknown_type', { enabled: { other: true }, other: '#333333' }), '#333333');

    // Disabled categories return null
    assert.equal(baseAdapter.getEconomyColor('action', { disabled: { action: true } }), null);
    assert.equal(baseAdapter.getEconomyColor('bonus', { disabled: ['bonus'] }), null);
    assert.equal(baseAdapter.getEconomyColor('unknown_type', { disabled: { other: true } }), null);

    // 'none' or 'all' return null (no indicator)
    assert.equal(baseAdapter.getEconomyColor('none'), null);
    assert.equal(baseAdapter.getEconomyColor('all'), null);
    assert.equal(baseAdapter.getEconomyColor(null), null);
});

test('Dnd5eSystemAdapter provides system-specific action economy types including lair and legendary', () => {
    const dndAdapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const types = dndAdapter.getEconomyTypes();

    const action = types.find(t => t.id === 'action');
    const bonus = types.find(t => t.id === 'bonus');
    const reaction = types.find(t => t.id === 'reaction');
    const legendary = types.find(t => t.id === 'legendary');
    const lair = types.find(t => t.id === 'lair');

    assert.ok(action, 'Should include action');
    assert.equal(action.defaultColor, '#3b82f6', 'Action should be blue');

    assert.ok(bonus, 'Should include bonus action');
    assert.equal(bonus.defaultColor, '#14b8a6', 'Bonus action should be teal');

    assert.ok(reaction, 'Should include reaction');
    assert.equal(reaction.defaultColor, '#ef4444', 'Reaction should be red');

    assert.ok(legendary, 'Should include legendary action');
    assert.equal(legendary.defaultColor, '#18181b', 'Legendary action should be black');

    assert.ok(lair, 'Should include lair action');
    assert.equal(lair.defaultColor, '#eab308', 'Lair action should be gold');
});

test('extractEconomyIndicators extracts fixed slots equally dividing allocated space across enabled economy types', () => {
    const dndAdapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    // 1. Single action item with default settings (empty userColors) -> exactly 4 default-enabled categories (action, bonus, reaction, special)
    const singleAction = {
        name: 'Longsword',
        right: [TabRef.from('economy', 'action')]
    };
    const indicators1 = dndAdapter.extractEconomyIndicators(singleAction, {});
    assert.equal(indicators1.length, 4, 'Should provide 4 slots for the 4 default-enabled categories (action, bonus, reaction, special)');
    assert.equal(indicators1[0].type, 'action');
    assert.equal(indicators1[0].active, true);
    assert.equal(indicators1[0].color, '#3b82f6');
    assert.equal(indicators1[1].type, 'bonus');
    assert.equal(indicators1[1].active, false);
    assert.equal(indicators1[1].color, null);
    assert.equal(indicators1[2].type, 'reaction');
    assert.equal(indicators1[2].active, false);
    assert.equal(indicators1[2].color, null);
    assert.equal(indicators1[3].type, 'special');
    assert.equal(indicators1[3].active, false);
    assert.equal(indicators1[3].color, null);

    // 2. Multi-activity item with differing economy types (Action + Bonus Action + Reaction)
    const multiAction = {
        name: 'Flexible Spell',
        subactions: [
            { name: 'Standard Cast', right: [TabRef.from('economy', 'action')] },
            { name: 'Quick Cast', right: [TabRef.from('economy', 'bonus')] },
            { name: 'Counter Strike', right: [TabRef.from('economy', 'reaction')] },
            { name: 'Standard Cast 2', right: [TabRef.from('economy', 'action')] } // duplicate type
        ]
    };
    const indicators2 = dndAdapter.extractEconomyIndicators(multiAction, {});
    assert.equal(indicators2.length, 4, 'Should provide 4 slots for the 4 enabled categories');
    assert.equal(indicators2[0].type, 'action', 'Action should be first slot');
    assert.equal(indicators2[0].active, true);
    assert.equal(indicators2[0].color, '#3b82f6');
    assert.equal(indicators2[1].type, 'bonus', 'Bonus Action should be second slot');
    assert.equal(indicators2[1].active, true);
    assert.equal(indicators2[1].color, '#14b8a6');
    assert.equal(indicators2[2].type, 'reaction', 'Reaction should be third slot');
    assert.equal(indicators2[2].active, true);
    assert.equal(indicators2[2].color, '#ef4444');
    assert.equal(indicators2[3].type, 'special', 'Special should be fourth slot');
    assert.equal(indicators2[3].active, false);

    // 3. Multi-activity item with disabled economy categories (Bonus Action and Special disabled, only Action + Reaction enabled)
    const indicatorsWithDisabled = dndAdapter.extractEconomyIndicators(multiAction, { disabled: { bonus: true, special: true } });
    assert.equal(indicatorsWithDisabled.length, 2, 'Should only allocate 2 slots for the 2 enabled categories');
    assert.equal(indicatorsWithDisabled[0].type, 'action');
    assert.equal(indicatorsWithDisabled[0].active, true);
    assert.equal(indicatorsWithDisabled[1].type, 'reaction');
    assert.equal(indicatorsWithDisabled[1].active, true);

    // 4. Item with an explicitly enabled secondary type (e.g. minute enabled via enabledTypes, giving 5 slots)
    const indicatorsWithMinute = dndAdapter.extractEconomyIndicators(multiAction, { enabled: { minute: true } });
    assert.equal(indicatorsWithMinute.length, 5, 'Should allocate 5 slots when minute is explicitly enabled');
    assert.equal(indicatorsWithMinute[3].type, 'minute');
    assert.equal(indicatorsWithMinute[3].active, false);
    assert.equal(indicatorsWithMinute[4].type, 'special');
    assert.equal(indicatorsWithMinute[4].active, false);

    // 5. Passive item with economy: 'none'
    const passiveItem = {
        name: 'Shield of Faith (Passive)',
        right: [TabRef.from('economy', 'none')]
    };
    const indicators3 = dndAdapter.extractEconomyIndicators(passiveItem, {});
    assert.equal(indicators3.length, 4);
    assert.ok(indicators3.every(ind => ind.active === false && ind.color === null), 'All slots should be empty for passive items');
});

test('extractEconomyIndicators sorts indicators in the exact order of the action economy list top-to-bottom', () => {
    const dndAdapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const threeEnabledColors = {
        disabled: {
            minute: true, hour: true, day: true, longRest: true, shortRest: true,
            encounter: true, turnStart: true, turnEnd: true, legendary: true,
            mythic: true, lair: true, crew: true, special: true, other: true
        }
    };

    // Item with Bonus Action and Action defined in reverse order
    const reverseOrderAction = {
        name: 'Quick Weapon',
        subactions: [
            { name: 'Quick Slash', right: [TabRef.from('economy', 'bonus')] },
            { name: 'Standard Slash', right: [TabRef.from('economy', 'action')] }
        ]
    };
    const indicators = dndAdapter.extractEconomyIndicators(reverseOrderAction, threeEnabledColors);
    assert.equal(indicators.length, 3);
    // Action (sort 1) must come before Bonus Action (sort 2)
    assert.equal(indicators[0].type, 'action');
    assert.equal(indicators[0].active, true);
    assert.equal(indicators[1].type, 'bonus');
    assert.equal(indicators[1].active, true);
    assert.equal(indicators[2].type, 'reaction');
    assert.equal(indicators[2].active, false);
});

test('ActionDisplayApp _prepareContext extracts economy indicators when enabled and suppresses when disabled', async () => {
    const mockToken = {
        id: 'token-1',
        name: 'Hero',
        actor: {
            id: 'actor-1',
            name: 'Hero',
            uuid: 'Actor.actor-1',
            isOwner: true,
            getFlag: () => ({})
        }
    };
    const app = new ActionDisplayApp(mockToken);
    app.activeTab = 'all';

    const mockActions = [
        {
            id: 'act-1',
            name: 'Sword Slash',
            available: true,
            left: [TabRef.from('item_type', 'weapon')],
            right: [TabRef.from('economy', 'action')]
        },
        {
            id: 'act-2',
            name: 'Misty Step',
            available: true,
            left: [TabRef.from('item_type', 'spell')],
            right: [TabRef.from('economy', 'bonus')]
        }
    ];

    // Mock getActions
    const origGetActions = adapter.getActions;
    adapter.getActions = async () => mockActions;

    const testColors = {
        action: '#0000ff',
        disabled: {
            minute: true, hour: true, day: true, longRest: true, shortRest: true,
            encounter: true, turnStart: true, turnEnd: true, legendary: true,
            mythic: true, lair: true, crew: true, special: true, other: true
        }
    };

    try {
        // 1. When enableEconomyIndicators is true
        game.settings.set(MODULE_ID, 'enableEconomyIndicators', true);
        game.settings.set(MODULE_ID, 'economyColors', testColors);

        const contextEnabled = await app._prepareContext({});
        const item1 = contextEnabled.items.find(i => i.id === 'act-1');
        const item2 = contextEnabled.items.find(i => i.id === 'act-2');
        assert.equal(contextEnabled.showEconomyIndicators, true);
        assert.equal(item1.economyIndicators.length, 3);
        assert.equal(item1.economyIndicators[0].active, true);
        assert.equal(item1.economyIndicators[0].color, '#0000ff');
        assert.equal(item1.economyIndicators[1].active, false);
        assert.equal(item2.economyIndicators.length, 3);
        assert.equal(item2.economyIndicators[0].active, false);
        assert.equal(item2.economyIndicators[1].active, true);
        assert.equal(item2.economyIndicators[1].color, '#14b8a6');

        // 2. When specific category is disabled (e.g. bonus action disabled)
        game.settings.set(MODULE_ID, 'economyColors', {
            ...testColors,
            disabled: { ...testColors.disabled, bonus: true }
        });
        const contextCategoryDisabled = await app._prepareContext({});
        const catDisItem1 = contextCategoryDisabled.items.find(i => i.id === 'act-1');
        const catDisItem2 = contextCategoryDisabled.items.find(i => i.id === 'act-2');
        assert.equal(catDisItem1.economyIndicators.length, 2);
        assert.equal(catDisItem1.economyIndicators[0].active, true);
        assert.equal(catDisItem2.economyIndicators.length, 2);
        assert.equal(catDisItem2.economyIndicators.every(ind => !ind.active), true);

        // 3. When enableEconomyIndicators is false
        game.settings.set(MODULE_ID, 'enableEconomyIndicators', false);
        const contextDisabled = await app._prepareContext({});
        assert.equal(contextDisabled.showEconomyIndicators, false);
        assert.equal(contextDisabled.items[0].economyIndicators.length, 0);
        assert.equal(contextDisabled.items[1].economyIndicators.length, 0);
    } finally {
        adapter.getActions = origGetActions;
        game.settings.set(MODULE_ID, 'enableEconomyIndicators', false);
    }
});

test('EconomyColorsConfigApp prepares economy context, toggles enablement, saves colors, selects presets, and resets defaults', async () => {
    game.settings.set(MODULE_ID, 'enableEconomyIndicators', false);
    game.settings.set(MODULE_ID, 'economyColors', { action: '#123456', disabled: { reaction: true } });

    const configApp = new EconomyColorsConfigApp();
    const context = await configApp._prepareContext({});

    assert.equal(context.enabled, false);
    assert.ok(Array.isArray(context.economyTypes));
    const actionType = context.economyTypes.find(t => t.id === 'action');
    assert.ok(actionType);
    assert.equal(actionType.color, '#123456');
    assert.equal(actionType.enabled, true);

    const reactionType = context.economyTypes.find(t => t.id === 'reaction');
    assert.ok(reactionType);
    assert.equal(reactionType.enabled, false);

    assert.ok(Array.isArray(context.presets));
    assert.ok(context.presets.some(p => p.id === 'protanopia'));
    assert.ok(context.presets.some(p => p.id === 'tritanopia'));

    // Test toggle master enablement
    await configApp._onToggleEnabled({ preventDefault() {} }, { checked: true });
    assert.equal(configApp.enabled, true);

    // Test toggle individual category enablement
    await configApp._onToggleTypeEnabled({ preventDefault() {} }, { dataset: { typeId: 'action' }, checked: false });
    assert.equal(configApp.disabled.action, true);
    await configApp._onToggleTypeEnabled({ preventDefault() {} }, { dataset: { typeId: 'reaction' }, checked: true });
    assert.equal(configApp.disabled.reaction, undefined);

    // Test select preset (e.g. protanopia)
    let rendered = false;
    configApp.render = () => { rendered = true; };
    configApp.applyPreset('protanopia');
    assert.equal(configApp.selectedPreset, 'protanopia');
    assert.equal(configApp.colors.action, '#0072b2');
    assert.equal(configApp.colors.reaction, '#d55e00');
    assert.equal(rendered, true);

    // Test save
    configApp.colors = { action: '#abcdef', bonus: '#654321' };
    configApp.disabled = { minute: true };
    let closed = false;
    configApp.close = async () => { closed = true; };
    await configApp._onSaveConfig({ preventDefault() {} });

    assert.equal(game.settings.get(MODULE_ID, 'enableEconomyIndicators'), true);
    const savedColors = game.settings.get(MODULE_ID, 'economyColors');
    assert.equal(savedColors.action, '#abcdef');
    assert.equal(savedColors.bonus, '#654321');
    assert.deepEqual(savedColors.disabled, { minute: true });
    assert.equal(closed, true);

    // Test reset defaults
    rendered = false;
    await configApp._onResetDefaults({ preventDefault() {} });
    assert.deepEqual(configApp.colors, {});
    assert.deepEqual(configApp.disabled, {});
    assert.equal(configApp.selectedPreset, '');
    assert.equal(rendered, true);

    // Clean up
    game.settings.set(MODULE_ID, 'enableEconomyIndicators', false);
});

test('Dropdown context menu actions segmentation when economy colors are disabled and enabled', async () => {
    const actAction = {
        name: 'Standard Attack',
        img: 'icons/svg/sword.svg',
        uses: { available: 5, max: 10 },
        right: [TabRef.from('economy', 'action')],
        roll: () => {}
    };

    const actBonus = {
        name: 'Quick Strike',
        img: 'icons/svg/daze.svg',
        uses: { available: 0, max: 1 },
        right: [TabRef.from('economy', 'bonus')],
        roll: () => {}
    };

    const actPassive = {
        name: 'Passive Flow',
        uses: null,
        right: [],
        roll: () => {}
    };

    // 1. When action economy colors are DISABLED
    await game.settings.set(MODULE_ID, 'enableEconomyIndicators', false);

    const itemDisabled1 = buildSubactionMenuItem(actAction, {});
    assert.equal(itemDisabled1.name, 'Standard Attack');
    assert.equal(itemDisabled1.economyHtml, '');
    assert.ok(itemDisabled1.usesSlotHtml.includes('bad-action-uses-slot'));
    assert.ok(itemDisabled1.usesSlotHtml.includes('5 / 10'));

    const itemDisabledPassive = buildSubactionMenuItem(actPassive, {});
    assert.equal(itemDisabledPassive.name, 'Passive Flow');
    assert.equal(itemDisabledPassive.economyHtml, '');
    assert.equal(itemDisabledPassive.usesSlotHtml, '<div class="bad-action-uses-slot"></div>');

    // 2. When action economy colors are ENABLED
    await game.settings.set(MODULE_ID, 'enableEconomyIndicators', true);
    await game.settings.set(MODULE_ID, 'economyColors', {});

    const itemEnabledAction = buildSubactionMenuItem(actAction, {});
    assert.ok(itemEnabledAction.economyHtml.includes('bad-economy-bars'));
    assert.ok(itemEnabledAction.economyHtml.includes('background-color: #3b82f6'));
    assert.ok(itemEnabledAction.usesSlotHtml.includes('5 / 10'));

    const itemEnabledBonus = buildSubactionMenuItem(actBonus, {});
    assert.ok(itemEnabledBonus.economyHtml.includes('bad-economy-bars'));
    assert.ok(itemEnabledBonus.economyHtml.includes('background-color: #14b8a6'));
    assert.ok(itemEnabledBonus.usesSlotHtml.includes('depleted'));

    // 3. Verify showActivityDropdown populates li DOM elements with exact segmented structure
    const mockApp = {
        _activeLeftClickMenu: null,
        _activeMenuTarget: null,
        element: { ownerDocument: { body: document.body } },
        actor: { isOwner: true }
    };

    const liElements = [
        { dataset: {}, innerHTML: '', addEventListener: () => {}, querySelector: () => null },
        { dataset: {}, innerHTML: '', addEventListener: () => {}, querySelector: () => null }
    ];

    const mockTarget = {
        classList: { add: () => {}, remove: () => {} },
        getBoundingClientRect: () => ({ left: 100, top: 200, right: 300, bottom: 230, width: 200, height: 30 })
    };

    const originalQuerySelector = document.querySelector;
    const mockMenuEl = {
        style: { setProperty: () => {} },
        children: [],
        querySelectorAll: (sel) => {
            if (sel.includes('.context-item')) {
                return liElements;
            }
            return [];
        },
        remove: () => {}
    };

    document.querySelector = (sel) => {
        if (sel.includes('#context-menu') || sel.includes('.context-menu')) return mockMenuEl;
        return null;
    };

    try {
        await showActivityDropdown(mockApp, mockTarget, [actAction, actBonus], { preventDefault() {}, stopPropagation() {} });
        
        assert.equal(liElements.length, 2);
        // Both LIs should have icon, bad-action-name, bad-economy-bars, and bad-action-uses-slot
        for (const li of liElements) {
            assert.ok(li.innerHTML.includes('bad-menu-icon-wrap'), 'Should include icon wrap');
            assert.ok(li.innerHTML.includes('bad-action-name'), 'Should include bad-action-name');
            assert.ok(li.innerHTML.includes('bad-economy-bars'), 'Should include bad-economy-bars');
            assert.ok(li.innerHTML.includes('bad-action-uses-slot'), 'Should include bad-action-uses-slot');
        }

        // Find LIs corresponding to each subaction
        const quickLi = liElements.find(li => li.innerHTML.includes('Quick Strike'));
        const standardLi = liElements.find(li => li.innerHTML.includes('Standard Attack'));
        assert.ok(standardLi?.innerHTML.includes('#3b82f6'), 'Should have blue action color');
        assert.ok(quickLi?.innerHTML.includes('#14b8a6'), 'Should have teal bonus color');
    } finally {
        document.querySelector = originalQuerySelector;
        await game.settings.set(MODULE_ID, 'enableEconomyIndicators', false);
    }
});

test('extractEconomyIndicators generates stylized tooltips and dropdown items use data-tooltip', () => {
    const dndAdapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const action = {
        name: 'Fireball',
        right: [TabRef.from('economy', 'action')]
    };
    const indicators = dndAdapter.extractEconomyIndicators(action, {});
    const actionSlot = indicators.find(i => i.type === 'action');
    assert.ok(actionSlot.tooltip, 'Active slot should have tooltip');
    assert.ok(actionSlot.tooltip.includes('bad-economy-tooltip'), 'Tooltip should contain bad-economy-tooltip');
    assert.ok(actionSlot.tooltip.includes('bad-economy-tooltip-header'), 'Tooltip should contain bad-economy-tooltip-header');
    assert.ok(actionSlot.tooltip.includes('#3b82f6'), 'Tooltip should contain action color');
    assert.ok(actionSlot.tooltip.includes('Action'), 'Tooltip should contain Action label');
    assert.equal(actionSlot.tooltip.includes('Action Economy'), false, 'Tooltip should not contain Action Economy');
    assert.equal(actionSlot.tooltip.includes('bad-economy-tooltip-category'), false, 'Tooltip should not contain bad-economy-tooltip-category');

    const bonusSlot = indicators.find(i => i.type === 'bonus');
    assert.equal(bonusSlot.tooltip, '', 'Inactive slot should have empty tooltip');
});
