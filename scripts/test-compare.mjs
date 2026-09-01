/**
 * Held-out compare table: gzip/br/zstd always; OpenZL when a backend exists.
 */
import { compareHeldOut, formatCompareTable } from './lib/compare-profile.mjs';

const plain = Buffer.from(
  JSON.stringify({
    points: Array.from({ length: 120 }, (_, i) => ({
      t: 1_700_000_000 + i,
      sensor: `s${i % 8}`,
      temp: 20 + (i % 11) * 0.1
    }))
  })
);

const result = await compareHeldOut(plain, { profile: 'timeseries' });
console.log(formatCompareTable(result, { heldOut: 'synthetic-timeseries.json' }));

let failed = 0;
const ok = (name, pass, detail = '') => {
  console.log(pass ? '✓' : '✗', name, pass ? '' : detail);
  if (!pass) failed++;
};

ok('gzip present', result.codecs.gzip?.bytes > 0);
ok('plainBytes matches', result.plainBytes === plain.length);
ok(
  'verdict is known',
  ['enable', 'keep-heroes', 'tie', 'openzl-unavailable'].includes(result.verdict),
  result.verdict
);
ok('reason non-empty', typeof result.reason === 'string' && result.reason.length > 10);
ok('bestHero is a hero or null', result.bestHero == null || ['gzip', 'br', 'zstd'].includes(result.bestHero));

if (result.codecs.openzl?.bytes != null && result.bestHero) {
  if (result.codecs.openzl.bytes < result.codecs[result.bestHero].bytes) {
    ok('enable matches smaller openzl', result.verdict === 'enable');
  } else if (result.codecs.openzl.bytes > result.codecs[result.bestHero].bytes) {
    ok('keep-heroes matches larger openzl', result.verdict === 'keep-heroes');
  }
}

const table = formatCompareTable(result);
ok('table names gzip', table.includes('gzip'));
ok('table names openzl', table.includes('openzl'));

if (failed) {
  console.error(failed, 'failed');
  process.exit(1);
}
console.log('compare helper all passed');
