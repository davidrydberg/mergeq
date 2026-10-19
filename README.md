# mergeq

`mergeq` tells you which open pull requests can merge, which ones conflict with their base or with each other, and in what order to merge them.
It is read-only and built for coding agents as much as for people: on a terminal it prints a readable report, and piped it prints compact TOON for agents.

## Install

```sh
npm i -g @davidrydberg/mergeq
```

## Requirements

- Node 24 or newer
- git 2.38 or newer
- The [GitHub CLI](https://cli.github.com), logged in with `gh auth login`

## Usage

```sh
mergeq                  # quick summary for the repo you are in
mergeq status           # open PRs, conflicts and merge order
mergeq status acme/shop acme/web --base main
mergeq pr 45            # one PR: files, conflicts, place in the order
mergeq status --json    # full analysis for scripts
mergeq --help
```

```
acme/shop  3 open PRs
2 ready  1 blocked  1 conflict pair

MERGE ORDER
   1  #42  Add order export        +120 -8   3d  ana
           v 4 passing  review approved  base main  updated 2h ago
           ! conflicts with #45, which merges later  ahead of #45 (smaller)
   2  #45  Rename export columns   +130 -30  2d  ana
           v 4 passing  review none  base main  updated 1h ago
           ! rebase after #42 (both touch export.ts)  behind #42 (larger)

BLOCKED
      #44  Rework checkout         +900 -210 6d  cy
           x draft

NEXT
  mergeq pr 45          see why #45 needs a rebase
```

## How the order is chosen

Drafts, PRs that conflict with their base, PRs with failing checks and PRs with changes requested are blocked.
The rest are sorted: ready (checks and review ok) first, then fewer conflicts with other PRs, then smaller, then older.
A PR that conflicts with one placed earlier is marked "rebase after #N".

## License

MIT
