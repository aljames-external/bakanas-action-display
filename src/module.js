// Main entry point for Bakana's Action Display
import { actionDisplay } from './action-display.js';
import { ActionDisplayApp } from './ui/action-display-app.js';

const MODULE_ID = 'bakanas-action-display';
let activeApp = null;

/**
 * Dynamically loads and registers adapters based on the active system and enabled modules.
 */
async function registerAdapters() {
    const systemId = game.system.id;
    
    // System Adapter Registry
    const systemRegistry = {
        'dnd5e': { path: './adapters/dnd5e-system-adapter.js', className: 'DnD5eSystemAdapter' },
        'pf2e': { path: './adapters/pf2e-system-adapter.js', className: 'PF2eSystemAdapter' }
    };

    const systemConfig = systemRegistry[systemId];
    if (systemConfig) {
        const module = await import(systemConfig.path);
        const AdapterClass = module[systemConfig.className];
        actionDisplay.registerSystemAdapter(new AdapterClass());
    } else {
        console.warn(`${MODULE_ID} | No system adapter configured for: ${systemId}`);
    }

    // Module Adapter Registry
    const moduleRegistry = [
        { id: 'sequencer', path: './adapters/sequencer-module-adapter.js', className: 'SequencerModuleAdapter' },
        { id: 'midi-qol', path: './adapters/midi-qol-module-adapter.js', className: 'MidiQOLModuleAdapter' }
    ];

    for (const mod of moduleRegistry) {
        if (game.modules.get(mod.id)?.active) {
            const module = await import(mod.path);
            const AdapterClass = module[mod.className];
            actionDisplay.registerModuleAdapter(new AdapterClass());
        }
    }
}

Hooks.once('init', async () => {
    console.log(`${MODULE_ID} | Initializing Bakana's Action Display`);

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
    console.log(`${MODULE_ID} | Ready`);
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
