---
status: Accepted
owner: "kosiakMD"
reviewers: []
updated_at: "2026-07-12"
feature_size: "S"
ticket: "agent-infra"
---

# 0003 — Enforce agent prohibitions with Claude Code hooks, prompts stay as the portable layer

- **Status:** Accepted
- **Date:** 2026-07-12
- **Deciders:** kosiakMD

## Context

Every prohibition that keeps the autonomous loop safe — no `git push`, no branch switching,
no edits to `docs/roadmap.md`, `SDD-Task:` trailers on commits, "append the journal before
the turn ends" — lived only in prompt text (`loop/PROMPT.md` §Заборонено, `AGENTS.md`
§Чого НЕ робити). Prompt text is enforced by model obedience: it usually holds, and
sometimes does not. Meanwhile the repo's stated philosophy is deterministic gates
(`npm run verify`), yet gates only check the *result* of a turn — nothing intercepts a
forbidden *action* at the moment it is attempted.

## Decision drivers

- The autonomy ceiling (local commits only) must not depend on the model's mood.
- Non-Claude agents (Codex, Copilot, Cursor, Antigravity) read the same repo and have no
  hook mechanism — whatever we add must not become the *only* place a rule lives.
- The repo works from a clean clone with zero external dependencies; gates that silently
  skip are worse than absent gates.
- A human working interactively must not be strangled by loop-grade restrictions.

## Considered options

1. **Claude Code hooks as a second, mechanical layer; prompts unchanged.** Hooks in
   `.claude/hooks/` intercept `PreToolUse`/`PostToolUse`/`Stop`; strictness keys off
   `RALPH_FEATURE` (set only by the loop runner).
2. **Prompts only (status quo).** Zero code, but every prohibition remains advisory.
3. **Move rules out of prompts into hooks entirely.** Single source, but non-Claude
   agents would lose the rules completely.
4. **Git-level enforcement (pre-push/pre-commit hooks, read-only remotes).** Tool-agnostic,
   but blind to non-git actions (file edits, journal discipline) and easy to bypass with
   `--no-verify`; also invisible to the agent until the action already failed.

## Decision outcome

**Chosen:** Option 1. Hooks are defense-in-depth, not the source of truth: the prompt
remains the first layer and the only one portable across tools. A hook denial (exit 2 +
reason on stderr) is phrased so the agent reads it as a tripped safeguard, not a bug.

Key properties, enforced by `npm run hooks:test` (part of the `verify` matrix):

- **Mode-gated strictness.** The full ceiling applies only in loop mode
  (`RALPH_FEATURE` present); interactive humans keep only universal safeguards
  (no commit on `main`, no `--no-verify`).
- **Fail-open on own bugs.** A broken safeguard warns and allows; it never paralyzes work.
- **False negatives over false positives.** The bash guard is a rough tokenizer, not a
  shell parser; a missed edge case falls through to the prompt layer.
- **Self-protection.** In loop mode the agent cannot edit `.claude/hooks/**` or
  `.claude/settings.json`.

## Consequences

**Positive**
- The ceiling holds mechanically for the agent that actually runs the loop today.
- Violations fail *at the action* with an explanation, not N steps later at the gate.
- 45 deterministic self-test cases run in the verify matrix at zero tokens.

**Negative**
- Two layers to keep in sync: a rule changed in prompts must be re-checked against hooks.
- Claude-specific: other tools still rely on prompt obedience alone.

**Neutral**
- Hooks require the human's one-time approval in interactive Claude Code sessions;
  the headless loop runs them without prompting.

## Links

- Developer guide: [.claude/hooks/README.md](../../.claude/hooks/README.md) — how the layer
  works, how to add a hook, troubleshooting.
- Agent-facing summary: [AGENTS.md](../../AGENTS.md#хуки-claude-code).
- Loop ceiling: [loop/README.md](../../loop/README.md#гілка-й-стеля-автономії).
- Hooks: `.claude/hooks/` → `guard-bash.mjs` · `guard-files.mjs` · `post-edit.mjs` ·
  `stop-journal.mjs` · `loop-memory.mjs`; registry `.claude/settings.json`.
