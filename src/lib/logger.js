import { MODULE_ID, MODULE_TLA } from "../constants.js";

const VERBOSITY_LEVELS = {
    'error': 1,
    'warn': 2,
    'info': 3,
    'debug': 4
};

/**
 * Get the current log verbosity level from the game settings.
 * Defaults to 'warn' if the setting is not yet registered or unavailable.
 */
// Cached verbosity level to prevent repeated game.settings.get calls (extremely cheap lookups)
let cachedVerbosity = null;

function getVerbosityLevel() {
    if (cachedVerbosity !== null) return cachedVerbosity;

    try {
        if (typeof game !== 'undefined' && game.settings) {
            const setting = game.settings.get(MODULE_ID, 'logVerbosity');
            cachedVerbosity = VERBOSITY_LEVELS[setting] ?? VERBOSITY_LEVELS['warn'];
            return cachedVerbosity;
        }
    } catch (e) {
        // Settings not yet registered or game not fully initialized
    }
    return VERBOSITY_LEVELS['warn'];
}

const groupStack = [];

/**
 * Premium logging utility for Bakana's Action Display.
 * Supports levels: error, warn, info, debug, and console grouping.
 */
export const log = {
    error(message, ...args) {
        if (getVerbosityLevel() >= VERBOSITY_LEVELS['error']) {
            console.error(`${MODULE_TLA} | ${message}`, ...args);
        }
    },
    warn(message, ...args) {
        if (getVerbosityLevel() >= VERBOSITY_LEVELS['warn']) {
            console.warn(`${MODULE_TLA} | ${message}`, ...args);
        }
    },
    info(message, ...args) {
        if (getVerbosityLevel() >= VERBOSITY_LEVELS['info']) {
            console.log(`${MODULE_TLA} | ${message}`, ...args);
        }
    },
    debug(message, ...args) {
        if (getVerbosityLevel() >= VERBOSITY_LEVELS['debug']) {
            const timestamp = game?.time?.serverTime ?? 'Unknown';
            console.log(`%c[${MODULE_TLA} Debug (${timestamp})]`, "color: #38bdf8; font-weight: bold;", message, ...args);
        }
    },
    group(message, ...args) {
        let level = 'info';
        let groupArgs = args;
        if (args.length > 0 && VERBOSITY_LEVELS[args[0]] !== undefined) {
            level = args[0];
            groupArgs = args.slice(1);
        }
        if (getVerbosityLevel() >= VERBOSITY_LEVELS[level]) {
            console.group(`${MODULE_TLA} | ${message}`, ...groupArgs);
            groupStack.push(true);
        } else {
            groupStack.push(false);
        }
    },
    groupEnd() {
        if (groupStack.pop() === true) {
            console.groupEnd();
        }
    },
    /**
     * Dynamically update the cached verbosity level.
     * Called by the settings onChange callback.
     * @param {string} level The new verbosity level key
     */
    setVerbosity(level) {
        cachedVerbosity = VERBOSITY_LEVELS[level] ?? VERBOSITY_LEVELS['warn'];
    }
};
