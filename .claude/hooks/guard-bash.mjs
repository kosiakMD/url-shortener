// guard-bash.mjs — стеля автономії лупа, механічно (подія PreToolUse, matcher Bash).
//
// Дотепер заборони з loop/PROMPT.md («git push заборонено», «не перемикай гілку») трималися
// на слухняності моделі. Цей хук перехоплює команду ДО виконання і відмовляє з причиною —
// агент бачить її як відмову інструмента і мусить зрозуміти, що це запобіжник, а не збій.
//
// Строгість залежить від режиму (RALPH_FEATURE — його виставляє loop/ralph.mjs):
//   - у ЛУП-режимі діє повна стеля: push, перемикання гілок, нові npm-залежності,
//     трейлер SDD-Task у комітах;
//   - в інтерактиві людини лишаються тільки універсальні запобіжники: коміт на main
//     і --no-verify (обхід власних воріт не дозволений нікому й ніколи).
//
// Хук свідомо НЕ повний парсер шелу: команди ріжуться грубо (lib.splitCommands). Хибний
// пропуск прийнятний — промпт лишається другим шаром; хибне блокування — ні.
//
// Перевірити руками:
//   printf '{"tool_input":{"command":"git push"}}' | RALPH_FEATURE=x node .claude/hooks/guard-bash.mjs
//   node .claude/hooks/guard-bash.mjs --self-test

import {
  readStdinJson, deny, allow, hookRoot, branch, loopSlug,
  splitCommands, tokens, gitSubcommand, selfTest, isMain,
} from './lib.mjs';

/**
 * Вердикт для одного рядка Bash-команди. Чиста функція — саме її ганяє self-test.
 * @returns {string|null} причина блокування або null (дозволено)
 */
export function decide(commandLine, { loop, currentBranch }) {
  for (const simple of splitCommands(commandLine)) {
    const toks = tokens(simple);
    if (toks.length === 0) continue;

    const sub = gitSubcommand(toks);

    if (sub === 'push' && loop) {
      return 'Стеля лупа — коміт у ЛОКАЛЬНУ гілку (loop/PROMPT.md §Заборонено). git push робить людина після рев\'ю.';
    }

    if ((sub === 'checkout' || sub === 'switch') && loop) {
      return `git ${sub} заборонено в лупі: ти вже на потрібній гілці (loop/PROMPT.md §Заборонено). Відновити файл — git restore <шлях>.`;
    }

    if (sub === 'commit') {
      if (toks.includes('--no-verify') || toks.includes('-n')) {
        return 'git commit --no-verify обходить власні ворота репо — так не комітить ніхто, ні агент, ні людина.';
      }
      if (currentBranch === 'main') {
        return 'Коміт на main заборонено — створи гілку: git checkout -b feat/<slug> (AGENTS.md §Як реалізовувати фічу).';
      }
      // Трейлер перевіряємо лише коли повідомлення видно в команді (-m). Коміт через
      // редактор чи -F тут не прочитати — fail-open, друге плече лишається за reviewer-ом.
      if (loop && toks.includes('-m') && !simple.includes('SDD-Task:')) {
        return 'Коміт задачі лупа мусить нести трейлер `SDD-Task: <id>` (loop/PROMPT.md §Протокол ходу, крок COMMIT).';
      }
    }

    // Нова залежність — лише через ADR фічі. Голий `npm install` (відновлення
    // node_modules) — дозволений: у ньому немає імені пакета.
    if (loop && toks[0] === 'npm' && ['install', 'i', 'add'].includes(toks[1])) {
      const packages = toks.slice(2).filter((t) => !t.startsWith('-'));
      if (packages.length > 0) {
        return `Нова npm-залежність (${packages.join(', ')}) — лише якщо ADR фічі прямо її дозволив (AGENTS.md §Золоті правила). Немає ADR — ескалюй, не встановлюй.`;
      }
    }
  }
  return null;
}

function runSelfTest() {
  const loop = { loop: true, currentBranch: 'feat/x' };
  const human = { loop: false, currentBranch: 'feat/x' };
  const failures = selfTest('guard-bash', [
    { desc: 'push у лупі', actual: decide('git push', loop) !== null, expected: true },
    { desc: 'push у ланцюжку', actual: decide('npm test && git push origin HEAD', loop) !== null, expected: true },
    { desc: 'push через -C', actual: decide('git -C . push', loop) !== null, expected: true },
    { desc: 'push поза лупом', actual: decide('git push', human), expected: null },
    { desc: 'checkout у лупі', actual: decide('git checkout main', loop) !== null, expected: true },
    { desc: 'checkout -- file у лупі', actual: decide('git checkout -- src/app.js', loop) !== null, expected: true },
    { desc: 'switch у лупі', actual: decide('git switch -c feat/y', loop) !== null, expected: true },
    { desc: 'restore дозволено', actual: decide('git restore src/app.js', loop), expected: null },
    { desc: 'commit на main', actual: decide('git commit -m "x"', { loop: false, currentBranch: 'main' }) !== null, expected: true },
    { desc: 'commit --no-verify', actual: decide('git commit --no-verify -m "x"', human) !== null, expected: true },
    { desc: 'commit без трейлера в лупі', actual: decide('git commit -m "feat: x"', loop) !== null, expected: true },
    { desc: 'commit із трейлером у лупі', actual: decide('git commit -m "feat: x" -m "SDD-Task: T1"', loop), expected: null },
    { desc: 'commit без -m (редактор) — fail-open', actual: decide('git commit', loop), expected: null },
    { desc: 'npm install <pkg> у лупі', actual: decide('npm install lodash', loop) !== null, expected: true },
    { desc: 'npm i -D <pkg> у лупі', actual: decide('npm i -D vitest-extra', loop) !== null, expected: true },
    { desc: 'голий npm install', actual: decide('npm install', loop), expected: null },
    { desc: 'npm ci', actual: decide('npm ci', loop), expected: null },
    { desc: 'npm install <pkg> поза лупом', actual: decide('npm install lodash', human), expected: null },
    { desc: 'звичайна команда', actual: decide('npm run test:fast', loop), expected: null },
    { desc: 'git log', actual: decide('git log --oneline -3', loop), expected: null },
  ]);
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  if (process.argv.includes('--self-test')) runSelfTest();

  const input = await readStdinJson();
  const command = input?.tool_input?.command;
  if (typeof command !== 'string') allow(); // незрозумілий вхід — fail-open

  try {
    const root = hookRoot(import.meta.url);
    const reason = decide(command, { loop: Boolean(loopSlug()), currentBranch: branch(root) });
    if (reason) deny(reason);
  } catch (err) {
    // Баг у самому запобіжнику не має паралізувати роботу.
    process.stderr.write(`guard-bash: власна помилка, пропускаю (${err?.message})\n`);
  }
  allow();
}

if (isMain(import.meta.url)) await main();
