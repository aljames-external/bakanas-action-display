# Architecture & Lifecycle Guide

This document explains the architecture of **Bakana's Action Display** and provides a visual guide to how the different class layers integrate, culminating in the rendering of the Token HUD. For a complete function-by-function call tree and detailed API reference, see the **[Function Call Tree & Developer API Reference](function_tree.md)**.

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
    *   Performs the **Core Extraction**: iterates over all items on an actor and extracts a basic, system-agnostic list of actions (name, image, item ID, and roll functions). Before extracting full item data, queries `shouldExtractItem` on the active system adapter to bypass unneeded allocations.
    *   Runs the pipeline: `Core Extraction ──► System Adapter ──► Module Adapters ──► Core Post-Processing (User-Hidden Filters)`.

### 2. System Adapter Layer (`BaseSystemAdapter` & `FantasySystemAdapter`)
*   **Role**: Handles system-specific rules, resource calculations, and terminology.
*   **Responsibilities**:
    *   **`BaseSystemAdapter`**: The core, genre-agnostic base class. It defines the interface for all adapters, provides item filtering hooks (`shouldExtractItem`), and fallback localizations for generic HUD tabs (like "All Items", "Other").
    *   **`FantasySystemAdapter`**: An intermediate class extending the base adapter. It houses shared defaults for fantasy RPG systems, such as default icon mappings for weapons, spells, feats, and consumables, as well as the numerical spell-level sorting algorithm and tab context modification (`modifyContext`).
    *   **Concrete Adapters** (e.g., `Dnd5eSystemAdapter`, `Pf1SystemAdapter`, `Pf2eSystemAdapter`): Inherit from `FantasySystemAdapter` to leverage shared fantasy defaults, while implementing system-specific resource calculations (like spell slots, activities, or ammunition) and custom tab mappings.
    *   Maps system-native entities into the generic HUD model (`item` = Item Card, `activities` = Sub-options/Activities):
        *   **D&D 5e**: `item` ──► `Item5e`, `activities` ──► `Activity5e` instances.
        *   **Pathfinder 2e**: `item` ──► `ItemPF2e` / `Strike`, `activities` ──► Strike options / weapon modes.
        *   **Pathfinder 1e**: `item` ──► `ItemPF1`, `activities` ──► Linked attack items / multi-action formulas.
    *   Filters out depleted actions if the "Filter Depleted Actions" setting is enabled, using system-specific rules.

### 3. Module Adapter Layer (`BaseModuleAdapter`)
*   **Role**: Handles third-party module integrations (like `midi-qol`) without cluttering the core or system layers.
*   **Responsibilities**:
    *   Inspects active module flags on actions and modifies them (e.g., filtering out Midi-QOL "automation-only" activities from the player-facing HUD).

### 4. UI Layer (`ActionDisplayApp`, `HUDTabColumn`, `HUDTab`, & `TabRef`)
*   **Role**: The rendering engine and state management system, built on Foundry VTT's modern `ApplicationV2` (`HandlebarsApplication`) framework.
*   **Responsibilities**:
    *   **`ActionDisplayApp`**: Listens to Foundry hooks (like token selection) to position and render the HUD. Manages attachment/detachment states, scroll position preservation (`scrollable` selector), and context rendering.
    *   **`HUDTabColumn`**: Encapsulates left and right column tab states (active parents, focused parent, active sub-types) and enforces click interaction rules (exclusive left-click parent selection, multi-stage right-click toggles, sub-tab isolation).
    *   **`HUDTab`**: A unified, recursive tab UI model representing top-level parent tabs, sub-tabs, and deeply nested sub-tabs with depth levels (`level` 0, 1, 2+), parent/rootParent pointers, and click event handlers (`onLeftClick`, `onRightClick`).
    *   **`TabRef`**: A structured tab data reference class (`src/ui/tab-ref.js`) attached to item activities (`item.tabs`, `activity.tabs`). Pre-computes `.root` parent IDs and `.path` hierarchy strings (e.g. `'economy/action'`) at construction.
    *   In `_prepareContext()`, it requests the processed actions from the Coordinator, queries the active system adapter for tab layouts, delegates tab context modification, filters actions to match active tabs, and renders `templates/action-display.html`.
    *   In `_onRollAction()`, it checks if an item has multiple `activities` and dynamically renders a left-click dropdown menu if needed.

---

## 2. Class Relationships

The following diagram shows how the classes are structured and how they reference one another:

```mermaid
classDiagram
    class ActionDisplay {
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
        +shouldExtractItem(item, actor)
        +modifyActions(actions, actor)
        +modifyContext(context)
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
        +shouldExtractItem(item, actor)
        +modifyActions(actions, actor)
        +modifyContext(context)
        +getContextMenuItems(app)
        +onTabRightClick(app, el, event)
        +getItemTypeLabel(parentId)
        +getItemSubTabLabel(parentId, subId)
        +getActionSubTabLabel(subId)
        -_calculateUses(item, actor)
        -_hasLimitedUses(item, actor)
        -_calculateActivityUses(activity, item, actor)
        -_calculateSpellSlots(item, actor)
        -_getSpellSlotUses(item, actor)
        -_calculateWeaponAmmunition(item, actor)
        -_hasAvailableUpcastSlots(actor, level)
    }

    class Pf2eSystemAdapter {
        +shouldExtractItem(item, actor)
        +modifyActions(actions, actor)
    }

    class Pf1SystemAdapter {
        +shouldExtractItem(item, actor)
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

    class HUDTab {
        +string id
        +string label
        +string icon
        +number level
        +boolean active
        +boolean expanded
        +boolean activeParent
        +boolean excluded
        +boolean showUnprepared
        +HUDTab parent
        +HUDTab rootParent
        +HUDTab[] subTabs
        +addSubTab(subTabConfig)
        +getOrder()
        +updateOrder(orderArray)
        +getSubTab(subId)
        +onLeftClick(app, tabColumn, groups, event)
        +onRightClick(app, tabColumn, groups, event)
    }

    class HUDTabColumn {
        +string side
        +Set activeParents
        +string focusedParent
        +Set activeSubTypes
        +resetToDefault()
        +selectParent(parentId, groups)
        +toggleParent(parentId, groups)
        +selectSub(parentId, type, groups)
        +toggleSub(parentId, type, groups)
        +prune(groups)
        +serialize()
    }

    class ActionDisplayApp {
        +Actor actor
        +string positionMode
        +boolean isAttached
        +TabSideState leftTabs
        +TabSideState rightTabs
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
    ActionDisplayApp *-- HUDTabColumn : owns (left & right)
    ActionDisplayApp ..> HUDTab : uses
    HUDTabColumn ..> HUDTab : manipulates
    HUDTab *-- HUDTab : parent/subTabs hierarchy
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
    participant State as HUDTabColumn & HUDTab
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
    Core->>Sys: shouldExtractItem(item, actor)
    Sys-->>Core: boolean
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

    Note over UI: UI builds Left & Right HUDTab trees
    UI->>State: Sync active tab states (left & right)
    UI->>Sys: modifyContext(context)
    Note over Sys: Formats spell level subtabs<br/>Applies custom tab ordering
    
    Note over UI: UI filters finalActions[] down to<br/>currently active HUDTabColumn filters
    
    UI->>UI: Renders HTML (templates/action-display.html)
    UI->>User: Displays HUD on screen!
```
