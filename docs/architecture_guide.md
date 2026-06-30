# Architecture & Lifecycle Guide

This document explains the architecture of **Bakana's Action Display** and provides a visual guide to how the different class layers integrate, culminating in the rendering of the Token HUD.

---

## 1. Architectural Layers

The module is built using a clean **pipes-and-filters / adapter** architecture, divided into four distinct layers:

```
┌────────────────────────────────────────────────────────┐
│                        UI Layer                        │
│                (ActionDisplayApp)                      │
└──────────────────────────┬─────────────────────────────┘
                           │ queries actions & layout
                           ▼
┌────────────────────────────────────────────────────────┐
│                    Coordinator Layer                   │
│                    (ActionDisplay)                     │
└──────────────────────────┬─────────────────────────────┘
                           │ runs pipeline
                           ▼
┌────────────────────────────────────────────────────────┐
│                  System Adapter Layer                  │
│  (BaseSystemAdapter ◄─ FantasySystemAdapter ◄─ Dnd5e) │
└──────────────────────────┬─────────────────────────────┘
                           │ modifies & categorizes
                           ▼
┌────────────────────────────────────────────────────────┐
│                  Module Adapter Layer                  │
│      (BaseModuleAdapter ◄─── MidiQolModuleAdapter)     │
└───────────────────────────┬────────────────────────────┘
                            │ filters & augments
                            ▼
                    [ Final HUD Render ]
```

### 1. Core / Coordinator (`ActionDisplay`)
*   **Role**: The central pipeline controller (a singleton instance exported from `src/action-display.js`).
*   **Responsibilities**:
    *   Detects the active game system and registers the appropriate system and module adapters.
    *   Performs the **Core Extraction**: iterates over all items on an actor and extracts a basic, system-agnostic list of actions (name, image, item ID, and roll functions).
    *   Runs the pipeline: `Core Extraction ──► System Adapter ──► Module Adapters ──► Core Post-Processing (User-Hidden Filters)`.

### 2. System Adapter Layer (`BaseSystemAdapter` & `FantasySystemAdapter`)
*   **Role**: Handles system-specific rules, resource calculations, and terminology.
*   **Responsibilities**:
    *   **`BaseSystemAdapter`**: The core, genre-agnostic base class. It defines the interface for all adapters and provides fallback localizations for generic HUD tabs (like "All Items", "Other").
    *   **`FantasySystemAdapter`**: An intermediate class extending the base adapter. It houses shared defaults for fantasy RPG systems, such as default icon mappings for weapons, spells, feats, and consumables, as well as the numerical spell-level sorting algorithm.
    *   **Concrete Adapters** (e.g., `Dnd5eSystemAdapter`, `Pf1SystemAdapter`, `Pf2eSystemAdapter`): Inherit from `FantasySystemAdapter` to leverage shared fantasy defaults, while implementing system-specific resource calculations (like spell slots, activities, or ammunition) and custom tab mappings.
    *   Populates a generic **`subActions`** array on actions that have multiple options, converting them into a system-agnostic format.
    *   Filters out depleted actions if the "Filter Depleted Actions" setting is enabled, using system-specific rules.

### 3. Module Adapter Layer (`BaseModuleAdapter`)
*   **Role**: Handles third-party module integrations (like `midi-qol`) without cluttering the core or system layers.
*   **Responsibilities**:
    *   Inspects active module flags on actions and modifies them (e.g., filtering out Midi-QOL "automation-only" sub-actions from the player-facing HUD).

### 4. UI Layer (`ActionDisplayApp`)
*   **Role**: The rendering engine, built on Foundry VTT's modern `ApplicationV2` (`HandlebarsApplication`) framework.
*   **Responsibilities**:
    *   Listens to Foundry hooks (like token selection) to position and render the HUD.
    *   Coordinates attachment/detachment states and tracks position coordinates.
    *   In `_prepareContext()`, it requests the processed actions from the Coordinator, queries the active system adapter for the tab layouts, filters the actions to match the active tabs, and renders the Handlebars template (`templates/action-display.html`).
    *   In `_onRollAction()`, it checks if an action has multiple `subActions` and dynamically renders a left-click dropdown menu if needed, remaining completely system-agnostic.

---

## 2. Class Relationships

The following diagram shows how the classes are structured and how they reference one another:

```mermaid
classDiagram
    class ActionDisplay {
        +Map systemAdapters
        +Map moduleAdapters
        +BaseSystemAdapter activeSystemAdapter
        +init()
        +registerSystemAdapter(adapter)
        +registerModuleAdapter(adapter)
        +getActions(actor)
        -_extractBaseActions(actor)
    }

    class BaseSystemAdapter {
        +string systemId
        +isCompatible()
        +modifyActions(actions, actor)
        +getItemTypeLabel(parentId)
        +getItemTypeIcon(parentId)
        +getSpellLevelLabel(level)
        +getActionTypeLabel(parentId)
        +getActionTypeIcon(parentId)
        +getActionSubTabLabel(subId)
    }

    class FantasySystemAdapter {
        +getItemTypeIcon(parentId)
        +modifyContext(context)
    }

    class Dnd5eSystemAdapter {
        +modifyActions(actions, actor)
        +getItemTypeLabel(parentId)
        +getSpellLevelLabel(level)
        +getActionSubTabLabel(subId)
        -_calculateUses(item, actor)
        -_hasLimitedUses(item, actor)
        -_calculateActivityUses(activity, item, actor)
        -_calculateSpellSlots(item, actor)
        -_calculateWeaponAmmunition(item, actor)
        -_hasAvailableUpcastSlots(actor, level)
    }

    class Pf2eSystemAdapter {
        +modifyActions(actions, actor)
    }

    class Pf1SystemAdapter {
        +modifyActions(actions, actor)
        +getItemTypeIcon(parentId)
        -_calculateUses(item, actor)
    }

    class BaseModuleAdapter {
        +string moduleId
        +isActive()
        +modifyActions(actions, actor)
    }

    class MidiQolModuleAdapter {
        +modifyActions(actions, actor)
    }

    class ActionDisplayApp {
        +Actor actor
        +string positionMode
        +boolean isAttached
        +render(force, options)
        #_prepareContext(options)
        #_onRender(context, options)
        +setPosition(positionMode, options)
        -_onRollAction(event)
        -_onPointerDownCapture(event)
        -_onContextMenuCapture(event)
        -_clearMenuState()
        -_createContextMenu()
        -_toggleActionHidden(actionId, shouldHide)
    }

    ActionDisplayApp --> ActionDisplay : queries actions
    ActionDisplayApp --> BaseSystemAdapter : queries tab labels/icons
    ActionDisplay *-- BaseSystemAdapter : owns
    ActionDisplay *-- BaseModuleAdapter : owns
    BaseSystemAdapter <|-- FantasySystemAdapter : extends
    FantasySystemAdapter <|-- Dnd5eSystemAdapter : extends
    FantasySystemAdapter <|-- Pf2eSystemAdapter : extends
    FantasySystemAdapter <|-- Pf1SystemAdapter : extends
    BaseModuleAdapter <|-- MidiQolModuleAdapter : extends
```

---

## 3. The HUD Render Pipeline

This sequence diagram traces the exact lifecycle of how the HUD is created and rendered when a user selects a token in Foundry VTT:

```mermaid
sequenceDiagram
    autonumber
    actor User as Player / GM
    participant Hook as Foundry VTT Hook
    participant UI as ActionDisplayApp (UI)
    participant Core as ActionDisplay (Coordinator)
    participant Sys as Dnd5eSystemAdapter (System)
    participant Mod as MidiQolModuleAdapter (Module)

    User->>Hook: Selects Token (or right-clicks)
    Hook->>UI: Trigger Hook (controlToken / renderTokenHUD)
    Note over UI: UI detects active token & actor
    UI->>UI: render(force: true)
    
    Note over UI: UI starts preparing data
    UI->>UI: _prepareContext()
    
    %% Core Pipeline Start
    UI->>Core: getActions(actor)
    Note over Core: 1. Core Extraction
    Core->>Core: _extractBaseActions(actor)
    Note over Core: Creates system-agnostic baseActions[]
    
    Note over Core: 2. System Adapter Layer
    Core->>Sys: modifyActions(baseActions, actor)
    Note over Sys: Calculates uses/spell slots<br/>Categorizes items into tabs<br/>Filters out non-combat & depleted items (if enabled)
    Sys-->>Core: returns systemActions[]
    
    Note over Core: 3. Module Adapter Layer
    Core->>Mod: modifyActions(systemActions, actor)
    Note over Mod: Filters out Midi-QOL<br/>"automation-only" sub-actions
    Mod-->>Core: returns moduleActions[]
    
    Note over Core: 4. Core Post-Processing
    Note over Core: Applies user-hidden flags ([hidden] tab)
    Core-->>UI: returns finalActions[]
    %% Core Pipeline End

    Note over UI: UI builds Left & Right Tab structures
    UI->>Sys: getItemTypeLabel(parentId) / getItemTypeIcon(parentId)
    Sys-->>UI: returns localized labels & CSS icons
    UI->>Sys: getActionTypeLabel(parentId) / getActionSubTabLabel(subId)
    Sys-->>UI: returns localized labels & CSS icons
    
    Note over UI: UI filters finalActions[] down to<br/>currently selected Left & Right tabs
    
    UI->>UI: Renders HTML (templates/action-display.html)
    UI->>User: Displays HUD on screen!
```
