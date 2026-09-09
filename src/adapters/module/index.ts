import { BaseModuleAdapter } from './base-module-adapter.js';
import { MODULE_ADAPTERS } from './module-adapters.js';
import { log } from '../../lib/logger.js';

/**
 * Instantiates all active third-party module adapters.
 * @returns {Map<string, BaseModuleAdapter>}
 */
export function initializeModuleAdapters() {
    const activeMap = new Map();
    for (const [moduleId, AdapterClass] of Object.entries(MODULE_ADAPTERS)) {
        if (game.modules?.get(moduleId)?.active) {
            try {
                activeMap.set(moduleId, new AdapterClass());
                log.info(`Initialized module adapter for: ${moduleId}`);
            } catch (error) {
                log.error(`Failed to register module adapter for ${moduleId}:`, error);
            }
        }
    }
    return activeMap;
}

/**
 * Check if at least one third-party module with a registered adapter is active in the current world.
 * @returns {boolean}
 */
export function hasActiveModuleAdapters() {
    return Object.keys(MODULE_ADAPTERS).some(moduleId => Boolean(game.modules?.get(moduleId)?.active));
}

export { BaseModuleAdapter, MODULE_ADAPTERS };
