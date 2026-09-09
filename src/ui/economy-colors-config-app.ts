import { MODULE_ID } from '../constants.js';
import { log } from '../lib/logger.js';
import { localize } from '../lib/utils.js';
import { adapter } from '../adapters/index.js';
import { actionDisplay } from '../action-display.js';
import { ECONOMY_COLOR_PRESETS } from './economy-presets.js';

/**
 * Modern ApplicationV2 configuration menu for Action Economy indicator colors.
 */
export class EconomyColorsConfigApp extends adapter.foundry.HandlebarsApplicationMixin(adapter.foundry.ApplicationV2) {
    /** @override */
    static DEFAULT_OPTIONS = {
        id: 'bad-economy-colors-config-app',
        classes: ['bad-economy-colors-config-window'],
        tag: 'div',
        window: {
            frame: true,
            title: 'BAD.economyColors.title',
            resizable: true
        },
        position: {
            width: 520,
            height: 'auto'
        },
        actions: {
            resetDefaults: EconomyColorsConfigApp.prototype._onResetDefaults,
            saveConfig: EconomyColorsConfigApp.prototype._onSaveConfig,
            closeConfig: EconomyColorsConfigApp.prototype._onCloseConfig
        }
    };

    /** @override */
    static get PARTS() {
        const path = game.modules?.get(MODULE_ID)?.path ?? `modules/${MODULE_ID}`;
        return {
            config: {
                template: `${path}/templates/economy-colors-config.html`,
                scrollable: ['.bad-economy-colors-list']
            }
        };
    }

    constructor(options = {}) {
        super(options);
        const stored = game.settings.get(MODULE_ID, 'economyColors') ?? {};
        this.colors = adapter.foundry.duplicate(stored);
        this.disabled = adapter.foundry.duplicate(this.colors.disabled ?? {});
        this.enabledTypes = adapter.foundry.duplicate(this.colors.enabled ?? {});
        delete this.colors.disabled;
        delete this.colors.enabled;
        this.enabled = Boolean(game.settings.get(MODULE_ID, 'enableEconomyIndicators'));
        this.selectedPreset = '';
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const systemTypes = adapter.getEconomyTypes() ?? [];
        const userColorsConfig = {
            ...this.colors,
            disabled: this.disabled,
            enabled: this.enabledTypes
        };
        
        const economyTypes = systemTypes.map(type => {
            const color = this.colors[type.id] ?? type.defaultColor;
            const enabled = adapter.isEconomyTypeEnabled(type, userColorsConfig);
            return {
                id: type.id,
                label: type.label,
                defaultColor: type.defaultColor,
                color,
                enabled
            };
        });

        const presets = Object.values(ECONOMY_COLOR_PRESETS).map(p => ({
            id: p.id,
            label: localize(p.label, p.id),
            selected: this.selectedPreset === p.id
        }));

        context.enabled = this.enabled;
        context.economyTypes = economyTypes;
        context.presets = presets;
        return context;
    }

    /** @override */
    _onRender(context, options) {
        super._onRender?.(context, options);
        this._attachInputListeners();
    }

    /**
     * Set the enabled/disabled state for a specific economy type.
     * @param {string} typeId
     * @param {boolean} isEnabled
     * @private
     */
    _setTypeEnabled(typeId, isEnabled) {
        if (!typeId) return;
        if (isEnabled) {
            delete this.disabled[typeId];
            this.enabledTypes[typeId] = true;
        } else {
            delete this.enabledTypes[typeId];
            this.disabled[typeId] = true;
        }
    }

    /**
     * Update color values, enable category, and synchronize row DOM elements.
     * @param {HTMLElement|null} row
     * @param {string} typeId
     * @param {string} value
     * @private
     */
    _syncRowColor(row, typeId, value) {
        this.colors[typeId] = value;
        this._setTypeEnabled(typeId, true);

        if (row) {
            row.classList.remove('bad-row-inactive');
            const toggle = row.querySelector('.bad-economy-type-toggle');
            if (toggle) toggle.checked = true;
            const textInput = row.querySelector('.bad-economy-color-input');
            if (textInput && textInput.value !== value) textInput.value = value;
            const colorPicker = row.querySelector('.bad-economy-color-picker');
            if (colorPicker && colorPicker.value !== value) colorPicker.value = value;
            const preview = row.querySelector('.bad-economy-preview');
            if (preview) preview.style.backgroundColor = value;
        }
    }

    /**
     * Attach input listeners to sync color pickers and text inputs in real time.
     * @private
     */
    _attachInputListeners() {
        if (!this.element || this._listenersAttached) return;
        this._listenersAttached = true;

        // Delegated change listener for toggles and presets
        this.element.addEventListener('change', (event) => {
            const enableToggle = event.target.closest('.bad-economy-enable-toggle');
            if (enableToggle) {
                this.enabled = Boolean(enableToggle.checked);
                return;
            }

            const presetSelect = event.target.closest('.bad-economy-preset-select');
            if (presetSelect) {
                this.applyPreset(presetSelect.value);
                return;
            }

            const typeToggle = event.target.closest('.bad-economy-type-toggle');
            if (typeToggle) {
                const typeId = typeToggle.dataset.typeId;
                if (!typeId) return;
                const isEnabled = Boolean(typeToggle.checked);
                this._setTypeEnabled(typeId, isEnabled);

                const row = this.element.querySelector(`.bad-economy-color-row[data-type-id="${typeId}"]`);
                if (row) {
                    row.classList.toggle('bad-row-inactive', !isEnabled);
                }
            }
        });

        // Delegated input listener for color pickers & text inputs (auto-enables category)
        this.element.addEventListener('input', (event) => {
            const picker = event.target.closest('.bad-economy-color-picker');
            if (picker) {
                const typeId = picker.dataset.typeId;
                const value = picker.value;
                if (typeId && value) {
                    const row = this.element.querySelector(`.bad-economy-color-row[data-type-id="${typeId}"]`);
                    this._syncRowColor(row, typeId, value);
                }
                return;
            }

            const input = event.target.closest('.bad-economy-color-input');
            if (input) {
                const typeId = input.dataset.typeId;
                const value = input.value?.trim();
                if (typeId && /^#[0-9A-Fa-f]{6}$/.test(value)) {
                    const row = this.element.querySelector(`.bad-economy-color-row[data-type-id="${typeId}"]`);
                    this._syncRowColor(row, typeId, value);
                }
            }
        });
    }

    /**
     * Handle master enable checkbox toggling.
     */
    async _onToggleEnabled(event, target) {
        this.enabled = target.checked;
    }

    /**
     * Handle individual category enable checkbox toggling.
     */
    async _onToggleTypeEnabled(event, target) {
        this._setTypeEnabled(target.dataset.typeId, Boolean(target.checked));
    }

    /**
     * Apply a color palette preset to current colors and re-render.
     * @param {string} presetId
     */
    applyPreset(presetId) {
        this.selectedPreset = presetId;
        const preset = ECONOMY_COLOR_PRESETS[presetId];
        if (preset?.colors) {
            const systemTypes = adapter.getEconomyTypes() ?? [];
            for (const type of systemTypes) {
                if (preset.colors[type.id]) {
                    this.colors[type.id] = preset.colors[type.id];
                }
            }
        }
        this.render();
    }

    /**
     * Reset all colors to default system values.
     */
    async _onResetDefaults(event, target) {
        event.preventDefault();
        this.colors = {};
        this.disabled = {};
        this.enabledTypes = {};
        this.selectedPreset = '';
        this.render();
    }

    /**
     * Save configuration and notify user.
     */
    async _onSaveConfig(event, target) {
        event.preventDefault();

        // Sync directly from DOM inputs if element exists
        if (this.element) {
            const enableToggle = this.element.querySelector('.bad-economy-enable-toggle');
            if (enableToggle) {
                this.enabled = Boolean(enableToggle.checked);
            }

            const typeToggles = this.element.querySelectorAll('.bad-economy-type-toggle');
            for (const toggle of typeToggles) {
                this._setTypeEnabled(toggle.dataset.typeId, Boolean(toggle.checked));
            }

            const colorInputs = this.element.querySelectorAll('.bad-economy-color-input');
            for (const input of colorInputs) {
                const typeId = input.dataset.typeId;
                const val = input.value?.trim();
                if (typeId && /^#[0-9A-Fa-f]{6}$/.test(val)) {
                    this.colors[typeId] = val;
                }
            }
        }

        const payload = {
            ...this.colors,
            disabled: this.disabled,
            enabled: this.enabledTypes
        };
        await game.settings.set(MODULE_ID, 'enableEconomyIndicators', Boolean(this.enabled));
        await game.settings.set(MODULE_ID, 'economyColors', payload);
        ui.notifications.info(localize('BAD.economyColors.saved'));
        if (actionDisplay.activeApp?.rendered) {
            actionDisplay.activeApp.render();
        }
        await this.close();
    }

    /**
     * Close the modal without saving changes.
     */
    async _onCloseConfig(event, target) {
        event.preventDefault();
        await this.close();
    }
}
