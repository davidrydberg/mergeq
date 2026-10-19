# mergeq

Read-only CLI: which open PRs can merge, which ones conflict, and in what order.
`prd.md` is the spec.
Read it before changing behaviour, and change it in the same commit when a decision changes.

## Layout

| Path | What it is |
|---|---|
| `src/bin/mergeq.ts` | Executable entry. Wires real dependencies into `runCli` |
| `src/cli.ts` | Dispatcher: output mode (`--pretty`, `--toon`, `--json`, TTY detection), help, version, commands, errors and exit codes |
| `src/commands/` | `home` (hook-safe summary), `status`, `pr`. Each returns data plus help lines |
| `src/analyze.ts` | One repo end to end: list PRs, fetch into the mirror, base and pairwise conflicts, order |
| `src/conflicts.ts` | `git merge-tree`, `commit-tree` and `diff` wrappers |
| `src/order.ts` | Pure merge-order planner. The one place the ordering rules live |
| `src/cache.ts` | Bare mirror under the cache dir and the last-status snapshot the home view reads |
| `src/hosts/` | Host adapter interface, the `gh` runner and the GitHub implementation. Everything host-specific lives here |
| `src/repo.ts` | Repo spec and remote URL parsing |
| `src/output.ts` | TOON rendering, help lines, JSON |
| `src/human.ts` | Human view for terminals: status, pr, home, help and errors |
| `src/style.ts` | Colors (`NO_COLOR`, `FORCE_COLOR`), glyphs, width-aware truncation and padding |
| `test/` | Vitest. Real temporary git repos with a local bare origin and a fake adapter. No network |

## Rules

- Read-only towards the host. Never merge, push, comment or label.
- Never touch the user's clones. All git work happens in the cache mirror.
- Never prompt. Every input is an argument or flag.
- Two output contracts: TOON when stdout is not a terminal, the human view when it is. Agents depend on the TOON shape, so change it only on purpose and update its tests and the README in the same commit.
- The human view must fit the terminal width and read correctly with `NO_COLOR`. Glyphs stay as `\u` escapes in source.
- The home view runs from session-start hooks: no clone, short timeouts, never a non-zero exit for a missing repo or a slow network.
- `gh` owns authentication. mergeq never reads, passes or stores a token: API calls go through `gh api`, git uses `gh auth git-credential` as its only credential helper.
- Tests never run the real `gh` or touch the network. Inject a fake `GhRunner`.
- No client or company names in tracked files. Examples use `acme/shop`.

## Commands

```sh
npm test
npm run typecheck
npm run lint
npm run build
```
