declare global {
  interface SettingConfig {
    'bakana-action-display.persistHUD': boolean;
    'bakana-action-display.enableCombatAutoTrackButton': boolean;
    'bakana-action-display.autoTrackCombat': boolean;
    'bakana-action-display.autoToggleCombat': boolean;
    'bakana-action-display.enableCenterOnToken': boolean;
    'bakana-action-display.autoCenterOnToken': boolean;
    'bakana-action-display.showTooltips': boolean;
    'bakana-action-display.enableToggleHotkey': boolean;
    [key: `bakana-action-display.${string}`]: any;
  }

  namespace Hooks {
    interface HookConfig {
      'closeTokenHUD': (tokenHUD: any, html: any) => void;
      [key: string]: (...args: any[]) => any;
    }
  }
}

declare module 'fvtt-types/configuration' {
  interface SettingConfig {
    'bakana-action-display.persistHUD': boolean;
    'bakana-action-display.enableCombatAutoTrackButton': boolean;
    'bakana-action-display.autoTrackCombat': boolean;
    'bakana-action-display.autoToggleCombat': boolean;
    'bakana-action-display.enableCenterOnToken': boolean;
    'bakana-action-display.autoCenterOnToken': boolean;
    'bakana-action-display.showTooltips': boolean;
    'bakana-action-display.enableToggleHotkey': boolean;
    [key: `bakana-action-display.${string}`]: any;
  }

  namespace Hooks {
    interface HookConfig {
      'closeTokenHUD': (tokenHUD: any, html: any) => void;
      [key: string]: (...args: any[]) => any;
    }
  }
}
