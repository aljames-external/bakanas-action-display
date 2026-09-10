import { BaseFoundryAdapter } from './base-foundry-adapter.js';

/**
 * Foundry VTT V12 platform baseline adapter.
 * Extends BaseFoundryAdapter and provides global constructors and legacy UUID/combat handlers for Foundry V12.
 */
export class FoundryV12Adapter extends BaseFoundryAdapter {
    /**
     * The active ContextMenu constructor in v12.
     */
    override get ContextMenu(): any {
        return ContextMenu;
    }

    /**
     * The active KeyboardManager constructor in v12.
     */
    override get KeyboardManager(): any {
        return KeyboardManager;
    }

    /**
     * The active Token placeable constructor in v12.
     */
    override get Token(): any {
        return Token;
    }

    /**
     * The active FilePicker constructor / implementation in v12.
     */
    override get FilePicker(): any {
        return FilePicker;
    }

    /**
     * The active TextEditor constructor / implementation in v12.
     */
    override get TextEditor(): any {
        return TextEditor;
    }
    /**
     * Safely resolve a document from UUID synchronously in Foundry V12.
     * @param {string} uuid Document UUID
     * @param {FromUuidOptions} [options={}] Resolution options
     * @returns {Document|null}
     */
    override fromUuidSync(uuid: string, options: FromUuidOptions = {}): any {
        return fromUuidSync(uuid, options);
    }

    /**
     * Safely resolve a document from UUID asynchronously in Foundry V12.
     * @param {string} uuid Document UUID
     * @param {FromUuidOptions} [options={}] Resolution options
     * @returns {Promise<Document|null>}
     */
    override async fromUuid(uuid: string, options: FromUuidOptions = {}): Promise<any> {
        return fromUuid(uuid, options);
    }

    /**
     * Retrieve all combatants associated with a token in combat using legacy V12 Combat#getCombatantByToken.
     * @param {Combat} combat Target combat encounter
     * @param {Token} token Target Token placeable
     * @returns {Combatant[]}
     */
    override getCombatantsByToken(combat: Combat, token: Token): Combatant[] {
        if (!combat || !token?.id) return [];
        const single = combat.getCombatantByToken(token.id);
        return single ? [single] : [];
    }

    /**
     * Preload Handlebars templates in Foundry V12 using global loadTemplates.
     * @override
     * @param {string[]} paths Array of template paths
     * @returns {Promise<Function[]>}
     */
    override async loadTemplates(paths: string[]): Promise<Function[]> {
        return loadTemplates(paths);
    }

    /**
     * Determine whether an update operation represents a teleportation in Foundry V12.
     * Evaluates modern movement options when present, falling back to legacy V12 options.teleport and options.animate.
     * @override
     * @param {Record<string, unknown>} [options={}] Operation options
     * @returns {boolean}
     */
    override isTeleport(options: Record<string, unknown> = {}): boolean {
        if (options.movement !== undefined) {
            if (options.movement === false) return true;
            return Boolean((options.movement as any)?.teleport);
        }
        return Boolean(options.teleport || options.animate === false);
    }
}
