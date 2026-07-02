import { FantasySystemAdapter } from './genre/fantasy-system-adapter.js';
import { localize } from '../../lib/utils.js';
import { TabRef } from '../../ui/tab-ref.js';

const SORT_ORDERS = {
    tabs: {
        'economy': {
            'all': 0, 'action': 1, 'reaction': 2, 'free': 3, 'other': 4
        }
    },
    item_type: {
        'weapon': 1,
        'equipment': 2,
        'consumable': 3,
        'feat': 4,
        'spell': 5,
        'other': 6
    }
};

/**
 * System adapter for Pathfinder 2nd Edition (PF2e).
 * Modifies the base actions list by mapping feats and spells, and injecting Strikes (attacks).
 */
export class Pf2eSystemAdapter extends FantasySystemAdapter {
    constructor() {
        super('pf2e');
    }

    /**
     * Determine if a specific item should be extracted as a base action for PF2e.
     * Prevents allocating objects for unhandled item types (like equipment/consumables).
     */
    shouldExtractItem(item) {
        return item.type === 'action' || item.type === 'feat' || item.type === 'spell';
    }

    /**
     * Filter, map, inject, and sort actions for PF2e.
     * @param {Object[]} actions Base action list from the core
     * @param {Actor} actor 
     * @returns {Object[]} The modified actions list
     */
    modifyActions(actions, actor) {
        const modified = [];

        // Pre-calculate ammunition quantities by baseItem in a single pass to avoid nested loops (O(I) complexity)
        const ammoQuantities = new Map();
        for (const i of actor.items) {
            const { baseItem, quantity } = this.getAmmoInfo(i);
            if (baseItem) {
                ammoQuantities.set(baseItem, (ammoQuantities.get(baseItem) ?? 0) + quantity);
            }
        }

        // Pre-calculate a map of spell ID to spellcasting entry to avoid nested searches in the loop (O(1) lookups)
        const spellToEntryMap = new Map();
        const entries = this.getSpellcastingEntries(actor);
        for (const entry of entries) {
            const spells = entry.spells ?? [];
            for (const spell of spells) {
                spellToEntryMap.set(spell.id, entry);
            }
        }

        // 1. Process existing items (Feats, Actions, Spells)
        for (const action of actions) {
            const item = action.originalItem;
            const type = item.type;

            if (['action', 'feat'].includes(type)) {
                const activationType = this.getActionType(item);

                // Skip passive feats/actions that don't have an active cost
                if (!activationType) continue;

                const econRoot = new TabRef({ label: 'economy' });
                action.activationType = activationType; // Keep for sorting
                action.tabs = [new TabRef({ label: activationType, parent: econRoot })];
                action.itemTypes = [type === 'action' ? 'feat' : type];
                action.uses = this.getUses(item);

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
                // Find the spellcasting entry this spell belongs to (O(1) lookup)
                const entry = spellToEntryMap.get(item.id);
                if (!entry) continue;

                const spellLevel = item.rank ?? 0;
                const econRoot = new TabRef({ label: 'economy' });
                action.tabs = [new TabRef({ label: 'action', parent: econRoot })]; // Spells are active actions
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
                action.uses = this.getSpellUses(entry, item);
                action.name = `${item.name} (${entry.name})`;

                modified.push(action);
            }
        }

        // 2. Inject Strikes (attacks)
        // Strikes are dynamically calculated on the actor and are not standard inventory items
        const strikes = this.getActorStrikes(actor);
        for (const strike of strikes) {
            const uses = this.getStrikeAmmoUses(strike, ammoQuantities);

            modified.push({
                id: `strike-${strike.slug ?? strike.name}`,
                name: strike.label ?? strike.name,
                type: 'weapon',
                img: strike.item?.img ?? strike.img ?? strike.imageUrl ?? 'systems/pf2e/icons/default-icons/melee.svg',
                activationType: 'action', // Strikes cost 1 action
                tabs: [new TabRef({ label: 'action', parent: new TabRef({ label: 'economy' }) })],
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
        return super.modifyActions(modified, actor);
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
        return labels[parentId] ?? super.getItemTypeLabel(parentId);
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
            'economy': localize('BAD.common.actionEconomy', 'Action Economy')
        };
        return labels[parentId] ?? super.getActionTypeLabel(parentId);
    }

    getItemTypeSortOrder(parentId) {
        return SORT_ORDERS.item_type[parentId] ?? super.getItemTypeSortOrder(parentId);
    }

    getActionSubTabSortOrder(parentId, subId) {
        return SORT_ORDERS.tabs[parentId]?.[subId] ?? super.getActionSubTabSortOrder(parentId, subId);
    }

    /**
     * Get the CSS icon class for a right-side action type (parent tab) in PF2e.
     */
    getActionTypeIcon(parentId) {
        const icons = {
            'all': 'fas fa-border-all',
            'economy': 'fas fa-stopwatch'
        };
        return icons[parentId] ?? super.getActionTypeIcon(parentId);
    }

    /**
     * Get the localized label for a right-side action sub-tab in PF2e.
     */
    getActionSubTabLabel(subId) {
        const labels = {
            'all': localize('BAD.hud.allActions', 'All Actions'),
            'action': localize('PF2E.TabActionsLabel', 'Actions'),
            'reaction': localize('PF2E.ActionsReactionsHeader', 'Reactions'),
            'other': localize('PF2E.ActionsFreeActionsHeader', 'Free Actions')
        };
        return labels[subId] ?? super.getActionSubTabLabel(subId);
    }

    /**
     * Modify the rendering context before it is sent to the template.
     * Used here to sort the spell sub-tabs (Cantrips, Ranks 1-10, Focus, Innate, Rituals) in the correct order.
     */
    modifyContext(context, app) {
        super.modifyContext?.(context, app);
        
        const spellGroup = context.itemTypes?.find(g => g.id === 'spell');
        if (spellGroup && spellGroup.subTabs.length > 0) {
            const orderMap = new Map(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'focus', 'innate', 'ritual'].map((id, i) => [id, i]));
            spellGroup.subTabs.sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
        }
    }

    /* ------------------------------------------------------------------------- */
    /*  System Data Structure Accessors / Schema Extraction Helpers              */
    /* ------------------------------------------------------------------------- */

    /**
     * Extract ammunition quantity and base item ID from a PF2e item.
     * @param {Item} item
     * @returns {{ baseItem: string|undefined, quantity: number }}
     */
    getAmmoInfo(item) {
        if (item.type !== 'ammo') return { baseItem: undefined, quantity: 0 };
        return {
            baseItem: item.system.baseItem,
            quantity: item.system.quantity ?? 0
        };
    }

    /**
     * Translate PF2e action cost structures into core activation types.
     * @param {Item} item
     * @returns {string|null}
     */
    getActionType(item) {
        const typeMap = { 'reaction': 'reaction', 'free': 'other', 'action': 'action' };
        return typeMap[item.system.actionType?.value] ?? null;
    }

    /**
     * Get spellcasting entries from a PF2e Actor.
     * @param {Actor} actor
     * @returns {Object[]}
     */
    getSpellcastingEntries(actor) {
        return actor.spellcasting ?? [];
    }

    /**
     * Get Strikes (attacks) registered on a PF2e Actor.
     * @param {Actor} actor
     * @returns {Object[]}
     */
    getActorStrikes(actor) {
        return actor.system.actions ?? [];
    }

    /**
     * Calculate frequency limits (uses) for PF2e actions/feats.
     * @param {Item} item
     * @returns {{ available: number|null, max: number|null }}
     */
    getUses(item) {
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
     * @param {Object} entry Spellcasting entry
     * @param {Item} spell Spell item
     * @returns {{ available: number|null, max: number|null }}
     */
    getSpellUses(entry, spell) {
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
     * Calculate remaining ammunition for a PF2e Strike.
     * @param {Object} strike PF2e strike object
     * @param {Map<string, number>} ammoQuantities
     * @returns {{ available: number|null, max: number|null }}
     */
    getStrikeAmmoUses(strike, ammoQuantities) {
        const weapon = strike.item;
        if (!weapon || weapon.type !== 'weapon') return { available: null, max: null };

        const ammoConfig = weapon.system.ammo;
        if (ammoConfig && ammoConfig.baseType) {
            const baseType = ammoConfig.baseType;
            const quantity = ammoQuantities.get(baseType) ?? 0;

            return {
                available: quantity,
                max: null
            };
        }

        return { available: null, max: null };
    }
}
