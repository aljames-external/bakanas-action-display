import test from 'node:test';
import assert from 'node:assert/strict';
import '../setup.js';
import { CategorizationConfigApp } from '../../src/categorization/categorization-config-app.js';
import { MODULE_ID } from '../../src/constants.js';
import { adapter } from '../../src/adapters/index.js';
import { Dnd5eSystemAdapter } from '../../src/adapters/system/dnd5e/index.js';

test('CategorizationConfigApp initializes with stored settings', async () => {
    game.settings.set(MODULE_ID, 'categorizationConfig', {
        enabled: true,
        categories: [{ id: 'c1', name: 'Weapons', expression: 'item.type === "weapon"', subcategories: [] }]
    });

    const app = new CategorizationConfigApp();
    assert.equal(app.config.enabled, true);
    assert.equal(app.config.categories.length, 1);
    assert.equal(app.config.categories[0].name, 'Weapons');

    const context = await app._prepareContext({});
    assert.equal(context.config.enabled, true);
    assert.equal(context.config.categories.length, 1);
    assert.ok(context.helpTooltip.includes('bad-expression-tooltip'));
    assert.ok(context.helpTooltip.includes('<code>true</code>'));
    assert.ok(context.helpTooltip.includes('fas fa-chevron-down'));
    assert.ok(context.helpTooltip.includes('item.type === \'weapon\''));
});

test('CategorizationConfigApp action handlers mutate configuration state', async () => {
    game.settings.set(MODULE_ID, 'categorizationConfig', { enabled: false, categories: [] });
    const app = new CategorizationConfigApp();
    app.render = () => {};

    // 1. Toggle Enabled
    app._onToggleEnabled({}, { checked: true });
    assert.equal(app.config.enabled, true);

    // 2. Add Category
    app._onAddCategory({ preventDefault: () => {} }, {});
    assert.equal(app.config.categories.length, 1);
    assert.equal(app.config.categories[0].fallthrough, false);
    app.config.categories[0].name = 'Spells';
    app.config.categories[0].expression = 'item.type === "spell"';

    // 3. Toggle Fallthrough
    app._onToggleFallthrough({ preventDefault: () => {} }, { dataset: { catIndex: '0' } });
    assert.equal(app.config.categories[0].fallthrough, true);
    app._onToggleFallthrough({ preventDefault: () => {} }, { dataset: { catIndex: '0' } });
    assert.equal(app.config.categories[0].fallthrough, false);

    // 4. Add Subcategory
    app._onAddSubCategory({ preventDefault: () => {} }, { dataset: { catIndex: '0' } });
    assert.equal(app.config.categories[0].subcategories.length, 1);
    app.config.categories[0].subcategories[0].name = 'Cantrips';
    app.config.categories[0].expression = 'item.system.level === 0';

    // 5. Load Presets
    app._onLoadPresets({ preventDefault: () => {} }, {});
    assert.equal(app.config.categories.length, 4);
    assert.equal(app.config.categories[0].name, 'Favorites');

    // 5. Remove Subcategory
    if (app.config.categories[0].subcategories.length > 0) {
        app._onRemoveSubCategory({ preventDefault: () => {} }, { dataset: { catIndex: '0', subIndex: '0' } });
    }

    // 6. Remove Category
    app._onRemoveCategory({ preventDefault: () => {} }, { dataset: { catIndex: '0' } });
    assert.equal(app.config.categories.length, 3);
});

test('CategorizationConfigApp _onSaveConfig validates expressions, allows empty category names (bars), and persists to settings', async () => {
    const app = new CategorizationConfigApp();
    let closed = false;
    app.close = () => { closed = true; };

    let warned = false;
    ui.notifications.warn = () => { warned = true; };

    // Test 1: Category with empty name is allowed (creates dividing bar)
    app.config.categories = [{ id: 'c1', name: '', expression: 'item.type === "weapon"', subcategories: [] }];
    await app._onSaveConfig({ preventDefault: () => {} }, {});
    assert.equal(warned, false);
    assert.equal(closed, true);

    // Test 2: Category with syntax error expression is rejected
    closed = false;
    warned = false;
    app.config.categories = [{ id: 'c1', name: 'Weapons', expression: 'item.type === +++', subcategories: [] }];
    await app._onSaveConfig({ preventDefault: () => {} }, {});
    assert.equal(warned, true);
    assert.equal(closed, false);

    // Test 3: Categories named "Other Actions" and duplicate names are allowed and save successfully
    warned = false;
    app.config.categories = [
        { id: 'c1', name: 'Other Actions', expression: 'item.type === "weapon"', subcategories: [] },
        { id: 'c2', name: 'Other Actions', expression: 'item.type === "spell"', subcategories: [] }
    ];
    await app._onSaveConfig({ preventDefault: () => {} }, {});
    assert.equal(warned, false);
    assert.equal(closed, true);

    const saved = game.settings.get(MODULE_ID, 'categorizationConfig');
    assert.equal(saved.categories.length, 2);
    assert.equal(saved.categories[0].name, 'Other Actions');
    assert.equal(saved.categories[1].name, 'Other Actions');
});

test('CategorizationConfigApp PARTS registers scrollable categories list', () => {
    const parts = CategorizationConfigApp.PARTS;
    assert.ok(parts.config);
    assert.deepEqual(parts.config.scrollable, ['.bad-config-categories-list']);
});

test('CategorizationConfigApp _onAddCategory and _onAddSubCategory set _focusTarget and _restoreFocus focuses input', () => {
    game.settings.set(MODULE_ID, 'categorizationConfig', { enabled: false, categories: [] });
    const app = new CategorizationConfigApp();
    app.render = () => {};

    // 1. Add Category
    app._onAddCategory({ preventDefault: () => {} }, {});
    assert.equal(app._focusTarget?.type, 'category');
    const newCatId = app._focusTarget.id;
    assert.equal(typeof newCatId, 'string');

    // Mock DOM elements for _restoreFocus
    let focused = false;
    let scrolled = false;
    const mockInput = {
        focus: () => { focused = true; },
        scrollIntoView: () => { scrolled = true; }
    };
    const mockCard = {
        querySelector: (sel) => sel === '.bad-cat-name-input' ? mockInput : null
    };
    app.element = {
        querySelector: (sel) => sel === `.bad-config-cat-card[data-cat-id="${newCatId}"]` ? mockCard : null,
        querySelectorAll: () => []
    };

    app._restoreFocus();
    assert.equal(focused, true);
    assert.equal(scrolled, true);
    assert.equal(app._focusTarget, null);

    // 2. Add Subcategory
    app._onAddSubCategory({ preventDefault: () => {} }, { dataset: { catIndex: '0' } });
    assert.equal(app._focusTarget?.type, 'subcategory');
    const newSubId = app._focusTarget.id;
    assert.equal(typeof newSubId, 'string');

    focused = false;
    scrolled = false;
    const mockSubInput = {
        focus: () => { focused = true; },
        scrollIntoView: () => { scrolled = true; }
    };
    const mockRow = {
        querySelector: (sel) => sel === '.bad-sub-name-input' ? mockSubInput : null
    };
    app.element = {
        querySelector: (sel) => sel === `.bad-config-sub-row[data-sub-id="${newSubId}"]` ? mockRow : null,
        querySelectorAll: () => []
    };

    app._restoreFocus();
    assert.equal(focused, true);
    assert.equal(scrolled, true);
    assert.equal(app._focusTarget, null);
});

test('CategorizationConfigApp _getExpressionHelpTooltip replaces stand-in variables in localized sentence strings', () => {
    const app = new CategorizationConfigApp();
    const origLocalize = game.i18n.localize;
    try {
        game.i18n.localize = (key) => {
            const map = {
                'BAD.categorization.expressionHelp.evaluation': 'Évalue de haut en bas ({true}).',
                'BAD.categorization.expressionHelp.fallthrough': '{fallthrough}: passe au suivant.',
                'BAD.categorization.expressionHelp.unmatched': 'Non assortis dans {otherActions}.',
                'BAD.categorization.expressionHelp.variablesTitle': 'Variables disponibles:',
                'BAD.categorization.expressionHelp.item': 'Doc Objet ({example})',
                'BAD.categorization.expressionHelp.action': 'Instance Action ({example})',
                'BAD.categorization.expressionHelp.actor': 'Doc Acteur ({example})',
                'BAD.categorization.expressionHelp.token': 'Doc Jeton ({example})',
                'BAD.categorization.expressionHelp.user': 'Doc Utilisateur ({example})',
                'BAD.categorization.others': 'Autres Actions'
            };
            return map[key] ?? key;
        };

        const html = app._getExpressionHelpTooltip();
        assert.ok(html.includes('Évalue de haut en bas (<code>true</code>).'));
        assert.ok(html.includes('<strong>Fallthrough (<i class="fas fa-chevron-down"></i>)</strong>: passe au suivant.'));
        assert.ok(html.includes('Non assortis dans <strong>Autres Actions</strong>.'));
        assert.ok(html.includes('Variables disponibles:'));
        assert.ok(html.includes('Doc Objet (<code>item.type === \'weapon\'</code>, <code>item.name</code>, <code>item.system</code>)'));
    } finally {
        game.i18n.localize = origLocalize;
    }
});

test('CategorizationConfigApp _onLoadPresets loads specialized D&D5e presets when D&D5e system adapter is active', () => {
    const origSystem = adapter.system;
    try {
        adapter.system = new Dnd5eSystemAdapter(adapter.foundry);
        const app = new CategorizationConfigApp();
        app.render = () => {};

        app._onLoadPresets({ preventDefault: () => {} }, {});

        assert.equal(app.config.categories.length, 7);
        assert.equal(app.config.categories[0].name, 'Favorites');
        assert.equal(app.config.categories[1].name, 'Weapons');
        assert.equal(app.config.categories[2].name, 'Spells');
        assert.equal(app.config.categories[2].subcategories.length, 3);
        assert.equal(app.config.categories[3].name, 'Features');
        assert.equal(app.config.categories[4].name, 'Abilities');
        assert.equal(app.config.categories[5].name, 'Skills');
        assert.equal(app.config.categories[5].subcategories.length, 6);
        assert.equal(app.config.categories[6].name, 'Tools');
        assert.equal(app.config.categories[6].subcategories.length, 6);
    } finally {
        adapter.system = origSystem;
    }
});


