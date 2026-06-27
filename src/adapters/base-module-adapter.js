/**
 * Base class for all module-specific adapters.
 * Module adapters can modify the actions extracted by the system adapter
 * (e.g., adding animation data, altering display names) or inject custom actions.
 */
export class BaseModuleAdapter {
    constructor(moduleId) {
        this.moduleId = moduleId;
    }

    /**
     * Determine if this adapter is active (i.e., the module is enabled in the world).
     * @returns {boolean}
     */
    isActive() {
        return game.modules.get(this.moduleId)?.active ?? false;
    }

    /**
     * Modify the list of actions.
     * @param {Object[]} actions The current list of actions
     * @param {Actor} actor The actor these actions belong to
     * @returns {Object[]} The modified list of actions
     */
    processActions(actions, actor) {
        return actions;
    }
}
