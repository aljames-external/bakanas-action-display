---
name: develop-bakanas-action-display
description: Develop, refactor, debug, or extend the Bakana's Action Display (BAD) Foundry VTT module. Use this skill whenever the user mentions modifying the module, adding support for a new game system (like D&D5e or PF2e), adding or modifying module adapters (like Midi-QOL), updating the HUD UI, or refactoring the adapter pipeline. It enforces the core architecture, directory layout, coding conventions, and premium styling standards.
---

# Developing Bakana's Action Display (BAD)

This skill provides the comprehensive guide, rules, and coding standards for developing the **Bakana's Action Display (BAD)** module for Foundry VTT. 

BAD is a premium, highly responsive HUD overlay that allows players and GMs to quickly access and roll their character's usable items, strikes, spells, and actions. It is built using class-based encapsulation, a layered adapter pipeline, and a modern, high-fidelity glassmorphism UI.

---

## 1. Core Architecture: The Layered Pipeline

All item extraction and rendering must follow the **Layered Adapter Pipeline**. This architecture separates core extraction from system-specific rules and third-party module automations.

```
[Core Extraction] -> [System Adapter Layer] -> [Module Adapter Layer] -> [AppV2 UI]
```

### The Pipeline Stages:
1. **Core Extraction (`src/action-display.js`)**:
   * The coordinator extracts *all* items from the actor (`actor.items`) and maps them to a generic, system-agnostic `HudItem` structure:
     ```javascript
     {
         id: item.id,
         name: item.name,
         type: item.type,
         img: item.img,
         tabs: ['all'], // Default tab
         hidden: false,
         uses: { available: null, max: null },
         roll: (event) => { ... }, // Default wraps item.use() or item.roll()
         originalItem: item,
         extra: {}
     }
     ```
2. **System Adapter Layer (`modifyActions(actions, actor)`)**:
   * The active system adapter (if any) intercepts this base list to:
     * Filter out passive, unusable, or unequipped items.
     * Calculate resource uses (slots, charges, quantities, frequencies).
     * Assign actions to specific tabs (e.g. `action.tabs = ['action']` or `['bonus']`).
     * Inject system-specific actions that are *not* standard inventory items (such as **PF2e Strikes** extracted from `actor.system.actions`).
     * Sort the actions.
3. **Module Adapter Layer (`modifyActions(actions, actor)`)**:
   * Active module adapters intercept the system-processed list to:
     * Flag actions with automation badges (e.g., marking Midi-QOL automated items).
     * Hide specific items (`action.hidden = true`).
     * Inject custom macro buttons or additional tabs.
4. **Fallback System**:
   * If **no system adapter is active** for the current game system, the core coordinator automatically maps all extracted items to a default `'all'` tab. The UI will render a single **"All Items"** tab, ensuring the module remains fully functional out-of-the-box in *any* game system.

---

## 2. Directory Layout & Convention-Over-Configuration

Adapters must be organized strictly by convention in their respective subfolders. **Do not use static registries or maps**; the dynamic loader in `src/module.js` derives paths and class names dynamically using the adapter's ID.

### Directory Structure:
```
src/
├── adapters/
│   ├── system/
│   │   ├── base-system-adapter.js
│   │   ├── dnd5e-system-adapter.js
│   │   └── pf2e-system-adapter.js
│   └── module/
│       ├── base-module-adapter.js
│       └── midi-qol-module-adapter.js
├── lib/
│   └── logger.js
├── ui/
│   └── action-display-app.js
├── constants.js
├── module.js
├── settings.js
└── action-display.js
```

### Naming Conventions:
* **System Adapters**:
  * Folder: `src/adapters/system/`
  * File Name: `${systemId}-system-adapter.js` (e.g., `dnd5e-system-adapter.js`)
  * Class Name: `${PascalCase(systemId)}SystemAdapter` (e.g., `Dnd5eSystemAdapter`)
  * Inheritance: Must extend `BaseSystemAdapter` from `./base-system-adapter.js`.
* **Module Adapters**:
  * Folder: `src/adapters/module/`
  * File Name: `${moduleId}-module-adapter.js` (e.g., `midi-qol-module-adapter.js`)
  * Class Name: `${PascalCase(moduleId)}ModuleAdapter` (e.g., `MidiQolModuleAdapter`)
  * Inheritance: Must extend `BaseModuleAdapter` from `./base-module-adapter.js`.

---

## 3. Coding Standards & Best Practices

### A. Always Use ApplicationV2 (AppV2)
The HUD overlay must always be implemented using Foundry VTT's modern `ApplicationV2` framework mixed with `HandlebarsApplicationMixin`.
* **Borderless Window**: Disable the default window frame natively in `DEFAULT_OPTIONS`:
  ```javascript
  static DEFAULT_OPTIONS = {
      window: {
          frame: false // Removes window header, borders, and default background
      }
  };
  ```
* **Declarative Actions API**: Do not write manual jQuery event listeners (`activateListeners`). Instead, use `data-action` attributes in the HTML template and register them in `DEFAULT_OPTIONS.actions`:
  ```javascript
  // In ActionDisplayApp
  static DEFAULT_OPTIONS = {
      actions: {
          changeTab: ActionDisplayApp._onChangeTab,
          rollAction: ActionDisplayApp._onRollAction
      }
  };
  ```
* **Native DOM Manipulation**: `this.element` in AppV2 is a native `HTMLElement`, not a jQuery object. Perform all positioning and styling using native DOM APIs in `_onRender(context, options)`.

### B. Premium Logging
Never use raw `console.log`, `console.warn`, or `console.error` statements. Always import and use the custom logger:
```javascript
import { log } from '../lib/logger.js'; // Adjust path as needed

log.info("Message");
log.warn("Warning");
log.error("Error message", error);
log.debug("Debug details", data);
```
The logger automatically prefixes all console outputs with `BAD | ` (or a styled sky-blue `[BAD Debug]` badge) and respects the user-configured `logVerbosity` setting in the game options.

### C. Localization
Never hardcode user-facing strings. Always use `game.i18n.localize()` with keys prefixed under the Three-Letter Acronym `BAD` (e.g., `BAD.tabs.all`, `BAD.settings.logVerbosity.name`). Keep the translations organized in `lang/en.json`.

---

## 4. UI/UX & Premium Aesthetics

The visual presentation of the HUD must feel premium, modern, and alive. 
* **Glassmorphism**: Use a semi-transparent, blurred background for the main container to let the game canvas peek through:
  ```css
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5);
  ```
* **Micro-Animations**: Add smooth transitions (`transition: all 0.2s ease`) on hovers, active states, and expansions.
* **Token HUD Placement**: The overlay must position itself dynamically above the token (or below if it overflows the top of the screen), centering itself horizontally relative to the token's screen coordinates.
* **Keyboard Modifiers**: Ensure the action click listener passes the raw `event` object to the roll methods, allowing users to hold `Shift`, `Ctrl`, or `Alt` to fast-forward rolls or toggle advantage/disadvantage.
