import { FoundryV12Adapter } from './foundry-v12-adapter.js';

/**
 * Foundry VTT V13 platform adapter.
 * Extends FoundryV12Adapter and encapsulates capabilities and API changes introduced in Foundry V13.
 */
export class FoundryV13Adapter extends FoundryV12Adapter {
    /**
     * The active ContextMenu constructor in v13+.
     */
    override get ContextMenu(): any {
        return (foundry as any).applications?.ux?.ContextMenu?.implementation;
    }

    /**
     * The active KeyboardManager constructor in v13+.
     */
    override get KeyboardManager(): any {
        return (foundry as any).helpers?.interaction?.KeyboardManager;
    }

    /**
     * The active Token placeable constructor in v13+.
     */
    override get Token(): any {
        return (foundry as any).canvas?.placeables?.Token;
    }

    /**
     * The active FilePicker constructor / implementation in v13+.
     */
    override get FilePicker(): any {
        return (foundry as any).applications?.apps?.FilePicker?.implementation;
    }

    /**
     * The active TextEditor constructor / implementation in v13+.
     */
    override get TextEditor(): any {
        return (foundry as any).applications?.ux?.TextEditor?.implementation;
    }

    /**
     * Safely resolve a document from UUID synchronously using standard V13+ foundry.utils.fromUuidSync.
     * @param {string} uuid Document UUID
     * @param {Object} [options={}] Resolution options
     * @returns {Document|null}
     */
    override fromUuidSync(uuid: string, options: any = {}): any {
        return (foundry.utils as any).fromUuidSync(uuid, options);
    }

    /**
     * Safely resolve a document from UUID asynchronously using standard V13+ foundry.utils.fromUuid.
     * @param {string} uuid Document UUID
     * @param {Object} [options={}] Resolution options
     * @returns {Promise<Document|null>}
     */
    override async fromUuid(uuid: string, options: any = {}): Promise<any> {
        return (foundry.utils as any).fromUuid(uuid, options);
    }

    /**
     * Retrieve all combatants associated with a token in combat using native V13+ Combat#getCombatantsByToken.
     * @param {Combat} combat Target combat encounter
     * @param {Token} token Target Token placeable
     * @returns {Combatant[]}
     */
    override getCombatantsByToken(combat: any, token: any): any[] {
        if (!combat || !token) return [];
        return combat.getCombatantsByToken(token);
    }

    /**
     * Preload Handlebars templates in Foundry V13+ using namespaced foundry.applications.handlebars.loadTemplates.
     * @override
     * @param {string[]} paths Array of template paths
     * @returns {Promise<Function[]>}
     */
    override async loadTemplates(paths: string[]): Promise<any> {
        return (foundry as any).applications?.handlebars?.loadTemplates(paths);
    }

    /**
     * Determine whether an update operation represents a teleportation in Foundry V13+.
     * Evaluates standard V13+ operation.movement properties without accessing deprecated DatabaseUpdateOperation#teleport.
     * @override
     * @param {Object} [options={}] Operation options or DatabaseUpdateOperation
     * @returns {boolean}
     */
    override isTeleport(options: any = {}): boolean {
        if (options.movement === false) return true;
        return Boolean(options.movement?.teleport);
    }
}
