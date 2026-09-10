export {};

declare global {
  interface SettingConfig {
    "bakana-action-display.categorizationConfig": Record<string, any>;
    "bakana-action-display.midiQolFilterAutomationOnly": boolean;
    "bakana-action-display.dnd5eAutoBanConditions": Record<string, any>;
    "bakana-action-display.enableCenterOnToken": boolean;
    "bakana-action-display.enableItemSummaryButton": boolean;
    "bakana-action-display.enableToggleHotkey": boolean;
    "bakana-action-display.enableCombatButtons": boolean;
    "bakana-action-display.enableCombatAutoTrackButton": boolean;
    "bakana-action-display.autoTrackCombat": boolean;
    "bakana-action-display.autoToggleCombat": boolean;
    "bakana-action-display.autoCenterOnToken": boolean;
    "bakana-action-display.enableEconomyIndicators": boolean;
    "bakana-action-display.economyColors": Record<string, any>;
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
    "bakana-action-display.hudDetachedPosition": Record<string, any> | null;
    "bakana-action-display.hudTabStates": Record<string, any>;
  }

  interface ModuleConfig {
    [key: string]: any;
  }

  interface FlagConfig {
    [key: string]: any;
  }

  interface CONFIG {
    DND5E?: {
      weaponTypes?: Record<string, string>;
      equipmentTypes?: Record<string, string>;
      activityActivationCategories?: Record<string, { label?: string; name?: string } | string>;
      activityActivationTypes?: Record<string, { label?: string; name?: string } | string>;
      [key: string]: any;
    };
    PF1?: any;
    PF2E?: any;
    Item?: {
      typeLabels?: Record<string, string>;
      [key: string]: any;
    };
  }

  namespace foundry.helpers.interaction.KeyboardManager {
    interface ModifierKeys {
      Alt: any;
      Control: any;
      Shift: any;
    }
  }

  var Sequencer: any;
  var Sequence: any;
  var Tagger: any;
  var socketlib: any;
  var dnd5e: any;
  var KeyboardManager: any;

  namespace Hooks {
    interface HookConfig {
      'closeTokenHUD': (tokenHUD: any, html: any) => void;
      [key: string]: (...args: any[]) => any;
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
}

declare module 'fvtt-types/configuration' {
  interface AssumeHookRan {
    ready: true;
  }

  interface SettingConfig {
    "bakana-action-display.categorizationConfig": Record<string, any>;
    "bakana-action-display.midiQolFilterAutomationOnly": boolean;
    "bakana-action-display.dnd5eAutoBanConditions": Record<string, any>;
    "bakana-action-display.enableCenterOnToken": boolean;
    "bakana-action-display.enableItemSummaryButton": boolean;
    "bakana-action-display.enableToggleHotkey": boolean;
    "bakana-action-display.enableCombatButtons": boolean;
    "bakana-action-display.enableCombatAutoTrackButton": boolean;
    "bakana-action-display.autoTrackCombat": boolean;
    "bakana-action-display.autoToggleCombat": boolean;
    "bakana-action-display.autoCenterOnToken": boolean;
    "bakana-action-display.enableEconomyIndicators": boolean;
    "bakana-action-display.economyColors": Record<string, any>;
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
    "bakana-action-display.hudDetachedPosition": Record<string, any> | null;
    "bakana-action-display.hudTabStates": Record<string, any>;
  }

  namespace Hooks {
    interface HookConfig {
      'closeTokenHUD': (tokenHUD: any, html: any) => void;
      [key: string]: (...args: any[]) => any;
    }
  }
}
