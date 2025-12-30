import { $ } from 'bun';

/**
 * Copy text to clipboard (cross-platform)
 * Returns true if successful, false if no clipboard tool available
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // macOS
  if (process.platform === 'darwin') {
    const proc = Bun.spawn(['pbcopy'], { stdin: 'pipe' });
    proc.stdin.write(text);
    proc.stdin.end();
    await proc.exited;
    return true;
  }

  // Linux: try available clipboard tools in order of preference
  const tools: string[][] = [
    ['xclip', '-selection', 'clipboard'],
    ['xsel', '--clipboard', '--input'],
    ['wl-copy'] // Wayland
  ];

  for (const cmd of tools) {
    try {
      const which = await $`which ${cmd[0]}`.quiet();
      if (which.exitCode === 0) {
        const proc = Bun.spawn(cmd, { stdin: 'pipe' });
        proc.stdin.write(text);
        proc.stdin.end();
        await proc.exited;
        return true;
      }
    } catch {
      // Tool not found, try next
    }
  }

  return false;
}
