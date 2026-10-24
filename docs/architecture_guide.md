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

### 2. System Adapter Layer (`BaseSystemAdapter`, `FantasySystemAdapter`, & System Managers)
*   **Role**: Handles system-specific rules, resource calculations, UI context formatting, tab filtering, and right-click context menu options.
*   **Responsibilities**:
    *   **`BaseSystemAdapter`**: The core, genre-agnostic base class. It composes three specialized manager instances:
        *   **`BaseSystemContextMenuManager`** (`src/adapters/system/context-menu/`): Manages action card context menu items and tab right-click shortcuts.
        *   **`BaseSystemContextModifier`** (`src/adapters/system/context-modifier/`): Manages UI context modifications, tab label/icon localization, and sort orders.
        *   **`BaseSystemTabFilterManager`** (`src/adapters/system/filter/`): Evaluates set-algebraic tab filter trees (`union`, `intersection`, `difference`) and checks resource depletion.
    *   **`FantasySystemAdapter`**: An intermediate class extending the base adapter. It houses shared defaults for fantasy RPG systems, such as default icon mappings for weapons, spells, feats, and consumables, as well as the numerical spell-level sorting algorithm.
    *   **Concrete Adapters** (e.g., `Dnd5eSystemAdapter`, `Pf1SystemAdapter`, `Pf2eSystemAdapter`): Inherit from `FantasySystemAdapter` and instantiate system-specific managers (`Dnd5eSystemContextMenuManager`, `Dnd5eSystemContextModifier`, `Dnd5eSystemTabFilterManager`) to implement system rules without cluttering the adapter.
        ```text
        src/adapters/system/
        ├── base-system-adapter.js
        ├── dnd5e/
        │   ├── base-dnd5e-system-adapter.js
        │   ├── dnd5e-v4-adapter.js
        │   ├── dnd5e-v5-adapter.js
        │   ├── dnd5e-v6-adapter.js
        │   └── index.js
        ├── pf1-system-adapter.js
        ├── pf2e-system-adapter.js
        ├── context-menu/
        │   ├── base-system-context-menu-manager.js
        │   └── dnd5e-system-context-menu-manager.js
        ├── context-modifier/
        │   ├── base-system-context-modifier.js
        │   └── dnd5e-system-context-modifier.js
        ├── filter/
        │   ├── base-system-tab-filter-manager.js
        │   └── dnd5e-system-tab-filter-manager.js
        └── genre/
            └── fantasy-system-adapter.js
        ```
    *   Maps system-native entities into the generic HUD model (`item` = Item Card, `activities` = Sub-options/Activities):
        *   **D&D 5e**: `item` ──► `Item5e`, `activities` ──► `Activity5e` instances.
        *   **Pathfinder 2e**: `item` ──► `ItemPF2e` / `Strike`, `activities` ──► Strike options / weapon modes.
        *   **Pathfinder 1e**: `item` ──► `ItemPF1`, `activities` ──► Linked attack items / multi-action formulas.
    *   Filters out depleted actions if the "Filter Depleted Actions" setting is enabled, using system-specific rules.

### 3. Module Adapter Layer (`BaseModuleAdapter`)
*   **Role**: Handles third-party module integrations (like `midi-qol`) without cluttering the core or system layers.
*   **Responsibilities**:
    *   Inspects active module flags on actions and modifies them (e.g., filtering out Midi-QOL "automation-only" activities from the player-facing HUD).

### 4. UI Layer (`ActionDisplayApp`, `HUDTabColumn`, `HUDTab`, `TabRef`, & `ContextMenuManager`)
*   **Role**: The rendering engine and state management system, built on Foundry VTT's modern `ApplicationV2` (`HandlebarsApplication`) framework.
*   **Responsibilities**:
    *   **`ActionDisplayApp`**: Listens to Foundry hooks (like token selection) to position and render the HUD. Manages positioning modes (`attached` dynamic token tracking and `detached` floating screen position), tab state persistence across close/open and actor switches (`_saveTabState`), scroll position preservation (`scrollable` selector), and context rendering.
    *   **`ContextMenuManager`** (`src/ui/app/context-menu-manager.js`): Manages UI right-click context menu creation for action cards, combining core actions (`Hide Action`, `Unhide Action`) with system-provided items.
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
        +BaseSystemContextMenuManager contextMenuManager
        +BaseSystemContextModifier contextModifier
        +BaseSystemTabFilterManager filterManager
        +shouldExtractItem(item, actor)
        +modifyActions(actions, actor)
        +modifyContext(context, app)
    }

    class BaseSystemContextMenuManager {
        +getContextMenuItems(app)
        +onTabRightClick(app, el, event)
    }

    class BaseSystemContextModifier {
        +modifyContext(context, app)
        +getItemTypeLabel(parentId)
        +getItemTypeIcon(parentId)
    }

    class BaseSystemTabFilterManager {
        +matchesEconomyTabs(action, filterContext)
        +filterSubactions(subactions, filterContext)
        +isResourceDepleted(action)
    }

    class FantasySystemAdapter {
        +getItemTypeIcon(parentId)
        +getItemSubTabSortOrder(parentId, subId)
    }

    class Dnd5eSystemAdapter {
        +shouldExtractItem(item, actor)
        +modifyActions(actions, actor)
        +modifyContext(context)
        +filterSubactions(subactions, filterContext)
        +getContextMenuItems(app)
        +onTabRightClick(app, el, event)
        +getItemTypeLabel(parentId)
        +getItemSubTabLabel(parentId, subId)
        +getActionSubTabLabel(subId)
        -#resolveRootSpellDocument(sub, parentItem)
        -#containerHasAlias(container, aliases)
        -#subRequiresComponent(sub, component)
        -#calculateUses(item, actor)
        -#hasLimitedUses(item, actor)
        -#calculateActivityUses(activity, item, actor)
        -#calculateSpellSlots(item, actor)
        -#getSpellSlotUses(item, actor)
        -#calculateWeaponAmmunition(item, actor)
        -#hasAvailableUpcastSlots(actor, level)
    }

    class Pf2eSystemAdapter {
        +shouldExtractItem(item, actor)
        +modifyActions(actions, actor)
        +getItemTypeLabel(parentId)
        +getItemSubTabLabel(parentId, subId)
        +getActionTypeLabel(parentId)
        +getActionSubTabLabel(subId)
        -#getAmmoInfo(item)
        -#getActionType(item)
        -#getSpellcastingEntries(actor)
        -#getActorStrikes(actor)
        -#getUses(item)
        -#getSpellUses(entry, spell)
        -#getStrikeAmmoUses(strike, ammoQuantities)
    }

    class Pf1SystemAdapter {
        +shouldExtractItem(item, actor)
        +modifyActions(actions, actor)
        +modifyContext(context)
        -#parseActivationType(actType)
        -#getWeaponLinkChildren(weapon)
        -#getSpellbook(actor, spellbookId)
        -#getItemActions(item)
        -#getBuffActiveState(item)
        -#calculateUses(item, actor)
        -#calculateSpellUses(spellbook, spell)
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
        +boolean isAttached
        +TabSideState leftTabs
        +TabSideState rightTabs
        +render(force, options)
        #_prepareContext(options)
        #_onRender(context, options)
        +setPosition(position)
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

## 2.2 Action, TabRef, & Button State Data Flow

The following diagram illustrates how raw item data is tagged with `TabRef` references, how `HUDTabColumn` maintains button/tab active states, and how `ActionDisplayApp` flattens these into a customized display graph consumed during filtering and rendering:

```mermaid
flowchart TB
    subgraph ADAPTER ["1. Dnd5eSystemAdapter / BaseSystemAdapter (Extraction & Tagging)"]
        A["Actor Items & Activities"] --> B["Dnd5eSystemAdapter / PF1 / PF2e"]
        B --> C["Tag Action with itemTypes & TabRef nodes"]
        C --> D["Action Instance<br/>itemTypes: ['spell']<br/>tabs: [TabRef('economy/action'), TabRef('components/vocal')]"]
    end

    subgraph COLUMN ["2. HUDTabColumn (Button State Management)"]
        E["Left Column State (HUDTabColumn)<br/>activeParents: Set{'spell'}<br/>activeSubTypes: Set{'level_1'}"]
        F["Right Column State (HUDTabColumn)<br/>activeParents: Set{'economy'}<br/>activeSubTypes: Set{'action'}"]
    end

    subgraph APP ["3. ActionDisplayApp & HUDTab (Display Graph Construction)"]
        D --> G["Flatten unique TabRef.root & itemTypes across all Actor Actions"]
        E --> H["Inject active / focused / excluded state into Left HUDTab Tree"]
        F --> I["Inject active / focused / excluded state into Right HUDTab Tree"]
        G --> H
        G --> I
        H --> J["Left Tab Bar Display Graph (HUDTab Nodes)"]
        I --> K["Right Tab Bar Display Graph (HUDTab Nodes)"]
    end

    subgraph FILTER ["4. BaseSystemTabFilterManager (Action Filtering & Consumption)"]
        D --> L["matchesEconomyTabs(action, filterContext)"]
        E --> L
        F --> L
        L -- "Set-Algebraic Evaluation (union / intersection / difference)" --> M{"Matches Active Button States?"}
        M -- Yes --> N["Rendered Action Card in HUD"]
        M -- No --> O["Filtered Out"]
    end
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

---

## 4. TabRef Architecture & Set-Algebraic Filter Tree Evaluation

`TabRef` (`src/ui/tab-ref.js`) is the structured data bridge between game-system items (like Foundry `Item5e` documents or `Activity5e` objects) and the HUD's UI filtering engine.

### Data Flow Graph & Set Combinators

The HUD evaluates active filters using a generalized **Set-Algebraic Filter Tree** (Boolean Expression Tree). Each parent tab declares its set combinator operator (`union`, `intersection`, `difference`):

*   **`union` (`OR`)**: Default for standard category tabs (Action Economy, Weapons, Spells). An action matches if it belongs to *at least one* active sub-tab.
*   **`difference` (`AND NOT`)**: Used for exclusion/modifier tabs (Spell Components). An action matches if it does *not* possess any active banned sub-tabs.
*   **`intersection` (`AND`)**: Used for strict multi-requirement tabs. An action matches only if it satisfies *all* active sub-tabs.

```mermaid
flowchart TD
    subgraph Foundry ["1. Foundry VTT Domain Model"]
        FoundryItem["Item5e / ItemPF2e / ItemPF1\n(e.g., Spell: Detect Magic)"]
        FoundryActivity["Activity5e\n(activation: 'action', components: ['vocal', 'somatic'])"]
        FoundryItem -->|contains| FoundryActivity
    end

    subgraph SystemAdapter ["2. System Adapter Processing (Dnd5eSystemAdapter)"]
        TabRefGen["TabRef.from('economy', 'action', 'union')\nTabRef.from('components', 'vocal', 'difference')\nTabRef.from('components', 'somatic', 'difference')"]
        FoundryActivity -->|transforms via modifyActions| TabRefGen
    end

    subgraph InternalModel ["3. Internal HUD Action Model (Action.tabs)"]
        TabRefNode1["TabRef Node 1 (Economy)\n• label: 'action', root: 'economy'\n• combinator: 'union'"]
        TabRefNode2["TabRef Node 2 (Vocal)\n• label: 'vocal', root: 'components'\n• combinator: 'difference'"]
        TabRefNode3["TabRef Node 3 (Somatic)\n• label: 'somatic', root: 'components'\n• combinator: 'difference'"]
        
        TabRefGen -->|TabRef.from| ActionObj["Action Instance\n(id, name, uses, subactions)\ntabs: [TabRef Node 1, TabRef Node 2, TabRef Node 3]"]
        TabRefNode1 --> ActionObj
        TabRefNode2 --> ActionObj
        TabRefNode3 --> ActionObj
    end

    subgraph FilteringEngine ["4. Filtering Engine (BaseSystemAdapter.matchesEconomyTabs)"]
        DiffCheck["1. Evaluate DIFFERENCE Groups (AND NOT)\n• Banning 'material' -> PASS\n• Banning 'vocal' -> FAIL"]
        UnionCheck["2. Evaluate UNION Groups (OR)\n• Active: 'action' -> PASS"]
        ActionObj --> DiffCheck
        DiffCheck -->|Passes| UnionCheck
    end

    subgraph HUDRender ["5. HUD UI Output (ActionDisplayApp & HUDTab)"]
        RightColumn["Right Column (Action Economy)\n• Economy -> Action (UNION)"]
        ExclusionColumn["Exclusion Tabs (Spell Components)\n• Components -> Vocal, Somatic (DIFFERENCE)"]
        ActionCard["Rendered HUD Action Card\n'Detect Magic'"]
        
        UnionCheck -->|Matches| RightColumn
        UnionCheck -->|Passes| ExclusionColumn
        RightColumn --> ActionCard
        ExclusionColumn --> ActionCard
    end
```

### Key Responsibilities of `TabRef`

1. **Pre-computed Hierarchies ($O(1)$ Performance)**:
   - When instantiated, `TabRef` computes its `.root` (e.g. `'economy'`) and `.path` string (e.g. `'economy/action'`).
   - UI filtering loops query `tab.root` and `tab.path` directly, eliminating runtime string splitting and regex matching during render passes.

2. **System Adapter Set Authority (`getTabCombinator`)**:
   - Parent tab groups defined on the active system adapter (`adapter.getTabCombinator(parentId)`) dictate set-algebraic rules (`union`, `intersection`, `difference`) for all sub-tabs under that parent group.

3. **Multi-Category Mapping**:
   - A single `Action` can belong to multiple tab paths simultaneously by storing an array of `TabRef` nodes (e.g., Action Economy tab + Spell Component exclusion tabs).

4. **Guaranteed Flat `TabRef[]` Arrays (`Action.tabs`)**:
   - All system adapters and core extractors construct `tabs` directly as a flat `TabRef[]` array using `TabRef.from(rootLabel, subLabel)`.

5. **Factory Instantiation (`TabRef.from`)**:
   - System adapters use `TabRef.from(rootLabel, subLabel)` to instantiate parent/child tab nodes without writing verbose constructor boilerplate:
     ```javascript
     const tabRef = TabRef.from('components', 'vocal');
     // Instantiates TabRef(label: 'vocal', parent: TabRef(label: 'components'))
     ```

---

## 6. Testing & Development

The repository includes a zero-dependency native Node.js unit test suite (`node --test`) covering adapter initialization, filtering rules, and item transformation pipelines.

### Running Tests Locally
Ensure you have Node.js 18+ installed and run:
```bash
npm test
```

### Test Suite Architecture
- **Global Foundry VTT Mocks (`tests/setup.js`)**: Shims global Foundry objects (`game`, `foundry`, `Item`, `Actor`, `fromUuidSync`) so system adapters can execute offline without requiring a live Foundry server or browser environment.
- **System Adapter Coverage (`tests/**`)**: Comprehensive unit tests covering `BaseSystemAdapter`, `Dnd5eSystemAdapter`, `Pf1SystemAdapter`, and `Pf2eSystemAdapter`.

