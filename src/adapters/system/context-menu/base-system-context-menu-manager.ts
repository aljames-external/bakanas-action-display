import { MODULE_ID } from '../../../constants.js';

/**
 * Base context menu manager for system adapters.
 * Manages system-specific action card context menu items and tab right-click shortcuts.
 */
export class BaseSystemContextMenuManager {
    adapter: any;

    constructor(adapter: any) {
        this.adapter = adapter;
    }

    /**
     * Get system-specific context menu items for action cards.
     * @param {ApplicationV2} app The ActionDisplayApp instance
     * @returns {Object[]} Array of context menu item specifications
     */
    getContextMenuItems(app: any): any[] {
        return [];
    }

    /**
     * Set a module flag on an actor optimistically in memory and persist it asynchronously.
     * @param {Actor} actor Target actor document
     * @param {string} scope Module scope identifier
     * @param {string} key Flag key
     * @param {*} value Flag value
     * @returns {Promise<Actor>|undefined} Persistence promise
     */
    setActorFlagOptimistic(actor, scope, key, value) {
        if (!actor) return;
        actor.flags ??= {};
        actor.flags[scope] ??= {};
        actor.flags[scope][key] = value;
        return actor.setFlag?.(scope, key, value, { badInternal: true });
    }

    /**
     * Set multiple module flags on an actor optimistically in memory and persist them asynchronously.
     * @param {Actor} actor Target actor document
     * @param {string} scope Module scope identifier
     * @param {Object.<string, *>} flags Map of flag keys to values
     * @returns {Promise<Actor|Actor[]>|undefined} Persistence promise
     */
    updateActorFlagsOptimistic(actor, scope, flags) {
        if (!actor) return;
        actor.flags ??= {};
        actor.flags[scope] ??= {};
        for (const [key, value] of Object.entries(flags)) {
            actor.flags[scope][key] = value;
        }
        if (actor.update) {
            const updates = {};
            for (const [key, value] of Object.entries(flags)) {
                updates[`flags.${scope}.${key}`] = value;
            }
            return actor.update(updates, { badInternal: true });
        }
        const promises: any[] = [];
        for (const [key, value] of Object.entries(flags)) {
            promises.push(actor.setFlag?.(scope, key, value, { badInternal: true }));
        }
        return Promise.all(promises);
    }

    /**
     * Shared helper to handle right-clicking parent or 'all' sub-tabs to toggle filter flags.
     * @param {ApplicationV2} app Active HUD application
     * @param {HTMLElement} el Clicked DOM element
     * @param {Record<string, string>} flagMap Map of parent tab type to actor flag key
     * @param {string[]} allFilterFlags Array of all flag keys toggled by 'all' tab
     * @returns {boolean} True if handled
     */
    handleFilterTabRightClick(app, el, flagMap, allFilterFlags) {
        if (!app.actor?.isOwner || !el) return false;

        const isParentTab = Boolean(el.classList?.contains?.('bad-left-tab'));
        const isSubTab = Boolean(el.classList?.contains?.('bad-left-sub-tab'));
        const parentType = isParentTab
            ? el.dataset?.type
            : (isSubTab && el.dataset?.type === 'all'
                ? el.closest?.('.bad-left-tab-group')?.querySelector?.('.bad-left-tab')?.dataset?.type
                : null);

        if (!parentType) return false;

        if (parentType === 'all') {
            const current = Boolean(app.actor.getFlag(MODULE_ID, 'showAll'));
            const nextState = !current;
            const flagUpdates = {};
            for (const key of allFilterFlags) {
                flagUpdates[key] = nextState;
            }
            this.updateActorFlagsOptimistic(app.actor, MODULE_ID, flagUpdates);
            return true;
        }

        const flagKey = flagMap[parentType];
        if (flagKey) {
            const current = Boolean(app.actor.getFlag(MODULE_ID, flagKey));
            this.setActorFlagOptimistic(app.actor, MODULE_ID, flagKey, !current);
            return true;
        }

        return false;
    }

    /**
     * Handle right-click events on tab elements.
     * @param {ApplicationV2} app The ActionDisplayApp instance
     * @param {HTMLElement} el The tab element right-clicked
     * @param {Event} event The trigger event
     * @returns {boolean} True if handled by the system context manager
     */
    onTabRightClick(app, el, event) {
        return false;
    }

    /**
     * Utility to resolve the original item document from a context menu element dataset.
     * @param {ApplicationV2} app The ActionDisplayApp instance
     * @param {HTMLElement} el The clicked context menu target element
     * @returns {Object|null} The resolved Item document
     */
    getContextItem(app, el) {
        const actionId = el?.dataset?.actionId;
        if (!actionId) return null;
        const action = app.actions?.find(a => a.id === actionId);
        return action?.originalItem ?? null;
    }
}
