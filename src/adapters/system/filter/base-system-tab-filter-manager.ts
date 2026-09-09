import { log } from "../../../lib/logger.js";
import { hasIntersection } from "../../../lib/utils.js";

/**
 * Helper to check if a tab or any of its ancestors under a root tab matches a predicate.
 * @param {Object} tab Action tab descriptor { root, label, parent }
 * @param {string} rootId Root parent tab ID
 * @param {(label: string) => boolean} predicate
 * @returns {boolean}
 */
function hasTabInPath(tab, rootId, predicate) {
    if (tab.root !== rootId) return false;
    for (let cur = tab; cur && cur.label !== rootId; cur = cur.parent) {
        if (predicate(cur.label)) return true;
    }
    return false;
}

/**
 * Manages tab filtering, set-algebraic combinators (union, intersection, difference),
 * and resource depletion checks for a system adapter.
 */
export class BaseSystemTabFilterManager {
    /**
     * @param {BaseSystemAdapter} adapter Owning system adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
    }

    /**
     * Check if an action's uses resource is completely depleted.
     * @param {Object} action The action or subaction item
     * @returns {boolean} True if available uses is 0 or less
     */
    isResourceDepleted(action) {
        return action.uses?.available != null && action.uses.available <= 0;
    }

    /**
     * Determine the set combinator strategy for a right-side tab ('union' | 'intersection' | 'difference').
     * @param {string} parentId Parent tab ID
     * @returns {'union'|'intersection'|'difference'}
     */
    getTabCombinator(parentId) {
        return 'union';
    }

    /**
     * Check if a parent tab acts as an exclusion / difference filter.
     * @param {string} parentId Parent tab ID
     * @returns {boolean}
     */
    isExclusionTab(parentId) {
        return this.getTabCombinator(parentId) === 'difference';
    }

    /**
     * Get the canonical sub-tab IDs for an exclusion parent tab.
     * @param {string} parentId Parent tab ID
     * @returns {string[]}
     */
    getExclusionSubTabs(parentId) {
        return [];
    }

    /**
     * Check if a parent tab acts as an intersection / conjunction filter.
     * @param {string} parentId Parent tab ID
     * @returns {boolean}
     */
    isIntersectionTab(parentId) {
        return this.getTabCombinator(parentId) === 'intersection';
    }

    /**
     * Set-algebraic filter tree evaluator.
     * @param {Object} action Action card to evaluate
     * @param {Object} filterContext Active filter state
     * @returns {boolean} True if action matches active right-side tab filters
     */
    matchesEconomyTabs(action, filterContext) {
        if (!action) return false;
        const rightContext = filterContext?.right ?? {};
        const activeParents = rightContext.activeParents ?? new Set();
        const activeSubs = rightContext.activeSubTypes ?? new Set();
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
            const validSubIds = group?.getAllSubTabIds?.() ?? new Set();

            const hasExcludedTab = right.some(
                tab => tab.root === parentId && (activeSubs.has(tab.label) || (tab.parent && activeSubs.has(tab.parent.label))) && validSubIds.has(tab.label)
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

        return right.some(tab => {
            const actionParentId = tab.root;
            if (!activeParents.has(actionParentId)) return false;
            if (this.isExclusionTab(actionParentId)) return false;

            const parentGroup = parentGroups?.[actionParentId];
            const validSubIds = parentGroup?.getAllSubTabIds?.() ?? new Set();

            if (this.isIntersectionTab(actionParentId)) {
                const activeSubsForParent = [];
                for (const id of activeSubs) {
                    if (validSubIds.has(id)) activeSubsForParent.push(id);
                }
                if (activeSubsForParent.length === 0) return true;
                return activeSubsForParent.every(subId =>
                    right.some(t => hasTabInPath(t, actionParentId, label => label === subId))
                );
            }

            if (!hasIntersection(activeSubs, validSubIds)) return true;

            return right.some(t => hasTabInPath(t, actionParentId, label => activeSubs.has(label)));
        });
    }

    /**
     * Collect currently active sub-tabs under difference / exclusion parent tabs.
     * @param {Object} filterContext Active filter state
     * @returns {string[]} Array of active exclusion sub-tab IDs
     */
    getActiveExclusionSubs(filterContext) {
        const rightContext = filterContext?.right ?? {};
        const activeParents = rightContext.activeParents ?? new Set();
        const activeSubs = rightContext.activeSubTypes ?? new Set();
        const parentGroups = rightContext.groups;
        const activeExclusionSubs = [];

        for (const parentId of activeParents) {
            if (!this.isExclusionTab(parentId)) continue;

            const group = parentGroups?.[parentId];
            const validSubIds = group?.getAllSubTabIds?.() ?? new Set();

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
     * @param {Object[]} subactions Array of subaction items
     * @param {Object} filterContext Active filter state
     * @returns {Object[]} Qualifying subactions
     */
    filterSubactions(subactions, filterContext) {
        if (!subactions?.length) return [];
        const { showDepleted, left } = filterContext;

        return subactions.filter(sub => {
            if (left && sub.left?.length > 0) {
                const activeLeft = left.activeParents;
                if (activeLeft && !activeLeft.has('all')) {
                    if (!sub.left.some(type => activeLeft.has(type))) {
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
