import gradient from 'gradient-string';
// Embed font file for Bun standalone executable
import { gradientColors } from './theme.js';

// Create custom gradient using Catppuccin Frappe colors
const bannerGradient = gradient([...gradientColors.banner]);

/**
 * Display the ASCII art banner with gradient colors
 */
export async function showBanner(): Promise<void> {
  const banner = `\n   █████╗ ██╗ ██████╗
  ██╔══██╗██║██╔════╝
  ███████║██║██║     
  ██╔══██║██║██║     
  ██║  ██║██║╚██████╗
  ╚═╝  ╚═╝╚═╝ ╚═════╝
                     
  `;

  // Add whitespace above and indent to the right
  const indent = '  ';
  const indentedBanner = banner
    .split('\n')
    .map((line) => indent + line)
    .join('\n');

  console.log(`\n${bannerGradient(indentedBanner)}`);
  console.log(); // Spacing after banner
}
