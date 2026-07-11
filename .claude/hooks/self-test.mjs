// self-test.mjs — жене --self-test усіх хуків. Ворота `npm run hooks:test`.
//
// Кожен хук тестується як окремий процес — так, як його запускає Claude Code. Тести
// детерміновані: без моделі, без мережі, без stdin. Зникне хук із цього списку — ворота
// почервоніють (той самий принцип, що у verify: відсутня перевірка — це провал, не пропуск).

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { run } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// Явний список, не readdir: хук, доданий у теку, але забутий тут І в settings.json,
// однаково мертвий — а readdir приховав би різницю між «тестується» і «випадково лежить».
const HOOKS = ['guard-bash.mjs', 'guard-files.mjs', 'post-edit.mjs', 'stop-journal.mjs'];

let failed = 0;
console.log('\nhooks:test — self-тести хуків, 0 токенів');

for (const hook of HOOKS) {
  const path = join(HERE, hook);
  if (!existsSync(path)) {
    console.error(`  ✗ ${hook}: файла немає — хук зник, а settings.json досі на нього вказує`);
    failed += 1;
    continue;
  }
  const res = run('node', [path, '--self-test']);
  process.stdout.write(res.out);
  if (!res.ok) failed += 1;
}

console.log('');
if (failed > 0) {
  console.error(`hooks:test FAIL — ${failed} з ${HOOKS.length} хуків червоні.`);
  process.exit(1);
}
console.log(`hooks:test OK — ${HOOKS.length} хуків.`);
process.exit(0);
