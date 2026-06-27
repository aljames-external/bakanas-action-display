// Main entry point for Bakana's Action Display
import { actionDisplay } from './action-display.js';
import { DnD5eSystemAdapter } from './adapters/dnd5e-system-adapter.js';
import { SequencerModuleAdapter } from './adapters/sequencer-module-adapter.js';

const MODULE_ID = 'bakanas-action-display';

Hooks.once('init', async () => {
    console.log(`${MODULE_ID} | Initializing Bakana's Action Display`);

    // Register system adapters
    actionDisplay.registerSystemAdapter(new DnD5eSystemAdapter());

    // Register module adapters
    actionDisplay.registerModuleAdapter(new SequencerModuleAdapter());

    // Initialize the core coordinator
    actionDisplay.init();

    // Bind to globalThis for debugging and external integration
    globalThis.bakanasActionDisplay = actionDisplay;
});

Hooks.once('ready', async () => {
    console.log(`${MODULE_ID} | Ready`);
});
