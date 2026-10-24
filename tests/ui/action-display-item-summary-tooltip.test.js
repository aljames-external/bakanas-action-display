import { FoundryV12Adapter } from "../../src/adapters/foundry/foundry-v12-adapter.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import '../setup.js';
import { Action } from '../../src/ui/action.js';
import { ActionDisplayApp } from '../../src/ui/action-display-app.js';
import { showActivityDropdown, dropdownSubactionMap } from '../../src/ui/app/dropdown-manager.js';
import { BaseSystemAdapter } from '../../src/adapters/system/base-system-adapter.js';
import { Dnd5eSystemAdapter } from '../../src/adapters/system/dnd5e/index.js';
import { Pf1SystemAdapter } from '../../src/adapters/system/pf1-system-adapter.js';
import { Pf2eSystemAdapter } from '../../src/adapters/system/pf2e-system-adapter.js';
import { adapter } from '../../src/adapters/index.js';

test('BaseSystemAdapter.getItemSummary returns basic item summary properties and enriched description', async () => {
    const baseAdapter = new BaseSystemAdapter('generic', false, new FoundryV12Adapter());
    const mockItem = {
        name: 'Torch',
        type: 'equipment',
        img: 'icons/torch.webp',
        system: {
            range: { value: 20, units: 'ft' },
            damage: { value: '1' },
            description: { value: '<p>A simple [[lookup @name lowercase]]{torch}.</p>' }
        }
    };
    const action = new Action({
        id: 'torch-1',
        name: 'Torch',
        originalItem: mockItem,
        uses: { available: 5, max: 10 }
    });

    const summary = await baseAdapter.getItemSummary(action, mockItem);
    assert.ok(summary);
    assert.equal(summary.title, 'Torch');
    assert.equal(summary.subtitle, 'Equipment');
    assert.equal(summary.img, 'icons/torch.webp');
    assert.ok(summary.properties.some(p => p.label === 'Range' && p.value === '20 ft'));
    assert.ok(summary.properties.some(p => p.label === 'Damage' && p.value === '1'));
    assert.ok(summary.properties.some(p => p.label === 'Uses' && p.value === '5 / 10'));
    assert.equal(summary.description, '<p>A simple torch.</p>');
});

test('Dnd5eSystemAdapter.getItemSummary formats weapons, spells, feats, and Page 2 checks with enriched description', async () => {
    const dnd5eAdapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    // 1. Weapon
    const weaponItem = {
        name: 'Longsword',
        type: 'weapon',
        img: 'icons/longsword.webp',
        labels: {
            activation: '1 Action',
            toHit: '+5',
            damage: '1d8+3 Slashing',
            range: '5 ft'
        },
        system: {
            type: { value: 'martialM', label: 'Martial Melee' },
            properties: new Set(['ver']),
            description: { value: '<p>The [[lookup @name lowercase]]{monster} swings a versatile sword.</p>' }
        }
    };
    const weaponAction = new Action({
        id: 'item-weapon-1',
        name: 'Longsword',
        originalItem: weaponItem
    });

    const weaponSummary = await dnd5eAdapter.getItemSummary(weaponAction, weaponItem);
    assert.ok(weaponSummary);
    assert.equal(weaponSummary.title, 'Longsword');
    assert.ok(weaponSummary.subtitle.includes('Martial Melee'));
    assert.ok(weaponSummary.subtitle.includes('1 Action'));
    assert.ok(weaponSummary.properties.some(p => p.label === 'Attack' && p.value === '+5'));
    assert.ok(weaponSummary.properties.some(p => p.label === 'Damage' && p.value === '1d8+3 Slashing'));
    assert.ok(weaponSummary.properties.some(p => p.label === 'Range' && p.value === '5 ft'));
    assert.ok(weaponSummary.properties.some(p => p.value === 'ver'));
    assert.equal(weaponSummary.description, '<p>The longsword swings a versatile sword.</p>');

    // 2. Spell
    const spellItem = {
        name: 'Fireball',
        type: 'spell',
        img: 'icons/fireball.webp',
        labels: {
            activation: '1 Action',
            damage: '8d6 Fire',
            range: '150 ft',
            save: 'DC 15 Dexterity',
            duration: 'Instantaneous',
            components: { vsm: 'V, S, M' }
        },
        system: {
            level: 3,
            school: 'evo',
            properties: new Set(['ritual']),
            description: { value: 'A bright sphere of fire.' }
        }
    };
    const spellAction = new Action({
        id: 'item-spell-1',
        name: 'Fireball',
        originalItem: spellItem
    });

    const spellSummary = await dnd5eAdapter.getItemSummary(spellAction, spellItem);
    assert.ok(spellSummary);
    assert.equal(spellSummary.title, 'Fireball');
    assert.ok(spellSummary.properties.some(p => p.label === 'Damage' && p.value === '8d6 Fire'));
    assert.ok(spellSummary.properties.some(p => p.label === 'Range' && p.value === '150 ft'));
    assert.ok(spellSummary.properties.some(p => p.label === 'Save' && p.value === 'DC 15 Dexterity'));
    assert.ok(spellSummary.properties.some(p => p.label === 'Components' && p.value === 'V, S, M'));
    assert.ok(spellSummary.properties.some(p => p.value === 'Ritual'));

    // 3. Page 2 Ability & Skill Checks
    const mockActor = {
        system: {
            abilities: {
                dex: { mod: 3, save: 5, value: 16, saveProf: { hasProficiency: true } }
            },
            skills: {
                acr: { ability: 'dex', total: 5, mod: 3, prof: { hasProficiency: true } }
            }
        }
    };
    const abilityAction = new Action({
        id: 'ability-dex',
        name: 'Dexterity',
        type: 'ability',
        page: 2,
        extra: { ability: 'dex' }
    });
    const checkAction = new Action({
        id: 'check-dex',
        name: 'Dexterity Check',
        type: 'abilityCheck',
        page: 2,
        extra: { ability: 'dex' }
    });
    const saveAction = new Action({
        id: 'save-dex',
        name: 'Dexterity Save',
        type: 'save',
        page: 2,
        extra: { ability: 'dex' }
    });
    const skillAction = new Action({
        id: 'skill-acr',
        name: 'Acrobatics',
        type: 'skill',
        page: 2
    });

    const abilitySummary = await dnd5eAdapter.getItemSummary(abilityAction, null, mockActor);
    assert.equal(abilitySummary.title, 'Dexterity');
    assert.equal(abilitySummary.subtitle, 'Ability Check / Saving Throw');
    assert.deepEqual(abilitySummary.headerTags, [{ label: 'Score', value: '16' }]);
    assert.deepEqual(abilitySummary.properties[0], ['Check:', { label: 'Modifier', value: '+3' }]);
    assert.deepEqual(abilitySummary.properties[1], ['Save:', { label: 'Modifier', value: '+5' }, { value: 'Proficient' }]);

    const checkSummary = await dnd5eAdapter.getItemSummary(checkAction, null, mockActor);
    assert.equal(checkSummary.title, 'Dexterity Check');
    assert.equal(checkSummary.subtitle, 'Ability Check');
    assert.deepEqual(checkSummary.headerTags, [{ label: 'Score', value: '16' }]);
    assert.ok(checkSummary.properties.some(p => p.label === 'Modifier' && p.value === '+3'));

    const saveSummary = await dnd5eAdapter.getItemSummary(saveAction, null, mockActor);
    assert.equal(saveSummary.subtitle, 'Saving Throw');
    assert.ok(saveSummary.properties.some(p => p.label === 'Modifier' && p.value === '+5'));
    assert.ok(saveSummary.properties.some(p => p.value === 'Proficient'));

    // Test modern D&D 5e v4+ schema where ability.save is an object with { value, dc }
    const v4Actor = {
        system: {
            abilities: {
                cha: { mod: -1, value: 8, save: { value: -1, dc: 9, proficient: 0 } }
            }
        }
    };
    const chaSaveAction = new Action({
        id: 'save-cha',
        name: 'Charisma Save',
        type: 'save',
        page: 2,
        extra: { ability: 'cha' }
    });
    const chaSaveSummary = await dnd5eAdapter.getItemSummary(chaSaveAction, null, v4Actor);
    assert.equal(chaSaveSummary.subtitle, 'Saving Throw');
    assert.ok(chaSaveSummary.properties.some(p => p.label === 'Modifier' && p.value === '-1'));

    const skillSummary = await dnd5eAdapter.getItemSummary(skillAction, null, mockActor);
    assert.ok(skillSummary.subtitle.includes('Skill Check'));
    assert.ok(skillSummary.properties.some(p => p.label === 'Modifier' && p.value === '+5'));
});

test('Pf1SystemAdapter and Pf2eSystemAdapter getItemSummary extraction', async () => {
    const pf1 = new Pf1SystemAdapter(new FoundryV12Adapter());
    const pf2e = new Pf2eSystemAdapter(new FoundryV12Adapter());

    const pf1Item = {
        name: 'Dagger',
        type: 'weapon',
        labels: { toHit: '+4', damage: '1d4+2', range: '10 ft' },
        system: { description: { value: 'A small dagger.' } }
    };
    const pf1Action = new Action({ id: 'pf1-1', name: 'Dagger', originalItem: pf1Item });
    const pf1Summary = await pf1.getItemSummary(pf1Action, pf1Item);
    assert.equal(pf1Summary.title, 'Dagger');
    assert.ok(pf1Summary.properties.some(p => p.label === 'Attack' && p.value === '+4'));

    const pf2eItem = {
        name: 'Shortsword',
        type: 'weapon',
        system: {
            damage: { dice: 1, die: 'd6', damageType: 'piercing' },
            range: '10 ft',
            traits: { value: ['agile', 'finesse', 'versatile-s'] },
            description: { value: 'A martial shortsword.' }
        }
    };
    const pf2eAction = new Action({ id: 'pf2e-1', name: 'Shortsword', originalItem: pf2eItem });
    const pf2eSummary = await pf2e.getItemSummary(pf2eAction, pf2eItem);
    assert.equal(pf2eSummary.title, 'Shortsword');
    assert.ok(pf2eSummary.properties.some(p => p.label === 'Damage' && p.value === '1d6 piercing'));
    assert.ok(pf2eSummary.properties.some(p => p.value === 'agile'));
});

test('ActionDisplayApp triggers rich tooltip on hover + holding ? key, and hides on key release', async () => {
    adapter.system = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const mockItem = {
        name: 'Greatsword',
        type: 'weapon',
        img: 'icons/greatsword.webp',
        labels: {
            activation: '1 Action',
            toHit: '+6',
            damage: '2d6+4 Slashing',
            range: '5 ft'
        },
        system: {
            description: { value: '<p>A heavy two-handed sword.</p>' }
        }
    };

    const action = new Action({
        id: 'gs-1',
        name: 'Greatsword',
        originalItem: mockItem
    });

    const mockToken = {
        id: 'token-tooltip-1',
        name: 'Hero',
        document: { id: 'token-tooltip-1', isOwner: true },
        actor: {
            id: 'actor-tooltip-1',
            name: 'Hero',
            items: new Map([['gs-1', mockItem]]),
            getFlag: () => ({})
        }
    };

    const app = new ActionDisplayApp(mockToken);
    app.actions = [action];

    // Mock DOM elements
    const itemEl = {
        tagName: 'DIV',
        className: 'bad-action-item',
        dataset: { actionId: 'gs-1' },
        closest: (sel) => (sel === '.bad-action-item' ? itemEl : null),
        getBoundingClientRect: () => ({ left: 200, top: 100, right: 350, bottom: 140 })
    };

    // 1. Hover over item without holding ? -> No tooltip
    app._hoveredActionItem = itemEl;
    assert.equal(globalThis.game.tooltip.active, false);

    // 2. Press '?' while hovering -> Tooltip activates
    await app._onKeyDown({ key: '?', shiftKey: true, target: { tagName: 'DIV' } });
    assert.equal(globalThis.game.tooltip.active, true);
    assert.ok(globalThis.game.tooltip.options.html.includes('Greatsword'));
    assert.ok(globalThis.game.tooltip.options.html.includes('2d6+4 Slashing'));
    assert.equal(globalThis.game.tooltip.options.direction, 'RIGHT');

    // 3. Release '?' -> Tooltip deactivates
    app._onKeyUp({ key: '?', shiftKey: false });
    assert.equal(globalThis.game.tooltip.active, false);

    // 4. Hold '?' first, then hover over item -> Tooltip activates
    await app._onKeyDown({ key: '?', shiftKey: true, target: { tagName: 'DIV' } });
    await app._boundOnPointerOver({ target: itemEl });
    assert.equal(globalThis.game.tooltip.active, true);

    // 5. Pointer leaves item -> Tooltip deactivates
    app._boundOnPointerOut({ target: itemEl, relatedTarget: null });
    assert.equal(globalThis.game.tooltip.active, false);

    // 6. Test window blur clears state
    await app._onKeyDown({ key: '?', shiftKey: true, target: { tagName: 'DIV' } });
    await app._boundOnPointerOver({ target: itemEl });
    assert.equal(globalThis.game.tooltip.active, true);
    app._onWindowBlur();
    assert.equal(globalThis.game.tooltip.active, false);
    assert.equal(app._isQuestionMarkHeld, false);

    // 7. Ignore '?' when typing inside search input
    await app._onKeyDown({ key: '?', shiftKey: true, target: { tagName: 'INPUT' } });
    assert.equal(app._isQuestionMarkHeld, false);
    assert.equal(globalThis.game.tooltip.active, false);

    // 8. Close app cleans up
    await app.close();
    assert.equal(app._hoveredActionItem, null);
    assert.equal(app._isQuestionMarkHeld, false);
});

test('ActionDisplayApp triggers rich tooltip for activities in dropdown menus when holding ?', async () => {
    adapter.system = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const parentItem = {
        name: 'Versatile Staff',
        type: 'weapon',
        system: { description: { value: 'A magical staff.' } }
    };

    const sub1 = new Action({
        id: 'sub-staff-1',
        name: 'Staff Strike',
        originalItem: parentItem,
        originalActivity: {
            name: 'Staff Strike',
            labels: {
                activation: '1 Action',
                toHit: '+4',
                damage: '1d6+2 Bludgeoning',
                range: '5 ft'
            }
        }
    });

    const sub2 = new Action({
        id: 'sub-staff-2',
        name: 'Two-Handed Strike',
        originalItem: parentItem,
        originalActivity: {
            name: 'Two-Handed Strike',
            labels: {
                activation: '1 Action',
                toHit: '+4',
                damage: '1d8+2 Bludgeoning',
                range: '5 ft'
            }
        }
    });

    const parentAction = new Action({
        id: 'parent-staff',
        name: 'Versatile Staff',
        originalItem: parentItem,
        subactions: [sub1, sub2]
    });

    const app = new ActionDisplayApp({
        actor: { isOwner: true }
    });
    app.actions = [parentAction];

    // Mock DOM action card and menu elements
    const targetCard = {
        tagName: 'DIV',
        className: 'bad-action-item',
        dataset: { actionId: 'parent-staff' },
        classList: { add() {}, remove() {}, contains: () => false },
        getBoundingClientRect: () => ({ left: 100, top: 100, right: 250, bottom: 140, width: 150, height: 40 })
    };

    const sub1Li = {
        tagName: 'LI',
        className: 'context-item',
        dataset: {},
        _listeners: {},
        addEventListener(evt, fn) { this._listeners[evt] = fn; },
        querySelector: () => null,
        insertAdjacentHTML: () => {},
        getBoundingClientRect: () => ({ left: 100, top: 140, right: 250, bottom: 175, width: 150, height: 35 })
    };

    const sub2Li = {
        tagName: 'LI',
        className: 'context-item',
        dataset: {},
        _listeners: {},
        addEventListener(evt, fn) { this._listeners[evt] = fn; },
        querySelector: () => null,
        insertAdjacentHTML: () => {},
        getBoundingClientRect: () => ({ left: 100, top: 175, right: 250, bottom: 210, width: 150, height: 35 })
    };

    const mockMenuEl = {
        remove: () => {},
        querySelectorAll: (sel) => (sel === '.context-item' ? [sub1Li, sub2Li] : []),
        style: { setProperty() {} },
        children: []
    };

    const originalQuerySelector = document.querySelector;
    document.querySelector = (sel) => {
        if (sel.includes('#context-menu')) return mockMenuEl;
        return null;
    };

    try {
        await showActivityDropdown(app, targetCard, [sub1, sub2], { preventDefault() {}, stopPropagation() {} });

        // Verify subaction attached to LI
        assert.equal(dropdownSubactionMap.get(sub1Li), sub1);
        assert.equal(dropdownSubactionMap.get(sub2Li), sub2);

        // 1. Hover over first activity while holding '?'
        await app._onKeyDown({ key: '?', shiftKey: true, target: { tagName: 'DIV' } });
        assert.equal(app._isQuestionMarkHeld, true);

        // Trigger pointerover on sub1Li
        await sub1Li._listeners.pointerover();
        assert.equal(globalThis.game.tooltip.active, true);
        assert.ok(globalThis.game.tooltip.options.html.includes('Staff Strike'));
        assert.ok(globalThis.game.tooltip.options.html.includes('1d6+2 Bludgeoning'));

        // 2. Move pointer to second activity sub2Li
        sub1Li._listeners.pointerout({ relatedTarget: sub2Li });
        await sub2Li._listeners.pointerover();
        assert.equal(globalThis.game.tooltip.active, true);
        assert.ok(globalThis.game.tooltip.options.html.includes('Two-Handed Strike'));
        assert.ok(globalThis.game.tooltip.options.html.includes('1d8+2 Bludgeoning'));

        // 3. Release '?'
        app._onKeyUp({ key: '?', shiftKey: false });
        assert.equal(globalThis.game.tooltip.active, false);

        // 4. Close dropdown cleans up
        await app._activeLeftClickMenu.close();
        assert.equal(app._activeLeftClickMenu, null);
    } finally {
        document.querySelector = originalQuerySelector;
    }
});

test('ActionDisplayApp triggers rich tooltip on hover when showItemSummaries toggle is active without holding ?', async () => {
    adapter.system = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const mockItem = {
        name: 'Dagger of Venom',
        type: 'weapon',
        img: 'icons/dagger.webp',
        labels: {
            activation: '1 Action',
            toHit: '+5',
            damage: '1d4+3 Piercing',
            range: '20/60 ft'
        },
        system: {
            description: { value: '<p>A poisoned dagger.</p>' }
        }
    };

    const action = new Action({
        id: 'dagger-1',
        name: 'Dagger of Venom',
        originalItem: mockItem
    });

    const app = new ActionDisplayApp({
        actor: { isOwner: true }
    });
    app.actions = [action];

    const itemEl = {
        tagName: 'DIV',
        className: 'bad-action-item',
        dataset: { actionId: 'dagger-1' },
        closest: (sel) => (sel === '.bad-action-item' ? itemEl : null),
        getBoundingClientRect: () => ({ left: 200, top: 100, right: 350, bottom: 140 })
    };

    // 1. Initial state: showItemSummaries is false -> hover does not activate tooltip
    await game.settings.set('bakana-action-display', 'showItemSummaries', false);
    await app._boundOnPointerOver({ target: itemEl });
    assert.equal(globalThis.game.tooltip.active, false);

    // 2. Enable showItemSummaries via toggle button while hovered -> tooltip activates immediately
    await app._onToggleItemSummaries({}, {});
    assert.equal(game.settings.get('bakana-action-display', 'showItemSummaries'), true);
    assert.equal(globalThis.game.tooltip.active, true);
    assert.ok(globalThis.game.tooltip.options.html.includes('Dagger of Venom'));
    assert.ok(globalThis.game.tooltip.options.html.includes('1d4+3 Piercing'));

    // 3. Pointer moves out -> tooltip deactivates
    app._boundOnPointerOut({ target: itemEl, relatedTarget: null });
    assert.equal(globalThis.game.tooltip.active, false);

    // 4. Hover again with showItemSummaries still true -> tooltip activates without key press
    await app._boundOnPointerOver({ target: itemEl });
    assert.equal(globalThis.game.tooltip.active, true);

    // 5. Keyup does not dismiss tooltip when showItemSummaries is active
    app._onKeyUp({ key: '?', shiftKey: false });
    assert.equal(globalThis.game.tooltip.active, true);

    // 6. Window blur does not dismiss tooltip when showItemSummaries is active
    app._onWindowBlur();
    assert.equal(globalThis.game.tooltip.active, true);

    // 7. Toggle off showItemSummaries -> tooltip deactivates
    await app._onToggleItemSummaries({}, {});
    assert.equal(game.settings.get('bakana-action-display', 'showItemSummaries'), false);
    assert.equal(globalThis.game.tooltip.active, false);

    // 8. Hovering over the ? button itself or other control buttons does NOT activate a tooltip
    const buttonEl = {
        tagName: 'BUTTON',
        className: 'bad-control-btn bad-summary-toggle-btn',
        closest: (sel) => null
    };
    await app._boundOnPointerOver({ target: buttonEl });
    assert.equal(globalThis.game.tooltip.active, false);
    assert.equal(app._hoveredActionItem, null);

    await app.close();
});

test('ActionDisplayApp formats descriptions with roll tables and adds bad-summary-has-table class', async () => {
    const tableHtml = `
        <table>
            <thead>
                <tr>
                    <th>d100</th>
                    <th>Familiarity</th>
                    <th>Mishap</th>
                    <th>Similar Area</th>
                    <th>Off Target</th>
                    <th>On Target</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>01–05</td>
                    <td>Permanent circle</td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td>01–100</td>
                </tr>
            </tbody>
        </table>
    `;

    const mockItem = {
        id: 'teleport-1',
        name: 'Teleport',
        type: 'spell',
        system: {
            description: { value: tableHtml },
            level: 7,
            school: 'con'
        }
    };

    const action = new Action({
        id: 'teleport-1',
        name: 'Teleport',
        originalItem: mockItem
    });

    const app = new ActionDisplayApp({
        actor: { isOwner: true }
    });
    app.actions = [action];

    // 1. Format HTML and verify table class is attached
    const summary = await adapter.getItemSummary(action, mockItem, app.actor);
    const html = app._formatItemSummaryHtml(summary);
    assert.ok(html.includes('bad-summary-has-table'), 'Tooltip should have bad-summary-has-table class');
    assert.ok(html.includes('<table>'), 'Tooltip should contain table element');
    assert.ok(html.includes('Permanent circle'));

    // 2. Verify _showItemSummaryTooltip passes bad-summary-has-table-wrapper
    await game.settings.set('bakana-action-display', 'showItemSummaries', true);
    const itemEl = {
        tagName: 'DIV',
        className: 'bad-action-item',
        dataset: { actionId: 'teleport-1' },
        closest: (sel) => (sel === '.bad-action-item' ? itemEl : null),
        getBoundingClientRect: () => ({ left: 200, top: 100, right: 350, bottom: 140 })
    };

    await app._boundOnPointerOver({ target: itemEl });
    assert.equal(globalThis.game.tooltip.active, true);
    assert.ok(globalThis.game.tooltip.options.cssClass.includes('bad-summary-has-table-wrapper'));
    assert.ok(globalThis.game.tooltip.options.html.includes('bad-summary-has-table'));

    // 3. Verify _chooseTooltipDirection handles wide table tooltips intelligently
    // Screen width 1920, element at left 1500 (spaceRight = 1920 - 1650 = 270 < 500) -> Should choose LEFT
    const rightSideEl = {
        getBoundingClientRect: () => ({ left: 1500, top: 100, right: 1650, bottom: 140 })
    };
    assert.equal(app._chooseTooltipDirection(rightSideEl, true), 'LEFT');

    // Element at left 100 (spaceRight = 1920 - 250 = 1670 >= 500) -> Should choose RIGHT
    const leftSideEl = {
        getBoundingClientRect: () => ({ left: 100, top: 100, right: 250, bottom: 140 })
    };
    assert.equal(app._chooseTooltipDirection(leftSideEl, true), 'RIGHT');

    // 4. Verify _calculateTableTooltipWidth and _applyTooltipWidth dynamic sizing
    const mockTooltipEl = {
        style: {
            properties: {},
            setProperty(k, v) { this.properties[k] = v; },
            removeProperty(k) { delete this.properties[k]; }
        }
    };

    const origQuerySelector = document.querySelector;
    document.querySelector = (sel) => {
        if (sel.includes('#tooltip')) return mockTooltipEl;
        return null;
    };

    try {
        const metrics = app._calculateTableTooltipWidth(tableHtml);
        assert.ok(metrics.targetWidth >= 340 && metrics.targetWidth <= 680, 'Calculated width should be bounded between 340px and 680px');
        assert.equal(metrics.needsHorizontalScroll, false, 'Teleport table fits within 680px so horizontal scroll is not needed');

        // Formatted HTML should not have overflow-x class when table fits
        const htmlNormal = app._formatItemSummaryHtml(summary, metrics.targetWidth, metrics.needsHorizontalScroll);
        assert.ok(htmlNormal.includes('bad-summary-has-table'));
        assert.equal(htmlNormal.includes('bad-summary-overflow-x'), false);
        assert.ok(htmlNormal.includes(`--bad-tooltip-width: ${metrics.targetWidth}px`), 'Child element should set CSS variable');
        assert.equal(htmlNormal.includes(`; width: ${metrics.targetWidth}px;`), false, 'Child element must not have fixed inline pixel width override');

        // When needsHorizontalScroll is true, bad-summary-overflow-x class is attached
        const htmlOverflow = app._formatItemSummaryHtml(summary, 680, true);
        assert.ok(htmlOverflow.includes('bad-summary-overflow-x'));

        app._applyTooltipWidth(504);
        assert.equal(mockTooltipEl.style.properties['width'], '504px');
        assert.equal(mockTooltipEl.style.properties['max-width'], '504px');
        assert.equal(mockTooltipEl.style.properties['min-width'], '340px');
        assert.equal(mockTooltipEl.style.properties['--bad-tooltip-width'], '504px');
        assert.equal(mockTooltipEl.style.properties['--bad-tooltip-max-width'], '504px');
        assert.equal(mockTooltipEl.style.properties['box-sizing'], 'border-box');

        // Hide tooltip cleans up style properties
        app._hideItemSummaryTooltip();
        assert.equal(mockTooltipEl.style.properties['width'], undefined);
        assert.equal(mockTooltipEl.style.properties['--bad-tooltip-width'], undefined);
        assert.equal(mockTooltipEl.style.properties['box-sizing'], undefined);
    } finally {
        document.querySelector = origQuerySelector;
    }

    await game.settings.set('bakana-action-display', 'showItemSummaries', false);
    await app.close();
});

test('ActionDisplayApp forwards wheel scrolling to focused/locked tooltip description when HUD or tooltip is scrolled', async () => {
    await game.settings.set('bakana-action-display', 'showItemSummaries', true);

    const token = {
        id: 'token-wheel-tooltip',
        document: { id: 'token-wheel-tooltip', isOwner: true },
        actor: {
            id: 'actor-wheel-tooltip',
            name: 'Wheel Scroller',
            isOwner: true,
            items: [
                {
                    id: 'spell-long-desc',
                    name: 'Very Long Spell',
                    type: 'spell',
                    system: {
                        description: { value: '<p>Line 1</p><p>Line 2</p><p>Line 3</p><p>Line 4</p><p>Line 5</p>' },
                        level: 1,
                        method: 'prepared',
                        prepared: true
                    }
                }
            ]
        }
    };

    const app = new ActionDisplayApp(token);
    await app.render(true);

    const mockDescEl = {
        tagName: 'DIV',
        className: 'bad-summary-desc',
        classList: { contains: (c) => c === 'bad-summary-desc' },
        scrollTop: 0,
        scrollLeft: 0,
        scrollHeight: 500,
        clientHeight: 200
    };

    const mockTooltipEl = {
        tagName: 'ASIDE',
        id: 'tooltip',
        className: 'locked bad-item-summary-tooltip-wrapper',
        classList: { contains: (c) => c === 'locked' || c === 'bad-item-summary-tooltip-wrapper' },
        querySelector: (sel) => sel.includes('bad-summary-desc') ? mockDescEl : null,
        closest: (sel) => sel.includes('bad-item-summary-tooltip') || sel.includes('tooltip') ? mockTooltipEl : null,
        style: {
            properties: {},
            setProperty(prop, val) { this.properties[prop] = val; },
            removeProperty(prop) { delete this.properties[prop]; }
        }
    };

    const origQuerySelector = document.querySelector;
    document.querySelector = (sel) => {
        if (sel.includes('bad-summary-desc')) return mockDescEl;
        if (sel.includes('tooltip')) return mockTooltipEl;
        return null;
    };

    try {
        game.tooltip.locked = true;

        // 1. Wheel event inside the HUD element while tooltip is locked -> scrolls mockDescEl
        let prevented = false;
        let stopped = false;
        const hudWheelEvent = {
            deltaY: 40,
            deltaX: 0,
            preventDefault() { prevented = true; },
            stopPropagation() { stopped = true; }
        };

        app._onWheel(hudWheelEvent);
        assert.equal(prevented, true, 'Wheel event on HUD should be prevented when tooltip is locked');
        assert.equal(stopped, true, 'Wheel event on HUD should be stopped when tooltip is locked');
        assert.equal(mockDescEl.scrollTop, 40, 'Tooltip description scrollTop should advance by deltaY');

        // 2. Wheel event directly on window with tooltip target -> scrolls mockDescEl
        prevented = false;
        stopped = false;
        const windowWheelEvent = {
            deltaY: 50,
            deltaX: 0,
            target: mockTooltipEl,
            preventDefault() { prevented = true; },
            stopPropagation() { stopped = true; }
        };

        app._onWindowWheel(windowWheelEvent);
        assert.equal(prevented, true, 'Window wheel event on tooltip should be prevented');
        assert.equal(stopped, true, 'Window wheel event on tooltip should be stopped');
        assert.equal(mockDescEl.scrollTop, 90, 'Tooltip description scrollTop should advance to 90');

        // 3. Horizontal scrolling when shift key is held and bad-summary-overflow-x is present
        mockDescEl.classList.contains = (c) => c === 'bad-summary-desc' || c === 'bad-summary-overflow-x';
        const shiftWheelEvent = {
            deltaY: 30,
            deltaX: 0,
            shiftKey: true,
            target: mockTooltipEl,
            preventDefault() {},
            stopPropagation() {}
        };
        app._onWindowWheel(shiftWheelEvent);
        assert.equal(mockDescEl.scrollLeft, 30, 'Shift wheel should scroll horizontally');

        // 4. _hideItemSummaryTooltip does NOT dismiss when locked is true
        app._activeSummaryTooltip = { element: {} };
        app._hideItemSummaryTooltip();
        assert.ok(app._activeSummaryTooltip !== null, '_activeSummaryTooltip should remain active when locked');

        // 5. When unlocked, _hideItemSummaryTooltip cleans up normally
        game.tooltip.locked = false;
        document.querySelector = () => null;
        app._hideItemSummaryTooltip();
        assert.equal(app._activeSummaryTooltip, null, '_activeSummaryTooltip should be cleared when unlocked');
    } finally {
        game.tooltip.locked = false;
        document.querySelector = origQuerySelector;
    }

    await game.settings.set('bakana-action-display', 'showItemSummaries', false);
    await app.close();
});

test('ActionDisplayApp _formatItemSummaryHtml renders structured property tag rows with row labels and headerTags', () => {
    const app = new ActionDisplayApp({ actor: {} });
    const summary = {
        title: 'Charisma',
        subtitle: 'Ability Check / Saving Throw',
        headerTags: [{ label: 'Score', value: '13' }],
        properties: [
            ['Check:', { label: 'Modifier', value: '+1' }, { value: 'Proficient' }],
            ['Save:', { label: 'Modifier', value: '-1' }]
        ]
    };

    const html = app._formatItemSummaryHtml(summary);
    assert.ok(html.includes('<div class="bad-summary-title-row">'));
    assert.ok(html.includes('<span class="bad-summary-tag">Score: 13</span>'));
    assert.ok(html.includes('<div class="bad-summary-tag-row">'));
    assert.ok(html.includes('<span class="bad-summary-row-label">Check:</span>'));
    assert.ok(html.includes('<span class="bad-summary-row-label">Save:</span>'));
    assert.ok(html.includes('<span class="bad-summary-tag">Modifier: +1</span>'));
    assert.ok(html.includes('<span class="bad-summary-tag">Modifier: -1</span>'));
    assert.ok(html.includes('<span class="bad-summary-tag">Proficient</span>'));
});

test('Dnd5eSystemAdapter.getItemSummary resolves linked spell description and metadata for Archmage Spellcasting activities', async () => {
    const dnd5eAdapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const spellcastingFeat = {
        id: 'feat-spellcasting',
        name: 'Spellcasting',
        type: 'feat',
        system: {
            description: { value: '<p>The archmage is an 18th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 17, +9 to hit with spell attacks).</p>' }
        }
    };

    const teleportSpell = {
        id: 'spell-teleport',
        name: 'Teleport',
        type: 'spell',
        labels: {
            activation: '1 Action',
            range: '10 ft',
            duration: 'Instantaneous',
            components: { vsm: 'V' }
        },
        system: {
            level: 7,
            school: 'con',
            properties: new Set([]),
            description: { value: '<p>This spell instantly transports you and up to eight willing creatures to a destination you select.</p>' }
        }
    };

    const teleportAction = new Action({
        id: 'act-teleport',
        name: 'Teleport',
        originalItem: spellcastingFeat,
        originalActivity: {
            name: 'Teleport',
            type: 'cast',
            labels: { activation: '1 Action' }
        },
        linkedAction: teleportSpell
    });

    const summary = await dnd5eAdapter.getItemSummary(teleportAction, spellcastingFeat);
    assert.ok(summary);
    assert.equal(summary.title, 'Teleport');
    assert.ok(summary.description.includes('This spell instantly transports you'), 'Description should come from linked spell');
    assert.ok(!summary.description.includes('18th-level spellcaster'), 'Description should not come from parent spellcasting feat');
    assert.ok(summary.subtitle.includes('7th Level'), 'Subtitle should reflect spell level');
    assert.ok(summary.subtitle.includes('con'), 'Subtitle should reflect spell school');
    assert.ok(summary.properties.some(p => p.label === 'Components' && p.value === 'V'), 'Properties should include spell components');
});

test('Dnd5eSystemAdapter.getItemSummary prioritizes activity description over parent item description', async () => {
    const dnd5eAdapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const parentFeat = {
        id: 'feat-multi-form',
        name: 'Starry Form',
        type: 'feat',
        system: {
            description: { value: '<p>As a bonus action, you can expend a use of your Wild Shape feature to take on a starry form.</p>' }
        }
    };

    const archerActivity = {
        name: 'Archer',
        type: 'utility',
        labels: { activation: '1 Bonus Action' },
        description: { value: '<p>A constellation of an archer appears on you. Make a ranged spell attack.</p>' }
    };

    const archerAction = new Action({
        id: 'act-archer',
        name: 'Archer',
        originalItem: parentFeat,
        originalActivity: archerActivity
    });

    const summary = await dnd5eAdapter.getItemSummary(archerAction, parentFeat);
    assert.ok(summary);
    assert.equal(summary.title, 'Archer');
    assert.ok(summary.description.includes('A constellation of an archer appears on you'), 'Description should come from activity description');
    assert.ok(!summary.description.includes('Wild Shape feature'), 'Description should not fall back to parent item when activity has description');
});

test('ActionDisplayApp renders linked spell description when hovering over activity in dropdown menu', async () => {
    adapter.system = new Dnd5eSystemAdapter(new FoundryV12Adapter());

    const spellcastingFeat = {
        name: 'Spellcasting',
        type: 'feat',
        system: {
            description: { value: '<p>The archmage is an 18th-level spellcaster.</p>' }
        }
    };

    const teleportSpell = {
        name: 'Teleport',
        type: 'spell',
        labels: { activation: '1 Action', range: '10 ft', duration: 'Instantaneous' },
        system: {
            level: 7,
            school: 'con',
            properties: new Set([]),
            description: { value: '<p>Teleports creatures instantly.</p>' }
        }
    };

    const teleportSubAction = new Action({
        id: 'sub-teleport',
        name: 'Teleport',
        originalItem: spellcastingFeat,
        originalActivity: {
            name: 'Teleport',
            type: 'cast',
            labels: { activation: '1 Action' }
        },
        linkedAction: teleportSpell
    });

    const parentAction = new Action({
        id: 'parent-spellcasting',
        name: 'Spellcasting',
        originalItem: spellcastingFeat,
        subactions: [teleportSubAction]
    });

    const app = new ActionDisplayApp({
        actor: { isOwner: true }
    });
    app.actions = [parentAction];

    const targetCard = {
        tagName: 'DIV',
        className: 'bad-action-item',
        dataset: { actionId: 'parent-spellcasting' },
        classList: { add() {}, remove() {}, contains: () => false },
        getBoundingClientRect: () => ({ left: 100, top: 100, right: 250, bottom: 140, width: 150, height: 40 })
    };

    const teleportLi = {
        tagName: 'LI',
        className: 'context-item',
        dataset: {},
        _listeners: {},
        addEventListener(evt, fn) { this._listeners[evt] = fn; },
        querySelector: () => null,
        insertAdjacentHTML: () => {},
        getBoundingClientRect: () => ({ left: 100, top: 140, right: 250, bottom: 175, width: 150, height: 35 })
    };

    const mockMenuEl = {
        remove: () => {},
        querySelectorAll: (sel) => (sel === '.context-item' ? [teleportLi] : []),
        style: { setProperty() {} },
        children: []
    };

    const originalQuerySelector = document.querySelector;
    document.querySelector = (sel) => {
        if (sel.includes('#context-menu')) return mockMenuEl;
        return null;
    };

    try {
        await showActivityDropdown(app, targetCard, [teleportSubAction], { preventDefault() {}, stopPropagation() {} });

        // Verify subaction attached to LI
        assert.equal(dropdownSubactionMap.get(teleportLi), teleportSubAction);

        // Hover over teleport in dropdown while holding '?'
        await app._onKeyDown({ key: '?', shiftKey: true, target: { tagName: 'DIV' } });
        await teleportLi._listeners.pointerover();

        assert.equal(globalThis.game.tooltip.active, true);
        assert.ok(globalThis.game.tooltip.options.html.includes('Teleport'), 'Tooltip HTML should include Teleport');
        assert.ok(globalThis.game.tooltip.options.html.includes('Teleports creatures instantly.'), 'Tooltip HTML should include Teleport spell description');
        assert.ok(!globalThis.game.tooltip.options.html.includes('18th-level spellcaster'), 'Tooltip HTML should NOT include parent Spellcasting description');

        app._onKeyUp({ key: '?', shiftKey: false });
        await app._activeLeftClickMenu.close();
    } finally {
        document.querySelector = originalQuerySelector;
    }
});

test('ActionDisplayApp autoban tooltip closes immediately on tab pointerout when not focused, and suppresses enrich preview unless locked', () => {
    const actor = {
        name: 'Gale',
        flags: {}
    };
    const app = new ActionDisplayApp(actor);

    let deactivated = false;
    const originalDeactivate = globalThis.game.tooltip.deactivate;
    globalThis.game.tooltip.deactivate = () => {
        deactivated = true;
    };
    globalThis.game.tooltip.locked = false;

    const verbalTabEl = {
        closest: (selector) => {
            if (selector.includes('bad-right-sub-tab')) return verbalTabEl;
            return null;
        }
    };
    const outsideEl = {
        closest: () => null
    };

    try {
        // 1. Leaving Verbal tab when NOT focused/locked -> deactivates immediately
        deactivated = false;
        app._onPointerOut({
            target: verbalTabEl,
            relatedTarget: outsideEl
        });
        assert.equal(deactivated, true, 'Tooltip should deactivate immediately when mouse leaves Verbal tab while unlocked');

        // 2. Leaving Verbal tab when FOCUSED/LOCKED -> does NOT deactivate
        deactivated = false;
        globalThis.game.tooltip.locked = true;
        app._onPointerOut({
            target: verbalTabEl,
            relatedTarget: outsideEl
        });
        assert.equal(deactivated, false, 'Tooltip should NOT deactivate when mouse leaves Verbal tab while locked');

        // 3. Hovering over content-link when NOT focused/locked -> intercept and block
        globalThis.game.tooltip.locked = false;
        let stopped = false;
        let prevented = false;
        const linkEl = {
            closest: (selector) => {
                if (selector.includes('.bad-autoban-tooltip .content-link')) return linkEl;
                return null;
            }
        };
        app._boundOnAutobanPointerOverCapture({
            target: linkEl,
            stopImmediatePropagation: () => { stopped = true; },
            preventDefault: () => { prevented = true; }
        });
        assert.equal(stopped, true, 'Should stop propagation of content-link hover when tooltip is unlocked');
        assert.equal(prevented, true, 'Should prevent default of content-link hover when tooltip is unlocked');

        // 4. Hovering over content-link when FOCUSED/LOCKED -> allow hover event through
        globalThis.game.tooltip.locked = true;
        stopped = false;
        prevented = false;
        app._boundOnAutobanPointerOverCapture({
            target: linkEl,
            stopImmediatePropagation: () => { stopped = true; },
            preventDefault: () => { prevented = true; }
        });
        assert.equal(stopped, false, 'Should allow content-link hover event when tooltip is locked');
        assert.equal(prevented, false, 'Should allow content-link default event when tooltip is locked');
    } finally {
        globalThis.game.tooltip.deactivate = originalDeactivate;
        globalThis.game.tooltip.locked = false;
    }
});

test('ActionDisplayApp single-focus discipline closes previous locked tab when middle-clicking another tab', () => {
    const actor = {
        name: 'Gale',
        flags: {}
    };
    const app = new ActionDisplayApp(actor);

    const verbalTabEl = {
        name: 'verbal',
        closest: (selector) => {
            if (selector.includes('bad-right-sub-tab')) return verbalTabEl;
            return null;
        },
        getAttribute: (attr) => attr === 'data-tooltip' ? 'Auto-Banned: Verbal' : null,
        dataset: { tooltip: 'Auto-Banned: Verbal' }
    };
    const somaticTabEl = {
        name: 'somatic',
        closest: (selector) => {
            if (selector.includes('bad-right-sub-tab')) return somaticTabEl;
            return null;
        },
        getAttribute: (attr) => attr === 'data-tooltip' ? 'Auto-Banned: Somatic' : null,
        dataset: { tooltip: 'Auto-Banned: Somatic' }
    };
    const componentsTabEl = {
        name: 'components',
        closest: (selector) => {
            if (selector.includes('bad-right-tab')) return componentsTabEl;
            return null;
        },
        getAttribute: () => null,
        dataset: {}
    };

    let verbalClosed = false;
    const mockVerbalLockedEl = {
        classList: {
            contains: (cls) => cls === 'locked-tooltip' || cls === 'locked',
            remove: () => {}
        },
        querySelector: () => null,
        remove: () => { verbalClosed = true; }
    };

    const originalQuerySelectorAll = document.querySelectorAll;
    let lockedQueryResults = [];
    document.querySelectorAll = (selector) => {
        if (selector.includes('locked')) return lockedQueryResults;
        return originalQuerySelectorAll?.(selector) ?? [];
    };

    const originalQuerySelector = document.querySelector;
    document.querySelector = (selector) => {
        if (selector.includes('#tooltip')) {
            return {
                textContent: 'Tooltip content',
                children: [{}],
                classList: { remove() {}, add() {} },
                dataset: {}
            };
        }
        return originalQuerySelector?.(selector) ?? null;
    };

    try {
        // 0. Middle-click "Components" parent tab without tooltip -> does nothing (cannot lock empty tooltip)
        app._onMiddleClickCapture({
            button: 1,
            target: componentsTabEl,
            stopImmediatePropagation: () => {},
            preventDefault: () => {}
        });
        assert.equal(app._lockedTooltipTarget, null, 'Components tab without tooltip must not be locked');
        // 1. Middle-click "Verbal" -> locks Verbal
        app._onMiddleClickCapture({
            button: 1,
            target: verbalTabEl,
            stopImmediatePropagation: () => {},
            preventDefault: () => {}
        });
        assert.equal(app._lockedTooltipTarget, verbalTabEl, 'Locked target should be Verbal');

        // Simulate Verbal now being locked
        globalThis.game.tooltip.locked = true;
        lockedQueryResults = [mockVerbalLockedEl];

        // 2. Middle-click "Somatic" -> closes Verbal, sets locked target to Somatic
        app._onMiddleClickCapture({
            button: 1,
            target: somaticTabEl,
            stopImmediatePropagation: () => {},
            preventDefault: () => {}
        });
        assert.equal(verbalClosed, true, 'Verbal locked tooltip should have been closed/removed');
        assert.equal(app._lockedTooltipTarget, somaticTabEl, 'Locked target should now be Somatic');

        // Simulate Foundry locking Somatic
        globalThis.game.tooltip.locked = true;

        // 3. Middle-click "Somatic" again (same tab) -> toggles/dismisses lock
        let stopped = false;
        let prevented = false;
        app._onMiddleClickCapture({
            button: 1,
            target: somaticTabEl,
            stopImmediatePropagation: () => { stopped = true; },
            preventDefault: () => { prevented = true; }
        });
        assert.equal(stopped, true, 'Should stop propagation when middle-clicking same locked tab to dismiss');
        assert.equal(prevented, true, 'Should prevent default when middle-clicking same locked tab to dismiss');
        assert.equal(app._lockedTooltipTarget, null, 'Locked target should be cleared');

        // 4. Middle-clicking inside a locked tooltip -> dismisses locked tooltip
        stopped = false;
        prevented = false;
        const insideLockedEl = {
            closest: (selector) => {
                if (selector.includes('locked-tooltip') || selector.includes('#tooltip.locked')) return insideLockedEl;
                return null;
            }
        };
        app._onMiddleClickCapture({
            button: 1,
            target: insideLockedEl,
            stopImmediatePropagation: () => { stopped = true; },
            preventDefault: () => { prevented = true; }
        });
        assert.equal(stopped, true, 'Should stop propagation when middle-clicking inside locked tooltip');
        assert.equal(prevented, true, 'Should prevent default when middle-clicking inside locked tooltip');

        // 5. Auxclick on tab is cancelled to prevent browser middle-click behaviors
        stopped = false;
        prevented = false;
        app._onAuxClickCapture({
            button: 1,
            target: verbalTabEl,
            stopImmediatePropagation: () => { stopped = true; },
            preventDefault: () => { prevented = true; }
        });
        assert.equal(stopped, true, 'Should stop propagation of auxclick on HUD tab');
        assert.equal(prevented, true, 'Should prevent default of auxclick on HUD tab');
    } finally {
        document.querySelectorAll = originalQuerySelectorAll;
        document.querySelector = originalQuerySelector;
        globalThis.game.tooltip.locked = false;
    }
});



