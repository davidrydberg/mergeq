# mergeq - spec

## Problem

Coding agents open pull requests in parallel.
The person or supervising agent then has to work out which PRs can merge now, which ones conflict with the base or with each other, and in what order to merge them so that each merge does not break the next.
Today that answer is rebuilt by hand, or by an agent reading PRs one at a time, every session, with different results each time.

## Goal

One read-only command that gives the same answer every time, in a format an agent can read cheaply and a person can read directly.

## Users

- Coding agents and agent supervisors, which call it before suggesting merges.
- People running several agents, who want the answer at the start of a session.

## Non-goals

- Merging, rebasing, commenting, labelling or any write to the host.
- Semantic conflict detection (two PRs that merge cleanly but break each other at runtime).
- Stacked-PR workflows.
- A hosted service or web UI.

## Commands

| Command | Does |
|---|---|
| `mergeq` | Hook-safe summary for the current repo: open count, PRs with passing checks and no blocking review, conflicting count and the top of the order from the last analysis, how many PRs changed since |
| `mergeq status [repo ...] [--base <b>] [--limit <n>] [--json]` | Full analysis per repo: PR table, merge order, blocked PRs with reasons, conflicting pairs with files |
| `mergeq pr <n> [--repo <r>] [--json]` | One PR: metadata, files, conflicts with its base and with each other open PR, its place in the order |
| `mergeq --help`, `-h`, `help`, `<command> --help`, `-v` | Help with commands, flags, output modes and examples; version |

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Write access | None | Safe to run any time, from any agent, with no approval step |
| Output | Human view with colors on a terminal; TOON tables with `help[n]` lines when piped; `--json` for full data; `--pretty` and `--toon` force a mode | People get a readable report, agents keep a cheap stable format |
| Human view | Merge order with the reason for each position, checks breakdown, review, base, age, last update, author, size; blocked PRs with reasons and files; conflict pairs; next commands | Everything needed to decide without opening GitHub |
| Errors | `error`, `code`, `help`; exit 2 for usage errors, 1 otherwise | Agents can branch on the code and follow the fix |
| Interactivity | Never prompts | An agent that hits a prompt hangs |
| Conflict detection | `git merge-tree --write-tree` in memory | Exact git behaviour, no working tree, fast |
| Pairwise checks | Merge A onto the base, then B on top; only same-base pairs that both merge cleanly and share a changed file | Pairs with no shared file cannot conflict textually, which keeps big PR lists fast |
| Git storage | Bare mirror in the user cache dir | Never touches the user's clones or worktrees |
| Host access | Adapter interface; GitHub through `gh api graphql --hostname <host>` in v0.1 | One query gives PRs, checks, reviews and sizes; `--hostname` covers GitHub Enterprise; other hosts are one adapter each |
| Auth | `gh` is required and owns all credentials. Git uses `gh auth git-credential` as its only credential helper for mirror clones and fetches | mergeq never sees, passes or stores a token |
| Enterprise hosts | github.com is GitHub; any other host is GitHub if `gh auth status --hostname <host>` succeeds | No host list to configure |
| Home view | No clone, 1.5 s GitHub timeout, falls back to the last snapshot, one line outside a GitHub clone or without `gh` | Runs from session-start hooks in every session |
| Order | Blocked: draft, base conflict, failing checks, changes requested. Then readiness, fewer conflicts, smaller, older | Merge what is ready and least entangled first, so later PRs rebase onto as few changes as possible |
| Distribution | `npm i -g @davidrydberg/mergeq`, command `mergeq`, MIT. Requires Node 24+, git 2.38+ and `gh` logged in | One-command install for anyone with Node and gh |

## Output modes

| Reader | Output | Force it with |
|---|---|---|
| A person in a terminal | Human view with colors, fitted to the terminal width | `--pretty` |
| Agents, pipes, hooks | TOON: compact tables plus `help` lines | `--toon` |
| Scripts | The full analysis as JSON | `--json` |

Colors follow `NO_COLOR` and `FORCE_COLOR`.
Errors print `error`, `code` and `help` and exit with 2 for a usage mistake and 1 for everything else.
Codes: `GH_REQUIRED`, `AUTH_REQUIRED`, `REPO_NOT_FOUND`, `NOT_FOUND`, `UNSUPPORTED_HOST`, `HOST_ERROR`, `VALIDATION_ERROR`.

## How it works

1. One GraphQL query through `gh api graphql` lists the open PRs: base, head, draft, checks, review, size, dates.
2. A bare mirror under `~/.cache/mergeq/` (or `$XDG_CACHE_HOME/mergeq/`) gets the base branches and each PR head.
   The user's clones are never touched; inside a clone of the same repo, the first mirror borrows its objects.
3. Each PR is merged against the tip of its base with `git merge-tree`, in memory.
4. Each pair on the same base that both merge cleanly and share a changed file is checked by merging the first onto the base and the second on top.
5. The order is planned from that.

## Session-start hook

Bare `mergeq` never clones, gives up on GitHub after 1.5 seconds and falls back to the last `mergeq status`, and prints one line outside a GitHub clone or without `gh`.
Claude Code example for `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "mergeq", "timeout": 10 }] }]
  }
}
```

## Limits

- GitHub and GitHub Enterprise only, through `gh`.
- Conflicts are textual; PRs that merge cleanly can still break each other at runtime.
- Pairs with no shared changed file are skipped, which can miss rare directory-rename conflicts.
- The first `status` on a large repo clones it once.
- `status` analyzes the 30 most recent open PRs by default, up to 100.

## Later

- More host adapters (GitLab, Forgejo/Gitea, Bitbucket).
- Grouping related PRs across repositories.
- Detecting that a PR's checks are stale relative to the current base.
