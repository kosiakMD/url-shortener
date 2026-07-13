# Hooks — the mechanical layer of prohibitions

Claude Code runs the scripts in this directory **itself**, on session events (registry —
[`.claude/settings.json`](../settings.json)). They turn the prohibitions from the prompts
([loop/PROMPT.md](../../loop/PROMPT.md) "Заборонено", [AGENTS.md](../../AGENTS.md)) into
deterministic safeguards: a forbidden action is intercepted **at the moment of execution**,
with a reason the agent sees as a tool refusal.

The decision and its alternatives — [ADR 0003](../../docs/adr/0003-hooks-enforce-agent-prohibitions.md).
The prompts remain the first layer and the only one for non-Claude agents: a hook is a
backstop, not the source of truth.

## Map

| Event | File | What it does |
|---|---|---|
| `SessionStart` | [loop-memory.mjs](./loop-memory.mjs) | injects the loop journal + fresh git/tracker facts into the iteration's context; writes the journal-size baseline to `tmp/journal-baseline` |
| `PreToolUse` (Bash) | [guard-bash.mjs](./guard-bash.mjs) | in the loop: blocks `git push`, `checkout`/`switch`, `npm install <pkg>`, commits without `SDD-Task:`; always: commits on `main`, `--no-verify` |
| `PreToolUse` (Edit/Write) | [guard-files.mjs](./guard-files.mjs) | `docs/roadmap.md` — humans only; `DONE` — only when the target tracker is fully `done`; in the loop the hooks and `settings.json` are untouchable |
| `PostToolUse` (Edit/Write) | [post-edit.mjs](./post-edit.mjs) | right after an edit: links in `*.md` (`links:check --file`), ESLint on the changed file |
| `Stop` | [stop-journal.mjs](./stop-journal.mjs) | in the loop, refuses to end the turn until `loop/JOURNAL.md` has grown past the baseline |

**Loop mode.** Full strictness is switched on by the `RALPH_FEATURE` variable — only
`loop/ralph.mjs` sets it. A human's interactive session does not have it, so only the
universal safeguards apply there (commits on `main`, `--no-verify`).

## Mechanics (shared by all hooks)

- Claude Code sends the hook **JSON on stdin** (`tool_name`, `tool_input`, for Stop —
  `stop_hook_active`). Unconsumed stdin = a hang, so [lib.mjs](./lib.mjs) always drains it.
- **Blocking** = exit `2` + the reason on stderr. The reason says WHAT to do instead of the
  forbidden action — the agent should understand the safeguard, not fight it.
- **Silent allow** = exit `0` with no output.
- **Fail-open**: unrecognized input or an internal exception → a warning on stderr and exit
  `0`. A broken safeguard must never paralyze the work.
- The repo root is resolved **from the hook file itself** (`.claude/hooks/ → ../..`), not
  from `$CLAUDE_PROJECT_DIR` in the command line: the shell expands that variable, and on
  Windows the path breaks.

## How to check

```bash
npm run hooks:test                                  # self-tests of all hooks; part of verify
node .claude/hooks/guard-bash.mjs --self-test       # a single hook
printf '{"tool_input":{"command":"git push"}}' | RALPH_FEATURE=x node .claude/hooks/guard-bash.mjs
```

The self-tests are deterministic: no model, no network, 0 tokens. Each hook's verdict logic
is a pure `decide()` function, so it is tested without spawning processes or touching git state.

## How to add a new hook

1. Copy the skeleton of any guard: `decide()` (pure function) + `runSelfTest()` + `main()`
   with `readStdinJson`/`deny`/`allow` from [lib.mjs](./lib.mjs). Keep the invariants above —
   especially fail-open and draining stdin.
2. Add the file to the `HOOKS` list in [self-test.mjs](./self-test.mjs) — otherwise the gate
   does not see it.
3. Register the event in [`.claude/settings.json`](../settings.json) (for
   `PreToolUse`/`PostToolUse` do not forget the `matcher`).
4. Add a row to the table here and in [AGENTS.md](../../AGENTS.md#hooks-claude-code).
5. `npm run verify` — everything must be green from a fresh clone, with no new dependencies.

## If a hook blocked you (a human)

- Check that `RALPH_FEATURE` is not lingering in your environment — outside the loop it must
  not be set.
- Commits on `main` and `--no-verify` are blocked for everyone on purpose: create a branch /
  drop the flag.
- If a hook misbehaves — fix it and add the case to its self-test; in loop mode the agent
  cannot do that (self-protection), a human in an interactive session can.

⚠ In interactive Claude Code a new or changed hook takes effect after a session restart and
a one-time human confirmation. The headless loop (`npm run ralph`) runs hooks without asking.
