// Main entry point for Bakana's Action Display
import './settings.js';
import { actionDisplay } from './action-display.js';
import { ActionDisplayApp } from './ui/action-display-app.js';
import { log } from './lib/logger.js';

let activeApp = null;

/**
 * Helper to convert hyphenated or lowercase IDs into PascalCase.
 */
function toPascalCase(str) {
    return str.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('');
}

/**
 * Dynamically loads and registers adapters based on the active system and enabled modules.
 */
async function registerAdapters() {
    const systemId = game.system.id;

    if (actionDisplay.isSystemSupported(systemId)) {
        const systemPath = `./adapters/system/${systemId}-system-adapter.js`;
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

    const activeModules = actionDisplay.getSupportedModules();
    for (const moduleId of activeModules) {
        const modulePath = `./adapters/module/${moduleId}-module-adapter.js`;
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

// Wrap TokenHUD.clear synchronously during init to ensure it is registered
// before any instances are created, and fires instantly when the HUD is cleared.
Hooks.on('init', () => {
    log.info("Wrapping TokenHUD.prototype.clear");
    const originalClear = TokenHUD.prototype.clear;
    TokenHUD.prototype.clear = function (...args) {
        log.debug("TokenHUD.prototype.clear called");
        if (activeApp) {
            log.debug("TokenHUD clear: Instantly hiding and closing activeApp");
            if (activeApp.element) {
                activeApp.element.style.display = 'none';
            }
            activeApp.close();
            activeApp = null;
        }
        return originalClear.apply(this, args);
    };
});

// Initialize hook
Hooks.once('init', async () => {
    log.info("Initializing Bakana's Action Display");

    // Dynamically load and register active adapters
    await registerAdapters();

    // Initialize the core coordinator
    actionDisplay.init();

    // Bind to globalThis for debugging and external integration
    globalThis.bakanasActionDisplay = actionDisplay;
});

// Ready hook
Hooks.once('ready', async () => {
    log.info("Ready");
});

// Hook into Token HUD rendering to display our overlay
Hooks.on('renderTokenHUD', (tokenHUD, html, data) => {
    const token = tokenHUD.object;
    if (!token || !token.document.isOwner) return;

    log.debug("renderTokenHUD hook fired for token:", token.name);

    // Close any existing app immediately
    if (activeApp) {
        log.debug("renderTokenHUD: Closing existing activeApp");
        if (activeApp.element) {
            activeApp.element.style.display = 'none';
        }
        activeApp.close();
    }

    // Create and render the new app
    activeApp = new ActionDisplayApp(token);
    log.debug("renderTokenHUD: Created new ActionDisplayApp:", activeApp);
    activeApp.render({ force: true });
});

// Re-render the app if the token, actor, or their items are updated
Hooks.on('updateToken', (tokenDocument) => {
    if (activeApp && activeApp.token.document.id === tokenDocument.id) {
        activeApp.render();
    }
});

Hooks.on('updateActor', (actor) => {
    if (activeApp && activeApp.actor.id === actor.id) {
        activeApp.render();
    }
});

Hooks.on('updateItem', (item) => {
    if (activeApp && activeApp.actor.id === item.parent?.id) {
        activeApp.render();
    }
});
