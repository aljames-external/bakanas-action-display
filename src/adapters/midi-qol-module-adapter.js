import { BaseModuleAdapter } from './base-module-adapter.js';

/**
 * Module adapter for 'midi-qol' (D&D5e automation).
 * Identifies actions that are automated by Midi-QOL and flags them for the UI.
 */
export class MidiQolModuleAdapter extends BaseModuleAdapter {
    constructor() {
        super('midi-qol');
    }

    /**
     * Process actions and check for Midi-QOL automation flags.
     * @param {Object[]} actions 
     * @param {Actor} actor 
     * @returns {Object[]} The modified actions
     */
    processActions(actions, actor) {
        return actions.map(action => {
            const item = action.originalItem;
            if (!item) return action;

            // Midi-QOL stores its settings under flags['midi-qol']
            const midiFlags = item.flags?.['midi-qol'];

            action.extra = action.extra ?? {};

            // If the item has Midi-QOL automation flags, mark it as automated
            if (midiFlags) {
                action.extra.midiAutomated = true;
            }

            return action;
        });
    }
}
