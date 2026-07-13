// stop-journal.mjs — "the turn's last step is to write down what happened" (Stop event).
//
// loop/PROMPT.md requires appending to loop/JOURNAL.md at the end of EVERY turn — it is the
// only memory channel between iterations of the blind loop. A turn that ends silently forces
// the next iteration to repeat the same mistake. Until now this relied on model obedience.
//
// Mechanics: on SessionStart loop-memory.mjs writes the journal size to tmp/journal-baseline.
// On Stop this hook compares: the journal did not grow → block the stop (exit 2) with a reminder.
//
// The anti-looping safeguard is Claude Code's `stop_hook_active` field: it is true when the
// agent kept working precisely because a Stop hook blocked it. We never block twice in a row:
// an agent that TRULY has nothing to write must not hang in an endless cycle.
//
// Outside loop mode (no RALPH_FEATURE) the hook is silent: a human in an interactive
// session needs no journal.
//
// Check by hand:
//   printf '{}' | RALPH_FEATURE=x node .claude/hooks/stop-journal.mjs
//   node .claude/hooks/stop-journal.mjs --self-test

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readStdinJson, deny, allow, hookRoot, loopSlug, selfTest, isMain } from './lib.mjs';

/**
 * Verdict. Pure function — this is what the self-test runs.
 * @returns {string|null} the reason to block, or null
 */
export function decide({ loop, stopHookActive, baseline, currentSize }) {
  if (!loop) return null;
  if (stopHookActive) return null; // this stop was already blocked once — do not loop
  if (baseline === null) return null; // no baseline (a turn outside ralph?) — fail open
  if (currentSize > baseline) return null;
  return [
    'The turn did not append to loop/JOURNAL.md — and that is the only thing the next',
    'iteration will hear from you (loop/PROMPT.md, "the turn\'s last step"). Append a block:',
    '### Iteration <N> — <task id> · **Did:** … · **Stumbled on:** … · **For the next turn:** …',
    'Write it even when there was no progress — especially then.',
  ].join('\n');
}

function runSelfTest() {
  const failures = selfTest('stop-journal', [
    { desc: 'outside loop', actual: decide({ loop: false, stopHookActive: false, baseline: 0, currentSize: 0 }), expected: null },
    { desc: 'journal did not grow', actual: decide({ loop: true, stopHookActive: false, baseline: 100, currentSize: 100 }) !== null, expected: true },
    { desc: 'journal shrank (rewritten?)', actual: decide({ loop: true, stopHookActive: false, baseline: 100, currentSize: 40 }) !== null, expected: true },
    { desc: 'journal grew', actual: decide({ loop: true, stopHookActive: false, baseline: 100, currentSize: 260 }), expected: null },
    { desc: 'first entry into an empty journal', actual: decide({ loop: true, stopHookActive: false, baseline: 0, currentSize: 50 }), expected: null },
    { desc: 'second block in a row — skip', actual: decide({ loop: true, stopHookActive: true, baseline: 100, currentSize: 100 }), expected: null },
    { desc: 'no baseline — fail-open', actual: decide({ loop: true, stopHookActive: false, baseline: null, currentSize: 100 }), expected: null },
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
    process.stderr.write(`stop-journal: internal error, allowing (${err?.message})\n`);
  }
  allow();
}

if (isMain(import.meta.url)) await main();
