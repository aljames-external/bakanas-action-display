// Main entry point for Bakana's Action Display
import './settings.js'; // Load settings
import { actionDisplay } from './action-display.js';
import { ActionDisplayApp } from './ui/action-display-app.js';
import { log } from './lib/logger.js';
import { MODULE_ID } from './constants.js';

let activeApp = null;

/**
 * Helper to convert hyphenated or lowercase IDs into PascalCase.
 * e.g., "dnd5e" -> "Dnd5e", "midi-qol" -> "MidiQol"
 */
function toPascalCase(str) {
    return str.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('');
}

/**
 * Dynamically loads and registers adapters based on the active system and enabled modules.
 * Derives paths and class names by convention:
 * - Path: `./adapters/${id}-${type}-adapter.js`
 * - Class: `${PascalCase(id)}${Type}Adapter`
 */
async function registerAdapters() {
    const systemId = game.system.id;

    // 1. Load active system adapter if supported
    if (actionDisplay.isSystemSupported(systemId)) {
        const systemPath = `./adapters/${systemId}-system-adapter.js`;
        const systemClassName = `${toPascalCase(systemId)}SystemAdapter`;

        try {
            const systemModule = await import(systemPath);
            const AdapterClass = systemModule[systemClassName];
            if (AdapterClass) {
                actionDisplay.registerSystemAdapter(new AdapterClass());
            } else {
                log.error(`Class ${systemClassName} not found in ${systemPath}`);
            }
        } catch (error) {
            log.error(`Failed to load system adapter for ${systemId} at ${systemPath}`, error);
        }
    } else {
        log.warn(`No system adapter configured for system: ${systemId}`);
    }

    // 2. Load active supported module adapters
    const activeModules = actionDisplay.getSupportedModules();

    for (const moduleId of activeModules) {
        const modulePath = `./adapters/${moduleId}-module-adapter.js`;
        const moduleClassName = `${toPascalCase(moduleId)}ModuleAdapter`;

        try {
            const moduleNamespace = await import(modulePath);
            const AdapterClass = moduleNamespace[moduleClassName];
            if (AdapterClass) {
                actionDisplay.registerModuleAdapter(new AdapterClass());
            } else {
                log.error(`Class ${moduleClassName} not found in ${modulePath}`);
            }
        } catch (error) {
            log.error(`Failed to load module adapter for ${moduleId} at ${modulePath}`, error);
        }
    }
}

Hooks.once('init', async () => {
    log.info("Initializing Bakana's Action Display");

    // Dynamically load and register active adapters
    await registerAdapters();

    // Initialize the core coordinator
    actionDisplay.init();

    // Bind to globalThis for debugging and external integration
    globalThis.bakanasActionDisplay = actionDisplay;

    // Wrap TokenHUD.clear to close our application when HUD is cleared
    const originalClear = TokenHUD.prototype.clear;
    TokenHUD.prototype.clear = function () {
        originalClear.call(this);
        if (activeApp) {
            activeApp.close();
            activeApp = null;
        }
    };
});

Hooks.once('ready', async () => {
    log.info("Ready");
});

// Hook into Token HUD rendering to display our overlay
Hooks.on('renderTokenHUD', (tokenHUD, html, data) => {
    const token = tokenHUD.object;
    if (!token || !token.document.isOwner) return;

    // Close any existing app
    if (activeApp) {
        activeApp.close();
    }

    // Create and render the new app
    activeApp = new ActionDisplayApp(token);
    activeApp.render(true);
});

// Re-render the app if the token, actor, or their items are updated
Hooks.on('updateToken', (tokenDocument) => {
    if (activeApp && activeApp.token.document.id === tokenDocument.id) {
        activeApp.render(true);
    }
});

Hooks.on('updateActor', (actor) => {
    if (activeApp && activeApp.actor.id === actor.id) {
        activeApp.render(true);
    }
});

Hooks.on('updateItem', (item) => {
    if (activeApp && activeApp.actor.id === item.parent?.id) {
        activeApp.render(true);
    }
});
