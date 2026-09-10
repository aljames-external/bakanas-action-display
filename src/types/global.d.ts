export {};

declare global {
  interface SettingConfig {
    "bakana-action-display.categorizationConfig": import('../categorization/categorization-manager.js').CategorizationConfig | Record<string, unknown>;
    "bakana-action-display.midiQolFilterAutomationOnly": boolean;
    "bakana-action-display.dnd5eAutoBanConditions": import('../ui/dnd5e-autoban-config-app.js').Dnd5eAutoBanConfig | Record<string, unknown>;
    "bakana-action-display.enableCenterOnToken": boolean;
    "bakana-action-display.enableItemSummaryButton": boolean;
    "bakana-action-display.enableToggleHotkey": boolean;
    "bakana-action-display.enableCombatButtons": boolean;
    "bakana-action-display.enableCombatAutoTrackButton": boolean;
    "bakana-action-display.autoTrackCombat": boolean;
    "bakana-action-display.autoToggleCombat": boolean;
    "bakana-action-display.autoCenterOnToken": boolean;
    "bakana-action-display.enableEconomyIndicators": boolean;
    "bakana-action-display.economyColors": Record<string, { enabled?: boolean; color?: string; [key: string]: unknown }>;
    "bakana-action-display.hudOpacity": number;
    "bakana-action-display.hudScale": number;
    "bakana-action-display.fontSize": number;
    "bakana-action-display.persistTabState": boolean;
    "bakana-action-display.toggleTabSelection": boolean;
    "bakana-action-display.hudAnchorSide": string;
    "bakana-action-display.hudGridOffset": number;
    "bakana-action-display.hudGridOffsetHorizontal": number;
    "bakana-action-display.showTooltips": boolean;
    "bakana-action-display.logVerbosity": string;
    "bakana-action-display.showDepleted": boolean;
    "bakana-action-display.showItemSummaries": boolean;
    "bakana-action-display.isAttached": boolean;
    "bakana-action-display.persistHUD": boolean;
    "bakana-action-display.hudDetachedPosition": { top?: number; left?: number; [key: string]: unknown } | null;
    "bakana-action-display.hudTabStates": Record<string, import('../ui/action-display-app.js').ActiveTabState>;
  }

  interface ModuleConfig {
    "bakana-action-display": {
      path?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  interface FlagConfig {
    [key: string]: any;
  }

  interface CONFIG {
    DND5E?: import('./systems.js').Dnd5eConfig;
    PF1?: Record<string, unknown>;
    PF2E?: Record<string, unknown>;
    Item?: {
      typeLabels?: Record<string, string>;
      [key: string]: unknown;
    };
  }

  namespace foundry.helpers.interaction {
    interface TooltipManager {
      active?: boolean;
      locked?: boolean;
      lockTooltip?: () => void;
    }
  }

  namespace foundry.helpers.interaction.KeyboardManager {
    interface ModifierKeys {
      Alt: boolean;
      Control: boolean;
      Shift: boolean;
    }
  }

  var Sequencer: unknown;
  var Sequence: unknown;
  var Tagger: unknown;
  var socketlib: unknown;
  var dnd5e: {
    documents?: {
      Trait?: {
        keyLabel?: (key: string, options?: { trait?: string }) => string | null | undefined;
      };
    };
    [key: string]: unknown;
  };
  var KeyboardManager: unknown;

  namespace Hooks {
    interface HookConfig {
      'closeTokenHUD': (tokenHUD: TokenHUD | null | undefined, html: unknown) => void;
    }
  }

  interface FromUuidOptions {
    relative?: foundry.abstract.Document.Any;
    strict?: boolean;
    invalid?: boolean;
    [key: string]: unknown;
  }

  type Dnd5eSkill = import('./systems.js').Dnd5eSkill;
  type Dnd5eTool = import('./systems.js').Dnd5eTool;
  type Dnd5eAbility = import('./systems.js').Dnd5eAbility;
  type Dnd5eActivity = import('./systems.js').Dnd5eActivity;
  type Dnd5eTraitData = import('./systems.js').Dnd5eTraitData;
  type Dnd5eSensesData = import('./systems.js').Dnd5eSensesData;
  type Actor5e = import('./systems.js').Actor5e;
  type Item5e = import('./systems.js').Item5e;
  type Pf1Skill = import('./systems.js').Pf1Skill;
  type Pf1TraitData = import('./systems.js').Pf1TraitData;
  type ActorPF = import('./systems.js').ActorPF;
  type ItemPF = import('./systems.js').ItemPF;
  type Pf2eStatistic = import('./systems.js').Pf2eStatistic;
  type ActorPF2e = import('./systems.js').ActorPF2e;
  type ItemPF2e = import('./systems.js').ItemPF2e;

  type Action = import('../ui/action.js').Action;
  type TabRef = import('../ui/tab-ref.js').TabRef;
  type HUDTab = import('../ui/hud-tab.js').HUDTab;
  type HUDTabOptions = import('../ui/hud-tab.js').HUDTabOptions;
  type HUDTabColumn = import('../ui/hud-tab-column.js').HUDTabColumn;
  type ActionDisplayApp = import('../ui/action-display-app.js').ActionDisplayApp;
  type BaseFoundryAdapter = import('../adapters/foundry/base-foundry-adapter.js').BaseFoundryAdapter;
  type BaseSystemAdapter = import('../adapters/system/base-system-adapter.js').BaseSystemAdapter;
  type Dnd5eSystemAdapter = import('../adapters/system/dnd5e-system-adapter.js').Dnd5eSystemAdapter;
  type Pf1SystemAdapter = import('../adapters/system/pf1-system-adapter.js').Pf1SystemAdapter;
  type Pf2eSystemAdapter = import('../adapters/system/pf2e-system-adapter.js').Pf2eSystemAdapter;
  type ItemSummary = import('../adapters/system/base-system-adapter.js').ItemSummary;
  type ItemSummaryProperty = import('../adapters/system/base-system-adapter.js').ItemSummaryProperty;
  type ItemSummaryPropertyItem = import('../adapters/system/base-system-adapter.js').ItemSummaryPropertyItem;
  type ItemSummaryPropertyRow = import('../adapters/system/base-system-adapter.js').ItemSummaryPropertyRow;
  type AutoBanEffectReason = import('../adapters/system/base-system-adapter.js').AutoBanEffectReason;
  type TabSideFilterContext = import('../adapters/system/filter/base-system-tab-filter-manager.js').TabSideFilterContext;
  type FilterContext = import('../adapters/system/filter/base-system-tab-filter-manager.js').FilterContext;
}

declare module 'fvtt-types/configuration' {
  interface AssumeHookRan {
    ready: true;
  }

  interface ModuleConfig {
    "bakana-action-display": {
      path?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  interface SettingConfig {
    "bakana-action-display.categorizationConfig": import('../categorization/categorization-manager.js').CategorizationConfig | Record<string, unknown>;
    "bakana-action-display.midiQolFilterAutomationOnly": boolean;
    "bakana-action-display.dnd5eAutoBanConditions": import('../ui/dnd5e-autoban-config-app.js').Dnd5eAutoBanConfig | Record<string, unknown>;
    "bakana-action-display.enableCenterOnToken": boolean;
    "bakana-action-display.enableItemSummaryButton": boolean;
    "bakana-action-display.enableToggleHotkey": boolean;
    "bakana-action-display.enableCombatButtons": boolean;
    "bakana-action-display.enableCombatAutoTrackButton": boolean;
    "bakana-action-display.autoTrackCombat": boolean;
    "bakana-action-display.autoToggleCombat": boolean;
    "bakana-action-display.autoCenterOnToken": boolean;
    "bakana-action-display.enableEconomyIndicators": boolean;
    "bakana-action-display.economyColors": Record<string, { enabled?: boolean; color?: string; [key: string]: unknown }>;
    "bakana-action-display.hudOpacity": number;
    "bakana-action-display.hudScale": number;
    "bakana-action-display.fontSize": number;
    "bakana-action-display.persistTabState": boolean;
    "bakana-action-display.toggleTabSelection": boolean;
    "bakana-action-display.hudAnchorSide": string;
    "bakana-action-display.hudGridOffset": number;
    "bakana-action-display.hudGridOffsetHorizontal": number;
    "bakana-action-display.showTooltips": boolean;
    "bakana-action-display.logVerbosity": string;
    "bakana-action-display.showDepleted": boolean;
    "bakana-action-display.showItemSummaries": boolean;
    "bakana-action-display.isAttached": boolean;
    "bakana-action-display.persistHUD": boolean;
    "bakana-action-display.hudDetachedPosition": { top?: number; left?: number; [key: string]: unknown } | null;
    "bakana-action-display.hudTabStates": Record<string, import('../ui/action-display-app.js').ActiveTabState>;
  }

  namespace Hooks {
    interface HookConfig {
      'closeTokenHUD': (tokenHUD: TokenHUD | null | undefined, html: unknown) => void;
    }
  }
}
