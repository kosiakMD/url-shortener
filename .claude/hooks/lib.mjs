// lib.mjs — спільний мінімум хуків. Не плутати зі scripts/lib.mjs: та бібліотека живе
// у світі воріт (Verdict, killListeners), ця — у світі хуків (stdin-JSON, deny/allow).
//
// Правила, спільні для всіх хуків цієї теки:
//   - нуль npm-залежностей: хук, який вимагає node_modules, мовчки зникає в чистому клоні;
//   - fail-open на власних багах: зламаний запобіжник не має паралізувати роботу;
//   - stdin споживається завжди, інакше зависання/EPIPE;
//   - блокування = exit 2 + причина в stderr; мовчазний дозвіл = exit 0.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Корінь репо — від файла хука (.claude/hooks/ → ../..), НЕ від `$CLAUDE_PROJECT_DIR`
 * у рядку команди: ту змінну розкриває шел, і на Windows шлях перетворюється на кашу.
 */
export function hookRoot(importMetaUrl) {
  return resolve(dirname(fileURLToPath(importMetaUrl)), '..', '..');
}

/**
 * Claude Code шле хукові JSON у stdin. Повертає розпарсений об'єкт або `null` —
 * і тоді хук мусить fail-open: вхід, якого ми не зрозуміли, не привід блокувати роботу.
 */
export async function readStdinJson() {
  const chunks = [];
  await new Promise((done) => {
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/** Блокування: причину бачить агент і мусить зрозуміти, ЩО робити замість цього. */
export function deny(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

/** Мовчазний дозвіл. */
export function allow() {
  process.exit(0);
}

/** Запускає команду і повертає { ok, out, status }. Ніколи не кидає. */
export function run(cmd, args, options = {}) {
  const spawnOptions = { encoding: 'utf8', ...options };
  let result = spawnSync(cmd, args, spawnOptions);

  // npm-встановлені CLI на Windows — `.cmd`-шими: без shell не стартують.
  if (
    process.platform === 'win32' &&
    options.shell === undefined &&
    result.status === null &&
    ['ENOENT', 'EINVAL'].includes(result.error?.code)
  ) {
    result = spawnSync(cmd, args, { ...spawnOptions, shell: true });
  }

  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}`, status: result.status };
}

/** Поточна гілка репо. */
export function branch(root) {
  return run('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
}

/**
 * Статуси задач трекера фічі: [{ id, status }]. Той самий формат рядка, що читає
 * loop-memory.mjs: `| T1 | … | todo |`. Немає файла чи рядків — порожній масив.
 */
export function trackerTasks(root, slug) {
  const path = join(root, 'docs', 'features', slug, 'tasks', 'tracker.md');
  if (!existsSync(path)) return [];
  return [
    ...readFileSync(path, 'utf8').matchAll(/^\|\s*(T\d+)\s*\|.*\|\s*(todo|in_progress|blocked|review|done)\s*\|/gm),
  ].map(([, id, status]) => ({ id, status }));
}

/**
 * Луп-режим: ралф виставляє `RALPH_FEATURE=<slug>` підпроцесові агента. Інтерактивна
 * сесія людини цієї змінної не має — і хуки до неї значно поблажливіші.
 */
export function loopSlug() {
  return process.env.RALPH_FEATURE || null;
}

/**
 * Груба нарізка шел-команди на прості команди: по `&&`, `||`, `;`, `|`.
 * Це свідомо НЕ повний парсер шелу. Хибний пропуск прийнятний (промпт лишається
 * другим шаром захисту), хибне блокування — ні.
 */
export function splitCommands(commandLine) {
  return commandLine
    .split(/&&|\|\||;|\|/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Токени простої команди; лапки знімаються грубо, вміст лишається одним токеном. */
export function tokens(simpleCommand) {
  const found = simpleCommand.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
  return found.map((t) => t.replace(/^['"]|['"]$/g, ''));
}

/**
 * Підкоманда git з урахуванням глобальних опцій: `git -C path -c a=b push` → `push`.
 * Повертає null, якщо це не git або підкоманду не видно.
 */
export function gitSubcommand(toks) {
  if (toks[0] !== 'git') return null;
  for (let i = 1; i < toks.length; i += 1) {
    const t = toks[i];
    if (t === '-C' || t === '-c') {
      i += 1; // значення опції
    } else if (!t.startsWith('-')) {
      return t;
    }
  }
  return null;
}

/** Мікро-тест-харнес для --self-test: таблиця кейсів → failures. */
export function selfTest(name, cases) {
  const failures = [];
  for (const { desc, actual, expected } of cases) {
    if (actual !== expected) failures.push(`${desc}: очікував ${JSON.stringify(expected)}, отримав ${JSON.stringify(actual)}`);
  }
  for (const f of failures) console.error(`  ✗ [${name}] ${f}`);
  if (failures.length === 0) console.log(`  ✓ ${name}: ${cases.length} кейсів`);
  return failures.length;
}

/** Головний файл процесу — це я? (Щоб import у self-test-ранері не запускав main.) */
export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
}
