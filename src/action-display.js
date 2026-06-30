import { BaseSystemAdapter } from './adapters/system/base-system-adapter.js';
import { BaseModuleAdapter } from './adapters/module/base-module-adapter.js';
import { log } from './lib/logger.js';

import { MODULE_ID } from './constants.js';

/**
 * Core coordinator class for Bakana's Action Display.
 * Manages the pipeline: Core Extraction -> System Adapter Layer -> Module Adapter Layer -> UI.
 */
class ActionDisplay {
    constructor() {
        this.moduleAdapters = new Map();
        this.activeSystemAdapter = null;
    }

    /**
     * Initialize the coordinator by detecting the active system and registering adapters.
     */
    init() {
        log.info("Initializing ActionDisplay core");
        if (!this.activeSystemAdapter) {
            const currentSystemId = game.system.id;
            log.warn(`No system adapter registered for system: ${currentSystemId}. Falling back to default adapter.`);
            this.activeSystemAdapter = new BaseSystemAdapter(currentSystemId);
        }
    }

    /**
     * Register and activate the system adapter.
     * @param {BaseSystemAdapter} adapter 
     */
    registerSystemAdapter(adapter) {
        if (!(adapter instanceof BaseSystemAdapter)) {
            throw new Error("System adapter must be an instance of BaseSystemAdapter");
        }
        this.activeSystemAdapter = adapter;
        log.info(`Activated system adapter for: ${adapter.systemId}`);
    }

    /**
     * Register a module adapter.
     * @param {BaseModuleAdapter} adapter 
     */
    registerModuleAdapter(adapter) {
        if (!(adapter instanceof BaseModuleAdapter)) {
            throw new Error("Module adapter must be an instance of BaseModuleAdapter");
        }
        this.moduleAdapters.set(adapter.moduleId, adapter);
        log.info(`Registered module adapter for: ${adapter.moduleId}`);
    }

    /**
     * Run the pipeline to get actions for a given actor.
     * Pipeline: Core Extraction -> System Adapter Layer -> Module Adapter Layer.
     * @param {Actor} actor 
     * @returns {Object[]} The processed actions
     */
    getActions(actor) {
        if (!actor) return [];

        // 1. Core: Extract all items as base actions
        let actions = this._extractBaseActions(actor);
        const totalBase = actions.length;

        // 2. System Adapter: Modify/Filter/Sort the base actions
        if (this.activeSystemAdapter) {
            try {
                actions = this.activeSystemAdapter.modifyActions(actions, actor);
            } catch (error) {
                log.error(`Error in system adapter "${this.activeSystemAdapter.systemId}":`, error);
            }
        }

        // 3. Module Adapters: Run through active module adapters
        for (const [moduleId, adapter] of this.moduleAdapters.entries()) {
            try {
                actions = adapter.modifyActions(actions, actor);
            } catch (error) {
                log.error(`Error in module adapter "${moduleId}":`, error);
            }
        }

        // 4. Filter out system-hidden actions and apply user-hidden overrides in a single pass (O(1) lookups)
        const hiddenIds = actor.getFlag(MODULE_ID, 'hiddenItems') || [];
        const hiddenSet = new Set(hiddenIds);
        const filtered = [];

        for (const action of actions) {
            if (action.hidden) continue;

            const itemId = action.originalItem?.id || action.id;
            if (hiddenSet.has(itemId)) {
                action.isHidden = true;
                action.itemTypes = ['hidden'];
            }

            filtered.push(action);
        }
        
        log.debug(`getActions | actor: ${actor.name}, base actions: ${totalBase}, final actions: ${filtered.length} (activeSystemAdapter: ${this.activeSystemAdapter?.systemId})`);
        
        return filtered;
    }

    /**
     * Extract a base list of actions from the actor's items.
     * @param {Actor} actor 
     * @returns {Object[]} Base action objects
     */
    _extractBaseActions(actor) {
        const baseActions = [];
        const adapter = this.activeSystemAdapter;
        for (const item of actor.items) {
            if (!item.name) continue;
            if (adapter && !adapter.shouldExtractItem(item)) continue;

            baseActions.push({
                id: item.id,
                name: item.name,
                type: item.type,
                img: item.img,
                tabs: ['all'], // Default tab
                itemTypes: [item.type], // Default item type category
                hidden: false,
                uses: { available: null, max: null },
                roll: (event) => {
                    if (typeof item.use === 'function') {
                        return item.use({ event });
                    } else if (typeof item.roll === 'function') {
                        return item.roll({ event });
                    } else if (typeof item.toMessage === 'function') {
                        return item.toMessage();
                    }
                },
                originalItem: item,
                extra: {}
            });
        }
        return baseActions;
    }
}

// Export a singleton instance of the coordinator
export const actionDisplay = new ActionDisplay();
