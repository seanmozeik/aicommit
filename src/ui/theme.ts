import pc from 'picocolors';

// Catppuccin Frappe palette
// https://github.com/catppuccin/catppuccin
const palette = {
  base: '#303446',
  blue: '#8caaee',
  crust: '#232634',
  flamingo: '#eebebe',
  green: '#a6d189',
  lavender: '#babbf1',
  mantle: '#292c3c',
  maroon: '#ea999c',
  mauve: '#ca9ee6',
  overlay0: '#737994',
  overlay1: '#838ba7',
  overlay2: '#949cbb',
  peach: '#ef9f76',
  pink: '#f4b8e4',
  red: '#e78284',
  rosewater: '#f2d5cf',
  sapphire: '#85c1dc',
  sky: '#99d1db',
  subtext0: '#a5adce',
  subtext1: '#b5bfe2',
  surface0: '#414559',
  surface1: '#51576d',
  surface2: '#626880',
  teal: '#81c8be',
  text: '#c6d0f5',
  yellow: '#e5c890'
} as const;

// ANSI 256-color approximations for Catppuccin Frappe
// These are the closest matches in the 256-color palette
const ansi = {
  base: 236,
  blue: 111,
  crust: 234,
  flamingo: 217,
  green: 150,
  lavender: 147,
  mantle: 235,
  maroon: 217,
  mauve: 183,
  overlay0: 60,
  overlay1: 103,
  overlay2: 103,
  peach: 216,
  pink: 218,
  red: 210,
  rosewater: 224,
  sapphire: 110,
  sky: 117,
  subtext0: 146,
  subtext1: 146,
  surface0: 59,
  surface1: 59,
  surface2: 60,
  teal: 116,
  text: 189,
  yellow: 223
} as const;

// Color functions using ANSI 256 colors
function ansiColor(code: number): (text: string) => string {
  return (text: string) => `\x1b[38;5;${code}m${text}\x1b[0m`;
}

function ansiBg(code: number): (text: string) => string {
  return (text: string) => `\x1b[48;5;${code}m${text}\x1b[0m`;
}

// Theme colors as functions
export const frappe = {
  // Base colors
  base: ansiColor(ansi.base),

  // Background variants
  bg: {
    base: ansiBg(ansi.base),
    surface0: ansiBg(ansi.surface0),
    surface1: ansiBg(ansi.surface1)
  },
  blue: ansiColor(ansi.blue),
  crust: ansiColor(ansi.crust),
  flamingo: ansiColor(ansi.flamingo),
  green: ansiColor(ansi.green),
  lavender: ansiColor(ansi.lavender),
  mantle: ansiColor(ansi.mantle),
  maroon: ansiColor(ansi.maroon),
  mauve: ansiColor(ansi.mauve),
  overlay0: ansiColor(ansi.overlay0),
  overlay1: ansiColor(ansi.overlay1),

  // Overlay colors
  overlay2: ansiColor(ansi.overlay2),
  peach: ansiColor(ansi.peach),
  pink: ansiColor(ansi.pink),
  red: ansiColor(ansi.red),
  // Primary accent colors
  rosewater: ansiColor(ansi.rosewater),
  sapphire: ansiColor(ansi.sapphire),
  sky: ansiColor(ansi.sky),
  subtext0: ansiColor(ansi.subtext0),
  subtext1: ansiColor(ansi.subtext1),
  surface0: ansiColor(ansi.surface0),
  surface1: ansiColor(ansi.surface1),

  // Surface colors
  surface2: ansiColor(ansi.surface2),
  teal: ansiColor(ansi.teal),

  // Text colors
  text: ansiColor(ansi.text),
  yellow: ansiColor(ansi.yellow)
} as const;

// Semantic aliases for common use cases
export const theme = {
  accent: frappe.flamingo,

  // Diff colors
  added: frappe.green,
  body: frappe.subtext1,
  dim: frappe.surface2,
  error: frappe.red,

  // Text
  heading: frappe.text,
  info: frappe.blue,
  modified: frappe.yellow,
  muted: frappe.overlay1,

  // UI elements
  primary: frappe.mauve,
  removed: frappe.red,
  secondary: frappe.pink,
  subtle: frappe.subtext0,
  // Status colors
  success: frappe.green,
  warning: frappe.yellow
} as const;

// Gradient colors for banner (hex values for gradient-string)
export const gradientColors = {
  banner: [palette.mauve, palette.pink, palette.flamingo],
  error: [palette.red, palette.maroon],
  success: [palette.green, palette.teal]
} as const;

// Box border color (hex for boxen)
export const boxColors = {
  default: palette.surface2,
  error: palette.red,
  info: palette.blue,
  primary: palette.mauve,
  success: palette.green
} as const;

// Re-export picocolors for basic formatting
export { pc };
