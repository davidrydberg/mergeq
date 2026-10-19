import { readFileSync } from "node:fs";
import { homeCommand } from "./commands/home.js";
import { PR_HELP, prCommand } from "./commands/pr.js";
import { STATUS_HELP, statusCommand } from "./commands/status.js";
import type { CommandResult } from "./commands/types.js";
import type { Deps } from "./deps.js";
import { CliError, exitCodeFor } from "./errors.js";
import { renderErrorHuman, renderHelp } from "./human.js";
import { renderError, renderJson, renderResult } from "./output.js";
import { painter, resolveStyle, type Style } from "./style.js";

export const DESCRIPTION = "Which open pull requests can merge, which ones conflict, and in what order to merge them";

export interface Io {
  write: (text: string) => void;
  isTTY: boolean;
  columns?: number | undefined;
}

type Format = "toon" | "json" | "pretty";

const FORMAT_FLAGS: Record<string, Format> = { "--toon": "toon", "--json": "json", "--pretty": "pretty" };

const TOP_HELP = `usage: mergeq [command] [args] [flags]
description: ${DESCRIPTION}
commands[3]:
  (none)  Cached summary for the current repo, fast enough for a session-start hook
  status [repo ...] [--base <branch>] [--limit <n>] [--json]  Analyze open PRs and suggest a merge order
  pr <number> [--repo <repo>] [--json]  One PR's files, conflicts and place in the order
flags[5]:
  --help  Show help, also after a command
  -v, --version  Print the version
  --toon  TOON output (default when not on a terminal)
  --pretty  Human view (default on a terminal)
  --json  Full data as JSON
`;

const OUTPUT_ROWS: Array<[string, string]> = [
  ["terminal", "human view with colors (NO_COLOR and FORCE_COLOR are respected)"],
  ["piped, hooks, agents", "TOON: compact tables plus help lines"],
  ["--json", "the full analysis for scripts"],
];

const FORMAT_ROWS: Array<[string, string]> = [
  ["--pretty", "human view, the default on a terminal"],
  ["--toon", "TOON, the default when piped"],
  ["--json", "full data as JSON"],
];

function topHelpHuman(style: Style): string {
  return renderHelp(
    [
      ["USAGE", ["mergeq [command] [args] [flags]"]],
      [
        "COMMANDS",
        [
          ["(none)", "summary for the repo you are in, cached and fast"],
          ["status [repo ...]", "analyze open PRs, find conflicts, suggest a merge order"],
          ["pr <number>", "one PR: files, conflicts and its place in the order"],
          ["help", "show this help"],
        ],
      ],
      [
        "FLAGS",
        [
          ["--base <branch>", "status: only PRs targeting this branch"],
          ["--limit <n>", "status: most recent open PRs to analyze, 1-100 (default 30)"],
          ["--repo <repo>", "pr: repository (default: origin of the current clone)"],
          ...FORMAT_ROWS,
          ["-h, --help", "help, also after a command"],
          ["-v, --version", "print the version"],
        ],
      ],
      ["OUTPUT", OUTPUT_ROWS],
      [
        "EXAMPLES",
        [
          ["mergeq", "summary for the repo you are in"],
          ["mergeq status", "open PRs, conflicts and merge order"],
          ["mergeq status owner/repo other/repo --base main", "several repos, only PRs into main"],
          ["mergeq pr 190", "why #190 sits where it does"],
          ["mergeq status --json", "full analysis for scripts"],
        ],
      ],
      ["REQUIRES", ["Node 24+, git 2.38+, GitHub CLI (gh) logged in with `gh auth login`"]],
    ],
    `${painter(style).bold("mergeq")} - ${DESCRIPTION.toLowerCase()}`,
    style,
  );
}

function statusHelpHuman(style: Style): string {
  return renderHelp(
    [
      ["USAGE", ["mergeq status [repo ...] [--base <branch>] [--limit <n>] [--pretty|--toon|--json]"]],
      ["ARGS", [["repo", "owner/repo, host/owner/repo or a clone URL (default: origin of the current clone)"]]],
      [
        "FLAGS",
        [
          ["--base <branch>", "only PRs targeting this branch"],
          ["--limit <n>", "most recent open PRs to analyze, 1-100 (default 30)"],
          ...FORMAT_ROWS,
        ],
      ],
      ["OUTPUT", OUTPUT_ROWS],
      [
        "EXAMPLES",
        [
          ["mergeq status", "the repo you are in"],
          ["mergeq status owner/repo other/repo --base main", "several repos, only PRs into main"],
          ["mergeq status --limit 100", "include older open PRs"],
          ["mergeq status --json", "full analysis for scripts"],
        ],
      ],
    ],
    `${painter(style).bold("mergeq status")} - open PRs with checks, review, conflicts and a suggested merge order`,
    style,
  );
}

function prHelpHuman(style: Style): string {
  return renderHelp(
    [
      ["USAGE", ["mergeq pr <number> [--repo <repo>] [--pretty|--toon|--json]"]],
      ["FLAGS", [["--repo <repo>", "owner/repo, host/owner/repo or a clone URL (default: origin of the current clone)"], ...FORMAT_ROWS]],
      ["OUTPUT", OUTPUT_ROWS],
      [
        "EXAMPLES",
        [
          ["mergeq pr 190", "one PR in the repo you are in"],
          ["mergeq pr 42 --repo owner/repo", "one PR in another repo"],
        ],
      ],
    ],
    `${painter(style).bold("mergeq pr")} - one PR: files, conflicts with its base and other PRs, and its place in the order`,
    style,
  );
}

const COMMANDS: Record<
  string,
  { run: (args: string[], deps: Deps) => Promise<CommandResult>; help: string; humanHelp: (style: Style) => string }
> = {
  status: { run: statusCommand, help: STATUS_HELP, humanHelp: statusHelpHuman },
  pr: { run: prCommand, help: PR_HELP, humanHelp: prHelpHuman },
};

export async function runCli(argv: string[], deps: Deps, io: Io): Promise<number> {
  const style = resolveStyle(deps.env, io.isTTY, io.columns);
  let format: Format = io.isTTY ? "pretty" : "toon";
  try {
    const formats = [...new Set(argv.filter((arg) => arg in FORMAT_FLAGS))];
    if (formats.length > 1) {
      throw new CliError("Use only one of --pretty, --toon and --json", "VALIDATION_ERROR", ["Run `mergeq --help`"]);
    }
    const chosen = formats[0];
    if (chosen !== undefined) {
      format = FORMAT_FLAGS[chosen] ?? format;
    }
    const [command, ...args] = argv.filter((arg) => !(arg in FORMAT_FLAGS));
    const pretty = format === "pretty";

    if (command === undefined) {
      return emit(await homeCommand(deps), format, style, io);
    }
    if (command === "--help" || command === "-h" || command === "help") {
      io.write(pretty ? `${topHelpHuman(style)}\n` : TOP_HELP);
      return 0;
    }
    if (command === "--version" || command === "-v") {
      io.write(`${version()}\n`);
      return 0;
    }
    if (command.startsWith("-")) {
      throw new CliError(`Flags go after the command, got ${command}`, "VALIDATION_ERROR", [
        "Run `mergeq status --json` or `mergeq --help`",
      ]);
    }
    const entry = COMMANDS[command];
    if (!entry) {
      throw new CliError(`Unknown command: ${command}`, "VALIDATION_ERROR", ["Run `mergeq --help` to see commands"]);
    }
    if (args.includes("--help") || args.includes("-h")) {
      io.write(pretty ? `${entry.humanHelp(style)}\n` : entry.help);
      return 0;
    }
    return emit(await entry.run(args, deps), format, style, io);
  } catch (error) {
    const known = error instanceof CliError;
    const message = error instanceof Error ? error.message : String(error);
    const code = known ? error.code : "UNKNOWN";
    const suggestions = known ? error.suggestions : [];
    io.write(`${format === "pretty" ? renderErrorHuman(message, code, suggestions, style) : renderError(message, code, suggestions)}\n`);
    return exitCodeFor(error);
  }
}

function emit(result: CommandResult | string, format: Format, style: Style, io: Io): number {
  if (typeof result === "string") {
    io.write(`${result}\n`);
  } else if (format === "json") {
    io.write(`${renderJson(result.json ?? result.data)}\n`);
  } else if (format === "pretty" && result.pretty) {
    io.write(`${result.pretty(style)}\n`);
  } else {
    io.write(`${renderResult(result)}\n`);
  }
  return 0;
}

export function version(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return pkg.version;
}
