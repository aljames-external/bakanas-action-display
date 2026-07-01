import { log } from '../lib/logger.js';

/**
 * Unified tab model for parent tabs, sub-tabs, and deeply nested sub-tabs in the HUD.
 * Every node in the tab hierarchy is a HUDTab instance with a level indicator (0 = top-level parent).
 */
export class HUDTab {
    /**
     * @param {Object} options
     * @param {string} options.id Tab identifier
     * @param {string} [options.label] Display label
     * @param {string} [options.icon] CSS icon class (for level 0 parent tabs)
     * @param {number} [options.level=0] Depth level (0 = top-level parent tab, 1 = sub-tab, 2+ = nested sub-tab)
     * @param {boolean} [options.active=false] Whether this tab filter is active
     * @param {boolean} [options.expanded=false] Whether this tab accordion/branch is expanded
     * @param {boolean} [options.activeParent=false] Whether this parent has active subtabs
     * @param {boolean} [options.excluded=false] Excluded filter state (e.g. spell components)
     * @param {boolean} [options.showUnprepared=false] Special indicator state (e.g. D&D 5e unprepared spells)
     * @param {HUDTab[]} [options.subTabs=[]] Child sub-tab instances
     * @param {Function} [options.onLeftClick=null] Custom left-click handler
     * @param {Function} [options.onRightClick=null] Custom right-click handler
     */
    constructor({
        id,
        label = '',
        icon = 'fas fa-question',
        level = 0,
        active = false,
        expanded = false,
        activeParent = false,
        excluded = false,
        showUnprepared = false,
        subTabs = [],
        onLeftClick = null,
        onRightClick = null
    } = {}) {
        this.id = id;
        this.label = label;
        this.icon = icon;
        this._level = level;
        this.parent = null;
        this.active = active;
        this.expanded = expanded;
        this.activeParent = activeParent;
        this.excluded = excluded;
        this.showUnprepared = showUnprepared;
        this.customOnLeftClick = onLeftClick;
        this.customOnRightClick = onRightClick;

        this.subTabs = [];
        for (const st of subTabs) {
            this.addSubTab(st);
        }
    }

    /**
     * Depth level of this tab (0 = top-level parent tab, 1 = sub-tab, 2+ = nested sub-tab).
     * Automatically derived from parent hierarchy if part of a tab tree.
     * @type {number}
     */
    get level() {
        if (this.parent) {
            return this.parent.level + 1;
        }
        return this._level;
    }

    set level(val) {
        this._level = val;
    }

    /**
     * Is this a top-level parent tab (level 0)?
     * @type {boolean}
     */
    get isTopLevel() {
        return this.level === 0;
    }

    /**
     * Add a child sub-tab under this tab.
     * Automatically establishes parent link and derives child depth level.
     * @param {Object|HUDTab} subTabConfig Sub-tab configuration or instance
     * @param {Object} [options]
     * @param {boolean} [options.atBeginning=false] Whether to unshift to the beginning of subTabs
     * @returns {HUDTab} The created or added child HUDTab instance
     */
    addSubTab(subTabConfig, { atBeginning = false } = {}) {
        const subTab = subTabConfig instanceof HUDTab 
            ? subTabConfig 
            : new HUDTab(subTabConfig);
        subTab.parent = this;
        if (atBeginning) {
            this.subTabs.unshift(subTab);
        } else {
            this.subTabs.push(subTab);
        }
        return subTab;
    }

    /**
     * Recursively search for a sub-tab by ID.
     * @param {string} subId 
     * @returns {HUDTab|undefined}
     */
    getSubTab(subId) {
        for (const st of this.subTabs) {
            if (st.id === subId) return st;
            const found = st.getSubTab(subId);
            if (found) return found;
        }
        return undefined;
    }

    /**
     * Handle left-click on this tab.
     * @param {ApplicationV2} app 
     * @param {TabSideState} sideState 
     * @param {string|Object} parentIdOrGroups Parent tab ID for level 1+ sub-tabs, or groups object for level 0 parent tabs
     * @param {Object} [groups] Tab groups object (when level >= 1)
     * @param {Event} [event] 
     */
    onLeftClick(app, sideState, parentIdOrGroups, groups, event) {
        if (this.customOnLeftClick) {
            const handled = this.customOnLeftClick(app, sideState, parentIdOrGroups, groups, event);
            if (handled) return;
        }
        if (this.isTopLevel) {
            sideState.selectParent(this.id, parentIdOrGroups);
        } else {
            sideState.selectSub(parentIdOrGroups, this.id, groups);
        }
    }

    /**
     * Handle right-click on this tab.
     * @param {ApplicationV2} app 
     * @param {TabSideState} sideState 
     * @param {string|Object} parentIdOrGroups Parent tab ID for level 1+ sub-tabs, or groups object for level 0 parent tabs
     * @param {Object} [groups] Tab groups object (when level >= 1)
     * @param {Event} [event] 
     */
    onRightClick(app, sideState, parentIdOrGroups, groups, event) {
        if (this.customOnRightClick) {
            const handled = this.customOnRightClick(app, sideState, parentIdOrGroups, groups, event);
            if (handled) return;
        }
        if (this.isTopLevel) {
            sideState.toggleParent(this.id, parentIdOrGroups);
        } else {
            sideState.toggleSub(parentIdOrGroups, this.id, groups);
        }
    }
}
