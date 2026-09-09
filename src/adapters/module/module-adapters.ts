import { MidiQolModuleAdapter } from './midi-qol-module-adapter.js';
import { deepFreeze } from '../../lib/utils.js';

/**
 * Registry of module adapters. 
 * Maps module IDs to their corresponding adapter classes.
 */
export const MODULE_ADAPTERS = deepFreeze({
    'midi-qol': MidiQolModuleAdapter
});