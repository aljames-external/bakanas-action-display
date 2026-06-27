/**
 * Base class for all module-specific adapters.
 * Module adapters can modify the actions list after the system adapter has processed it,
 * allowing them to hide actions, add new tabs, or inject custom action types.
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
     * Modify the actions list.
     * @param {Object[]} actions The current list of actions
     * @param {Actor} actor The actor these actions belong to
     * @returns {Object[]} The modified list of actions
     */
    modifyActions(actions, actor) {
        return actions;
    }
}
