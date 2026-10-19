import { analyzeRepo } from "../analyze.js";
import { parseArgs } from "../args.js";
import type { Deps } from "../deps.js";
import { CliError } from "../errors.js";
import { countLine, fileList, size, yesNo } from "../format.js";
import { renderPr, type Hint } from "../human.js";
import type { Data } from "../output.js";
import { targetRepos } from "./status.js";
import type { CommandResult } from "./types.js";

export const PR_HELP = `usage: mergeq pr <number> [--repo <repo>] [--json]
description: One open PR: files changed, conflicts with its base and with every other open PR on that base, and its place in the merge order
flags:
  --repo <repo>  owner/repo, host/owner/repo or a clone URL. Default: origin of the current directory
  --json  Full analysis of this PR as JSON
  --toon  TOON output (default when not on a terminal)
  --pretty  Human view (default on a terminal)
`;

const MAX_FILES = 50;
const ANALYZE_LIMIT = 100;

export async function prCommand(args: string[], deps: Deps): Promise<CommandResult> {
  const parsed = parseArgs(args, { values: ["repo"], booleans: [] }, "pr");
  const number = Number(parsed.positionals[0]);
  if (parsed.positionals.length !== 1 || !Number.isInteger(number) || number < 1) {
    throw new CliError("Give exactly one PR number", "VALIDATION_ERROR", ["Run `mergeq pr 123`"]);
  }
  const repoSpec = parsed.values.get("repo");
  const [repo] = await targetRepos(repoSpec === undefined ? [] : [repoSpec], deps.cwd);
  if (!repo) {
    throw new CliError("No repository resolved", "VALIDATION_ERROR");
  }
  const analysis = await analyzeRepo(repo, {
    adapter: await deps.adapterFor(repo),
    cacheRoot: deps.cacheRoot,
    cwd: deps.cwd,
    limit: ANALYZE_LIMIT,
    now: deps.now,
  });
  const pr = analysis.prs.find((candidate) => candidate.number === number);
  if (!pr) {
    throw new CliError(
      `PR #${number} is not open in ${analysis.repo}, or not among its ${ANALYZE_LIMIT} most recent open PRs`,
      "NOT_FOUND",
      ["Run `mergeq status` to list open PRs"],
    );
  }

  const partners = analysis.pairs
    .filter((pair) => pair.a === number || pair.b === number)
    .map((pair) => {
      const other = pair.a === number ? pair.b : pair.a;
      return {
        pr: other,
        title: analysis.prs.find((candidate) => candidate.number === other)?.title ?? "",
        files: fileList(pair.files),
      };
    });
  const placed = analysis.order.find((item) => item.number === number);
  const blocked = analysis.blocked.find((item) => item.number === number);

  const data: Data = {
    pr: {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      author: pr.author,
      base: pr.base,
      draft: yesNo(pr.draft),
      checks: pr.checks,
      review: pr.review,
      size: size(pr.additions, pr.deletions),
      created: pr.createdAt,
    },
    order: placed
      ? `${placed.position} of ${analysis.order.length}: ${placed.note}`
      : `blocked: ${blocked?.reason ?? "unknown"}`,
    conflicts_base: pr.conflictsBase ? `yes: ${fileList(pr.baseConflictFiles)}` : "no",
    conflicts_with: partners,
    files_count: countLine(Math.min(pr.files.length, MAX_FILES), pr.files.length),
    files: pr.files.slice(0, MAX_FILES).map((path) => ({ path })),
  };

  const help: string[] = [];
  if (pr.conflictsBase) {
    help.push(`Rebase #${number} onto ${pr.base} before it can merge`);
  }
  for (const partner of partners) {
    const earlier = analysis.order.find((item) => item.number === partner.pr);
    if (earlier && placed && earlier.position < placed.position) {
      help.push(`Merge #${partner.pr} first, then rebase #${number}`);
    }
  }
  help.push("Run `mergeq status` for every open PR and the full order");

  const repoFlag = repoSpec === undefined ? "" : ` --repo ${repoSpec}`;
  const hints: Hint[] = [];
  for (const partner of partners) {
    const earlier = analysis.order.find((item) => item.number === partner.pr);
    if (earlier && placed && earlier.position < placed.position) {
      hints.push([`mergeq pr ${partner.pr}${repoFlag}`, `#${partner.pr} merges first; rebase #${number} after it`]);
    }
  }
  hints.push([`mergeq status${repoSpec === undefined ? "" : ` ${repoSpec}`}`, "every open PR and the full order"]);

  return {
    data,
    json: { repo: analysis.repo, pr, order: placed ?? null, blocked: blocked ?? null, conflicts: partners },
    help,
    pretty: (style) => renderPr(analysis, pr, hints, style, deps.now()),
  };
}
