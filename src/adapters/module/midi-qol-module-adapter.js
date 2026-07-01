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
     * @param {Actor} actor 
     * @returns {Object[]} The modified actions
     */
    modifyActions(actions, actor) {
        const modified = [];

        for (const item of actions) {
            // Check if the 5e item has mapped D&D 5e Activities
            const activities = item.activities;
            if (activities && activities.length > 0) {
                // Filter out D&D 5e Activities that are marked as automationOnly by Midi-QOL
                const filteredActivities = activities.filter(activity => !this.isAutomationOnly(activity));

                // If all D&D 5e Activities on the item are automation-only, hide the entire item card!
                if (filteredActivities.length === 0) {
                    continue; // Skip this item entirely (filters it out of the HUD)
                }

                // If some activities were filtered out, update the item's activities and tabs
                if (filteredActivities.length < activities.length) {
                    item.activities = filteredActivities;

                    // Identify which parent tabs are managed by the activities (e.g. 'economy')
                    const managedParents = new Set(activities.map(act => act.tabs[0]));

                    // Preserve any tabs that are NOT managed by activities (like D&D 5e spell components)
                    const preservedTabs = item.tabs?.filter(tab => !managedParents.has(tab[0])) ?? [];

                    // Recalculate unique activation tabs based on the remaining player-facing activities
                    const uniqueTabs = [];
                    const seenTabKeys = new Set();

                    for (const act of filteredActivities) {
                        const parentTab = act.tabs[0];
                        const subTab = act.tabs[1];
                        const key = subTab ? `${parentTab}/${subTab}` : parentTab;
                        if (!seenTabKeys.has(key)) {
                            seenTabKeys.add(key);
                            uniqueTabs.push(subTab ? [parentTab, subTab] : [parentTab]);
                        }
                    }
                    item.tabs = [...uniqueTabs, ...preservedTabs];
                }
            }

            modified.push(item);
        }

        return modified;
    }

    /* -------------------------------------------- */
    /*  Module Data Structure Accessors / Path Helpers */
    /* -------------------------------------------- */

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
