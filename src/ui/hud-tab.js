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
        this._parent = null;
        this.rootParent = this;
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
     * Parent HUDTab reference. Automatically updates depth level and rootParent pointers.
     * @type {HUDTab|null}
     */
    get parent() {
        return this._parent;
    }

    set parent(parentTab) {
        this._parent = parentTab;
        const newRoot = parentTab ? (parentTab.rootParent || parentTab) : this;
        this._setRootParent(newRoot);
    }

    /**
     * Internal helper to assign rootParent pointer down the child sub-tree.
     * @param {HUDTab} root 
     * @private
     */
    _setRootParent(root) {
        this.rootParent = root;
        if (this.subTabs && this.subTabs.length > 0) {
            for (const child of this.subTabs) {
                child._setRootParent(root);
            }
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
     * @returns {HUDTab} The created or added child HUDTab instance
     */
    addSubTab(subTabConfig) {
        const subTab = subTabConfig instanceof HUDTab 
            ? subTabConfig 
            : new HUDTab(subTabConfig);
        subTab.parent = this;
        this.subTabs.push(subTab);
        return subTab;
    }

    /**
     * Get the array of child sub-tab IDs in their current displayed order.
     * @returns {string[]}
     */
    getOrder() {
        return this.subTabs.map(t => t.id);
    }

    /**
     * Update and re-order child sub-tabs using an array of ordered sub-tab IDs.
     * @param {string[]} orderArray Array of sub-tab IDs in the desired display order
     */
    updateOrder(orderArray) {
        if (!Array.isArray(orderArray) || this.subTabs.length === 0) return;
        const orderMap = new Map(orderArray.map((id, index) => [id, index]));
        this.subTabs.sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
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
     * @param {Object} groups Tab groups dictionary
     * @param {Event} [event] 
     */
    onLeftClick(app, sideState, groups, event) {
        if (this.customOnLeftClick) {
            const handled = this.customOnLeftClick(app, sideState, groups, event);
            if (handled) return;
        }
        if (this.isTopLevel) {
            sideState.selectParent(this.id, groups);
        } else {
            sideState.selectSub(this.rootParent.id, this.id, groups);
        }
    }

    /**
     * Handle right-click on this tab.
     * @param {ApplicationV2} app 
     * @param {TabSideState} sideState 
     * @param {Object} groups Tab groups dictionary
     * @param {Event} [event] 
     */
    onRightClick(app, sideState, groups, event) {
        if (this.customOnRightClick) {
            const handled = this.customOnRightClick(app, sideState, groups, event);
            if (handled) return;
        }
        if (this.isTopLevel) {
            sideState.toggleParent(this.id, groups);
        } else {
            sideState.toggleSub(this.rootParent.id, this.id, groups);
        }
    }
}
