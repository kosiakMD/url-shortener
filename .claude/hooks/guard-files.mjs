// guard-files.mjs — захищені файли (подія PreToolUse, matcher Edit|Write).
//
// Три групи файлів, які агент не має права чіпати редактором:
//
//   1. docs/roadmap.md — ЗАВЖДИ. Чергу фіч веде людина (loop/PROMPT.md §Заборонено).
//   2. DONE у корені — сигнал «луп закінчив». Створювати його можна лише в луп-режимі
//      і лише коли ВСІ задачі трекера цілі стоять у done: DONE поверх недоробленого
//      трекера — це зелене світло, якого ніхто не вмикав.
//   3. .claude/settings.json і .claude/hooks/** — у ЛУП-режимі. Агент не має права
//      вимикати власні запобіжники. Людина в інтерактиві редагує їх вільно.
//
// Перевірити руками:
//   printf '{"tool_input":{"file_path":"docs/roadmap.md"}}' | node .claude/hooks/guard-files.mjs
//   node .claude/hooks/guard-files.mjs --self-test

import { relative, resolve, isAbsolute, sep } from 'node:path';
import {
  readStdinJson, deny, allow, hookRoot, loopSlug, trackerTasks, selfTest, isMain,
} from './lib.mjs';

/**
 * Вердикт для одного шляху. Чиста функція; `tasks` — статуси трекера цілі (луп-режим).
 * @returns {string|null} причина блокування або null (дозволено)
 */
export function decide(relPath, { loop, tasks }) {
  // Windows-нормалізація: порівнюємо у форварад-слешах.
  const path = relPath.split(sep).join('/');

  if (path === 'docs/roadmap.md') {
    return 'docs/roadmap.md редагує лише людина — чергу фіч веде вона (loop/PROMPT.md §Заборонено).';
  }

  if (path === 'DONE') {
    if (!loop) return 'DONE — сигнал завершення лупа; поза луп-режимом його не створює ніхто.';
    const undone = tasks.filter((t) => t.status !== 'done');
    if (tasks.length === 0) return 'DONE заборонено: трекер цілі не знайдено або в ньому немає задач — нема чого завершувати.';
    if (undone.length > 0) {
      return `DONE заборонено: у трекері ще не done: ${undone.map((t) => `${t.id} (${t.status})`).join(', ')} (loop/PROMPT.md §Коли створювати DONE).`;
    }
  }

  if (loop && (path === '.claude/settings.json' || path.startsWith('.claude/hooks/'))) {
    return 'У луп-режимі запобіжники (.claude/hooks/**, settings.json) недоторканні — агент не вимикає власні хуки. Проблема в хуку? Запиши в журнал і заверши хід.';
  }

  return null;
}

function runSelfTest() {
  const allDone = [{ id: 'T1', status: 'done' }, { id: 'T2', status: 'done' }];
  const mixed = [{ id: 'T1', status: 'done' }, { id: 'T2', status: 'todo' }];
  const failures = selfTest('guard-files', [
    { desc: 'roadmap у лупі', actual: decide('docs/roadmap.md', { loop: true, tasks: [] }) !== null, expected: true },
    { desc: 'roadmap поза лупом', actual: decide('docs/roadmap.md', { loop: false, tasks: [] }) !== null, expected: true },
    { desc: 'DONE поза лупом', actual: decide('DONE', { loop: false, tasks: [] }) !== null, expected: true },
    { desc: 'DONE, трекер недороблений', actual: decide('DONE', { loop: true, tasks: mixed }) !== null, expected: true },
    { desc: 'DONE, трекер порожній', actual: decide('DONE', { loop: true, tasks: [] }) !== null, expected: true },
    { desc: 'DONE, все done', actual: decide('DONE', { loop: true, tasks: allDone }), expected: null },
    { desc: 'хуки в лупі', actual: decide('.claude/hooks/guard-bash.mjs', { loop: true, tasks: [] }) !== null, expected: true },
    { desc: 'settings.json у лупі', actual: decide('.claude/settings.json', { loop: true, tasks: [] }) !== null, expected: true },
    { desc: 'хуки поза лупом', actual: decide('.claude/hooks/guard-bash.mjs', { loop: false, tasks: [] }), expected: null },
    { desc: 'звичайний файл', actual: decide('src/app.js', { loop: true, tasks: mixed }), expected: null },
    { desc: 'схожий на DONE', actual: decide('docs/DONE.md', { loop: false, tasks: [] }), expected: null },
  ]);
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  if (process.argv.includes('--self-test')) runSelfTest();

  const input = await readStdinJson();
  const filePath = input?.tool_input?.file_path;
  if (typeof filePath !== 'string') allow(); // незрозумілий вхід — fail-open

  try {
    const root = hookRoot(import.meta.url);
    const abs = isAbsolute(filePath) ? filePath : resolve(root, filePath);
    const rel = relative(root, abs);
    if (rel.startsWith('..')) allow(); // поза репо — не наша юрисдикція

    const slug = loopSlug();
    const reason = decide(rel, { loop: Boolean(slug), tasks: slug ? trackerTasks(root, slug) : [] });
    if (reason) deny(reason);
  } catch (err) {
    process.stderr.write(`guard-files: власна помилка, пропускаю (${err?.message})\n`);
  }
  allow();
}

if (isMain(import.meta.url)) await main();
