import { MODULE_ID } from '../constants.js';

/**
 * Interactive ApplicationV2 dialog for configuring HUD placement preference order using drag-and-drop.
 */
export class PositionPreferenceConfigApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'bad-position-preference-config',
        tag: 'form',
        window: {
            title: 'BAD.settings.hudPositionPreference.name',
            icon: 'fas fa-sort-amount-down',
            resizable: false
        },
        position: {
            width: 380,
            height: 'auto'
        },
        actions: {
            moveUp: PositionPreferenceConfigApp._onMoveUp,
            moveDown: PositionPreferenceConfigApp._onMoveDown
        },
        form: {
            handler: PositionPreferenceConfigApp._onSubmitForm,
            closeOnSubmit: true
        }
    };

    static PARTS = {
        form: {
            template: 'modules/bakana-action-display/templates/position-preference-config.html'
        }
    };

    constructor(options = {}) {
        super(options);
        const currentPref = game.settings.get(MODULE_ID, 'hudPositionPreference');
        this.directions = Array.isArray(currentPref) && currentPref.length === 4
            ? [...currentPref]
            : ['top', 'bottom', 'left', 'right'];
    }

    async _prepareContext(_options) {
        const labels = {
            top: game.i18n.localize('BAD.common.top') || 'Top',
            bottom: game.i18n.localize('BAD.common.bottom') || 'Bottom',
            left: game.i18n.localize('BAD.common.left') || 'Left',
            right: game.i18n.localize('BAD.common.right') || 'Right'
        };

        const directions = this.directions.map((id, index) => ({
            id,
            rank: index + 1,
            label: labels[id] || id.charAt(0).toUpperCase() + id.slice(1)
        }));

        return { directions };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const list = this.element.querySelector('#bad-pref-list');
        if (!list) return;

        let draggedItem = null;

        list.querySelectorAll('.bad-pref-item').forEach(item => {
            item.addEventListener('dragstart', (e) => {
                draggedItem = item;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            item.addEventListener('dragend', () => {
                draggedItem = null;
                item.classList.remove('dragging');
                this._updateListOrderFromDOM();
                this.render();
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (!draggedItem || draggedItem === item) return;

                const rect = item.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (e.clientY < midY) {
                    list.insertBefore(draggedItem, item);
                } else {
                    list.insertBefore(draggedItem, item.nextSibling);
                }
            });
        });
    }

    static _onMoveUp(event, target) {
        const item = target.closest('.bad-pref-item');
        const prev = item?.previousElementSibling;
        if (item && prev) {
            item.parentNode.insertBefore(item, prev);
            this._updateListOrderFromDOM();
            this.render();
        }
    }

    static _onMoveDown(event, target) {
        const item = target.closest('.bad-pref-item');
        const next = item?.nextElementSibling;
        if (item && next) {
            item.parentNode.insertBefore(next, item);
            this._updateListOrderFromDOM();
            this.render();
        }
    }

    _updateListOrderFromDOM() {
        const items = this.element.querySelectorAll('.bad-pref-item');
        if (items.length > 0) {
            this.directions = Array.from(items).map(el => el.dataset.id);
        }
    }

    static async _onSubmitForm(event, form, formData) {
        const items = this.element.querySelectorAll('.bad-pref-item');
        const newOrder = Array.from(items).map(el => el.dataset.id);
        await game.settings.set(MODULE_ID, 'hudPositionPreference', newOrder);
    }
}
