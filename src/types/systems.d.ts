/// <reference types="fvtt-types" />

/**
 * System-specific Document & Data Interface Contracts
 * Models runtime extensions for D&D 5e (Actor5e, Item5e), Pathfinder 1e (ActorPF, ItemPF),
 * and Pathfinder 2e (ActorPF2e, ItemPF2e).
 */

/* -------------------------------------------- */
/*  D&D 5e (dnd5e)                             */
/* -------------------------------------------- */

export interface Dnd5eSkill {
    ability?: string;
    label?: string;
    value?: number;
    mod?: number;
    total?: number;
    prof?: { hasProficiency?: boolean; [key: string]: unknown };
    [key: string]: unknown;
}

export interface Dnd5eTool {
    ability?: string;
    label?: string;
    value?: number;
    mod?: number;
    total?: number;
    img?: string;
    icon?: string;
    prof?: { hasProficiency?: boolean; [key: string]: unknown };
    [key: string]: unknown;
}

export interface Dnd5eActivity {
    id?: string;
    name?: string;
    type?: string;
    img?: string;
    item?: Item5e;
    parent?: Item5e;
    spell?: Item5e | string | { uuid?: string; [key: string]: unknown } | null;
    use?(usage?: unknown, dialog?: unknown): Promise<unknown>;
    [key: string]: unknown;
}

export interface Dnd5eTraitData {
    value?: Set<string> | string[];
    bypasses?: Set<string> | string[];
    custom?: string;
    [key: string]: unknown;
}

export interface Dnd5eSensesData {
    darkvision?: number | string | null;
    blindsight?: number | string | null;
    tremorsense?: number | string | null;
    truesight?: number | string | null;
    special?: string;
    units?: string;
    [key: string]: unknown;
}

export interface Dnd5eAbility {
    value?: number;
    mod?: number;
    save?: number | { value?: number; total?: number; proficient?: boolean };
    proficient?: boolean;
    checkProf?: { hasProficiency?: boolean };
    check?: { proficient?: boolean };
    saveProf?: { hasProficiency?: boolean };
    [key: string]: unknown;
}

export interface Actor5e extends Omit<Actor, "system"> {
    system: {
        abilities?: Record<string, Dnd5eAbility>;
        skills?: Record<string, Dnd5eSkill>;
        tools?: Record<string, Dnd5eTool>;
        details?: {
            type?: string | { value?: string };
            level?: number;
            cr?: number;
            biography?: { value?: string; public?: string; [key: string]: unknown };
            [key: string]: unknown;
        };
        attributes?: {
            hp?: { value?: number; max?: number; temp?: number };
            movement?: { walk?: number; fly?: number; swim?: number; burrow?: number; climb?: number };
            ac?: { value?: number };
            senses?: Dnd5eSensesData;
            inspiration?: boolean;
            [key: string]: unknown;
        };
        traits?: {
            size?: string;
            dr?: Dnd5eTraitData;
            di?: Dnd5eTraitData;
            ci?: Dnd5eTraitData;
            dv?: Dnd5eTraitData;
            languages?: Dnd5eTraitData & { ranges?: Record<string, unknown> };
            communication?: unknown;
            [key: string]: unknown;
        };
        spells?: Record<string, { value?: number; max?: number; [key: string]: unknown }>;
        favorites?: Array<{ id?: string; type?: string; sort?: number; [key: string]: unknown }>;
        addFavorite?(data: { id: string; type: string }): Promise<unknown>;
        removeFavorite?(id: string): Promise<unknown>;
    };
    rollSavingThrow?(options: { ability: string; event?: unknown }): Promise<unknown>;
    rollAbilitySave?(options: { ability: string; event?: unknown }): Promise<unknown>;
    rollAbilityTest?(options: { ability: string; event?: unknown }): Promise<unknown>;
    rollAbilityCheck?(options: { ability: string; event?: unknown }): Promise<unknown>;
    rollSkill?(options: { skill: string; event?: unknown }): Promise<unknown>;
    rollToolCheck?(options: { tool: string; event?: unknown }): Promise<unknown>;
    rollTool?(options: { tool: string; event?: unknown }): Promise<unknown>;
}

export interface Item5e extends Omit<Item, "system" | "type"> {
    type: string;
    system: {
        activities?: {
            get?(id: string): Dnd5eActivity | undefined;
            values?(): IterableIterator<Dnd5eActivity>;
            contents?: Dnd5eActivity[];
            [key: string]: unknown;
        } | Record<string, Dnd5eActivity>;
        favorite?: boolean;
        prepared?: number | boolean;
        equipped?: boolean;
        level?: number;
        method?: string;
        quantity?: number;
        properties?: Set<string> | string[];
        components?: Record<string, boolean>;
        type?: { value?: string; [key: string]: unknown };
        ammunition?: { type?: string; [key: string]: unknown };
        activation?: { type?: string; [key: string]: unknown };
        uses?: {
            available?: number | null;
            max?: number | null;
            value?: number | null;
            [key: string]: unknown;
        };
    };
}

/* -------------------------------------------- */
/*  Pathfinder 1e (pf1)                        */
/* -------------------------------------------- */

export interface Pf1Skill {
    ability?: string;
    name?: string;
    subSkills?: Record<string, Pf1Skill>;
    [key: string]: unknown;
}

export interface Pf1TraitData {
    value?: string[] | string;
    values?: string[] | Set<string>;
    custom?: string;
    [key: string]: unknown;
}

export interface ActorPF extends Omit<Actor, "system"> {
    system: {
        skills?: Record<string, Pf1Skill>;
        attributes?: {
            hp?: { value?: number; max?: number };
            speed?: { land?: { total?: number }; [key: string]: unknown };
            ac?: { normal?: { total?: number }; [key: string]: unknown };
            [key: string]: unknown;
        };
        details?: {
            alignment?: string;
            level?: { value?: number } | number;
            [key: string]: unknown;
        };
        traits?: {
            size?: { value?: string; [key: string]: unknown } | string;
            dr?: Pf1TraitData;
            eres?: Pf1TraitData;
            di?: Pf1TraitData;
            ci?: Pf1TraitData;
            dv?: Pf1TraitData;
            languages?: Pf1TraitData;
            senses?: unknown;
            [key: string]: unknown;
        };
    };
    level?: number;
    rollSavingThrow?(save: string, options?: { event?: unknown }): Promise<unknown>;
    rollSave?(save: string, options?: { event?: unknown }): Promise<unknown>;
    rollAbilityTest?(ability: string, options?: { event?: unknown }): Promise<unknown>;
    rollAbilityCheck?(ability: string, options?: { event?: unknown }): Promise<unknown>;
    rollAbility?(ability: string, options?: { event?: unknown }): Promise<unknown>;
    rollSkill?(skill: string, options?: { event?: unknown }): Promise<unknown>;
}

export interface ItemPF extends Omit<Item, "system"> {
    system: {
        equipped?: boolean;
        quantity?: number;
        spellbook?: string;
        level?: number;
        actions?: unknown[];
        active?: boolean;
        weaponSubtype?: string;
        ammo?: {
            type?: string;
            default?: string;
            [key: string]: unknown;
        };
        uses?: {
            max?: number;
            value?: number;
            [key: string]: unknown;
        };
    };
}

/* -------------------------------------------- */
/*  Pathfinder 2e (pf2e)                       */
/* -------------------------------------------- */

export interface Pf2eStatistic {
    roll?(options?: { event?: unknown }): Promise<unknown>;
    slug?: string;
    label?: string;
    name?: string;
    ability?: string;
    value?: number;
    totalModifier?: number;
    [key: string]: unknown;
}

export interface ActorPF2e extends Omit<Actor, "system"> {
    saves?: {
        fortitude?: Pf2eStatistic;
        reflex?: Pf2eStatistic;
        will?: Pf2eStatistic;
        [key: string]: Pf2eStatistic | undefined;
    };
    perception?: Pf2eStatistic;
    skills?: Record<string, Pf2eStatistic> | Map<string, Pf2eStatistic>;
    system: {
        saves?: {
            fortitude?: Pf2eStatistic;
            reflex?: Pf2eStatistic;
            will?: Pf2eStatistic;
            [key: string]: Pf2eStatistic | undefined;
        };
        skills?: Record<string, Pf2eStatistic> | Map<string, Pf2eStatistic>;
        attributes?: {
            hp?: { value?: number; max?: number; temp?: number };
            speed?: { total?: number; value?: number };
            ac?: { value?: number };
            perception?: Pf2eStatistic;
            [key: string]: unknown;
        };
        details?: {
            creatureType?: string;
            level?: { value?: number } | number;
            [key: string]: unknown;
        };
        traits?: {
            value?: string[];
            size?: { value?: string; label?: string; id?: string; [key: string]: unknown } | string;
            senses?: unknown;
            [key: string]: unknown;
        };
    };
    rollSkill?(skill: string | { skill: string; event?: unknown }, options?: { event?: unknown }): Promise<unknown>;
}

export interface ItemPF2e extends Omit<Item, "system"> {
    system: {
        equipped?: {
            carryType?: string;
            handsHeld?: number;
            invested?: boolean;
            [key: string]: unknown;
        };
        traits?: {
            value?: string[];
            [key: string]: unknown;
        };
        category?: {
            value?: string;
            [key: string]: unknown;
        } | string;
        level?: {
            value?: number;
            [key: string]: unknown;
        } | number;
        baseItem?: string;
        quantity?: number;
        actionType?: {
            value?: string;
            [key: string]: unknown;
        };
        uses?: {
            value?: number;
            max?: number;
            [key: string]: unknown;
        };
        frequency?: {
            value?: number;
            max?: number;
            per?: string;
            [key: string]: unknown;
        };
        ammo?: {
            baseType?: string;
            [key: string]: unknown;
        };
    };
    traits?: Set<string>;
    category?: string;
    isPhysical?: boolean;
    isEquipped?: boolean;
}
