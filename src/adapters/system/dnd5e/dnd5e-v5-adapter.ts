import { Dnd5eV4Adapter } from './dnd5e-v4-adapter.js';
import { BaseFoundryAdapter } from '../../foundry/base-foundry-adapter.js';
import type { Dnd5eConfig, Dnd5eSensesData } from './base-dnd5e-system-adapter.js';

/**
 * System adapter for D&D 5th Edition v5.3+.
 * Overrides senses extraction to target modern senses.ranges schema with zero fallback coalescing.
 */
export class Dnd5eV5Adapter extends Dnd5eV4Adapter {
    override readonly generation: number = 5;

    constructor(foundry: BaseFoundryAdapter) {
        super(foundry);
    }

    /**
     * Extract senses according to D&D 5e v5.3+ schema (senses.ranges.*).
     * @param {Dnd5eSensesData} sensesData
     * @param {Dnd5eConfig} [cfg]
     * @returns {string[]}
     */
    override extractSenses(sensesData: Dnd5eSensesData | null | undefined, cfg: Dnd5eConfig = CONFIG?.DND5E ?? {}): string[] {
        if (!sensesData) return [];
        const result: string[] = [];
        const units = sensesData.units ?? 'ft';
        const ranges = (sensesData as Record<string, unknown>).ranges as Record<string, unknown> | undefined ?? {};
        const defaultSenseKeys = ['darkvision', 'blindsight', 'tremorsense', 'truesight'];
        const configuredKeys = cfg?.senses ? Object.keys(cfg.senses) : [];
        const senseKeys = [...new Set([...defaultSenseKeys, ...configuredKeys])];

        for (const s of senseKeys) {
            const val = ranges[s];
            if (val && Number(val) > 0) {
                const label = this.formatSenseLabel(s, cfg?.senses);
                result.push(`${label} ${val} ${units}`);
            }
        }
        const special = typeof sensesData.special === 'string' ? sensesData.special.trim() : '';
        if (special) {
            result.push(special);
        }
        return result;
    }
}
