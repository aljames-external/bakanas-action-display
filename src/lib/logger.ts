import { MODULE_ID, MODULE_NAME, MODULE_TLA } from "../constants.js";
import { deepFreeze } from "./utils.js";

export const VERBOSITY_LEVELS = deepFreeze({
    error: 1,
    warn: 2,
    info: 3,
    debug: 4
});

export const GROUP_STYLES = deepFreeze({
    error: "color: #ef4444; font-weight: bold;",
    warn: "color: #f59e0b; font-weight: bold;",
    info: "color: #ffffff; font-weight: bold;",
    debug: "color: #38bdf8; font-weight: bold;"
});

export const NOTIFICATION_LABELS = deepFreeze({
    error: " — Errors",
    warn: " — Warnings",
    info: ""
});

interface GroupEntry {
    message: string;
    level: string;
    groupArgs: any[];
    forceCollapse: boolean | null;
    started: boolean;
    enabled: boolean;
}

/**
 * Unified Logger and UI notification dispatcher for Bakana's Action Display.
 * Encapsulates console output (error, warn, info, debug, grouping) and debounced,
 * coalesced UI toast notifications.
 */
export class Logger {
    private _cachedVerbosity: number | null;
    private _groupStack: GroupEntry[];
    private _queues: Record<string, string[]>;
    private _flushTimeout: any;
    private _batchWindowMs: number;
    notify: {
        info: (message: string) => void;
        warn: (message: string) => void;
        error: (message: string) => void;
    };

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

        this.notify = deepFreeze({
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
    getVerbosityLevel(): number {
        if (this._cachedVerbosity !== null) return this._cachedVerbosity;

        try {
            if (game?.settings) {
                const setting = game.settings.get(MODULE_ID, "logVerbosity") as string;
                this._cachedVerbosity = (VERBOSITY_LEVELS as any)[setting] ?? VERBOSITY_LEVELS.warn;
                return this._cachedVerbosity ?? VERBOSITY_LEVELS.warn;
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
    setVerbosity(level: string) {
        this._cachedVerbosity = (VERBOSITY_LEVELS as any)[level] ?? VERBOSITY_LEVELS.warn;
    }

    /**
     * Ensure any pending (unstarted) groups on the stack are opened in the console
     * before writing log messages, preventing empty groups when no log messages execute.
     * @private
     */
    _ensureGroupsStarted() {
        for (const entry of this._groupStack) {
            if (entry.enabled && !entry.started) {
                const style = (GROUP_STYLES as Record<string, string>)[entry.level] ?? GROUP_STYLES.info;
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
    _createGroup(forceCollapse: any, message: any, ...args: any[]) {
        let level = "info";
        let groupArgs = args;
        if (args.length > 0 && (VERBOSITY_LEVELS as Record<string, number>)[args[0]] !== undefined) {
            level = args[0];
            groupArgs = args.slice(1);
        }
        const enabled = this.getVerbosityLevel() >= ((VERBOSITY_LEVELS as Record<string, number>)[level] ?? 0);
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
    error(message: any, ...args: any[]) {
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
    warn(message: any, ...args: any[]) {
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
    info(message: any, ...args: any[]) {
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
    debug(message: any, ...args: any[]) {
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
    group(message: any, ...args: any[]) {
        this._createGroup(null, message, ...args);
    }

    /**
     * Start a collapsed console group if the current verbosity level allows.
     * Groups are lazy and only start in the console when a log message executes while open.
     * @param {string} message - The label for the console group.
     * @param {...*} args - Optional verbosity level and additional arguments.
     * @returns {void}
     */
    groupCollapsed(message: any, ...args: any[]) {
        this._createGroup(true, message, ...args);
    }

    /**
     * Start an expanded console group if the current verbosity level allows.
     * Groups are lazy and only start in the console when a log message executes while open.
     * @param {string} message - The label for the console group.
     * @param {...*} args - Optional verbosity level and additional arguments.
     * @returns {void}
     */
    groupExpanded(message: any, ...args: any[]) {
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
                : `${MODULE_NAME}${(NOTIFICATION_LABELS as Record<string, string>)[level] ?? ""} (${messages.length}):\n` +
                  messages.map((m) => `• ${m}`).join("\n");

            (ui.notifications as any)[level](text);
        }
    }

    /**
     * Common internal helper to enqueue a message for debounced notification dispatch.
     * @param {'info'|'warn'|'error'} level - Notification severity level
     * @param {string} message - Notification message text
     * @private
     * @returns {void}
     */
    _enqueueNotification(level: any, message: any) {
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

