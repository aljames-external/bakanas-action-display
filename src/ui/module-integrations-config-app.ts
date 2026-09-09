import { MODULE_ID } from '../constants.js';
import { log } from '../lib/logger.js';
import { localize } from '../lib/utils.js';
import { adapter } from '../adapters/index.js';
import { actionDisplay } from '../action-display.js';

/**
 * Modern ApplicationV2 configuration menu for third-party module integrations.
 */
export class ModuleIntegrationsConfigApp extends adapter.foundry.HandlebarsApplicationMixin(adapter.foundry.ApplicationV2) {
    /** @override */
    static DEFAULT_OPTIONS = {
        id: 'bad-module-integrations-config-app',
        classes: ['bad-module-integrations-config-window'],
        tag: 'div',
        window: {
            frame: true,
            title: 'BAD.moduleIntegrations.title',
            resizable: true
        },
        position: {
            width: 560,
            height: 'auto'
        },
        actions: {
            saveConfig: ModuleIntegrationsConfigApp.prototype._onSaveConfig,
            closeConfig: ModuleIntegrationsConfigApp.prototype._onCloseConfig
        }
    };

    /** @override */
    static get PARTS() {
        const path = game.modules?.get(MODULE_ID)?.path ?? `modules/${MODULE_ID}`;
        return {
            config: {
                template: `${path}/templates/module-integrations-config.html`,
                scrollable: ['.bad-module-integrations-list']
            }
        };
    }

    constructor(options = {}) {
        super(options);
        this.midiQolFilterAutomationOnly = Boolean(game.settings.get(MODULE_ID, 'midiQolFilterAutomationOnly') ?? true);
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const isMidiActive = Boolean(game.modules?.get('midi-qol')?.active);

        context.modules = {
            midiQol: {
                active: isMidiActive,
                filterAutomationOnly: this.midiQolFilterAutomationOnly
            }
        };
        context.hasActiveModules = isMidiActive;

        return context;
    }

    /**
     * Save module integration settings.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    async _onSaveConfig(event, target) {
        event.preventDefault();

        const form = this.element?.querySelector('form') ?? this.element;
        const midiCheckbox = form?.querySelector('input[name="midiQolFilterAutomationOnly"]');
        const filterVal = midiCheckbox ? Boolean(midiCheckbox.checked) : this.midiQolFilterAutomationOnly;

        this.midiQolFilterAutomationOnly = filterVal;
        await game.settings.set(MODULE_ID, 'midiQolFilterAutomationOnly', filterVal);
        log.info(`Saved module integration settings [Midi-QOL Filter Automation-Only: ${filterVal}]`);

        ui.notifications.info(localize('BAD.moduleIntegrations.saved'));

        if (actionDisplay.activeApp?.rendered) {
            actionDisplay.activeApp.render();
        }

        this.close();
    }

    /**
     * Close dialog without saving changes.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    _onCloseConfig(event, target) {
        event.preventDefault();
        this.close();
    }
}
