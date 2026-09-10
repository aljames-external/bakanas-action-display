import { MODULE_ID } from "./constants.js";
import { log } from "./lib/logger.js";
import { localize, deepFreeze } from "./lib/utils.js";
import { actionDisplay } from "./action-display.js";
import { CategorizationConfigApp } from "./categorization/categorization-config-app.js";
import { EconomyColorsConfigApp } from "./ui/economy-colors-config-app.js";
import { HUDConfigApp } from "./ui/hud-config-app.js";
import { ModuleIntegrationsConfigApp } from "./ui/module-integrations-config-app.js";
import { Dnd5eAutoBanConfigApp, DEFAULT_DND5E_AUTOBAN_CONFIG } from "./ui/dnd5e-autoban-config-app.js";
import { hasActiveModuleAdapters } from "./adapters/module/index.js";

Hooks.once('init', () => {
    if (!game?.settings) return;

    // ==========================================
    // World Scope Settings & Menus
    // ==========================================

    // Register Categorization Configuration Menu Button
    game.settings.registerMenu(MODULE_ID, 'categorizationMenu', {
        name: localize('BAD.settings.categorizationMenu.name'),
        label: localize('BAD.settings.categorizationMenu.label'),
        hint: localize('BAD.settings.categorizationMenu.hint'),
        icon: 'fas fa-layer-group',
        type: CategorizationConfigApp as any,
        restricted: true
    } as any);

    // Register Categorization Configuration Storage
    game.settings.register(MODULE_ID, 'categorizationConfig', {
        scope: 'world',
        config: false,
        type: Object,
        default: {
            enabled: false,
            categories: []
        },
        onChange: () => {
            if (actionDisplay.activeApp?.rendered) {
                actionDisplay.activeApp.render();
            }
        }
    });

    // Register Module Integration Configuration Storage (Midi-QOL filter automation-only)
    game.settings.register(MODULE_ID, 'midiQolFilterAutomationOnly', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: () => {
            if (actionDisplay.activeApp?.rendered) {
                actionDisplay.activeApp.render();
            }
        }
    });

    // Register D&D 5e Auto-Ban Spell Components Configuration Menu (D&D 5e system only)
    if (game.system?.id === 'dnd5e') {
        game.settings.registerMenu(MODULE_ID, 'dnd5eAutoBanMenu', {
            name: localize('BAD.dnd5eAutoBan.menuName'),
            label: localize('BAD.dnd5eAutoBan.menuLabel'),
            hint: localize('BAD.dnd5eAutoBan.menuHint'),
            icon: 'fas fa-magic',
            type: Dnd5eAutoBanConfigApp as any,
            restricted: true
        } as any);

        game.settings.register(MODULE_ID, 'dnd5eAutoBanConditions', {
            scope: 'world',
            config: false,
            type: Object,
            default: DEFAULT_DND5E_AUTOBAN_CONFIG,
            onChange: () => {
                if (actionDisplay.activeApp?.rendered && actionDisplay.activeApp.actor) {
                    actionDisplay.activeApp.render();
                }
            }
        });
    }

    // Register Module Integration Configuration Menu Button (only visible if at least one adapter module is loaded)
    if (hasActiveModuleAdapters()) {
        game.settings.registerMenu(MODULE_ID, 'moduleIntegrationsMenu', {
            name: localize('BAD.moduleIntegrations.title'),
            label: localize('BAD.settings.moduleIntegrationsMenu.label'),
            hint: localize('BAD.settings.moduleIntegrationsMenu.hint'),
            icon: 'fas fa-puzzle-piece',
            type: ModuleIntegrationsConfigApp as any,
            restricted: true
        } as any);
    }

    // Register Center on Token Button Setting (World Scope, default disabled)
    game.settings.register(MODULE_ID, 'enableCenterOnToken', {
        name: localize('BAD.settings.enableCenterOnToken.name'),
        hint: localize('BAD.settings.enableCenterOnToken.hint'),
        scope: 'world',
        config: true,
        type: Boolean,
        default: false,
        onChange: () => {
            if (actionDisplay.activeApp?.rendered) {
                actionDisplay.activeApp.render();
            }
        }
    });

    // Register Item Summary Tooltip Button Setting (World Scope, default enabled)
    game.settings.register(MODULE_ID, 'enableItemSummaryButton', {
        name: localize('BAD.settings.enableItemSummaryButton.name'),
        hint: localize('BAD.settings.enableItemSummaryButton.hint'),
        scope: 'world',
        config: true,
        type: Boolean,
        default: true,
        onChange: () => {
            if (actionDisplay.activeApp?.rendered) {
                actionDisplay.activeApp.render();
            }
        }
    });

    // Register Enable Toggle Hotkey Setting (World Scope, default disabled)
    game.settings.register(MODULE_ID, 'enableToggleHotkey', {
        name: localize('BAD.settings.enableToggleHotkey.name'),
        hint: localize('BAD.settings.enableToggleHotkey.hint'),
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });

    // Register Enable Combat Action Buttons Setting (World Scope, default disabled)
    game.settings.register(MODULE_ID, 'enableCombatButtons', {
        name: localize('BAD.settings.enableCombatButtons.name'),
        hint: localize('BAD.settings.enableCombatButtons.hint'),
        scope: 'world',
        config: true,
        type: Boolean,
        default: false,
        onChange: () => {
            if (actionDisplay.activeApp?.rendered) {
                actionDisplay.activeApp.render();
            }
        }
    });

    // Register Combat Auto-Track Button Setting (World Scope, default disabled)
    game.settings.register(MODULE_ID, 'enableCombatAutoTrackButton', {
        name: localize('BAD.settings.enableCombatAutoTrackButton.name'),
        hint: localize('BAD.settings.enableCombatAutoTrackButton.hint'),
        scope: 'world',
        config: true,
        type: Boolean,
        default: false,
        onChange: () => {
            if (actionDisplay.activeApp?.rendered) {
                actionDisplay.activeApp.render();
            }
        }
    });

    // Register Auto-Track Combat Turn Setting (Client Scope, default disabled)
    game.settings.register(MODULE_ID, 'autoTrackCombat', {
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    // Register Auto-Toggle Combat Turn Visibility Setting (Client Scope, default disabled)
    game.settings.register(MODULE_ID, 'autoToggleCombat', {
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    // Register Auto-Center on Token Setting (Client Scope, default disabled)
    game.settings.register(MODULE_ID, 'autoCenterOnToken', {
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    // ==========================================
    // User Scope Settings & Menus
    // ==========================================

    // Register Economy Colors Menu Button (User Scope)
    game.settings.registerMenu(MODULE_ID, 'economyColorsMenu', {
        name: localize('BAD.economyColors.title'),
        label: localize('BAD.settings.economyColorsMenu.label'),
        hint: localize('BAD.settings.economyColorsMenu.hint'),
        icon: 'fas fa-palette',
        type: EconomyColorsConfigApp as any,
        restricted: false
    } as any);

    // Register Configure HUD Menu Button (User Scope)
    game.settings.registerMenu(MODULE_ID, 'hudConfigMenu', {
        name: localize('BAD.hudConfig.title'),
        label: localize('BAD.settings.hudConfigMenu.label'),
        hint: localize('BAD.settings.hudConfigMenu.hint'),
        icon: 'fas fa-sliders-h',
        type: HUDConfigApp as any,
        restricted: false
    } as any);

    // Register Action Economy Indicators Setting (User Scope, default disabled, configured in menu)
    game.settings.register(MODULE_ID, 'enableEconomyIndicators', {
        scope: 'user',
        config: false,
        type: Boolean,
        default: false,
        onChange: () => {
            if (actionDisplay.activeApp?.rendered) {
                actionDisplay.activeApp.render();
            }
        }
    });

    // Register Action Economy Colors Configuration Storage (User Scope)
    game.settings.register(MODULE_ID, 'economyColors', {
        scope: 'user',
        config: false,
        type: Object,
        default: {},
        onChange: () => {
            if (actionDisplay.activeApp?.rendered) {
                actionDisplay.activeApp.render();
            }
        }
    });

    // Register HUD Opacity Setting (Storage, configured in Configure HUD submenu)
    game.settings.register(MODULE_ID, 'hudOpacity', {
        name: localize('BAD.settings.hudOpacity.name'),
        hint: localize('BAD.settings.hudOpacity.hint'),
        scope: 'user',
        config: false,
        type: Number,
        range: {
            min: 0.1,
            max: 1.0,
            step: 0.05
        },
        default: 0.88,
        onChange: value => {
            document.documentElement.style.setProperty('--bad-hud-opacity', String(value));
        }
    });

    // Register HUD Scale Setting (Storage, configured in Configure HUD submenu)
    game.settings.register(MODULE_ID, 'hudScale', {
        name: localize('BAD.settings.hudScale.name'),
        hint: localize('BAD.settings.hudScale.hint'),
        scope: 'user',
        config: false,
        type: Number,
        range: {
            min: 0.5,
            max: 1.5,
            step: 0.05
        },
        default: 1.0,
        onChange: value => {
            document.documentElement.style.setProperty('--bad-hud-scale', String(value));
        }
    });

    // Register HUD Font Size Setting (Storage, configured in Configure HUD submenu)
    game.settings.register(MODULE_ID, 'fontSize', {
        name: localize('BAD.settings.fontSize.name'),
        hint: localize('BAD.settings.fontSize.hint'),
        scope: 'user',
        config: false,
        type: Number,
        range: {
            min: 10,
            max: 24,
            step: 1
        },
        default: 14,
        onChange: value => {
            document.documentElement.style.setProperty('--bad-hud-font-size', `${value}px`);
        }
    });

    // Register Persist Tab State setting
    game.settings.register(MODULE_ID, 'persistTabState', {
        name: localize('BAD.settings.persistTabState.name'),
        hint: localize('BAD.settings.persistTabState.hint'),
        scope: 'user',
        config: true,
        type: Boolean,
        default: true
    });

    // Register Toggle Tab Selection Setting
    game.settings.register(MODULE_ID, 'toggleTabSelection', {
        name: localize('BAD.settings.toggleTabSelection.name'),
        hint: localize('BAD.settings.toggleTabSelection.hint'),
        scope: 'user',
        config: true,
        type: Boolean,
        default: false
    });

    // Register HUD Attachment Side Setting (Storage, configured in Configure HUD submenu)
    game.settings.register(MODULE_ID, 'hudAnchorSide', {
        name: localize('BAD.settings.hudAnchorSide.name'),
        hint: localize('BAD.settings.hudAnchorSide.hint'),
        scope: 'user',
        config: false,
        type: String,
        default: 'vertical',
        choices: {
            'vertical': localize('BAD.settings.hudAnchorSide.choices.vertical'),
            'horizontal': localize('BAD.settings.hudAnchorSide.choices.horizontal')
        },
        onChange: () => {
            if (actionDisplay.activeApp?.rendered) {
                actionDisplay.activeApp.setPosition();
            }
        }
    });

    // Register HUD Grid Offset Setting (Vertical) (Storage, configured in Configure HUD submenu)
    game.settings.register(MODULE_ID, 'hudGridOffset', {
        name: localize('BAD.settings.hudGridOffset.name'),
        hint: localize('BAD.settings.hudGridOffset.hint'),
        scope: 'user',
        config: false,
        type: Number,
        range: {
            min: 0,
            max: 1,
            step: 0.1
        },
        default: 0.5,
        onChange: () => {
            if (actionDisplay.activeApp?.rendered) {
                actionDisplay.activeApp.setPosition();
            }
        }
    });

    // Register HUD Grid Offset Setting (Horizontal) (Storage, configured in Configure HUD submenu)
    game.settings.register(MODULE_ID, 'hudGridOffsetHorizontal', {
        name: localize('BAD.settings.hudGridOffsetHorizontal.name'),
        hint: localize('BAD.settings.hudGridOffsetHorizontal.hint'),
        scope: 'user',
        config: false,
        type: Number,
        range: {
            min: 0,
            max: 3,
            step: 0.1
        },
        default: 0.5,
        onChange: () => {
            if (actionDisplay.activeApp?.rendered) {
                actionDisplay.activeApp.setPosition();
            }
        }
    });

    // Register Show Tooltips Setting (User Scope)
    game.settings.register(MODULE_ID, 'showTooltips', {
        name: localize('BAD.settings.showTooltips.name'),
        hint: localize('BAD.settings.showTooltips.hint'),
        scope: 'user',
        config: true,
        type: Boolean,
        default: true,
        onChange: () => {
            if (actionDisplay.activeApp?.rendered) {
                actionDisplay.activeApp.render();
            }
        }
    });

    // ==========================================
    // Client Scope Settings
    // ==========================================

    // Register Log Verbosity Setting
    game.settings.register(MODULE_ID, 'logVerbosity', {
        name: localize('BAD.settings.logVerbosity.name'),
        hint: localize('BAD.settings.logVerbosity.hint'),
        scope: 'client',
        config: true,
        type: String,
        default: 'warn',
        choices: {
            'error': localize('BAD.settings.logVerbosity.choices.error'),
            'warn': localize('BAD.settings.logVerbosity.choices.warn'),
            'info': localize('BAD.settings.logVerbosity.choices.info'),
            'debug': localize('BAD.settings.logVerbosity.choices.debug')
        },
        onChange: value => {
            log.setVerbosity(value);
        }
    });

    // Register Show Depleted Items Setting (hidden from config menu, managed via HUD control bar)
    game.settings.register(MODULE_ID, 'showDepleted', {
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    // Register Show Item Summaries Setting (hidden from config menu, managed via HUD control bar)
    game.settings.register(MODULE_ID, 'showItemSummaries', {
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    // Register HUD Attached State (true = attached to token, false = detached floating)
    game.settings.register(MODULE_ID, 'isAttached', {
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    // Register Persist HUD Setting (true = stays open across outside clicks, false = closes on outside click)
    game.settings.register(MODULE_ID, 'persistHUD', {
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    // Register HUD Detached Position (coordinates)
    game.settings.register(MODULE_ID, 'hudDetachedPosition', {
        scope: 'client',
        config: false,
        type: Object,
        default: null
    });

    // Register HUD Tab States (persisted actor tab selections object)
    game.settings.register(MODULE_ID, 'hudTabStates', {
        scope: 'client',
        config: false,
        type: Object,
        default: {}
    });

    // Apply initial CSS variables (opacity, scale, font size) to the document root
    const initialOpacity = game.settings.get(MODULE_ID, 'hudOpacity');
    document.documentElement.style.setProperty('--bad-hud-opacity', String(initialOpacity));

    const initialScale = game.settings.get(MODULE_ID, 'hudScale');
    document.documentElement.style.setProperty('--bad-hud-scale', String(initialScale));

    const initialFontSize = game.settings.get(MODULE_ID, 'fontSize');
    document.documentElement.style.setProperty('--bad-hud-font-size', `${initialFontSize}px`);
});

const USER_SETTING_KEYS = deepFreeze([
    'persistTabState',
    'toggleTabSelection',
    'showTooltips',
    'hudOpacity',
    'hudScale',
    'fontSize'
]);

const USER_MENU_KEYS = deepFreeze([
    'economyColorsMenu',
    'hudConfigMenu'
]);

const SETTINGS_SECTIONS = deepFreeze([
    {
        keys: ['categorizationMenu', 'dnd5eAutoBanMenu', 'moduleIntegrationsMenu', 'enableCenterOnToken', 'enableItemSummaryButton', 'enableToggleHotkey', 'enableCombatButtons', 'enableCombatAutoTrackButton'],
        scope: 'world',
        titleKey: 'BAD.settingsSections.world',
        defaultTitle: 'World Settings',
        icon: 'fas fa-globe'
    },
    {
        keys: ['economyColorsMenu', 'hudConfigMenu', 'persistTabState', 'toggleTabSelection', 'showTooltips', 'hudOpacity', 'hudScale', 'fontSize', 'hudAnchorSide', 'hudGridOffset', 'hudGridOffsetHorizontal'],
        scope: 'user',
        titleKey: 'BAD.settingsSections.user',
        defaultTitle: 'User Settings',
        icon: 'fas fa-user'
    },
    {
        keys: ['logVerbosity'],
        scope: 'client',
        titleKey: 'BAD.settingsSections.client',
        defaultTitle: 'Client Settings',
        icon: 'fas fa-desktop'
    }
]);

function getSettingSelector(key: string): string {
    return `[data-setting-id="${MODULE_ID}.${key}"], [data-entry-id="${MODULE_ID}.${key}"], [name="${MODULE_ID}.${key}"], [data-key="${MODULE_ID}.${key}"], [data-action="${MODULE_ID}.${key}"], [data-setting-id="${key}"], [data-entry-id="${key}"], [name="${key}"], [data-key="${key}"], [data-action="${key}"]`;
}

/**
 * Injects styled subsection headers for World, User, and Client settings into the SettingsConfig dialog.
 * Moves user-scoped menus (like economyColorsMenu) to the User Settings section so they appear under User Settings.
 * @param {HTMLElement|Object} html Rendered settings config DOM element or jQuery collection
 * @param {Application} [app] Application instance
 */
export function injectSettingsHeaders(html: HTMLElement | JQuery, app?: unknown) {
    const rawRoot = (html instanceof HTMLElement ? html : (html as any)?.[0])
        ?? ((app as any)?.element instanceof HTMLElement ? (app as any).element : (app as any)?.element?.[0])
        ?? document.querySelector?.('#client-settings, form.categories, .settings-list')
        ?? null;
    const root = rawRoot instanceof HTMLElement ? rawRoot : null;

    if (!root) return;

    // 1. Move user-scoped menus (economyColorsMenu, hudConfigMenu) into the User Settings section before the first regular user setting
    let firstUserSettingEl: Element | null = null;
    for (const key of USER_SETTING_KEYS) {
        firstUserSettingEl = root.querySelector(getSettingSelector(key));
        if (firstUserSettingEl) break;
    }

    if (firstUserSettingEl) {
        const userSettingFg = firstUserSettingEl.closest('.form-group') ?? firstUserSettingEl;
        const parent = userSettingFg.parentNode;
        if (parent) {
            for (const menuKey of USER_MENU_KEYS) {
                const menuEl = root.querySelector(getSettingSelector(menuKey));
                if (menuEl) {
                    const menuFg = menuEl.closest('.form-group') ?? menuEl;
                    if (menuFg && menuFg.parentNode === parent && menuFg !== userSettingFg) {
                        if (menuFg.nextElementSibling !== userSettingFg) {
                            parent.insertBefore(menuFg, userSettingFg);
                        }
                    }
                }
            }
        }
    }

    // 2. Insert section headers before the respective first setting in each scope
    for (const section of SETTINGS_SECTIONS) {
        let targetEl: Element | null = null;
        for (const key of section.keys) {
            targetEl = root.querySelector(getSettingSelector(key));
            if (targetEl) break;
        }

        if (!targetEl) continue;

        const formGroup = targetEl.closest('.form-group') ?? targetEl;
        const parent = formGroup?.parentNode;
        if (!formGroup || !parent) continue;

        // Ensure we don't insert duplicate headers
        const existing = (parent as any).querySelector?.(`.bad-settings-section-header[data-scope="${section.scope}"]`);
        if (existing) continue;

        const prev = formGroup.previousElementSibling as any;
        if (prev?.classList?.contains('bad-settings-section-header') && prev?.dataset?.scope === section.scope) {
            continue;
        }

        const title = localize(section.titleKey, section.defaultTitle);
        const header = document.createElement('div');
        header.className = 'bad-settings-section-header';
        header.dataset.scope = section.scope;
        header.innerHTML = `<i class="${section.icon}"></i><span>${title}</span>`;
        parent.insertBefore(header, formGroup);
    }
}

Hooks.on('renderSettingsConfig', (_app: unknown, html: HTMLElement | JQuery) => {
    injectSettingsHeaders(html, _app);
});

