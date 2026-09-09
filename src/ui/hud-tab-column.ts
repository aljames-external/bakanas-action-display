import { log } from '../lib/logger.js';
import { adapter } from '../adapters/index.js';
import { hasIntersection } from '../lib/utils.js';

/**
 * Encapsulates tab column state management and interaction rules for a single HUD column (left or right).
 * Handles parent focus, multi-select toggles, sub-tab isolation/toggling, and system default resets.
 */
export class HUDTabColumn {
    /**
     * @param {Object} options
     * @param {'left'|'right'} options.side Left or right side column identifier
     * @param {Object} [options.cached] Persisted tab state from cache
     * @param {string} [options.defaultParent='all'] Default parent tab ID
     * @param {Function} [options.getDefaultSubTypes] Function returning default active sub-types from system adapter
     */
    constructor({ side, cached, defaultParent = 'all', getDefaultSubTypes = () => [] } = {}) {
        this.side = side;
        this.defaultParent = defaultParent;
        this.getDefaultSubTypes = getDefaultSubTypes;

        const initialParents = cached?.parents ?? [defaultParent];
        this.activeParents = new Set(initialParents);

        this.focusedParent = cached?.focusedParent ?? (initialParents.includes(defaultParent) ? defaultParent : initialParents[0]);

        const initialSubs = cached?.subTypes ?? [];
        this.activeSubTypes = new Set(initialSubs);

        // Populate adapter defaults if fresh initialization
        if (!cached) {
            const defaults = this.getDefaultSubTypes();
            for (const sub of defaults) {
                this.activeSubTypes.add(sub);
            }
        }

        this.autoBanInitialized = false;
    }

    /**
     * Reset parent tabs and sub-tabs on this column to default state ('all' and default sub-types),
     * while preserving exclusion parent tabs (e.g. 'components') and their active sub-tabs (e.g. 'vocal', 'somatic').
     * @param {Object} [groups] Tab groups dictionary
     */
    resetToDefault(groups = null) {
        const exclusionParents = [];
        const exclusionSubIds = new Set();
        for (const p of this.activeParents) {
            if (adapter.isExclusionTab(p)) {
                exclusionParents.push(p);
                const g = groups?.[p];
                if (g) {
                    for (const sId of g.getAllSubTabIds?.() ?? []) {
                        exclusionSubIds.add(sId);
                    }
                }
            }
        }

        this.focusedParent = this.defaultParent;
        this.activeParents.clear();
        this.activeParents.add(this.defaultParent);
        for (const p of exclusionParents) {
            this.activeParents.add(p);
        }

        // Clear active sub-tabs except those belonging to exclusion parents
        for (const subId of this.activeSubTypes) {
            if (!exclusionSubIds.has(subId)) {
                this.activeSubTypes.delete(subId);
            }
        }
        const defaults = this.getDefaultSubTypes();
        for (const sub of defaults) {
            this.activeSubTypes.add(sub);
        }
    }

    /**
     * Handle left-click selection of a parent tab.
     * Rules:
     * - Left-clicking 'all' resets column to default (preserving exclusion tabs).
     * - Left-clicking a tab deselects other category parent tabs and clears their subtabs (exclusive selection).
     * - Left-clicking the sole active parent tab with NO active subtabs disables it and resets column to default.
     * - Left-clicking the sole active parent tab WITH active subtabs keeps it active and focuses it.
     * @param {string} parentId The parent tab ID
     * @param {Object} groups Available tab groups
     */
    selectParent(parentId, groups) {
        if (parentId === 'all') {
            this.resetToDefault(groups);
            return;
        }

        const group = groups?.[parentId];
        const validSubIds = group?.getAllSubTabIds?.() ?? new Set();
        const hasActiveSubs = hasIntersection(this.activeSubTypes, validSubIds);

        const isSoleActive = this.activeParents.size === 1 && this.activeParents.has(parentId);
        const isParentExclusion = adapter.isExclusionTab(parentId);

        if (!isSoleActive) {
            // Deselect other category parent tabs and clear their sub-tabs,
            // while preserving exclusion parent tabs (e.g. 'components') and their active sub-tabs
            const exclusionParents = [];
            const exclusionSubIds = new Set();
            for (const p of this.activeParents) {
                if (adapter.isExclusionTab(p)) {
                    exclusionParents.push(p);
                    const g = groups?.[p];
                    if (g) {
                        for (const sId of g.getAllSubTabIds?.() ?? []) {
                            exclusionSubIds.add(sId);
                        }
                    }
                }
            }

            this.activeParents.clear();
            this.activeParents.add(parentId);
            if (!isParentExclusion) {
                for (const p of exclusionParents) {
                    this.activeParents.add(p);
                }
            }
            this.focusedParent = parentId;

            for (const subId of this.activeSubTypes) {
                if (!validSubIds.has(subId) && !exclusionSubIds.has(subId)) {
                    this.activeSubTypes.delete(subId);
                }
            }
        } else if (hasActiveSubs) {
            // Already sole active parent with active subtabs: change focus to it
            this.focusedParent = parentId;
        } else {
            // Already sole active parent with NO active subtabs: disable it and reset to default
            this.resetToDefault(groups);
        }
    }

    /**
     * Handle right-click toggling of a parent tab (multi-select / clearing subtabs).
     * @param {string} parentId The parent tab ID
     * @param {Object} groups Available tab groups
     */
    toggleParent(parentId, groups) {
        if (parentId === 'all') {
            this.resetToDefault(groups);
            return;
        }

        const group = groups?.[parentId];
        let hadActiveSubs = false;
        if (group) {
            const validSubIds = group.getAllSubTabIds?.() ?? new Set();
            for (const subId of this.activeSubTypes) {
                if (validSubIds.has(subId)) {
                    hadActiveSubs = true;
                    this.activeSubTypes.delete(subId);
                }
            }
        }

        if (hadActiveSubs) {
            this.activeParents.add(parentId);
            this.activeParents.delete('all');
            this.focusedParent = parentId;
        } else {
            if (this.activeParents.has(parentId)) {
                this.activeParents.delete(parentId);
            } else {
                this.activeParents.add(parentId);
                this.activeParents.delete('all');
                this.focusedParent = parentId;
            }
        }
        if (this.activeParents.size === 0) {
            this.resetToDefault(groups);
            return;
        }
    }

    /**
     * Handle left-click selection of a sub-tab.
     * @param {string} parentId Parent group ID
     * @param {string} type Sub-tab ID
     * @param {Object} groups Available tab groups
     * @param {boolean} [isExclusion=false] Whether this parent tab is an exclusion filter
     */
    selectSub(parentId, type, groups, isExclusion = false) {
        if (isExclusion) {
            this.toggleSub(parentId, type, groups, isExclusion);
            return;
        }
        if (parentId) {
            this.activeParents.add(parentId);
            if (!isExclusion) {
                this.activeParents.delete('all');
            }
            this.focusedParent = parentId;
        }

        const group = groups?.[parentId];
        if (type === 'all') {
            if (group) {
                const validSubIds = group.getAllSubTabIds?.() ?? new Set();
                for (const subId of this.activeSubTypes) {
                    if (validSubIds.has(subId)) {
                        this.activeSubTypes.delete(subId);
                    }
                }
            } else {
                this.activeSubTypes.clear();
            }
            return;
        }

        const targetTab = group?.getSubTab?.(type);
        const descendantIds = targetTab?.getAllSubTabIds?.() ?? new Set();
        const hasDescendants = descendantIds.size > 0;

        if (group) {
            const validSubIds = group.getAllSubTabIds?.() ?? new Set();
            const activeSubsForParent = [];
            for (const id of this.activeSubTypes) {
                if (validSubIds.has(id)) activeSubsForParent.push(id);
            }

            const isCurrentActive = this.activeSubTypes.has(type) ||
                (hasDescendants && hasIntersection(descendantIds, this.activeSubTypes));

            for (const subId of activeSubsForParent) {
                this.activeSubTypes.delete(subId);
            }

            if (activeSubsForParent.length === 1 && isCurrentActive) {
                for (const childId of descendantIds) {
                    this.activeSubTypes.delete(childId);
                }
                this.activeSubTypes.delete(type);
            } else {
                this.activeSubTypes.add(type);
            }
        } else {
            if (this.activeSubTypes.has(type) && this.activeSubTypes.size === 1) {
                this.activeSubTypes.clear();
            } else {
                this.activeSubTypes.clear();
                this.activeSubTypes.add(type);
            }
        }
    }

    /**
     * Handle right-click toggling of a sub-tab (for multi-select).
     * @param {string} parentId Parent group ID
     * @param {string} type Sub-tab ID
     * @param {Object} groups Available tab groups
     * @param {boolean} [isExclusion=false] Whether this parent tab is an exclusion filter
     */
    toggleSub(parentId, type, groups, isExclusion = false) {
        if (parentId) {
            this.activeParents.add(parentId);
            if (!isExclusion) {
                this.activeParents.delete('all');
            }
            this.focusedParent = parentId;
        }

        const group = groups?.[parentId];
        if (type === 'all') {
            if (group) {
                const validSubIds = group.getAllSubTabIds?.() ?? new Set();
                for (const subId of this.activeSubTypes) {
                    if (validSubIds.has(subId)) {
                        this.activeSubTypes.delete(subId);
                    }
                }
            } else {
                this.activeSubTypes.clear();
            }
            return;
        }

        const targetTab = group?.getSubTab?.(type);
        const descendantIds = targetTab?.getAllSubTabIds?.() ?? new Set();
        const hasDescendants = descendantIds.size > 0;

        if (hasDescendants) {
            // Case 1: Toggling an intermediate category tab (e.g. 'standard')
            if (this.activeSubTypes.has(type)) {
                // Was active: unselect category and all its descendant sub-tabs
                this.activeSubTypes.delete(type);
                for (const childId of descendantIds) {
                    this.activeSubTypes.delete(childId);
                }
            } else {
                // Was inactive: select category and clean up any individual descendant sub-tabs
                this.activeSubTypes.add(type);
                for (const childId of descendantIds) {
                    this.activeSubTypes.delete(childId);
                }
            }
        } else {
            // Case 2: Toggling a leaf sub-tab (e.g. 'action')
            let ancestorCategory = targetTab?.parent && !targetTab.parent.isTopLevel ? targetTab.parent : null;
            if (ancestorCategory && this.activeSubTypes.has(ancestorCategory.id)) {
                // Ancestor category was active (all children were active).
                // Toggling this leaf off removes ancestor category and adds all sibling children except this one.
                this.activeSubTypes.delete(ancestorCategory.id);
                for (const sibling of ancestorCategory.subTabs) {
                    if (sibling.id !== type && sibling.id !== 'all') {
                        this.activeSubTypes.add(sibling.id);
                    }
                }
                this.activeSubTypes.delete(type);
            } else if (this.activeSubTypes.has(type)) {
                this.activeSubTypes.delete(type);
            } else {
                this.activeSubTypes.add(type);
                // If all siblings under ancestor category are now active, collapse them into the ancestor category
                if (ancestorCategory && ancestorCategory.subTabs.length > 0) {
                    const nonAllSiblings = ancestorCategory.subTabs.filter(s => s.id !== 'all');
                    const allSiblingsActive = nonAllSiblings.every(s => this.activeSubTypes.has(s.id));
                    if (allSiblingsActive) {
                        for (const s of nonAllSiblings) {
                            this.activeSubTypes.delete(s.id);
                        }
                        this.activeSubTypes.add(ancestorCategory.id);
                    }
                }
            }
        }

        if (isExclusion && group) {
            const validSubIds = group.getAllSubTabIds?.() ?? new Set();
            const hasRemainingSubs = hasIntersection(this.activeSubTypes, validSubIds);
            if (!hasRemainingSubs) {
                this.activeParents.delete(parentId);
            }
        }
    }

    /**
     * Prune sub-types that are no longer available in any active parent.
     * @param {Object} groups Available tab groups
     * @param {Function} [isExclusionFn] Function returning true if a parentId is an exclusion filter
     */
    prune(groups, isExclusionFn = () => false) {
        const allAvailableSubs = new Set();
        for (const parentId in groups) {
            if (isExclusionFn(parentId) || this.activeParents.has(parentId)) {
                const group = groups[parentId];
                if (group) {
                    const subIds = group.getAllSubTabIds?.() ?? new Set();
                    for (const id of subIds) {
                        allAvailableSubs.add(id);
                    }
                }
            }
        }
        for (const activeSub of this.activeSubTypes) {
            if (activeSub !== 'all' && !allAvailableSubs.has(activeSub)) {
                this.activeSubTypes.delete(activeSub);
            }
        }
    }

    /**
     * Serialize tab state for caching per actor.
     * @returns {Object}
     */
    serialize() {
        return {
            parents: Array.from(this.activeParents),
            focusedParent: this.focusedParent,
            subTypes: Array.from(this.activeSubTypes)
        };
    }
}
