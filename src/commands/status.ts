import { analyzeRepo, type RepoAnalysis } from "../analyze.js";
import { parseArgs, positiveInt } from "../args.js";
import { writeSnapshot } from "../cache.js";
import type { Deps } from "../deps.js";
import { CliError } from "../errors.js";
import { countLine, fileList, prList, size, yesNo } from "../format.js";
import { renderStatus, type Hint } from "../human.js";
import type { Data } from "../output.js";
import { originRepo, parseRepoSpec, type RepoRef } from "../repo.js";
import type { CommandResult } from "./types.js";

export const STATUS_HELP = `usage: mergeq status [repo ...] [--base <branch>] [--limit <n>] [--json]
description: Open PRs with checks, review, conflicts with their base and with each other, and a suggested merge order
args:
  repo  owner/repo, host/owner/repo or a clone URL. Default: origin of the current directory
flags:
  --base <branch>  Only PRs targeting this branch
  --limit <n>  Most recent open PRs to analyze, 1-100 (default 30)
  --json  Full analysis as JSON
  --toon  TOON output (default when not on a terminal)
  --pretty  Human view (default on a terminal)
`;

export async function statusCommand(args: string[], deps: Deps): Promise<CommandResult> {
  const parsed = parseArgs(args, { values: ["base", "limit"], booleans: [] }, "status");
  const limit = positiveInt(parsed.values.get("limit"), "limit", 30, "status");
  const base = parsed.values.get("base");
  const repos = await targetRepos(parsed.positionals, deps.cwd);

  const analyses: RepoAnalysis[] = [];
  for (const repo of repos) {
    const analysis = await analyzeRepo(repo, {
      adapter: await deps.adapterFor(repo),
      cacheRoot: deps.cacheRoot,
      cwd: deps.cwd,
      limit,
      now: deps.now,
      ...(base === undefined ? {} : { base }),
    });
    if (base === undefined) {
      await writeSnapshot(deps.cacheRoot, repo, analysis);
    }
    analyses.push(analysis);
  }

  const single = analyses.length === 1 ? analyses[0] : undefined;
  const data: Data = single ? statusData(single) : { repos: analyses.map(statusData) };
  const json = single ?? { repos: analyses };
  return {
    data,
    json,
    help: statusHelp(analyses, limit),
    pretty: (style) => renderStatus(analyses, statusHints(analyses, limit), style, deps.now()),
  };
}

export async function targetRepos(specs: string[], cwd: string): Promise<RepoRef[]> {
  if (specs.length > 0) {
    return specs.map(parseRepoSpec);
  }
  const origin = await originRepo(cwd);
  if (!origin) {
    throw new CliError("No repository given and the current directory has no origin remote", "VALIDATION_ERROR", [
      "Run `mergeq status owner/repo`, or run it inside a clone",
    ]);
  }
  return [origin];
}

function statusData(analysis: RepoAnalysis): Data {
  const data: Data = {
    repo: analysis.repo,
    count: countLine(analysis.prs.length, analysis.total),
  };
  if (analysis.base) {
    data.base = analysis.base;
  }
  data.prs = analysis.prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    base: pr.base,
    author: pr.author,
    draft: yesNo(pr.draft),
    checks: pr.checks,
    review: pr.review,
    size: size(pr.additions, pr.deletions),
    areas: pr.areas.join(" "),
    conflicts_base: yesNo(pr.conflictsBase),
    conflicts_with: prList(pr.conflictsWith),
  }));
  data.order = analysis.order.map((item) => ({
    position: item.position,
    number: item.number,
    title: item.title,
    note: item.note,
  }));
  if (analysis.blocked.length > 0) {
    data.blocked = analysis.blocked;
  }
  if (analysis.pairs.length > 0) {
    data.conflicts = analysis.pairs.map((pair) => ({ a: pair.a, b: pair.b, files: fileList(pair.files) }));
  }
  return data;
}

function statusHelp(analyses: RepoAnalysis[], limit: number): string[] {
  const help: string[] = [];
  const first = analyses.find((analysis) => analysis.prs.length > 0);
  if (first) {
    const repoFlag = analyses.length > 1 ? ` --repo ${first.repo}` : "";
    help.push(`Run \`mergeq pr <number>${repoFlag}\` for one PR's files and conflicts`);
  }
  if (analyses.some((analysis) => analysis.total > analysis.prs.length) && limit < 100) {
    help.push("Run `mergeq status --limit 100` to include older open PRs");
  }
  help.push("Run `mergeq status --json` for the full analysis");
  return help;
}

function statusHints(analyses: RepoAnalysis[], limit: number): Hint[] {
  const hints: Hint[] = [];
  const multi = analyses.length > 1;
  for (const analysis of analyses) {
    const repoFlag = multi ? ` --repo ${analysis.repo}` : "";
    const rebase = analysis.order.find((item) => item.rebaseAfter.length > 0);
    const baseConflict = analysis.prs.find((pr) => pr.conflictsBase);
    if (rebase) {
      hints.push([`mergeq pr ${rebase.number}${repoFlag}`, `see why #${rebase.number} needs a rebase`]);
    } else if (baseConflict) {
      hints.push([`mergeq pr ${baseConflict.number}${repoFlag}`, `see what #${baseConflict.number} conflicts with in ${baseConflict.base}`]);
    } else if (analysis.order[0]) {
      hints.push([`mergeq pr ${analysis.order[0].number}${repoFlag}`, "details for the first PR to merge"]);
    }
  }
  if (analyses.some((analysis) => analysis.total > analysis.prs.length) && limit < 100) {
    hints.push(["mergeq status --limit 100", "include older open PRs"]);
  }
  hints.push(["mergeq status --json", "full analysis for scripts"]);
  return hints;
}
