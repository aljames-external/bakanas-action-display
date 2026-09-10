/**
 * Base class for all module-specific adapters.
 * Module adapters can modify the actions list after the system adapter has processed it,
 * allowing them to hide actions, add new tabs, or inject custom action types.
 */
export class BaseModuleAdapter {
    moduleId: string;

    constructor(moduleId: string) {
        this.moduleId = moduleId;
    }

    /**
     * Modify the actions list.
     * @param {Action[]} actions The current list of actions
     * @returns {Promise<Action[]>} The modified list of actions
     */
    async modifyActions(actions: Action[]): Promise<Action[]> {
        return actions;
    }
}
