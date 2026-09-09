import { deepFreeze } from '../lib/utils.js';

/**
 * Color preset palettes for Action Economy indicators, including colorblind accessibility modes.
 */
export const ECONOMY_COLOR_PRESETS = deepFreeze({
    default: {
        id: 'default',
        label: 'BAD.economyColors.presets.default',
        colors: {
            action: '#3b82f6',
            bonus: '#14b8a6',
            reaction: '#ef4444',
            legendary: '#18181b',
            lair: '#eab308',
            special: '#a855f7',
            mythic: '#ec4899',
            crew: '#6366f1',
            free: '#22c55e',
            standard: '#3b82f6',
            move: '#06b6d4',
            swift: '#14b8a6',
            immediate: '#f97316',
            full: '#8b5cf6',
            other: '#64748b'
        }
    },
    protanopia: {
        id: 'protanopia',
        label: 'BAD.economyColors.presets.protanopia',
        colors: {
            action: '#0072b2',
            bonus: '#56b4e9',
            reaction: '#d55e00',
            legendary: '#222222',
            lair: '#f0e442',
            special: '#cc79a7',
            mythic: '#e69f00',
            crew: '#004d80',
            free: '#56b4e9',
            standard: '#0072b2',
            move: '#56b4e9',
            swift: '#009e73',
            immediate: '#d55e00',
            full: '#cc79a7',
            other: '#7f7f7f'
        }
    },
    tritanopia: {
        id: 'tritanopia',
        label: 'BAD.economyColors.presets.tritanopia',
        colors: {
            action: '#e63946',
            bonus: '#1d3557',
            reaction: '#457b9d',
            legendary: '#111111',
            lair: '#a8dadc',
            special: '#6a0572',
            mythic: '#ff758f',
            crew: '#0b2545',
            free: '#1d3557',
            standard: '#e63946',
            move: '#457b9d',
            swift: '#1d3557',
            immediate: '#ff758f',
            full: '#6a0572',
            other: '#8d99ae'
        }
    },
    highContrast: {
        id: 'highContrast',
        label: 'BAD.economyColors.presets.highContrast',
        colors: {
            action: '#2563eb',
            bonus: '#059669',
            reaction: '#dc2626',
            legendary: '#000000',
            lair: '#ca8a04',
            special: '#7c3aed',
            mythic: '#c026d3',
            crew: '#4338ca',
            free: '#16a34a',
            standard: '#2563eb',
            move: '#0891b2',
            swift: '#059669',
            immediate: '#ea580c',
            full: '#7c3aed',
            other: '#4b5563'
        }
    },
    pastel: {
        id: 'pastel',
        label: 'BAD.economyColors.presets.pastel',
        colors: {
            action: '#60a5fa',
            bonus: '#34d399',
            reaction: '#f87171',
            legendary: '#334155',
            lair: '#facc15',
            special: '#c084fc',
            mythic: '#f472b6',
            crew: '#818cf8',
            free: '#4ade80',
            standard: '#60a5fa',
            move: '#38bdf8',
            swift: '#34d399',
            immediate: '#fb923c',
            full: '#c084fc',
            other: '#94a3b8'
        }
    }
});
