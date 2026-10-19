import type { RepoAnalysis } from "../analyze.js";
import { readSnapshot } from "../cache.js";
import type { Deps } from "../deps.js";
import { CliError } from "../errors.js";
import { age } from "../format.js";
import { GH_INSTALL_HINT } from "../hosts/gh.js";
import type { PullRequestPage } from "../hosts/host.js";
import { renderHome, type Hint, type HomeView } from "../human.js";
import type { Data } from "../output.js";
import { originRepo, repoSlug } from "../repo.js";
import type { CommandResult } from "./types.js";

const LIVE_TIMEOUT_MS = 1500;

// Runs from session-start hooks, so it never clones, never fails loudly and stays within a short time budget.
export async function homeCommand(deps: Deps): Promise<CommandResult | string> {
  const repo = await originRepo(deps.cwd);
  if (!repo) {
    return "mergeq: no git origin here. Run `mergeq status owner/repo` to check a repository";
  }
  const slug = repoSlug(repo);
  let live: PullRequestPage | undefined;
  try {
    const adapter = await deps.adapterFor(repo);
    live = await adapter.listOpenPullRequests(repo, { limit: 30, timeoutMs: LIVE_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof CliError && error.code === "GH_REQUIRED") {
      return `mergeq: needs the GitHub CLI. ${GH_INSTALL_HINT}, then run \`gh auth login\``;
    }
    if (error instanceof CliError && error.code === "UNSUPPORTED_HOST") {
      return `mergeq: ${slug} skipped (${error.message})`;
    }
  }
  const snapshot = await readSnapshot<RepoAnalysis>(deps.cacheRoot, repo);
  if (!snapshot && !live) {
    return `mergeq: ${slug} has no cached analysis and GitHub did not answer in time. Run \`mergeq status\``;
  }

  const view: HomeView = {
    repo: slug.startsWith("github.com/") ? slug.slice("github.com/".length) : slug,
    open: live?.total ?? snapshot?.total ?? 0,
    cached: !live,
    next: snapshot?.order.slice(0, 3) ?? [],
  };
  const data: Data = { repo: slug, open: view.open };
  if (live) {
    view.okCount = live.prs.filter(
      (pr) => !pr.draft && (pr.checks === "passing" || pr.checks === "none") && (pr.review === "approved" || pr.review === "none"),
    ).length;
    data.checks_and_review_ok = view.okCount;
  } else {
    data.source = "cache (GitHub did not answer in time)";
  }

  const help: string[] = [];
  const hints: Hint[] = [];
  if (snapshot) {
    const changed = live ? changedSince(snapshot, live) : 0;
    view.conflicting = snapshot.prs.filter((pr) => pr.conflictsBase || pr.conflictsWith.length > 0).length;
    view.analysisAge = age(snapshot.analyzedAt, deps.now());
    view.changed = changed;
    data.conflicting = view.conflicting;
    data.analysis = changed > 0 ? `${view.analysisAge} ago, ${changed} PRs changed since` : `${view.analysisAge} ago`;
    data.next = view.next.map((item) => ({ position: item.position, number: item.number, title: item.title, note: item.note }));
    if (changed > 0) {
      help.push("Run `mergeq status` to refresh conflicts and the merge order");
      hints.push(["mergeq status", "refresh conflicts and the merge order"]);
    } else {
      hints.push(["mergeq status", "full merge order with checks and conflicts"]);
    }
  } else {
    help.push("Run `mergeq status` to check conflicts and get a merge order");
    hints.push(["mergeq status", "check conflicts and get a merge order"]);
  }
  help.push("Run `mergeq pr <number>` for one PR's files and conflicts");
  hints.push(["mergeq pr <number>", "one PR's files and conflicts"]);
  return { data, help, pretty: (style) => renderHome(view, hints, style) };
}

function changedSince(snapshot: RepoAnalysis, live: PullRequestPage): number {
  const before = new Map(snapshot.prs.map((pr) => [pr.number, pr.headSha]));
  const now = new Map(live.prs.map((pr) => [pr.number, pr.headSha]));
  let changed = 0;
  for (const [number, sha] of now) {
    if (before.get(number) !== sha) changed++;
  }
  for (const number of before.keys()) {
    if (!now.has(number) && live.total <= live.prs.length) changed++;
  }
  return changed;
}
