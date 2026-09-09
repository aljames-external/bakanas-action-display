/**
 * Position a floating context menu or activity dropdown anchored to a target action card.
 * Reparents the menu to targetBody to escape HUD container clipping and sets fixed positioning styles.
 * @param {HTMLElement} menuEl
 * @param {HTMLElement} target
 * @param {number} [fallbackItemCount=1]
 * @param {HTMLElement} [targetBody=document.body]
 */
export function positionFloatingMenu(menuEl, target, fallbackItemCount = 1, targetBody = document.body) {
    if (!menuEl || !target) return;

    menuEl.classList?.add?.('bad-context-menu');

    if (targetBody && menuEl.parentElement !== targetBody) {
        targetBody.appendChild(menuEl);
    }

    const rect = target.getBoundingClientRect?.() ?? { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 };
    const viewportHeight = window?.innerHeight ?? 1080;
    const spaceBelow = viewportHeight - rect.bottom - 15;
    const spaceAbove = rect.top - 15;
    const queriedCount = menuEl.querySelectorAll?.('.context-item')?.length;
    const actualCount = Number.isFinite(queriedCount) && queriedCount > 0 ? queriedCount : (fallbackItemCount > 0 ? fallbackItemCount : 1);
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
        height: 'auto',
        'min-height': '0',
        'max-height': `${maxHeight}px`
    };

    for (const [prop, val] of Object.entries(styles)) {
        menuEl.style?.setProperty?.(prop, val, 'important');
    }
}
