// stop-journal.mjs — «останній крок ходу — запиши, що сталось» (подія Stop).
//
// loop/PROMPT.md вимагає наприкінці КОЖНОГО ходу дописати loop/JOURNAL.md — це єдиний
// канал пам'яті між ітераціями сліпого лупа. Хід, який мовчки завершився, змушує наступну
// ітерацію повторити ту саму помилку. Дотепер це тримали на слухняності моделі.
//
// Механіка: на SessionStart loop-memory.mjs записує розмір журналу в tmp/journal-baseline.
// Цей хук на Stop порівнює: журнал не виріс → блокує завершення (exit 2) з нагадуванням.
//
// Запобіжник від зациклення — поле `stop_hook_active` від Claude Code: воно true, коли
// агент продовжив роботу саме через блок Stop-хука. Другий раз поспіль не блокуємо:
// агент, якому СПРАВДІ нема чого писати, не має висіти в нескінченному циклі.
//
// Поза луп-режимом (немає RALPH_FEATURE) хук мовчить: людині в інтерактиві журнал не потрібен.
//
// Перевірити руками:
//   printf '{}' | RALPH_FEATURE=x node .claude/hooks/stop-journal.mjs
//   node .claude/hooks/stop-journal.mjs --self-test

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readStdinJson, deny, allow, hookRoot, loopSlug, selfTest, isMain } from './lib.mjs';

/**
 * Вердикт. Чиста функція — її ганяє self-test.
 * @returns {string|null} причина блокування або null
 */
export function decide({ loop, stopHookActive, baseline, currentSize }) {
  if (!loop) return null;
  if (stopHookActive) return null; // уже блокували цей стоп — не зациклюємо
  if (baseline === null) return null; // бейслайна немає (хід поза ралфом?) — fail-open
  if (currentSize > baseline) return null;
  return [
    'Хід не дописав loop/JOURNAL.md — а це єдине, що наступна ітерація від тебе почує',
    '(loop/PROMPT.md §Останній крок ходу). Допиши в кінець файла блок:',
    '### Ітерація <N> — <id задачі> · **Зробив:** … · **Спіткнувся:** … · **Наступному ходу:** …',
    'Пиши і тоді, коли прогресу не було — особливо тоді.',
  ].join('\n');
}

function runSelfTest() {
  const failures = selfTest('stop-journal', [
    { desc: 'поза лупом', actual: decide({ loop: false, stopHookActive: false, baseline: 0, currentSize: 0 }), expected: null },
    { desc: 'журнал не виріс', actual: decide({ loop: true, stopHookActive: false, baseline: 100, currentSize: 100 }) !== null, expected: true },
    { desc: 'журнал зменшився (переписали?)', actual: decide({ loop: true, stopHookActive: false, baseline: 100, currentSize: 40 }) !== null, expected: true },
    { desc: 'журнал виріс', actual: decide({ loop: true, stopHookActive: false, baseline: 100, currentSize: 260 }), expected: null },
    { desc: 'перший запис у порожній', actual: decide({ loop: true, stopHookActive: false, baseline: 0, currentSize: 50 }), expected: null },
    { desc: 'другий блок поспіль — пропустити', actual: decide({ loop: true, stopHookActive: true, baseline: 100, currentSize: 100 }), expected: null },
    { desc: 'без бейслайна — fail-open', actual: decide({ loop: true, stopHookActive: false, baseline: null, currentSize: 100 }), expected: null },
  ]);
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  if (process.argv.includes('--self-test')) runSelfTest();

  const input = await readStdinJson();

  try {
    const root = hookRoot(import.meta.url);
    const baselinePath = join(root, 'tmp', 'journal-baseline');
    const journalPath = join(root, 'loop', 'JOURNAL.md');

    const baselineRaw = existsSync(baselinePath) ? readFileSync(baselinePath, 'utf8').trim() : null;
    const baseline = baselineRaw !== null && /^\d+$/.test(baselineRaw) ? Number(baselineRaw) : null;
    const currentSize = existsSync(journalPath) ? statSync(journalPath).size : 0;

    const reason = decide({
      loop: Boolean(loopSlug()),
      stopHookActive: Boolean(input?.stop_hook_active),
      baseline,
      currentSize,
    });
    if (reason) deny(reason);
  } catch (err) {
    process.stderr.write(`stop-journal: власна помилка, пропускаю (${err?.message})\n`);
  }
  allow();
}

if (isMain(import.meta.url)) await main();
