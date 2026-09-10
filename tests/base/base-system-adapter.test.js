import '../setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BaseSystemAdapter } from '../../src/adapters/system/base-system-adapter.js';
import { FoundryV12Adapter } from '../../src/adapters/foundry/foundry-v12-adapter.js';
import { TabRef } from '../../src/ui/tab-ref.js';
import { MODULE_ID } from '../../src/constants.js';

test('BaseSystemAdapter initialization and metadata', () => {
    assert.throws(() => new BaseSystemAdapter('test-system', false, null), /BaseSystemAdapter requires a valid BaseFoundryAdapter instance/);
    assert.throws(() => new BaseSystemAdapter('test-system', false, {}), /BaseSystemAdapter requires a valid BaseFoundryAdapter instance/);

    const adapter = new BaseSystemAdapter('test-system', false, new FoundryV12Adapter());
    assert.equal(adapter.systemId, 'test-system');
    assert.equal(adapter.shouldExtractItem({ type: 'any' }), true);
    const defaultCategories = adapter.getDefaultCategories();
    assert.equal(defaultCategories.length, 4);
    assert.equal(defaultCategories[0].name, 'Favorites');
    assert.equal(defaultCategories[1].name, 'Weapons');
    assert.equal(defaultCategories[2].name, 'Spells');
    assert.equal(defaultCategories[3].name, 'Features');
    assert.equal(adapter.hasFavorites(), false);
    assert.equal(adapter.isFavorite({}, {}), false);
});

test('BaseSystemAdapter favorites default NOP and values', async () => {
    const adapter = new BaseSystemAdapter('test-system', false, new FoundryV12Adapter());
    assert.equal(adapter.hasFavorites(), false);
    assert.equal(adapter.isFavorite({}, {}), false);
    assert.equal(await adapter.setFavorite({}, {}, true), null);
});

test('BaseSystemAdapter label and icon getters', () => {
    const adapter = new BaseSystemAdapter('test-system', false, new FoundryV12Adapter());

    assert.equal(adapter.getItemTypeIcon('all'), 'fas fa-border-all');
    assert.equal(adapter.getItemTypeIcon('unknown'), 'fas fa-question');

    assert.equal(adapter.getActionTypeIcon('all'), 'fas fa-border-all');
    assert.equal(adapter.getActionTypeIcon('none'), 'fas fa-ban');
    assert.equal(adapter.getActionTypeIcon('unknown'), 'fas fa-question');

    assert.equal(adapter.getItemSubTabLabel('spell', 'melee'), 'MELEE');
    assert.equal(adapter.getActionTypeLabel('action'), 'ACTION');
    assert.equal(adapter.getActionSubTabLabel('action'), 'ACTION');
});

test('BaseSystemAdapter sort order lookups', () => {
    const adapter = new BaseSystemAdapter('test-system', false, new FoundryV12Adapter());

    assert.equal(adapter.getItemTypeSortOrder('all'), 0);
    assert.equal(adapter.getItemTypeSortOrder('weapon'), 1);
    assert.equal(adapter.getItemTypeSortOrder('unknown'), 999);

    assert.equal(adapter.getItemSubTabSortOrder('spell', 'all'), 0);
    assert.equal(adapter.getItemSubTabSortOrder('spell', 'itemCharges'), 99);
    assert.equal(adapter.getItemSubTabSortOrder('spell', '3'), 4);
    assert.equal(adapter.getItemSubTabSortOrder('spell', 'foo'), 999);

    assert.equal(adapter.getActionTypeSortOrder('economy'), 1);
    assert.equal(adapter.getActionSubTabSortOrder('economy', 'all'), 0);
});

test('BaseSystemAdapter matchesEconomyTabs matching logic', () => {
    const adapter = new BaseSystemAdapter('test-system', false, new FoundryV12Adapter());

    const action = {
        right: [TabRef.from('economy', 'action')],
        left: ['weapon']
    };

    // All active -> match
    assert.equal(adapter.matchesEconomyTabs(action, {
        right: { activeParents: new Set(['all']), activeSubTypes: new Set() }
    }), true);

    // Economy action active -> match
    assert.equal(adapter.matchesEconomyTabs(action, {
        right: {
            activeParents: new Set(['economy']),
            activeSubTypes: new Set(['action']),
            groups: { economy: { subTabs: [{ id: 'action' }] } }
        }
    }), true);
});

test('BaseSystemAdapter resource depletion check', () => {
    const adapter = new BaseSystemAdapter('test-system', false, new FoundryV12Adapter());

    assert.equal(adapter._isResourceDepleted({ uses: { available: 0 } }), true);
    assert.equal(adapter._isResourceDepleted({ uses: { available: 1 } }), false);
    assert.equal(adapter._isResourceDepleted({ uses: null }), false);
});

test('BaseSystemAdapter modifyActions filters depleted actions when showDepleted is false (default) and includes when true', async () => {
    const adapter = new BaseSystemAdapter('test-system', false, new FoundryV12Adapter());
    const actions = [
        { id: '1', name: 'Infinite Cantrip', uses: null, originalItem: { type: 'spell' } },
        { id: '2', name: 'Depleted Spell', uses: { available: 0, max: 1 }, originalItem: { type: 'spell' } },
        { id: '3', name: 'Available Spell', uses: { available: 1, max: 1 }, originalItem: { type: 'spell' } },
        { id: '4', name: 'Weapon Out of Ammo', uses: { available: 0, max: 10 }, originalItem: { type: 'weapon' } } // Weapons are never hidden
    ];

    // 1. Default (showDepleted: false) -> hides depleted non-weapon items
    await game.settings.set(MODULE_ID, 'showDepleted', false);
    const filteredDefault = await adapter.modifyActions(actions, {});
    assert.equal(filteredDefault.length, 3);
    assert.deepEqual(filteredDefault.map(a => a.id), ['1', '3', '4']);

    // 2. Toggled (showDepleted: true) -> shows all items including depleted
    await game.settings.set(MODULE_ID, 'showDepleted', true);
    const filteredShown = await adapter.modifyActions(actions, {});
    assert.equal(filteredShown.length, 4);

    // Reset back to default
    await game.settings.set(MODULE_ID, 'showDepleted', false);
});

test('BaseSystemAdapter filterSubactions filtering and sorting', () => {
    const adapter = new BaseSystemAdapter('test-system', false, new FoundryV12Adapter());

    const subactions = [
        { id: 'sub-2', name: 'Second Strike', activationType: 'action', sort: 2, right: [TabRef.from('economy', 'action')] },
        { id: 'sub-1', name: 'First Strike', activationType: 'action', sort: 1, right: [TabRef.from('economy', 'action')] }
    ];

    const filtered = adapter.filterSubactions(subactions, {
        right: { activeParents: new Set(['all']), activeSubTypes: new Set() }
    });

    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].id, 'sub-2'); // filterSubactions filters array of subactions matching context
});

import { HUDTabColumn } from '../../src/ui/hud-tab-column.js';

test('BaseSystemAdapter default active sub-types and HUDTabColumn initialization', () => {
    const adapter = new BaseSystemAdapter('test-system', false, new FoundryV12Adapter());
    assert.deepEqual(adapter.getDefaultActiveLeftSubTypes(), []);
    assert.deepEqual(adapter.getDefaultActiveSubTypes(), []);

    const leftTabs = new HUDTabColumn({
        side: 'left',
        getDefaultSubTypes: () => adapter.getDefaultActiveLeftSubTypes()
    });
    const rightTabs = new HUDTabColumn({
        side: 'right',
        getDefaultSubTypes: () => adapter.getDefaultActiveSubTypes()
    });
    assert.equal(leftTabs.side, 'left');
    assert.equal(rightTabs.side, 'right');
    assert.deepEqual([...leftTabs.activeSubTypes], []);
    assert.deepEqual([...rightTabs.activeSubTypes], []);

    const page2Column = new HUDTabColumn({ side: 'left', defaultParent: 'all' });
    assert.equal(page2Column.focusedParent, 'all');
    assert.equal(page2Column.activeParents.has('all'), true);
});

test('BaseSystemAdapter formatFlatLayout template', () => {
    const adapter = new BaseSystemAdapter('test-system', false, new FoundryV12Adapter());
    const items = [
        { id: 'b', name: 'B-Skill' },
        { id: 'a', name: 'A-Core' },
        { id: 'c', name: 'C-Core' }
    ];

    const flatContext = { items };
    adapter.formatFlatLayout(flatContext);
    assert.equal(flatContext.layout, 'flat');
});

test('BaseSystemAdapter getPageConfig defaults to flat layout for all pages', async () => {
    const adapter = new BaseSystemAdapter('test-system', false, new FoundryV12Adapter());
    
    // Default is flat for all pages in BaseSystemAdapter
    assert.deepEqual(adapter.getPageConfig(1), { page: 1, defaultLayout: 'flat', categories: null });
    assert.deepEqual(adapter.getPageConfig(2), { page: 2, defaultLayout: 'flat', categories: null });
    assert.deepEqual(adapter.getPageConfig(3), { page: 3, defaultLayout: 'flat', categories: null });

    const items = [
        { id: 'b', name: 'B-Skill', type: 'skill' },
        { id: 'a', name: 'A-Core', type: 'ability' }
    ];

    const ctxStr = { items };
    adapter.modifyContext(ctxStr, { activePage: '2' });
    assert.equal(ctxStr.layout, 'flat');
    assert.equal(ctxStr.isCategorized, undefined);

    const ctxNum = { items };
    adapter.modifyContext(ctxNum, { activePage: 1 });
    assert.equal(ctxNum.layout, 'flat');
    assert.equal(ctxNum.isCategorized, undefined);
});

test('FantasySystemAdapter getPageConfig defines Page 1 flat, Page 2 categorized, and Page 3 tokenInfo', async () => {
    const { FantasySystemAdapter } = await import('../../src/adapters/system/genre/fantasy-system-adapter.js');
    const adapter = new FantasySystemAdapter('dnd5e', false, new FoundryV12Adapter());

    assert.deepEqual(adapter.getPageConfig(1), { page: 1, defaultLayout: 'flat', categories: null });
    assert.deepEqual(adapter.getPageConfig(2), { page: 2, defaultLayout: 'categorized', categories: null });
    assert.deepEqual(adapter.getPageConfig(3), { page: 3, defaultLayout: 'tokenInfo', categories: null });

    const items = [
        { id: 'b', name: 'B-Skill', type: 'skill' },
        { id: 'a', name: 'A-Core', type: 'ability' }
    ];

    const ctx = { items };
    adapter.modifyContext(ctx, { activePage: 2 });
    assert.equal(ctx.layout, 'categorized');
    assert.equal(ctx.isCategorized, true);
    assert.ok(Array.isArray(ctx.categorizedSections));
});

test('HUDTabColumn resets to default "all" when sole parent is deselected, but not when all main parent tabs are multi-selected', async () => {
    const { HUDTabColumn } = await import('../../src/ui/hud-tab-column.js');
    const col = new HUDTabColumn({ side: 'left', defaultParent: 'all' });
    const groups = {
        all: { id: 'all', subTabs: [] },
        savingThrow: { id: 'savingThrow', subTabs: [] },
        abilityCheck: { id: 'abilityCheck', subTabs: [] }
    };

    col.selectParent('savingThrow', groups);
    assert.ok(col.activeParents.has('savingThrow'));

    // Selecting all main parent tabs does NOT revert to 'all'
    col.toggleParent('abilityCheck', groups);
    assert.ok(col.activeParents.has('savingThrow'));
    assert.ok(col.activeParents.has('abilityCheck'));
    assert.ok(!col.activeParents.has('all'));
    assert.equal(col.activeParents.size, 2);

    // Deselecting the sole active parent reverts to 'all'
    col.selectParent('savingThrow', groups);
    assert.ok(col.activeParents.has('savingThrow'));
    col.toggleParent('savingThrow', groups);
    assert.ok(col.activeParents.has('all'));
});

test('ActionDisplayApp _onRollAction bypasses activity dropdown when only one subaction qualifies and collapseDropdownIfSingle is true', async () => {
    const { ActionDisplayApp } = await import('../../src/ui/action-display-app.js');
    const { actionDisplay } = await import('../../src/action-display.js');
    let rolled = false;
    const action = {
        id: 'ability-str',
        name: 'Strength',
        collapseDropdownIfSingle: true,
        subactions: [
            { id: 'save-str', left: ['savingThrow'], roll: () => { rolled = true; } },
            { id: 'check-str', left: ['abilityCheck'], roll: () => {} }
        ]
    };

    actionDisplay.activeSystemAdapter = {
        filterSubactions: () => [action.subactions[0]],
        getActiveExclusionSubs: () => [],
        getDefaultActiveLeftSubTypes: () => [],
        getDefaultActiveSubTypes: () => []
    };

    const app = new ActionDisplayApp({ actor: {} });
    app.displayedActions = [action];
    app._getFilterContext = () => ({});

    let dropdownCalled = false;
    app._showActivityDropdown = () => { dropdownCalled = true; };

    const fakeTarget = { dataset: { actionId: 'ability-str' } };
    await app._onRollAction({ preventDefault: () => {} }, fakeTarget);

    assert.equal(dropdownCalled, false);
    assert.equal(rolled, true);
});

test('ActionDisplayApp _onRollAction preserves dropdown on regular items when collapseDropdownIfSingle is false', async () => {
    const { ActionDisplayApp } = await import('../../src/ui/action-display-app.js');
    const { actionDisplay } = await import('../../src/action-display.js');
    const action = {
        id: 'item-spell',
        name: 'Fireball',
        collapseDropdownIfSingle: false,
        subactions: [
            { id: 'sub-1', name: 'Cast', roll: () => {} },
            { id: 'sub-2', name: 'Versatile', roll: () => {} }
        ]
    };

    actionDisplay.activeSystemAdapter = {
        filterSubactions: () => [action.subactions[0]],
        getActiveExclusionSubs: () => [],
        getDefaultActiveLeftSubTypes: () => [],
        getDefaultActiveSubTypes: () => []
    };

    const app = new ActionDisplayApp({ actor: {} });
    app.displayedActions = [action];
    app._getFilterContext = () => ({});

    let dropdownCalled = false;
    app._showActivityDropdown = () => { dropdownCalled = true; };

    const fakeTarget = { dataset: { actionId: 'item-spell' } };
    await app._onRollAction({ preventDefault: () => {} }, fakeTarget);

    assert.equal(dropdownCalled, true);
});

test('BaseSystemAdapter getInspiration and toggleInspiration return legacy NOP contracts', async () => {
    const adapter = new BaseSystemAdapter('test-system', false, new FoundryV12Adapter());
    assert.deepEqual(adapter.getInspiration({}), { supported: false, value: false });
    assert.equal(await adapter.toggleInspiration({}, true), false);
});

test('BaseSystemAdapter _createRollEvent safely proxies modifier keys to Foundry KeyboardManager', () => {
    const adapter = new BaseSystemAdapter('test-system', false, new FoundryV12Adapter());

    // 1. Empty / null event handling
    assert.deepEqual(adapter._createRollEvent(null), {});
    assert.deepEqual(adapter._createRollEvent(undefined), {});

    // 2. Normal properties pass through
    const originalEvent = { target: 'btn', preventDefault() { this.prevented = true; } };
    const proxied = adapter._createRollEvent(originalEvent);
    assert.equal(proxied.target, 'btn');
    proxied.preventDefault();
    assert.equal(originalEvent.prevented, true);

    // 3. Modifier queries when keys are not pressed (must not throw TypeError: cannot read some)
    assert.equal(proxied.shiftKey, false);
    assert.equal(proxied.altKey, false);
    assert.equal(proxied.ctrlKey, false);
    assert.equal(proxied.metaKey, false);

    // 4. Modifier queries when keys ARE pressed in game.keyboard
    game.keyboard.downKeys.add('ShiftLeft');
    assert.equal(proxied.shiftKey, true);
    assert.equal(proxied.altKey, false);
    game.keyboard.downKeys.delete('ShiftLeft');

    game.keyboard.downKeys.add('AltRight');
    assert.equal(proxied.altKey, true);
    assert.equal(proxied.ctrlKey, false);
    game.keyboard.downKeys.delete('AltRight');

    game.keyboard.downKeys.add('ControlLeft');
    assert.equal(proxied.ctrlKey, true);
    assert.equal(proxied.metaKey, true);
    game.keyboard.downKeys.delete('ControlLeft');

    // 5. Short-circuit: When the event object itself already has the modifier set
    const shiftEvent = adapter._createRollEvent({ shiftKey: true });
    assert.equal(shiftEvent.shiftKey, true);
});
