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
     * Modify the actions list.
     * @param {Object[]} actions The current list of actions
     * @returns {Object[]} The modified list of actions
     */
    async modifyActions(actions) {
        return actions;
    }
}
