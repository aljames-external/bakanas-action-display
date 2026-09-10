import { log } from "../../../lib/logger.js";
import { hasIntersection } from "../../../lib/utils.js";
import type { Action } from "../../../ui/action.js";
import type { TabRef } from "../../../ui/tab-ref.js";
import type { HUDTab } from "../../../ui/hud-tab.js";
import type { BaseSystemAdapter } from "../base-system-adapter.js";

export interface TabSideFilterContext {
    activeParents?: Set<string>;
    activeSubTypes?: Set<string>;
    groups?: Record<string, HUDTab>;
}

export interface FilterContext {
    actor?: Actor | null;
    token?: Token | null;
    left?: TabSideFilterContext;
    right?: TabSideFilterContext;
    showDepleted?: boolean;
    _inFilterSubactions?: boolean;
    [key: string]: unknown;
}

/**
 * Helper to check if a tab or any of its ancestors under a root tab matches a predicate.
 * @param {TabRef} tab Action tab descriptor { root, label, parent }
 * @param {string} rootId Root parent tab ID
 * @param {(label: string) => boolean} predicate
 * @returns {boolean}
 */
function hasTabInPath(tab: TabRef, rootId: string, predicate: (label: string) => boolean): boolean {
    if (tab.root !== rootId) return false;
    for (let cur: TabRef | null = tab; cur && cur.label !== rootId; cur = cur.parent) {
        if (predicate(cur.label)) return true;
    }
    return false;
}

/**
 * Manages tab filtering, set-algebraic combinators (union, intersection, difference),
 * and resource depletion checks for a system adapter.
 */
export class BaseSystemTabFilterManager {
    adapter: BaseSystemAdapter;

    /**
     * @param {BaseSystemAdapter} adapter Owning system adapter instance
     */
    constructor(adapter: BaseSystemAdapter) {
        this.adapter = adapter;
    }

    /**
     * Check if an action's uses resource is completely depleted.
     * @param {Action} action The action or subaction item
     * @returns {boolean} True if available uses is 0 or less
     */
    isResourceDepleted(action: Action): boolean {
        return action.uses?.available != null && (action.uses.available as number) <= 0;
    }

    /**
     * Determine the set combinator strategy for a right-side tab ('union' | 'intersection' | 'difference').
     * @param {string} parentId Parent tab ID
     * @returns {'union'|'intersection'|'difference'}
     */
    getTabCombinator(parentId: string): 'union' | 'intersection' | 'difference' {
        return 'union';
    }

    /**
     * Check if a parent tab acts as an exclusion / difference filter.
     * @param {string} parentId Parent tab ID
     * @returns {boolean}
     */
    isExclusionTab(parentId: string): boolean {
        return this.getTabCombinator(parentId) === 'difference';
    }

    /**
     * Get the canonical sub-tab IDs for an exclusion parent tab.
     * @param {string} parentId Parent tab ID
     * @returns {string[]}
     */
    getExclusionSubTabs(parentId: string): string[] {
        return [];
    }

    /**
     * Check if a parent tab acts as an intersection / conjunction filter.
     * @param {string} parentId Parent tab ID
     * @returns {boolean}
     */
    isIntersectionTab(parentId: string): boolean {
        return this.getTabCombinator(parentId) === 'intersection';
    }

    /**
     * Set-algebraic filter tree evaluator.
     * @param {Action} action Action card to evaluate
     * @param {FilterContext} filterContext Active filter state
     * @returns {boolean} True if action matches active right-side tab filters
     */
    matchesEconomyTabs(action: Action, filterContext: FilterContext): boolean {
        if (!action) return false;
        const rightContext = filterContext?.right ?? {};
        const activeParents = rightContext.activeParents ?? new Set<string>();
        const activeSubs = rightContext.activeSubTypes ?? new Set<string>();
        const parentGroups = rightContext.groups;

        if (action.subactions?.length) {
            return this.filterSubactions(action.subactions, filterContext).length > 0;
        }

        const right = action.right;
        if (!right || right.length === 0) return false;

        // 1. Evaluate DIFFERENCE (exclusion) parent groups first
        for (const parentId of activeParents) {
            if (!this.isExclusionTab(parentId)) continue;

            const group = parentGroups?.[parentId];
            const validSubIds = group?.getAllSubTabIds?.() ?? new Set<string>();

            const hasExcludedTab = right.some(
                (tab: TabRef) => tab.root === parentId && (activeSubs.has(tab.label) || Boolean(tab.parent && activeSubs.has(tab.parent.label))) && validSubIds.has(tab.label)
            );
            if (hasExcludedTab) return false;
        }

        // 2. Evaluate UNION / INTERSECTION (category) parent groups
        let showAllCategory = activeParents.has('all');
        if (!showAllCategory) {
            let onlyExclusionsOrAll = true;
            for (const p of activeParents) {
                if (p !== 'all' && !this.isExclusionTab(p)) {
                    onlyExclusionsOrAll = false;
                    break;
                }
            }
            showAllCategory = onlyExclusionsOrAll;
        }

        if (showAllCategory) return true;

        return right.some((tab: TabRef) => {
            const actionParentId = tab.root;
            if (!activeParents.has(actionParentId)) return false;
            if (this.isExclusionTab(actionParentId)) return false;

            const parentGroup = parentGroups?.[actionParentId];
            const validSubIds = parentGroup?.getAllSubTabIds?.() ?? new Set<string>();

            if (this.isIntersectionTab(actionParentId)) {
                const activeSubsForParent: string[] = [];
                for (const id of activeSubs) {
                    if (validSubIds.has(id)) activeSubsForParent.push(id);
                }
                if (activeSubsForParent.length === 0) return true;
                return activeSubsForParent.every(subId =>
                    right.some((t: TabRef) => hasTabInPath(t, actionParentId, (label: string) => label === subId))
                );
            }

            if (!hasIntersection(activeSubs, validSubIds)) return true;

            return right.some((t: TabRef) => hasTabInPath(t, actionParentId, (label: string) => activeSubs.has(label)));
        });
    }

    /**
     * Collect currently active sub-tabs under difference / exclusion parent tabs.
     * @param {FilterContext} filterContext Active filter state
     * @returns {string[]} Array of active exclusion sub-tab IDs
     */
    getActiveExclusionSubs(filterContext: FilterContext): string[] {
        const rightContext = filterContext?.right ?? {};
        const activeParents = rightContext.activeParents ?? new Set<string>();
        const activeSubs = rightContext.activeSubTypes ?? new Set<string>();
        const parentGroups = rightContext.groups;
        const activeExclusionSubs: string[] = [];

        for (const parentId of activeParents) {
            if (!this.isExclusionTab(parentId)) continue;

            const group = parentGroups?.[parentId];
            const validSubIds = group?.getAllSubTabIds?.() ?? new Set<string>();

            if (validSubIds.size === 0) {
                activeExclusionSubs.push(...activeSubs);
            } else {
                for (const subId of activeSubs) {
                    if (validSubIds.has(subId)) activeExclusionSubs.push(subId);
                }
            }
        }

        return activeExclusionSubs;
    }

    /**
     * Filter subactions/activities based on active left/right tabs and resource availability.
     * @param {Action[]} subactions Array of subaction items
     * @param {FilterContext} filterContext Active filter state
     * @param {string[]} [itemLeft] Optional left tab array of parent item
     * @returns {Action[]} Qualifying subactions
     */
    filterSubactions(subactions: Action[], filterContext: FilterContext, itemLeft?: string[]): Action[] {
        if (!subactions?.length) return [];
        const { showDepleted, left } = filterContext;

        return subactions.filter((sub: Action) => {
            if (left && sub.left?.length > 0) {
                const activeLeft = left.activeParents;
                if (activeLeft && !activeLeft.has('all')) {
                    if (!sub.left.some((type: string) => activeLeft.has(type))) {
                        log.debug(`BaseSystemTabFilterManager.filterSubactions | Skipping subaction "${sub.name}" (${sub.id}) — does not match active left tabs:`, { sub, left: activeLeft });
                        return false;
                    }
                }
            }
            const matchesEconomy = this.matchesEconomyTabs(sub, filterContext);
            if (!matchesEconomy) {
                const activeRight = Array.from(filterContext?.right?.activeParents ?? []).join(', ');
                const activeRightSubs = Array.from(filterContext?.right?.activeSubTypes ?? []).join(', ');
                log.debug(`BaseSystemTabFilterManager.filterSubactions | Skipping subaction "${sub.name}" (${sub.id}) — does not match active right economy tabs (parents: [${activeRight}], sub-types: [${activeRightSubs}]):`, { sub });
                return false;
            }
            const depleted = this.isResourceDepleted(sub);
            if (!showDepleted && depleted) {
                log.debug(`BaseSystemTabFilterManager.filterSubactions | Skipping subaction "${sub.name}" (${sub.id}) — resource is depleted and showDepleted is false:`, { sub });
                return false;
            }
            return true;
        });
    }
}
