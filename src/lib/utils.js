/**
 * Helper to safely localize a key, falling back to a default string if the key is not found.
 * @param {string} key The translation key
 * @param {string} fallback The fallback string if the key is not found
 * @returns {string} The localized string or fallback
 */
export function localize(key, fallback) {
    return game.i18n?.has(key) ? game.i18n.localize(key) : fallback;
}
