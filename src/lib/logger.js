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
function getVerbosityLevel() {
    try {
        if (typeof game !== 'undefined' && game.settings) {
            const setting = game.settings.get(MODULE_ID, 'logVerbosity');
            return VERBOSITY_LEVELS[setting] ?? VERBOSITY_LEVELS['warn'];
        }
    } catch (e) {
        // Settings not yet registered
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
    }
};
