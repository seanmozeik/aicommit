import gradient from 'gradient-string';

import { gradientColors } from './theme';

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

  process.stdout.write(`\n${bannerGradient(indentedBanner)}\n\n`);
};
