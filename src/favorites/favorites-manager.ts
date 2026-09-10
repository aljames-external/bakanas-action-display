import { MODULE_ID } from '../constants.js';
import { log } from '../lib/logger.js';
import { adapter } from '../adapters/index.js';

/**
 * Get the favorites map from an actor document.
 *
 * @param {Object} actor Actor document
 * @returns {Record<string, boolean>} Map of itemId to boolean
 */
export function getActorFavorites(actor: Actor): Record<string, boolean> {
    if (!actor?.getFlag) return {};
    return (actor.getFlag(MODULE_ID, 'favorites') as Record<string, boolean>) ?? {};
}

/**
 * Check whether an item is favorited on an actor, checking both actor-level flag and system adapter.
 *
 * @param {Actor} actor Actor document
 * @param {Item} item Item document
 * @param {BaseSystemAdapter|null} [customAdapter=null] Optional adapter override (defaults to global adapter.system)
 * @returns {boolean} True if favorited
 */
export function isActorItemFavorite(actor: Actor, item: Item, customAdapter: BaseSystemAdapter | null = null): boolean {
    if (!actor || !item?.id) return false;

    const favorites = getActorFavorites(actor);
    if (favorites[item.id]) return true;

    const sys = customAdapter ?? adapter.system;
    return Boolean(sys?.hasFavorites?.() && sys.isFavorite(actor, item));
}

/**
 * Set or unset favorite state for an item on an actor, updating both the system-level state and actor flag map.
 *
 * @param {Actor} actor Actor document
 * @param {Item} item Item document
 * @param {boolean} isFavorite Target favorite state
 * @param {BaseSystemAdapter|null} [customAdapter=null] Optional adapter override (defaults to global adapter.system)
 * @returns {Promise<void>}
 */
export async function setActorItemFavorite(actor: Actor, item: Item, isFavorite: boolean, customAdapter: BaseSystemAdapter | null = null): Promise<void> {
    if (!actor || !item?.id) return;

    const targetFavorite = Boolean(isFavorite);
    const sys = customAdapter ?? adapter.system;

    // 1. Update system level if supported
    if (sys?.hasFavorites?.()) {
        try {
            await sys.setFavorite(actor, item, targetFavorite);
        } catch (err) {
            log.error(`setActorItemFavorite | Failed to set system favorite for item "${item.name}":`, err);
        }
    }

    // 2. Update actor level flag
    try {
        const current = { ...getActorFavorites(actor) };
        if (targetFavorite) {
            current[item.id] = true;
            await actor.setFlag(MODULE_ID, 'favorites', current);
        } else {
            delete current[item.id];
            if (actor.update) {
                await actor.update({
                    [`flags.${MODULE_ID}.favorites.-=${item.id}`]: null
                });
            } else {
                await actor.setFlag?.(MODULE_ID, 'favorites', current);
            }
        }
    } catch (err) {
        log.error(`setActorItemFavorite | Failed to update actor flag for item ID "${item.id}":`, err);
    }
}

/**
 * Synchronize the actor's favorites flag map with the system-level favorites if the system supports favorites.
 *
 * @param {Actor} actor Actor document
 * @param {BaseSystemAdapter|null} [customAdapter=null] Optional adapter override (defaults to global adapter.system)
 * @returns {Promise<void>}
 */
export async function syncActorFavorites(actor: Actor, customAdapter: BaseSystemAdapter | null = null): Promise<void> {
    const sys = customAdapter ?? adapter.system;
    if (!actor || !sys?.hasFavorites?.() || !actor.isOwner) return;

    try {
        const currentFlags = getActorFavorites(actor);
        const updatedFlags: Record<string, boolean> = {};

        const items = actor.items?.values?.() ?? actor.items ?? [];
        for (const item of items) {
            if (item?.id && sys.isFavorite(actor, item)) {
                updatedFlags[item.id] = true;
            }
        }

        const currentKeys = Object.keys(currentFlags);
        const updatedKeys = Object.keys(updatedFlags);
        const hasChanges = currentKeys.length !== updatedKeys.length ||
            currentKeys.some(id => !updatedFlags[id]);

        if (hasChanges) {
            await actor.setFlag(MODULE_ID, 'favorites', updatedFlags);
        }
    } catch (err) {
        log.error(`Failed to synchronize favorites for actor "${actor.name}":`, err);
    }
}
