/**
 * Helper to safely localize a key, falling back to a default string if the key is not found.
 * @param {string} key The translation key
 * @param {string} [fallback] The fallback string if the key is not found (defaults to key)
 * @returns {string} The localized string or fallback
 */
export function localize(key: string, fallback?: string | null): any {
    const defaultStr = fallback !== undefined ? fallback : key;
    if (!key) return defaultStr ?? '';
    if (!game.i18n) return defaultStr;
    if (game.i18n.has(key)) {
        return game.i18n.localize(key) ?? defaultStr;
    }
    const val = game.i18n.localize?.(key);
    return (val && val !== key) ? val : defaultStr;
}

/**
 * Helper to safely format a localized template string with data variables.
 * @param {string} key The translation key
 * @param {Object} [data={}] Interpolation data object
 * @param {string} [fallback] Fallback string
 * @returns {string} The formatted localized string
 */
export function format(key: string, data: Record<string, any> = {}, fallback?: string): string {
    const defaultStr = fallback !== undefined ? fallback : key;
    if (!key) return defaultStr ?? '';
    if (game.i18n?.format) {
        if (game.i18n.has(key)) {
            return game.i18n.format(key, data);
        }
        const val = game.i18n.format(key, data);
        if (val && val !== key) return val;
    }
    let str = localize(key, fallback);
    if (!str || str === key) {
        str = defaultStr;
    }
    if (data && typeof data === 'object' && str) {
        return str.replace(/\{(\w+)\}/g, (match: any, p1: any) => data[p1] ?? match);
    }
    return str;
}

/**
 * Safely convert an array, iterable, or existing Set into a Set.
 * Optionally transforms elements via `mapFn` without creating intermediate array allocations.
 * @param {Iterable|Set|null|undefined} input
 * @param {Function|null} [mapFn=null] Optional mapper callback (element => value)
 * @returns {Set}
 */
export function toSet(input: any, mapFn: ((item: any) => any) | null = null): Set<any> {
    if (!input) return new Set();
    if (!mapFn) {
        return input instanceof Set ? input : new Set(input);
    }
    const set = new Set();
    for (const item of input) {
        const val = mapFn(item);
        if (val != null) {
            set.add(val);
        }
    }
    return set;
}

/**
 * Efficiently determine if two Sets (or iterables) share at least one common element.
 * Iterates through the smaller set when both are Sets.
 * @param {Set|Iterable|null|undefined} setA
 * @param {Set|Iterable|null|undefined} setB
 * @returns {boolean}
 */
export function hasIntersection(setA: any, setB: any): boolean {
    if (!setA || !setB) return false;
    if (setA instanceof Set && setB instanceof Set) {
        const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
        for (const elem of smaller) {
            if (larger.has(elem)) return true;
        }
        return false;
    }
    for (const elem of setA) {
        if (setB instanceof Set ? setB.has(elem) : setB.includes?.(elem)) return true;
    }
    return false;
}

/**
 * Recursively freezes an object, its nested objects, and arrays.
 * Handles circular references safely via WeakSet.
 * @template T
 * @param {T} obj The object or array to recursively freeze
 * @param {WeakSet<object>} [seen=new WeakSet()] Visited object tracking
 * @returns {Readonly<T>} The deeply frozen object
 */
export function deepFreeze<T>(obj: T, seen: WeakSet<object> = new WeakSet()): Readonly<T> {
    if (obj === null || typeof obj !== 'object' || seen.has(obj)) {
        return obj;
    }
    seen.add(obj);
    Object.freeze(obj);
    for (const key of Reflect.ownKeys(obj)) {
        const val = (obj as any)[key];
        if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
            deepFreeze(val, seen);
        }
    }
    return obj;
}
