import { log } from '../../lib/logger.js';
import { adapter } from '../../adapters/index.js';
import { isActorItemFavorite, setActorItemFavorite } from '../../favorites/favorites-manager.js';

/**
 * Manages UI context menus for action items inside ActionDisplayApp.
 */
export class ContextMenuManager {
    /**
     * @param {ApplicationV2} app Active ActionDisplayApp instance
     * @param {HTMLElement} element Root application DOM element
     */
    constructor(app, element) {
        this.app = app;
        this.element = element;
    }

    /**
     * Build and bind the Foundry ContextMenu instance for action cards.
     * @returns {ContextMenu} The created ContextMenu instance
     */
    createActionContextMenu() {
        const menuItems = [
            {
                name: "SIDEBAR.Edit",
                icon: '<i class="fas fa-edit"></i>',
                condition: el => {
                    if (!this.app.actor?.isOwner) return false;
                    const action = this.app.actions?.find(a => a.id === el.dataset.actionId);
                    const item = action?.originalItem ?? this.app.actor?.items?.get(el.dataset.actionId);
                    return Boolean(item?.sheet?.render);
                },
                callback: el => {
                    const action = this.app.actions?.find(a => a.id === el.dataset.actionId);
                    if (action) {
                        adapter.openEditSheet(action);
                    } else {
                        const item = this.app.actor?.items?.get(el.dataset.actionId);
                        item?.sheet?.render(true);
                    }
                }
            },
            {
                name: "BAD.actionMenu.addFavorite",
                icon: '<i class="fas fa-star"></i>',
                condition: el => {
                    if (!this.app.actor?.isOwner) return false;
                    const action = this.app.actions?.find(a => a.id === el.dataset.actionId);
                    const item = action?.originalItem ?? this.app.actor?.items?.get(el.dataset.actionId);
                    return Boolean(item && !isActorItemFavorite(this.app.actor, item));
                },
                callback: async el => {
                    const action = this.app.actions?.find(a => a.id === el.dataset.actionId);
                    const item = action?.originalItem ?? this.app.actor?.items?.get(el.dataset.actionId);
                    if (item) {
                        await setActorItemFavorite(this.app.actor, item, true);
                        this.app.render();
                    }
                }
            },
            {
                name: "BAD.actionMenu.removeFavorite",
                icon: '<i class="far fa-star"></i>',
                condition: el => {
                    if (!this.app.actor?.isOwner) return false;
                    const action = this.app.actions?.find(a => a.id === el.dataset.actionId);
                    const item = action?.originalItem ?? this.app.actor?.items?.get(el.dataset.actionId);
                    return Boolean(item && isActorItemFavorite(this.app.actor, item));
                },
                callback: async el => {
                    const action = this.app.actions?.find(a => a.id === el.dataset.actionId);
                    const item = action?.originalItem ?? this.app.actor?.items?.get(el.dataset.actionId);
                    if (item) {
                        await setActorItemFavorite(this.app.actor, item, false);
                        this.app.render();
                    }
                }
            },
            {
                name: "BAD.core.hideAction",
                icon: '<i class="fas fa-eye-slash"></i>',
                condition: el => {
                    if (!this.app.actor?.isOwner) return false;
                    const action = this.app.actions?.find(a => a.id === el.dataset.actionId);
                    return action && !action.isHidden;
                },
                callback: el => {
                    this.app._toggleActionHidden(el.dataset.actionId, true);
                }
            },
            {
                name: "BAD.core.unhideAction",
                icon: '<i class="fas fa-eye"></i>',
                condition: el => {
                    if (!this.app.actor?.isOwner) return false;
                    const action = this.app.actions?.find(a => a.id === el.dataset.actionId);
                    return action && action.isHidden;
                },
                callback: el => {
                    this.app._toggleActionHidden(el.dataset.actionId, false);
                }
            }
        ];

        const systemItems = adapter.getContextMenuItems(this.app);
        if (systemItems.length > 0) {
            menuItems.push(...systemItems);
        }

        const targetBody = this.app?.element?.ownerDocument?.body ?? document.body;

        const options = {
            jQuery: false,
            onOpen: (target) => {
                if (this.app._activeLeftClickMenu) {
                    const prevLeftMenu = this.app._activeLeftClickMenu;
                    this.app._activeLeftClickMenu = null;
                    try {
                        prevLeftMenu.close()?.catch?.(err => {
                            log.debug("LeftClickMenu.close promise rejected:", err);
                        });
                    } catch (err) {
                        log.debug("LeftClickMenu.close threw synchronously:", err);
                    }
                }
                if (this.app._activeMenuTarget) {
                    const prevMenuTarget = this.app._activeMenuTarget;
                    this.app._activeMenuTarget = null;
                    prevMenuTarget?.classList?.remove?.('bad-dropdown-active');
                }
                this.closeSubmenu();

                this.app._activeContextMenuTarget = target;
                this.element.querySelectorAll('.bad-action-item').forEach(el => {
                    if (el !== target) el.classList.remove('bad-menu-active');
                });
                target.classList.add('bad-menu-active');
                this.element.querySelector('.bakana-action-display-container')?.classList.add('has-context-menu');

                const scheduleReposition = () => {
                    this._positionContextMenu(target, menuItems.length);
                    this._bindSubmenus(target, menuItems);
                };

                scheduleReposition();
                queueMicrotask(scheduleReposition);
                requestAnimationFrame(scheduleReposition);
            },
            onClose: () => {
                this.closeSubmenu();
                const prevContextTarget = this.app._activeContextMenuTarget;
                this.app._activeContextMenuTarget = null;
                prevContextTarget?.classList?.remove?.('bad-menu-active');
                this.element.querySelector('.bakana-action-display-container')?.classList?.remove?.('has-context-menu');
                document.querySelectorAll('#context-menu.bad-context-menu, .context-menu.bad-context-menu').forEach(el => el.classList?.remove?.('bad-context-menu'));
            }
        };

        const ContextMenuClass = adapter.foundry.ContextMenu;
        return new ContextMenuClass(this.element, ".bad-action-item", menuItems, options);
    }

    /**
     * Reparent and position the context menu in the document body so it escapes HUD scroll boundaries.
     * @param {HTMLElement} target Target action item element
     * @param {number} itemCount Number of items in context menu
     * @private
     */
    _positionContextMenu(target, itemCount) {
        const targetBody = this.app?.element?.ownerDocument?.body ?? document.body;
        const menuEl = document.querySelector('#context-menu, .context-menu:not(.bad-sub-context-menu)');
        if (!menuEl) return;

        menuEl.classList?.add?.('bad-context-menu');

        if (menuEl.parentElement !== targetBody) {
            targetBody.appendChild(menuEl);
        }

        const rect = target.getBoundingClientRect?.() ?? { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 };
        const viewportHeight = window?.innerHeight ?? 1080;
        const spaceBelow = viewportHeight - rect.bottom - 15;
        const spaceAbove = rect.top - 15;
        const actualCount = menuEl.querySelectorAll?.('.context-item')?.length || itemCount || 1;
        const neededHeight = actualCount * 36 + 15;

        // Prefer down: only place above if space below is critically constrained (< 80px) and space above is larger
        const placeAbove = spaceBelow < Math.min(neededHeight, 80) && spaceAbove > spaceBelow;
        const availableSpace = placeAbove ? spaceAbove : spaceBelow;
        const maxHeight = Math.max(60, Math.min(neededHeight, availableSpace));

        const styles = {
            position: 'fixed',
            left: `${rect.left}px`,
            top: placeAbove ? 'auto' : `${rect.bottom}px`,
            bottom: placeAbove ? `${viewportHeight - rect.top}px` : 'auto',
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
    }

    /**
     * Close any currently open submenu popout.
     */
    closeSubmenu() {
        if (this._activeSubmenuEl) {
            this._activeSubmenuEl.remove();
            this._activeSubmenuEl = null;
        }
        if (this._submenuCloseTimeout) {
            clearTimeout(this._submenuCloseTimeout);
            this._submenuCloseTimeout = null;
        }
    }

    /**
     * Scan the opened context menu and bind submenu popout triggers.
     * @param {HTMLElement} target Action card target
     * @param {Object[]} menuItems List of menu item configurations
     * @private
     */
    _bindSubmenus(target, menuItems) {
        setTimeout(() => {
            const contextMenuEl = document.querySelector('#context-menu, .context-menu');
            if (!contextMenuEl) return;

            const action = this.app.actions?.find(a => a.id === target?.dataset?.actionId);
            const item = action?.originalItem ?? this.app.actor?.items?.get(target?.dataset?.actionId);

            const itemLis = contextMenuEl.querySelectorAll('.context-item');
            for (const li of itemLis) {
                const text = li.textContent.trim();
                const matchedItem = menuItems.find(m => {
                    const localized = game.i18n.localize(m.name);
                    return localized && text.includes(localized);
                });

                if (matchedItem?.submenu?.length) {
                    if (!li.querySelector('.bad-menu-submenu-arrow')) {
                        const arrow = document.createElement('i');
                        arrow.className = 'fas fa-chevron-right bad-menu-submenu-arrow';
                        li.appendChild(arrow);
                    }

                    const openThisSubmenu = (event) => {
                        event?.stopPropagation?.();
                        if (this._submenuCloseTimeout) {
                            clearTimeout(this._submenuCloseTimeout);
                            this._submenuCloseTimeout = null;
                        }
                        this._openSubmenu(li, target, item, matchedItem.submenu);
                    };

                    const scheduleClose = () => {
                        if (this._submenuCloseTimeout) clearTimeout(this._submenuCloseTimeout);
                        this._submenuCloseTimeout = setTimeout(() => {
                            this.closeSubmenu();
                        }, 180);
                    };

                    li.addEventListener('mouseenter', openThisSubmenu);
                    li.addEventListener('click', openThisSubmenu);
                    li.addEventListener('mouseleave', scheduleClose);
                } else {
                    li.addEventListener('mouseenter', () => {
                        this.closeSubmenu();
                    });
                }
            }
        }, 10);
    }

    /**
     * Open and position a submenu popup to the right of the triggering menu item.
     * @param {HTMLElement} parentLi Triggering context menu item element
     * @param {HTMLElement} target Target action item element
     * @param {Item} item Resolved Foundry Item document
     * @param {Object[]} submenuItems Submenu item specifications
     * @private
     */
    _openSubmenu(parentLi, target, item, submenuItems) {
        this.closeSubmenu();

        const qualifying = submenuItems.filter(sub => {
            return sub.condition ? Boolean(sub.condition(item)) : true;
        });

        if (qualifying.length === 0) return;

        const nav = document.createElement('nav');
        nav.className = 'context-menu bad-sub-context-menu';

        const ol = document.createElement('ol');
        ol.className = 'context-items';

        for (const sub of qualifying) {
            const li = document.createElement('li');
            li.className = 'context-item';

            const isActive = Boolean(sub.active?.(item));
            if (isActive) {
                li.classList.add('active-state');
            }

            const iconSpan = document.createElement('span');
            iconSpan.className = 'bad-menu-icon-wrap';
            iconSpan.innerHTML = sub.icon ?? '';
            li.appendChild(iconSpan);

            const titleSpan = document.createElement('span');
            titleSpan.textContent = game.i18n.localize(sub.name);
            li.appendChild(titleSpan);

            if (isActive) {
                const checkIcon = document.createElement('i');
                checkIcon.className = 'fas fa-check bad-submenu-check';
                li.appendChild(checkIcon);
            }

            li.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.closeSubmenu();

                const parentMenu = document.querySelector('#context-menu, .context-menu');
                parentMenu?.classList?.remove?.('bad-context-menu');
                parentMenu?.remove?.();
                document.querySelectorAll('#context-menu.bad-context-menu, .context-menu.bad-context-menu').forEach(el => el.classList?.remove?.('bad-context-menu'));
                if (this.app._activeContextMenuTarget) {
                    this.app._activeContextMenuTarget.classList.remove('bad-menu-active');
                    this.app._activeContextMenuTarget = null;
                }
                this.element.querySelector('.bakana-action-display-container')?.classList.remove('has-context-menu');

                await sub.callback?.(item);
                if (this.app.rendered) {
                    this.app.render();
                }
            });

            ol.appendChild(li);
        }

        nav.appendChild(ol);
        document.body.appendChild(nav);
        this._activeSubmenuEl = nav;

        nav.addEventListener('mouseenter', () => {
            if (this._submenuCloseTimeout) {
                clearTimeout(this._submenuCloseTimeout);
                this._submenuCloseTimeout = null;
            }
        });
        nav.addEventListener('mouseleave', () => {
            if (this._submenuCloseTimeout) clearTimeout(this._submenuCloseTimeout);
            this._submenuCloseTimeout = setTimeout(() => {
                this.closeSubmenu();
            }, 180);
        });

        const rect = parentLi.getBoundingClientRect();
        let left = rect.right + 2;
        let top = rect.top;

        const subRect = nav.getBoundingClientRect();
        if (left + subRect.width > window.innerWidth - 10) {
            left = Math.max(10, rect.left - subRect.width - 2);
        }
        if (top + subRect.height > window.innerHeight - 10) {
            top = Math.max(10, window.innerHeight - subRect.height - 10);
        }

        nav.style.left = `${left}px`;
        nav.style.top = `${top}px`;
    }
}

/**
 * Factory helper to instantiate ContextMenuManager and construct the action context menu.
 * @param {ApplicationV2} app Active ActionDisplayApp instance
 * @param {HTMLElement} element Root application DOM element
 * @returns {ContextMenu} The created ContextMenu instance
 */
export function createActionContextMenu(app, element) {
    const manager = new ContextMenuManager(app, element);
    return manager.createActionContextMenu();
}
