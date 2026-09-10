import { MODULE_ID } from '../../constants.js';
import { log } from '../../lib/logger.js';
import { adapter } from '../../adapters/index.js';
import { positionFloatingMenu } from './menu-utils.js';

export const dropdownSubactionMap = new WeakMap<HTMLElement, Action>();
const attachedDropdownItems = new WeakSet<HTMLElement>();

const sortByName = (a: { name?: string | null }, b: { name?: string | null }) => (a.name ?? '').localeCompare(b.name ?? '');

/**
 * Open a context submenu for an individual subaction/activity item (e.g. right-clicking an activity in the dropdown).
 * @param {ActionDisplayApp} app Active HUD application
 * @param {HTMLElement} targetLi Target activity list item element
 * @param {Action} subaction The subaction or activity data object
 */
export function openActivitySubContextMenu(app: ActionDisplayApp, targetLi: HTMLElement, subaction: Action) {
    const menuItems = [
        {
            name: "SIDEBAR.Edit",
            icon: '<i class="fas fa-edit"></i>',
            condition: () => {
                if (!app.actor?.isOwner) return false;
                const entity = ((subaction as unknown as Record<string, unknown>)?.originalActivity ?? (subaction as unknown as Record<string, unknown>)?.originalItem) as { sheet?: { render: (force: boolean) => void }; edit?: () => void } | null;
                return Boolean(entity?.sheet?.render || entity?.edit);
            },
            callback: () => {
                adapter.openEditSheet(subaction);
            }
        }
    ];

    const ContextMenuClass = adapter.foundry.ContextMenu;
    const targetBody = app?.element?.ownerDocument?.body ?? document.body;
    const subMenu = new ContextMenuClass(targetBody, ".context-item", menuItems, {
        jQuery: false
    });
    subMenu?.render?.(targetLi)?.catch?.((err: unknown) => log.error("SubContextMenu render error:", err));
}

/**
 * Construct a menu item definition for an individual subaction inside the dropdown.
 * @param {Object} sub The subaction data object
 * @param {Event} event The triggering click event
 * @param {ActionDisplayApp|null} [app=null] Active HUD application
 * @returns {Object} Menu item configuration
 */
export function buildSubactionMenuItem(sub: Action, event: Event, app: ActionDisplayApp | null = null) {
    const uses = sub?.uses;
    const iconHtml = sub?.img
        ? `<img class="bad-menu-icon bad-action-icon" src="${sub.img}" alt="${sub.name ?? ''}" />`
        : '<div class="bad-action-icon-placeholder"><i class="fas fa-dice-d20"></i></div>';

    let usesHtml = "";
    if (uses?.available != null) {
        const usesText = `${uses.available}${uses.max ? ' / ' + uses.max : ''}`;
        const depletedClass = uses.available === 0 ? " depleted" : "";
        const upcastClass = uses.isUpcast ? " upcast" : "";
        usesHtml = `<span class="bad-menu-uses bad-action-uses${depletedClass}${upcastClass}">${usesText}</span>`;
    }

    const showEconomy = Boolean(game.settings.get(MODULE_ID, 'enableEconomyIndicators'));
    let economyHtml = "";
    if (showEconomy) {
        const userColors = game.settings.get(MODULE_ID, 'economyColors') ?? {};
        const indicators = adapter.extractEconomyIndicators(sub, userColors);
        if (indicators?.length) {
            const slotsHtml = indicators.map(ind => {
                const slotClass = ind.active ? "" : " bad-economy-slot-empty";
                const barHtml = ind.active
                    ? `<span class="bad-economy-bar" style="background-color: ${ind.color}" data-tooltip="${(ind.tooltip ?? '').replace(/"/g, '&quot;')}" data-tooltip-direction="UP"></span>`
                    : "";
                return `<div class="bad-economy-slot${slotClass}">${barHtml}</div>`;
            }).join("");
            economyHtml = `<div class="bad-economy-bars">${slotsHtml}</div>`;
        }
    }

    const usesSlotHtml = `<div class="bad-action-uses-slot">${usesHtml}</div>`;

    return {
        name: sub?.name ?? "Action",
        icon: `<span class="bad-menu-icon-wrap">${iconHtml}</span>`,
        iconHtml,
        usesHtml,
        economyHtml,
        usesSlotHtml,
        callback: async () => {
            if (game.tooltip?.locked) {
                game.tooltip.locked = false;
                document.querySelector?.('#tooltip.locked')?.classList?.remove?.('locked');
            }
            app?._hideItemSummaryTooltip?.();
            await app?._activeLeftClickMenu?.close?.({ force: true });
            const item = sub?.originalItem ?? sub;
            const actor = app?.actor ?? null;
            const token = app?.token ?? null;
            const user = game.user;
            log.debug(`Rolling subaction "${sub?.name}" via dropdown:`, { action: sub, item, actor, token, user });
            sub?.roll?.(event);
        }
    };
}

/**
 * Display the subaction / activity selection dropdown menu anchored to the action card.
 * @param {ActionDisplayApp} app Active HUD application
 * @param {HTMLElement} target Action card target element
 * @param {Action[]} subactions Array of qualifying subaction objects
 * @param {Event} event Triggering click event
 * @param {Action|null} [parentAction=null] Optional parent action card object
 */
export function showActivityDropdown(
    app: ActionDisplayApp,
    target: HTMLElement,
    subactions: Action[],
    event: Event,
    parentAction: Action | null = null
) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    app?._hideItemSummaryTooltip?.();

    const action = parentAction ?? (app?.displayedActions ?? app?.actions)?.find?.((a: Action) => a.id === target?.dataset?.actionId);
    if (action?.subactions?.length && action.subactions.length > (subactions?.length ?? 0)) {
        const qualifyingIds = new Set((subactions ?? []).map((s: Action) => s.id));
        const filteredSubs = action.subactions.filter((sub: Action) => !qualifyingIds.has(sub.id));
        if (filteredSubs.length > 0) {
            log.group(`showActivityDropdown | Activities filtered from dropdown context menu on "${action.name ?? 'Action'}" (${action.id})`, 'debug');
            try {
                for (const sub of filteredSubs) {
                    log.debug(`showActivityDropdown | Activity "${sub.name}" (${sub.id}) filtered from dropdown context menu on "${action.name}"`);
                }
            } finally {
                log.groupEnd();
            }
        }
    }

    const sortedSubactions = [...(subactions ?? [])].sort(sortByName);
    const menuItems = sortedSubactions.map(sub => buildSubactionMenuItem(sub, event, app));

    if (app._activeLeftClickMenu) {
        const prevLeftMenu = app._activeLeftClickMenu;
        app._activeLeftClickMenu = null;
        try {
            prevLeftMenu.close()?.catch?.((err: unknown) => {
                log.debug("LeftClickMenu.close promise rejected:", err);
            });
        } catch (err) {
            log.debug("LeftClickMenu.close threw synchronously:", err);
        }
    }

    if (app._activeContextMenuTarget && app._contextMenu) {
        const prevContextTarget = app._activeContextMenuTarget;
        app._activeContextMenuTarget = null;
        try {
            app._contextMenu.close()?.catch?.((err: unknown) => {
                log.debug("ContextMenu.close promise rejected:", err);
            });
        } catch (err) {
            log.debug("ContextMenu.close threw synchronously:", err);
        }
        prevContextTarget?.classList?.remove?.('bad-menu-active');
    }

    app._activeMenuTarget = target;
    target.classList.add('bad-dropdown-active');

    const ContextMenuClass = adapter.foundry.ContextMenu;
    const targetBody = app?.element?.ownerDocument?.body ?? document.body;

    const formatMenuItems = (menuEl: HTMLElement | null) => {
        if (!menuEl) return;
        const lis = menuEl.querySelectorAll<HTMLElement>('.context-item');
        lis.forEach((li: HTMLElement, idx: number) => {
            const sub = sortedSubactions[idx];
            const itemData = menuItems[idx];
            if (sub) {
                li.dataset.actionId = sub.id;
                dropdownSubactionMap.set(li, sub);

                if (!attachedDropdownItems.has(li)) {
                    attachedDropdownItems.add(li);

                    const iconWrap = itemData?.icon ?? `<span class="bad-menu-icon-wrap">${itemData?.iconHtml ?? ''}</span>`;
                    const nameHtml = `<span class="bad-action-name bad-menu-name">${sub.name ?? "Action"}</span>`;
                    const econHtml = itemData?.economyHtml ?? '';
                    const usesHtml = itemData?.usesSlotHtml ?? '<div class="bad-action-uses-slot"></div>';

                    li.innerHTML = `${iconWrap}${nameHtml}${econHtml}${usesHtml}`;

                    li.addEventListener('pointerover', () => {
                        app._hoveredActionItem = li;
                        const showSummaries = app._isQuestionMarkHeld || Boolean(game.settings.get(MODULE_ID, 'showItemSummaries'));
                        if (showSummaries) {
                            return app._showItemSummaryTooltip(li);
                        }
                    });

                    li.addEventListener('pointerout', (ev: PointerEvent) => {
                        const related = (ev.relatedTarget as HTMLElement | null)?.closest?.('.context-item');
                        if (related !== li && app._hoveredActionItem === li) {
                            app._hoveredActionItem = null;
                            app._hideItemSummaryTooltip();
                        }
                    });

                    li.addEventListener('contextmenu', (ev: MouseEvent) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation();
                        if (game.tooltip?.locked) {
                            game.tooltip.locked = false;
                            document.querySelector?.('#tooltip.locked')?.classList?.remove?.('locked');
                        }
                        app._hideItemSummaryTooltip();
                        try {
                            app._activeLeftClickMenu?.close({ force: true })?.catch?.((err: unknown) => {
                                log.debug("LeftClickMenu.close promise rejected:", err);
                            });
                        } catch (err) {
                            log.debug("LeftClickMenu.close threw synchronously:", err);
                        }
                        app._activeLeftClickMenu = null;
                        adapter.openEditSheet(sub);
                    });
                }
            }
        });
    };

    const applyPositioning = (menuEl: HTMLElement | null) => {
        if (!menuEl) return;
        formatMenuItems(menuEl);
        positionFloatingMenu(menuEl, target, sortedSubactions.length, targetBody);
    };

    const isTooltipFocused = () => {
        if (Boolean(game.tooltip?.locked)) return true;
        const lockedEl = document.querySelector<HTMLElement>('#tooltip.locked, .locked-tooltip, [data-tooltip-locked="true"]');
        return Boolean(lockedEl?.classList?.contains?.('locked') || lockedEl?.classList?.contains?.('locked-tooltip') || lockedEl?.dataset?.tooltipLocked === 'true');
    };

    const options = {
        jQuery: false,
        onOpen: () => {
            const menuEl = document.querySelector<HTMLElement>('#context-menu, .context-menu');
            if (menuEl) applyPositioning(menuEl);
        },
        onClose: () => {
            if (isTooltipFocused()) return;
            app?._hideItemSummaryTooltip?.();
            target?.classList?.remove?.('bad-dropdown-active');
            if (app._activeLeftClickMenu === menu) app._activeLeftClickMenu = null;
            if (app._activeMenuTarget === target) app._activeMenuTarget = null;
            const menuEl = document.querySelector<HTMLElement>('#context-menu, .context-menu');
            menuEl?.classList?.remove?.('bad-context-menu');
            menuEl?.remove?.();
        }
    };

    const menu = new ContextMenuClass(targetBody, ".bad-action-item", menuItems, options);
    menu._setPosition = (html: HTMLElement | JQuery | unknown) => {
        const menuEl = (html instanceof HTMLElement ? html : (html as ArrayLike<HTMLElement>)?.[0]) ?? document.querySelector<HTMLElement>('#context-menu, .context-menu');
        if (menuEl) applyPositioning(menuEl);
    };
    menu.setPosition = menu._setPosition;

    const origClose = menu.close?.bind(menu);
    menu.close = async (closeOptions: { force?: boolean } = {}) => {
        if (isTooltipFocused() && !closeOptions.force) {
            return;
        }
        app?._hideItemSummaryTooltip?.();
        try {
            if (origClose) await origClose(closeOptions);
        } catch (err) {
            log.debug("LeftClickMenu close error:", err);
        } finally {
            target?.classList?.remove?.('bad-dropdown-active');
            if (app._activeLeftClickMenu === menu) app._activeLeftClickMenu = null;
            if (app._activeMenuTarget === target) app._activeMenuTarget = null;
            const menuEl = document.querySelector<HTMLElement>('#context-menu, .context-menu');
            menuEl?.classList?.remove?.('bad-context-menu');
            menuEl?.remove?.();
        }
    };

    app._activeLeftClickMenu = menu;

    const renderResult = menu.render(target);
    if (renderResult instanceof Promise) {
        return renderResult.then(() => {
            const menuEl = document.querySelector<HTMLElement>('#context-menu, .context-menu');
            if (menuEl) {
                applyPositioning(menuEl);
            }
        }).catch(e => {
            log.error(`showActivityDropdown | menu.render error:`, e);
        });
    }

    const menuEl = document.querySelector<HTMLElement>('#context-menu, .context-menu');
    if (menuEl) {
        applyPositioning(menuEl);
    }
}
