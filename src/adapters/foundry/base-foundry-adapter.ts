import { deepFreeze } from '../../lib/utils.js';

/**
 * User permission tiers for ownership priority evaluation.
 * Tier 1: Players (least permissions)
 * Tier 2: Trusted Players
 * Tier 3: GM / Co-GM (most permissions)
 * @type {Readonly<{ PLAYER: 1, TRUSTED: 2, GM: 3 }>}
 */
export const USER_PERMISSION_TIERS = deepFreeze({
    PLAYER: 1,
    TRUSTED: 2,
    GM: 3
});

export interface ContextMenuItemConfig {
    name?: string;
    label?: string;
    icon?: string;
    classes?: string;
    condition?: ((target: JQuery | HTMLElement) => boolean) | (() => boolean);
    callback?: ((target: JQuery | HTMLElement) => void | Promise<void>) | (() => void | Promise<void>);
    children?: ContextMenuItemConfig[];
    [key: string]: unknown;
}

export interface ContextMenuInstance {
    bind: () => void;
    close: (options?: { force?: boolean; [key: string]: unknown }) => Promise<void>;
    render: (target: unknown) => Promise<void>;
    menu?: HTMLElement | JQuery | null;
    [key: string]: unknown;
}

export type ContextMenuConstructor = new (
    element: HTMLElement | JQuery,
    selector: string,
    menuItems: ContextMenuItemConfig[] | unknown[],
    options?: Record<string, unknown>
) => ContextMenuInstance;

export interface KeyboardManagerClass {
    MODIFIER_KEYS: {
        ALT: "Alt";
        CONTROL: "Control";
        SHIFT: "Shift";
        [key: string]: string;
    };
    [key: string]: unknown;
}


/**
 * Base abstract class for all Foundry platform adapters.
 * Encapsulates version-agnostic Foundry Application, ContextMenu, interaction, and utility operations.
 */
export class BaseFoundryAdapter {
    /**
     * The major generation version of Foundry VTT, dynamically extracted from game.release.generation.
     * @returns {number}
     */
    get generation(): number {
        return (game as unknown as { release?: { generation?: number } })?.release?.generation ?? 12;
    }

    /**
     * The active ContextMenu constructor.
     */
    get ContextMenu(): ContextMenuConstructor {
        throw new Error('BaseFoundryAdapter.ContextMenu must be implemented by version subclass');
    }

    /**
     * The active KeyboardManager constructor.
     */
    get KeyboardManager(): KeyboardManagerClass {
        throw new Error('BaseFoundryAdapter.KeyboardManager must be implemented by version subclass');
    }

    /**
     * The active Token placeable constructor.
     */
    get Token(): typeof Token {
        throw new Error('BaseFoundryAdapter.Token must be implemented by version subclass');
    }

    /**
     * The active TokenHUD constructor / class.
     */
    get TokenHUD(): typeof TokenHUD {
        return (CONFIG as unknown as { Token?: { hudClass?: typeof TokenHUD } })?.Token?.hudClass ?? (TokenHUD as unknown as typeof TokenHUD);
    }

    /**
     * The active ApplicationV2 constructor.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get ApplicationV2(): any {
        return (foundry as any)?.applications?.api?.ApplicationV2;
    }

    /**
     * The active HandlebarsApplicationMixin wrapper.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get HandlebarsApplicationMixin(): any {
        return (foundry as any)?.applications?.api?.HandlebarsApplicationMixin;
    }

    /**
     * The active FilePicker constructor / implementation.
     */
    get FilePicker(): typeof FilePicker {
        throw new Error('BaseFoundryAdapter.FilePicker must be implemented by version subclass');
    }

    /**
     * The active TextEditor constructor / implementation.
     */
    get TextEditor(): typeof TextEditor {
        throw new Error('BaseFoundryAdapter.TextEditor must be implemented by version subclass');
    }

    /**
     * Browse a directory using the active FilePicker implementation.
     * @param {string} source Storage source (e.g. 'data', 'public', 'client')
     * @param {string} target Directory target path
     * @param {Record<string, unknown>} [options={}] Browse options
     * @returns {Promise<{ target: string, files: string[], dirs: string[] }>}
     */
    async browseDirectory(source: string, target: string, options: Record<string, unknown> = {}): Promise<{ target: string; files: string[]; dirs: string[] }> {
        return this.FilePicker.browse(source, target, options);
    }

    /**
     * Preload Handlebars templates across Foundry generations.
     * @abstract
     * @param {string[]} paths Array of template paths
     * @returns {Promise<Function[]>}
     */
    async loadTemplates(paths: string[]): Promise<Function[]> {
        throw new Error('BaseFoundryAdapter.loadTemplates must be implemented by version subclass');
    }

    /**
     * Safely resolve a document from UUID synchronously.
     * @param {string} uuid Document UUID
     * @param {FromUuidOptions} [options={}] Resolution options
     * @returns {Document|null}
     */
    fromUuidSync(uuid: string, options: FromUuidOptions = {}): ReturnType<typeof fromUuidSync> {
        throw new Error('BaseFoundryAdapter.fromUuidSync must be implemented by version subclass');
    }

    /**
     * Safely resolve a document from UUID asynchronously.
     * @param {string} uuid Document UUID
     * @param {FromUuidOptions} [options={}] Resolution options
     * @returns {Promise<Document|null>}
     */
    async fromUuid(uuid: string, options: FromUuidOptions = {}): ReturnType<typeof fromUuid> {
        throw new Error('BaseFoundryAdapter.fromUuid must be implemented by version subclass');
    }

    /**
     * Determine whether an update operation represents a teleportation.
     * Must be implemented by version-specific adapter subclasses.
     * @param {Record<string, unknown>} [options={}] Operation options or DatabaseUpdateOperation
     * @returns {boolean}
     */
    isTeleport(options: Record<string, unknown> = {}): boolean {
        throw new Error('BaseFoundryAdapter.isTeleport must be implemented by version subclass');
    }

    /**
     * Merge two objects recursively.
     * @param {Object} original Target object
     * @param {Object} [other={}] Source object
     * @param {Record<string, unknown>} [options={}] Merge options
     * @returns {Object}
     */
    mergeObject<T extends object, U extends object>(original: T, other: U = {} as U, options: Record<string, unknown> = {}): T & U {
        return foundry.utils.mergeObject(original, other, options as any) as T & U;
    }

    /**
     * Deep duplicate an object.
     * @param {*} obj Target object
     * @returns {*}
     */
    duplicate<T>(obj: T): T {
        return foundry.utils.duplicate(obj) as T;
    }

    /**
     * Retrieve a property from an object by dot-separated path.
     * @param {object} obj Target object
     * @param {string} path Dot path
     * @returns {*}
     */
    getProperty(obj: object, path: string): unknown {
        return foundry.utils.getProperty(obj, path);
    }

    /**
     * Set a property on an object by dot-separated path.
     * @param {object} obj Target object
     * @param {string} path Dot path
     * @param {*} value Property value
     * @returns {boolean}
     */
    setProperty(obj: object, path: string, value: unknown): boolean {
        return foundry.utils.setProperty(obj, path, value);
    }

    /**
     * Generate a random string identifier.
     * @param {number} [length=16] Length of the identifier
     * @returns {string}
     */
    randomID(length = 16): string {
        return foundry.utils.randomID(length);
    }

    /**
     * Test whether an object is empty.
     * @param {object} obj Target object
     * @returns {boolean}
     */
    isEmpty(obj: object): boolean {
        return foundry.utils.isEmpty(obj);
    }

    /**
     * Test whether version v1 is strictly newer than version v0.
     * @param {string|number} v1 Target version
     * @param {string|number} v0 Reference version to compare against
     * @param {object} [options] Comparison options
     * @returns {boolean}
     */
    isNewerVersion(v1: string | number, v0: string | number, options?: { majorOnly?: boolean }): boolean {
        return foundry.utils.isNewerVersion(v1, v0, options);
    }

    /**
     * Enrich an HTML string with Foundry enrichers, roll data, and document links.
     * @param {string} content HTML string to enrich
     * @param {Record<string, unknown>} [options={}] Enrichment options (rollData, secrets, relativeTo, etc.)
     * @returns {Promise<string>}
     */
    async enrichHTML(content: string, options: Record<string, unknown> = {}): Promise<string> {
        if (!content) return '';
        return this.TextEditor.enrichHTML(content, { secrets: false, async: true, ...options } as unknown as Parameters<typeof TextEditor.enrichHTML>[1]);
    }

    /**
     * Retrieve all combatants associated with a token in combat.
     * @param {Combat} combat Target combat encounter
     * @param {Token} token Target Token placeable
     * @returns {Combatant[]}
     */
    getCombatantsByToken(combat: Combat, token: Token): Combatant[] {
        throw new Error('BaseFoundryAdapter.getCombatantsByToken must be implemented by version subclass');
    }

    /**
     * Retrieve the primary combatant associated with a token in combat.
     * @param {Combat} combat Target combat encounter
     * @param {Token} token Target Token placeable
     * @returns {Combatant|null}
     */
    getCombatantByToken(combat: Combat, token: Token): Combatant | null {
        return this.getCombatantsByToken(combat, token)[0] ?? null;
    }

    /**
     * Resolve the placeable Token or TokenDocument from a Combatant.
     * @param {Combatant} combatant
     * @returns {Token|null}
     */
    getTokenFromCombatant(combatant: Combatant | null | undefined): Token | null {
        if (!combatant) return null;
        if (combatant.token?.object) {
            return combatant.token.object;
        }
        if (combatant.tokenId && canvas?.tokens?.get) {
            const canvasToken = canvas.tokens.get(combatant.tokenId);
            if (canvasToken) return canvasToken;
        }
        if (combatant.actor?.getActiveTokens) {
            const activeTokens = combatant.actor.getActiveTokens();
            if (activeTokens?.length) return activeTokens[0];
        }
        if (combatant.token) {
            return (combatant.token as any).object ?? (combatant.token as any);
        }
        return null;
    }

    /**
     * User permission tiers for ownership priority evaluation.
     * @type {Readonly<{ PLAYER: 1, TRUSTED: 2, GM: 3 }>}
     */
    get USER_PERMISSION_TIERS() {
        return USER_PERMISSION_TIERS;
    }

    /**
     * Classify a Foundry User into a standard permission tier (1: Player, 2: Trusted Player, 3: GM / Co-GM).
     * @param {User|null} user Concrete User document
     * @returns {number|null} 1 for Player, 2 for Trusted, 3 for GM, or null if invalid/none
     */
    getUserPermissionTier(user: User | null | undefined): number | null {
        if (!user) return null;
        if (user.isGM) return USER_PERMISSION_TIERS.GM;

        const userRole = user.role;
        if (userRole === 0) return null;

        const assistantRole = CONST.USER_ROLES.ASSISTANT;
        const trustedRole = CONST.USER_ROLES.TRUSTED;
        const playerRole = CONST.USER_ROLES.PLAYER;

        if (userRole != null && userRole >= assistantRole) {
            return USER_PERMISSION_TIERS.GM;
        }
        if (userRole === trustedRole || Boolean((user as unknown as { isTrusted?: boolean }).isTrusted)) {
            return USER_PERMISSION_TIERS.TRUSTED;
        }
        if (userRole === playerRole || !(user as unknown as { isTrusted?: boolean }).isTrusted) {
            return USER_PERMISSION_TIERS.PLAYER;
        }
        return null;
    }

    /**
     * Determine if a user has ownership level permissions over a document (actor or token document).
     * @param {User|null} user Target user
     * @param {Actor|TokenDocument|Document|null} doc Concrete Document (Actor or TokenDocument)
     * @returns {boolean} True if the user has an ownership role
     */
    isUserDocumentOwner(user: User | null | undefined, doc: foundry.abstract.Document.Any | null | undefined): boolean {
        if (!user || !doc) return false;

        // GM / Co-GM always has ownership over all documents in Foundry
        if (this.getUserPermissionTier(user) === USER_PERMISSION_TIERS.GM) {
            return true;
        }

        const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        const docObj = doc as unknown as {
            testUserPermission?: (u: User, p: string) => boolean;
            getUserLevel?: (u: User) => number;
            ownership?: Record<string, number> & { default?: number };
            isOwner?: boolean;
        };
        if (typeof docObj.testUserPermission === 'function') {
            return Boolean(docObj.testUserPermission(user, 'OWNER'));
        }
        if (typeof docObj.getUserLevel === 'function') {
            return docObj.getUserLevel(user) >= ownerLevel;
        }
        if (docObj.ownership) {
            const level = (user.id ? docObj.ownership[user.id] : undefined) ?? docObj.ownership.default ?? 0;
            return level >= ownerLevel;
        }
        return (user.id === game.user?.id || user === game.user) && Boolean(docObj.isOwner);
    }

    /**
     * Determine if a user is "in-charge" of a token.
     * A user is in-charge of a token if:
     * 1. The user has an ownership role of the token.
     * 2. There is no other currently connected user with fewer permissions (lower tier) who also has an ownership role of that token.
     *
     * Ownership priority tiers (among currently connected users):
     * Players who own -> Trusted Players who own -> GM / Co-GM who own.
     *
     * @param {Token} token Token placeable
     * @param {User} [user=game.user] Target user to evaluate (defaults to active client user)
     * @returns {boolean} True if the user is in-charge of the token
     */
    isUserInCharge(token: Token, user: User = game.user): boolean {
        if (!token || !user) return false;

        const tokenDoc = token.document;
        const actor = token.actor;

        const isOwner = (u: User) => this.isUserDocumentOwner(u, actor) || this.isUserDocumentOwner(u, tokenDoc);

        if (!isOwner(user)) {
            return false;
        }

        const userTier = this.getUserPermissionTier(user);
        if (!userTier) return false;

        // Tier 1 (Player) is the lowest permission tier; if they own it, they are in-charge.
        if (userTier === USER_PERMISSION_TIERS.PLAYER) {
            return true;
        }

        const usersCollection = game.users;
        const allUsers = usersCollection?.contents ?? [user];

        // Filter to only currently connected (active) other users
        const activeOtherUsers = allUsers.filter(otherUser => {
            if (otherUser.id === user.id || otherUser === user) return false;
            return Boolean(otherUser.active);
        });

        // Tier 2 (Trusted Player): in-charge only if NO connected Tier 1 (Player) owns it
        if (userTier === USER_PERMISSION_TIERS.TRUSTED) {
            const hasConnectedPlayerOwner = activeOtherUsers.some(otherUser => {
                return this.getUserPermissionTier(otherUser) === USER_PERMISSION_TIERS.PLAYER
                    && isOwner(otherUser);
            });
            return !hasConnectedPlayerOwner;
        }

        // Tier 3 (GM / Co-GM): in-charge only if NO connected Tier 1 (Player) and NO connected Tier 2 (Trusted Player) owns it
        if (userTier === USER_PERMISSION_TIERS.GM) {
            const hasConnectedLowerTierOwner = activeOtherUsers.some(otherUser => {
                const otherTier = this.getUserPermissionTier(otherUser);
                return (otherTier === USER_PERMISSION_TIERS.PLAYER || otherTier === USER_PERMISSION_TIERS.TRUSTED)
                    && isOwner(otherUser);
            });
            return !hasConnectedLowerTierOwner;
        }

        return false;
    }

    /**
     * Determine if a token is currently visible to the specified user.
     * @param {Token} token Target token placeable to evaluate
     * @param {User} [user=game.user] Target user to evaluate (defaults to active client user)
     * @returns {boolean} True if the token is visible to the user
     */
    isTokenVisible(token: Token, user: User = game.user): boolean {
        if (!token || !user) return false;
        if (user.isGM) return true;
        if (token.visible !== undefined) return Boolean(token.visible);
        const tokenDoc = token.document;
        return !tokenDoc?.hidden;
    }

    /**
     * Exclusively select/control the specified token on canvas.
     * @param {Token} token Target token placeable to select
     * @returns {void}
     */
    selectToken(token: Token): void {
        if (!token) return;
        token.control?.({ releaseOthers: true });
    }

    /**
     * Recenter the canvas view on the token's center coordinates.
     * @param {Token} token Target token to center on
     * @returns {Promise<void>}
     */
    async centerCanvasOnToken(token: Token): Promise<void> {
        if (!token) return;
        const center = token.center ?? {
            x: token.x + (token.w / 2),
            y: token.y + (token.h / 2)
        };
        await canvas?.animatePan?.({ x: center.x, y: center.y });
    }
}
