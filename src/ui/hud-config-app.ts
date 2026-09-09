import { MODULE_ID } from '../constants.js';
import { log } from '../lib/logger.js';
import { localize, deepFreeze } from '../lib/utils.js';
import { adapter } from '../adapters/index.js';
import { actionDisplay } from '../action-display.js';

export const DEFAULT_HUD_CONFIG = deepFreeze({
    hudOpacity: 0.88,
    hudScale: 1.0,
    fontSize: 14,
    hudAnchorSide: 'vertical',
    hudGridOffset: 0.5,
    hudGridOffsetHorizontal: 0.5
});

/**
 * Modern ApplicationV2 configuration menu for Action Display HUD appearance, sizing, and positioning.
 */
export class HUDConfigApp extends adapter.foundry.HandlebarsApplicationMixin(adapter.foundry.ApplicationV2) {
    config: Record<string, any>;

    /** @override */
    static DEFAULT_OPTIONS = {
        id: 'bad-hud-config-app',
        classes: ['bad-hud-config-window'],
        tag: 'div',
        window: {
            frame: true,
            title: 'BAD.hudConfig.title',
            resizable: true
        },
        position: {
            width: 540,
            height: 'auto'
        },
        actions: {
            resetDefaults: HUDConfigApp.prototype._onResetDefaults,
            saveConfig: HUDConfigApp.prototype._onSaveConfig,
            closeConfig: HUDConfigApp.prototype._onCloseConfig
        }
    };

    /** @override */
    static get PARTS() {
        const path = game.modules?.get(MODULE_ID)?.path ?? `modules/${MODULE_ID}`;
        return {
            config: {
                template: `${path}/templates/hud-config.html`,
                scrollable: ['.bad-hud-config-body']
            }
        };
    }

    constructor(options: Record<string, any> = {}) {
        super(options);
        this.config = {
            hudOpacity: Number(game.settings.get(MODULE_ID, 'hudOpacity') ?? DEFAULT_HUD_CONFIG.hudOpacity),
            hudScale: Number(game.settings.get(MODULE_ID, 'hudScale') ?? DEFAULT_HUD_CONFIG.hudScale),
            fontSize: Number(game.settings.get(MODULE_ID, 'fontSize') ?? DEFAULT_HUD_CONFIG.fontSize),
            hudAnchorSide: String(game.settings.get(MODULE_ID, 'hudAnchorSide') ?? DEFAULT_HUD_CONFIG.hudAnchorSide),
            hudGridOffset: Number(game.settings.get(MODULE_ID, 'hudGridOffset') ?? DEFAULT_HUD_CONFIG.hudGridOffset),
            hudGridOffsetHorizontal: Number(game.settings.get(MODULE_ID, 'hudGridOffsetHorizontal') ?? DEFAULT_HUD_CONFIG.hudGridOffsetHorizontal)
        };
    }

    /** @override */
    async _prepareContext(options: any) {
        const context = await super._prepareContext(options);
        context.config = { ...this.config };
        context.anchorSideChoices = [
            {
                id: 'vertical',
                label: localize('BAD.settings.hudAnchorSide.choices.vertical'),
                selected: this.config.hudAnchorSide === 'vertical'
            },
            {
                id: 'horizontal',
                label: localize('BAD.settings.hudAnchorSide.choices.horizontal'),
                selected: this.config.hudAnchorSide === 'horizontal'
            }
        ];
        return context;
    }

    /** @override */
    _onRender(context: any, options: any) {
        super._onRender?.(context, options);
        this._attachInputListeners();
    }

    /**
     * Attach live update listeners to range sliders to reflect numerical changes in real-time.
     * @private
     */
    _attachInputListeners() {
        if (!this.element) return;
        const sliders = this.element.querySelectorAll('input[type="range"]');
        for (const slider of sliders) {
            const output = this.element.querySelector(`.bad-range-value[data-for="${slider.name}"]`);
            slider.addEventListener('input',(event: any) => {
                if (output) {
                    const unit = slider.dataset?.unit ?? '';
                    output.textContent = `${event.target.value}${unit}`;
                }
            });
        }
    }

    /**
     * Reset configuration form to module default values.
     * @param {Event} [event]
     * @param {HTMLElement} [target]
     */
    _onResetDefaults(event: any, target: any) {
        event?.preventDefault?.();
        if (!this.element) return;

        for (const [key, val] of Object.entries(DEFAULT_HUD_CONFIG)) {
            const input = this.element.querySelector(`[name="${key}"]`);
            if (input) {
                input.value = val;
                const output = this.element.querySelector(`.bad-range-value[data-for="${key}"]`);
                if (output) {
                    const unit = input.dataset?.unit ?? '';
                    output.textContent = `${val}${unit}`;
                }
            }
        }
    }

    /**
     * Save HUD configuration settings and apply updates.
     * @param {Event} [event]
     * @param {HTMLElement} [target]
     */
    async _onSaveConfig(event: any, target: any) {
        event?.preventDefault?.();
        const form = this.element?.querySelector('form') ?? this.element;
        if (!form) return;

        const getVal = (name: any, parser: any, fallback: any) => {
            const el = form.querySelector(`[name="${name}"]`);
            if (!el) return fallback;
            const parsed = parser(el.value);
            return Number.isFinite(parsed) ? parsed : fallback;
        };

        const hudOpacity = getVal('hudOpacity', Number.parseFloat, DEFAULT_HUD_CONFIG.hudOpacity);
        const hudScale = getVal('hudScale', Number.parseFloat, DEFAULT_HUD_CONFIG.hudScale);
        const fontSize = getVal('fontSize',(val: any) => Number.parseInt(val, 10), DEFAULT_HUD_CONFIG.fontSize);
        const hudAnchorSide = form.querySelector?.('[name="hudAnchorSide"]')?.value ?? DEFAULT_HUD_CONFIG.hudAnchorSide;
        const hudGridOffset = getVal('hudGridOffset', Number.parseFloat, DEFAULT_HUD_CONFIG.hudGridOffset);
        const hudGridOffsetHorizontal = getVal('hudGridOffsetHorizontal', Number.parseFloat, DEFAULT_HUD_CONFIG.hudGridOffsetHorizontal);

        this.config = {
            hudOpacity,
            hudScale,
            fontSize,
            hudAnchorSide,
            hudGridOffset,
            hudGridOffsetHorizontal
        };

        await game.settings.set(MODULE_ID, 'hudOpacity', hudOpacity);
        await game.settings.set(MODULE_ID, 'hudScale', hudScale);
        await game.settings.set(MODULE_ID, 'fontSize', fontSize);
        await game.settings.set(MODULE_ID, 'hudAnchorSide', hudAnchorSide);
        await game.settings.set(MODULE_ID, 'hudGridOffset', hudGridOffset);
        await game.settings.set(MODULE_ID, 'hudGridOffsetHorizontal', hudGridOffsetHorizontal);

        document.documentElement?.style?.setProperty?.('--bad-hud-opacity', hudOpacity);
        document.documentElement?.style?.setProperty?.('--bad-hud-scale', hudScale);
        document.documentElement?.style?.setProperty?.('--bad-hud-font-size', `${fontSize}px`);

        if (actionDisplay.activeApp?.rendered) {
            actionDisplay.activeApp.setPosition?.();
            actionDisplay.activeApp.render?.();
        }

        ui.notifications.info(localize('BAD.hudConfig.saved', 'HUD configuration saved successfully.'));
        log.info('Saved HUD configuration settings');

        this.close();
    }

    /**
     * Close dialog without saving changes.
     * @param {Event} [event]
     * @param {HTMLElement} [target]
     */
    _onCloseConfig(event: any, target: any) {
        event?.preventDefault?.();
        this.close();
    }
}
