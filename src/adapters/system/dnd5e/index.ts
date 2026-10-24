import { BaseDnd5eSystemAdapter } from './base-dnd5e-system-adapter.js';
import { Dnd5eV4Adapter } from './dnd5e-v4-adapter.js';
import { Dnd5eV5Adapter } from './dnd5e-v5-adapter.js';
import { Dnd5eV6Adapter } from './dnd5e-v6-adapter.js';
import { BaseFoundryAdapter } from '../../foundry/base-foundry-adapter.js';
import { log } from '../../../lib/logger.js';

export {
    BaseDnd5eSystemAdapter,
    Dnd5eV4Adapter,
    Dnd5eV5Adapter,
    Dnd5eV6Adapter
};

export type {
    Dnd5eConfig,
    Dnd5eSensesData,
    ItemSummaryProperty,
    ItemSummary
} from './base-dnd5e-system-adapter.js';

// Backward-compatible alias for existing tests and code
export { Dnd5eV5Adapter as Dnd5eSystemAdapter_5_3 };

/**
 * Dynamic factory entry-point / compatibility wrapper for D&D 5th Edition.
 * Automatically delegates to Dnd5eV6Adapter on v6.0+, Dnd5eV5Adapter on v5.3+,
 * and Dnd5eV4Adapter on earlier v4.0+ baseline.
 */
export class Dnd5eSystemAdapter extends BaseDnd5eSystemAdapter {
    constructor(foundry: BaseFoundryAdapter) {
        if (!foundry) {
            throw new Error(`Dnd5eSystemAdapter requires a valid Foundry adapter instance, received: ${foundry}`);
        }
        if (new.target === Dnd5eSystemAdapter) {
            const version = game.system?.version ?? '4.0.0';
            if (!foundry.isNewerVersion('6.0.0', version)) {
                return new Dnd5eV6Adapter(foundry);
            }
            if (!foundry.isNewerVersion('5.3.0', version)) {
                return new Dnd5eV5Adapter(foundry);
            }
            return new Dnd5eV4Adapter(foundry);
        }
        super(foundry);
    }
}

/**
 * Initialize and return the active D&D 5e system adapter based on game.system.version.
 * Selects Dnd5eV6Adapter for v6.0+, Dnd5eV5Adapter for v5.3+, and Dnd5eV4Adapter for v4.0+ baseline.
 * @param {BaseFoundryAdapter} foundry
 * @returns {BaseDnd5eSystemAdapter}
 */
export function initializeDnd5eAdapter(foundry: BaseFoundryAdapter): BaseDnd5eSystemAdapter {
    if (!foundry) {
        throw new Error(`initializeDnd5eAdapter requires a valid Foundry adapter instance, received: ${foundry}`);
    }
    const version = game.system?.version ?? '4.0.0';
    let adapter: BaseDnd5eSystemAdapter;
    if (!foundry.isNewerVersion('6.0.0', version)) {
        adapter = new Dnd5eV6Adapter(foundry);
    } else if (!foundry.isNewerVersion('5.3.0', version)) {
        adapter = new Dnd5eV5Adapter(foundry);
    } else {
        adapter = new Dnd5eV4Adapter(foundry);
    }
    log.info(`Initialized D&D 5e System Adapter (v${adapter.generation})`);
    return adapter;
}
