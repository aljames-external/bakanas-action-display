import '../setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BaseFoundryAdapter, USER_PERMISSION_TIERS } from '../../src/adapters/foundry/base-foundry-adapter.js';
import { FoundryV12Adapter } from '../../src/adapters/foundry/foundry-v12-adapter.js';
import { FoundryV13Adapter } from '../../src/adapters/foundry/foundry-v13-adapter.js';
import { handleCombatTurnChange } from '../../src/module.js';
import { actionDisplay } from '../../src/action-display.js';
import { ActionDisplayApp } from '../../src/ui/action-display-app.js';
import { MODULE_ID } from '../../src/constants.js';

test('USER_PERMISSION_TIERS constants contract', () => {
    assert.equal(USER_PERMISSION_TIERS.PLAYER, 1);
    assert.equal(USER_PERMISSION_TIERS.TRUSTED, 2);
    assert.equal(USER_PERMISSION_TIERS.GM, 3);
});

test('getUserPermissionTier categorizes users into Player (1), Trusted Player (2), and GM/Co-GM (3)', () => {
    const adapter = new BaseFoundryAdapter();

    // Invalid / empty inputs
    assert.equal(adapter.getUserPermissionTier(null), null);
    assert.equal(adapter.getUserPermissionTier(undefined), null);
    assert.equal(adapter.getUserPermissionTier({ role: 0 }), null);

    // Tier 1: Players
    assert.equal(adapter.getUserPermissionTier({ id: 'p1', role: 1, isGM: false, isTrusted: false }), USER_PERMISSION_TIERS.PLAYER);
    assert.equal(adapter.getUserPermissionTier({ id: 'p2', isGM: false, isTrusted: false }), USER_PERMISSION_TIERS.PLAYER);

    // Tier 2: Trusted Players
    assert.equal(adapter.getUserPermissionTier({ id: 't1', role: 2, isGM: false, isTrusted: true }), USER_PERMISSION_TIERS.TRUSTED);
    assert.equal(adapter.getUserPermissionTier({ id: 't2', isGM: false, isTrusted: true }), USER_PERMISSION_TIERS.TRUSTED);

    // Tier 3: GM and Assistant GM (Co-GM)
    assert.equal(adapter.getUserPermissionTier({ id: 'gm1', role: 4, isGM: true }), USER_PERMISSION_TIERS.GM);
    assert.equal(adapter.getUserPermissionTier({ id: 'cogm', role: 3, isGM: true }), USER_PERMISSION_TIERS.GM);
    assert.equal(adapter.getUserPermissionTier({ id: 'gm2', isGM: true }), USER_PERMISSION_TIERS.GM);
});

test('isUserDocumentOwner evaluates ownership across testUserPermission, ownership maps, and GM override', () => {
    const adapter = new BaseFoundryAdapter();

    const userGM = { id: 'gm-1', role: 4, isGM: true };
    const userTrusted = { id: 'trusted-1', role: 2, isGM: false, isTrusted: true };
    const userPlayer1 = { id: 'player-1', role: 1, isGM: false };
    const userPlayer2 = { id: 'player-2', role: 1, isGM: false };

    // 1. GM always owns everything
    const unownedActor = { id: 'actor-unowned', ownership: { default: 0 } };
    assert.equal(adapter.isUserDocumentOwner(userGM, unownedActor), true);

    // 2. Ownership via actor.testUserPermission
    const actorWithFn = {
        id: 'actor-fn',
        testUserPermission: (u, perm) => u.id === 'player-1' && perm === 'OWNER'
    };
    assert.equal(adapter.isUserDocumentOwner(userPlayer1, actorWithFn), true);
    assert.equal(adapter.isUserDocumentOwner(userPlayer2, actorWithFn), false);

    // 3. Ownership via actor.ownership map
    const actorWithMap = {
        id: 'actor-map',
        ownership: { default: 0, 'player-1': 3, 'trusted-1': 3, 'player-2': 2 }
    };
    assert.equal(adapter.isUserDocumentOwner(userPlayer1, actorWithMap), true);
    assert.equal(adapter.isUserDocumentOwner(userTrusted, actorWithMap), true);
    assert.equal(adapter.isUserDocumentOwner(userPlayer2, actorWithMap), false); // 2 is OBSERVER, not OWNER

    // 4. Ownership via tokenDoc.ownership map
    const tokenDocWithMap = {
        id: 'token-doc-map',
        ownership: { default: 0, 'player-2': 3 }
    };
    assert.equal(adapter.isUserDocumentOwner(userPlayer2, tokenDocWithMap), true);
    assert.equal(adapter.isUserDocumentOwner(userPlayer1, tokenDocWithMap), false);

    // 5. Ownership via actor.getUserLevel
    const actorWithLevel = {
        id: 'actor-lvl',
        getUserLevel: (u) => u.id === 'trusted-1' ? 3 : 1
    };
    assert.equal(adapter.isUserDocumentOwner(userTrusted, actorWithLevel), true);
    assert.equal(adapter.isUserDocumentOwner(userPlayer1, actorWithLevel), false);
});

test('isUserInCharge enforces ownership priority (Players > Trusted Players > GM/Co-GM)', () => {
    const adapter = new BaseFoundryAdapter();

    const userGM = { id: 'user-gm', name: 'GM', role: 4, isGM: true, active: true };
    const userCoGM = { id: 'user-cogm', name: 'Co-GM', role: 3, isGM: true, active: true };
    const userTrusted = { id: 'user-trusted', name: 'Trusted Player', role: 2, isGM: false, isTrusted: true, active: true };
    const userPlayer1 = { id: 'user-player1', name: 'Player 1', role: 1, isGM: false, active: true };
    const userPlayer2 = { id: 'user-player2', name: 'Player 2', role: 1, isGM: false, active: true };

    globalThis.game.users = new foundry.utils.Collection([
        userGM,
        userCoGM,
        userTrusted,
        userPlayer1,
        userPlayer2
    ]);

    // Scenario 1: NPC Goblin (owned only by GM / Co-GM)
    const tokenGoblin = {
        id: 'token-goblin',
        name: 'Goblin',
        document: { id: 'token-goblin-doc', ownership: { default: 0 } },
        actor: { id: 'actor-goblin', ownership: { default: 0 } }
    };

    assert.equal(adapter.isUserInCharge(tokenGoblin, userGM), true, 'GM is in-charge of NPC');
    assert.equal(adapter.isUserInCharge(tokenGoblin, userCoGM), true, 'Co-GM is in-charge of NPC');
    assert.equal(adapter.isUserInCharge(tokenGoblin, userTrusted), false, 'Trusted player does not own NPC');
    assert.equal(adapter.isUserInCharge(tokenGoblin, userPlayer1), false, 'Player 1 does not own NPC');
    assert.equal(adapter.isUserInCharge(tokenGoblin, userPlayer2), false, 'Player 2 does not own NPC');

    // Scenario 2: Player 1 PC (Hero) owned by Player 1 and GM
    const tokenHero = {
        id: 'token-hero',
        name: 'Hero',
        document: { id: 'token-hero-doc', ownership: { default: 0, 'user-player1': 3 } },
        actor: { id: 'actor-hero', ownership: { default: 0, 'user-player1': 3 } }
    };

    assert.equal(adapter.isUserInCharge(tokenHero, userPlayer1), true, 'Player 1 is in-charge of their PC');
    assert.equal(adapter.isUserInCharge(tokenHero, userPlayer2), false, 'Player 2 is not owner of Player 1 PC');
    assert.equal(adapter.isUserInCharge(tokenHero, userTrusted), false, 'Trusted Player is not owner of Player 1 PC');
    assert.equal(adapter.isUserInCharge(tokenHero, userGM), false, 'GM is NOT in-charge because Player 1 owns it');
    assert.equal(adapter.isUserInCharge(tokenHero, userCoGM), false, 'Co-GM is NOT in-charge because Player 1 owns it');

    // Scenario 3: Trusted Player PC (Familiar) owned by Trusted Player and GM, but NO regular player
    const tokenFamiliar = {
        id: 'token-familiar',
        name: 'Familiar',
        document: { id: 'token-familiar-doc', ownership: { default: 0, 'user-trusted': 3 } },
        actor: { id: 'actor-familiar', ownership: { default: 0, 'user-trusted': 3 } }
    };

    assert.equal(adapter.isUserInCharge(tokenFamiliar, userTrusted), true, 'Trusted player is in-charge when no regular players own it');
    assert.equal(adapter.isUserInCharge(tokenFamiliar, userPlayer1), false, 'Player 1 does not own familiar');
    assert.equal(adapter.isUserInCharge(tokenFamiliar, userGM), false, 'GM is NOT in-charge because Trusted Player owns it');
    assert.equal(adapter.isUserInCharge(tokenFamiliar, userCoGM), false, 'Co-GM is NOT in-charge because Trusted Player owns it');

    // Scenario 4: Co-owned PC by Player 1 and Trusted Player and GM
    const tokenSharedPC = {
        id: 'token-shared',
        name: 'Shared PC',
        document: { id: 'token-shared-doc', ownership: { default: 0, 'user-player1': 3, 'user-trusted': 3 } },
        actor: { id: 'actor-shared', ownership: { default: 0, 'user-player1': 3, 'user-trusted': 3 } }
    };

    assert.equal(adapter.isUserInCharge(tokenSharedPC, userPlayer1), true, 'Player 1 is in-charge because Player tier takes precedence');
    assert.equal(adapter.isUserInCharge(tokenSharedPC, userTrusted), false, 'Trusted player is NOT in-charge because Player 1 also owns it');
    assert.equal(adapter.isUserInCharge(tokenSharedPC, userGM), false, 'GM is NOT in-charge because Player 1 owns it');

    // Scenario 5: Multi-player PC owned by Player 1 and Player 2
    const tokenPartyCart = {
        id: 'token-cart',
        name: 'Party Cart',
        document: { id: 'token-cart-doc', ownership: { default: 0, 'user-player1': 3, 'user-player2': 3 } },
        actor: { id: 'actor-cart', ownership: { default: 0, 'user-player1': 3, 'user-player2': 3 } }
    };

    assert.equal(adapter.isUserInCharge(tokenPartyCart, userPlayer1), true, 'Player 1 is in-charge');
    assert.equal(adapter.isUserInCharge(tokenPartyCart, userPlayer2), true, 'Player 2 is in-charge');
    assert.equal(adapter.isUserInCharge(tokenPartyCart, userTrusted), false, 'Trusted player does not own it');
    assert.equal(adapter.isUserInCharge(tokenPartyCart, userGM), false, 'GM is NOT in-charge because regular players own it');
});

test('Combat turn auto-tracking switches token for in-charge user and ignores other tokens', async () => {
    await game.settings.set(MODULE_ID, 'enableCombatAutoTrackButton', true);
    await game.settings.set(MODULE_ID, 'autoTrackCombat', true);

    const userGM = { id: 'user-gm', name: 'GM', role: 4, isGM: true, active: true };
    const userPlayer1 = { id: 'user-player1', name: 'Player 1', role: 1, isGM: false, active: true };
    globalThis.game.users = new foundry.utils.Collection([userGM, userPlayer1]);

    const tokenGoblin = {
        id: 'token-goblin-combat',
        name: 'Goblin Combat',
        document: { id: 'token-goblin-combat-doc', ownership: { default: 0 } },
        actor: { id: 'actor-goblin-combat', name: 'Goblin Combat Actor', ownership: { default: 0 }, items: new foundry.utils.Collection() }
    };
    const tokenHero = {
        id: 'token-hero-combat-turn',
        name: 'Hero Combat Turn',
        document: { id: 'token-hero-combat-turn-doc', ownership: { default: 0, 'user-player1': 3 } },
        actor: { id: 'actor-hero-combat-turn', name: 'Hero Actor', ownership: { default: 0, 'user-player1': 3 }, items: new foundry.utils.Collection() }
    };

    globalThis.canvas = {
        tokens: {
            get: (id) => id === 'token-goblin-combat' ? tokenGoblin : tokenHero,
            placeables: [tokenGoblin, tokenHero]
        }
    };

    // CASE A: GM client (game.user is GM)
    globalThis.game.user = userGM;

    // Start with HUD open on Goblin
    actionDisplay.activeApp = new ActionDisplayApp(tokenGoblin);
    actionDisplay.activeApp.rendered = true;

    // Combat advances to Hero (owned by Player 1)
    const mockCombatHeroTurn = {
        started: true,
        combatant: { tokenId: 'token-hero-combat-turn', token: tokenHero, actor: tokenHero.actor }
    };
    globalThis.game.combat = mockCombatHeroTurn;

    handleCombatTurnChange(mockCombatHeroTurn);

    // Because game.user is GM and Hero is owned by Player 1, GM is NOT in charge of Hero.
    // The GM's HUD should NOT have switched to Hero!
    assert.equal(actionDisplay.activeApp.token.id, 'token-goblin-combat', 'GM HUD did not switch to Player 1 PC');

    // Combat advances back to Goblin (owned only by GM)
    // First open HUD on Hero to test switching to Goblin
    actionDisplay.activeApp = new ActionDisplayApp(tokenHero);
    actionDisplay.activeApp.rendered = true;

    const mockCombatGoblinTurn = {
        started: true,
        combatant: { tokenId: 'token-goblin-combat', token: tokenGoblin, actor: tokenGoblin.actor }
    };
    globalThis.game.combat = mockCombatGoblinTurn;

    handleCombatTurnChange(mockCombatGoblinTurn);

    // Because Goblin is an NPC owned only by GM, GM IS in charge of Goblin.
    // HUD should switch to Goblin!
    assert.equal(actionDisplay.activeApp.token.id, 'token-goblin-combat', 'GM HUD switched to Goblin NPC');

    // CASE B: Player 1 client (game.user is Player 1)
    globalThis.game.user = userPlayer1;

    // Initial HUD on Hero
    actionDisplay.activeApp = new ActionDisplayApp(tokenHero);
    actionDisplay.activeApp.rendered = true;

    // Combat advances to Goblin (NPC)
    handleCombatTurnChange(mockCombatGoblinTurn);
    // Player 1 does not own Goblin -> HUD should NOT switch to Goblin
    assert.equal(actionDisplay.activeApp.token.id, 'token-hero-combat-turn', 'Player 1 HUD did not switch to Goblin NPC');

    // Combat advances to Hero (Player 1 PC)
    // Close HUD or set HUD on Goblin to test switch
    actionDisplay.activeApp = new ActionDisplayApp(tokenGoblin);
    actionDisplay.activeApp.rendered = true;

    handleCombatTurnChange(mockCombatHeroTurn);
    // Player 1 owns Hero -> Player 1 IS in charge of Hero -> HUD switches to Hero!
    assert.equal(actionDisplay.activeApp.token.id, 'token-hero-combat-turn', 'Player 1 HUD switched to their PC');

    // Cleanup
    if (actionDisplay.activeApp) {
        actionDisplay.activeApp.close();
        actionDisplay.activeApp = null;
    }
    await game.settings.set(MODULE_ID, 'enableCombatAutoTrackButton', false);
    await game.settings.set(MODULE_ID, 'autoTrackCombat', false);
    globalThis.game.combat = null;
    globalThis.game.user = userGM;
});

test('ActionDisplayApp _onToggleCombatAutoTrack switches only when user is in-charge', async () => {
    const userGM = { id: 'user-gm-toggle', name: 'GM', role: 4, isGM: true, active: true };
    const userPlayer1 = { id: 'user-player1-toggle', name: 'Player 1', role: 1, isGM: false, active: true };
    globalThis.game.users = new foundry.utils.Collection([userGM, userPlayer1]);

    const tokenGoblin = {
        id: 'token-goblin-toggle',
        name: 'Goblin Toggle',
        document: { id: 'token-goblin-toggle-doc', ownership: { default: 0 } },
        actor: { id: 'actor-goblin-toggle', name: 'Goblin Actor', ownership: { default: 0 }, items: new foundry.utils.Collection() }
    };
    const tokenHero = {
        id: 'token-hero-toggle',
        name: 'Hero Toggle',
        document: { id: 'token-hero-toggle-doc', ownership: { default: 0, 'user-player1-toggle': 3 } },
        actor: { id: 'actor-hero-toggle', name: 'Hero Actor', ownership: { default: 0, 'user-player1-toggle': 3 }, items: new foundry.utils.Collection() }
    };

    globalThis.canvas = {
        tokens: {
            get: (id) => id === 'token-goblin-toggle' ? tokenGoblin : tokenHero,
            placeables: [tokenGoblin, tokenHero]
        }
    };

    // GM client toggles auto-track during Hero turn -> should NOT switch
    globalThis.game.user = userGM;
    const mockCombatHeroTurn = {
        started: true,
        combatant: { tokenId: 'token-hero-toggle', token: tokenHero, actor: tokenHero.actor }
    };
    globalThis.game.combat = mockCombatHeroTurn;

    const initialAppGM = new ActionDisplayApp(tokenGoblin);
    actionDisplay.activeApp = initialAppGM;
    initialAppGM.rendered = true;

    await initialAppGM._onToggleCombatAutoTrack(null, { checked: true });
    // Still on goblin because GM is not in charge of Hero
    assert.equal(actionDisplay.activeApp.token.id, 'token-goblin-toggle');

    // GM client toggles auto-track during Goblin turn -> should switch
    const mockCombatGoblinTurn = {
        started: true,
        combatant: { tokenId: 'token-goblin-toggle', token: tokenGoblin, actor: tokenGoblin.actor }
    };
    globalThis.game.combat = mockCombatGoblinTurn;

    const heroAppGM = new ActionDisplayApp(tokenHero);
    actionDisplay.activeApp = heroAppGM;
    heroAppGM.rendered = true;

    await heroAppGM._onToggleCombatAutoTrack(null, { checked: true });
    // Switches to Goblin because GM is in charge of Goblin
    assert.equal(actionDisplay.activeApp.token.id, 'token-goblin-toggle');

    // Cleanup
    if (actionDisplay.activeApp) {
        actionDisplay.activeApp.close();
        actionDisplay.activeApp = null;
    }
    await game.settings.set(MODULE_ID, 'autoTrackCombat', false);
    globalThis.game.combat = null;
    globalThis.game.user = userGM;
});

test('ActionDisplayApp _onRightClickCombatAutoTrack toggles autoToggleCombat and follows in-charge rules', async () => {
    const userGM = { id: 'user-gm-rc', name: 'GM', role: 4, isGM: true, active: true };
    const userPlayer1 = { id: 'user-p1-rc', name: 'Player 1', role: 1, isGM: false, active: true };
    globalThis.game.users = new foundry.utils.Collection([userGM, userPlayer1]);

    const tokenGoblin = {
        id: 'token-goblin-rc',
        name: 'Goblin RC',
        document: { id: 'token-goblin-rc-doc', ownership: { default: 0 } },
        actor: { id: 'actor-goblin-rc', name: 'Goblin RC Actor', ownership: { default: 0 }, items: new foundry.utils.Collection() }
    };
    const tokenHero = {
        id: 'token-hero-rc',
        name: 'Hero RC',
        document: { id: 'token-hero-rc-doc', ownership: { default: 0, 'user-p1-rc': 3 } },
        actor: { id: 'actor-hero-rc', name: 'Hero RC Actor', ownership: { default: 0, 'user-p1-rc': 3 }, items: new foundry.utils.Collection() }
    };

    globalThis.canvas = {
        tokens: {
            get: (id) => id === 'token-goblin-rc' ? tokenGoblin : tokenHero,
            placeables: [tokenGoblin, tokenHero]
        }
    };

    // 1. GM client right-clicks sword button during Hero turn -> HUD remains open (enabling feature does not close HUD)
    globalThis.game.user = userGM;
    const mockCombatHeroTurn = {
        started: true,
        combatant: { tokenId: 'token-hero-rc', token: tokenHero, actor: tokenHero.actor }
    };
    globalThis.game.combat = mockCombatHeroTurn;

    const initialAppGM = new ActionDisplayApp(tokenGoblin);
    actionDisplay.activeApp = initialAppGM;
    initialAppGM.rendered = true;

    await initialAppGM._onRightClickCombatAutoTrack();
    assert.equal(game.settings.get(MODULE_ID, 'autoToggleCombat'), true);
    assert.equal(actionDisplay.activeApp, initialAppGM, 'HUD remains open when feature is enabled');

    // 2. GM client right-clicks sword button again -> toggles off
    await initialAppGM._onRightClickCombatAutoTrack();
    assert.equal(game.settings.get(MODULE_ID, 'autoToggleCombat'), false);
    assert.equal(actionDisplay.activeApp, initialAppGM, 'HUD remains open when toggled off');

    // 3. Test _onContextMenuCapture intercepts right-click on .bad-combat-track-btn
    let rightClickTriggered = false;
    initialAppGM._onRightClickCombatAutoTrack = async () => { rightClickTriggered = true; };
    const mockBtn = document.createElement('button');
    mockBtn.className = 'bad-control-btn bad-combat-track-btn';
    mockBtn.closest = (sel) => sel.includes('bad-combat-track-btn') ? mockBtn : null;
    const mockEvent = {
        target: mockBtn,
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {}
    };
    initialAppGM._onContextMenuCapture(mockEvent);
    assert.equal(rightClickTriggered, true, '_onContextMenuCapture intercepted right click on sword button');

    // Cleanup
    if (actionDisplay.activeApp) {
        actionDisplay.activeApp.close();
        actionDisplay.activeApp = null;
    }
    await game.settings.set(MODULE_ID, 'autoToggleCombat', false);
    globalThis.game.combat = null;
    globalThis.game.user = userGM;
});

test('Combat turn auto-toggle (autoToggleCombat) opens HUD on my turn and closes HUD on not-my-turn', async () => {
    await game.settings.set(MODULE_ID, 'enableCombatAutoTrackButton', true);
    await game.settings.set(MODULE_ID, 'autoToggleCombat', true);
    await game.settings.set(MODULE_ID, 'autoTrackCombat', false);

    const userGM = { id: 'user-gm-toggle-flow', name: 'GM', role: 4, isGM: true, active: true };
    const userPlayer1 = { id: 'user-p1-toggle-flow', name: 'Player 1', role: 1, isGM: false, active: true };
    globalThis.game.users = new foundry.utils.Collection([userGM, userPlayer1]);

    const tokenGoblin = {
        id: 'token-goblin-flow',
        name: 'Goblin Flow',
        document: { id: 'token-goblin-flow-doc', ownership: { default: 0 } },
        actor: { id: 'actor-goblin-flow', name: 'Goblin Flow Actor', ownership: { default: 0 }, items: new foundry.utils.Collection() }
    };
    const tokenHero = {
        id: 'token-hero-flow',
        name: 'Hero Flow',
        document: { id: 'token-hero-flow-doc', ownership: { default: 0, 'user-p1-toggle-flow': 3 } },
        actor: { id: 'actor-hero-flow', name: 'Hero Flow Actor', ownership: { default: 0, 'user-p1-toggle-flow': 3 }, items: new foundry.utils.Collection() }
    };

    globalThis.canvas = {
        tokens: {
            get: (id) => id === 'token-goblin-flow' ? tokenGoblin : tokenHero,
            placeables: [tokenGoblin, tokenHero]
        }
    };

    const mockCombatGoblinTurn = {
        started: true,
        combatant: { tokenId: 'token-goblin-flow', token: tokenGoblin, actor: tokenGoblin.actor }
    };
    const mockCombatHeroTurn = {
        started: true,
        combatant: { tokenId: 'token-hero-flow', token: tokenHero, actor: tokenHero.actor }
    };

    // --- SCENARIO A: GM client ---
    globalThis.game.user = userGM;
    actionDisplay.activeApp = null;

    // 1. Turn starts on Goblin (GM turn) -> GM HUD should automatically OPEN!
    handleCombatTurnChange(mockCombatGoblinTurn);
    assert.ok(actionDisplay.activeApp, 'GM HUD automatically opened for Goblin turn');
    assert.equal(actionDisplay.activeApp.token.id, 'token-goblin-flow');

    // 2. Turn transitions to Hero (Player 1 turn -> not GM turn) -> GM HUD should automatically CLOSE!
    handleCombatTurnChange(mockCombatHeroTurn);
    assert.equal(actionDisplay.activeApp, null, 'GM HUD automatically closed on Player 1 turn');

    // 3. Turn transitions back to Goblin (GM turn) -> GM HUD should automatically OPEN again!
    handleCombatTurnChange(mockCombatGoblinTurn);
    assert.ok(actionDisplay.activeApp, 'GM HUD automatically opened again for Goblin turn');
    assert.equal(actionDisplay.activeApp.token.id, 'token-goblin-flow');

    // 4. Combat is deleted / ended -> GM HUD should automatically CLOSE!
    Hooks.callAll('deleteCombat', mockCombatGoblinTurn, {}, userGM.id);
    assert.equal(actionDisplay.activeApp, null, 'GM HUD automatically closed when combat deleted');

    // --- SCENARIO B: Player 1 client ---
    globalThis.game.user = userPlayer1;
    actionDisplay.activeApp = null;

    // 1. Goblin turn (not Player 1 turn) -> Player 1 HUD remains closed
    handleCombatTurnChange(mockCombatGoblinTurn);
    assert.equal(actionDisplay.activeApp, null, 'Player 1 HUD remains closed on Goblin turn');

    // 2. Turn transitions to Hero (Player 1 turn) -> Player 1 HUD automatically OPENS!
    handleCombatTurnChange(mockCombatHeroTurn);
    assert.ok(actionDisplay.activeApp, 'Player 1 HUD automatically opened on Hero turn');
    assert.equal(actionDisplay.activeApp.token.id, 'token-hero-flow');

    // 3. Turn transitions to Goblin -> Player 1 HUD automatically CLOSES!
    handleCombatTurnChange(mockCombatGoblinTurn);
    assert.equal(actionDisplay.activeApp, null, 'Player 1 HUD automatically closed when Hero turn ended');

    // Cleanup
    if (actionDisplay.activeApp) {
        actionDisplay.activeApp.close();
        actionDisplay.activeApp = null;
    }
    await game.settings.set(MODULE_ID, 'enableCombatAutoTrackButton', false);
    await game.settings.set(MODULE_ID, 'autoToggleCombat', false);
    globalThis.game.combat = null;
    globalThis.game.user = userGM;
});

test('isUserInCharge considers only currently connected (active: true) users', () => {
    const adapter = new BaseFoundryAdapter();

    const userGM = { id: 'user-gm-conn', name: 'GM', role: 4, isGM: true, active: true };
    const userTrusted = { id: 'user-trusted-conn', name: 'Trusted', role: 2, isGM: false, isTrusted: true, active: false };
    const userPlayer1 = { id: 'user-p1-conn', name: 'Player 1', role: 1, isGM: false, active: false };

    globalThis.game.users = new foundry.utils.Collection([
        userGM,
        userTrusted,
        userPlayer1
    ]);

    const tokenPC = {
        id: 'token-p1-pc',
        document: { ownership: { default: 0, 'user-p1-conn': 3, 'user-trusted-conn': 3 } },
        actor: { ownership: { default: 0, 'user-p1-conn': 3, 'user-trusted-conn': 3 } }
    };

    // 1. When both Player 1 and Trusted Player are disconnected (active: false):
    // GM is in-charge of the PC!
    assert.equal(adapter.isUserInCharge(tokenPC, userGM), true, 'GM is in-charge when player owner is offline');

    // 2. When Trusted Player connects (active: true), but Player 1 remains offline (active: false):
    userTrusted.active = true;
    // Trusted Player is in-charge because Player 1 is offline
    assert.equal(adapter.isUserInCharge(tokenPC, userTrusted), true, 'Trusted Player is in-charge when regular player is offline');
    // GM is no longer in-charge because a connected Trusted Player owns it
    assert.equal(adapter.isUserInCharge(tokenPC, userGM), false, 'GM is not in-charge when Trusted Player is connected');

    // 3. When Player 1 connects (active: true):
    userPlayer1.active = true;
    // Player 1 is in-charge
    assert.equal(adapter.isUserInCharge(tokenPC, userPlayer1), true, 'Player 1 is in-charge when connected');
    // Trusted Player is no longer in-charge because connected Player 1 has lower permission tier
    assert.equal(adapter.isUserInCharge(tokenPC, userTrusted), false, 'Trusted Player is not in-charge when Player 1 connects');
    // GM is still not in-charge
    assert.equal(adapter.isUserInCharge(tokenPC, userGM), false, 'GM is not in-charge when Player 1 is connected');
});

test('FoundryV13Adapter inherits isUserInCharge and permission tier evaluation', () => {
    const v13Adapter = new FoundryV13Adapter();
    const userPlayer = { id: 'p13', role: 1, isGM: false, active: true };
    const userGM = { id: 'gm13', role: 4, isGM: true, active: true };
    globalThis.game.users = new foundry.utils.Collection([userPlayer, userGM]);

    const tokenPC = {
        id: 'token-v13-pc',
        document: { ownership: { default: 0, 'p13': 3 } },
        actor: { ownership: { default: 0, 'p13': 3 } }
    };

    assert.equal(v13Adapter.getUserPermissionTier(userPlayer), USER_PERMISSION_TIERS.PLAYER);
    assert.equal(v13Adapter.getUserPermissionTier(userGM), USER_PERMISSION_TIERS.GM);
    assert.equal(v13Adapter.isUserInCharge(tokenPC, userPlayer), true);
    assert.equal(v13Adapter.isUserInCharge(tokenPC, userGM), false);
});
