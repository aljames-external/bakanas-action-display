import '../setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { adapter, Adapter, FoundryV12Adapter, BaseFoundryAdapter, FoundryV13Adapter, BaseSystemAdapter } from '../../src/adapters/index.js';
import { initializeFoundryAdapter } from '../../src/adapters/foundry/index.js';
import { initializeSystemAdapter } from '../../src/adapters/system/index.js';
import { initializeModuleAdapters } from '../../src/adapters/module/index.js';
import { MODULE_ID } from '../../src/constants.js';
import { log } from '../../src/lib/logger.js';

test('initializeFoundryAdapter returns FoundryV12Adapter on v12, FoundryV13Adapter on v13+, and throws for < 12', () => {
    // Unsupported legacy generation (< 12)
    game.release = { generation: 11 };
    game.version = '11.315';
    assert.throws(() => initializeFoundryAdapter(), /Unsupported Foundry VTT generation: v11/);

    // V12 baseline
    game.release = { generation: 12 };
    game.version = '12.331';
    const v12 = initializeFoundryAdapter();
    assert.ok(v12 instanceof FoundryV12Adapter);
    assert.ok(v12 instanceof BaseFoundryAdapter);
    assert.equal(v12.generation, 12);

    // V13 platform
    game.release = { generation: 13 };
    game.version = '13.351';
    const v13 = initializeFoundryAdapter();
    assert.ok(v13 instanceof FoundryV13Adapter);
    assert.ok(v13 instanceof FoundryV12Adapter);
    assert.equal(v13.generation, 13);

    // V14+ returns FoundryV13Adapter
    game.release = { generation: 14 };
    game.version = '14.364';
    const v14 = initializeFoundryAdapter();
    assert.ok(v14 instanceof FoundryV13Adapter);
    assert.ok(v14 instanceof FoundryV12Adapter);
    assert.equal(v14.generation, 14);
});

test('FoundryV12Adapter and FoundryV13Adapter getCombatantByToken and getCombatantsByToken contracts', () => {
    const mockCombatant = { id: 'c1', tokenId: 't1' };

    // BaseFoundryAdapter defines abstract contracts
    const base = new BaseFoundryAdapter();
    const mockToken = { id: 't1' };
    assert.throws(() => base.fromUuidSync('item-1'), /BaseFoundryAdapter\.fromUuidSync must be implemented/);
    assert.throws(() => base.getCombatantsByToken({}, mockToken), /BaseFoundryAdapter\.getCombatantsByToken must be implemented/);

    // FoundryV12Adapter (v12 baseline) uses Combat#getCombatantByToken
    const v12 = new FoundryV12Adapter();
    const mockCombatV12 = {
        getCombatantByToken: (id) => id === 't1' ? mockCombatant : null
    };
    assert.equal(v12.getCombatantByToken(mockCombatV12, mockToken), mockCombatant);
    assert.deepEqual(v12.getCombatantsByToken(mockCombatV12, mockToken), [mockCombatant]);

    // FoundryV13Adapter (v13+ platform) uses Combat#getCombatantsByToken
    const v13 = new FoundryV13Adapter();
    const mockCombatV13 = {
        getCombatantsByToken: (token) => token === mockToken ? [mockCombatant] : []
    };
    assert.equal(v13.getCombatantByToken(mockCombatV13, mockToken), mockCombatant);
    assert.deepEqual(v13.getCombatantsByToken(mockCombatV13, mockToken), [mockCombatant]);

    // getTokenFromCombatant resolves token placeables from various combatant structures
    const mockPlaceableToken = { id: 't1', center: { x: 100, y: 100 } };
    assert.equal(v12.getTokenFromCombatant(null), null);
    assert.equal(v12.getTokenFromCombatant({ token: { object: mockPlaceableToken } }), mockPlaceableToken);
    assert.equal(v12.getTokenFromCombatant({ token: mockPlaceableToken }), mockPlaceableToken);
    assert.equal(v12.getTokenFromCombatant({ actor: { getActiveTokens: () => [mockPlaceableToken] } }), mockPlaceableToken);
});

test('FoundryV12Adapter (v12) and FoundryV13Adapter (v13+) constructor getters contract', () => {
    // 1. FoundryV12Adapter (v12 baseline) resolves globals even when foundry.applications.ux is undefined
    const v12 = new FoundryV12Adapter();
    assert.equal(v12.ContextMenu, globalThis.ContextMenu);
    assert.equal(v12.KeyboardManager, globalThis.KeyboardManager);
    assert.equal(v12.Token, globalThis.Token);
    assert.equal(v12.ApplicationV2, globalThis.foundry.applications.api.ApplicationV2);
    assert.equal(v12.HandlebarsApplicationMixin, globalThis.foundry.applications.api.HandlebarsApplicationMixin);
    assert.equal(v12.FilePicker, globalThis.FilePicker);
    assert.equal(v12.TextEditor, globalThis.TextEditor);

    // 2. FoundryV13Adapter (v13+ platform) resolves modern namespaced constructors
    const v13 = new FoundryV13Adapter();
    assert.equal(v13.ContextMenu, globalThis.foundry.applications.ux.ContextMenu.implementation);
    assert.equal(v13.KeyboardManager, globalThis.foundry.helpers.interaction.KeyboardManager);
    assert.equal(v13.Token, globalThis.foundry.canvas.placeables.Token);
    assert.equal(v13.ApplicationV2, globalThis.foundry.applications.api.ApplicationV2);
    assert.equal(v13.HandlebarsApplicationMixin, globalThis.foundry.applications.api.HandlebarsApplicationMixin);
    assert.equal(v13.FilePicker, globalThis.foundry.applications.apps.FilePicker.implementation);
    assert.equal(v13.TextEditor, globalThis.foundry.applications.ux.TextEditor.implementation);
});

test('loadTemplates contract across BaseFoundryAdapter, FoundryV12Adapter, and FoundryV13Adapter', async () => {
    const base = new BaseFoundryAdapter();
    await assert.rejects(async () => base.loadTemplates([]), /BaseFoundryAdapter\.loadTemplates must be implemented/);

    const v12 = new FoundryV12Adapter();
    const resultV12 = await v12.loadTemplates(['templates/test.html']);
    assert.deepEqual(resultV12, ['templates/test.html']);

    const v13 = new FoundryV13Adapter();
    const resultV13 = await v13.loadTemplates(['templates/test.html']);
    assert.deepEqual(resultV13, ['templates/test.html']);
});

test('isNewerVersion contract across BaseFoundryAdapter and BaseSystemAdapter', () => {
    const foundry = new BaseFoundryAdapter();
    const system = new BaseSystemAdapter('pf1', true, foundry);

    assert.equal(foundry.isNewerVersion('12.0.0', '11.0.0'), true);
    assert.equal(foundry.isNewerVersion('11.0.0', '12.0.0'), false);
    assert.equal(foundry.isNewerVersion('11.0.0', '11.0.0'), false);

    assert.equal(system.isNewerVersion('12.0.0', '11.0.0'), true);
    assert.equal(system.isNewerVersion('11.0.0', '12.0.0'), false);
});

test('fromUuid and fromUuidSync resolve cleanly across FoundryAdapter, SystemAdapter, and UnifiedAdapter', async () => {
    const mockDoc = { id: 'doc1', uuid: 'Item.123' };
    const origGlobalFromUuidSync = globalThis.fromUuidSync;
    const origGlobalFromUuid = globalThis.fromUuid;
    const origUtilsFromUuidSync = globalThis.foundry.utils.fromUuidSync;
    const origUtilsFromUuid = globalThis.foundry.utils.fromUuid;

    globalThis.fromUuidSync = (uuid) => uuid === 'Item.123' ? mockDoc : null;
    globalThis.fromUuid = async (uuid) => uuid === 'Item.123' ? mockDoc : null;
    globalThis.foundry.utils.fromUuidSync = (uuid) => uuid === 'Item.123' ? mockDoc : null;
    globalThis.foundry.utils.fromUuid = async (uuid) => uuid === 'Item.123' ? mockDoc : null;

    try {
        const v12Adapter = new FoundryV12Adapter();
        assert.equal(v12Adapter.fromUuidSync('Item.123'), mockDoc);
        assert.equal(v12Adapter.fromUuidSync('Item.none'), null);
        assert.equal(await v12Adapter.fromUuid('Item.123'), mockDoc);

        const v13Adapter = new FoundryV13Adapter();
        assert.equal(v13Adapter.fromUuidSync('Item.123'), mockDoc);
        assert.equal(v13Adapter.fromUuidSync('Item.none'), null);
        assert.equal(await v13Adapter.fromUuid('Item.123'), mockDoc);

        const systemAdapter = new BaseSystemAdapter('dnd5e', true, v12Adapter);
        assert.equal(systemAdapter.fromUuidSync('Item.123'), mockDoc);
        assert.equal(await systemAdapter.fromUuid('Item.123'), mockDoc);

        const unified = new Adapter();
        unified.foundry = v12Adapter;
        assert.equal(unified.fromUuidSync('Item.123'), mockDoc);
        assert.equal(await unified.fromUuid('Item.123'), mockDoc);
    } finally {
        globalThis.fromUuidSync = origGlobalFromUuidSync;
        globalThis.fromUuid = origGlobalFromUuid;
        globalThis.foundry.utils.fromUuidSync = origUtilsFromUuidSync;
        globalThis.foundry.utils.fromUuid = origUtilsFromUuid;
    }
});

test('initializeSystemAdapter loads matching system adapter or falls back to BaseSystemAdapter with isSupported flag', async () => {
    const foundry = new FoundryV12Adapter();

    // Throws if foundry adapter is missing or invalid
    await assert.rejects(
        () => initializeSystemAdapter('dnd5e'),
        /initializeSystemAdapter requires a valid BaseFoundryAdapter instance/
    );
    await assert.rejects(
        () => initializeSystemAdapter('dnd5e', {}),
        /initializeSystemAdapter requires a valid BaseFoundryAdapter instance/
    );

    // Known system: dnd5e
    const dnd5e = await initializeSystemAdapter('dnd5e', foundry);
    assert.equal(dnd5e.systemId, 'dnd5e');
    assert.equal(dnd5e.isSupported, true);

    // Known system: pf1
    const pf1 = await initializeSystemAdapter('pf1', foundry);
    assert.equal(pf1.systemId, 'pf1');
    assert.equal(pf1.isSupported, true);

    // Known system: pf2e
    const pf2e = await initializeSystemAdapter('pf2e', foundry);
    assert.equal(pf2e.systemId, 'pf2e');
    assert.equal(pf2e.isSupported, true);

    // Unknown/unsupported system fallback (e.g. tormenta20)
    const logs = [];
    const origLog = console.log;
    const origWarn = console.warn;
    log.setVerbosity('debug');
    console.log = (...args) => logs.push(args.join(' '));
    console.warn = (...args) => logs.push(args.join(' '));
    try {
        const tormenta = await initializeSystemAdapter('tormenta20', foundry);
        assert.ok(tormenta instanceof BaseSystemAdapter);
        assert.equal(tormenta.systemId, 'tormenta20');
        assert.equal(tormenta.isSupported, false);
        assert.ok(logs.some(l => l.includes('tormenta20') && l.includes('not currently supported') && l.includes('github.com')));
    } finally {
        console.log = origLog;
        console.warn = origWarn;
        log.setVerbosity('warn');
    }

    // Empty system fallback
    const fallback = await initializeSystemAdapter(null, foundry);
    assert.ok(fallback instanceof BaseSystemAdapter);
    assert.equal(fallback.systemId, 'unknown');
    assert.equal(fallback.isSupported, false);
});

test('initializeModuleAdapters registers active modules from registry', () => {
    game.modules = new Map([
        ['midi-qol', { id: 'midi-qol', active: true }]
    ]);

    const activeMods = initializeModuleAdapters();
    assert.equal(activeMods.has('midi-qol'), true);
});

test('Unified Adapter init initializes and formats system label correctly for supported and unsupported systems', async () => {
    game.release = { generation: 12 };
    game.version = '12.331';
    game.modules = new Map();

    const logs = [];
    const origLog = console.log;
    log.setVerbosity('info');
    console.log = (...args) => logs.push(args.join(' '));

    try {
        // Supported system
        game.system = { id: 'dnd5e' };
        const supportedAdapter = new Adapter();
        await supportedAdapter.init();
        assert.ok(supportedAdapter.foundry instanceof BaseFoundryAdapter);
        assert.equal(supportedAdapter.foundry.generation, 12);
        assert.equal(supportedAdapter.system.systemId, 'dnd5e');
        assert.equal(supportedAdapter.system.isSupported, true);
        assert.equal(supportedAdapter.modules.size, 0);
        assert.ok(logs.some(l => l.includes('Unified Adapter initialized [Foundry: v12, System: dnd5e, Modules: 0]')));

        logs.length = 0;

        // Unsupported system: tormenta20
        game.release = { generation: 13 };
        game.system = { id: 'tormenta20' };
        const unsupportedAdapter = new Adapter();
        await unsupportedAdapter.init();
        assert.equal(unsupportedAdapter.system.systemId, 'tormenta20');
        assert.equal(unsupportedAdapter.system.isSupported, false);
        assert.ok(logs.some(l => l.includes('Unified Adapter initialized [Foundry: v13, System: tormenta20 (unsupported), Modules: 0]')));
    } finally {
        console.log = origLog;
        log.setVerbosity('warn');
    }
});

test('Unified Adapter getActions executes base extraction -> system -> module -> hidden pipeline', async () => {
    const testAdapter = new Adapter();
    testAdapter.system = new BaseSystemAdapter('test', false, new FoundryV12Adapter());

    const mockActor = {
        name: 'Hero',
        items: new foundry.utils.Collection([
            { id: 'item-1', name: 'Longsword', type: 'weapon', img: 'icons/sword.png' },
            { id: 'item-2', name: 'Shield', type: 'equipment', img: 'icons/shield.png' }
        ]),
        getFlag: (mod, key) => {
            if (mod === MODULE_ID && key === 'hiddenItems') {
                return { 'item-2': true };
            }
            return undefined;
        }
    };

    const actions = await testAdapter.getActions(mockActor);
    assert.equal(actions.length, 2);

    const swordAction = actions.find(a => a.id === 'item-1');
    const shieldAction = actions.find(a => a.id === 'item-2');

    assert.ok(swordAction);
    assert.equal(swordAction.isHidden, false);
    assert.deepEqual(swordAction.left, ['weapon']);

    assert.ok(shieldAction);
    assert.equal(shieldAction.isHidden, true);
    assert.deepEqual(shieldAction.left, ['hidden']);
});

test('Unified Adapter delegates facade methods to layers', async () => {
    const testAdapter = new Adapter();
    await testAdapter.init();
    assert.ok(Array.isArray(testAdapter.getDefaultActiveLeftSubTypes()));
    assert.ok(Array.isArray(testAdapter.getDefaultActiveSubTypes()));
    assert.equal(testAdapter.isExclusionTab('unknown'), false);
    assert.equal(testAdapter.getItemTypeLabel('weapon'), 'Weapon');
});

test('isTeleport contracts across BaseFoundryAdapter, FoundryV12Adapter, FoundryV13Adapter, and Adapter', () => {
    const base = new BaseFoundryAdapter();
    assert.throws(() => base.isTeleport({}), /must be implemented by version subclass/);

    // V12 checks options.teleport and options.animate
    const v12 = new FoundryV12Adapter();
    assert.equal(v12.isTeleport({}), false);
    assert.equal(v12.isTeleport({ teleport: true }), true);
    assert.equal(v12.isTeleport({ teleport: false }), false);
    assert.equal(v12.isTeleport({ animate: false }), true);

    // V13 checks movement.teleport, movement === false, without accessing deprecated options.teleport
    const v13 = new FoundryV13Adapter();
    assert.equal(v13.isTeleport({}), false);
    assert.equal(v13.isTeleport({ movement: { teleport: true } }), true);
    assert.equal(v13.isTeleport({ movement: { teleport: false } }), false);
    assert.equal(v13.isTeleport({ movement: false }), true);

    // Simulated DatabaseUpdateOperation with deprecated prototype/proxy getter that warns if accessed
    let getterCalled = false;
    class MockDatabaseUpdateOperation {
        get teleport() {
            getterCalled = true;
            throw new Error('DatabaseUpdateOperation#teleport getter should not be called in v13+');
        }
    }
    const opNormal = new MockDatabaseUpdateOperation();
    opNormal.movement = { teleport: true };
    assert.equal(v13.isTeleport(opNormal), true);
    assert.equal(getterCalled, false);

    const opUntracked = new MockDatabaseUpdateOperation();
    assert.equal(v13.isTeleport(opUntracked), false);
    assert.equal(getterCalled, false);

    // Adapter facade delegates to active foundry adapter
    const testAdapter = new Adapter();
    testAdapter.foundry = v13;
    assert.equal(testAdapter.isTeleport(opNormal), true);
});
