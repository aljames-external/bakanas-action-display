import { BaseSystemAdapter } from './base-system-adapter.js';

/**
 * System adapter for Pathfinder 1st Edition (PF1e).
 * Handles PF1e's multi-action items, prepared/spontaneous spellcasting, and toggleable buffs.
 */
export class Pf1SystemAdapter extends BaseSystemAdapter {
    constructor() {
        super('pf1');
    }

    /**
     * Filter, map, and sort actions for PF1e.
     * @param {Object[]} actions Base action list from the core
     * @param {Actor} actor 
     * @returns {Object[]} The modified actions list
     */
    modifyActions(actions, actor) {
        const modified = [];

        for (const action of actions) {
            const item = action.originalItem;

            if (item.type === 'spell') {
                // 1. Spells in PF1e
                const spellbookId = item.system.spellbook ?? 'primary';
                const spellbook = actor.system.attributes?.spells?.spellbooks?.[spellbookId];
                if (!spellbook) continue;

                // Spells are active actions
                action.tabs = ['action'];
                action.activationType = 'action';
                
                const level = item.system.level ?? 0;
                action.itemTypes = ['spell', level.toString()];
                
                // Calculate uses (slots or prepared casts)
                action.uses = this._calculateSpellUses(spellbook, item, actor);
                
                // Roll function
                action.roll = (event) => {
                    if (typeof item.use === 'function') {
                        item.use({ event });
                    } else if (typeof item.roll === 'function') {
                        item.roll({ event });
                    }
                };

                modified.push(action);
            } else if (['attack', 'weapon', 'consumable', 'feat'].includes(item.type)) {
                // 2. Items with actions (Attacks, Weapons, Consumables, Feats)
                const itemActions = item.system.actions ?? [];
                if (itemActions.length === 0) continue; // Skip passive items/feats

                // Resolve uses/charges
                const uses = this._calculateUses(item);

                // Map actions to sub-actions
                // In PF1e, if an item has multiple actions, we map them all
                // If it has only 1, we still map it to subActions for consistency, 
                // but the UI will roll it directly if there's only 1.
                action.subActions = itemActions.map(act => {
                    // Determine activation type for this sub-action
                    const actType = act.activation?.type;
                    const activationType = this._parseActivationType(actType);
                    
                    return {
                        id: act._id,
                        name: act.name || item.name,
                        img: item.img,
                        activationType: activationType,
                        tabs: [activationType],
                        uses: uses, // Sub-actions share the parent item's uses
                        roll: (event) => {
                            if (typeof item.use === 'function') {
                                item.use({ actionId: act._id, event });
                            } else if (typeof item.roll === 'function') {
                                item.roll({ actionId: act._id, event });
                            }
                        }
                    };
                });

                // Filter out sub-actions that don't have a valid activation type (passive/non-actions)
                // If all sub-actions are passive/invalid, we skip the item.
                action.subActions = action.subActions.filter(sub => sub.activationType !== null);
                if (action.subActions.length === 0) continue;

                // Set parent properties based on the first sub-action
                const firstSub = action.subActions[0];
                action.activationType = firstSub.activationType;
                action.tabs = [firstSub.activationType];
                
                // Determine item type category for left tab
                if (item.type === 'feat') {
                    action.itemTypes = ['feat'];
                } else if (item.type === 'consumable') {
                    action.itemTypes = ['consumable'];
                } else {
                    action.itemTypes = ['weapon']; // attack or weapon
                }
                
                action.uses = uses;
                modified.push(action);
            } else if (item.type === 'buff') {
                // 3. Buffs in PF1e: toggleable passive/active effects
                action.tabs = ['other'];
                action.activationType = 'other';
                action.itemTypes = ['buff'];
                
                // Clicking toggles the buff active state
                action.roll = async (event) => {
                    const active = item.system.active;
                    await item.update({ "system.active": !active });
                };
                
                // Represent active state in the uses badge: 1/1 if active, 0/1 if inactive
                action.uses = {
                    available: item.system.active ? 1 : 0,
                    max: 1
                };

                modified.push(action);
            }
        }

        // Apply default resource filtering (e.g. hiding depleted actions)
        const filtered = super.modifyActions(modified, actor);

        // Sort actions: activation type first, then item type, then name
        return filtered.sort((a, b) => {
            const actSort = this._getActivationSort(a.activationType ?? a.tabs[0]) - this._getActivationSort(b.activationType ?? b.tabs[0]);
            if (actSort !== 0) return actSort;

            const typeSort = this._getTypeSort(a.type) - this._getTypeSort(b.type);
            if (typeSort !== 0) return typeSort;

            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Translate PF1e activation types into our core activation types.
     * Maps Swift -> bonus, Immediate -> reaction, Free/Nonaction -> other.
     */
    _parseActivationType(actType) {
        if (!actType) return null;

        const type = actType.toLowerCase();
        if (['standard', 'attack'].includes(type)) return 'action';
        if (type === 'swift') return 'bonus'; // Map Swift to 'bonus'
        if (type === 'immediate') return 'reaction'; // Map Immediate to 'reaction'
        if (['free', 'nonaction'].includes(type)) return 'other'; // Map Free/Non-action to 'other'
        
        return null; // Passive or other unhandled types are ignored
    }

    /**
     * Calculate remaining charges/uses for PF1e items.
     */
    _calculateUses(item) {
        const uses = item.system.uses;
        if (uses && (uses.value !== null || uses.max !== null)) {
            // If value is null but max is defined, it means the item is fully charged (available = max)
            const max = uses.max ?? 0;
            return {
                available: uses.value ?? max,
                max: max
            };
        }
        
        // Fallback for consumables: use quantity if uses are not defined
        if (item.type === 'consumable' && item.system.quantity !== undefined) {
            return {
                available: item.system.quantity ?? 0,
                max: null // No max limit, just quantity
            };
        }

        return { available: null, max: null };
    }

    /**
     * Calculate spell slot / prepared uses for PF1e spells.
     */
    _calculateSpellUses(spellbook, spell, actor) {
        const level = spell.system.level ?? 0;
        
        // Cantrips (level 0) have infinite uses
        if (level === 0) {
            return { available: null, max: null };
        }

        // 1. Prepared Spellcasting (Wizard, Cleric, Alchemist, etc.)
        // In PF1e, prepared spells track their remaining casts directly on the spell item!
        if (spellbook.spellPreparationMode === 'prepared') {
            const prep = spell.system.preparation;
            if (prep && prep.max > 0) {
                // If value is null, fall back to max (fully prepared)
                return {
                    available: prep.value ?? prep.max,
                    max: prep.max
                };
            }
            return { available: 0, max: 0 }; // Not prepared
        }

        // 2. Spontaneous Spellcasting (Sorcerer, Bard, etc.)
        // Uses the spellbook's slots for that level on the actor
        const slot = spellbook.spells?.[`spell${level}`];
        if (slot) {
            return {
                available: slot.value ?? 0,
                max: slot.max ?? 0
            };
        }

        return { available: null, max: null };
    }

    /**
     * Get the localized label for a right-side action type (parent tab) in PF1e.
     */
    getActionTypeLabel(parentId) {
        const labels = {
            'all': 'All Actions',
            'action': 'Actions',
            'bonus': 'Swift',
            'reaction': 'Immediate',
            'other': 'Free/Other'
        };
        return labels[parentId] || super.getActionTypeLabel(parentId);
    }

    /**
     * Get the CSS icon class for a right-side action type (parent tab) in PF1e.
     */
    getActionTypeIcon(parentId) {
        const icons = {
            'all': 'fas fa-border-all',
            'action': 'fas fa-bolt',
            'bonus': 'fas fa-gauge-high',
            'reaction': 'fas fa-exclamation',
            'other': 'fas fa-wind'
        };
        return icons[parentId] || super.getActionTypeIcon(parentId);
    }

    /**
     * Sort order for PF1e action types.
     */
    _getActivationSort(type) {
        const order = {
            'action': 1,
            'bonus': 2,
            'reaction': 3,
            'other': 4
        };
        return order[type] ?? 99;
    }
}
