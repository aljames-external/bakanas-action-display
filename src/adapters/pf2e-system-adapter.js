import { BaseSystemAdapter } from './base-system-adapter.js';

/**
 * System adapter for Pathfinder 2nd Edition (PF2e).
 * Extracts Strikes (attacks), Actions/Feats, and Spells, mapping them to the unified Action structure.
 */
export class Pf2eSystemAdapter extends BaseSystemAdapter {
    constructor() {
        super('pf2e');
    }

    /**
     * Extract and sort actions from a PF2e actor.
     * @param {Actor} actor 
     * @returns {Object[]} Unified action objects
     */
    getActions(actor) {
        if (!actor) return [];

        const actions = [];

        // 1. Extract Strikes (attacks)
        // In PF2e, strikes are dynamically calculated and stored on the actor's system actions
        const strikes = actor.system.actions ?? [];
        for (const strike of strikes) {
            actions.push({
                id: `strike-${strike.slug ?? strike.name}`,
                name: strike.label ?? strike.name,
                type: 'weapon',
                img: strike.img ?? strike.imageUrl ?? 'systems/pf2e/icons/default-icons/melee.svg',
                activationType: 'action', // Strikes cost 1 action in PF2e
                roll: (event) => {
                    // Roll the first variant (MAP 0) by default. Passes the click event.
                    if (strike.variants?.[0]?.roll) {
                        strike.variants[0].roll({ event });
                    } else if (typeof strike.roll === 'function') {
                        strike.roll({ event });
                    }
                },
                originalItem: strike.item,
                uses: { available: null, max: null },
                extra: { pf2eStrike: strike }
            });
        }

        // 2. Extract Feats and Actions
        // In PF2e, these are items of type 'action' or 'feat' in actor.items
        for (const item of actor.items) {
            if (['action', 'feat'].includes(item.type)) {
                const actionCost = item.system.actionCost;
                const activationType = this._parseActivationType(actionCost);

                // Skip passive feats/actions that don't have an activation cost
                if (!activationType) continue;

                actions.push({
                    id: item.id,
                    name: item.name,
                    type: 'feat',
                    img: item.img,
                    activationType: activationType,
                    roll: (event) => {
                        // In PF2e, using an action/feat typically posts its chat card to the chat log
                        if (typeof item.toMessage === 'function') {
                            item.toMessage();
                        } else if (typeof item.use === 'function') {
                            item.use({ event });
                        }
                    },
                    originalItem: item,
                    uses: this._calculateUses(item),
                    extra: {}
                });
            }
        }

        // 3. Extract Spells
        // PF2e spells are cast from spellcasting entries (prepared, spontaneous, focus, etc.)
        const spellcastingEntries = actor.spellcasting ?? [];
        for (const entry of spellcastingEntries) {
            if (!entry.spells) continue;

            for (const spell of entry.spells) {
                actions.push({
                    id: spell.id,
                    name: `${spell.name} (${entry.name})`,
                    type: 'spell',
                    img: spell.img,
                    activationType: 'action', // Spells are active actions
                    roll: (event) => {
                        if (typeof entry.cast === 'function') {
                            entry.cast(spell, { event });
                        } else if (typeof spell.toMessage === 'function') {
                            spell.toMessage();
                        }
                    },
                    originalItem: spell,
                    uses: this._calculateSpellUses(entry, spell),
                    extra: { pf2eSpellcastingEntry: entry }
                });
            }
        }

        // Sort actions: activation type first, then item type, then name
        return actions.sort((a, b) => {
            const actSort = this._getActivationSort(a.activationType) - this._getActivationSort(b.activationType);
            if (actSort !== 0) return actSort;

            const typeSort = this._getTypeSort(a.type) - this._getTypeSort(b.type);
            if (typeSort !== 0) return typeSort;

            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Translate PF2e action cost structures into our core activation types.
     */
    _parseActivationType(actionCost) {
        if (!actionCost) return null;
        const type = actionCost.type; // 'action', 'reaction', 'free', etc.

        if (type === 'reaction') return 'reaction';
        if (type === 'free') return 'other'; // Map free actions to 'other'
        if (type === 'action') return 'action'; // Group 1, 2, or 3 actions under 'action'
        
        return null;
    }

    _getActivationSort(type) {
        const order = {
            'action': 1,
            'bonus': 2,
            'reaction': 3,
            'legendary': 4,
            'lair': 5,
            'crew': 6,
            'special': 7,
            'other': 8
        };
        return order[type] ?? 99;
    }

    _getTypeSort(type) {
        const order = {
            'weapon': 1,
            'equipment': 2,
            'consumable': 3,
            'feat': 4,
            'spell': 5,
            'other': 6
        };
        return order[type] ?? 99;
    }

    /**
     * Calculate frequency limits (uses) for PF2e actions/feats.
     */
    _calculateUses(item) {
        const frequency = item.system.frequency;
        if (frequency) {
            return {
                available: frequency.value ?? 0,
                max: frequency.max ?? 0
            };
        }
        return { available: null, max: null };
    }

    /**
     * Calculate spell slot / focus pool uses for PF2e spells.
     */
    _calculateSpellUses(entry, spell) {
        // Focus spells consume the actor's focus pool
        if (entry.isFocusPool) {
            const focus = entry.actor?.system?.resources?.focus;
            return {
                available: focus?.value ?? 0,
                max: focus?.max ?? 0
            };
        }

        // Spontaneous casting consumes slots per level
        const level = spell.level;
        if (entry.isSpontaneous && level > 0) {
            const slot = entry.system.slots?.[`slot${level}`];
            return {
                available: slot?.value ?? 0,
                max: slot?.max ?? 0
            };
        }

        // Prepared spellcasting is slot-specific (expended vs active).
        // For a first pass, we return null and can expand on prepared slot tracking later.
        return { available: null, max: null };
    }
}
