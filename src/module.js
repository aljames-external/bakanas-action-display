// Main entry point for Bakana's Action Display
import { actionDisplay } from './action-display.js';
import { DnD5eSystemAdapter } from './adapters/dnd5e-system-adapter.js';
import { PF2eSystemAdapter } from './adapters/pf2e-system-adapter.js';
import { SequencerModuleAdapter } from './adapters/sequencer-module-adapter.js';
import { MidiQOLModuleAdapter } from './adapters/midi-qol-module-adapter.js';
import { ActionDisplayApp } from './ui/action-display-app.js';

const MODULE_ID = 'bakanas-action-display';
let activeApp = null;

Hooks.once('init', async () => {
    console.log(`${MODULE_ID} | Initializing Bakana's Action Display`);

    // Register system adapters
    actionDisplay.registerSystemAdapter(new DnD5eSystemAdapter());
    actionDisplay.registerSystemAdapter(new PF2eSystemAdapter());

    // Register module adapters
    actionDisplay.registerModuleAdapter(new SequencerModuleAdapter());
    actionDisplay.registerModuleAdapter(new MidiQOLModuleAdapter());

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
