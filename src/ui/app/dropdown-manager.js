import { MODULE_ID } from '../../constants.js';
import { log } from '../../lib/logger.js';
import { adapter } from '../../adapters/index.js';

/**
 * Open a context submenu for an individual subaction/activity item (e.g. right-clicking an activity in the dropdown).
 * @param {ApplicationV2} app Active HUD application
 * @param {HTMLElement} targetLi Target activity list item element
 * @param {Object} subaction The subaction or activity data object
 */
export function openActivitySubContextMenu(app, targetLi, subaction) {
    const menuItems = [
        {
            name: "SIDEBAR.Edit",
            icon: '<i class="fas fa-edit"></i>',
            condition: () => {
                if (!app.actor?.isOwner) return false;
                const entity = subaction?.originalActivity ?? subaction?.originalItem;
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
    subMenu?.render?.(targetLi)?.catch?.(err => log.error("SubContextMenu render error:", err));
}

/**
 * Construct a menu item definition for an individual subaction inside the dropdown.
 * @param {Object} sub The subaction data object
 * @param {Event} event The triggering click event
 * @param {ApplicationV2} [app=null] Active HUD application
 * @returns {Object} Menu item configuration
 */
export function buildSubactionMenuItem(sub, event, app = null) {
    const uses = sub?.uses;
    const iconHtml = sub?.img
        ? `<img class="bad-menu-icon bad-action-icon" src="${sub.img}" alt="${sub.name ?? ''}" />`
        : '<div class="bad-action-icon-placeholder"><i class="fas fa-dice-d20"></i></div>';

    let usesHtml = "";
    if (uses && uses.available !== null && uses.available !== undefined) {
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
                document.querySelector?.('#tooltip.locked, aside#tooltip.locked, div#tooltip.locked, .tooltip.locked')?.classList?.remove?.('locked');
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
 * @param {ApplicationV2} app Active HUD application
 * @param {HTMLElement} target Action card target element
 * @param {Object[]} subactions Array of qualifying subaction objects
 * @param {Event} event Triggering click event
 * @param {Object} [parentAction=null] Optional parent action card object
 */
export function showActivityDropdown(app, target, subactions, event, parentAction = null) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    app?._hideItemSummaryTooltip?.();

    const action = parentAction ?? (app?.displayedActions ?? app?.actions)?.find?.(a => a.id === target?.dataset?.actionId);
    if (action?.subactions?.length && action.subactions.length > (subactions?.length ?? 0)) {
        const qualifyingIds = new Set((subactions ?? []).map(s => s.id));
        const filteredSubs = action.subactions.filter(sub => !qualifyingIds.has(sub.id));
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

    const sortedSubactions = [...(subactions ?? [])].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    const menuItems = sortedSubactions.map(sub => buildSubactionMenuItem(sub, event, app));

    if (app._activeLeftClickMenu) {
        const prevLeftMenu = app._activeLeftClickMenu;
        app._activeLeftClickMenu = null;
        try {
            prevLeftMenu.close()?.catch?.(err => {
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
            app._contextMenu.close()?.catch?.(err => {
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

    const formatMenuItems = (menuEl) => {
        if (!menuEl) return;
        const lis = menuEl.querySelectorAll('.context-item');
        lis.forEach((li, idx) => {
            const sub = sortedSubactions[idx];
            const itemData = menuItems[idx];
            if (sub) {
                li.dataset.actionId = sub.id;
                li._badSubaction = sub;

                const iconWrap = itemData?.icon ?? `<span class="bad-menu-icon-wrap">${itemData?.iconHtml ?? ''}</span>`;
                const nameHtml = `<span class="bad-action-name bad-menu-name">${sub.name ?? "Action"}</span>`;
                const econHtml = itemData?.economyHtml ?? '';
                const usesHtml = itemData?.usesSlotHtml ?? '<div class="bad-action-uses-slot"></div>';

                li.innerHTML = `${iconWrap}${nameHtml}${econHtml}${usesHtml}`;

                if (!li._badListenersAttached) {
                    li._badListenersAttached = true;
                    li.addEventListener('pointerover', () => {
                        app._hoveredActionItem = li;
                        const showSummaries = app._isQuestionMarkHeld || Boolean(game.settings.get(MODULE_ID, 'showItemSummaries'));
                        if (showSummaries) {
                            return app._showItemSummaryTooltip(li);
                        }
                    });

                    li.addEventListener('pointerout', (ev) => {
                        const related = ev.relatedTarget?.closest?.('.context-item');
                        if (related !== li && app._hoveredActionItem === li) {
                            app._hoveredActionItem = null;
                            app._hideItemSummaryTooltip();
                        }
                    });

                    li.addEventListener('contextmenu', (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation();
                        if (game.tooltip?.locked) {
                            game.tooltip.locked = false;
                            document.querySelector?.('#tooltip.locked, aside#tooltip.locked, div#tooltip.locked, .tooltip.locked')?.classList?.remove?.('locked');
                        }
                        app._hideItemSummaryTooltip();
                        try {
                            app._activeLeftClickMenu?.close({ force: true })?.catch?.(err => {
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

    const applyPositioning = (menuEl) => {
        if (!menuEl) return;
        menuEl.classList?.add?.('bad-context-menu');
        formatMenuItems(menuEl);
        if (menuEl.parentElement !== targetBody) {
            targetBody.appendChild(menuEl);
        }

        const rect = target.getBoundingClientRect?.() ?? { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 };
        const viewportHeight = window?.innerHeight ?? 1080;
        const spaceBelow = viewportHeight - rect.bottom - 15;
        const spaceAbove = rect.top - 15;
        const neededHeight = sortedSubactions.length * 36 + 15;

        // Prefer down: only place above if space below is critically constrained (< 80px) and space above is larger
        const placeAbove = spaceBelow < Math.min(neededHeight, 80) && spaceAbove > spaceBelow;
        const availableSpace = placeAbove ? spaceAbove : spaceBelow;
        const maxHeight = Math.max(60, Math.min(neededHeight, availableSpace));

        const styles = {
            position: 'fixed',
            left: `${rect.left}px`,
            top: placeAbove ? `${Math.max(10, rect.top - Math.min(neededHeight, maxHeight))}px` : `${rect.bottom}px`,
            bottom: 'auto',
            width: `${rect.width}px`,
            'min-width': `${rect.width}px`,
            'box-sizing': 'border-box',
            'z-index': '999999',
            display: 'block',
            visibility: 'visible',
            opacity: '1',
            'max-height': `${maxHeight}px`
        };

        for (const [prop, val] of Object.entries(styles)) {
            menuEl.style?.setProperty?.(prop, val, 'important');
        }

        Array.from(menuEl.children ?? []).forEach(child => {
            child.style?.setProperty?.('max-height', `${maxHeight}px`, 'important');
            child.style?.setProperty?.('overflow-y', 'auto', 'important');
            child.style?.setProperty?.('overflow-x', 'clip', 'important');
        });
    };

    const isTooltipFocused = () => {
        if (Boolean(game.tooltip?.locked)) return true;
        const lockedEl = document.querySelector?.('#tooltip.locked, aside#tooltip.locked, div#tooltip.locked, .tooltip.locked');
        return Boolean(lockedEl?.classList?.contains?.('locked'));
    };

    const options = {
        jQuery: false,
        onOpen: () => {
            const menuEl = document.querySelector('#context-menu, .context-menu');
            if (menuEl) applyPositioning(menuEl);
        },
        onClose: () => {
            if (isTooltipFocused()) return;
            app?._hideItemSummaryTooltip?.();
            target?.classList?.remove?.('bad-dropdown-active');
            if (app._activeLeftClickMenu === menu) app._activeLeftClickMenu = null;
            if (app._activeMenuTarget === target) app._activeMenuTarget = null;
            const menuEl = document.querySelector('#context-menu, .context-menu');
            menuEl?.classList?.remove?.('bad-context-menu');
            menuEl?.remove?.();
            document.querySelectorAll('#context-menu.bad-context-menu, .context-menu.bad-context-menu').forEach(el => el.classList?.remove?.('bad-context-menu'));
        }
    };

    const menu = new ContextMenuClass(targetBody, ".bad-action-item", menuItems, options);
    menu._setPosition = (html) => {
        const menuEl = html instanceof HTMLElement ? html : html?.[0] ?? document.querySelector('#context-menu, .context-menu');
        if (menuEl) applyPositioning(menuEl);
    };
    menu.setPosition = menu._setPosition;

    const origClose = menu.close?.bind(menu);
    menu.close = async (closeOptions = {}) => {
        if (isTooltipFocused() && !closeOptions.force) {
            return;
        }
        app?._hideItemSummaryTooltip?.();
        const menuEl = document.querySelector('#context-menu, .context-menu');
        try {
            if (origClose) await origClose(closeOptions);
        } catch (err) {
            log.debug("LeftClickMenu close error:", err);
        } finally {
            menuEl?.classList?.remove?.('bad-context-menu');
            menuEl?.remove?.();
            document.querySelectorAll('#context-menu.bad-context-menu, .context-menu.bad-context-menu').forEach(el => el.classList?.remove?.('bad-context-menu'));
            target?.classList?.remove?.('bad-dropdown-active');
            if (app._activeLeftClickMenu === menu) app._activeLeftClickMenu = null;
            if (app._activeMenuTarget === target) app._activeMenuTarget = null;
        }
    };

    app._activeLeftClickMenu = menu;

    return menu.render(target)?.then?.(() => {
        const menuEl = document.querySelector('#context-menu, .context-menu');
        if (menuEl) {
            applyPositioning(menuEl);
        }
    })?.catch?.(e => {
        log.error(`showActivityDropdown | menu.render error:`, e);
    });
}
