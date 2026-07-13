// post-edit.mjs — fast feedback right after an edit (PostToolUse, matcher Edit|Write).
//
// Until now the agent saw an error in a freshly edited file only at the gate — N steps
// later, when the context of the edit was already gone. This hook returns it IMMEDIATELY,
// scoped to the single file:
//
//   *.md                      → scripts/check-links.mjs --file <path> (wikilinks, broken links)
//   src|tests|scripts|hooks/*.js|.mjs → eslint on that file
//
// The hook does NOT run tests — that is the gate's job (`test:fast` is run by the loop
// runner after the turn, by a human via verify). A red check = exit 2: PostToolUse cannot
// undo the edit, but stderr goes back to the agent, who fixes it while the file is still
// in context.
//
// Check by hand:
//   printf '{"tool_input":{"file_path":"README.md"}}' | node .claude/hooks/post-edit.mjs
//   node .claude/hooks/post-edit.mjs --self-test

import { relative, resolve, isAbsolute, join, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { readStdinJson, deny, allow, hookRoot, run, selfTest, isMain } from './lib.mjs';

const TIMEOUT_MS = 5000;

/** Which check does this path deserve? Pure function — this is what the self-test runs. */
export function checkKind(relPath) {
  const path = relPath.split(sep).join('/');
  if (path.endsWith('.md')) return 'links';
  const isCode = /\.(js|mjs)$/.test(path)
    && /^(src|tests|scripts|\.claude\/hooks)\//.test(path)
    && !path.startsWith('src/public/'); // the frontend is linted by the full `npm run lint`, not by the hook
  return isCode ? 'lint' : null;
}

function runSelfTest() {
  const failures = selfTest('post-edit', [
    { desc: 'md → links', actual: checkKind('docs/roadmap.md'), expected: 'links' },
    { desc: 'src js → lint', actual: checkKind('src/app.js'), expected: 'lint' },
    { desc: 'tests js → lint', actual: checkKind('tests/unit/shorten.test.js'), expected: 'lint' },
    { desc: 'hook → lint', actual: checkKind('.claude/hooks/lib.mjs'), expected: 'lint' },
    { desc: 'frontend — not the hook\'s job', actual: checkKind('src/public/app.js'), expected: null },
    { desc: 'json — nothing', actual: checkKind('package.json'), expected: null },
    { desc: 'root js — nothing', actual: checkKind('eslint.config.js'), expected: null },
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
        deny(`Links in the just-edited ${rel} are broken — fix them now, while the file is in context:\n${res.out.trim()}`);
      }
    }

    if (kind === 'lint') {
      // The local binary, not npx: npx without a cache goes to the network, and a hook must be instant.
      const eslint = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'eslint.cmd' : 'eslint');
      if (!existsSync(eslint)) allow(); // a fresh clone without node_modules — do not paralyze
      const res = run(eslint, ['--no-warn-ignored', abs], { cwd: root, timeout: TIMEOUT_MS });
      if (!res.ok && res.status !== null) {
        deny(`ESLint in the just-edited ${rel} — fix it now:\n${res.out.trim()}`);
      }
    }
    // res.status === null means a timeout or spawn failure — fail open, per the invariant.
  } catch (err) {
    process.stderr.write(`post-edit: internal error, allowing (${err?.message})\n`);
  }
  allow();
}

if (isMain(import.meta.url)) await main();
