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
     * Process actions and check for D&D 5e Midi-QOL automation flags on activities.
     * @param {Object[]} actions The current list of actions
     * @returns {Object[]} The modified actions
     */
    modifyActions(actions) {
        const modified = [];

        for (const item of actions) {
            // Check if the 5e item has mapped D&D 5e Activities
            const activities = item.activities;
            if (activities?.length > 0) {
                // Filter out D&D 5e Activities that are marked as automationOnly by Midi-QOL
                const filteredActivities = activities.filter(activity => !this.isAutomationOnly(activity));

                // If all D&D 5e Activities on the item are automation-only, hide the entire item card!
                if (filteredActivities.length === 0) {
                    continue; // Skip this item entirely (filters it out of the HUD)
                }

                // If some activities were filtered out, update the item's activities and tabs
                if (filteredActivities.length < activities.length) {
                    item.activities = filteredActivities;

                    // Identify root tab categories controlled by D&D 5e activities (e.g. 'economy')
                    const activityRootCategories = new Set(activities.map(activity => activity.tabs.root));

                    // Preserve non-activity tabs from other categories (e.g. spell components under 'components')
                    const preservedTabs = item.tabs.filter(tab => !activityRootCategories.has(tab.root));

                    // Recalculate unique activity tabs using only the remaining non-removed activities
                    const uniqueTabsMap = new Map();
                    for (const activity of filteredActivities) {
                        const key = activity.tabs.path;
                        if (!uniqueTabsMap.has(key)) {
                            uniqueTabsMap.set(key, activity.tabs);
                        }
                    }
                    item.tabs = [...uniqueTabsMap.values(), ...preservedTabs];
                }
            }

            modified.push(item);
        }

        return modified;
    }

    /* ----------------------------------------------- */
    /*  Module Data Structure Accessors / Path Helpers */
    /* ----------------------------------------------- */

    /**
     * Check if a D&D 5e activity is flagged as automation-only by Midi-QOL.
     * Localizes third-party data path access (`activity.originalActivity.midiProperties.automationOnly`)
     * in case Midi-QOL changes its flag structure in future updates.
     *
     * @param {Object} activity The subAction / activity object
     * @returns {boolean} True if the activity should be hidden from player view
     */
    isAutomationOnly(activity) {
        return activity?.originalActivity?.midiProperties?.automationOnly === true;
    }
}
