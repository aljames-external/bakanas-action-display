import { BaseDnd5eSystemAdapter } from './base-dnd5e-system-adapter.js';
import { BaseFoundryAdapter } from '../../foundry/base-foundry-adapter.js';

/**
 * System adapter for D&D 5th Edition v4.0+.
 * Concrete baseline implementation for D&D 5e generation 4.
 */
export class Dnd5eV4Adapter extends BaseDnd5eSystemAdapter {
    override readonly generation: number = 4;

    constructor(foundry: BaseFoundryAdapter) {
        super(foundry);
    }
}
