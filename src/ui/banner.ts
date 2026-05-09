/* oxlint-disable no-console */
import gradient from 'gradient-string';

import { gradientColors } from './theme';

// Create custom gradient using Catppuccin Frappe colors
const bannerGradient = gradient([...gradientColors.banner]);

/**
 * Display the ASCII art banner with gradient colors
 */
export const showBanner = (): void => {
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

  // Spacing after banner
  console.log();
};
