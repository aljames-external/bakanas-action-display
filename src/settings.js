import { MODULE_ID } from "./constants.js";

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

    // Register Filter Out of Resources Setting
    game.settings.register(MODULE_ID, 'filterNoResources', {
        name: game.i18n.localize('BAD.settings.filterNoResources.name'),
        hint: game.i18n.localize('BAD.settings.filterNoResources.hint'),
        scope: 'client',
        config: true,
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

    // Apply the initial opacity value to the document root
    const initialOpacity = game.settings.get(MODULE_ID, 'hudOpacity');
    document.documentElement.style.setProperty('--bad-hud-opacity', initialOpacity);
});
