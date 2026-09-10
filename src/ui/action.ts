import { TabRef } from './tab-ref.js';

export interface ActionOptions {
    id: string;
    name: string;
    type?: string;
    img?: string;
    page?: number;
    right?: TabRef[];
    left?: string[];
    itemCategories?: string[][] | null;
    hidden?: boolean;
    isHidden?: boolean;
    available?: boolean;
    uses?: { available?: number | string | null; max?: number | string | null; isUpcast?: boolean; [key: string]: unknown };
    roll?: ((event?: Event | MouseEvent) => unknown) | null;
    originalItem?: Item | null;
    subactions?: Action[];
    originalActivity?: Dnd5eActivity | null;
    linkedAction?: Action | Item | null;
    collapseDropdownIfSingle?: boolean;
    extra?: Record<string, unknown>;
    economyIndicators?: unknown[];
    isActive?: boolean;
    activationType?: string;
    excludeFromAll?: boolean;
}

/**
 * Encapsulates a top-level action or sub-action displayed in the Bakana's Action Display HUD.
 */
export class Action {
    id: string;
    name: string;
    type: string;
    img: string;
    page: number;
    left: string[];
    right: TabRef[];
    itemCategories: string[][] | null;
    hidden: boolean;
    isHidden: boolean;
    available: boolean;
    uses: { available?: number | string | null; max?: number | string | null; isUpcast?: boolean; [key: string]: unknown };
    roll: ((event?: Event | MouseEvent) => unknown) | null;
    originalItem: Item | null;
    subactions: Action[];
    originalActivity: Dnd5eActivity | null;
    linkedAction: Action | Item | null;
    collapseDropdownIfSingle: boolean;
    extra: Record<string, unknown>;
    economyIndicators?: unknown[];
    isActive: boolean;
    activationType?: string;
    excludeFromAll: boolean;

    /**
     * @param {Object} options
     * @param {string} options.id Unique item/action/activity ID
     * @param {string} options.name Display name of the action
     * @param {string} [options.type=''] Foundry Item or Activity type
     * @param {string} [options.img=''] Icon image URL/path
     * @param {TabRef[]} [options.right] Array of TabRef instances for right-side tabs
     * @param {string[]} [options.left] Hierarchical category list for left-side tabs
     * @param {string[]|null} [options.itemCategories=null] Custom categorization hierarchy
     * @param {boolean} [options.hidden=false] System-level hidden state
     * @param {boolean} [options.isHidden=false] User-flagged hidden override state
     * @param {boolean} [options.available=true] Action availability state
     * @param {Object} [options.uses] Resource tracking object { available, max, isUpcast, ... }
     * @param {Function|null} [options.roll=null] Async roll callback
     * @param {number} [options.page=1] Target pagination page (1-indexed)
     * @param {Action[]} [options.subactions=[]] Array of child Action instances
     * @param {Object|null} [options.originalActivity=null] Underlying system Activity instance
     * @param {Object|null} [options.linkedAction=null] Linked document/item data (e.g. compendium spell)
     * @param {boolean} [options.collapseDropdownIfSingle=false] Collapse dropdown if only one subaction qualifies
     * @param {Object} [options.extra={}] Additional metadata
     * @param {boolean} [options.isActive=false] Primary active state
     * @param {string} [options.activationType] Normalized activation type
     * @param {boolean} [options.excludeFromAll=false] Exclude from 'All' tab
     */
    constructor({
        id,
        name,
        type = '',
        img = '',
        page = 1,
        right = [TabRef.from('all')],
        left = [],
        itemCategories = null,
        hidden = false,
        isHidden = false,
        available = true,
        uses = { available: null, max: null },
        roll = null,
        originalItem = null,
        subactions = [],
        originalActivity = null,
        linkedAction = null,
        collapseDropdownIfSingle = false,
        extra = {},
        isActive = false,
        activationType,
        excludeFromAll = false
    }: ActionOptions) {
        this.id = id;
        this.name = name;
        this.type = type;
        this.img = img;
        const parsedPage = Number(page);
        this.page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
        this.left = left;
        this.right = right;
        this.itemCategories = itemCategories;
        this.hidden = hidden;
        this.isHidden = isHidden;
        this.available = available;
        this.uses = uses;
        this.roll = roll;
        this.originalItem = originalItem;
        this.subactions = subactions;
        this.originalActivity = originalActivity;
        this.linkedAction = linkedAction;
        this.collapseDropdownIfSingle = collapseDropdownIfSingle;
        this.extra = extra;
        this.isActive = isActive;
        this.activationType = activationType;
        this.excludeFromAll = excludeFromAll;
    }

    /**
     * Helper: check if action has sub-actions
     * @returns {boolean}
     */
    get hasSubactions() {
        return this.subactions.length > 0;
    }

    /**
     * Helper: check if action is depleted of resources
     * @returns {boolean}
     */
    get isDepleted() {
        if (this.uses?.available == null) return false;
        return Number(this.uses.available) <= 0 && !this.uses.isUpcast;
    }
}
