import { BaseSystemAdapter } from './adapters/base-system-adapter.js';
import { BaseModuleAdapter } from './adapters/base-module-adapter.js';

// Lists of systems and modules that have adapter implementations
const SUPPORTED_SYSTEMS = ['dnd5e', 'pf2e'];
const SUPPORTED_MODULES = ['sequencer', 'midi-qol'];

/**
 * Core coordinator class for Bakana's Action Display.
 * Manages the pipeline: System Adapters -> Module Adapters -> UI Display.
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
        console.log("bakanas-action-display | Initializing ActionDisplay core");
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
        console.log(`bakanas-action-display | Registered system adapter for: ${adapter.systemId}`);
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
        console.log(`bakanas-action-display | Registered module adapter for: ${adapter.moduleId}`);
    }

    /**
     * Automatically detect and activate the system adapter for the current game system.
     */
    _detectSystemAdapter() {
        const currentSystemId = game.system.id;
        const adapter = this.systemAdapters.get(currentSystemId);
        if (adapter && adapter.isCompatible()) {
            this.activeSystemAdapter = adapter;
            console.log(`bakanas-action-display | Activated system adapter: ${currentSystemId}`);
        } else {
            console.warn(`bakanas-action-display | No compatible system adapter found for system: ${currentSystemId}`);
        }
    }

    /**
     * Run the pipeline to get actions for a given actor.
     * Pipeline: Core Call -> System Adapter -> Module Adapters.
     * @param {Actor} actor 
     * @returns {Object[]} The processed actions
     */
    getActions(actor) {
        if (!actor) return [];

        // 1. Core Call: Ensure we have an active system adapter
        if (!this.activeSystemAdapter) {
            this._detectSystemAdapter(); // Try detecting again in case registration happened late
        }

        if (!this.activeSystemAdapter) {
            console.warn("bakanas-action-display | Cannot get actions: No active system adapter");
            return [];
        }

        // 2. System Adapter: Extract initial actions
        let actions = [];
        try {
            actions = this.activeSystemAdapter.getActions(actor);
        } catch (error) {
            console.error(`bakanas-action-display | Error in system adapter "${this.activeSystemAdapter.systemId}":`, error);
        }

        // 3. Module Adapters: Run actions through all active module adapters
        for (const [moduleId, adapter] of this.moduleAdapters.entries()) {
            if (adapter.isActive()) {
                try {
                    actions = adapter.processActions(actions, actor);
                } catch (error) {
                    console.error(`bakanas-action-display | Error in module adapter "${moduleId}":`, error);
                }
            }
        }

        return actions;
    }
}

// Export a singleton instance of the coordinator
export const actionDisplay = new ActionDisplay();
