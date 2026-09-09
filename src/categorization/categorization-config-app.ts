import { MODULE_ID } from '../constants.js';
import { log } from '../lib/logger.js';
import { localize, format } from '../lib/utils.js';
import {
    normalizeCategorizationConfig,
    getDefaultCategories,
    validateExpression
} from './categorization-manager.js';
import { adapter } from '../adapters/index.js';
import { actionDisplay } from '../action-display.js';

/**
 * Modern ApplicationV2 configuration menu for HUD action categorization.
 */
export class CategorizationConfigApp extends adapter.foundry.HandlebarsApplicationMixin(adapter.foundry.ApplicationV2) {
    /** @override */
    static DEFAULT_OPTIONS = {
        id: 'bad-categorization-config-app',
        classes: ['bad-categorization-config-window'],
        tag: 'div',
        window: {
            frame: true,
            title: 'BAD.categorization.title',
            resizable: true
        },
        position: {
            width: 720,
            height: 'auto'
        },
        actions: {
            toggleEnabled: CategorizationConfigApp.prototype._onToggleEnabled,
            addCategory: CategorizationConfigApp.prototype._onAddCategory,
            addSubCategory: CategorizationConfigApp.prototype._onAddSubCategory,
            removeCategory: CategorizationConfigApp.prototype._onRemoveCategory,
            removeSubCategory: CategorizationConfigApp.prototype._onRemoveSubCategory,
            toggleFallthrough: CategorizationConfigApp.prototype._onToggleFallthrough,
            loadPresets: CategorizationConfigApp.prototype._onLoadPresets,
            saveConfig: CategorizationConfigApp.prototype._onSaveConfig,
            closeConfig: CategorizationConfigApp.prototype._onCloseConfig
        }
    };

    /** @override */
    static get PARTS() {
        const path = game.modules?.get(MODULE_ID)?.path ?? `modules/${MODULE_ID}`;
        return {
            config: {
                template: `${path}/templates/categorization-config.html`,
                scrollable: ['.bad-config-categories-list']
            }
        };
    }

    constructor(options = {}) {
        super(options);
        const stored = game.settings.get(MODULE_ID, 'categorizationConfig');
        this.config = normalizeCategorizationConfig(stored);
        this._dragState = null;
        this._focusTarget = null;
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.config = this.config;
        context.helpTooltip = this._getExpressionHelpTooltip();
        return context;
    }

    /**
     * Build the localized HTML tooltip explaining boolean expression categorization rules and variables.
     * Replaces stand-in variables in localized sentence strings with HTML tags and icons.
     * @returns {string} HTML string for the tooltip
     */
    _getExpressionHelpTooltip() {
        const format = (key, data, fallback = '') => {
            let str = localize(key, fallback);
            if (!str || str === key) {
                str = fallback;
            }
            return str.replace(/\{(\w+)\}/g, (match, p1) => data[p1] ?? match);
        };

        const trueCode = '<code>true</code>';
        const fallthroughLabel = '<strong>Fallthrough (<i class="fas fa-chevron-down"></i>)</strong>';
        const otherActionsLabel = `<strong>${localize('BAD.categorization.others', 'Other Actions')}</strong>`;

        const descEvaluation = format('BAD.categorization.expressionHelp.evaluation', { true: trueCode }, 'Actions are evaluated against each category from top to bottom and placed in the first matching rule (<code>true</code>).');
        const descFallthrough = format('BAD.categorization.expressionHelp.fallthrough', { fallthrough: fallthroughLabel }, '<strong>Fallthrough (<i class="fas fa-chevron-down"></i>)</strong>: When enabled on a category, matching actions appear in that category and continue evaluating into later categories as though they haven\'t been matched yet.');
        const descUnmatched = format('BAD.categorization.expressionHelp.unmatched', { otherActions: otherActionsLabel }, 'Unmatched actions appear in <strong>Other Actions</strong>.');

        const varTitle = localize('BAD.categorization.expressionHelp.variablesTitle', 'Available Variables in Boolean Expressions:');
        const itemDesc = format('BAD.categorization.expressionHelp.item', { example: "<code>item.type === 'weapon'</code>, <code>item.name</code>, <code>item.system</code>" }, "Foundry Item document (e.g. <code>item.type === 'weapon'</code>, <code>item.name</code>, <code>item.system</code>)");
        const actionDesc = format('BAD.categorization.expressionHelp.action', { example: '<code>action.left</code>, <code>action.right</code>, <code>action.uses.available</code>' }, 'HUD Action instance (e.g. <code>action.left</code>, <code>action.right</code>, <code>action.uses.available</code>)');
        const actorDesc = format('BAD.categorization.expressionHelp.actor', { example: "<code>actor.getFlag('bakana-action-display', 'favorites')?.[item.id]</code>" }, "Foundry Actor document (e.g. <code>actor.getFlag('bakana-action-display', 'favorites')?.[item.id]</code>)");
        const tokenDesc = format('BAD.categorization.expressionHelp.token', { example: '<code>token.name</code>' }, 'Foundry Token document (e.g. <code>token.name</code>)');
        const userDesc = format('BAD.categorization.expressionHelp.user', { example: '<code>user.isGM</code>, <code>user.name</code>' }, 'Current Foundry User document (e.g. <code>user.isGM</code>, <code>user.name</code>)');

        return `<div class="bad-expression-tooltip"><div class="bad-expression-tooltip-desc">${descEvaluation}<br/>${descFallthrough}<br/>${descUnmatched}</div><div class="bad-expression-tooltip-title">${varTitle}</div><ul class="bad-expression-tooltip-list"><li><strong>item</strong>: ${itemDesc}</li><li><strong>action</strong>: ${actionDesc}</li><li><strong>actor</strong>: ${actorDesc}</li><li><strong>token</strong>: ${tokenDesc}</li><li><strong>user</strong>: ${userDesc}</li></ul></div>`;
    }

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);
        this._attachDragListeners();
        this._attachInputListeners();
        this._restoreFocus();
    }

    /**
     * Restore focus and scroll newly added category or subcategory name inputs into view.
     */
    _restoreFocus() {
        if (!this._focusTarget || !this.element) return;
        const { type, id } = this._focusTarget;
        this._focusTarget = null;

        let input = null;
        if (type === 'category') {
            const card = this.element.querySelector(`.bad-config-cat-card[data-cat-id="${id}"]`);
            input = card?.querySelector('.bad-cat-name-input') ?? null;
        } else if (type === 'subcategory') {
            const row = this.element.querySelector(`.bad-config-sub-row[data-sub-id="${id}"]`);
            input = row?.querySelector('.bad-sub-name-input') ?? null;
        }

        if (input) {
            input.focus();
            input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    /**
     * Attach input change listeners to sync form inputs directly to this.config in real time.
     */
    _attachInputListeners() {
        if (!this.element) return;

        const inputs = this.element.querySelectorAll('input[type="text"]');
        inputs.forEach(input => {
            input.addEventListener('input', () => {
                this._syncFormData();
            });
        });
    }

    /**
     * Attach native HTML5 drag-and-drop listeners for reordering categories and subcategories.
     */
    _attachDragListeners() {
        if (!this.element) return;

        // Category drag handles & cards
        const catCards = this.element.querySelectorAll('.bad-config-cat-card');
        catCards.forEach(card => {
            const catIndex = Number(card.dataset.catIndex);
            const handle = card.querySelector('.bad-config-drag-handle[data-drag-type="category"]');

            if (handle) {
                handle.addEventListener('mousedown', () => {
                    card.setAttribute('draggable', 'true');
                });
            }

            card.addEventListener('dragstart', (e) => {
                this._syncFormData();
                this._dragState = { type: 'category', fromIndex: catIndex };
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', JSON.stringify(this._dragState));
                card.classList.add('dragging');
            });

            card.addEventListener('dragend', () => {
                card.setAttribute('draggable', 'false');
                card.classList.remove('dragging');
                this._clearDragHighlights();
                this._dragState = null;
            });

            card.addEventListener('dragover', (e) => {
                if (this._dragState?.type === 'category') {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    card.classList.add('drag-over');
                }
            });

            card.addEventListener('dragleave', () => {
                card.classList.remove('drag-over');
            });

            card.addEventListener('drop', (e) => {
                if (this._dragState?.type === 'category') {
                    e.preventDefault();
                    card.classList.remove('drag-over');
                    const toIndex = catIndex;
                    const fromIndex = this._dragState.fromIndex;
                    if (fromIndex !== toIndex && fromIndex >= 0 && toIndex >= 0) {
                        this._syncFormData();
                        const [moved] = this.config.categories.splice(fromIndex, 1);
                        this.config.categories.splice(toIndex, 0, moved);
                        this.render();
                    }
                }
            });
        });

        // Subcategory drag handles & rows
        const subRows = this.element.querySelectorAll('.bad-config-sub-row');
        subRows.forEach(row => {
            const catIndex = Number(row.dataset.catIndex);
            const subIndex = Number(row.dataset.subIndex);
            const handle = row.querySelector('.bad-config-drag-handle[data-drag-type="subcategory"]');

            if (handle) {
                handle.addEventListener('mousedown', () => {
                    row.setAttribute('draggable', 'true');
                });
            }

            row.addEventListener('dragstart', (e) => {
                e.stopPropagation();
                this._syncFormData();
                this._dragState = { type: 'subcategory', catIndex, fromIndex: subIndex };
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', JSON.stringify(this._dragState));
                row.classList.add('dragging');
            });

            row.addEventListener('dragend', (e) => {
                e.stopPropagation();
                row.setAttribute('draggable', 'false');
                row.classList.remove('dragging');
                this._clearDragHighlights();
                this._dragState = null;
            });

            row.addEventListener('dragover', (e) => {
                if (this._dragState?.type === 'subcategory' && this._dragState.catIndex === catIndex) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    row.classList.add('drag-over');
                }
            });

            row.addEventListener('dragleave', (e) => {
                e.stopPropagation();
                row.classList.remove('drag-over');
            });

            row.addEventListener('drop', (e) => {
                if (this._dragState?.type === 'subcategory' && this._dragState.catIndex === catIndex) {
                    e.preventDefault();
                    e.stopPropagation();
                    row.classList.remove('drag-over');
                    const toIndex = subIndex;
                    const fromIndex = this._dragState.fromIndex;
                    if (fromIndex !== toIndex && fromIndex >= 0 && toIndex >= 0) {
                        this._syncFormData();
                        const subs = this.config.categories[catIndex].subcategories;
                        const [moved] = subs.splice(fromIndex, 1);
                        subs.splice(toIndex, 0, moved);
                        this.render();
                    }
                }
            });
        });
    }

    /**
     * Clear drag-and-drop CSS hover classes and reset draggable attributes on category elements.
     */
    _clearDragHighlights() {
        if (!this.element) return;
        this.element.querySelectorAll('.drag-over, .dragging').forEach(el => {
            el.classList.remove('drag-over', 'dragging');
            el.setAttribute('draggable', 'false');
        });
    }

    /**
     * Read current form input values into this.config data model.
     */
    _syncFormData() {
        if (!this.element) return;

        const enabledCheckbox = this.element.querySelector('input[name="categorizationEnabled"]');
        if (enabledCheckbox) {
            this.config.enabled = enabledCheckbox.checked;
        }

        const catElements = this.element.querySelectorAll('.bad-config-cat-row');
        catElements.forEach(catEl => {
            const catIndex = Number(catEl.dataset.catIndex);
            if (!Number.isFinite(catIndex) || !this.config.categories[catIndex]) return;

            const nameInput = catEl.querySelector('.bad-cat-name-input');
            const exprInput = catEl.querySelector('.bad-cat-expr-input');
            if (nameInput) this.config.categories[catIndex].name = nameInput.value;
            if (exprInput) this.config.categories[catIndex].expression = exprInput.value;

            const subElements = catEl.parentElement?.querySelectorAll('.bad-config-sub-row') ?? [];
            subElements.forEach(subEl => {
                const subIndex = Number(subEl.dataset.subIndex);
                if (!Number.isFinite(subIndex) || !this.config.categories[catIndex].subcategories?.[subIndex]) return;

                const subNameInput = subEl.querySelector('.bad-sub-name-input');
                const subExprInput = subEl.querySelector('.bad-sub-expr-input');
                if (subNameInput) this.config.categories[catIndex].subcategories[subIndex].name = subNameInput.value;
                if (subExprInput) this.config.categories[catIndex].subcategories[subIndex].expression = subExprInput.value;
            });
        });
    }

    /* -------------------------------------------- */
    /*  Action Handlers                             */
    /* -------------------------------------------- */

    /**
     * Handle toggle checkbox for enabling/disabling categorization.
     * @param {Event} event
     * @param {HTMLInputElement} target
     */
    _onToggleEnabled(event, target) {
        this._syncFormData();
        this.config.enabled = target.checked;
    }

    /**
     * Add a new empty category section to the configuration.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    _onAddCategory(event, target) {
        event.preventDefault();
        this._syncFormData();
        const newCatId = `cat_${Date.now()}_${this.config.categories.length}`;
        this.config.categories.push({
            id: newCatId,
            name: '',
            expression: '',
            fallthrough: false,
            subcategories: []
        });
        this._focusTarget = { type: 'category', id: newCatId };
        this.render();
    }

    /**
     * Toggle fallthrough state for a category.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    _onToggleFallthrough(event, target) {
        event.preventDefault();
        this._syncFormData();
        const catIndex = Number(target.dataset.catIndex);
        if (!Number.isFinite(catIndex) || !this.config.categories[catIndex]) return;

        this.config.categories[catIndex].fallthrough = !this.config.categories[catIndex].fallthrough;
        this.render();
    }

    /**
     * Add a new empty subcategory to a specific category section.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    _onAddSubCategory(event, target) {
        event.preventDefault();
        this._syncFormData();
        const catIndex = Number(target.dataset.catIndex);
        if (!Number.isFinite(catIndex) || !this.config.categories[catIndex]) return;

        const subs = this.config.categories[catIndex].subcategories;
        const newSubId = `sub_${Date.now()}_${subs.length}`;
        subs.push({
            id: newSubId,
            name: '',
            expression: ''
        });
        this._focusTarget = { type: 'subcategory', id: newSubId };
        this.render();
    }

    /**
     * Remove a category section by index.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    _onRemoveCategory(event, target) {
        event.preventDefault();
        this._syncFormData();
        const catIndex = Number(target.dataset.catIndex);
        if (!Number.isFinite(catIndex) || !this.config.categories[catIndex]) return;

        this.config.categories.splice(catIndex, 1);
        this.render();
    }

    /**
     * Remove a subcategory row by category and subcategory index.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    _onRemoveSubCategory(event, target) {
        event.preventDefault();
        this._syncFormData();
        const catIndex = Number(target.dataset.catIndex);
        const subIndex = Number(target.dataset.subIndex);
        if (!Number.isFinite(catIndex) || !Number.isFinite(subIndex) || !this.config.categories[catIndex]?.subcategories?.[subIndex]) return;

        this.config.categories[catIndex].subcategories.splice(subIndex, 1);
        this.render();
    }

    /**
     * Reset categories to the system-specific default preset categories.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    _onLoadPresets(event, target) {
        event.preventDefault();
        const rawDefaults = getDefaultCategories(adapter);
        this.config.categories = normalizeCategorizationConfig({ categories: rawDefaults }).categories;
        this.render();
    }

    /**
     * Validate and save the current categorization configuration to module settings.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    async _onSaveConfig(event, target) {
        event.preventDefault();
        this._syncFormData();

        // Validate category & subcategory expressions (empty names are allowed and render as dividing bars)
        for (const cat of this.config.categories) {
            if (cat.expression) {
                const check = validateExpression(cat.expression);
                if (!check.valid) {
                    ui.notifications.warn(
                        format('BAD.categorization.invalidExpressionWarning', { expr: cat.expression })
                    );
                    return;
                }
            }

            for (const sub of (cat.subcategories ?? [])) {
                if (sub.expression) {
                    const check = validateExpression(sub.expression);
                    if (!check.valid) {
                        ui.notifications.warn(
                            format('BAD.categorization.invalidExpressionWarning', { expr: sub.expression })
                        );
                        return;
                    }
                }
            }
        }

        const normalized = normalizeCategorizationConfig(this.config);
        await game.settings.set(MODULE_ID, 'categorizationConfig', normalized);
        log.info("Categorization configuration saved successfully");

        ui.notifications.info(localize('BAD.categorization.saved'));

        if (actionDisplay.activeApp?.rendered) {
            actionDisplay.activeApp.render();
        }

        this.close();
    }

    /**
     * Close the configuration dialog without saving changes.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    _onCloseConfig(event, target) {
        event.preventDefault();
        this.close();
    }
}
