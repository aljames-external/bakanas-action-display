import { log } from '../lib/logger.js';

/**
 * Represents an individual sub-tab under a parent HUD tab (e.g., spell level 1, bonus action).
 */
export class HUDSubTab {
    /**
     * @param {Object} options
     * @param {string} options.id Sub-tab identifier
     * @param {string} options.label Localized display label
     * @param {boolean} [options.active] Active filter state
     * @param {boolean} [options.excluded] Excluded filter state (e.g., spell components)
     * @param {boolean} [options.showUnprepared] Special indicator state (e.g., D&D 5e unprepared spells)
     * @param {Function} [options.onLeftClick] Custom left-click handler
     * @param {Function} [options.onRightClick] Custom right-click handler
     */
    constructor({
        id,
        label = '',
        active = false,
        excluded = false,
        showUnprepared = false,
        onLeftClick = null,
        onRightClick = null
    } = {}) {
        this.id = id;
        this.label = label;
        this.active = active;
        this.excluded = excluded;
        this.showUnprepared = showUnprepared;
        this.customOnLeftClick = onLeftClick;
        this.customOnRightClick = onRightClick;
    }

    /**
     * Handle left-click on this sub-tab.
     * @param {ApplicationV2} app 
     * @param {TabSideState} sideState 
     * @param {string} parentId 
     * @param {Object} groups 
     * @param {Event} event 
     */
    onLeftClick(app, sideState, parentId, groups, event) {
        if (this.customOnLeftClick) {
            const handled = this.customOnLeftClick(app, sideState, parentId, groups, event);
            if (handled) return;
        }
        sideState.selectSub(parentId, this.id, groups);
    }

    /**
     * Handle right-click on this sub-tab.
     * @param {ApplicationV2} app 
     * @param {TabSideState} sideState 
     * @param {string} parentId 
     * @param {Object} groups 
     * @param {Event} event 
     */
    onRightClick(app, sideState, parentId, groups, event) {
        if (this.customOnRightClick) {
            const handled = this.customOnRightClick(app, sideState, parentId, groups, event);
            if (handled) return;
        }
        sideState.toggleSub(parentId, this.id, groups);
    }
}

/**
 * Represents a top-level parent HUD tab (e.g. Weapon, Spell, Action Economy).
 * Encapsulates label, icon, sub-tabs collection, and click behaviors.
 */
export class HUDTab {
    /**
     * @param {Object} options
     * @param {string} options.id Parent tab identifier
     * @param {string} options.label Localized display label
     * @param {string} options.icon CSS icon class
     * @param {HUDSubTab[]} [options.subTabs] Array of sub-tab instances
     * @param {boolean} [options.active] Whether this parent tab is active/selected
     * @param {boolean} [options.expanded] Whether this tab accordion is expanded/focused
     * @param {boolean} [options.activeParent] Whether this parent has active subtabs
     * @param {Function} [options.onLeftClick] Custom left-click handler
     * @param {Function} [options.onRightClick] Custom right-click handler
     */
    constructor({
        id,
        label = '',
        icon = 'fas fa-question',
        subTabs = [],
        active = false,
        expanded = false,
        activeParent = false,
        onLeftClick = null,
        onRightClick = null
    } = {}) {
        this.id = id;
        this.label = label;
        this.icon = icon;
        this.subTabs = subTabs.map(st => st instanceof HUDSubTab ? st : new HUDSubTab(st));
        this.active = active;
        this.expanded = expanded;
        this.activeParent = activeParent;
        this.customOnLeftClick = onLeftClick;
        this.customOnRightClick = onRightClick;
    }

    /**
     * Add a new sub-tab to this parent tab.
     * @param {Object|HUDSubTab} subTabConfig Sub-tab configuration or instance
     * @returns {HUDSubTab} The created or added HUDSubTab instance
     */
    addSubTab(subTabConfig) {
        const subTab = subTabConfig instanceof HUDSubTab ? subTabConfig : new HUDSubTab(subTabConfig);
        this.subTabs.push(subTab);
        return subTab;
    }

    /**
     * Find a sub-tab by ID.
     * @param {string} subId 
     * @returns {HUDSubTab|undefined}
     */
    getSubTab(subId) {
        return this.subTabs.find(st => st.id === subId);
    }

    /**
     * Handle left-click on this parent tab.
     * @param {ApplicationV2} app 
     * @param {TabSideState} sideState 
     * @param {Object} groups 
     * @param {Event} event 
     */
    onLeftClick(app, sideState, groups, event) {
        if (this.customOnLeftClick) {
            const handled = this.customOnLeftClick(app, sideState, groups, event);
            if (handled) return;
        }
        sideState.selectParent(this.id, groups);
    }

    /**
     * Handle right-click on this parent tab.
     * @param {ApplicationV2} app 
     * @param {TabSideState} sideState 
     * @param {Object} groups 
     * @param {Event} event 
     */
    onRightClick(app, sideState, groups, event) {
        if (this.customOnRightClick) {
            const handled = this.customOnRightClick(app, sideState, groups, event);
            if (handled) return;
        }
        sideState.toggleParent(this.id, groups);
    }
}
