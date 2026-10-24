import { Dnd5eV5Adapter } from './dnd5e-v5-adapter.js';
import { BaseFoundryAdapter } from '../../foundry/base-foundry-adapter.js';
import type { Dnd5eAbility } from '../../../types/systems.js';

/**
 * System adapter for D&D 5th Edition v6.0+.
 * Overrides ability check and saving throw proficiency inspection to target modern
 * `abilities.<ability>.check.prof` and `abilities.<ability>.save.prof` schema with
 * zero access to deprecated checkProf / saveProf properties.
 */
export class Dnd5eV6Adapter extends Dnd5eV5Adapter {
    override readonly generation: number = 6;

    constructor(foundry: BaseFoundryAdapter) {
        super(foundry);
    }

    /**
     * Inspects whether an actor's ability data indicates proficiency in an ability check in D&D 5e v6+.
     * Evaluates modern `check.prof` directly with zero deprecated property access.
     * @param {Dnd5eAbility} [ablData] Ability data object from actor.system.abilities
     * @returns {boolean}
     */
    override isAbilityCheckProficient(ablData: Dnd5eAbility | undefined): boolean {
        if (!ablData) return false;
        const check = ablData.check;
        if (check?.prof !== undefined) {
            return Boolean(check.prof);
        }
        return Boolean(check?.proficient);
    }

    /**
     * Inspects whether an actor's ability data indicates proficiency in an ability saving throw in D&D 5e v6+.
     * Evaluates modern `save.prof` directly with zero deprecated property access.
     * @param {Dnd5eAbility} [ablData] Ability data object from actor.system.abilities
     * @returns {boolean}
     */
    override isAbilitySaveProficient(ablData: Dnd5eAbility | undefined): boolean {
        if (!ablData) return false;
        const rawSave = ablData.save;
        if (typeof rawSave === 'object' && rawSave !== null && 'prof' in rawSave) {
            return Boolean((rawSave as { prof?: number | boolean }).prof);
        }
        if (typeof rawSave === 'object' && rawSave !== null && 'proficient' in rawSave) {
            return Boolean(rawSave.proficient);
        }
        return Boolean(ablData.proficient);
    }
}
