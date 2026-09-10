import { FoundryV12Adapter } from './foundry-v12-adapter.js';
import type { ContextMenuConstructor, KeyboardManagerClass } from './base-foundry-adapter.js';

/**
 * Foundry VTT V13 platform adapter.
 * Extends FoundryV12Adapter and encapsulates capabilities and API changes introduced in Foundry V13.
 */
export class FoundryV13Adapter extends FoundryV12Adapter {
    /**
     * The active ContextMenu constructor in v13+.
     */
    override get ContextMenu(): ContextMenuConstructor {
        return (foundry as unknown as { applications?: { ux?: { ContextMenu?: { implementation: ContextMenuConstructor } } } }).applications?.ux?.ContextMenu?.implementation ?? super.ContextMenu;
    }

    /**
     * The active KeyboardManager constructor in v13+.
     */
    override get KeyboardManager(): KeyboardManagerClass {
        return (foundry as unknown as { helpers?: { interaction?: { KeyboardManager?: KeyboardManagerClass } } }).helpers?.interaction?.KeyboardManager ?? super.KeyboardManager;
    }

    /**
     * The active Token placeable constructor in v13+.
     */
    override get Token(): typeof Token {
        return (foundry as unknown as { canvas?: { placeables?: { Token?: typeof Token } } }).canvas?.placeables?.Token ?? super.Token;
    }

    /**
     * The active FilePicker constructor / implementation in v13+.
     */
    override get FilePicker(): typeof FilePicker {
        return (foundry as unknown as { applications?: { apps?: { FilePicker?: { implementation: typeof FilePicker } } } }).applications?.apps?.FilePicker?.implementation ?? super.FilePicker;
    }

    /**
     * The active TextEditor constructor / implementation in v13+.
     */
    override get TextEditor(): typeof TextEditor {
        return (foundry as unknown as { applications?: { ux?: { TextEditor?: { implementation: typeof TextEditor } } } }).applications?.ux?.TextEditor?.implementation ?? super.TextEditor;
    }

    /**
     * Safely resolve a document from UUID synchronously using standard V13+ foundry.utils.fromUuidSync.
     * @param {string} uuid Document UUID
     * @param {FromUuidOptions} [options={}] Resolution options
     * @returns {Document|null}
     */
    override fromUuidSync(uuid: string, options: FromUuidOptions = {}): ReturnType<typeof fromUuidSync> {
        return (foundry.utils as unknown as { fromUuidSync: typeof fromUuidSync }).fromUuidSync(uuid, options);
    }

    /**
     * Safely resolve a document from UUID asynchronously using standard V13+ foundry.utils.fromUuid.
     * @param {string} uuid Document UUID
     * @param {FromUuidOptions} [options={}] Resolution options
     * @returns {Promise<Document|null>}
     */
    override async fromUuid(uuid: string, options: FromUuidOptions = {}): ReturnType<typeof fromUuid> {
        return (foundry.utils as unknown as { fromUuid: typeof fromUuid }).fromUuid(uuid, options);
    }

    /**
     * Retrieve all combatants associated with a token in combat using native V13+ Combat#getCombatantsByToken.
     * @param {Combat} combat Target combat encounter
     * @param {Token} token Target Token placeable
     * @returns {Combatant[]}
     */
    override getCombatantsByToken(combat: Combat, token: Token): Combatant[] {
        if (!combat || !token) return [];
        return (combat as { getCombatantsByToken?: (t: unknown) => Combatant[] }).getCombatantsByToken?.(token) ?? [];
    }

    /**
     * Preload Handlebars templates in Foundry V13+ using namespaced foundry.applications.handlebars.loadTemplates.
     * @override
     * @param {string[]} paths Array of template paths
     * @returns {Promise<Function[]>}
     */
    override async loadTemplates(paths: string[]): Promise<Function[]> {
        return (foundry as unknown as { applications?: { handlebars?: { loadTemplates?: (p: string[]) => Promise<Function[]> } } }).applications?.handlebars?.loadTemplates?.(paths) ?? super.loadTemplates(paths);
    }

    /**
     * Determine whether an update operation represents a teleportation in Foundry V13+.
     * Evaluates standard V13+ operation.movement properties without accessing deprecated DatabaseUpdateOperation#teleport.
     * @override
     * @param {Record<string, unknown>} [options={}] Operation options or DatabaseUpdateOperation
     * @returns {boolean}
     */
    override isTeleport(options: Record<string, unknown> = {}): boolean {
        if (options.movement === false) return true;
        return Boolean((options.movement as { teleport?: boolean } | undefined)?.teleport);
    }
}
