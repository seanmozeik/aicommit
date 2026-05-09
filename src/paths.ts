import { join } from 'node:path';

import { CONFIG_DIR_NAME } from './constants.js';

export const expandHome = (pathStr: string): string =>
  pathStr === '~' || pathStr.startsWith('~/')
    ? `${process.env['HOME'] ?? ''}${pathStr.slice(1)}`
    : pathStr;

export const configRoot = (): string =>
  process.env['AIC_CONFIG_HOME'] ?? `${process.env['HOME'] ?? '.'}/.config/${CONFIG_DIR_NAME}`;

export const configTomlPath = (): string => join(configRoot(), 'config.toml');
export const configJsonPath = (): string => join(configRoot(), 'config.json');
