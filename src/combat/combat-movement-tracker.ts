import { log } from '../lib/logger.js';
import { getFoundryAdapter } from '../adapters/foundry/index.js';

/**
 * Tracks token movement distance during active combat encounters.
 */
export class CombatMovementTracker {
    /**
     * Map of tokenId -> number (accumulated moved distance in current turn in grid units).
     * @type {Map<string, number>}
     * @private
     */
    static #movedDistances = new Map<string | null, number>();

    /**
     * Map of tokenId -> { x: number, y: number, elevation: number } (last known token position).
     * @type {Map<string, { x: number, y: number, elevation: number }>}
     * @private
     */
    static #lastPositions = new Map<string | null, { x: number; y: number; elevation: number }>();

    /**
     * Current combat turn identifier string (e.g. "combatId-round-turn").
     * @type {string|null}
     * @private
     */
    static #currentTurnKey: string | null = null;

    /**
     * Reset movement tracking state for a new combat turn or encounter reset.
     * @param {Combat|null} [combat=game.combat]
     */
    static resetTurn(combat: Combat | null = game.combat) {
        if (!combat || !combat.started) {
            this.#movedDistances.clear();
            this.#lastPositions.clear();
            this.#currentTurnKey = null;
            return;
        }

        const turnKey = `${combat.id}-${combat.round}-${combat.turn}`;
        if (this.#currentTurnKey !== turnKey) {
            this.#currentTurnKey = turnKey;
            this.#movedDistances.clear();
            this.#initializeCombatantPositions(combat);
            log.debug(`CombatMovementTracker.resetTurn | Reset movement for turn ${turnKey}`);
        }
    }

    /**
     * Initialize last known positions for all tokens in active combat.
     * @param {Combat} combat
     * @private
     */
    static #initializeCombatantPositions(combat: Combat) {
        if (!combat?.combatants) return;
        for (const combatant of combat.combatants) {
            if (!combatant.tokenId) continue;
            const tokenDoc = combatant.token ?? canvas?.tokens?.get?.(combatant.tokenId)?.document;
            if (tokenDoc) {
                this.#lastPositions.set(combatant.tokenId, {
                    x: tokenDoc.x,
                    y: tokenDoc.y,
                    elevation: tokenDoc.elevation ?? 0
                });
            }
        }
    }

    /**
     * Record a movement update for a token.
     * @param {TokenDocument} tokenDoc TokenDocument that mutated
     * @param {Object} changes Document change delta
     * @param {Object} [options={}] Operation options
     */
    static recordTokenMovement(
        tokenDoc: TokenDocument | null | undefined,
        changes: { x?: number; y?: number; elevation?: number; [key: string]: unknown },
        options: Record<string, unknown> = {}
    ) {
        if (!tokenDoc) return;
        const combat = game.combat;
        if (!combat || !combat.started) return;

        // Teleportation does not consume movement distance
        if (getFoundryAdapter().isTeleport(options)) {
            const tokenId = tokenDoc.id;
            this.#lastPositions.set(tokenId, {
                x: changes.x ?? tokenDoc.x,
                y: changes.y ?? tokenDoc.y,
                elevation: changes.elevation ?? tokenDoc.elevation ?? 0
            });
            return;
        }

        // Only track spatial coordinate changes
        const hasMovedX = changes.x !== undefined;
        const hasMovedY = changes.y !== undefined;
        const hasMovedElevation = changes.elevation !== undefined;

        if (!hasMovedX && !hasMovedY && !hasMovedElevation) return;

        // Ensure turn key is synchronized
        this.resetTurn(combat);

        const tokenId = tokenDoc.id;
        const previous = this.#lastPositions.get(tokenId) ?? {
            x: tokenDoc.x,
            y: tokenDoc.y,
            elevation: tokenDoc.elevation ?? 0
        };

        const target = {
            x: changes.x ?? previous.x,
            y: changes.y ?? previous.y,
            elevation: changes.elevation ?? previous.elevation
        };

        // If coordinates did not actually change, ignore
        if (previous.x === target.x && previous.y === target.y && previous.elevation === target.elevation) {
            return;
        }

        const stepDistance = this.measureSegmentDistance(previous, target);
        this.#lastPositions.set(tokenId, target);

        if (stepDistance > 0) {
            const currentTotal = this.#movedDistances.get(tokenId) ?? 0;
            const newTotal = Math.round((currentTotal + stepDistance) * 10) / 10;
            this.#movedDistances.set(tokenId, newTotal);
            log.debug(`CombatMovementTracker.recordTokenMovement | Token "${tokenDoc.name}" moved ${stepDistance} (turn total: ${newTotal})`);
        }
    }

    /**
     * Measure the distance between two waypoints in grid units (feet/meters).
     * @param {{ x: number, y: number, elevation?: number }} p0
     * @param {{ x: number, y: number, elevation?: number }} p1
     * @returns {number} Distance in grid units
     */
    static measureSegmentDistance(p0: { x: number; y: number; elevation?: number }, p1: { x: number; y: number; elevation?: number }): number {
        if (canvas?.grid && (canvas.grid as any).measurePath) {
            try {
                const result = (canvas.grid as any).measurePath([p0, p1]);
                if (Number.isFinite(result?.distance)) {
                    return result.distance;
                }
            } catch (_) {}
        }

        if (canvas?.grid && (canvas.grid as any).measureDistance) {
            try {
                return (canvas.grid as any).measureDistance(p0, p1, { gridSpaces: true });
            } catch (_) {}
        }

        // Fallback calculation if canvas.grid is not available (e.g. test environment)
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const gridDistance = canvas?.scene?.grid?.distance ?? 5;
        const gridSize = canvas?.scene?.grid?.size ?? 100;
        const pixelDist = Math.hypot(dx, dy);
        return Math.round((pixelDist / gridSize) * gridDistance);
    }

    /**
     * Retrieve the distance the token has moved in the current combat turn.
     * @param {Token|null} [token=null] Target token placeable
     * @param {Actor|null} [actor=null] Associated actor document
     * @returns {{ inCombat: boolean, distance: number, units: string }}
     */
    static getMovementThisTurn(token: Token | null = null, actor: any = null): { inCombat: boolean; distance: number; units: string } {
        const combat = game.combat;
        const fallbackUnits = (actor as any)?.system?.attributes?.movement?.units ?? 'ft';
        const units = canvas?.scene?.grid?.units ?? fallbackUnits;

        if (!combat || !combat.started) {
            return { inCombat: false, distance: 0, units };
        }

        const tokenId = token?.id ?? null;
        if (!tokenId) {
            return { inCombat: false, distance: 0, units };
        }

        const isCombatant = Boolean(
            combat.combatants?.some((c: any) => c.tokenId === tokenId || (actor && c.actorId === actor.id))
        );

        if (!isCombatant) {
            return { inCombat: false, distance: 0, units };
        }

        // Retrieve distance from internal turn movement tracker
        const tracked = this.#movedDistances.get(tokenId) ?? 0;
        return { inCombat: true, distance: Math.round(tracked * 10) / 10, units };
    }

    /**
     * Explicitly set moved distance for a token (useful in tests or external integrations).
     * @param {string} tokenId
     * @param {number} distance
     */
    static setMovedDistance(tokenId: string, distance: number) {
        if (!tokenId) return;
        this.#movedDistances.set(tokenId, distance);
    }

    /**
     * Clear all recorded distances and positions (e.g. when combat ends).
     */
    static clear() {
        this.#movedDistances.clear();
        this.#lastPositions.clear();
        this.#currentTurnKey = null;
    }
}
