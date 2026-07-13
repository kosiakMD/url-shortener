// verify.mjs — усі детерміновані ворота репо однією командою. Нуль токенів.
//
//   npm run verify                усі ворота
//   npm run verify -- --skip-e2e  без браузера (так ганяє Windows у CI)
//   npm run verify -- --fail-fast зупинитись на першому червоному
//
// ЧОМУ ЦЕ ОКРЕМА КОМАНДА. Ворота перевіряти доводилось руками, по одній команді за раз.
// Те, що перевіряють руками, перевіряють не щоразу. Тепер це одна команда, і вона друкує
// матрицю: видно не лише «впало», а й ЩО САМЕ не запускалось.
//
// ⚠ ВІДСУТНІ ВОРОТА — ЦЕ ПРОВАЛ, А НЕ ПРОПУСК. Кожен рядок нижче має відповідник у
// package.json. Зникне скрипт — `verify` почервоніє. Інакше репо повідомляло б «усе зелено»
// про перевірку, якої більше не існує, і це найгірший вид зеленого.
//
// Єдиний свідомий пропуск — `--skip-e2e`: він явний, його просить людина.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, run, git, killListeners } from './lib.mjs';

const root = repoRoot(import.meta.url);
const argv = process.argv.slice(2);
const skipE2e = argv.includes('--skip-e2e');
const failFast = argv.includes('--fail-fast');

// ⚠ Читаємо файл, а не `node -p "require(…)"`: під `"type": "module"` це вже не CommonJS,
// а ще один shell-рівень додає кросплатформове екранування без користі.
const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};
const hasScript = (name) => Object.hasOwn(scripts, name);

const rows = [];
let sawFailure = false;

const actionsEscape = (text) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

/** Один рядок матриці. `skip` буває лише на явне прохання людини (`--skip-e2e`). */
function record(name, status, detail = '') {
  rows.push({ name, status, detail });
  const mark = { ok: '✓', fail: '✗', skip: '—' }[status];
  console.log(`  ${mark} ${name.padEnd(22)} ${detail}`);
  if (status === 'fail') sawFailure = true;
  return status;
}

const shouldStop = () => failFast && sawFailure;

/** Ворота = npm-скрипт. Немає скрипта — ворота зникли, і це червоне. */
function npmGate(script, { args = [], label = script } = {}) {
  if (shouldStop()) return record(label, 'skip', 'пропущено після --fail-fast');
  if (!hasScript(script)) return record(label, 'fail', 'немає в package.json — ворота зникли');

  if (script === 'test:e2e') {
    if (skipE2e) return record(label, 'skip', '--skip-e2e');
    // Playwright підіймає власний сервер на :3100 і НІКОЛИ не переймає чужий
    // (`reuseExistingServer: false`). Тож сервер, що витік із упалого прогону, не «відповідав
    // би старим кодом» — він просто не дав би e2e стартувати взагалі. Прибираємо його самі.
    killListeners(3100);
  }

  const { ok, out, status } = run('npm', ['run', '--silent', script, ...(args.length ? ['--', ...args] : [])], {
    cwd: root,
  });
  const gateStatus = record(label, ok ? 'ok' : 'fail', ok ? '' : `exit ${status}`);
  if (!ok) {
    const failureOutput = out.trim() || `exit ${status}`;
    console.error(`\n--- ${label} output ---\n${failureOutput}\n--- end ${label} output ---`);
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.error(`::error::${actionsEscape(`[${label}] ${failureOutput.slice(0, 6000)}`)}`);
    }
  }
  return gateStatus;
}

// ── Прогін ───────────────────────────────────────────────────────────────────────
console.log(`\nverify — детерміновані ворота, 0 токенів`);
console.log(`гілка: ${git(root, 'rev-parse', '--abbrev-ref', 'HEAD')} · ${git(root, 'log', '--oneline', '-1')}\n`);

npmGate('lint');
npmGate('test:fast');
npmGate('test:e2e');
npmGate('tools:check');
npmGate('links:check');
npmGate('eval:self-test');
npmGate('hooks:test');
// Ранер лупа — теж ворота. Сухий прогін не витрачає жодного токена, але доводить, що
// `loop/ralph.mjs` стартує, знаходить свій промпт і знає свої зупинки. Ранер, який ламається
// лише тоді, коли його запускають по-справжньому, — це не ранер, а обіцянка.
//
// ⚠ Без `--feature`: ворота, у які зашито ім'я пакета, почервоніли б того дня, коли той пакет
// заshipиться. Тому ціль тут не резолвиться — репо, де все зроблено, не є зламаним репо.
npmGate('ralph', { args: ['--dry-run'], label: 'ralph --dry-run' });

const ok = rows.filter((r) => r.status === 'ok').length;
const failed = rows.filter((r) => r.status === 'fail');
const skipped = rows.filter((r) => r.status === 'skip').length;

console.log('');
if (failed.length > 0) {
  console.error(`verify FAIL — ${ok} ✓ · ${failed.length} ✗ · ${skipped} —`);
  for (const r of failed) console.error(`  ✗ ${r.name}: ${r.detail}`);
  process.exit(1);
}
console.log(`verify OK — ${ok} ✓${skipped > 0 ? ` · ${skipped} — (пропущено на прохання)` : ''}`);
process.exit(0);
