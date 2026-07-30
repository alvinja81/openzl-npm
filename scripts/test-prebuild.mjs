/**
 * Phase 4 tests: prebuild targeting and addon verification.
 *
 * These cover the logic that decides *which* prebuild a host should get and
 * whether a downloaded one is usable. Actually producing the per-platform
 * binaries is CI's job (.github/workflows/build-native.yml).
 *
 *   npm run build && node scripts/test-prebuild.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assetTarget, isMuslLinux, prebuildDir, verifyAddon } from './lib/platform-target.mjs';

let failed = 0;
const ok = (name, pass, detail = '') => {
  console.log(pass ? '✓' : '✗', name, pass ? detail : detail || '');
  if (!pass) failed++;
};

console.log('Phase 4 prebuild tests');
console.log(`  host: ${process.platform}-${process.arch} musl=${isMuslLinux()}`);

// Directory name must match what src/core/native.ts looks up.
ok(
  'prebuildDir is <platform>-<arch>',
  prebuildDir() === `${process.platform}-${process.arch}`,
  prebuildDir()
);

// Asset target only differs from the directory on musl.
if (process.platform === 'linux' && isMuslLinux()) {
  ok('musl asset target is suffixed', assetTarget() === `${prebuildDir()}-musl`, assetTarget());
} else {
  ok('non-musl asset target matches dir', assetTarget() === prebuildDir(), assetTarget());
}

ok(
  'isMuslLinux is false off Linux',
  process.platform === 'linux' || isMuslLinux() === false
);

// Release asset name must match what build-native.yml packs:
//   openzl_native-v<version>-<platform>.tar.gz
const pkg = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
const assetName = `openzl_native-v${pkg.version}-${assetTarget()}.tar.gz`;
ok(
  'asset name matches workflow pattern',
  /^openzl_native-v\d+\.\d+\.\d+(-[\w.]+)?-[a-z0-9]+-[a-z0-9]+(-musl)?\.tar\.gz$/.test(assetName),
  assetName
);

const workflow = fs.readFileSync(
  new URL('../.github/workflows/build-native.yml', import.meta.url),
  'utf8'
);
ok(
  'workflow packs the same name shape',
  workflow.includes('openzl_native-v${version}-${platform}.tar.gz')
);
ok(
  'workflow attaches prebuilds even when a platform fails',
  /if:\s*always\(\)\s*&&\s*github\.event_name == 'release'/.test(workflow)
);
ok('workflow builds linux-x64', workflow.includes('platform: linux-x64'));
ok('workflow builds linux-arm64', workflow.includes('platform: linux-arm64'));
ok('workflow bounds job runtime', /timeout-minutes:/.test(workflow));

// The published tarball must not carry machine-specific prebuilds.
ok(
  'package files[] excludes prebuilds',
  !pkg.files.includes('prebuilds'),
  pkg.files.join(',').slice(0, 60) + '…'
);

// verifyAddon must reject junk rather than trusting the file's presence.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openzl-prebuild-'));
try {
  const bogus = path.join(tmp, 'openzl_native.node');
  fs.writeFileSync(bogus, Buffer.from('not a real shared object'));
  const bad = verifyAddon(bogus);
  ok('verifyAddon rejects a corrupt binary', bad.ok === false, bad.reason?.slice(0, 60));

  const missing = verifyAddon(path.join(tmp, 'absent.node'));
  ok('verifyAddon rejects a missing file', missing.ok === false);

  // When this host has a real prebuild, it must pass verification.
  const real = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    'prebuilds',
    prebuildDir(),
    'openzl_native.node'
  );
  if (fs.existsSync(real)) {
    const good = verifyAddon(real);
    ok('verifyAddon accepts this host’s prebuild', good.ok === true, good.reason ?? '');
  } else {
    console.log('⊘ no local prebuild for this host — skip positive verification');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exitCode = 1;
} else {
  console.log('\nprebuild tests all passed');
}
