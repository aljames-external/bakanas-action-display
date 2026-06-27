// Main entry point for Bakana's Action Display
import { actionDisplay } from './action-display.js';
import { ActionDisplayApp } from './ui/action-display-app.js';

const MODULE_ID = 'bakanas-action-display';
let activeApp = null;

Hooks.once('init', async () => {
    console.log(`${MODULE_ID} | Initializing Bakana's Action Display`);

    // 1. Dynamically import and register the active system adapter
    if (game.system.id === 'dnd5e') {
        const { DnD5eSystemAdapter } = await import('./adapters/dnd5e-system-adapter.js');
        actionDisplay.registerSystemAdapter(new DnD5eSystemAdapter());
    } else if (game.system.id === 'pf2e') {
        const { PF2eSystemAdapter } = await import('./adapters/pf2e-system-adapter.js');
        actionDisplay.registerSystemAdapter(new PF2eSystemAdapter());
    }

    // 2. Dynamically import and register active module adapters
    if (game.modules.get('sequencer')?.active) {
        const { SequencerModuleAdapter } = await import('./adapters/sequencer-module-adapter.js');
        actionDisplay.registerModuleAdapter(new SequencerModuleAdapter());
    }
    if (game.modules.get('midi-qol')?.active) {
        const { MidiQOLModuleAdapter } = await import('./adapters/midi-qol-module-adapter.js');
        actionDisplay.registerModuleAdapter(new MidiQOLModuleAdapter());
    }

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
