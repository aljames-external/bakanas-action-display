import { BaseSystemAdapter } from './adapters/system/base-system-adapter.js';
import { BaseModuleAdapter } from './adapters/module/base-module-adapter.js';
import { log } from './lib/logger.js';

// Lists of systems and modules that have adapter implementations
const SUPPORTED_SYSTEMS = ['dnd5e', 'pf2e'];
const SUPPORTED_MODULES = ['midi-qol']; // Sequencer removed as it doesn't modify items

/**
 * Core coordinator class for Bakana's Action Display.
 * Manages the pipeline: Core Extraction -> System Adapter Layer -> Module Adapter Layer -> UI.
 */
class ActionDisplay {
    constructor() {
        this.systemAdapters = new Map();
        this.moduleAdapters = new Map();
        this.activeSystemAdapter = null;
    }

    /**
     * Get the list of supported modules that are currently active in the world.
     * @returns {string[]} Array of active supported module IDs
     */
    getSupportedModules() {
        return SUPPORTED_MODULES.filter(id => game.modules.get(id)?.active);
    }

    /**
     * Check if a game system is supported by an adapter.
     * @param {string} systemId 
     * @returns {boolean}
     */
    isSystemSupported(systemId) {
        return SUPPORTED_SYSTEMS.includes(systemId);
    }

    /**
     * Initialize the coordinator by detecting the active system and registering adapters.
     */
    init() {
        log.info("Initializing ActionDisplay core");
        this._detectSystemAdapter();
    }

    /**
     * Register a system adapter.
     * @param {BaseSystemAdapter} adapter 
     */
    registerSystemAdapter(adapter) {
        if (!(adapter instanceof BaseSystemAdapter)) {
            throw new Error("System adapter must be an instance of BaseSystemAdapter");
        }
        this.systemAdapters.set(adapter.systemId, adapter);
        log.info(`Registered system adapter for: ${adapter.systemId}`);
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
     * Automatically detect and activate the system adapter for the current game system.
     */
    _detectSystemAdapter() {
        const currentSystemId = game.system.id;
        const adapter = this.systemAdapters.get(currentSystemId);
        if (adapter && adapter.isCompatible()) {
            this.activeSystemAdapter = adapter;
            log.info(`Activated system adapter: ${currentSystemId}`);
        } else {
            log.warn(`No compatible system adapter found for system: ${currentSystemId}`);
        }
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
        } else {
            // Default system-agnostic fallback:
            // Put all items in an 'all' tab so the HUD still works
            actions = actions.map(a => {
                a.tabs = ['all'];
                return a;
            });
        }

        // 3. Module Adapters: Run through active module adapters
        for (const [moduleId, adapter] of this.moduleAdapters.entries()) {
            if (adapter.isActive()) {
                try {
                    actions = adapter.modifyActions(actions, actor);
                } catch (error) {
                    log.error(`Error in module adapter "${moduleId}":`, error);
                }
            }
        }

        // 4. Resource Filtering: Filter out actions with depleted resources if enabled
        const filterNoResources = game.settings.get('bakanas-action-display', 'filterNoResources');
        if (filterNoResources) {
            actions = actions.filter(action => {
                // Only filter out if it has a resource tracker (available !== null) and it is depleted (<= 0)
                return !(action.uses && action.uses.available !== null && action.uses.available <= 0);
            });
        }

        // Filter out hidden actions
        const filtered = actions.filter(a => !a.hidden);
        
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
        for (const item of actor.items) {
            if (!item.name) continue;

            baseActions.push({
                id: item.id,
                name: item.name,
                type: item.type,
                img: item.img,
                tabs: ['all'], // Default tab
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
