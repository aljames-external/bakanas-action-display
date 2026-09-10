import { log } from '../lib/logger.js';
import { deepFreeze } from '../lib/utils.js';

const sortByName = (a: { name?: string | null }, b: { name?: string | null }) => (a.name ?? '').localeCompare(b.name ?? '');

export interface SubCategory {
    id: string;
    name: string;
    expression: string;
}

export interface Category {
    id: string;
    name: string;
    expression: string;
    fallthrough?: boolean;
    subcategories: SubCategory[];
}

export interface CategorizationConfig {
    enabled: boolean;
    categories: Category[];
}

export interface CategorizedSubsection {
    name: string;
    items: Action[];
}

export interface CategorizedSection {
    name: string;
    items: Action[];
    subsections: CategorizedSubsection[];
}

/**
 * Normalizes raw or partial categorization configuration into a strict contract object.
 *
 * @param {Object} [raw] Raw configuration object from settings or user input
 * @returns {CategorizationConfig} Strict normalized configuration
 */
export function normalizeCategorizationConfig(raw: unknown): CategorizationConfig {
    const rawObj = raw as { enabled?: boolean; categories?: unknown[] } | null | undefined;
    const enabled = Boolean(rawObj?.enabled);
    const rawCategories = (rawObj?.categories ?? []) as Array<Record<string, unknown> | null | undefined>;

    const categories: Category[] = rawCategories.map((cat, catIndex: number) => {
        const catId = (cat?.id as string | undefined) ?? `cat_${Date.now()}_${catIndex}`;
        const name = (cat?.name as string | undefined) ?? '';
        const expression = (cat?.expression as string | undefined) ?? '';
        const fallthrough = Boolean(cat?.fallthrough);
        const rawSubs = (cat?.subcategories ?? []) as Array<Record<string, unknown> | null | undefined>;

        const subcategories: SubCategory[] = rawSubs.map((sub, subIndex: number) => {
            const subId = (sub?.id as string | undefined) ?? `sub_${Date.now()}_${subIndex}`;
            const subName = (sub?.name as string | undefined) ?? '';
            const subExpr = (sub?.expression as string | undefined) ?? '';
            return {
                id: subId,
                name: subName,
                expression: subExpr
            };
        });

        return {
            id: catId,
            name,
            expression,
            fallthrough,
            subcategories
        };
    });

    return {
        enabled,
        categories
    };
}

const expressionCache = new Map<string, Function>();

/**
 * Retrieve or compile a reusable evaluator function for a boolean expression.
 * @param {string} expr Trimmed boolean expression string
 * @returns {Function}
 */
function getCompiledExpression(expr: string): Function {
    let fn = expressionCache.get(expr);
    if (!fn) {
        fn = new Function(
            'action', 'item', 'actor', 'token', 'user',
            `"use strict"; return Boolean(${expr});`
        );
        expressionCache.set(expr, fn);
    }
    return fn;
}

/**
 * Validate syntax of a boolean expression string.
 *
 * @param {string} expression JS boolean expression
 * @returns {{ valid: boolean, error: string|null }} Validation result
 */
export function validateExpression(expression: string | null | undefined): { valid: boolean; error: string | null } {
    const expr = typeof expression === 'string' ? expression.trim() : '';
    if (!expr) {
        return { valid: false, error: 'Expression cannot be empty.' };
    }
    try {
        getCompiledExpression(expr);
        return { valid: true, error: null };
    } catch (err) {
        return { valid: false, error: (err as Error)?.message ?? 'Syntax error' };
    }
}

/**
 * Safely evaluates a boolean expression string against an Action instance.
 *
 * @param {string} expression JS boolean expression
 * @param {Object} action The Action instance being evaluated
 * @param {Object} [context={}] Additional context such as actor, token, or user documents
 * @returns {boolean} True if expression evaluates to truthy
 */
export function evaluateBooleanExpression(expression: string, action: Action, context: Record<string, unknown> = {}): boolean {
    const expr = typeof expression === 'string' ? expression.trim() : '';
    if (!expr) return false;

    try {
        const item = action?.originalItem ?? action;
        const actor = (context?.actor as Actor | undefined) ?? action?.actor ?? null;
        const token = (context?.token as Token | undefined) ?? action?.token ?? null;
        const user = context?.user ?? game.user ?? null;

        const evaluator = getCompiledExpression(expr);
        return Boolean(evaluator(action, item, actor, token, user));
    } catch (err) {
        log.error(`Failed to evaluate boolean expression: "${expression}"`, err);
        return false;
    }
}

interface SubBucket {
    subcategory: SubCategory;
    items: Action[];
}

interface CategoryBucket {
    category: Category;
    directItems: Action[];
    subBuckets: Map<string, SubBucket>;
    othersItems: Action[];
}

/**
 * Categorizes and groups a list of actions into structured sections and subsections.
 *
 * @param {Object[]} actions Actions array
 * @param {Object} config Raw or normalized categorization config
 * @param {string} catchAllLabel Localized label for unmatched/remainder actions
 * @param {Object} [context={}] Additional evaluation context { actor, token, user }
 * @returns {CategorizedSection[]|null} Grouped category sections or null if disabled
 */
export function categorizeActions(actions: Action[] | null | undefined, config: unknown, catchAllLabel: string | null | undefined, context: Record<string, unknown> = {}): CategorizedSection[] | null {
    const normalizedConfig = normalizeCategorizationConfig(config);
    if (!normalizedConfig.enabled || normalizedConfig.categories.length === 0) {
        return null;
    }

    const trimmed = typeof catchAllLabel === 'string' ? catchAllLabel.trim() : '';
    const othersLabel = (trimmed && trimmed.length > 0) ? trimmed : 'Other Actions';

    // Map each category to an internal bucket structure
    const categoryMap = new Map<string, CategoryBucket>();
    for (const cat of normalizedConfig.categories) {
        const subMap = new Map<string, SubBucket>();
        for (const sub of cat.subcategories) {
            subMap.set(sub.id, {
                subcategory: sub,
                items: []
            });
        }
        categoryMap.set(cat.id, {
            category: cat,
            directItems: [],
            subBuckets: subMap,
            othersItems: []
        });
    }

    const topLevelOthers: Action[] = [];

    // Distribute each action into matching categories / subcategories
    for (const action of (actions ?? [])) {
        let consumed = false;

        for (const bucket of categoryMap.values()) {
            if (evaluateBooleanExpression(bucket.category.expression, action, context)) {
                const hasSubcategories = bucket.category.subcategories.length > 0;
                if (hasSubcategories) {
                    let matchedSubBucket: SubBucket | null = null;
                    for (const subEntry of bucket.subBuckets.values()) {
                        if (evaluateBooleanExpression(subEntry.subcategory.expression, action, context)) {
                            matchedSubBucket = subEntry;
                            break;
                        }
                    }

                    if (matchedSubBucket) {
                        matchedSubBucket.items.push(action);
                    } else {
                        // Remainder at subcategory level
                        bucket.othersItems.push(action);
                    }
                } else {
                    // No subcategories defined for this category
                    bucket.directItems.push(action);
                }

                if (!bucket.category.fallthrough) {
                    consumed = true;
                    break;
                }
            }
        }

        if (!consumed) {
            // Remainder at top level (not matched by any category, or only matched by fallthrough categories)
            topLevelOthers.push(action);
        }
    }

    // Build the final output structure containing only non-empty sections and subsections
    const categorizedSections: CategorizedSection[] = [];

    for (const bucket of categoryMap.values()) {
        let subItemsCount = 0;
        for (const s of bucket.subBuckets.values()) {
            subItemsCount += s.items.length;
        }
        const totalItemsInCat = bucket.directItems.length + bucket.othersItems.length + subItemsCount;

        if (totalItemsInCat === 0) continue;

        const subsections: CategorizedSubsection[] = [];
        for (const subEntry of bucket.subBuckets.values()) {
            if (subEntry.items.length > 0) {
                subEntry.items.sort(sortByName);
                subsections.push({
                    name: subEntry.subcategory.name,
                    items: subEntry.items
                });
            }
        }

        if (bucket.othersItems.length > 0) {
            bucket.othersItems.sort(sortByName);
            subsections.push({
                name: othersLabel,
                items: bucket.othersItems
            });
        }

        bucket.directItems.sort(sortByName);
        categorizedSections.push({
            name: bucket.category.name,
            items: bucket.directItems,
            subsections
        });
    }

    if (topLevelOthers.length > 0) {
        topLevelOthers.sort(sortByName);
        categorizedSections.push({
            name: othersLabel,
            items: topLevelOthers,
            subsections: []
        });
    }

    return categorizedSections;
}

export const DEFAULT_CATEGORIES = deepFreeze([
    {
        id: 'cat_favorites',
        name: 'Favorites',
        expression: `actor.getFlag('bakana-action-display', 'favorites')?.[item.id]`,
        subcategories: []
    },
    {
        id: 'cat_weapons',
        name: 'Weapons',
        expression: `item.type === 'weapon'`,
        subcategories: []
    },
    {
        id: 'cat_spells',
        name: 'Spells',
        expression: `item.type === 'spell'`,
        subcategories: []
    },
    {
        id: 'cat_features',
        name: 'Features',
        expression: `item.type === 'feat'`,
        subcategories: []
    }
]);

/**
 * Returns default preset categories, delegating to a custom system adapter if provided.
 *
 * @param {Object} [customAdapter=null] Optional adapter override
 * @returns {Category[]} Default category list
 */
export function getDefaultCategories(customAdapter: { getDefaultCategories?: () => unknown[] | null } | null = null): Category[] {
    const custom = customAdapter?.getDefaultCategories?.();
    return (custom ? (custom as Category[]) : (DEFAULT_CATEGORIES as unknown as Category[]));
}
