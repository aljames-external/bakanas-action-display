/**
 * Base class for all system-specific adapters.
 * System adapters are responsible for parsing an actor's items, attributes,
 * and abilities, and translating them into a unified Action structure.
 */
export class BaseSystemAdapter {
    constructor(systemId) {
        this.systemId = systemId;
    }

    /**
     * Determine if this adapter is compatible with the current system.
     * @returns {boolean}
     */
    isCompatible() {
        return game.system.id === this.systemId;
    }

    /**
     * Extract actions from the given actor.
     * @param {Actor} actor
     * @returns {Object[]} Array of raw action objects
     */
    getActions(actor) {
        throw new Error(`getActions() must be implemented by the subclass for system "${this.systemId}"`);
    }
}
