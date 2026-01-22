import figlet from 'figlet';
import gradient from 'gradient-string';
// Embed font file for Bun standalone executable
// @ts-expect-error - Bun-specific import attribute
import fontPath from '../../node_modules/figlet/fonts/ANSI Shadow.flf' with { type: 'file' };
import { gradientColors } from './theme.js';

// Create custom gradient using Catppuccin Frappe colors
const bannerGradient = gradient([...gradientColors.banner]);

// Load and register the embedded font
const fontContent = await Bun.file(fontPath).text();
figlet.parseFont('ANSI Shadow', fontContent);

/**
 * Display the ASCII art banner with gradient colors
 */
export function showBanner(): void {
  const banner = figlet.textSync('AIC', {
    font: 'ANSI Shadow',
    horizontalLayout: 'default'
  });

  // Add whitespace above and indent to the right
  const indent = '  ';
  const indentedBanner = banner
    .split('\n')
    .map((line) => indent + line)
    .join('\n');

  console.log(`\n${bannerGradient(indentedBanner)}`);
  console.log(); // Spacing after banner
}
