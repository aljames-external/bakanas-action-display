import { FantasySystemAdapter } from './genre/fantasy-system-adapter.js';
import { localize } from '../../lib/utils.js';
import { log } from '../../lib/logger.js';

/**
 * System adapter for Pathfinder 1st Edition (PF1e).
 * Handles PF1e's multi-action items, prepared/spontaneous spellcasting, and toggleable buffs.
 */
export class Pf1SystemAdapter extends FantasySystemAdapter {
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
        log.debug(`Pf1SystemAdapter.modifyActions | Starting for actor: ${actor.name}`);
        const modified = [];

        // 1. Build a map of weapon children to their parent weapons
        const attackToWeaponMap = new Map();
        const weaponLinkedAttacks = new Map();
        
        const weapons = actor.items.filter(i => i.type === 'weapon');
        log.debug(`Pf1SystemAdapter.modifyActions | Found ${weapons.length} weapons on actor`);

        for (const weapon of weapons) {
            const children = weapon.system.links?.children ?? [];
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
            log.debug(`Pf1SystemAdapter.modifyActions | Processing action row: "${item.name}" (${item.type}, ID: ${item.id})`);

            if (item.type === 'spell') {
                // 1. Spells in PF1e
                const spellbookId = item.system.spellbook ?? 'primary';
                const spellbook = actor.system.attributes?.spells?.spellbooks?.[spellbookId];
                if (!spellbook) continue;

                // Spells are active actions
                action.tabs = ['action'];
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
            } else if (item.type === 'attack') {
                // 2. Standalone Attacks (only if NOT linked to a weapon, e.g. Touch/Claws)
                log.debug(`Pf1SystemAdapter.modifyActions | Checking attack item: "${item.name}" (ID: ${item.id})`);
                if (attackToWeaponMap.has(item.id)) {
                    log.debug(`Pf1SystemAdapter.modifyActions | >>> SKIPPING attack "${item.name}" (ID: ${item.id}) because it is merged into weapon: "${attackToWeaponMap.get(item.id).name}"`);
                    continue;
                }
                log.debug(`Pf1SystemAdapter.modifyActions | >>> KEEPING standalone attack: "${item.name}" (ID: ${item.id})`);

                const itemActions = item.system.actions ?? [];
                if (itemActions.length === 0) continue;

                const uses = this._calculateUses(item, actor);

                action.subActions = itemActions.map(act => {
                    const actType = act.activation?.type;
                    const activationType = this._parseActivationType(actType);
                    
                    return {
                        id: act._id,
                        name: act.name || item.name,
                        img: item.img,
                        activationType: activationType,
                        tabs: [activationType],
                        uses: uses,
                        roll: (event) => {
                            if (typeof item.use === 'function') {
                                item.use({ actionId: act._id, event });
                            } else if (typeof item.roll === 'function') {
                                item.roll({ actionId: act._id, event });
                            }
                        }
                    };
                });

                action.subActions = action.subActions.filter(sub => sub.activationType !== null);
                if (action.subActions.length === 0) continue;

                const firstSub = action.subActions[0];
                action.activationType = firstSub.activationType;
                action.tabs = [firstSub.activationType];
                action.itemTypes = ['weapon']; // Group under weapons/attacks
                action.uses = uses;
                modified.push(action);

            } else if (item.type === 'weapon') {
                // 3. Weapons (with ammo resolution and linked attacks merging)
                const uses = this._calculateUses(item, actor);
                const linkedAttacks = weaponLinkedAttacks.get(item.id) ?? [];

                let subActions = [];

                if (linkedAttacks.length > 0) {
                    // Merge actions from all linked attack items
                    for (const attackItem of linkedAttacks) {
                        const attackActions = attackItem.system.actions ?? [];
                        for (const act of attackActions) {
                            const actType = act.activation?.type;
                            const activationType = this._parseActivationType(actType);
                            if (!activationType) continue;

                            subActions.push({
                                id: act._id,
                                // If multiple attacks are linked, prefix with attack name for clarity
                                name: linkedAttacks.length > 1 ? `${attackItem.name}: ${act.name || 'Attack'}` : (act.name || attackItem.name),
                                img: attackItem.img || item.img,
                                activationType: activationType,
                                tabs: [activationType],
                                uses: uses, // Shares weapon's ammunition/charges
                                roll: (event) => {
                                    if (typeof attackItem.use === 'function') {
                                        attackItem.use({ actionId: act._id, event });
                                    } else if (typeof attackItem.roll === 'function') {
                                        attackItem.roll({ actionId: act._id, event });
                                    }
                                }
                            });
                        }
                    }
                } else {
                    // Fallback to the weapon's own actions if no attacks are linked
                    const itemActions = item.system.actions ?? [];
                    for (const act of itemActions) {
                        const actType = act.activation?.type;
                        const activationType = this._parseActivationType(actType);
                        if (!activationType) continue;

                        subActions.push({
                            id: act._id,
                            name: act.name || item.name,
                            img: item.img,
                            activationType: activationType,
                            tabs: [activationType],
                            uses: uses,
                            roll: (event) => {
                                if (typeof item.use === 'function') {
                                    item.use({ actionId: act._id, event });
                                } else if (typeof item.roll === 'function') {
                                    item.roll({ actionId: act._id, event });
                                }
                            }
                        });
                    }
                }

                if (subActions.length === 0) continue; // Skip if no active actions

                action.subActions = subActions;
                const firstSub = subActions[0];
                action.activationType = firstSub.activationType;
                action.tabs = [firstSub.activationType];
                action.itemTypes = ['weapon'];
                action.uses = uses;
                modified.push(action);

            } else if (['consumable', 'feat'].includes(item.type)) {
                // 4. Consumables and Feats
                const itemActions = item.system.actions ?? [];
                if (itemActions.length === 0) continue;

                const uses = this._calculateUses(item, actor);

                action.subActions = itemActions.map(act => {
                    const actType = act.activation?.type;
                    const activationType = this._parseActivationType(actType);
                    
                    return {
                        id: act._id,
                        name: act.name || item.name,
                        img: item.img,
                        activationType: activationType,
                        tabs: [activationType],
                        uses: uses,
                        roll: (event) => {
                            if (typeof item.use === 'function') {
                                item.use({ actionId: act._id, event });
                            } else if (typeof item.roll === 'function') {
                                item.roll({ actionId: act._id, event });
                            }
                        }
                    };
                });

                action.subActions = action.subActions.filter(sub => sub.activationType !== null);
                if (action.subActions.length === 0) continue;

                const firstSub = action.subActions[0];
                action.activationType = firstSub.activationType;
                action.tabs = [firstSub.activationType];
                action.itemTypes = [item.type];
                action.uses = uses;
                modified.push(action);

            } else if (item.type === 'buff') {
                // 5. Buffs
                action.tabs = ['other'];
                action.activationType = 'other';
                action.itemTypes = ['buff'];
                
                action.roll = async (event) => {
                    const active = item.system.active;
                    await item.update({ "system.active": !active });
                };
                
                action.isActive = item.system.active;
                action.uses = { available: null, max: null };
                action.excludeFromAll = true; // Exclude buffs from the 'All Items' tab in PF1e

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
        const hasMax = uses && uses.max !== null && uses.max > 0;
        const hasValue = uses && uses.value !== null && uses.value > 0;
        
        if (uses && (hasMax || hasValue)) {
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
            'action': localize('PF1.Activation.action.Plural', 'Actions'),
            'bonus': localize('PF1.Activation.swift.Single', 'Swift'),
            'reaction': localize('PF1.Activation.immediate.Single', 'Immediate'),
            'other': localize('PF1.Activation.free.Single', 'Free')
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
        return labels[parentId] || super.getItemTypeLabel(parentId);
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
        return icons[parentId] || super.getItemTypeIcon(parentId);
    }

    /**
     * Modify the rendering context before it is sent to the template.
     * Used here to sort the spell sub-tabs (Cantrips, Orisons, Levels, SLAs) in the correct order.
     */
    modifyContext(context, app) {
        super.modifyContext?.(context, app);
        
        const spellGroup = context.itemTypes?.find(g => g.id === 'spell');
        if (spellGroup && spellGroup.subTabs.length > 0) {
            const order = ['cantrip', 'orison', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'sla'];
            spellGroup.subTabs.sort((a, b) => {
                const idxA = order.indexOf(a.id);
                const idxB = order.indexOf(b.id);
                const sortA = idxA === -1 ? 999 : idxA;
                const sortB = idxB === -1 ? 999 : idxB;
                return sortA - sortB;
            });
        }
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

    /**
     * Sort order for PF1e item types.
     */
    _getTypeSort(type) {
        const order = {
            'weapon': 1,
            'attack': 1,
            'spell': 2,
            'feat': 3,
            'buff': 4,
            'consumable': 5
        };
        return order[type] ?? 99;
    }

}
