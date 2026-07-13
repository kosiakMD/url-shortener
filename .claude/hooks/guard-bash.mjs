// guard-bash.mjs — the loop's autonomy ceiling, enforced mechanically (PreToolUse, matcher Bash).
//
// Until now the prohibitions from loop/PROMPT.md ("git push is forbidden", "do not switch
// branches") relied on model obedience. This hook intercepts the command BEFORE it runs and
// denies it with a reason — the agent sees it as a tool refusal and must read it as a
// safeguard tripping, not as a malfunction.
//
// Strictness depends on the mode (RALPH_FEATURE — set by loop/ralph.mjs):
//   - in LOOP mode the full ceiling applies: push, branch switching, new npm dependencies,
//     the SDD-Task trailer on commits;
//   - in a human's interactive session only the universal safeguards remain: committing on
//     main and --no-verify (bypassing the repo's own gates is allowed to no one, ever).
//
// The hook is deliberately NOT a full shell parser: commands are split roughly
// (lib.splitCommands). A false pass is acceptable — the prompt stays as the second layer;
// a false block is not.
//
// Check by hand:
//   printf '{"tool_input":{"command":"git push"}}' | RALPH_FEATURE=x node .claude/hooks/guard-bash.mjs
//   node .claude/hooks/guard-bash.mjs --self-test

import {
  readStdinJson, deny, allow, hookRoot, branch, loopSlug,
  splitCommands, tokens, gitSubcommand, selfTest, isMain,
} from './lib.mjs';

/**
 * Verdict for one Bash command line. Pure function — this is what the self-test runs.
 * @returns {string|null} the reason to block, or null (allowed)
 */
export function decide(commandLine, { loop, currentBranch }) {
  for (const simple of splitCommands(commandLine)) {
    const toks = tokens(simple);
    if (toks.length === 0) continue;

    const sub = gitSubcommand(toks);

    if (sub === 'push' && loop) {
      return 'The loop\'s ceiling is a commit to the LOCAL branch (loop/PROMPT.md, Forbidden). A human runs git push after review.';
    }

    if ((sub === 'checkout' || sub === 'switch') && loop) {
      return `git ${sub} is forbidden in the loop: you are already on the right branch (loop/PROMPT.md, Forbidden). To restore a file use git restore <path>.`;
    }

    if (sub === 'commit') {
      if (toks.includes('--no-verify') || toks.includes('-n')) {
        return 'git commit --no-verify bypasses the repo\'s own gates — nobody commits like that, neither agent nor human.';
      }
      if (currentBranch === 'main') {
        return 'Committing on main is forbidden — create a branch: git checkout -b feat/<slug> (AGENTS.md, "Як реалізовувати фічу").';
      }
      // The trailer is checked only when the message is visible in the command (-m).
      // A commit via the editor or -F cannot be read here — fail open; the reviewer
      // remains the second arm of this check.
      if (loop && toks.includes('-m') && !simple.includes('SDD-Task:')) {
        return 'A loop task commit must carry the `SDD-Task: <id>` trailer (loop/PROMPT.md, turn protocol, COMMIT step).';
      }
    }

    // A new dependency only via the feature's ADR. Bare `npm install` (restoring
    // node_modules) is allowed: it carries no package name.
    if (loop && toks[0] === 'npm' && ['install', 'i', 'add'].includes(toks[1])) {
      const packages = toks.slice(2).filter((t) => !t.startsWith('-'));
      if (packages.length > 0) {
        return `A new npm dependency (${packages.join(', ')}) is allowed only if the feature's ADR explicitly permits it (AGENTS.md, golden rules). No ADR — escalate, do not install.`;
      }
    }
  }
  return null;
}

function runSelfTest() {
  const loop = { loop: true, currentBranch: 'feat/x' };
  const human = { loop: false, currentBranch: 'feat/x' };
  const failures = selfTest('guard-bash', [
    { desc: 'push in loop', actual: decide('git push', loop) !== null, expected: true },
    { desc: 'push in a chain', actual: decide('npm test && git push origin HEAD', loop) !== null, expected: true },
    { desc: 'push via -C', actual: decide('git -C . push', loop) !== null, expected: true },
    { desc: 'push outside loop', actual: decide('git push', human), expected: null },
    { desc: 'checkout in loop', actual: decide('git checkout main', loop) !== null, expected: true },
    { desc: 'checkout -- file in loop', actual: decide('git checkout -- src/app.js', loop) !== null, expected: true },
    { desc: 'switch in loop', actual: decide('git switch -c feat/y', loop) !== null, expected: true },
    { desc: 'restore allowed', actual: decide('git restore src/app.js', loop), expected: null },
    { desc: 'commit on main', actual: decide('git commit -m "x"', { loop: false, currentBranch: 'main' }) !== null, expected: true },
    { desc: 'commit --no-verify', actual: decide('git commit --no-verify -m "x"', human) !== null, expected: true },
    { desc: 'commit without trailer in loop', actual: decide('git commit -m "feat: x"', loop) !== null, expected: true },
    { desc: 'commit with trailer in loop', actual: decide('git commit -m "feat: x" -m "SDD-Task: T1"', loop), expected: null },
    { desc: 'commit without -m (editor) — fail-open', actual: decide('git commit', loop), expected: null },
    { desc: 'npm install <pkg> in loop', actual: decide('npm install lodash', loop) !== null, expected: true },
    { desc: 'npm i -D <pkg> in loop', actual: decide('npm i -D vitest-extra', loop) !== null, expected: true },
    { desc: 'bare npm install', actual: decide('npm install', loop), expected: null },
    { desc: 'npm ci', actual: decide('npm ci', loop), expected: null },
    { desc: 'npm install <pkg> outside loop', actual: decide('npm install lodash', human), expected: null },
    { desc: 'ordinary command', actual: decide('npm run test:fast', loop), expected: null },
    { desc: 'git log', actual: decide('git log --oneline -3', loop), expected: null },
  ]);
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  if (process.argv.includes('--self-test')) runSelfTest();

  const input = await readStdinJson();
  const command = input?.tool_input?.command;
  if (typeof command !== 'string') allow(); // input we did not understand — fail open

  try {
    const root = hookRoot(import.meta.url);
    const reason = decide(command, { loop: Boolean(loopSlug()), currentBranch: branch(root) });
    if (reason) deny(reason);
  } catch (err) {
    // A bug in the safeguard itself must never paralyze the work.
    process.stderr.write(`guard-bash: internal error, allowing (${err?.message})\n`);
  }
  allow();
}

if (isMain(import.meta.url)) await main();
