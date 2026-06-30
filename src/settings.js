import { MODULE_ID } from "./constants.js";
import { log } from "./lib/logger.js";

Hooks.once('init', () => {
    // Register Log Verbosity Setting
    game.settings.register(MODULE_ID, 'logVerbosity', {
        name: game.i18n.localize('BAD.settings.logVerbosity.name'),
        hint: game.i18n.localize('BAD.settings.logVerbosity.hint'),
        scope: 'client',
        config: true,
        type: String,
        default: 'warn',
        choices: {
            'error': game.i18n.localize('BAD.settings.logVerbosity.choices.error'),
            'warn': game.i18n.localize('BAD.settings.logVerbosity.choices.warn'),
            'info': game.i18n.localize('BAD.settings.logVerbosity.choices.info'),
            'debug': game.i18n.localize('BAD.settings.logVerbosity.choices.debug')
        },
        onChange: value => {
            log.setVerbosity(value);
        }
    });

    // Register Persist Detached HUD Setting
    game.settings.register(MODULE_ID, 'persistDetached', {
        name: game.i18n.localize('BAD.settings.persistDetached.name'),
        hint: game.i18n.localize('BAD.settings.persistDetached.hint'),
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
    });

    // Register Filter Out of Resources Setting (hidden from config menu, managed via HUD footer)
    game.settings.register(MODULE_ID, 'filterNoResources', {
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    // Register HUD Opacity Setting (Slider)
    game.settings.register(MODULE_ID, 'hudOpacity', {
        name: game.i18n.localize('BAD.settings.hudOpacity.name'),
        hint: game.i18n.localize('BAD.settings.hudOpacity.hint'),
        scope: 'client',
        config: true,
        type: Number,
        range: {
            min: 0.1,
            max: 1.0,
            step: 0.05
        },
        default: 0.88,
        // Reactively update the CSS variable instantly when changed
        onChange: value => {
            document.documentElement.style.setProperty('--bad-hud-opacity', value);
        }
    });

    // Register HUD Scale Setting (Slider)
    game.settings.register(MODULE_ID, 'hudScale', {
        name: game.i18n.localize('BAD.settings.hudScale.name'),
        hint: game.i18n.localize('BAD.settings.hudScale.hint'),
        scope: 'client',
        config: true,
        type: Number,
        range: {
            min: 0.5,
            max: 1.5,
            step: 0.05
        },
        default: 1.0,
        // Reactively update the CSS variable instantly when changed
        onChange: value => {
            document.documentElement.style.setProperty('--bad-hud-scale', value);
        }
    });

    // Register HUD Font Size Setting (Slider)
    game.settings.register(MODULE_ID, 'fontSize', {
        name: game.i18n.localize('BAD.settings.fontSize.name'),
        hint: game.i18n.localize('BAD.settings.fontSize.hint'),
        scope: 'client',
        config: true,
        type: Number,
        range: {
            min: 10,
            max: 24,
            step: 1
        },
        default: 14,
        // Reactively update the CSS variable instantly when changed
        onChange: value => {
            document.documentElement.style.setProperty('--bad-hud-font-size', `${value}px`);
        }
    });

    // Register HUD Position Mode (attached/detached)
    game.settings.register(MODULE_ID, 'hudPositionMode', {
        scope: 'client',
        config: false,
        type: String,
        default: 'attached'
    });

    // Register HUD Detached Position (coordinates)
    game.settings.register(MODULE_ID, 'hudDetachedPosition', {
        scope: 'client',
        config: false,
        type: Object,
        default: null
    });

    // Apply the initial opacity and scale values to the document root
    const initialOpacity = game.settings.get(MODULE_ID, 'hudOpacity');
    document.documentElement.style.setProperty('--bad-hud-opacity', initialOpacity);

    const initialScale = game.settings.get(MODULE_ID, 'hudScale');
    document.documentElement.style.setProperty('--bad-hud-scale', initialScale);

    const initialFontSize = game.settings.get(MODULE_ID, 'fontSize');
    document.documentElement.style.setProperty('--bad-hud-font-size', `${initialFontSize}px`);
});
