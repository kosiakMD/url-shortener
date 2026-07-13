// self-test.mjs — runs --self-test for every hook. The `npm run hooks:test` gate.
//
// Each hook is tested as a separate process — the way Claude Code launches it. The tests
// are deterministic: no model, no network, no stdin. If a hook disappears from this list,
// the gate turns red (the same principle as verify: a missing check is a failure, not a skip).

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { run } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// An explicit list, not readdir: a hook dropped into the directory but forgotten here AND
// in settings.json is dead either way — and readdir would hide the difference between
// "tested" and "happens to be lying around".
const HOOKS = ['guard-bash.mjs', 'guard-files.mjs', 'post-edit.mjs', 'stop-journal.mjs'];

let failed = 0;
console.log('\nhooks:test — hook self-tests, 0 tokens');

for (const hook of HOOKS) {
  const path = join(HERE, hook);
  if (!existsSync(path)) {
    console.error(`  ✗ ${hook}: file is missing — the hook is gone while settings.json still points at it`);
    failed += 1;
    continue;
  }
  const res = run('node', [path, '--self-test']);
  process.stdout.write(res.out);
  if (!res.ok) failed += 1;
}

console.log('');
if (failed > 0) {
  console.error(`hooks:test FAIL — ${failed} of ${HOOKS.length} hooks are red.`);
  process.exit(1);
}
console.log(`hooks:test OK — ${HOOKS.length} hooks.`);
process.exit(0);
