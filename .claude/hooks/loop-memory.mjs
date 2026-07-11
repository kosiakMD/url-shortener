// loop-memory.mjs — місток пам'яті між ітераціями лупа (подія SessionStart).
//
// Ральф-цикл сліпий: кожна ітерація — це НОВА сесія з порожнім контекстом. Усе, що хук друкує
// в stdout на SessionStart, Claude Code додає в контекст сесії. Тож наступна ітерація стартує
// не з нуля: вона одразу знає, де стоїть репо і на чому спіткнулась попередня.
//
// Хук виливає ДВА джерела і навмисно НЕ змішує їх:
//
//   1. ФАКТИ — рахує сам, прямо зараз (git, трекер). Записаний факт застаріває вже наступним
//      комітом; обчислений — ніколи. Тому хук нічого не кешує.
//   2. ЖУРНАЛ — самозвіт агента. Тільки модель знає, на чому спіткнулась, і жоден скрипт цього
//      в неї не спитає. Ціна самозвіту — він може брехати. Тому факти лежать поруч: розбіжність
//      «журнал каже зробив T2, трекер каже T2 todo» видно з першого погляду.
//
// Хук нічого не блокує і нічого не оцінює. Немає журналу — мовчить і виходить нулем, тож у
// чистому клоні звичайна інтерактивна сесія його навіть не помітить.
//
// Перевірити руками:
//   printf '{}' | node .claude/hooks/loop-memory.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// ⚠ Не `$CLAUDE_PROJECT_DIR`. Цю змінну в рядку команди хука розкриває ШЕЛ, а не Claude Code,
// і на Windows шлях перетворюється на кашу. Корінь рахуємо від себе: .claude/hooks/ → ../..
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const JOURNAL = join(ROOT, 'loop', 'JOURNAL.md');

// Хвіст, а не весь файл. Журнал росте з кожною ітерацією; контекст рости не мусить.
const TAIL_CHARS = 6000;

// Claude Code шле хукові JSON у stdin. Не спожити його — це зависання або EPIPE.
await new Promise((done) => {
  process.stdin.resume();
  process.stdin.on('data', () => {});
  process.stdin.on('end', done);
  process.stdin.on('error', done);
});

// Бейслайн для Stop-хука (stop-journal.mjs): скільки байтів журналу було НА СТАРТІ ходу.
// Хід, наприкінці якого журнал не виріс, — це хід, про який наступна ітерація не дізнається
// нічого. Пишемо лише в луп-режимі; tmp/ уже в .gitignore. Збій запису не валить хук —
// пам'ять важливіша за запобіжник.
if (process.env.RALPH_FEATURE) {
  try {
    mkdirSync(join(ROOT, 'tmp'), { recursive: true });
    const size = existsSync(JOURNAL) ? statSync(JOURNAL).size : 0;
    writeFileSync(join(ROOT, 'tmp', 'journal-baseline'), String(size));
  } catch {
    // нічого: без бейслайна stop-journal просто мовчатиме (fail-open)
  }
}

if (!existsSync(JOURNAL)) process.exit(0);
const journal = readFileSync(JOURNAL, 'utf8').trim();
if (!journal) process.exit(0);

const git = (...args) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).stdout?.trim() ?? '';

/** Статуси задач цільової фічі. Чия вона — знає ранер, і каже через `RALPH_FEATURE`. */
function trackerLine(slug) {
  const path = join(ROOT, 'docs', 'features', slug, 'tasks', 'tracker.md');
  if (!existsSync(path)) return null;
  const rows = [
    ...readFileSync(path, 'utf8').matchAll(/^\|\s*(T\d+)\s*\|.*\|\s*(todo|in_progress|blocked|review|done)\s*\|/gm),
  ];
  if (rows.length === 0) return null;
  return `трекер ${slug}: ${rows.map(([, id, status]) => `${id} ${status}`).join(' · ')}`;
}

const dirty = git('status', '--porcelain');
const slug = process.env.RALPH_FEATURE;
const tracker = slug ? trackerLine(slug) : null;

// Хвіст ріжемо по межі рядка: блок, обірваний посеред слова, читається як зіпсутий файл.
const tail = journal.length > TAIL_CHARS ? `…\n${journal.slice(-TAIL_CHARS).replace(/^[^\n]*\n/, '')}` : journal;

const out = [
  'Стан, який лишила попередня ітерація лупа. Прочитай його ПЕРШИМ і не переробляй зробленого.',
  '',
  '## Факти (хук щойно виміряв — їм вір)',
  '',
  `гілка \`${git('rev-parse', '--abbrev-ref', 'HEAD')}\` · робоче дерево ${dirty ? 'брудне' : 'чисте'}`,
  ...(tracker ? [tracker] : []),
  '',
  '```',
  git('log', '--oneline', '-3') || '(історії ще немає)',
  '```',
  '',
  '## Журнал попередніх ходів (самозвіт агента — звіряй із фактами вище)',
  '',
  tail,
  '',
].join('\n');

process.stdout.write(out);
process.exit(0);
