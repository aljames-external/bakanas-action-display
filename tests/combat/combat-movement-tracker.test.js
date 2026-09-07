import { FoundryV12Adapter } from "../../src/adapters/foundry/foundry-v12-adapter.js";
import '../setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatMovementTracker } from '../../src/combat/combat-movement-tracker.js';
import { Dnd5eSystemAdapter } from '../../src/adapters/system/dnd5e-system-adapter.js';
import { BaseSystemAdapter } from '../../src/adapters/system/base-system-adapter.js';
import { Pf1SystemAdapter } from '../../src/adapters/system/pf1-system-adapter.js';
import { Pf2eSystemAdapter } from '../../src/adapters/system/pf2e-system-adapter.js';
import { ActionDisplayApp } from '../../src/ui/action-display-app.js';
import { adapter } from '../../src/adapters/index.js';
import { actionDisplay } from '../../src/action-display.js';

test('CombatMovementTracker returns non-combat state when combat is inactive', () => {
    game.combat = null;
    CombatMovementTracker.clear();

    const token = { id: 'tok-1', document: { id: 'tok-1', x: 100, y: 100 } };
    const result = CombatMovementTracker.getMovementThisTurn(token);

    assert.equal(result.inCombat, false);
    assert.equal(result.distance, 0);
    assert.equal(result.units, 'ft');
});

test('CombatMovementTracker returns non-combat state when token is not in active combat', () => {
    game.combat = {
        id: 'combat-1',
        started: true,
        round: 1,
        turn: 0,
        combatants: [
            { tokenId: 'tok-other', actorId: 'act-other' }
        ]
    };
    CombatMovementTracker.clear();

    const token = { id: 'tok-1', document: { id: 'tok-1', x: 100, y: 100 } };
    const result = CombatMovementTracker.getMovementThisTurn(token);

    assert.equal(result.inCombat, false);
    assert.equal(result.distance, 0);
});

test('CombatMovementTracker accumulates token movement distance during active combat', () => {
    const tokenDoc = {
        id: 'tok-hero',
        name: 'Fighter',
        x: 100,
        y: 100,
        elevation: 0
    };
    const combat = {
        id: 'combat-1',
        started: true,
        round: 1,
        turn: 0,
        combatants: [
            { tokenId: 'tok-hero', token: tokenDoc }
        ]
    };
    game.combat = combat;
    CombatMovementTracker.clear();
    CombatMovementTracker.resetTurn(combat);

    // Initial state: 0 distance moved
    let result = CombatMovementTracker.getMovementThisTurn(tokenDoc);
    assert.equal(result.inCombat, true);
    assert.equal(result.distance, 0);

    // Grid mock: 100px = 5ft
    canvas.scene = { grid: { distance: 5, size: 100, units: 'ft' } };
    canvas.grid = {
        measureDistance: (p0, p1) => {
            const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
            return Math.round((dist / 100) * 5);
        }
    };

    // Move 10 ft right (200px)
    CombatMovementTracker.recordTokenMovement(tokenDoc, { x: 300, y: 100 }, {});
    tokenDoc.x = 300;

    result = CombatMovementTracker.getMovementThisTurn(tokenDoc);
    assert.equal(result.inCombat, true);
    assert.equal(result.distance, 10);

    // Move 15 ft down (300px)
    CombatMovementTracker.recordTokenMovement(tokenDoc, { x: 300, y: 400 }, {});
    tokenDoc.y = 400;

    result = CombatMovementTracker.getMovementThisTurn(tokenDoc);
    assert.equal(result.inCombat, true);
    assert.equal(result.distance, 25);

    // Teleportation does not accumulate distance (plain options)
    CombatMovementTracker.recordTokenMovement(tokenDoc, { x: 1000, y: 1000 }, { teleport: true });
    tokenDoc.x = 1000;
    tokenDoc.y = 1000;

    result = CombatMovementTracker.getMovementThisTurn(tokenDoc);
    assert.equal(result.distance, 25); // Still 25 ft

    // Teleportation via V13+ movement data structure
    CombatMovementTracker.recordTokenMovement(tokenDoc, { x: 1500, y: 1500 }, { movement: { teleport: true } });
    tokenDoc.x = 1500;
    tokenDoc.y = 1500;

    result = CombatMovementTracker.getMovementThisTurn(tokenDoc);
    assert.equal(result.distance, 25); // Still 25 ft

    // Simulated DatabaseUpdateOperation with deprecated getter
    let deprecationGetterCalled = false;
    class SimulatedV13DatabaseUpdateOperation {
        get teleport() {
            deprecationGetterCalled = true;
            throw new Error('DatabaseUpdateOperation#teleport getter should never be accessed');
        }
    }
    const simulatedOp = new SimulatedV13DatabaseUpdateOperation();
    simulatedOp.movement = { teleport: true };

    CombatMovementTracker.recordTokenMovement(tokenDoc, { x: 2000, y: 2000 }, simulatedOp);
    tokenDoc.x = 2000;
    tokenDoc.y = 2000;

    assert.equal(deprecationGetterCalled, false);
    result = CombatMovementTracker.getMovementThisTurn(tokenDoc);
    assert.equal(result.distance, 25); // Still 25 ft

    // Advance turn resets distance to 0 for the new turn
    combat.turn = 1;
    CombatMovementTracker.resetTurn(combat);

    result = CombatMovementTracker.getMovementThisTurn(tokenDoc);
    assert.equal(result.inCombat, true);
    assert.equal(result.distance, 0);
});

test('Dnd5eSystemAdapter.getTokenInfo formats movement with moved distance when in combat', async () => {
    const dnd5eAdapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const tokenDoc = {
        id: 'tok-fighter',
        name: 'Valeros',
        x: 100,
        y: 100
    };
    const actor = {
        id: 'act-fighter',
        name: 'Valeros',
        type: 'character',
        system: {
            attributes: {
                ac: { value: 18 },
                movement: { walk: 30, units: 'ft' }
            },
            traits: { size: 'med' },
            details: { biography: { value: '' } }
        },
        getActiveTokens: () => [{ id: 'tok-fighter', document: tokenDoc }]
    };

    // 1. Out of combat: showMoved is false
    game.combat = null;
    CombatMovementTracker.clear();
    let info = await dnd5eAdapter.getTokenInfo(actor, tokenDoc);
    assert.equal(info.movement.primary, '30 ft');
    assert.equal(info.movement.inCombat, false);
    assert.equal(info.movement.showMoved, false);
    assert.equal(info.movement.movedLabel, '');

    // 2. In combat with 20 ft moved: showMoved is true
    game.combat = {
        id: 'combat-dnd5e',
        started: true,
        round: 1,
        turn: 0,
        combatants: [{ tokenId: 'tok-fighter', actorId: 'act-fighter' }]
    };
    CombatMovementTracker.setMovedDistance('tok-fighter', 20);

    const origLocalize = game.i18n.localize;
    game.i18n.localize = key => (key === 'BAD.page3.moved' ? 'moved' : origLocalize(key));

    try {
        info = await dnd5eAdapter.getTokenInfo(actor, tokenDoc);
        assert.equal(info.movement.primary, '30 ft');
        assert.equal(info.movement.inCombat, true);
        assert.equal(info.movement.showMoved, true);
        assert.equal(info.movement.movedDistance, 20);
        assert.equal(info.movement.movedLabel, '20 ft moved');
    } finally {
        game.i18n.localize = origLocalize;
    }
});

test('ActionDisplayApp Page 3 renders moved distance alongside primary movement speed during combat', async () => {
    adapter.system = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const tokenDoc = {
        id: 'tok-starion',
        name: 'Astarion',
        x: 100,
        y: 100
    };
    const actor = {
        id: 'act-starion',
        name: 'Astarion',
        type: 'character',
        isOwner: true,
        getFlag: () => false,
        flags: {},
        system: {
            attributes: {
                inspiration: false,
                ac: { value: 15 },
                movement: { walk: 30, units: 'ft' }
            },
            traits: { size: 'med' },
            details: { biography: { value: '' } }
        },
        getRollData: () => ({ name: 'Astarion' })
    };

    game.combat = {
        id: 'combat-page3',
        started: true,
        round: 1,
        turn: 0,
        combatants: [{ tokenId: 'tok-starion', actorId: 'act-starion' }]
    };
    CombatMovementTracker.setMovedDistance('tok-starion', 15);

    const token = { id: 'tok-starion', document: tokenDoc, actor };
    const app = new ActionDisplayApp(token);
    app.activePage = 3;
    app._saveTabState = () => {};

    actionDisplay.getActions = async () => [
        { id: 'tok-starion-info', name: 'Astarion', page: 3, type: 'info' }
    ];

    const origLocalize = game.i18n.localize;
    game.i18n.localize = key => (key === 'BAD.page3.moved' ? 'moved' : origLocalize(key));

    try {
        const context = await app._prepareContext({});
        assert.equal(context.tokenInfo.movement.primary, '30 ft');
        assert.equal(context.tokenInfo.movement.showMoved, true);
        assert.equal(context.tokenInfo.movement.movedLabel, '15 ft moved');
        assert.equal(context.tokenInfo.movement.movedDistance, 15);
    } finally {
        game.i18n.localize = origLocalize;
    }

    await app.close();
    CombatMovementTracker.clear();
});

test('BaseSystemAdapter getTurnMovement returns non-combat 0 distance', () => {
    const baseAdapter = new BaseSystemAdapter('default', false, new FoundryV12Adapter());
    const result = baseAdapter.getTurnMovement();
    assert.equal(result.inCombat, false);
    assert.equal(result.distance, 0);
    assert.equal(result.units, 'ft');
});

test('Pf1SystemAdapter.getTokenInfo formats movement with moved distance when in combat', async () => {
    const pf1Adapter = new Pf1SystemAdapter(new FoundryV12Adapter());
    const tokenDoc = { id: 'tok-pf1', name: 'Ezren', x: 50, y: 50 };
    const actor = {
        id: 'act-pf1',
        name: 'Ezren',
        system: {
            attributes: {
                speed: { land: { total: 30 } }
            },
            details: {},
            traits: {}
        }
    };

    game.combat = {
        id: 'combat-pf1',
        started: true,
        round: 1,
        turn: 0,
        combatants: [{ tokenId: 'tok-pf1', actorId: 'act-pf1' }]
    };
    CombatMovementTracker.setMovedDistance('tok-pf1', 10);

    const origLocalize = game.i18n.localize;
    game.i18n.localize = key => (key === 'BAD.page3.moved' ? 'moved' : origLocalize(key));

    try {
        const info = await pf1Adapter.getTokenInfo(actor, tokenDoc);
        assert.equal(info.movement.primary, '30 ft');
        assert.equal(info.movement.inCombat, true);
        assert.equal(info.movement.showMoved, true);
        assert.equal(info.movement.movedDistance, 10);
        assert.equal(info.movement.movedLabel, '10 ft moved');
    } finally {
        game.i18n.localize = origLocalize;
    }
    CombatMovementTracker.clear();
});

test('Pf2eSystemAdapter.getTokenInfo formats movement with moved distance when in combat', async () => {
    const pf2eAdapter = new Pf2eSystemAdapter(new FoundryV12Adapter());
    const tokenDoc = { id: 'tok-pf2e', name: 'Fumbus', x: 50, y: 50 };
    const actor = {
        id: 'act-pf2e',
        name: 'Fumbus',
        system: {
            attributes: {
                speed: { value: 25 }
            },
            details: {},
            traits: {}
        }
    };

    game.combat = {
        id: 'combat-pf2e',
        started: true,
        round: 1,
        turn: 0,
        combatants: [{ tokenId: 'tok-pf2e', actorId: 'act-pf2e' }]
    };
    CombatMovementTracker.setMovedDistance('tok-pf2e', 25);

    const origLocalize = game.i18n.localize;
    game.i18n.localize = key => (key === 'BAD.page3.moved' ? 'moved' : origLocalize(key));

    try {
        const info = await pf2eAdapter.getTokenInfo(actor, tokenDoc);
        assert.equal(info.movement.primary, '25 ft');
        assert.equal(info.movement.inCombat, true);
        assert.equal(info.movement.showMoved, true);
        assert.equal(info.movement.movedDistance, 25);
        assert.equal(info.movement.movedLabel, '25 ft moved');
    } finally {
        game.i18n.localize = origLocalize;
    }
    CombatMovementTracker.clear();
});

test('Page 3 template renders alignment on a separate line from race/type and AC/movement on multiple lines', async () => {
    adapter.system = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const tokenDoc = { id: 'tok-layout', name: 'Gimli', x: 0, y: 0 };
    const actor = {
        id: 'act-layout',
        name: 'Gimli',
        type: 'character',
        system: {
            attributes: {
                ac: { value: 18, calc: 'armored', shield: 2 },
                movement: { walk: 25, units: 'ft' }
            },
            traits: { size: 'med' },
            details: {
                race: { name: 'Mountain Dwarf' },
                alignment: 'Neutral Good'
            }
        },
        getActiveTokens: () => [{ id: 'tok-layout', document: tokenDoc }]
    };

    game.combat = {
        id: 'combat-layout',
        started: true,
        round: 1,
        turn: 0,
        combatants: [{ tokenId: 'tok-layout', actorId: 'act-layout' }]
    };
    CombatMovementTracker.setMovedDistance('tok-layout', 15);

    const origLocalize = game.i18n.localize;
    game.i18n.localize = key => (key === 'BAD.page3.moved' ? 'moved' : origLocalize(key));

    try {
        const info = await adapter.getTokenInfo(actor, tokenDoc);
        assert.equal(info.typeLabel, 'Medium Mountain Dwarf');
        assert.equal(info.alignment, 'Neutral Good');
        assert.deepEqual(info.ac.secondaries, ['Armored', '+2 Shield']);
        assert.equal(info.movement.showMoved, true);
        assert.equal(info.movement.movedLabel, '15 ft moved');
    } finally {
        game.i18n.localize = origLocalize;
    }
    CombatMovementTracker.clear();
});
