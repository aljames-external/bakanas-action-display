import { BaseFoundryAdapter } from './base-foundry-adapter.js';
import { FoundryV12Adapter } from './foundry-v12-adapter.js';
import { FoundryV13Adapter } from './foundry-v13-adapter.js';
import { log } from '../../lib/logger.js';

export { BaseFoundryAdapter, type FromUuidOptions } from './base-foundry-adapter.js';

let _activeFoundryAdapter: BaseFoundryAdapter | null = null;

/**
 * Initialize and return the active Foundry VTT platform adapter.
 * Selects FoundryV13Adapter for v13+ and FoundryV12Adapter for v12 baseline.
 * @returns {FoundryV13Adapter|FoundryV12Adapter}
 */
export function initializeFoundryAdapter() {
    const generation = game?.release?.generation ?? 13;
    if (generation < 12) {
        throw new Error(`Unsupported Foundry VTT generation: v${generation}. Bakana's Action Display requires Foundry VTT v12 or newer.`);
    }

    const adapter = generation >= 13 ? new FoundryV13Adapter() : new FoundryV12Adapter();
    _activeFoundryAdapter = adapter;
    log.info(`Initialized Foundry Platform Adapter (v${adapter.generation})`);
    return adapter;
}

/**
 * Get the active Foundry VTT platform adapter, lazily initializing if needed.
 * @returns {FoundryV13Adapter|FoundryV12Adapter}
 */
export function getFoundryAdapter() {
    if (!_activeFoundryAdapter) {
        _activeFoundryAdapter = initializeFoundryAdapter();
    }
    return _activeFoundryAdapter;
}
