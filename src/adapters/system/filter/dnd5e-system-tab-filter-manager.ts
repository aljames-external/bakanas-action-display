import { BaseSystemTabFilterManager } from './base-system-tab-filter-manager.js';
import { TabRef } from '../../../ui/tab-ref.js';
import { Action } from '../../../ui/action.js';
import { log } from '../../../lib/logger.js';
import { deepFreeze } from '../../../lib/utils.js';

const COMPONENT_NAMES = deepFreeze({
    'vocal': ['vocal', 'verbal'],
    'somatic': ['somatic'],
    'material': ['material']
});

const COMPONENT_SHORT_KEYS = deepFreeze({
    'vocal': 'v',
    'somatic': 's',
    'material': 'm'
});

const SPELL_COMPONENTS = deepFreeze(['vocal', 'somatic', 'material']);

interface ReasonObject {
    name?: string;
    isDirectStatus?: boolean;
    statuses?: string[];
}

/**
 * Check if a spell item document requires a given spell component.
 * @param {Item5e} item Concrete D&D 5e item document
 * @param {string} component Component identifier ('vocal'|'somatic'|'material')
 * @returns {boolean}
 */
export function itemHasComponent(item: Item5e, component: string): boolean {
    const names = (COMPONENT_NAMES as Record<string, readonly string[]>)[component] ?? [component];
    const shortKey = (COMPONENT_SHORT_KEYS as Record<string, string>)[component];

    // 1. Check system.properties (Set or array of spell property names: 'vocal', 'somatic', 'material')
    const props = item.system?.properties;
    if (props) {
        if ('has' in props) {
            if (names.some(name => props.has(name))) return true;
        } else if (names.some(name => props.includes(name))) {
            return true;
        }
    }

    // 2. Check system.components (Boolean map: { vocal: true, v: true, material: true, m: true })
    const comps = item.system?.components;
    if (comps) {
        if (names.some(name => Boolean(comps[name])) || Boolean(shortKey && comps[shortKey])) return true;
    }

    return false;
}

/**
 * Tab filter manager for D&D 5th Edition.
 * Handles spell component exclusion logic (e.g. Silence, restrained).
 */
export class Dnd5eSystemTabFilterManager extends BaseSystemTabFilterManager {
    declare adapter: Dnd5eSystemAdapter;

    /**
     * @param {Dnd5eSystemAdapter} adapter Owning D&D 5e adapter instance
     */
    constructor(adapter: Dnd5eSystemAdapter) {
        super(adapter);
    }

    /**
     * Extract the underlying concrete spell item document from an action.
     * @param {Action} action HUD Action object
     * @returns {Item5e|null}
     * @private
     */
    #extractSpellItem(action: Action): Item5e | null {
        if (!action) return null;

        // 1. Direct spell original item on action
        const origItem = action.originalItem as Item5e | null;
        if (origItem?.type === 'spell') {
            return origItem;
        }

        // 2. Cast activity with linked spell on action
        const activity = action.originalActivity as Dnd5eActivity | null;
        if (activity?.type === 'cast') {
            const spell = (activity.spell ?? activity.item) as Item5e | null;
            if (spell?.type === 'spell' || Boolean(spell?.system?.properties)) {
                return spell;
            }
        }

        // 3. Linked spell document resolved via system adapter
        const rootDoc = this.adapter.resolveRootSpellDocument(action) as Item5e | null;
        if (rootDoc && (rootDoc.type === 'spell' || Boolean(rootDoc.system?.properties))) {
            return rootDoc;
        }

        // 4. Linked action item or subaction
        const linked = action.linkedAction;
        if (linked) {
            if ('system' in linked && (linked as Item5e).type === 'spell') {
                return linked as Item5e;
            }
            const linkedOrigItem = (linked as Action).originalItem as Item5e | null;
            if (linkedOrigItem?.type === 'spell') {
                return linkedOrigItem;
            }
        }

        return null;
    }

    /**
     * Check if an action requires a given verbal/somatic/material component.
     * Non-spell actions without a cast activity or linked spell do not require spell components.
     * @param {Action} action HUD Action object
     * @param {string} component Component identifier ('vocal'|'somatic'|'material')
     * @returns {boolean}
     */
    requiresComponent(action: Action, component: string): boolean {
        const item = this.#extractSpellItem(action);
        if (!item) return false;
        return itemHasComponent(item, component);
    }

    /**
     * Build TabRef objects for each spell component required by an action.
     * @param {Action} action HUD Action object
     * @returns {TabRef[]}
     */
    getComponentTabs(action: Action): TabRef[] {
        const item = this.#extractSpellItem(action);
        if (!item) return [];
        return SPELL_COMPONENTS
            .filter(comp => itemHasComponent(item, comp))
            .map(comp => TabRef.from('components', comp));
    }

    /**
     * Get the set-combinator for right-side tabs ('difference' for components in D&D 5e).
     * @param {string} parentId Parent tab ID
     * @returns {'union'|'intersection'|'difference'}
     */
    override getTabCombinator(parentId: string): 'union' | 'intersection' | 'difference' {
        return parentId === 'components' ? 'difference' : super.getTabCombinator(parentId);
    }

    /**
     * Get the canonical sub-tab IDs for an exclusion parent tab ('components' -> ['vocal', 'somatic', 'material']).
     * @param {string} parentId Parent tab ID
     * @returns {string[]}
     */
    override getExclusionSubTabs(parentId: string): string[] {
        return parentId === 'components' ? [...SPELL_COMPONENTS] : super.getExclusionSubTabs(parentId);
    }

    /**
     * Format an array of reason objects or strings into a readable text list.
     * @param {Array<ReasonObject|string>} reasons
     * @returns {string}
     * @private
     */
    #formatReasonsText(reasons: (ReasonObject | string)[]): string {
        if (!Array.isArray(reasons)) return '';
        return reasons.map(r => {
            if (!r) return '';
            if (typeof r !== 'string') {
                if (r.isDirectStatus) return r.name ?? '';
                if (r.statuses?.length) {
                    return `${r.name ?? ''} (${r.statuses.join(', ')})`;
                }
                return String(r.name ?? '');
            }
            return String(r);
        }).join(', ');
    }

    /**
     * Determine whether an action matches economy and spell component exclusion tabs in D&D 5e.
     * Logs causing effect reasons and current ban lists to log.debug when component bans are active.
     * @param {Action} action HUD Action object
     * @param {FilterContext} filterContext Active filter state
     * @returns {boolean}
     */
    override matchesEconomyTabs(action: Action, filterContext: FilterContext): boolean {
        if (!action) return false;
        const activeCompSubs = this.getActiveExclusionSubs(filterContext);

        if (!filterContext?._inFilterSubactions && activeCompSubs.length > 0) {
            const actor = filterContext?.actor ?? this.adapter?.actor ?? action.originalItem?.actor ?? null;
            const effectReasons = this.adapter.getAutoBanEffectReasons(actor) ?? {};

            log.debug(`Dnd5eSystemTabFilterManager.matchesEconomyTabs | Evaluating action "${action.name}" (${action.id}) against active component ban lists: [${activeCompSubs.join(', ')}] | Effect causing reasons:`, effectReasons);

            // If action has no subactions, evaluate direct component bans on action
            if (!action.subactions?.length) {
                const matchedBannedComp = activeCompSubs.find(comp => this.requiresComponent(action, comp) || action.right?.some((tab: TabRef) => tab.root === 'components' && tab.label === comp));
                if (matchedBannedComp) {
                    const reasons = (effectReasons as Record<string, (ReasonObject | string)[]>)[matchedBannedComp] ?? [];
                    const reasonsText = this.#formatReasonsText(reasons);
                    log.debug(`Dnd5eSystemTabFilterManager.matchesEconomyTabs | Skipping action "${action.name}" (${action.id}) — requires banned component "${matchedBannedComp}" caused by effect(s): [${reasonsText}] | Current ban lists: [${activeCompSubs.join(', ')}]`, { action, bannedComponent: matchedBannedComp, reasons, activeCompSubs });
                    return false;
                }
            }
        }

        return super.matchesEconomyTabs(action, filterContext);
    }

    /**
     * Filter subactions taking D&D 5e spell component exclusions into account.
     * Logs causing effect reasons and current ban lists to log.debug when filtering.
     * @param {Action[]} subactions Array of subactions
     * @param {FilterContext} filterContext Active filter state
     * @returns {Action[]} Qualifying subactions
     */
    override filterSubactions(subactions: Action[], filterContext: FilterContext): Action[] {
        const baseFiltered = super.filterSubactions(subactions, { ...filterContext, _inFilterSubactions: true });
        const activeCompSubs = this.getActiveExclusionSubs(filterContext);

        if (activeCompSubs.length === 0) {
            return baseFiltered;
        }

        const actor = filterContext?.actor ?? this.adapter?.actor ?? subactions[0]?.originalItem?.actor ?? null;
        const effectReasons = this.adapter.getAutoBanEffectReasons(actor) ?? {};

        log.debug(`Dnd5eSystemTabFilterManager.filterSubactions | Current ban lists: [${activeCompSubs.join(', ')}] | Effect causing reasons:`, effectReasons);

        return baseFiltered.filter((sub: Action) => {
            const matchedBannedComp = activeCompSubs.find(comp => this.requiresComponent(sub, comp) || sub.right?.some((tab: TabRef) => tab.root === 'components' && tab.label === comp));
            if (matchedBannedComp) {
                const reasons = (effectReasons as Record<string, (ReasonObject | string)[]>)[matchedBannedComp] ?? [];
                const reasonsText = this.#formatReasonsText(reasons);
                log.debug(`Dnd5eSystemTabFilterManager.filterSubactions | Filtering out "${sub.name}" (${sub.id}) — requires banned component "${matchedBannedComp}" caused by effect(s): [${reasonsText}] | Current ban lists: [${activeCompSubs.join(', ')}]`, { sub, bannedComponent: matchedBannedComp, reasons, activeCompSubs });
                return false;
            }
            return true;
        });
    }
}

