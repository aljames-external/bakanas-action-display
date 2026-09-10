import { BaseSystemTabFilterManager } from './base-system-tab-filter-manager.js';
import { TabRef } from '../../../ui/tab-ref.js';
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

/**
 * Check if a document or its system properties/components include a given spell component.
 * @param {Object} doc Item, activity, or spell document
 * @param {string} component Component identifier
 * @returns {boolean}
 */
function docHasComponent(doc: any, component: any) {
    if (!doc) return false;
    const names = (COMPONENT_NAMES as Record<string, string[]>)[component] ?? [component];
    const shortKey = (COMPONENT_SHORT_KEYS as Record<string, string>)[component];

    // 1. Check system.properties (Set of full spell property names: 'vocal', 'somatic', 'material')
    const props = doc.system?.properties ?? doc.spell?.system?.properties ?? doc.properties;
    if (props) {
        if (names.some((name: any) => props.has?.(name) || props.includes?.(name))) return true;
    }

    // 2. Check system.components (Boolean map: { vocal: true, v: true, material: true, m: true })
    const comps = doc.system?.components ?? doc.spell?.system?.components ?? doc.components;
    if (comps) {
        if (names.some((name: any) => Boolean(comps[name])) || Boolean(shortKey && comps[shortKey])) return true;
    }

    return false;
}

/**
 * Tab filter manager for D&D 5th Edition.
 * Handles spell component exclusion logic (e.g. Silence, restrained).
 */
export class Dnd5eSystemTabFilterManager extends BaseSystemTabFilterManager {
    /**
     * @param {Dnd5eSystemAdapter} adapter Owning D&D 5e adapter instance
     */
    constructor(adapter: any) {
        super(adapter);
    }

    /**
     * Check if a spell, item, or activity requires a given verbal/somatic/material component.
     * Non-spell items (weapons, equipment, feats, tools, etc.) without a cast activity or linked spell do not require spell components.
     * @param {Object} sub Subaction, activity, or item object
     * @param {string} component Component identifier ('vocal'|'somatic'|'material')
     * @returns {boolean}
     */
    requiresComponent(sub: any, component: any) {
        if (!sub) return false;

        // 1. Direct spell document check (item or subaction of type 'spell')
        if (sub.type === 'spell') {
            return docHasComponent(sub, component);
        }

        const origItem = sub.originalItem;
        if (origItem?.type === 'spell') {
            return docHasComponent(origItem, component);
        }

        // 2. Cast activity check (activities that cast a spell)
        const activity = sub.originalActivity;
        if (activity?.type === 'cast') {
            if (docHasComponent(activity, component)) return true;
            if (activity.spell && docHasComponent(activity.spell, component)) return true;
        }

        // 3. Linked spell document check (compendium spell or cached spell)
        const rootDoc = this.adapter.resolveRootSpellDocument?.(sub) ?? null;
        if (rootDoc && (rootDoc.type === 'spell' || rootDoc.type === 'cast' || rootDoc.spell)) {
            if (docHasComponent(rootDoc, component)) return true;
        }

        if (sub.linkedAction && (sub.linkedAction.type === 'spell' || sub.linkedAction.type === 'cast' || sub.linkedAction.spell)) {
            if (docHasComponent(sub.linkedAction, component)) return true;
        }

        return false;
    }

    /**
     * Build TabRef objects for each spell component required by a document.
     * @param {Object} doc Document or activity
     * @returns {TabRef[]}
     */
    getComponentTabs(doc: any) {
        return SPELL_COMPONENTS
            .filter(comp => this.requiresComponent(doc, comp))
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
     * @param {Array<Object|string>} reasons
     * @returns {string}
     * @private
     */
    #formatReasonsText(reasons: any) {
        if (!Array.isArray(reasons)) return '';
        return reasons.map(r => {
            if (!r) return '';
            if (r.isDirectStatus) return r.name;
            if (r.statuses?.length) {
                return `${r.name} (${r.statuses.join(', ')})`;
            }
            return String(r.name ?? r);
        }).join(', ');
    }

    /**
     * Determine whether an action matches economy and spell component exclusion tabs in D&D 5e.
     * Logs causing effect reasons and current ban lists to log.debug when component bans are active.
     * @param {Object} action HUD Action object
     * @param {Object} filterContext Active filter state
     * @returns {boolean}
     */
    matchesEconomyTabs(action: any, filterContext: any) {
        if (!action) return false;
        const activeCompSubs = this.getActiveExclusionSubs(filterContext);

        if (!filterContext?._inFilterSubactions && activeCompSubs.length > 0) {
            const actor = filterContext?.actor ?? this.adapter?.actor ?? action.actor ?? action.originalItem?.actor ?? null;
            const effectReasons = this.adapter?.getAutoBanEffectReasons?.(actor) ?? {};

            log.debug(`Dnd5eSystemTabFilterManager.matchesEconomyTabs | Evaluating action "${action.name}" (${action.id}) against active component ban lists: [${activeCompSubs.join(', ')}] | Effect causing reasons:`, effectReasons);

            // If action has no subactions, evaluate direct component bans on action
            if (!action.subactions?.length) {
                const matchedBannedComp = activeCompSubs.find(comp => this.requiresComponent(action, comp) || action.right?.some((tab: any) => tab.root === 'components' && tab.label === comp));
                if (matchedBannedComp) {
                    const reasons = effectReasons[matchedBannedComp] ?? [];
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
     * @param {Object[]} subactions Array of subactions
     * @param {Object} filterContext Active filter state
     * @returns {Object[]} Qualifying subactions
     */
    filterSubactions(subactions: any, filterContext: any) {
        const baseFiltered = super.filterSubactions(subactions, { ...filterContext, _inFilterSubactions: true });
        const activeCompSubs = this.getActiveExclusionSubs(filterContext);

        if (activeCompSubs.length === 0) {
            return baseFiltered;
        }

        const actor = filterContext?.actor ?? this.adapter?.actor ?? subactions?.[0]?.actor ?? subactions?.[0]?.originalItem?.actor ?? null;
        const effectReasons = this.adapter?.getAutoBanEffectReasons?.(actor) ?? {};

        log.debug(`Dnd5eSystemTabFilterManager.filterSubactions | Current ban lists: [${activeCompSubs.join(', ')}] | Effect causing reasons:`, effectReasons);

        return baseFiltered.filter((sub: any) => {
            const matchedBannedComp = activeCompSubs.find(comp => this.requiresComponent(sub, comp) || sub.right?.some((tab: any) => tab.root === 'components' && tab.label === comp));
            if (matchedBannedComp) {
                const reasons = effectReasons[matchedBannedComp] ?? [];
                const reasonsText = this.#formatReasonsText(reasons);
                log.debug(`Dnd5eSystemTabFilterManager.filterSubactions | Filtering out "${sub.name}" (${sub.id}) — requires banned component "${matchedBannedComp}" caused by effect(s): [${reasonsText}] | Current ban lists: [${activeCompSubs.join(', ')}]`, { sub, bannedComponent: matchedBannedComp, reasons, activeCompSubs });
                return false;
            }
            return true;
        });
    }
}

