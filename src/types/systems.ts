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
    total?: number;
    [key: string]: unknown;
}

export interface Dnd5eTool {
    ability?: string;
    label?: string;
    img?: string;
    icon?: string;
    [key: string]: unknown;
}

export interface Dnd5eActivity {
    id?: string;
    name?: string;
    type?: string;
    img?: string;
    item?: Item5e;
    parent?: Item5e;
    [key: string]: unknown;
}

export interface Actor5e extends Omit<Actor, "system"> {
    system: {
        skills?: Record<string, Dnd5eSkill>;
        tools?: Record<string, Dnd5eTool>;
        details?: {
            type?: string | { value?: string };
            level?: number;
            cr?: number;
            [key: string]: unknown;
        };
        attributes?: {
            hp?: { value?: number; max?: number; temp?: number };
            movement?: { walk?: number; fly?: number; swim?: number; burrow?: number; climb?: number };
            ac?: { value?: number };
            [key: string]: unknown;
        };
        spells?: Record<string, { value?: number; max?: number; [key: string]: unknown }>;
        favorites?: Array<{ id?: string; type?: string; sort?: number; [key: string]: unknown }>;
        addFavorite?(data: { id: string; type: string }): Promise<unknown>;
        removeFavorite?(id: string): Promise<unknown>;
        [key: string]: unknown;
    };
    rollSavingThrow?(options: { ability: string; event?: unknown }): Promise<unknown>;
    rollAbilitySave?(options: { ability: string; event?: unknown }): Promise<unknown>;
    rollAbilityTest?(options: { ability: string; event?: unknown }): Promise<unknown>;
    rollAbilityCheck?(options: { ability: string; event?: unknown }): Promise<unknown>;
    rollSkill?(options: { skill: string; event?: unknown }): Promise<unknown>;
    rollToolCheck?(options: { tool: string; event?: unknown }): Promise<unknown>;
    rollTool?(options: { tool: string; event?: unknown }): Promise<unknown>;
}

export interface Item5e extends Omit<Item, "system"> {
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
        uses?: {
            available?: number | null;
            max?: number | null;
            value?: number | null;
            [key: string]: unknown;
        };
        [key: string]: unknown;
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
            size?: any;
            [key: string]: unknown;
        };
        [key: string]: unknown;
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
        [key: string]: unknown;
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
            [key: string]: unknown;
        };
        [key: string]: unknown;
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
        [key: string]: unknown;
    };
    traits?: Set<string>;
    category?: string;
    isPhysical?: boolean;
    isEquipped?: boolean;
}
