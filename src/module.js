// Main entry point for Bakana's Action Display

const MODULE_ID = 'bakanas-action-display';

Hooks.once('init', async () => {
    console.log(`${MODULE_ID} | Initializing Bakana's Action Display`);

    // Register settings, APIs, or custom classes here
    // Example:
    // game.settings.register(MODULE_ID, "mySetting", { ... });
});

Hooks.once('ready', async () => {
    console.log(`${MODULE_ID} | Ready`);
});
