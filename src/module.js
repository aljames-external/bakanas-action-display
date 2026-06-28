// Main entry point for Bakana's Action Display
import './settings.js';
import { actionDisplay } from './action-display.js';
import { ActionDisplayApp } from './ui/action-display-app.js';
import { log } from './lib/logger.js';

let activeApp = null;
let closeDetachedHUD = false;

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
// Initialize hook
Hooks.once('init', async () => {
    log.info("Initializing Bakana's Action Display");

    // Wrap Token.prototype._onClickRight during init so it is bound correctly by all tokens' InteractionManagers
    const TokenClass = foundry.canvas.placeables.Token;
    const originalRightClick = TokenClass.prototype._onClickRight;
    TokenClass.prototype._onClickRight = function (event) {
        log.debug("Token.prototype._onClickRight called");
        if (activeApp && activeApp.token === this) {
            const persist = game.settings.get('bakanas-action-display', 'persistDetached');
            if (persist && !activeApp.isAttached) {
                log.debug("Right-clicked the same token with a detached HUD. Setting closeDetachedHUD flag.");
                closeDetachedHUD = true;
            }
        }
        return originalRightClick.call(this, event);
    };

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

    // Expose global debug helper
    globalThis.bad = {
        closeHUD: () => {
            log.debug("bad.closeHUD() called");
            if (activeApp) {
                log.debug("bad.closeHUD | activeApp found, closing:", activeApp);
                if (activeApp.element) {
                    activeApp.element.style.display = 'none';
                }
                activeApp.close();
                activeApp = null;
            } else {
                log.debug("bad.closeHUD | activeApp is null");
            }
        }
    };

    // Wrap the clear and close methods on the actual HUD class prototype (e.g. TokenHUD or TokenHUDPF)
    // to ensure it works across scene changes and supports custom system HUDs in all closing scenarios.
    if (canvas.hud?.token) {
        const hudClass = canvas.hud.token.constructor;
        log.info(`Wrapping ${hudClass.name}.prototype.clear and close`);
        
        const originalClear = hudClass.prototype.clear;
        hudClass.prototype.clear = function (...args) {
            log.debug(`${hudClass.name}.prototype.clear called`);
            if (activeApp) {
                const persist = game.settings.get('bakanas-action-display', 'persistDetached');
                const shouldClose = activeApp.isAttached || !persist || closeDetachedHUD;
                
                if (shouldClose) {
                    log.debug(`clear hook | Closing activeApp (state: ${activeApp.state})`);
                    if (activeApp.element) {
                        log.debug("clear hook | Hiding activeApp element");
                        activeApp.element.style.display = 'none';
                    }
                    activeApp.close();
                    activeApp = null;
                } else {
                    log.debug("clear hook | activeApp is detached and persist is enabled, keeping it open");
                }
            }
            closeDetachedHUD = false; // Always reset
            return originalClear.apply(this, args);
        };

        const originalClose = hudClass.prototype.close;
        hudClass.prototype.close = function (...args) {
            log.debug(`${hudClass.name}.prototype.close called`);
            if (activeApp) {
                const persist = game.settings.get('bakanas-action-display', 'persistDetached');
                const shouldClose = activeApp.isAttached || !persist || closeDetachedHUD;
                
                if (shouldClose) {
                    log.debug(`close hook | Closing activeApp (state: ${activeApp.state})`);
                    if (activeApp.element) {
                        log.debug("close hook | Hiding activeApp element");
                        activeApp.element.style.display = 'none';
                    }
                    activeApp.close();
                    activeApp = null;
                } else {
                    log.debug("close hook | activeApp is detached and persist is enabled, keeping it open");
                }
            }
            closeDetachedHUD = false; // Always reset
            return originalClose.apply(this, args);
        };
    }
});

// Hook into Token HUD rendering to display our overlay
Hooks.on('renderTokenHUD', (tokenHUD, html, data) => {
    const token = tokenHUD.object;
    if (!token || !token.document.isOwner) return;

    log.debug("renderTokenHUD hook fired for token:", token.name);

    // If we already have an activeApp for this token, preserve it to keep its tab/scroll state
    if (activeApp && activeApp.token.id === token.id) {
        log.debug("renderTokenHUD | activeApp already exists for this token, preserving instance");
        return;
    }

    // Close any existing app for a different token
    if (activeApp) {
        log.debug(`renderTokenHUD | activeApp exists for a different token (state: ${activeApp.state}), closing it`);
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
    if (activeApp && activeApp.token.document.id === tokenDocument.id && activeApp.rendered) {
        activeApp.render();
    }
});

// Update HUD position in real-time when the token moves (e.g., during keyboard movement or animations)
Hooks.on('refreshToken', (token, options) => {
    if (activeApp && activeApp.token === token && activeApp.isAttached && activeApp.rendered) {
        activeApp.setPosition();
    }
});

// Update HUD position when the canvas is panned or zoomed
Hooks.on('canvasPan', (canvas, pan) => {
    if (activeApp && activeApp.isAttached && activeApp.rendered) {
        activeApp.setPosition();
    }
});

Hooks.on('updateActor', (actor) => {
    if (activeApp && activeApp.actor.id === actor.id && activeApp.rendered) {
        activeApp.render();
    }
});

Hooks.on('updateItem', (item) => {
    if (activeApp && activeApp.actor.id === item.parent?.id && activeApp.rendered) {
        activeApp.render();
    }
});
