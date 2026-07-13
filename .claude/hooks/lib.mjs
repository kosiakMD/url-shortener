// lib.mjs — the shared minimum for hooks. Not to be confused with scripts/lib.mjs: that
// library lives in the world of gates (Verdict, killListeners), this one in the world of
// hooks (stdin JSON, deny/allow).
//
// Rules shared by every hook in this directory:
//   - zero npm dependencies: a hook that needs node_modules silently vanishes in a fresh clone;
//   - fail-open on its own bugs: a broken safeguard must never paralyze the work;
//   - stdin is always consumed, otherwise the hook hangs or dies with EPIPE;
//   - blocking = exit 2 + reason on stderr; silent allow = exit 0.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Repo root, resolved from the hook file itself (.claude/hooks/ → ../..), NOT from
 * `$CLAUDE_PROJECT_DIR` in the command line: that variable is expanded by the shell,
 * and on Windows the path turns into garbage.
 */
export function hookRoot(importMetaUrl) {
  return resolve(dirname(fileURLToPath(importMetaUrl)), '..', '..');
}

/**
 * Claude Code sends the hook JSON on stdin. Returns the parsed object or `null` —
 * in which case the hook must fail open: input we did not understand is no reason
 * to block the work.
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

/** Block: the agent sees the reason and must understand WHAT to do instead. */
export function deny(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

/** Silent allow. */
export function allow() {
  process.exit(0);
}

/** Runs a command and returns { ok, out, status }. Never throws. */
export function run(cmd, args, options = {}) {
  const spawnOptions = { encoding: 'utf8', ...options };
  let result = spawnSync(cmd, args, spawnOptions);

  // npm-installed CLIs on Windows are `.cmd` shims: they do not start without a shell.
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

/** Current branch of the repo. */
export function branch(root) {
  return run('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
}

/**
 * Task statuses from a feature tracker: [{ id, status }]. Same row format that
 * loop-memory.mjs reads: `| T1 | … | todo |`. No file or no rows — empty array.
 */
export function trackerTasks(root, slug) {
  const path = join(root, 'docs', 'features', slug, 'tasks', 'tracker.md');
  if (!existsSync(path)) return [];
  return [
    ...readFileSync(path, 'utf8').matchAll(/^\|\s*(T\d+)\s*\|.*\|\s*(todo|in_progress|blocked|review|done)\s*\|/gm),
  ].map(([, id, status]) => ({ id, status }));
}

/**
 * Loop mode: ralph sets `RALPH_FEATURE=<slug>` for the agent subprocess. A human's
 * interactive session does not have this variable — and the hooks are far more
 * lenient without it.
 */
export function loopSlug() {
  return process.env.RALPH_FEATURE || null;
}

/**
 * Rough split of a shell command line into simple commands: on `&&`, `||`, `;`, `|`.
 * Deliberately NOT a full shell parser. A false pass is acceptable (the prompt stays
 * as the second layer of defense); a false block is not.
 */
export function splitCommands(commandLine) {
  return commandLine
    .split(/&&|\|\||;|\|/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Tokens of a simple command; quotes are stripped roughly, quoted content stays one token. */
export function tokens(simpleCommand) {
  const found = simpleCommand.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
  return found.map((t) => t.replace(/^['"]|['"]$/g, ''));
}

/**
 * Git subcommand with global options accounted for: `git -C path -c a=b push` → `push`.
 * Returns null when it is not git or no subcommand is visible.
 */
export function gitSubcommand(toks) {
  if (toks[0] !== 'git') return null;
  for (let i = 1; i < toks.length; i += 1) {
    const t = toks[i];
    if (t === '-C' || t === '-c') {
      i += 1; // the option's value
    } else if (!t.startsWith('-')) {
      return t;
    }
  }
  return null;
}

/** Micro test harness for --self-test: a table of cases → failure count. */
export function selfTest(name, cases) {
  const failures = [];
  for (const { desc, actual, expected } of cases) {
    if (actual !== expected) failures.push(`${desc}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  for (const f of failures) console.error(`  ✗ [${name}] ${f}`);
  if (failures.length === 0) console.log(`  ✓ ${name}: ${cases.length} cases`);
  return failures.length;
}

/** Is the process main file me? (So importing from the self-test runner does not run main.) */
export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
}
