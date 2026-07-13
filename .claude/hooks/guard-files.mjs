// guard-files.mjs — protected files (PreToolUse, matcher Edit|Write).
//
// Three groups of files the agent may not touch with the editor:
//
//   1. docs/roadmap.md — ALWAYS. The feature queue is run by a human (loop/PROMPT.md, Forbidden).
//   2. DONE at the root — the "loop is finished" signal. It may be created only in loop mode
//      and only when ALL tasks in the target tracker are done: DONE on top of an unfinished
//      tracker is a green light nobody switched on.
//   3. .claude/settings.json and .claude/hooks/** — in LOOP mode. The agent has no right to
//      disable its own safeguards. A human in an interactive session edits them freely.
//
// Check by hand:
//   printf '{"tool_input":{"file_path":"docs/roadmap.md"}}' | node .claude/hooks/guard-files.mjs
//   node .claude/hooks/guard-files.mjs --self-test

import { relative, resolve, isAbsolute, sep } from 'node:path';
import {
  readStdinJson, deny, allow, hookRoot, loopSlug, trackerTasks, selfTest, isMain,
} from './lib.mjs';

/**
 * Verdict for one path. Pure function; `tasks` — the target tracker's statuses (loop mode).
 * @returns {string|null} the reason to block, or null (allowed)
 */
export function decide(relPath, { loop, tasks }) {
  // Windows normalization: compare in forward slashes.
  const path = relPath.split(sep).join('/');

  if (path === 'docs/roadmap.md') {
    return 'docs/roadmap.md is edited only by a human — the feature queue is theirs (loop/PROMPT.md, Forbidden).';
  }

  if (path === 'DONE') {
    if (!loop) return 'DONE is the loop\'s completion signal; outside loop mode nobody creates it.';
    const undone = tasks.filter((t) => t.status !== 'done');
    if (tasks.length === 0) return 'DONE is forbidden: the target tracker was not found or has no tasks — there is nothing to finish.';
    if (undone.length > 0) {
      return `DONE is forbidden: the tracker still has non-done tasks: ${undone.map((t) => `${t.id} (${t.status})`).join(', ')} (loop/PROMPT.md, "when to create DONE").`;
    }
  }

  if (loop && (path === '.claude/settings.json' || path.startsWith('.claude/hooks/'))) {
    return 'In loop mode the safeguards (.claude/hooks/**, settings.json) are untouchable — the agent does not disable its own hooks. Hook misbehaving? Write it to the journal and end the turn.';
  }

  return null;
}

function runSelfTest() {
  const allDone = [{ id: 'T1', status: 'done' }, { id: 'T2', status: 'done' }];
  const mixed = [{ id: 'T1', status: 'done' }, { id: 'T2', status: 'todo' }];
  const failures = selfTest('guard-files', [
    { desc: 'roadmap in loop', actual: decide('docs/roadmap.md', { loop: true, tasks: [] }) !== null, expected: true },
    { desc: 'roadmap outside loop', actual: decide('docs/roadmap.md', { loop: false, tasks: [] }) !== null, expected: true },
    { desc: 'DONE outside loop', actual: decide('DONE', { loop: false, tasks: [] }) !== null, expected: true },
    { desc: 'DONE, tracker unfinished', actual: decide('DONE', { loop: true, tasks: mixed }) !== null, expected: true },
    { desc: 'DONE, tracker empty', actual: decide('DONE', { loop: true, tasks: [] }) !== null, expected: true },
    { desc: 'DONE, all done', actual: decide('DONE', { loop: true, tasks: allDone }), expected: null },
    { desc: 'hooks in loop', actual: decide('.claude/hooks/guard-bash.mjs', { loop: true, tasks: [] }) !== null, expected: true },
    { desc: 'settings.json in loop', actual: decide('.claude/settings.json', { loop: true, tasks: [] }) !== null, expected: true },
    { desc: 'hooks outside loop', actual: decide('.claude/hooks/guard-bash.mjs', { loop: false, tasks: [] }), expected: null },
    { desc: 'ordinary file', actual: decide('src/app.js', { loop: true, tasks: mixed }), expected: null },
    { desc: 'looks like DONE', actual: decide('docs/DONE.md', { loop: false, tasks: [] }), expected: null },
  ]);
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  if (process.argv.includes('--self-test')) runSelfTest();

  const input = await readStdinJson();
  const filePath = input?.tool_input?.file_path;
  if (typeof filePath !== 'string') allow(); // input we did not understand — fail open

  try {
    const root = hookRoot(import.meta.url);
    const abs = isAbsolute(filePath) ? filePath : resolve(root, filePath);
    const rel = relative(root, abs);
    if (rel.startsWith('..')) allow(); // outside the repo — not our jurisdiction

    const slug = loopSlug();
    const reason = decide(rel, { loop: Boolean(slug), tasks: slug ? trackerTasks(root, slug) : [] });
    if (reason) deny(reason);
  } catch (err) {
    process.stderr.write(`guard-files: internal error, allowing (${err?.message})\n`);
  }
  allow();
}

if (isMain(import.meta.url)) await main();
