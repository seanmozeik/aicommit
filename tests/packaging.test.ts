import * as BunTest from 'bun:test';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import packageJson from '../package.json' with { type: 'json' };
import { parseAicContent } from '../src/aic-script';

const root = fileURLToPath(new URL('..', import.meta.url));
const artifactsDirectory = fileURLToPath(new URL('../artifacts', import.meta.url));
const distDirectory = fileURLToPath(new URL('../dist', import.meta.url));

BunTest.afterAll(async () => {
  await Promise.all([
    rm(artifactsDirectory, { force: true, recursive: true }),
    rm(distDirectory, { force: true, recursive: true }),
  ]);
});

BunTest.describe('release packaging contract', () => {
  BunTest.test('archive entry and Homebrew wrapper use the same executable path', async () => {
    const build = Bun.spawn(['bun', 'scripts/build.ts', '--no-formula'], {
      cwd: root,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const [exitCode, stderr] = await Promise.all([build.exited, new Response(build.stderr).text()]);
    BunTest.expect(exitCode, stderr).toBe(0);

    const archivePath = `artifacts/aic-${packageJson.version}.tar.gz`;
    const listing = Bun.spawnSync(['tar', '-tzf', archivePath], { cwd: root });
    BunTest.expect(listing.exitCode).toBe(0);
    BunTest.expect(new TextDecoder().decode(listing.stdout)).toContain(
      `aic-${packageJson.version}/dist/aic.js`,
    );

    const formula = await Bun.file(new URL('../Formula/aic.rb', import.meta.url)).text();
    BunTest.expect(formula).toContain('#{libexec}/dist/aic.js');
  });

  BunTest.test('release upload targets only the current version archive', async () => {
    const source = await Bun.file(new URL('../.aic', import.meta.url)).text();
    const config = parseAicContent(source);
    const upload = config.publish?.find((command) => command.includes('gh release create'));

    BunTest.expect(upload).toContain(`"artifacts/aic-\${VERSION}.tar.gz"`);
    BunTest.expect(upload).not.toContain('artifacts/*.tar.gz');
  });
});
