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
    DND5E?: any;
    PF1?: any;
    PF2E?: any;
  }

  var Sequencer: any;
  var Sequence: any;
  var Tagger: any;
  var socketlib: any;
  var dnd5e: any;

  namespace Hooks {
    interface HookConfig {
      'closeTokenHUD': (tokenHUD: any, html: any) => void;
      [key: string]: (...args: any[]) => any;
    }
  }
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
