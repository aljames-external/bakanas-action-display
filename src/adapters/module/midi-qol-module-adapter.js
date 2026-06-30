import { BaseModuleAdapter } from './base-module-adapter.js';

/**
 * Module adapter for 'midi-qol' (D&D5e automation).
 * Identifies actions that are automated by Midi-QOL and flags them for the UI.
 */
export class MidiQolModuleAdapter extends BaseModuleAdapter {
    constructor() {
        super('midi-qol');
    }

    /**
     * Process actions and check for Midi-QOL automation flags.
     * @param {Object[]} actions The current list of actions
     * @param {Actor} actor 
     * @returns {Object[]} The modified actions
     */
    modifyActions(actions, actor) {
        const modified = [];

        for (const action of actions) {
            const item = action.originalItem;
            if (!item) {
                modified.push(action);
                continue;
            }

            // 1. Check if the action has consolidated subActions
            const subActions = action.subActions;
            if (subActions && subActions.length > 0) {
                // Filter out sub-actions that are marked as automationOnly
                const filteredSubs = subActions.filter(sub => {
                    const isAutomationOnly = sub.originalActivity?.midiProperties?.automationOnly === true;
                    return !isAutomationOnly;
                });

                // If all sub-actions are automation-only, hide the entire item!
                if (filteredSubs.length === 0) {
                    continue; // Skip this action entirely (filters it out of the HUD)
                }

                // If some sub-actions were filtered out, update the action's subActions and tabs
                if (filteredSubs.length < subActions.length) {
                    action.subActions = filteredSubs;

                    // Recalculate unique tabs based on the remaining sub-actions
                    const uniqueTabs = [];
                    const seenTabKeys = new Set();

                    for (const sub of filteredSubs) {
                        const parentTab = sub.tabs[0];
                        const subTab = sub.tabs[1];
                        const key = subTab ? `${parentTab}/${subTab}` : parentTab;
                        if (!seenTabKeys.has(key)) {
                            seenTabKeys.add(key);
                            uniqueTabs.push(subTab ? [parentTab, subTab] : [parentTab]);
                        }
                    }
                    action.tabs = uniqueTabs;
                }
            }

            modified.push(action);
        }

        return modified;
    }
}
