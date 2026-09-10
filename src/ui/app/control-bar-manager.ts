import { log } from '../../lib/logger.js';
import { localize, deepFreeze } from '../../lib/utils.js';

export interface ControlBarButtonConfig {
    id: string;
    className: string;
    action: string;
    contextAction: string | null;
    icon: string;
    isActive: boolean;
    isSecondaryActive: boolean;
    isVisible: boolean;
    tooltip: string | null;
    ariaLabel: string;
}

export interface ControlBarModel {
    left: ControlBarButtonConfig[];
    right: ControlBarButtonConfig[];
}

const LEGACY_FALLBACKS = deepFreeze([
    { selector: '.bad-combat-track-btn', method: '_onRightClickCombatAutoTrack' },
    { selector: '.bad-recenter-btn', method: '_onRightClickRecenterToken' },
    { selector: '.bad-pin-btn', method: '_onRightClickToggleAnchor' }
]);

export class ControlBarManager {
    /**
     * Prepares structured control button view models for template rendering.
     * @param {Object} context Prepared application context containing settings flags
     * @param {boolean} isAttached Whether HUD is currently attached to token
     * @returns {ControlBarModel}
     */
    static prepareControlButtons(context: Record<string, unknown>, isAttached: boolean): ControlBarModel {
        const showTooltips = Boolean(context.showTooltips);
        const showDepleted = Boolean(context.showDepleted);
        const autoTrackCombat = Boolean(context.autoTrackCombat);
        const autoToggleCombat = Boolean(context.autoToggleCombat);
        const enableCombatAutoTrack = Boolean(context.enableCombatAutoTrackButton);
        const showItemSummaries = Boolean(context.showItemSummaries);
        const enableItemSummaryButton = Boolean(context.enableItemSummaryButton);
        const autoCenterOnToken = Boolean(context.autoCenterOnToken);
        const enableCenterOnToken = Boolean(context.enableCenterOnToken);
        const persistHUD = Boolean(context.persistHUD);

        const left = [
            {
                id: 'filter-resources',
                className: 'bad-control-btn bad-filter-resources-btn',
                action: 'toggleFilterResources',
                contextAction: null,
                icon: showDepleted ? 'fas fa-eye' : 'fas fa-eye-slash',
                isActive: showDepleted,
                isSecondaryActive: false,
                isVisible: true,
                tooltip: showTooltips
                    ? (showDepleted
                        ? localize('BAD.controlButtons.filterResources.tooltipHide', 'Hide Depleted Items')
                        : localize('BAD.controlButtons.filterResources.tooltipShow', 'Show Depleted Items'))
                    : null,
                ariaLabel: localize('BAD.controlButtons.filterResources.label', 'Filter Resources')
            },
            {
                id: 'combat-track',
                className: 'bad-control-btn bad-combat-track-btn',
                action: 'toggleCombatAutoTrack',
                contextAction: 'toggleCombatAutoToggle',
                icon: 'fas fa-sword',
                isActive: autoTrackCombat,
                isSecondaryActive: autoToggleCombat,
                isVisible: enableCombatAutoTrack,
                tooltip: showTooltips
                    ? localize('BAD.controlButtons.combatTrack.tooltip', '<b>Left Click:</b> Follow Active Combatant Turn\n<b>Right Click:</b> Toggle Auto-Open / Auto-Close on Turn Change')
                    : null,
                ariaLabel: localize('BAD.controlButtons.combatTrack.label', 'Combat Turn Tracker')
            },
            {
                id: 'summary-toggle',
                className: 'bad-control-btn bad-summary-toggle-btn',
                action: 'toggleItemSummaries',
                contextAction: null,
                icon: 'fas fa-question',
                isActive: showItemSummaries,
                isSecondaryActive: false,
                isVisible: enableItemSummaryButton,
                tooltip: showTooltips
                    ? (showItemSummaries
                        ? localize('BAD.controlButtons.itemSummary.tooltipDisable', 'Disable Rich Item Summaries')
                        : localize('BAD.controlButtons.itemSummary.tooltipEnable', 'Enable Rich Item Summaries (without holding ?)'))
                    : null,
                ariaLabel: localize('BAD.controlButtons.itemSummary.label', 'Item Summary Tooltips')
            }
        ];

        const right = [
            {
                id: 'recenter',
                className: 'bad-control-btn bad-recenter-btn',
                action: 'recenterToken',
                contextAction: 'toggleAutoCenter',
                icon: 'fas fa-crosshairs',
                isActive: autoCenterOnToken,
                isSecondaryActive: false,
                isVisible: enableCenterOnToken,
                tooltip: showTooltips
                    ? localize('BAD.controlButtons.recenter.tooltip', '<b>Left Click:</b> Recenter Canvas on Active Combatant\n<b>Right Click:</b> Toggle Auto-Centering on Turn Change')
                    : null,
                ariaLabel: localize('BAD.controlButtons.recenter.label', 'Recenter View')
            },
            {
                id: 'pin',
                className: 'bad-control-btn bad-pin-btn',
                action: 'toggleAnchor',
                contextAction: 'toggleHUDPersistence',
                icon: isAttached ? 'fas fa-link' : 'fas fa-unlink',
                isActive: persistHUD,
                isSecondaryActive: false,
                isVisible: true,
                tooltip: showTooltips
                    ? (isAttached
                        ? localize('BAD.controlButtons.anchor.tooltipAttached', '<b>Left Click:</b> Detach HUD from Token\n<b>Right Click:</b> Toggle HUD Persistence on Outside Click')
                        : localize('BAD.controlButtons.anchor.tooltipDetached', '<b>Left Click:</b> Attach HUD to Token\n<b>Right Click:</b> Toggle HUD Persistence on Outside Click'))
                    : null,
                ariaLabel: localize('BAD.controlButtons.anchor.label', 'HUD Placement & Persistence')
            },
            {
                id: 'close',
                className: 'bad-control-btn bad-close-btn',
                action: 'closeHUD',
                contextAction: null,
                icon: 'fas fa-times',
                isActive: false,
                isSecondaryActive: false,
                isVisible: true,
                tooltip: showTooltips
                    ? localize('BAD.controlButtons.close.tooltip', 'Close HUD')
                    : null,
                ariaLabel: localize('BAD.controlButtons.close.label', 'Close HUD')
            }
        ];

        return { left, right };
    }

    /**
     * Declarative dispatch for right-click contextmenu events.
     * Intercepts elements with [data-context-action], blurs the element to prevent
     * focus styling retention, stops event propagation, and invokes the registered handler.
     * @param {ActionDisplayApp} app The ActionDisplayApp instance
     * @param {Event} event The triggering contextmenu event
     * @returns {Promise<boolean>} True if event was handled
     */
    static async dispatchContextAction(
        app: ActionDisplayApp | (Record<string, unknown> & { constructor?: unknown }),
        event: MouseEvent | PointerEvent | Event
    ): Promise<boolean> {
        const target = event?.target as HTMLElement | null;
        const contextTarget = target?.closest?.<HTMLElement>('[data-context-action]');
        if (contextTarget) {
            event.preventDefault?.();
            event.stopPropagation?.();
            event.stopImmediatePropagation?.();
            contextTarget.blur?.();

            const actionName = contextTarget.dataset.contextAction;
            if (!actionName) return true;
            const appConstructor = app.constructor as { DEFAULT_OPTIONS?: { contextActions?: Record<string, (event: Event, target: HTMLElement) => Promise<unknown> | unknown> } } | undefined;
            const appMethods = app as unknown as Record<string, ((event: Event, target: HTMLElement) => Promise<unknown> | unknown) | undefined>;
            const handler = appConstructor?.DEFAULT_OPTIONS?.contextActions?.[actionName] ?? appMethods[actionName];

            if (handler) {
                try {
                    await handler.call(app, event, contextTarget);
                } catch (err) {
                    log.error(`ControlBarManager.dispatchContextAction | Error executing action "${actionName}":`, err);
                }
            } else {
                log.warn(`ControlBarManager.dispatchContextAction | No handler registered for context action "${actionName}"`);
            }
            return true;
        }

        // Fallback for elements/tests querying legacy class selectors without data-context-action
        for (const { selector, method } of LEGACY_FALLBACKS) {
            const btn = target?.closest?.<HTMLElement>(selector);
            const appMethods = app as unknown as Record<string, ((event: Event, target: HTMLElement) => Promise<unknown> | unknown) | undefined>;
            const fallbackHandler = appMethods[method];
            if (btn && fallbackHandler) {
                event.preventDefault?.();
                event.stopPropagation?.();
                event.stopImmediatePropagation?.();
                btn.blur?.();
                await fallbackHandler.call(app, event, btn);
                return true;
            }
        }

        return false;
    }
}
