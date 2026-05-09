/* Catppuccin Frappé theme using Bun's built-in color functions */

const ESC = '\u001B';
const RESET = `${ESC}[0m`;
const BOLD_ON = `${ESC}[1m`;

// Catppuccin Frappé palette
const frappe = {
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
  yellow: '#e5c890',
} as const;

const fg = (cssColor: string, text: string): string => {
  const open = Bun.color(cssColor, 'ansi') ?? '';
  if (open === '') {
    return text;
  }
  return `${open}${text}${RESET}`;
};

const _boldFg = (cssColor: string, text: string): string => {
  const rgb = Bun.color(cssColor, '[rgb]');
  if (!rgb) {
    return `${BOLD_ON}${text}${RESET}`;
  }
  const [r, g, b] = rgb;
  return `${ESC}[1;38;2;${r};${g};${b}m${text}${RESET}`;
};

// Theme colors as functions
export const theme = {
  accent: (s: string): string => fg(frappe.flamingo, s),
  added: (s: string): string => fg(frappe.green, s),
  body: (s: string): string => fg(frappe.subtext1, s),
  dim: (s: string): string => fg(frappe.surface2, s),
  error: (s: string): string => fg(frappe.red, s),
  heading: (s: string): string => fg(frappe.text, s),
  info: (s: string): string => fg(frappe.blue, s),
  modified: (s: string): string => fg(frappe.yellow, s),
  muted: (s: string): string => fg(frappe.overlay1, s),
  primary: (s: string): string => fg(frappe.mauve, s),
  removed: (s: string): string => fg(frappe.red, s),
  secondary: (s: string): string => fg(frappe.pink, s),
  subtle: (s: string): string => fg(frappe.subtext0, s),
  success: (s: string): string => fg(frappe.green, s),
  warning: (s: string): string => fg(frappe.yellow, s),
} as const;

export const frappeColors = {
  base: (s: string): string => fg(frappe.base, s),
  blue: (s: string): string => fg(frappe.blue, s),
  crust: (s: string): string => fg(frappe.crust, s),
  flamingo: (s: string): string => fg(frappe.flamingo, s),
  green: (s: string): string => fg(frappe.green, s),
  lavender: (s: string): string => fg(frappe.lavender, s),
  mantle: (s: string): string => fg(frappe.mantle, s),
  maroon: (s: string): string => fg(frappe.maroon, s),
  mauve: (s: string): string => fg(frappe.mauve, s),
  overlay0: (s: string): string => fg(frappe.overlay0, s),
  overlay1: (s: string): string => fg(frappe.overlay1, s),
  overlay2: (s: string): string => fg(frappe.overlay2, s),
  peach: (s: string): string => fg(frappe.peach, s),
  pink: (s: string): string => fg(frappe.pink, s),
  red: (s: string): string => fg(frappe.red, s),
  rosewater: (s: string): string => fg(frappe.rosewater, s),
  sapphire: (s: string): string => fg(frappe.sapphire, s),
  sky: (s: string): string => fg(frappe.sky, s),
  subtext0: (s: string): string => fg(frappe.subtext0, s),
  subtext1: (s: string): string => fg(frappe.subtext1, s),
  surface0: (s: string): string => fg(frappe.surface0, s),
  surface1: (s: string): string => fg(frappe.surface1, s),
  surface2: (s: string): string => fg(frappe.surface2, s),
  teal: (s: string): string => fg(frappe.teal, s),
  text: (s: string): string => fg(frappe.text, s),
  yellow: (s: string): string => fg(frappe.yellow, s),
} as const;

// Gradient colors for banner (hex values for gradient-string)
export const gradientColors = {
  banner: [frappe.mauve, frappe.pink, frappe.flamingo],
  error: [frappe.red, frappe.maroon],
  success: [frappe.green, frappe.teal],
} as const;

// Box border color (hex for boxen)
export const boxColors = {
  default: frappe.surface2,
  error: frappe.red,
  info: frappe.blue,
  primary: frappe.mauve,
  success: frappe.green,
} as const;
