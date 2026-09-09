import { MODULE_ID } from '../constants.js';
import { log } from '../lib/logger.js';
import { localize, deepFreeze } from '../lib/utils.js';
import { adapter } from '../adapters/index.js';
import { actionDisplay } from '../action-display.js';

export const DEFAULT_DND5E_AUTOBAN_CONFIG = deepFreeze({
    enabled: true,
    vocal: ['silenced', 'incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'],
    somatic: ['restrained', 'incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious', 'grappled']
});

/**
 * Modern ApplicationV2 configuration menu for D&D 5e automatic spell component banning.
 */
export class Dnd5eAutoBanConfigApp extends adapter.foundry.HandlebarsApplicationMixin(adapter.foundry.ApplicationV2) {
    /** @override */
    static DEFAULT_OPTIONS = {
        id: 'bad-dnd5e-autoban-config-app',
        classes: ['bad-dnd5e-autoban-window'],
        tag: 'div',
        window: {
            frame: true,
            title: 'BAD.dnd5eAutoBan.title',
            resizable: true
        },
        position: {
            width: 540,
            height: 'auto'
        },
        actions: {
            toggleEnabled: Dnd5eAutoBanConfigApp.prototype._onToggleEnabled,
            addCondition: Dnd5eAutoBanConfigApp.prototype._onAddCondition,
            removeCondition: Dnd5eAutoBanConfigApp.prototype._onRemoveCondition,
            resetDefaults: Dnd5eAutoBanConfigApp.prototype._onResetDefaults,
            saveConfig: Dnd5eAutoBanConfigApp.prototype._onSaveConfig,
            closeConfig: Dnd5eAutoBanConfigApp.prototype._onCloseConfig
        }
    };

    /** @override */
    static get PARTS() {
        const path = game.modules?.get(MODULE_ID)?.path ?? `modules/${MODULE_ID}`;
        return {
            config: {
                template: `${path}/templates/dnd5e-autoban-config.html`,
                scrollable: ['.bad-autoban-config-form']
            }
        };
    }

    constructor(options = {}) {
        super(options);
        const stored = game.settings.get(MODULE_ID, 'dnd5eAutoBanConditions') ?? {};
        this.config = {
            enabled: stored.enabled ?? DEFAULT_DND5E_AUTOBAN_CONFIG.enabled,
            vocal: Array.isArray(stored.vocal) ? [...stored.vocal] : [...DEFAULT_DND5E_AUTOBAN_CONFIG.vocal],
            somatic: Array.isArray(stored.somatic) ? [...stored.somatic] : [...DEFAULT_DND5E_AUTOBAN_CONFIG.somatic]
        };
    }

    /** @override */
    async _prepareContext(options: any) {
        const context = await super._prepareContext(options);
        context.config = this.config;

        const availableStatuses = (CONFIG.statusEffects ?? []).map(s => ({
            id: s.id,
            name: localize(s.name ?? s.label ?? s.id, s.id),
            img: s.img ?? s.icon ?? ''
        }));
        availableStatuses.sort((a, b) => a.name.localeCompare(b.name));

        const statusMap = new Map(availableStatuses.map(s => [s.id, s]));

        const formatConditions = (ids: any) => ids.map((id: any) => {
            const found = statusMap.get(id);
            return {
                id,
                name: found?.name ?? id,
                img: found?.img ?? ''
            };
        });

        context.availableStatuses = availableStatuses;
        context.vocalConditions = formatConditions(this.config.vocal);
        context.somaticConditions = formatConditions(this.config.somatic);

        return context;
    }

    /**
     * Toggle master enablement checkbox.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    _onToggleEnabled(event: any, target: any) {
        this.config.enabled = Boolean(target.checked);
    }

    /**
     * Add a condition from dropdown to vocal or somatic list.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    _onAddCondition(event: any, target: any) {
        event.preventDefault();
        const type = target?.dataset?.type;
        if (!type || !this.config[type]) return;

        const select = this.element?.querySelector?.(`#bad-${type}-select`);
        const statusId = select?.value;
        if (statusId && !this.config[type].includes(statusId)) {
            this.config[type].push(statusId);
            this.render();
        }
    }

    /**
     * Remove a condition from vocal or somatic list.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    _onRemoveCondition(event: any, target: any) {
        event.preventDefault();
        const type = target.dataset.type;
        const id = target.dataset.id;
        if (!type || !id || !this.config[type]) return;

        this.config[type] = this.config[type].filter((item: any) => item !== id);
        this.render();
    }

    /**
     * Reset config to defaults.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    _onResetDefaults(event: any, target: any) {
        event.preventDefault();
        this.config = {
            enabled: DEFAULT_DND5E_AUTOBAN_CONFIG.enabled,
            vocal: [...DEFAULT_DND5E_AUTOBAN_CONFIG.vocal],
            somatic: [...DEFAULT_DND5E_AUTOBAN_CONFIG.somatic]
        };
        this.render();
    }

    /**
     * Save configuration and notify.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    async _onSaveConfig(event: any, target: any) {
        event.preventDefault();
        await game.settings.set(MODULE_ID, 'dnd5eAutoBanConditions', this.config);
        log.info('Saved D&D 5e auto-ban spell components configuration:', this.config);

        ui.notifications.info(localize('BAD.dnd5eAutoBan.saved'));

        if (actionDisplay.activeApp?.rendered && actionDisplay.activeApp.actor) {
            adapter.updateTabs(actionDisplay.activeApp.actor, actionDisplay.activeApp.rightTabs);
            actionDisplay.activeApp.render();
        }

        this.close();
    }

    /**
     * Close dialog without saving changes.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    _onCloseConfig(event: any, target: any) {
        event.preventDefault();
        this.close();
    }
}
