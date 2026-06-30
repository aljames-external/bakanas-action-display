import { FantasySystemAdapter } from './genre/fantasy-system-adapter.js';
import { localize } from '../../lib/utils.js';

/**
 * System adapter for Pathfinder 2nd Edition (PF2e).
 * Modifies the base actions list by mapping feats and spells, and injecting Strikes (attacks).
 */
export class Pf2eSystemAdapter extends FantasySystemAdapter {
    constructor() {
        super('pf2e');
    }

    /**
     * Filter, map, inject, and sort actions for PF2e.
     * @param {Object[]} actions Base action list from the core
     * @param {Actor} actor 
     * @returns {Object[]} The modified actions list
     */
    modifyActions(actions, actor) {
        const modified = [];

        // 1. Process existing items (Feats, Actions, Spells)
        for (const action of actions) {
            const item = action.originalItem;

            if (['action', 'feat'].includes(item.type)) {
                const actionType = item.system.actionType;
                const activationType = this._parseActivationType(actionType);

                // Skip passive feats/actions that don't have an active cost
                if (!activationType) continue;

                action.activationType = activationType; // Keep for sorting
                action.tabs = [activationType];
                action.itemTypes = [item.type === 'action' ? 'feat' : item.type];
                action.uses = this._calculateUses(item);

                // Override roll to post the action's chat card (standard PF2e behavior)
                action.roll = (event) => {
                    if (typeof item.toMessage === 'function') {
                        item.toMessage();
                    } else if (typeof item.use === 'function') {
                        item.use({ event });
                    }
                };

                modified.push(action);
            } else if (item.type === 'spell') {
                // Find the spellcasting entry this spell belongs to
                const entry = actor.spellcasting?.find(e => e.spells?.has(item.id));
                if (!entry) continue;

                const spellLevel = item.rank ?? 0;
                action.tabs = ['action']; // Spells are active actions
                action.activationType = 'action';
                
                let subTab = spellLevel.toString();
                if (entry.isFocusPool) {
                    subTab = 'focus';
                } else if (entry.isInnate) {
                    subTab = 'innate';
                } else if (entry.isRitual) {
                    subTab = 'ritual';
                } else if (spellLevel === 0) {
                    subTab = '0';
                }
                action.itemTypes = ['spell', subTab];
                action.roll = (event) => {
                    if (typeof entry.cast === 'function') {
                        entry.cast(item, { event });
                    } else if (typeof item.toMessage === 'function') {
                        item.toMessage();
                    }
                };
                action.uses = this._calculateSpellUses(entry, item);
                action.name = `${item.name} (${entry.name})`;

                modified.push(action);
            }
        }

        // 2. Inject Strikes (attacks)
        // Strikes are dynamically calculated on the actor and are not standard inventory items
        const strikes = actor.system.actions ?? [];
        for (const strike of strikes) {
            const uses = this._calculateStrikeAmmo(strike, actor);

            modified.push({
                id: `strike-${strike.slug ?? strike.name}`,
                name: strike.label ?? strike.name,
                type: 'weapon',
                img: strike.item?.img ?? strike.img ?? strike.imageUrl ?? 'systems/pf2e/icons/default-icons/melee.svg',
                activationType: 'action', // Strikes cost 1 action
                tabs: ['action'],
                itemTypes: ['weapon'],
                hidden: false,
                uses: uses, // Display remaining ammunition
                roll: (event) => {
                    if (strike.variants?.[0]?.roll) {
                        strike.variants[0].roll({ event });
                    } else if (typeof strike.roll === 'function') {
                        strike.roll({ event });
                    }
                },
                originalItem: strike.item, // Reference to the weapon item if available
                extra: { pf2eStrike: strike }
            });
        }

        // 3. Apply default resource filtering (e.g. hiding depleted actions)
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
     * Translate PF2e action cost structures into our core activation types.
     */
    _parseActivationType(actionType) {
        if (!actionType) return null;
        const value = actionType.value;

        if (value === 'reaction') return 'reaction';
        if (value === 'free') return 'other'; // Map free actions to 'other'
        if (value === 'action') return 'action'; // Group 1, 2, or 3 actions under 'action'
        
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
        if (entry.isFocusPool) {
            const focus = entry.actor?.system?.resources?.focus;
            return {
                available: focus?.value ?? 0,
                max: focus?.max ?? 0
            };
        }

        const level = spell.rank ?? 0;
        if (entry.isSpontaneous && level > 0) {
            const slot = entry.system.slots?.[`slot${level}`];
            return {
                available: slot?.value ?? 0,
                max: slot?.max ?? 0
            };
        }

        return { available: null, max: null };
    }

    /**
     * Get the localized label for a left-side item type (parent tab) in PF2e.
     */
    getItemTypeLabel(parentId) {
        const labels = {
            'feat': localize('PF2E.Item.Feat.Plural', 'Feats'),
            'spell': localize('PF2E.Item.Spell.Plural', 'Spells'),
            'weapon': localize('PF2E.TraitWeapons', 'Weapons')
        };
        return labels[parentId] || super.getItemTypeLabel(parentId);
    }

    /**
     * Get the localized label for a left-side item sub-tab (spell rank) in PF2e.
     */
    getItemSubTabLabel(parentId, subId) {
        if (parentId === 'spell') {
            if (subId === 'focus') {
                return localize('PF2E.Focus.Spells', 'Focus Spells');
            }
            if (subId === 'innate') {
                return localize('PF2E.PreparationTypeInnate', 'Innate Spells');
            }
            if (subId === 'ritual') {
                return localize('PF2E.Actor.Character.Spellcasting.Tab.Rituals', 'Rituals');
            }
            if (subId === '0') {
                return localize('PF2E.TraitCantrip', 'Cantrip');
            }

            const key = `PF2E.Item.Spell.Rank.${subId}`;
            return localize(key, `${subId} Rank`);
        }
        return super.getItemSubTabLabel(parentId, subId);
    }


    /**
     * Get the localized label for a right-side action type (parent tab) in PF2e.
     */
    getActionTypeLabel(parentId) {
        const labels = {
            'action': localize('PF2E.TabActionsLabel', 'Actions'),
            'reaction': localize('PF2E.ActionsReactionsHeader', 'Reactions'),
            'other': localize('PF2E.ActionsFreeActionsHeader', 'Free Actions')
        };
        return labels[parentId] || super.getActionTypeLabel(parentId);
    }

    /**
     * Get the CSS icon class for a right-side action type (parent tab) in PF2e.
     */
    getActionTypeIcon(parentId) {
        const icons = {
            'all': 'fas fa-border-all',
            'action': 'fas fa-bolt',
            'reaction': 'fas fa-shield-halved',
            'other': 'fas fa-wind'
        };
        return icons[parentId] || super.getActionTypeIcon(parentId);
    }

    /**
     * Calculate remaining ammunition for a PF2e Strike.
     * @private
     */
    _calculateStrikeAmmo(strike, actor) {
        const weapon = strike.item;
        if (!weapon || weapon.type !== 'weapon') return { available: null, max: null };

        const ammoConfig = weapon.system.ammo;
        if (ammoConfig && ammoConfig.baseType) {
            // This ranged weapon requires ammunition!
            const baseType = ammoConfig.baseType;

            // Find all ammunition items in the actor's inventory matching this baseType
            const ammoItems = actor.items.filter(i => i.type === 'ammo' && i.system.baseItem === baseType);

            // Sum their quantities
            let totalQuantity = 0;
            for (const ammoItem of ammoItems) {
                totalQuantity += ammoItem.system.quantity ?? 0;
            }

            return {
                available: totalQuantity,
                max: null
            };
        }

        return { available: null, max: null };
    }


}
