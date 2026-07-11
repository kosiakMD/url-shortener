// post-edit.mjs — швидкий фідбек одразу після правки (подія PostToolUse, matcher Edit|Write).
//
// Дотепер помилку в щойно зміненому файлі агент бачив аж на гейті — через N кроків,
// коли контекст правки вже втрачено. Цей хук повертає її НЕГАЙНО, точково по одному файлу:
//
//   *.md                      → scripts/check-links.mjs --file <шлях> (wikilinks, биті посилання)
//   src|tests|scripts|hooks/*.js|.mjs → eslint по цьому файлу
//
// Хук НЕ ганяє тести — це робота гейту (`test:fast` жене ранер після ходу, людина — verify).
// Червона перевірка = exit 2: PostToolUse не скасовує вже зроблену правку, але stderr
// повертається агентові, і він виправляє, поки файл ще в контексті.
//
// Перевірити руками:
//   printf '{"tool_input":{"file_path":"README.md"}}' | node .claude/hooks/post-edit.mjs
//   node .claude/hooks/post-edit.mjs --self-test

import { relative, resolve, isAbsolute, join, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { readStdinJson, deny, allow, hookRoot, run, selfTest, isMain } from './lib.mjs';

const TIMEOUT_MS = 5000;

/** Яку перевірку заслуговує цей шлях? Чиста функція — її ганяє self-test. */
export function checkKind(relPath) {
  const path = relPath.split(sep).join('/');
  if (path.endsWith('.md')) return 'links';
  const isCode = /\.(js|mjs)$/.test(path)
    && /^(src|tests|scripts|\.claude\/hooks)\//.test(path)
    && !path.startsWith('src/public/'); // frontend лінтиться повним `npm run lint`, не хуком
  return isCode ? 'lint' : null;
}

function runSelfTest() {
  const failures = selfTest('post-edit', [
    { desc: 'md → links', actual: checkKind('docs/roadmap.md'), expected: 'links' },
    { desc: 'src js → lint', actual: checkKind('src/app.js'), expected: 'lint' },
    { desc: 'tests js → lint', actual: checkKind('tests/unit/shorten.test.js'), expected: 'lint' },
    { desc: 'хук → lint', actual: checkKind('.claude/hooks/lib.mjs'), expected: 'lint' },
    { desc: 'frontend — не хуком', actual: checkKind('src/public/app.js'), expected: null },
    { desc: 'json — нічого', actual: checkKind('package.json'), expected: null },
    { desc: 'корінь js — нічого', actual: checkKind('eslint.config.js'), expected: null },
  ]);
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  if (process.argv.includes('--self-test')) runSelfTest();

  const input = await readStdinJson();
  const filePath = input?.tool_input?.file_path;
  if (typeof filePath !== 'string') allow();

  try {
    const root = hookRoot(import.meta.url);
    const abs = isAbsolute(filePath) ? filePath : resolve(root, filePath);
    const rel = relative(root, abs);
    if (rel.startsWith('..') || !existsSync(abs)) allow();

    const kind = checkKind(rel);
    if (!kind) allow();

    if (kind === 'links') {
      const res = run('node', [join(root, 'scripts', 'check-links.mjs'), '--file', abs], {
        cwd: root, timeout: TIMEOUT_MS,
      });
      if (!res.ok && res.status !== null) {
        deny(`Посилання в щойно зміненому ${rel} биті — виправ зараз, поки файл у контексті:\n${res.out.trim()}`);
      }
    }

    if (kind === 'lint') {
      // Локальний біндер, не npx: npx без кешу ходить у мережу, а хук мусить бути миттєвим.
      const eslint = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'eslint.cmd' : 'eslint');
      if (!existsSync(eslint)) allow(); // чистий клон без node_modules — не паралізуємо
      const res = run(eslint, ['--no-warn-ignored', abs], { cwd: root, timeout: TIMEOUT_MS });
      if (!res.ok && res.status !== null) {
        deny(`ESLint у щойно зміненому ${rel} — виправ зараз:\n${res.out.trim()}`);
      }
    }
    // res.status === null означає тайм-аут або збій запуску — fail-open за інваріантом.
  } catch (err) {
    process.stderr.write(`post-edit: власна помилка, пропускаю (${err?.message})\n`);
  }
  allow();
}

if (isMain(import.meta.url)) await main();
