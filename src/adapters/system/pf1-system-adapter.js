import { FantasySystemAdapter } from './genre/fantasy-system-adapter.js';
import { localize } from '../../lib/utils.js';
import { log } from '../../lib/logger.js';
import { TabRef } from '../../ui/tab-ref.js';

// Static sort order maps to prevent allocations during sorting
const ACTIVATION_SORT_ORDER = {
    'action': 1,
    'bonus': 2,
    'reaction': 3,
    'other': 4
};

const TYPE_SORT_ORDER = {
    'weapon': 1,
    'attack': 1,
    'spell': 2,
    'feat': 3,
    'buff': 4,
    'consumable': 5
};

/**
 * System adapter for Pathfinder 1st Edition (PF1e).
 * Handles PF1e's multi-action items, prepared/spontaneous spellcasting, and toggleable buffs.
 */
export class Pf1SystemAdapter extends FantasySystemAdapter {
    constructor() {
        super('pf1');
    }

    /**
     * Determine if a specific item should be extracted as a base action for PF1e.
     * Prevents allocating objects for unhandled item types (like equipment/containers).
     */
    shouldExtractItem(item) {
        const type = item.type;
        return ['spell', 'attack', 'weapon', 'consumable', 'feat', 'buff'].includes(type);
    }

    /**
     * Filter, map, and sort actions for PF1e.
     * @param {Object[]} actions Base action list from the core
     * @param {Actor} actor 
     * @returns {Object[]} The modified actions list
     */
    modifyActions(actions, actor) {
        log.debug(`Pf1SystemAdapter.modifyActions | Starting for actor: ${actor.name}`);
        const modified = [];

        // 1. Build a map of weapon children to their parent weapons
        const attackToWeaponMap = new Map();
        const weaponLinkedAttacks = new Map();
        
        const weapons = actor.items.filter(i => i.type === 'weapon');
        log.debug(`Pf1SystemAdapter.modifyActions | Found ${weapons.length} weapons on actor`);

        for (const weapon of weapons) {
            const children = this.getWeaponLinkChildren(weapon);
            if (children.length > 0) {
                log.debug(`Pf1SystemAdapter.modifyActions | Weapon "${weapon.name}" (${weapon.id}) has ${children.length} children in links:`, children);
            }
            const linked = [];
            for (const child of children) {
                if (!child.uuid) continue;
                
                let childItem = null;
                try {
                    childItem = foundry.utils.fromUuidSync(child.uuid, { relative: actor });
                    if (childItem) {
                        log.debug(`Pf1SystemAdapter.modifyActions | Resolved child via fromUuidSync: "${childItem.name}" (${childItem.id})`);
                    }
                } catch (e) {
                    log.error(`Pf1SystemAdapter.modifyActions | Failed to resolve child UUID ${child.uuid}:`, e);
                }

                if (childItem && childItem.type === 'attack') {
                    attackToWeaponMap.set(childItem.id, weapon);
                    linked.push(childItem);
                } else if (childItem) {
                    log.debug(`Pf1SystemAdapter.modifyActions | Resolved child "${childItem.name}" is not of type 'attack' (type: ${childItem.type})`);
                }
            }
            if (linked.length > 0) {
                weaponLinkedAttacks.set(weapon.id, linked);
                log.debug(`Pf1SystemAdapter.modifyActions | Weapon "${weapon.name}" successfully linked to attacks: ${linked.map(i => i.name).join(', ')}`);
            }
        }

        log.debug(`Pf1SystemAdapter.modifyActions | Final attackToWeaponMap keys (IDs to skip):`, Array.from(attackToWeaponMap.keys()));

        for (const action of actions) {
            const item = action.originalItem;
            const type = item.type;
            log.debug(`Pf1SystemAdapter.modifyActions | Processing action row: "${item.name}" (${type}, ID: ${item.id})`);

            if (item.type === 'spell') {
                // 1. Spells in PF1e
                const spellbookId = item.system.spellbook ?? 'primary';
                const spellbook = this.getSpellbook(actor, spellbookId);
                if (!spellbook) continue;

                const econRoot = new TabRef({ id: 'economy', label: 'Economy' });
                action.tabs = [new TabRef({ id: 'action', label: 'Action', parent: econRoot })];
                action.activationType = 'action';
                
                const level = item.system.level ?? 0;
                let subTab = level.toString();
                if (spellbookId === 'spelllike' || spellbookId === 'sla') {
                    subTab = 'sla';
                } else if (level === 0 && spellbook) {
                    if (spellbook.kind === 'arcane') {
                        subTab = 'cantrip';
                    } else if (spellbook.kind === 'divine') {
                        subTab = 'orison';
                    }
                }
                action.itemTypes = ['spell', subTab];
                
                // Calculate uses (slots or prepared casts)
                action.uses = this._calculateSpellUses(spellbook, item);
                
                // Roll function
                action.roll = (event) => {
                    if (typeof item.use === 'function') {
                        item.use({ event });
                    } else if (typeof item.roll === 'function') {
                        item.roll({ event });
                    }
                };

                modified.push(action);
            } else if (item.type === 'attack') {
                // 2. Attacks in PF1e (if not linked to a weapon)
                if (attackToWeaponMap.has(item.id)) {
                    log.debug(`Pf1SystemAdapter.modifyActions | Skipping attack "${item.name}" (${item.id}) because it is linked to a weapon.`);
                    continue;
                }

                const itemActions = this.getItemActions(item);
                if (itemActions.length === 0) continue;

                const uses = this._calculateUses(item, actor);

                action.activities = itemActions.map(itemAction => {
                    const actionType = itemAction.activation?.type;
                    const activationType = this._parseActivationType(actionType);
                    const parentRef = new TabRef({ id: 'economy', label: 'Economy' });
                    const actionName = itemAction.name ?? item.name;
                    
                    return {
                        id: itemAction._id,
                        name: actionName,
                        img: item.img,
                        activationType: activationType,
                        tabs: new TabRef({ id: activationType, label: activationType, parent: parentRef }),
                        uses: uses,
                        roll: (event) => {
                            if (typeof item.use === 'function') {
                                item.use({ actionId: itemAction._id, event });
                            } else if (typeof item.roll === 'function') {
                                item.roll({ actionId: itemAction._id, event });
                            }
                        }
                    };
                });

                action.activities = action.activities.filter(sub => sub.activationType !== null);
                if (action.activities.length === 0) continue;

                const firstSub = action.activities[0];
                action.activationType = firstSub.activationType;
                action.tabs = [firstSub.tabs];
                action.itemTypes = ['weapon']; // Group under weapons/attacks
                action.uses = uses;
                modified.push(action);

            } else if (item.type === 'weapon') {
                // 3. Weapons (with ammo resolution and linked attacks merging)
                const uses = this._calculateUses(item, actor);
                const linkedAttacks = weaponLinkedAttacks.get(item.id) ?? [];

                let itemActionsList = [];

                if (linkedAttacks.length > 0) {
                    // Merge actions from all linked attack items
                    for (const attackItem of linkedAttacks) {
                        const attackActions = this.getItemActions(attackItem);
                        for (const itemAction of attackActions) {
                            const actionType = itemAction.activation?.type;
                            const activationType = this._parseActivationType(actionType);
                            if (!activationType) continue;

                            const econRoot = new TabRef({ id: 'economy', label: 'Economy' });
                            const actionName = linkedAttacks.length > 1 
                                ? `${attackItem.name}: ${itemAction.name ?? 'Attack'}` 
                                : (itemAction.name ?? attackItem.name);

                            itemActionsList.push({
                                id: itemAction._id,
                                name: actionName,
                                img: attackItem.img ?? item.img,
                                activationType: activationType,
                                tabs: new TabRef({ id: activationType, label: activationType, parent: econRoot }),
                                uses: uses, // Shares weapon's ammunition/charges
                                roll: (event) => {
                                    if (typeof attackItem.use === 'function') {
                                        attackItem.use({ actionId: itemAction._id, event });
                                    } else if (typeof attackItem.roll === 'function') {
                                        attackItem.roll({ actionId: itemAction._id, event });
                                    }
                                }
                            });
                        }
                    }
                } else {
                    // Fallback to the weapon's own actions if no attacks are linked
                    const itemActions = this.getItemActions(item);
                    for (const itemAction of itemActions) {
                        const actionType = itemAction.activation?.type;
                        const activationType = this._parseActivationType(actionType);
                        if (!activationType) continue;

                        const econRoot = new TabRef({ id: 'economy', label: 'Economy' });
                        const actionName = itemAction.name ?? item.name;

                        itemActionsList.push({
                            id: itemAction._id,
                            name: actionName,
                            img: item.img,
                            activationType: activationType,
                            tabs: new TabRef({ id: activationType, label: activationType, parent: econRoot }),
                            uses: uses,
                            roll: (event) => {
                                if (typeof item.use === 'function') {
                                    item.use({ actionId: itemAction._id, event });
                                } else if (typeof item.roll === 'function') {
                                    item.roll({ actionId: itemAction._id, event });
                                }
                            }
                        });
                    }
                }

                if (itemActionsList.length === 0) continue; // Skip if no active actions

                action.activities = itemActionsList;
                const firstSub = itemActionsList[0];
                action.activationType = firstSub.activationType;
                action.tabs = [firstSub.tabs];
                action.itemTypes = ['weapon'];
                action.uses = uses;
                modified.push(action);

            } else if (['consumable', 'feat'].includes(type)) {
                // 4. Consumables and Feats
                const itemActions = item.system.actions ?? [];
                if (itemActions.length === 0) continue;

                const uses = this._calculateUses(item, actor);

                action.activities = itemActions.map(itemAction => {
                    const actionType = itemAction.activation?.type;
                    const activationType = this._parseActivationType(actionType);
                    const econRoot = new TabRef({ id: 'economy', label: 'Economy' });
                    const actionName = itemAction.name ?? item.name;
                    
                    return {
                        id: itemAction._id,
                        name: actionName,
                        img: item.img,
                        activationType: activationType,
                        tabs: new TabRef({ id: activationType, label: activationType, parent: econRoot }),
                        uses: uses,
                        roll: (event) => {
                            if (typeof item.use === 'function') {
                                item.use({ actionId: itemAction._id, event });
                            } else if (typeof item.roll === 'function') {
                                item.roll({ actionId: itemAction._id, event });
                            }
                        }
                    };
                });

                action.activities = action.activities.filter(sub => sub.activationType !== null);
                if (action.activities.length === 0) continue;

                const firstSub = action.activities[0];
                action.activationType = firstSub.activationType;
                action.tabs = [firstSub.tabs];
                action.itemTypes = [item.type];
                action.uses = uses;
                modified.push(action);

            } else if (item.type === 'buff') {
                // 5. Buffs
                const econRoot = new TabRef({ id: 'economy', label: 'Economy' });
                action.tabs = [new TabRef({ id: 'other', label: 'Other', parent: econRoot })];
                action.activationType = 'other';
                action.itemTypes = ['buff'];
                
                action.roll = async (event) => {
                    const active = this.getBuffActiveState(item);
                    await item.update({ "system.active": !active });
                };
                
                action.isActive = this.getBuffActiveState(item);
                action.uses = { available: null, max: null };
                action.excludeFromAll = true; // Exclude buffs from the 'All Items' tab in PF1e

                modified.push(action);
            }
        }

        // Apply default resource filtering (e.g. hiding depleted actions)
        const filtered = super.modifyActions(modified, actor);

        // Sort actions using inherited N-level comparator
        return filtered.sort((a, b) => this.sortActions(a, b));
    }

    /**
     * Modify the rendering context before it is sent to the template.
     * Used here to sort the spell sub-tabs (Cantrips, Orisons, Levels, SLAs) in the correct order.
     */
    modifyContext(context, app) {
        super.modifyContext?.(context, app);
        
        const spellGroup = context.itemTypes?.find(g => g.id === 'spell');
        if (spellGroup && spellGroup.subTabs.length > 0) {
            const orderMap = new Map(['cantrip', 'orison', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'sla'].map((id, i) => [id, i]));
            spellGroup.subTabs.sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
        }
    }

    /**
     * Get the localized label for a right-side action type (parent tab) in PF1e.
     */
    getActionTypeLabel(parentId) {
        const labels = {
            'economy': localize('BAD.common.actionEconomy', 'Action Economy')
        };
        return labels[parentId] ?? super.getActionTypeLabel(parentId);
    }

    /**
     * Get the CSS icon class for a right-side action type (parent tab) in PF1e.
     */
    getActionTypeIcon(parentId) {
        const icons = {
            'all': 'fas fa-border-all',
            'economy': 'fas fa-stopwatch'
        };
        return icons[parentId] ?? super.getActionTypeIcon(parentId);
    }

    /**
     * Get the localized label for a right-side action sub-tab in PF1e.
     */
    getActionSubTabLabel(subId) {
        const labels = {
            'all': localize('BAD.hud.allActions', 'All Actions'),
            'action': localize('PF1.Activation.action.Plural', 'Actions'),
            'bonus': localize('PF1.Activation.swift.Single', 'Swift'),
            'reaction': localize('PF1.Activation.immediate.Single', 'Immediate'),
            'other': localize('PF1.Activation.free.Single', 'Free')
        };
        return labels[subId] ?? super.getActionSubTabLabel(subId);
    }

    /**
     * Get the localized label for a left-side item type (parent tab) in PF1e.
     */
    getItemTypeLabel(parentId) {
        const labels = {
            'weapon': localize('PF1.InventoryWeapons', 'Weapons'),
            'spell': localize('PF1.Spells', 'Spells'),
            'feat': localize('PF1.Feats', 'Feats'),
            'buff': localize('PF1.Buffs', 'Buffs'),
            'consumable': localize('PF1.InventoryConsumables', 'Consumables')
        };
        return labels[parentId] ?? super.getItemTypeLabel(parentId);
    }

    /**
     * Get the localized label for a left-side item sub-tab (spell level/spellbook) in PF1e.
     */
    getItemSubTabLabel(parentId, subId) {
        if (parentId === 'spell') {
            if (subId === 'sla') {
                return localize('PF1.SpellBookSpelllike', 'Spell-like');
            }
            if (subId === 'cantrip') {
                return localize('PF1.Cantrip', localize('PF1.Cantrips', 'Cantrips'));
            }
            if (subId === 'orison') {
                return localize('PF1.Orison', localize('PF1.Orisons', 'Orisons'));
            }
            const key = `PF1.SpellLevels.${subId}`;
            return localize(key, `${subId} Level`);
        }
        return super.getItemSubTabLabel(parentId, subId);
    }

    /**
     * Get the CSS icon class for a left-side item type (parent tab) in PF1e.
     */
    getItemTypeIcon(parentId) {
        const icons = {
            'buff': 'fas fa-sparkles'
        };
        return icons[parentId] ?? super.getItemTypeIcon(parentId);
    }

    /**
     * Sort order for PF1e action types.
     */
    _getActivationSort(type) {
        return ACTIVATION_SORT_ORDER[type] ?? 99;
    }

    _getTypeSort(type) {
        return TYPE_SORT_ORDER[type] ?? 99;
    }

    /* ------------------------------------------------------------------------- */
    /*  System Data Structure Accessors / Schema Extraction Helpers              */
    /* ------------------------------------------------------------------------- */

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
     * Extract weapon link children for a PF1e weapon item.
     * @param {Item} weapon
     * @returns {Object[]} Link children objects
     */
    getWeaponLinkChildren(weapon) {
        return weapon.system.links?.children ?? [];
    }

    /**
     * Get a spellbook from a PF1e Actor by ID.
     * @param {Actor} actor
     * @param {string} spellbookId
     * @returns {Object|undefined}
     */
    getSpellbook(actor, spellbookId) {
        return actor.system.attributes?.spells?.spellbooks?.[spellbookId];
    }

    /**
     * Extract sub-actions attached to a PF1e item or attack.
     * @param {Item} item
     * @returns {Object[]} Sub-action objects
     */
    getItemActions(item) {
        return item.system.actions ?? [];
    }

    /**
     * Extract active state of a PF1e Buff item.
     * @param {Item} item
     * @returns {boolean}
     */
    getBuffActiveState(item) {
        return item.system.active ?? false;
    }

    /**
     * Calculate remaining charges/uses for PF1e items.
     */
    _calculateUses(item, actor) {
        // 1. Ranged weapon ammunition tracking
        if (item.type === 'weapon' && item.system.weaponSubtype === 'ranged') {
            const ammoType = item.system.ammo?.type;
            if (ammoType) {
                // This weapon requires ammunition!
                const ammoId = item.system.ammo?.default;
                let quantity = 0;
                
                if (ammoId && actor) {
                    const ammoItem = actor.items.get(ammoId);
                    if (ammoItem) {
                        quantity = ammoItem.system.quantity ?? 0;
                    }
                }
                
                return {
                    available: quantity,
                    max: null
                };
            }
        }

        // 2. Standard charges/uses
        const uses = item.system.uses;
        
        // Check if it has actual charges/uses (max > 0 or value > 0)
        const hasMax = (uses?.max ?? 0) > 0;
        const hasValue = (uses?.value ?? 0) > 0;
        
        if (hasMax || hasValue) {
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
                max: null
            };
        }

        return { available: null, max: null };
    }

    /**
     * Calculate spell slot / prepared uses for PF1e spells.
     */
    _calculateSpellUses(spellbook, spell) {
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
}
