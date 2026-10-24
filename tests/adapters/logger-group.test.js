import { FoundryV12Adapter } from "../../src/adapters/foundry/foundry-v12-adapter.js";
import '../setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Adapter, BaseSystemAdapter } from '../../src/adapters/index.js';
import { Dnd5eSystemAdapter } from '../../src/adapters/system/dnd5e/index.js';
import { MODULE_ID } from '../../src/constants.js';
import { log } from '../../src/lib/logger.js';

test('log.group and log.groupEnd respect verbosity levels and encapsulate debug groups', () => {
    const groups = [];
    const origGroup = console.group;
    const origGroupCollapsed = console.groupCollapsed;
    const origGroupEnd = console.groupEnd;

    console.group = (...args) => groups.push({ type: 'start', args });
    console.groupCollapsed = (...args) => groups.push({ type: 'start', args });
    console.groupEnd = () => groups.push({ type: 'end' });

    try {
        // 1. When verbosity is 'warn' (default), 'debug' group is suppressed
        log.setVerbosity('warn');
        log.group('Suppressed debug group', 'debug');
        log.debug('Debug message while warn verbosity');
        log.groupEnd();
        assert.equal(groups.length, 0, 'Debug groups should not trigger console.group when verbosity is warn');

        // 2. When verbosity is 'debug', 'debug' group is logged IF a debug message is logged
        log.setVerbosity('debug');
        log.group('Active debug group', 'debug');
        log.debug('Active debug message');
        log.groupEnd();
        assert.equal(groups.length, 2, 'Debug group should trigger console.group and console.groupEnd when debug message executes');
        assert.equal(groups[0].type, 'start');
        assert.ok(groups[0].args[0].includes('Active debug group'));
        assert.ok(groups[0].args[1].includes('#38bdf8'), 'Debug group should have teal highlight');
        assert.equal(groups[1].type, 'end');

        // 3. When verbosity is 'debug' but NO debug message executes, group is NOT started (no empty groups)
        groups.length = 0;
        log.group('Empty debug group', 'debug');
        log.groupEnd();
        assert.equal(groups.length, 0, 'Empty debug group with no logs must not trigger console.group');
    } finally {
        console.group = origGroup;
        console.groupCollapsed = origGroupCollapsed;
        console.groupEnd = origGroupEnd;
        log.setVerbosity('warn');
    }
});

test('log.group and log.groupCollapsed apply distinct color highlights per verbosity level', () => {
    const groups = [];
    const origGroup = console.group;
    const origGroupCollapsed = console.groupCollapsed;
    const origGroupEnd = console.groupEnd;

    console.group = (...args) => groups.push({ type: 'group', args });
    console.groupCollapsed = (...args) => groups.push({ type: 'collapsed', args });
    console.groupEnd = () => groups.push({ type: 'end' });

    log.setVerbosity('debug');

    try {
        // Error: red (#ef4444), starts out expanded
        log.group('Error group', 'error');
        log.error('Error occurred');
        log.groupEnd();
        assert.equal(groups[0].type, 'group', 'Error group should start out expanded');
        assert.ok(groups[0].args[0].includes('BAD | Error group'));
        assert.ok(groups[0].args[1].includes('#ef4444'), 'Error group should have red highlight');

        // Warn: yellow-orange (#f59e0b), starts out expanded
        log.group('Warn group', 'warn');
        log.warn('Warning occurred');
        log.groupEnd();
        assert.equal(groups[2].type, 'group', 'Warn group should start out expanded');
        assert.ok(groups[2].args[0].includes('BAD | Warn group'));
        assert.ok(groups[2].args[1].includes('#f59e0b'), 'Warn group should have yellow-orange highlight');

        // Info: white (#ffffff), starts out collapsed
        log.group('Info group', 'info');
        log.info('Info occurred');
        log.groupEnd();
        assert.equal(groups[4].type, 'collapsed', 'Info group should start out collapsed');
        assert.ok(groups[4].args[0].includes('BAD | Info group'));
        assert.ok(groups[4].args[1].includes('#ffffff'), 'Info group should have white highlight');

        // Default level (no level arg): info (#ffffff), starts out collapsed
        log.group('Default group');
        log.info('Default message');
        log.groupEnd();
        assert.equal(groups[6].type, 'collapsed', 'Default group should default to collapsed');
        assert.ok(groups[6].args[0].includes('BAD | Default group'));
        assert.ok(groups[6].args[1].includes('#ffffff'), 'Default group should default to white highlight');

        // Debug: teal (#38bdf8), starts out collapsed
        log.group('Debug group', 'debug');
        log.debug('Debug occurred');
        log.groupEnd();
        assert.equal(groups[8].type, 'collapsed', 'Debug group should start out collapsed');
        assert.ok(groups[8].args[0].includes('BAD | Debug group'));
        assert.ok(groups[8].args[1].includes('#38bdf8'), 'Debug group should have teal highlight');

        // Collapsed group: triggers console.groupCollapsed with styling
        log.groupCollapsed('Explicit collapsed group', 'warn');
        log.warn('Warn occurred in collapsed');
        log.groupEnd();
        assert.equal(groups[10].type, 'collapsed');
        assert.ok(groups[10].args[0].includes('BAD | Explicit collapsed group'));
        assert.ok(groups[10].args[1].includes('#f59e0b'), 'Explicit collapsed warn group should have yellow-orange highlight');

        // Expanded group: triggers console.group with styling
        log.groupExpanded('Explicit expanded debug group', 'debug');
        log.debug('Debug occurred in expanded');
        log.groupEnd();
        assert.equal(groups[12].type, 'group', 'groupExpanded should force expanded group');
        assert.ok(groups[12].args[0].includes('BAD | Explicit expanded debug group'));
        assert.ok(groups[12].args[1].includes('#38bdf8'), 'Explicit expanded debug group should have teal highlight');
    } finally {
        console.group = origGroup;
        console.groupCollapsed = origGroupCollapsed;
        console.groupEnd = origGroupEnd;
        log.setVerbosity('warn');
    }
});

test('Adapter._extractBaseActions and Adapter.getActions encapsulate extraction and filtering in log.group sections', async () => {
    const groups = [];
    const origGroup = console.group;
    const origGroupCollapsed = console.groupCollapsed;
    const origGroupEnd = console.groupEnd;

    console.group = (...args) => groups.push({ type: 'start', label: args[0] });
    console.groupCollapsed = (...args) => groups.push({ type: 'start', label: args[0] });
    console.groupEnd = () => groups.push({ type: 'end' });

    log.setVerbosity('debug');

    try {
        const testAdapter = new Adapter();
        testAdapter.system = new BaseSystemAdapter('test', false, new FoundryV12Adapter());

        const mockActor = {
            name: 'Valeros',
            items: new foundry.utils.Collection([
                { id: 'item-1', name: 'Longsword', type: 'weapon', img: 'icons/sword.png' },
                { id: 'item-2', name: 'Potion', type: 'consumable', img: 'icons/potion.png' },
                { id: 'item-3', name: '', type: 'feat' } // Missing name triggers debug log in _extractBaseActions
            ]),
            getFlag: (mod, key) => {
                if (mod === MODULE_ID && key === 'hiddenItems') {
                    return { 'item-2': true }; // Hidden item triggers debug log in getActions
                }
                return undefined;
            }
        };

        const actions = await testAdapter.getActions(mockActor);
        assert.equal(actions.length, 2);

        // Verify that groups were started and ended for base extraction and hidden items processing
        const startLabels = groups.filter(g => g.type === 'start').map(g => g.label);
        assert.ok(startLabels.some(l => l.includes('Adapter._extractBaseActions') && l.includes('Valeros')),
            'Base action extraction should be wrapped in log.group when items are skipped');
        assert.ok(startLabels.some(l => l.includes('Adapter.getActions') && l.includes('hidden items')),
            'Hidden items filtering should be wrapped in log.group when items are hidden');

        const starts = groups.filter(g => g.type === 'start').length;
        const ends = groups.filter(g => g.type === 'end').length;
        assert.equal(starts, ends, 'Every log.group must have a corresponding log.groupEnd');
    } finally {
        console.group = origGroup;
        console.groupCollapsed = origGroupCollapsed;
        console.groupEnd = origGroupEnd;
        log.setVerbosity('warn');
    }
});

test('BaseSystemAdapter.modifyActions encapsulates depleted action filtering in log.group section', async () => {
    const groups = [];
    const origGroup = console.group;
    const origGroupCollapsed = console.groupCollapsed;
    const origGroupEnd = console.groupEnd;

    console.group = (...args) => groups.push({ type: 'start', label: args[0] });
    console.groupCollapsed = (...args) => groups.push({ type: 'start', label: args[0] });
    console.groupEnd = () => groups.push({ type: 'end' });

    log.setVerbosity('debug');

    try {
        const adapter = new BaseSystemAdapter('test-system', false, new FoundryV12Adapter());
        const actions = [
            { id: '1', name: 'Cantrip', uses: null, originalItem: { type: 'spell' } },
            { id: '2', name: 'Depleted', uses: { available: 0, max: 1 }, originalItem: { type: 'spell' } }
        ];

        await game.settings.set(MODULE_ID, 'showDepleted', false);
        const filtered = await adapter.modifyActions(actions, { name: 'Mage' });
        assert.equal(filtered.length, 1);

        const startLabels = groups.filter(g => g.type === 'start').map(g => g.label);
        assert.ok(startLabels.some(l => l.includes('BaseSystemAdapter.modifyActions') && l.includes('Filtering depleted actions')),
            'Depleted action filtering should be wrapped in log.group');

        const starts = groups.filter(g => g.type === 'start').length;
        const ends = groups.filter(g => g.type === 'end').length;
        assert.equal(starts, ends, 'Every log.group must have a matching log.groupEnd');
    } finally {
        console.group = origGroup;
        console.groupCollapsed = origGroupCollapsed;
        console.groupEnd = origGroupEnd;
        log.setVerbosity('warn');
    }
});

test('Dnd5eSystemAdapter.modifyActions encapsulates action processing in log.group section', async () => {
    const groups = [];
    const origGroup = console.group;
    const origGroupCollapsed = console.groupCollapsed;
    const origGroupEnd = console.groupEnd;

    console.group = (...args) => groups.push({ type: 'start', label: args[0] });
    console.groupCollapsed = (...args) => groups.push({ type: 'start', label: args[0] });
    console.groupEnd = () => groups.push({ type: 'end' });

    log.setVerbosity('debug');

    try {
        const adapter = new Dnd5eSystemAdapter(new FoundryV12Adapter());
        const mockItem = {
            id: 'item-spell-1',
            name: 'Shield',
            type: 'spell',
            img: 'icons/magic/defensive/shield.webp',
            system: {
                level: 1,
                method: 'prepared',
                prepared: false, // Unprepared spell triggers filtering log.debug in modifyActions
                activities: new foundry.utils.Collection([
                    {
                        id: 'act-cast',
                        name: 'Cast',
                        type: 'utility',
                        activation: { type: 'reaction' }
                    }
                ])
            }
        };
        const mockActor = {
            name: 'Wizard',
            isOwner: true,
            items: new foundry.utils.Collection([mockItem]),
            getFlag: () => false
        };

        const actions = [{
            id: 'item-spell-1',
            name: 'Shield',
            originalItem: mockItem
        }];

        await adapter.modifyActions(actions, mockActor);

        const startLabels = groups.filter(g => g.type === 'start').map(g => g.label);
        assert.ok(startLabels.some(l => l.includes('Dnd5eSystemAdapter.modifyActions') && l.includes('Wizard')),
            'D&D 5e action processing should be wrapped in log.group');

        const starts = groups.filter(g => g.type === 'start').length;
        const ends = groups.filter(g => g.type === 'end').length;
        assert.equal(starts, ends, 'Every log.group must have a matching log.groupEnd');
    } finally {
        console.group = origGroup;
        console.groupCollapsed = origGroupCollapsed;
        console.groupEnd = origGroupEnd;
        log.setVerbosity('warn');
    }
});

test('log.group lazily starts only when a log message executes, omitting empty groups', () => {
    const events = [];
    const origGroup = console.group;
    const origGroupCollapsed = console.groupCollapsed;
    const origGroupEnd = console.groupEnd;
    const origLog = console.log;

    console.group = (...args) => events.push({ type: 'group', label: args[0] });
    console.groupCollapsed = (...args) => events.push({ type: 'collapsed', label: args[0] });
    console.groupEnd = () => events.push({ type: 'groupEnd' });
    console.log = (...args) => events.push({ type: 'log', args });

    log.setVerbosity('debug');

    try {
        // Case 1: Empty group with no log statements produces zero console calls
        log.group('Empty group 1', 'debug');
        log.groupEnd();
        assert.equal(events.length, 0, 'No console calls should occur for an empty group');

        // Case 2: Group with log statement starts only when log.debug executes
        log.group('Active group', 'debug');
        assert.equal(events.length, 0, 'Group must remain pending before any log statement');
        log.debug('Message inside active group');
        assert.equal(events.length, 2, 'Group start and message log should both be recorded');
        assert.equal(events[0].type, 'collapsed');
        assert.ok(events[0].label.includes('Active group'));
        assert.equal(events[1].type, 'log');
        log.groupEnd();
        assert.equal(events.length, 3);
        assert.equal(events[2].type, 'groupEnd');

        // Case 3: Nested groups where inner group logs -> both outer and inner start in order
        events.length = 0;
        log.group('Parent group', 'debug');
        log.group('Child group', 'debug');
        assert.equal(events.length, 0, 'Neither parent nor child should start yet');
        log.debug('Message inside child');
        assert.equal(events.length, 3, 'Parent, child, and message should all be output');
        assert.ok(events[0].label.includes('Parent group'));
        assert.ok(events[1].label.includes('Child group'));
        assert.equal(events[2].type, 'log');
        log.groupEnd(); // ends Child
        assert.equal(events.length, 4);
        assert.equal(events[3].type, 'groupEnd');
        log.groupEnd(); // ends Parent
        assert.equal(events.length, 5);
        assert.equal(events[4].type, 'groupEnd');

        // Case 4: Nested groups where inner group has no logs, but outer group logs afterwards
        events.length = 0;
        log.group('Outer group', 'debug');
        log.group('Empty inner group', 'debug');
        log.groupEnd(); // Empty inner ends without logging -> should not trigger group or groupEnd
        assert.equal(events.length, 0, 'Empty inner group must not produce any console calls');
        log.debug('Message in outer');
        assert.equal(events.length, 2, 'Only outer group and message should be recorded');
        assert.ok(events[0].label.includes('Outer group'));
        assert.equal(events[1].type, 'log');
        log.groupEnd(); // ends Outer
        assert.equal(events.length, 3);
        assert.equal(events[2].type, 'groupEnd');
    } finally {
        console.group = origGroup;
        console.groupCollapsed = origGroupCollapsed;
        console.groupEnd = origGroupEnd;
        console.log = origLog;
        log.setVerbosity('warn');
    }
});

test('ActionDisplayApp._prepareContext and _matchesFilters log debug messages when filtering actions by right tabs', async () => {
    const groups = [];
    const debugLogs = [];
    const origGroup = console.group;
    const origGroupCollapsed = console.groupCollapsed;
    const origGroupEnd = console.groupEnd;
    const origLog = console.log;

    console.group = (...args) => groups.push({ type: 'group', args });
    console.groupCollapsed = (...args) => groups.push({ type: 'collapsed', args });
    console.groupEnd = () => groups.push({ type: 'end' });
    console.log = (...args) => debugLogs.push(args);

    log.setVerbosity('debug');

    try {
        const { ActionDisplayApp } = await import('../../src/ui/action-display-app.js');
        const { actionDisplay } = await import('../../src/action-display.js');

        const mockActions = [
            { id: '1', name: 'Fireball', left: ['spell', 'level_3'], right: [{ path: 'economy/action', root: 'economy', label: 'action' }], page: 1 },
            { id: '2', name: 'Healing Word', left: ['spell', 'level_1'], right: [{ path: 'economy/bonus', root: 'economy', label: 'bonus' }], page: 1 }
        ];

        actionDisplay.getActions = async () => mockActions;

        const app = new ActionDisplayApp({ actor: { id: 'test-actor', name: 'Mage' } });
        app.activePage = 1;
        app._saveTabState = () => {};

        // Filter by Bonus Action on the right side:
        app.rightTabs.activeParents.clear();
        app.rightTabs.activeParents.add('economy');
        app.rightTabs.activeSubTypes.clear();
        app.rightTabs.activeSubTypes.add('bonus');

        const context = await app._prepareContext({});
        assert.equal(context.items.length, 1);
        assert.equal(context.items[0].name, 'Healing Word');

        // Check that log.group was started
        const startGroups = groups.filter(g => g.type === 'collapsed');
        assert.ok(startGroups.some(g => g.args[0].includes('ActionDisplayApp._prepareContext') && g.args[0].includes('Mage')));

        // Check that Fireball was logged as skipped in debugLogs
        assert.ok(debugLogs.some(args =>
            args.some(arg => typeof arg === 'string' && arg.includes('Skipping action "Fireball"') && arg.includes('does not match active right economy tabs'))
        ), 'Fireball should be logged as skipped due to economy tabs mismatch');
    } finally {
        console.group = origGroup;
        console.groupCollapsed = origGroupCollapsed;
        console.groupEnd = origGroupEnd;
        console.log = origLog;
        log.setVerbosity('warn');
    }
});

test('showActivityDropdown logs debug messages when activities are filtered from the dropdown context menu', async () => {
    const groups = [];
    const debugLogs = [];
    const origGroup = console.group;
    const origGroupCollapsed = console.groupCollapsed;
    const origGroupEnd = console.groupEnd;
    const origLog = console.log;

    console.group = (...args) => groups.push({ type: 'group', args });
    console.groupCollapsed = (...args) => groups.push({ type: 'collapsed', args });
    console.groupEnd = () => groups.push({ type: 'end' });
    console.log = (...args) => debugLogs.push(args);

    log.setVerbosity('debug');

    try {
        const { showActivityDropdown } = await import('../../src/ui/app/dropdown-manager.js');

        const fullSubactions = [
            { id: 'act-1', name: 'Slash', right: [{ path: 'economy/action', root: 'economy', label: 'action' }] },
            { id: 'act-2', name: 'Pommel Strike', right: [{ path: 'economy/bonus', root: 'economy', label: 'bonus' }] },
            { id: 'act-3', name: 'Parry', right: [{ path: 'economy/reaction', root: 'economy', label: 'reaction' }] }
        ];

        const parentAction = {
            id: 'item-sword',
            name: 'Longsword',
            subactions: fullSubactions
        };

        const mockApp = {
            element: { ownerDocument: { body: document.body } },
            _hideItemSummaryTooltip: () => {}
        };
        const mockTarget = {
            dataset: { actionId: 'item-sword' },
            classList: { add: () => {}, remove: () => {} },
            getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 })
        };

        // Case 1: All subactions qualify -> no activities filtered group
        showActivityDropdown(mockApp, mockTarget, fullSubactions, { preventDefault() {}, stopPropagation() {} }, parentAction);
        assert.equal(groups.filter(g => g.args[0].includes('Activities filtered from dropdown context menu')).length, 0);

        // Case 2: Only 'Pommel Strike' qualifies (Slash and Parry filtered out)
        const qualifyingSubs = [fullSubactions[1]];
        showActivityDropdown(mockApp, mockTarget, qualifyingSubs, { preventDefault() {}, stopPropagation() {} }, parentAction);

        const filterGroups = groups.filter(g => g.type === 'collapsed' && g.args[0].includes('Activities filtered from dropdown context menu'));
        assert.equal(filterGroups.length, 1);
        assert.ok(filterGroups[0].args[0].includes('Longsword'));

        // Verify that Slash and Parry were logged as filtered from the dropdown
        assert.ok(debugLogs.some(args =>
            args.some(arg => typeof arg === 'string' && arg.includes('Activity "Slash"') && arg.includes('filtered from dropdown context menu'))
        ));
        assert.ok(debugLogs.some(args =>
            args.some(arg => typeof arg === 'string' && arg.includes('Activity "Parry"') && arg.includes('filtered from dropdown context menu'))
        ));
    } finally {
        console.group = origGroup;
        console.groupCollapsed = origGroupCollapsed;
        console.groupEnd = origGroupEnd;
        console.log = origLog;
        log.setVerbosity('warn');
    }
});



