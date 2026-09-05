import { MODULE_ID, MODULE_NAME, MODULE_TLA } from "../constants.js";

export const VERBOSITY_LEVELS = Object.freeze({
    error: 1,
    warn: 2,
    info: 3,
    debug: 4
});

export const GROUP_STYLES = Object.freeze({
    error: "color: #ef4444; font-weight: bold;",
    warn: "color: #f59e0b; font-weight: bold;",
    info: "color: #ffffff; font-weight: bold;",
    debug: "color: #38bdf8; font-weight: bold;"
});

export const NOTIFICATION_LABELS = Object.freeze({
    error: " — Errors",
    warn: " — Warnings",
    info: ""
});

/**
 * Unified Logger and UI notification dispatcher for Bakana's Action Display.
 * Encapsulates console output (error, warn, info, debug, grouping) and debounced,
 * coalesced UI toast notifications.
 */
export class Logger {
    constructor() {
        this._cachedVerbosity = null;
        this._groupStack = [];
        this._queues = {
            info: [],
            warn: [],
            error: []
        };
        this._flushTimeout = null;
        this._batchWindowMs = 50;

        this.notify = Object.freeze({
            info: (message) => this._enqueueNotification("info", message),
            warn: (message) => this._enqueueNotification("warn", message),
            error: (message) => this._enqueueNotification("error", message)
        });

        this.error = this.error.bind(this);
        this.warn = this.warn.bind(this);
        this.info = this.info.bind(this);
        this.debug = this.debug.bind(this);
        this.group = this.group.bind(this);
        this.groupCollapsed = this.groupCollapsed.bind(this);
        this.groupExpanded = this.groupExpanded.bind(this);
        this.groupEnd = this.groupEnd.bind(this);
        this.getVerbosityLevel = this.getVerbosityLevel.bind(this);
        this.setVerbosity = this.setVerbosity.bind(this);
    }

    /**
     * Get the current log verbosity level from the game settings.
     * Defaults to 'warn' if the setting is not yet registered or unavailable.
     * @returns {number} The current numeric verbosity level.
     */
    getVerbosityLevel() {
        if (this._cachedVerbosity !== null) return this._cachedVerbosity;

        try {
            if (game?.settings) {
                const setting = game.settings.get(MODULE_ID, "logVerbosity");
                this._cachedVerbosity = VERBOSITY_LEVELS[setting] ?? VERBOSITY_LEVELS.warn;
                return this._cachedVerbosity;
            }
        } catch (e) {
            // Settings not yet registered or game not fully initialized
        }
        return VERBOSITY_LEVELS.warn;
    }

    /**
     * Dynamically update the cached verbosity level.
     * Called by the settings onChange callback.
     * @param {'error'|'warn'|'info'|'debug'} level - The new verbosity level key.
     * @returns {void}
     */
    setVerbosity(level) {
        this._cachedVerbosity = VERBOSITY_LEVELS[level] ?? VERBOSITY_LEVELS.warn;
    }

    /**
     * Ensure any pending (unstarted) groups on the stack are opened in the console
     * before writing log messages, preventing empty groups when no log messages execute.
     * @private
     */
    _ensureGroupsStarted() {
        for (const entry of this._groupStack) {
            if (entry.enabled && !entry.started) {
                const style = GROUP_STYLES[entry.level] ?? GROUP_STYLES.info;
                const shouldCollapse = entry.forceCollapse ?? (entry.level === "debug" || entry.level === "info");
                const consoleFn = (shouldCollapse && console.groupCollapsed) ? console.groupCollapsed : console.group;
                consoleFn(`%c${MODULE_TLA} | ${entry.message}`, style, ...entry.groupArgs);
                entry.started = true;
            }
        }
    }

    /**
     * Internal helper to create a styled console group (or collapsed group)
     * respecting the log verbosity level and highlighting with level-specific colors.
     * Groups default to collapsed for 'info' and 'debug', and expanded for 'warn' and 'error'.
     * Groups are lazy and only start in the console when a log message executes while open.
     * @param {boolean|null} forceCollapse Explicit collapse override, or null to default (info & debug collapsed, warn & error expanded)
     * @param {string} message Group label/message
     * @param {...*} args Optional verbosity level as first argument, followed by group payload
     * @private
     */
    _createGroup(forceCollapse, message, ...args) {
        let level = "info";
        let groupArgs = args;
        if (args.length > 0 && VERBOSITY_LEVELS[args[0]] !== undefined) {
            level = args[0];
            groupArgs = args.slice(1);
        }
        const enabled = this.getVerbosityLevel() >= VERBOSITY_LEVELS[level];
        this._groupStack.push({
            message,
            level,
            groupArgs,
            forceCollapse,
            started: false,
            enabled
        });
    }

    /**
     * Log an error message to the console if the current verbosity level allows.
     * @param {string} message - The error message to log.
     * @param {...*} args - Additional arguments to pass to console.error.
     * @returns {void}
     */
    error(message, ...args) {
        if (this.getVerbosityLevel() >= VERBOSITY_LEVELS.error) {
            this._ensureGroupsStarted();
            console.error(`${MODULE_TLA} | ${message}`, ...args);
        }
    }

    /**
     * Log a warning message to the console if the current verbosity level allows.
     * @param {string} message - The warning message to log.
     * @param {...*} args - Additional arguments to pass to console.warn.
     * @returns {void}
     */
    warn(message, ...args) {
        if (this.getVerbosityLevel() >= VERBOSITY_LEVELS.warn) {
            this._ensureGroupsStarted();
            console.warn(`${MODULE_TLA} | ${message}`, ...args);
        }
    }

    /**
     * Log a high-level lifecycle or status info message to the console if the current verbosity level allows.
     * @param {string} message - The lifecycle or status message to log.
     * @param {...*} args - Additional arguments to pass to console.log.
     * @returns {void}
     */
    info(message, ...args) {
        if (this.getVerbosityLevel() >= VERBOSITY_LEVELS.info) {
            this._ensureGroupsStarted();
            console.log(`${MODULE_TLA} | ${message}`, ...args);
        }
    }

    /**
     * Log a debug trace or diagnostic message to the console if the current verbosity level allows.
     * @param {string} message - The debug message to log.
     * @param {...*} args - Additional arguments to inspect or trace.
     * @returns {void}
     */
    debug(message, ...args) {
        if (this.getVerbosityLevel() >= VERBOSITY_LEVELS.debug) {
            this._ensureGroupsStarted();
            const timestamp = game?.time?.serverTime ?? "Unknown";
            console.log(`%c[${MODULE_TLA} Debug (${timestamp})]`, "color: #38bdf8; font-weight: bold;", message, ...args);
        }
    }

    /**
     * Start a console group if the current verbosity level allows.
     * Groups default to collapsed for 'info' and 'debug', and expanded for 'warn' and 'error'.
     * Groups are lazy and only start in the console when a log message executes while open.
     * @param {string} message - The label for the console group.
     * @param {...*} args - Optional verbosity level ('error'|'warn'|'info'|'debug') and additional arguments for console.group.
     * @returns {void}
     */
    group(message, ...args) {
        this._createGroup(null, message, ...args);
    }

    /**
     * Start a collapsed console group if the current verbosity level allows.
     * Groups are lazy and only start in the console when a log message executes while open.
     * @param {string} message - The label for the console group.
     * @param {...*} args - Optional verbosity level and additional arguments.
     * @returns {void}
     */
    groupCollapsed(message, ...args) {
        this._createGroup(true, message, ...args);
    }

    /**
     * Start an expanded console group if the current verbosity level allows.
     * Groups are lazy and only start in the console when a log message executes while open.
     * @param {string} message - The label for the console group.
     * @param {...*} args - Optional verbosity level and additional arguments.
     * @returns {void}
     */
    groupExpanded(message, ...args) {
        this._createGroup(false, message, ...args);
    }

    /**
     * End the most recently started console group if it was actively logged.
     * @returns {void}
     */
    groupEnd() {
        const group = this._groupStack.pop();
        if (group?.started) {
            console.groupEnd();
        }
    }

    // --- UI Notifications (Debounced & Batched) ---

    /**
     * Schedule a debounced flush of all queued notifications.
     * @private
     * @returns {void}
     */
    _scheduleFlush() {
        if (this._flushTimeout !== null) return;
        this._flushTimeout = setTimeout(() => {
            this._flushTimeout = null;
            this._flushQueues();
        }, this._batchWindowMs);
    }

    /**
     * Flush and display grouped notifications for each severity level (`info`, `warn`, `error`).
     * @private
     * @returns {void}
     */
    _flushQueues() {
        if (!ui?.notifications) {
            this._queues.info.length = 0;
            this._queues.warn.length = 0;
            this._queues.error.length = 0;
            return;
        }

        for (const level of ["info", "warn", "error"]) {
            const queue = this._queues[level];
            if (queue.length === 0) continue;

            const messages = [...queue];
            queue.length = 0;

            const text = messages.length === 1
                ? messages[0]
                : `${MODULE_NAME}${NOTIFICATION_LABELS[level] ?? ""} (${messages.length}):\n` +
                  messages.map((m) => `• ${m}`).join("\n");

            ui.notifications[level](text);
        }
    }

    /**
     * Common internal helper to enqueue a message for debounced notification dispatch.
     * @param {'info'|'warn'|'error'} level - Notification severity level
     * @param {string} message - Notification message text
     * @private
     * @returns {void}
     */
    _enqueueNotification(level, message) {
        const trimmed = String(message ?? "").trim();
        if (!trimmed) return;
        const queue = this._queues[level];
        if (queue && !queue.includes(trimmed)) {
            queue.push(trimmed);
            this._scheduleFlush();
        }
    }
}

export const log = new Logger();
export const notify = log.notify;

