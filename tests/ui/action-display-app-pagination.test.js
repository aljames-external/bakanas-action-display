import { FoundryV12Adapter } from "../../src/adapters/foundry/foundry-v12-adapter.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import '../setup.js';
import { ActionDisplayApp } from '../../src/ui/action-display-app.js';
import { actionDisplay } from '../../src/action-display.js';
import { HUDTab } from '../../src/ui/hud-tab.js';
import { adapter } from '../../src/adapters/index.js';
import { Dnd5eSystemAdapter } from '../../src/adapters/system/dnd5e/index.js';
import { MODULE_ID } from '../../src/constants.js';

test('ActionDisplayApp previousPage and nextPage cycle through pages without cyclePage or all-tab triggers', async () => {
    assert.equal(typeof ActionDisplayApp.prototype.cyclePage, 'undefined', 'old cyclePage method should be removed');

    const app = new ActionDisplayApp({ actor: { id: 'test-actor' } });
    app.totalPages = 3;
    app.activePage = 1;
    let renderCount = 0;
    app.render = () => { renderCount++; };
    app._saveTabState = () => {};

    // Test nextPage navigation
    app.nextPage();
    assert.equal(app.activePage, 2);
    app.nextPage();
    assert.equal(app.activePage, 3);
    app.nextPage();
    assert.equal(app.activePage, 1); // Wrap around at boundary

    // Test previousPage navigation
    app.previousPage();
    assert.equal(app.activePage, 3); // Wrap around at lower boundary
    app.previousPage();
    assert.equal(app.activePage, 2);

    // Verify _onChangeLeftItemType does not advance page when clicking 'all'
    app.leftGroups = {
        all: new HUDTab({ id: 'all', level: 0 })
    };
    app.leftTabs.activeParents.add('all');
    await app._onChangeLeftItemType({ preventDefault: () => {} }, { dataset: { type: 'all' } });
    assert.equal(app.activePage, 2, 'clicking all when all is active should no longer change activePage');
});

test('ActionDisplayApp _onChangePage sets target page if valid', async () => {
    const app = new ActionDisplayApp({ actor: { id: 'test-actor' } });
    app.totalPages = 4;
    app.activePage = 1;
    app.render = () => {};
    app._saveTabState = () => {};

    await app._onChangePage({ preventDefault: () => {} }, { dataset: { page: '3' } });
    assert.equal(app.activePage, 3);

    // Invalid page out of bounds should not change activePage
    await app._onChangePage({ preventDefault: () => {} }, { dataset: { page: '99' } });
    assert.equal(app.activePage, 3);
});

test('ActionDisplayApp _prepareContext populates pages metadata correctly', async () => {
    const app = new ActionDisplayApp({ actor: { id: 'test-actor' } });
    app.activePage = 2;
    app._saveTabState = () => {};

    // Mock getActions to return items across 2 pages
    actionDisplay.getActions = async () => [
        { id: 'act-1', name: 'Slash', page: 1, left: ['weapon'] },
        { id: 'act-2', name: 'Save', page: 2, left: ['savingThrow'] }
    ];
    actionDisplay.activeSystemAdapter = {
        getItemTypeLabel: (id) => id,
        getItemTypeIcon: () => '',
        getItemSubTabLabel: (parent, sub) => sub,
        getItemTypeSortOrder: () => 1,
        getItemSubTabSortOrder: () => 1,
        getActionTypeLabel: (id) => id,
        getActionTypeIcon: () => '',
        getActionSubTabLabel: (id) => id,
        getActionTypeSortOrder: () => 1,
        getActionSubTabSortOrder: () => 1,
        isExclusionTab: () => false,
        modifyContext: () => {}
    };

    const context = await app._prepareContext({});
    assert.equal(context.totalPages, 2);
    assert.equal(context.activePage, 2);
    assert.equal(context.hasMultiplePages, true);
    assert.equal(context.pages.length, 2);
    assert.deepEqual(context.pages[0], { page: 1, active: false });
    assert.deepEqual(context.pages[1], { page: 2, active: true });
});

test('ActionDisplayApp _onCloseHUD calls close on the application', async () => {
    const app = new ActionDisplayApp({ actor: { id: 'test-actor' } });
    let closeCalled = false;
    app.close = async () => { closeCalled = true; };

    assert.equal(typeof ActionDisplayApp.DEFAULT_OPTIONS.actions.closeHUD, 'function');
    await app._onCloseHUD({ preventDefault: () => {}, stopPropagation: () => {} }, {});
    assert.equal(closeCalled, true);
});

test('ActionDisplayApp Page 2 right tab column initializes activeSubTypes to empty set and displays actions on parent tab selection', async () => {
    const app = new ActionDisplayApp({ actor: { id: 'test-actor' } });
    app.activePage = 2;
    app._saveTabState = () => {};

    const rightCol = app.getTabColumn('right', 2);
    assert.deepEqual(Array.from(rightCol.activeSubTypes), []);

    // Select 'ability' parent tab
    const abilityTab = new HUDTab({
        id: 'ability',
        label: 'Ability',
        subTabs: [
            { id: 'all', label: 'All Actions' },
            { id: 'str', label: 'Strength' },
            { id: 'dex', label: 'Dexterity' }
        ]
    });
    const parentGroups = { ability: abilityTab };
    rightCol.selectParent('ability', parentGroups);

    assert.equal(rightCol.activeParents.has('ability'), true);
    assert.deepEqual(Array.from(rightCol.activeSubTypes), []);
});

test('ActionDisplayApp Page 2 populates Tools left filter tab and filters tool proficiency actions', async () => {
    adapter.system = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const app = new ActionDisplayApp({ actor: { id: 'test-actor', getFlag: () => false, flags: {} } });
    app.activePage = 2;
    app._saveTabState = () => {};

    const mockActions = [
        { id: 'ability-dex', name: 'Dexterity', page: 2, left: ['savingThrow'], itemCategories: [['savingThrow'], ['abilityCheck']], right: [{ path: 'ability/dex', root: 'ability', label: 'dex' }] },
        { id: 'skill-ste', name: 'Stealth', page: 2, left: ['abilityCheck'], right: [{ path: 'ability/dex', root: 'ability', label: 'dex' }] },
        { id: 'tool-thief', name: "Thieves' Tools", page: 2, left: ['tool'], right: [{ path: 'ability/dex', root: 'ability', label: 'dex' }] },
        { id: 'tool-alchemist', name: "Alchemist's Supplies", page: 2, left: ['tool'], right: [{ path: 'ability/int', root: 'ability', label: 'int' }] }
    ];

    actionDisplay.getActions = async () => mockActions;

    // Test with 'all' left tab active
    const ctxAll = await app._prepareContext({});
    assert.equal(ctxAll.itemTypes.some(t => t.id === 'tool'), true);
    const toolTab = ctxAll.itemTypes.find(t => t.id === 'tool');
    assert.equal(toolTab.label, 'DND5E.ItemTypeToolPlural');
    assert.equal(toolTab.icon, 'fas fa-hammer');
    assert.equal(ctxAll.items.length, 4);

    // Test filtering by 'tool' left tab
    app.leftTabs.activeParents.clear();
    app.leftTabs.activeParents.add('tool');
    const ctxTools = await app._prepareContext({});
    assert.equal(ctxTools.items.length, 2);
    assert.deepEqual(ctxTools.items.map(i => i.id).sort(), ['tool-alchemist', 'tool-thief']);

    // Test filtering with right-side ability tab (e.g. dex)
    app.rightTabs.activeParents.clear();
    app.rightTabs.activeParents.add('ability');
    app.rightTabs.activeSubTypes.clear();
    app.rightTabs.activeSubTypes.add('dex');
    const ctxDexTools = await app._prepareContext({});
    assert.equal(ctxDexTools.items.length, 1);
    assert.equal(ctxDexTools.items[0].id, 'tool-thief');
});

test('ActionDisplayApp Page 3 renders token information showcase with 3 pages in pagination', async () => {
    adapter.system = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    const actor = {
        id: 'test-actor-3',
        name: 'Gimli',
        img: 'icons/dwarf.png',
        getFlag: () => false,
        flags: {},
        system: {
            attributes: {
                ac: { value: 17, calc: 'armored' },
                movement: { walk: 25, units: 'ft' }
            },
            traits: {
                size: 'med',
                dr: { value: ['poison'] },
                di: { value: [] },
                ci: { value: [] },
                dv: { value: [] },
                languages: { value: ['common', 'dwarvish'] }
            },
            details: {
                race: 'Dwarf',
                biography: { value: '<p>A mighty axe wielder.</p>' }
            }
        },
        getRollData: () => ({ name: 'Gimli' })
    };

    const app = new ActionDisplayApp({ actor });
    app.activePage = 3;
    app._saveTabState = () => {};

    const mockActions = [
        { id: 'act-1', name: 'Battleaxe', page: 1, left: ['weapon'] },
        { id: 'act-2', name: 'Strength Save', page: 2, left: ['savingThrow'] },
        { id: 'token-info-test-actor-3', name: 'Gimli', page: 3, type: 'info' }
    ];

    actionDisplay.getActions = async () => mockActions;

    const context = await app._prepareContext({});
    assert.equal(context.totalPages, 3);
    assert.equal(context.activePage, 3);
    assert.equal(context.hasMultiplePages, true);
    assert.equal(context.pages.length, 3);
    assert.deepEqual(context.pages[0], { page: 1, active: false });
    assert.deepEqual(context.pages[1], { page: 2, active: false });
    assert.deepEqual(context.pages[2], { page: 3, active: true });
    assert.equal(context.layout, 'tokenInfo');
    assert.equal(context.isCategorized, false);
    assert.deepEqual(context.itemTypes, []);
    assert.deepEqual(context.actionTypes, []);
    assert.ok(context.tokenInfo);
    assert.equal(context.tokenInfo.name, 'Gimli');
    assert.equal(context.tokenInfo.ac.value, 17);
    assert.equal(context.tokenInfo.movement.primary, '25 ft');
    assert.deepEqual(context.tokenInfo.languages, ['Common', 'Dwarvish']);
    assert.deepEqual(context.tokenInfo.resistances, ['Poison']);
});

test('ActionDisplayApp Page 3 renders inspiration indicator and toggles inspiration on click', async () => {
    adapter.system = new Dnd5eSystemAdapter(new FoundryV12Adapter());
    let actorInspiration = false;
    const actor = {
        id: 'test-actor-insp',
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
        update: async (data) => {
            actorInspiration = data['system.attributes.inspiration'];
            actor.system.attributes.inspiration = actorInspiration;
            return data;
        },
        getRollData: () => ({ name: 'Astarion' })
    };

    const app = new ActionDisplayApp({ actor });
    app.activePage = 3;
    app._saveTabState = () => {};

    const mockActions = [
        { id: 'token-info-test-actor-insp', name: 'Astarion', page: 3, type: 'info' }
    ];
    actionDisplay.getActions = async () => mockActions;

    // Initially uninspired
    let context = await app._prepareContext({});
    assert.equal(context.tokenInfo.showInspiration, true);
    assert.equal(context.tokenInfo.inspiration, false);

    // Toggle inspiration via _onToggleInspiration
    let prevented = false;
    let stopped = false;
    const fakeEvent = {
        preventDefault: () => { prevented = true; },
        stopPropagation: () => { stopped = true; }
    };
    await app._onToggleInspiration(fakeEvent, {});
    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(actorInspiration, true);

    // Context reflects inspired state
    context = await app._prepareContext({});
    assert.equal(context.tokenInfo.inspiration, true);

    // Toggle inspiration off
    await app._onToggleInspiration(fakeEvent, {});
    assert.equal(actorInspiration, false);

    // Non-owner without GM rights cannot toggle
    actor.isOwner = false;
    actor.canUserModify = () => false;
    const prevUser = game.user;
    game.user = { isGM: false, name: 'Other Player' };
    await app._onToggleInspiration(fakeEvent, {});
    assert.equal(actorInspiration, false); // Remains unchanged
    game.user = prevUser;
});

test('ActionDisplayApp shift + changePage updates activePage on current HUD and all cached HUDs', async () => {
    ActionDisplayApp.clearTabCache();

    const app1 = new ActionDisplayApp({ actor: { id: 'actor-1', uuid: 'Actor.1' } });
    app1.totalPages = 3;
    app1.activePage = 1;
    app1.render = () => {};
    app1._saveTabState();

    const app2 = new ActionDisplayApp({ actor: { id: 'actor-2', uuid: 'Actor.2' } });
    app2.totalPages = 3;
    app2.activePage = 1;
    app2.render = () => {};
    app2._saveTabState();

    const cache = ActionDisplayApp.getActiveTabCache();
    assert.equal(cache.get('Actor.1').activePage, 1);
    assert.equal(cache.get('Actor.2').activePage, 1);

    // Normal changePage without shift should only update current HUD
    await app2._onChangePage({ preventDefault: () => {}, shiftKey: false }, { dataset: { page: '2' } });
    assert.equal(app2.activePage, 2);
    assert.equal(cache.get('Actor.2').activePage, 2);
    assert.equal(cache.get('Actor.1').activePage, 1, 'Actor 1 cache should remain on page 1 without shiftKey');

    // Shift + changePage should update current HUD and all cached HUDs
    await app2._onChangePage({ preventDefault: () => {}, shiftKey: true }, { dataset: { page: '3' } });
    assert.equal(app2.activePage, 3);
    assert.equal(cache.get('Actor.2').activePage, 3);
    assert.equal(cache.get('Actor.1').activePage, 3, 'Actor 1 cache should be updated to page 3 with shiftKey');

    // A newly instantiated HUD for Actor 1 restores on page 3
    const app1Restored = new ActionDisplayApp({ actor: { id: 'actor-1', uuid: 'Actor.1' } });
    assert.equal(app1Restored.activePage, 3);
});

test('ActionDisplayApp shift + changePage updates persisted hudTabStates when persistTabState is enabled', async () => {
    ActionDisplayApp.clearTabCache();
    game.settings.set(MODULE_ID, 'persistTabState', true);
    game.settings.set(MODULE_ID, 'hudTabStates', {
        'Actor.A': { activePage: 1, left: {}, right: {} },
        'Actor.B': { activePage: 1, left: {}, right: {} }
    });

    const app = new ActionDisplayApp({ actor: { id: 'actor-a', uuid: 'Actor.A' } });
    app.totalPages = 3;
    app.activePage = 1;
    app.render = () => {};

    await app._onChangePage({ preventDefault: () => {}, shiftKey: true }, { dataset: { page: '2' } });
    assert.equal(app.activePage, 2);

    const persisted = game.settings.get(MODULE_ID, 'hudTabStates');
    assert.equal(persisted['Actor.A'].activePage, 2);
    assert.equal(persisted['Actor.B'].activePage, 2);

    game.settings.set(MODULE_ID, 'persistTabState', false);
});

test('ActionDisplayApp shift + previousPage and nextPage update all cached HUDs', async () => {
    ActionDisplayApp.clearTabCache();

    const app1 = new ActionDisplayApp({ actor: { id: 'actor-prev-1', uuid: 'Actor.Prev1' } });
    app1.totalPages = 3;
    app1.activePage = 1;
    app1.render = () => {};
    app1._saveTabState();

    const app2 = new ActionDisplayApp({ actor: { id: 'actor-prev-2', uuid: 'Actor.Prev2' } });
    app2.totalPages = 3;
    app2.activePage = 1;
    app2.render = () => {};
    app2._saveTabState();

    const cache = ActionDisplayApp.getActiveTabCache();

    // Shift + nextPage moves to page 2 and updates all cached HUDs
    await app2._onNextPage({ preventDefault: () => {}, shiftKey: true }, {});
    assert.equal(app2.activePage, 2);
    assert.equal(cache.get('Actor.Prev1').activePage, 2);
    assert.equal(cache.get('Actor.Prev2').activePage, 2);

    // Shift + previousPage moves to page 1 and updates all cached HUDs
    await app2._onPreviousPage({ preventDefault: () => {}, shiftKey: true }, {});
    assert.equal(app2.activePage, 1);
    assert.equal(cache.get('Actor.Prev1').activePage, 1);
    assert.equal(cache.get('Actor.Prev2').activePage, 1);
});

test('ActionDisplayApp shift-clicking already active page bubble propagates page to all other cached HUDs', async () => {
    ActionDisplayApp.clearTabCache();

    const app1 = new ActionDisplayApp({ actor: { id: 'actor-sync-1', uuid: 'Actor.Sync1' } });
    app1.totalPages = 3;
    app1.activePage = 1;
    app1.render = () => {};
    app1._saveTabState();

    const app2 = new ActionDisplayApp({ actor: { id: 'actor-sync-2', uuid: 'Actor.Sync2' } });
    app2.totalPages = 3;
    app2.activePage = 2;
    app2.render = () => {};
    app2._saveTabState();

    const cache = ActionDisplayApp.getActiveTabCache();
    assert.equal(cache.get('Actor.Sync1').activePage, 1);
    assert.equal(cache.get('Actor.Sync2').activePage, 2);

    // Shift-click page 2 while app2 is already on page 2
    await app2._onChangePage({ preventDefault: () => {}, shiftKey: true }, { dataset: { page: '2' } });
    assert.equal(app2.activePage, 2);
    assert.equal(cache.get('Actor.Sync1').activePage, 2, 'Actor 1 cache should be synchronized to page 2');
});

test('ActionDisplayApp clamps activePage in _prepareContext if cached page exceeds actor totalPages', async () => {
    ActionDisplayApp.clearTabCache();

    // Actor with only 1 page has cached activePage = 3
    const cache = ActionDisplayApp.getActiveTabCache();
    cache.set('Actor.SinglePage', { activePage: 3, left: {}, right: {}, pages: {} });

    const app = new ActionDisplayApp({ actor: { id: 'actor-single', uuid: 'Actor.SinglePage' } });
    assert.equal(app.activePage, 3);

    actionDisplay.getActions = async () => [
        { id: 'act-only-page-1', name: 'Punch', page: 1, left: ['weapon'] }
    ];

    const context = await app._prepareContext({});
    assert.equal(app.totalPages, 1);
    assert.equal(app.activePage, 1, 'activePage should clamp to 1 when actor only has 1 page');
    assert.equal(context.activePage, 1);
    assert.equal(context.pages.length, 1);
    assert.deepEqual(context.pages[0], { page: 1, active: true });
});

test('ActionDisplayApp defaultPage internal module setting updates on shift+click and governs new HUDs', async () => {
    ActionDisplayApp.clearTabCache();

    // 1. Initial state: defaultPage defaults to 1
    assert.equal(ActionDisplayApp.defaultPage, 1);
    assert.equal(actionDisplay.defaultPage, 1);

    // 2. A newly opened HUD for an un-cached actor opens to defaultPage (1)
    const app1 = new ActionDisplayApp({ actor: { id: 'actor-init-1', uuid: 'Actor.Init1' } });
    assert.equal(app1.activePage, 1);
    app1.totalPages = 3;
    app1.render = () => {};
    app1._saveTabState();

    // 3. Normal (un-shifted) changePage on app1 does NOT change defaultPage
    await app1._onChangePage({ preventDefault: () => {}, shiftKey: false }, { dataset: { page: '2' } });
    assert.equal(app1.activePage, 2);
    assert.equal(ActionDisplayApp.defaultPage, 1, 'Un-shifted changePage must not change defaultPage');
    assert.equal(actionDisplay.defaultPage, 1);

    // 4. A new HUD for another un-cached actor opens to defaultPage (1), not app1's page (2)
    const app2 = new ActionDisplayApp({ actor: { id: 'actor-init-2', uuid: 'Actor.Init2' } });
    assert.equal(app2.activePage, 1, 'New un-cached actor HUD must open to defaultPage 1');
    app2.totalPages = 3;
    app2.render = () => {};

    // 5. Shift+click on page 3 updates app2, cached app1, AND defaultPage to 3
    await app2._onChangePage({ preventDefault: () => {}, shiftKey: true }, { dataset: { page: '3' } });
    assert.equal(app2.activePage, 3);
    assert.equal(ActionDisplayApp.defaultPage, 3, 'Shift-click must update defaultPage to 3');
    assert.equal(actionDisplay.defaultPage, 3);

    const cache = ActionDisplayApp.getActiveTabCache();
    assert.equal(cache.get('Actor.Init1').activePage, 3, 'Cached Actor 1 must be updated to page 3');
    assert.equal(cache.get('Actor.Init2').activePage, 3, 'Cached Actor 2 must be updated to page 3');

    // 6. A subsequent new HUD for an un-cached Actor 3 opens to defaultPage (3)
    const app3 = new ActionDisplayApp({ actor: { id: 'actor-init-3', uuid: 'Actor.Init3' } });
    assert.equal(app3.activePage, 3, 'New un-cached actor HUD must open to updated defaultPage 3');

    // 7. Calling clearTabCache resets defaultPage back to 1
    ActionDisplayApp.clearTabCache();
    assert.equal(ActionDisplayApp.defaultPage, 1, 'clearTabCache must reset defaultPage to 1');
    assert.equal(actionDisplay.defaultPage, 1);

    // 8. New HUD after clearTabCache opens to defaultPage 1
    const app4 = new ActionDisplayApp({ actor: { id: 'actor-init-4', uuid: 'Actor.Init4' } });
    assert.equal(app4.activePage, 1);
});
