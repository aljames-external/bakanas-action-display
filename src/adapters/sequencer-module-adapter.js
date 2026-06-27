import { BaseModuleAdapter } from './base-module-adapter.js';

/**
 * Module adapter for the 'sequencer' module.
 * If Sequencer is active, it wraps action rolls to play a visual effect on the token
 * and adds animation metadata to the actions.
 */
export class SequencerModuleAdapter extends BaseModuleAdapter {
    constructor() {
        super('sequencer');
    }

    /**
     * Process and modify actions to inject Sequencer effects.
     * @param {Object[]} actions 
     * @param {Actor} actor 
     * @returns {Object[]} The modified actions
     */
    processActions(actions, actor) {
        return actions.map(action => {
            const originalRoll = action.roll;

            // Wrap the roll function to play an animation
            action.roll = async () => {
                this._playTokenEffect(action);
                return originalRoll();
            };

            // Add extra metadata for the UI
            action.extra = action.extra ?? {};
            action.extra.hasSequencerEffect = true;

            return action;
        });
    }

    /**
     * Play a visual effect on the token associated with the action.
     */
    _playTokenEffect(action) {
        // Find the active token for this actor on the current scene
        const token = action.originalItem?.actor?.getActiveTokens()?.[0];
        if (!token) return;

        // Ensure Sequence class exists (provided by the Sequencer module)
        if (typeof Sequence === 'undefined') return;

        // Play a simple, generic particle effect centered on the token
        new Sequence()
            .effect()
                .file("jb2a.particles.outward.white.01.01") // A standard asset path (often available/cached)
                .atLocation(token)
                .scaleToObject(1.5)
                .opacity(0.6)
                .belowTokens(false)
            .play();
    }
}
