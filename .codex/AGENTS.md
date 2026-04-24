# ECC For Codex In This Project

This file supplements the root `AGENTS.md` with `everything-claude-code` guidance for Codex.

## Skills Discovery

ECC skills are installed under `.agents/skills/`. Load only the skill directories relevant to the current task.

High-value ECC skills for this repository:
- `backend-patterns`
- `api-design`
- `tdd-workflow`
- `security-review`
- `verification-loop`
- `coding-standards`
- `strategic-compact`

Additional ECC skills are available for frontend, E2E, writing, and research workflows.

## Operating Rules

1. Root `AGENTS.md` remains the primary instruction source.
2. ECC guidance is supplemental and should not override the repository's init/taskflow/governance protocol.
3. Since Codex has no Claude-style hook parity, enforce ECC via instructions, tests, verification loops, and sandbox discipline.
4. Prefer project-level `.codex/config.toml` over changing the user's global Codex config unless explicitly requested.

## Security Without Hooks

1. Validate inputs at system boundaries.
2. Never hardcode secrets.
3. Review diffs before destructive or irreversible actions.
4. Keep verification results in `.codex/verification.md`.
