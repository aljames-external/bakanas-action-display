import { log } from '../lib/logger.js';

/**
 * Encapsulates tab state management and interaction rules for a single HUD side (left or right).
 * Handles parent focus, multi-select toggles, sub-tab isolation/toggling, and system default resets.
 */
export class TabSideState {
    /**
     * @param {Object} options
     * @param {'left'|'right'} options.side Left or right side identifier
     * @param {Object} [options.cached] Persisted tab state from cache
     * @param {Function} [options.getDefaultSubTypes] Function returning default active sub-types from system adapter
     */
    constructor({ side, cached, getDefaultSubTypes = () => [] } = {}) {
        this.side = side;
        this.getDefaultSubTypes = getDefaultSubTypes;

        // Restore active parents (support new object schema and legacy flat arrays)
        let initialParents = ['all'];
        if (cached?.parents) initialParents = cached.parents;
        else if (cached?.leftParents) initialParents = cached.leftParents;
        else if (cached?.rightParents) initialParents = cached.rightParents;
        else if (cached?.leftParent) initialParents = [cached.leftParent];
        else if (cached?.rightParent) initialParents = [cached.rightParent];
        this.activeParents = new Set(initialParents);

        // Restore focused parent
        this.focusedParent = cached?.focusedParent || cached?.focusedLeftParent || (initialParents.includes('all') ? 'all' : initialParents[0]);

        // Restore active sub-types
        let initialSubs = [];
        if (cached?.subTypes) initialSubs = cached.subTypes;
        else if (cached?.leftSubTypes) initialSubs = cached.leftSubTypes;
        else if (cached?.leftSub) initialSubs = [cached.leftSub];
        else if (cached?.rightSub) initialSubs = [cached.rightSub];
        this.activeSubTypes = new Set(initialSubs);

        // Populate adapter defaults if fresh initialization
        if (!cached) {
            const defaults = this.getDefaultSubTypes();
            for (const sub of defaults) {
                this.activeSubTypes.add(sub);
            }
        }
    }

    /**
     * Reset parent tabs and sub-tabs on this side to default state ('all' and default sub-types).
     */
    resetToDefault() {
        this.focusedParent = 'all';
        this.activeParents.clear();
        this.activeParents.add('all');
        this.activeSubTypes.clear();
        const defaults = this.getDefaultSubTypes();
        for (const sub of defaults) {
            this.activeSubTypes.add(sub);
        }
        log.debug(`Reset ${this.side} side tabs to default state ('all')`);
    }

    /**
     * Handle left-click selection of a parent tab.
     * Rules:
     * - 'all' resets side to default.
     * - If parent is not enabled: enable it, remove 'all', set focus to it.
     * - If parent is enabled with active subtabs: just change focus to it.
     * - If parent is enabled with NO active subtabs: disable it, shift focus to next remaining parent or 'all'.
     * @param {string} parentId The parent tab ID
     * @param {Object} groups Available tab groups
     */
    selectParent(parentId, groups) {
        if (parentId === 'all') {
            this.resetToDefault();
            return;
        }

        const group = groups?.[parentId];
        const validSubIds = group ? new Set(group.subTabs.map(t => t.id)) : new Set();
        const hasActiveSubs = Array.from(this.activeSubTypes).some(id => validSubIds.has(id));

        const isEnabled = this.activeParents.has(parentId);

        if (!isEnabled) {
            this.activeParents.add(parentId);
            this.activeParents.delete('all');
            this.focusedParent = parentId;
        } else if (hasActiveSubs) {
            this.focusedParent = parentId;
        } else {
            this.activeParents.delete(parentId);
            const remaining = Array.from(this.activeParents).filter(p => p !== 'all');
            if (remaining.length > 0) {
                this.focusedParent = remaining[remaining.length - 1];
            } else {
                this.resetToDefault();
            }
        }
        log.debug(`[${this.side}] selectParent: ${parentId}, active:`, Array.from(this.activeParents), `focused: ${this.focusedParent}`);
    }

    /**
     * Handle right-click toggling of a parent tab (multi-select / clearing subtabs).
     * @param {string} parentId The parent tab ID
     * @param {Object} groups Available tab groups
     */
    toggleParent(parentId, groups) {
        if (parentId === 'all') {
            this.resetToDefault();
            return;
        }

        const group = groups?.[parentId];
        let hadActiveSubs = false;
        if (group) {
            const validSubIds = new Set(group.subTabs.map(t => t.id));
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
            log.debug(`[${this.side}] Cleared subtabs for parent ${parentId}`);
        } else {
            if (this.activeParents.has(parentId)) {
                this.activeParents.delete(parentId);
                log.debug(`[${this.side}] Toggled OFF parent ${parentId}`);
            } else {
                this.activeParents.add(parentId);
                this.activeParents.delete('all');
                this.focusedParent = parentId;
                log.debug(`[${this.side}] Toggled ON parent ${parentId}`);
            }
        }

        if (this.activeParents.size === 0) {
            this.resetToDefault();
        }
    }

    /**
     * Handle left-click selection of a sub-tab.
     * @param {string|undefined} parentId Parent group ID
     * @param {string} type Sub-tab ID
     * @param {Object} groups Available tab groups
     */
    selectSub(parentId, type, groups) {
        if (parentId) {
            this.activeParents.add(parentId);
            this.activeParents.delete('all');
            this.focusedParent = parentId;
        }

        if (type === 'all') {
            if (parentId && groups?.[parentId]) {
                const validSubIds = new Set(groups[parentId].subTabs.map(t => t.id));
                for (const subId of this.activeSubTypes) {
                    if (validSubIds.has(subId)) {
                        this.activeSubTypes.delete(subId);
                    }
                }
            } else {
                this.activeSubTypes.clear();
            }
        } else {
            if (parentId && groups?.[parentId]) {
                const validSubIds = new Set(groups[parentId].subTabs.map(t => t.id));
                const activeSubsForParent = Array.from(this.activeSubTypes).filter(id => validSubIds.has(id));

                if (activeSubsForParent.length > 1) {
                    for (const subId of activeSubsForParent) {
                        if (subId !== type) this.activeSubTypes.delete(subId);
                    }
                    this.activeSubTypes.add(type);
                } else if (activeSubsForParent.length === 1 && activeSubsForParent[0] === type) {
                    this.activeSubTypes.delete(type);
                } else {
                    for (const subId of activeSubsForParent) {
                        this.activeSubTypes.delete(subId);
                    }
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
        log.debug(`[${this.side}] selectSub: ${type}, activeSubs:`, Array.from(this.activeSubTypes));
    }

    /**
     * Handle right-click toggling of a sub-tab (for multi-select).
     * @param {string|undefined} parentId Parent group ID
     * @param {string} type Sub-tab ID
     * @param {Object} groups Available tab groups
     */
    toggleSub(parentId, type, groups) {
        if (parentId) {
            this.activeParents.add(parentId);
            this.activeParents.delete('all');
            this.focusedParent = parentId;
        }

        if (type === 'all') {
            if (parentId && groups?.[parentId]) {
                const validSubIds = new Set(groups[parentId].subTabs.map(t => t.id));
                for (const subId of this.activeSubTypes) {
                    if (validSubIds.has(subId)) {
                        this.activeSubTypes.delete(subId);
                    }
                }
            } else {
                this.activeSubTypes.clear();
            }
        } else {
            if (this.activeSubTypes.has(type)) {
                this.activeSubTypes.delete(type);
            } else {
                this.activeSubTypes.add(type);
            }
        }
        log.debug(`[${this.side}] toggleSub: ${type}, activeSubs:`, Array.from(this.activeSubTypes));
    }

    /**
     * Prune sub-types that are no longer available in any active parent.
     * @param {Object} groups Available tab groups
     */
    prune(groups) {
        const allAvailableSubs = new Set();
        for (const parentId of this.activeParents) {
            const group = groups[parentId];
            if (group && group.subTabs.length > 0) {
                for (const sub of group.subTabs) {
                    allAvailableSubs.add(sub.id);
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
