import { adapter } from '../adapters/index.js';
import { MODULE_ID } from '../constants.js';

export type HUDTabClickCallback = (
    app: ActionDisplayApp,
    tabColumn: HUDTabColumn,
    groups: Record<string, HUDTab>,
    event?: MouseEvent | PointerEvent | Event
) => boolean | void;

export interface HUDTabOptions {
    id: string;
    label?: string;
    icon?: string;
    level?: number;
    combinator?: 'union' | 'intersection' | 'difference' | string;
    active?: boolean;
    expanded?: boolean;
    activeParent?: boolean;
    excluded?: boolean;
    showUnprepared?: boolean;
    subTabs?: Array<HUDTab | HUDTabOptions>;
    tooltip?: string;
    onLeftClick?: HUDTabClickCallback | null;
    onRightClick?: HUDTabClickCallback | null;
}

/**
 * Unified tab model for parent tabs, sub-tabs, and deeply nested sub-tabs in the HUD.
 * Every node in the tab hierarchy is a HUDTab instance with a level indicator (0 = top-level parent).
 */
export class HUDTab {
    id: string;
    label: string;
    icon: string;
    tooltip: string;
    private _level: number;
    combinator: string;
    private _parent: HUDTab | null;
    rootParent: HUDTab;
    active: boolean;
    expanded: boolean;
    activeParent: boolean;
    excluded: boolean;
    showUnprepared: boolean;
    customOnLeftClick: HUDTabClickCallback | null;
    customOnRightClick: HUDTabClickCallback | null;
    subTabs: HUDTab[];

    /**
     * @param {HUDTabOptions} options
     */
    constructor({
        id,
        label = '',
        icon = 'fas fa-question',
        level = 0,
        combinator = 'union',
        active = false,
        expanded = false,
        activeParent = false,
        excluded = false,
        showUnprepared = false,
        subTabs = [],
        tooltip = '',
        onLeftClick = null,
        onRightClick = null
    }: HUDTabOptions) {
        this.id = id;
        this.label = label;
        this.icon = icon;
        this.tooltip = tooltip;
        this._level = level;
        this.combinator = combinator;
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
    get parent(): HUDTab | null {
        return this._parent;
    }

    set parent(parentTab: HUDTab | null) {
        this._parent = parentTab;
        const newRoot = parentTab ? (parentTab.rootParent ?? parentTab) : this;
        this._setRootParent(newRoot);
    }

    /**
     * Internal helper to assign rootParent pointer down the child sub-tree.
     * @param {HUDTab} root 
     * @private
     */
    _setRootParent(root: HUDTab): void {
        this.rootParent = root;
        if (this.subTabs.length > 0) {
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
    get level(): number {
        if (this.parent) {
            return this.parent.level + 1;
        }
        return this._level;
    }

    set level(val: number) {
        this._level = val;
    }

    /**
     * Is this a top-level parent tab (level 0)?
     * @type {boolean}
     */
    get isTopLevel(): boolean {
        return this.level === 0;
    }

    /**
     * Add a child sub-tab under this tab.
     * Automatically establishes parent link and derives child depth level.
     * @param {HUDTab|HUDTabOptions} subTabConfig Sub-tab configuration or instance
     * @returns {HUDTab} The created or added child HUDTab instance
     */
    addSubTab(subTabConfig: HUDTab | HUDTabOptions): HUDTab {
        const subTab: HUDTab = subTabConfig instanceof HUDTab
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
    getOrder(): string[] {
        return this.subTabs.map(t => t.id);
    }

    /**
     * Update and re-order child sub-tabs using an array of ordered sub-tab IDs.
     * @param {string[]} orderArray Array of sub-tab IDs in the desired display order
     */
    updateOrder(orderArray: string[]): void {
        if (!Array.isArray(orderArray) || this.subTabs.length === 0) return;
        const orderMap = new Map(orderArray.map((id, index) => [id, index]));
        this.subTabs.sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
    }

    /**
     * Recursively search for a sub-tab by ID.
     * @param {string} subId 
     * @returns {HUDTab|undefined}
     */
    getSubTab(subId: string): HUDTab | undefined {
        for (const st of this.subTabs) {
            if (st.id === subId) return st;
            const found = st.getSubTab(subId);
            if (found) return found;
        }
        return undefined;
    }

    /**
     * Recursively collect all descendant sub-tab IDs under this tab.
     * @param {Set<string>} [ids=new Set()] Accumulator set for recursive collection
     * @returns {Set<string>} Set of all sub-tab and nested sub-tab IDs
     */
    getAllSubTabIds(ids: Set<string> = new Set<string>()): Set<string> {
        for (const st of this.subTabs) {
            ids.add(st.id);
            st.getAllSubTabIds(ids);
        }
        return ids;
    }


    /**
     * Handle left-click on this tab.
     * @param {ActionDisplayApp} app 
     * @param {HUDTabColumn} tabColumn 
     * @param {Record<string, HUDTab>} groups Tab groups dictionary
     * @param {MouseEvent|PointerEvent|Event} [event] 
     */
    onLeftClick(
        app: ActionDisplayApp,
        tabColumn: HUDTabColumn,
        groups: Record<string, HUDTab>,
        event?: MouseEvent | PointerEvent | Event
    ): void {
        if (this.customOnLeftClick) {
            const handled = this.customOnLeftClick(app, tabColumn, groups, event);
            if (handled) return;
        }
        const hasShift = Boolean((event as MouseEvent | undefined)?.shiftKey);
        if (hasShift || game.settings.get(MODULE_ID, 'toggleTabSelection')) {
            if (this.isTopLevel) {
                tabColumn.toggleParent(this.id, groups);
            } else {
                const rootId = this.rootParent?.id ?? this.parent?.id ?? this.id;
                const isExclusion = adapter.isExclusionTab(rootId);
                tabColumn.toggleSub(rootId, this.id, groups, isExclusion);
            }
            return;
        }
        if (this.isTopLevel) {
            tabColumn.selectParent(this.id, groups);
        } else {
            const rootId = this.rootParent?.id ?? this.parent?.id ?? this.id;
            const isExclusion = adapter.isExclusionTab(rootId);
            tabColumn.selectSub(rootId, this.id, groups, isExclusion);
        }
    }

    /**
     * Handle right-click on this tab.
     * @param {ActionDisplayApp} app 
     * @param {HUDTabColumn} tabColumn 
     * @param {Record<string, HUDTab>} groups Tab groups dictionary
     * @param {MouseEvent|PointerEvent|Event} [event] 
     */
    onRightClick(
        app: ActionDisplayApp,
        tabColumn: HUDTabColumn,
        groups: Record<string, HUDTab>,
        event?: MouseEvent | PointerEvent | Event
    ): void {
        if (this.customOnRightClick) {
            const handled = this.customOnRightClick(app, tabColumn, groups, event);
            if (handled) return;
        }
        if (this.isTopLevel) {
            tabColumn.toggleParent(this.id, groups);
        } else {
            const rootId = this.rootParent?.id ?? this.parent?.id ?? this.id;
            const isExclusion = adapter.isExclusionTab(rootId);
            tabColumn.toggleSub(rootId, this.id, groups, isExclusion);
        }
    }
}
