import { CliError } from "../errors.js";
import type { RepoRef } from "../repo.js";
import type { GhResult, GhRunner } from "./gh.js";
import type { CheckCounts, Checks, HostAdapter, ListOptions, PullRequest, PullRequestPage, Review } from "./host.js";

const QUERY = `query($owner: String!, $name: String!, $first: Int!, $base: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: $first, baseRefName: $base, orderBy: {field: CREATED_AT, direction: DESC}) {
      totalCount
      nodes {
        number title url isDraft createdAt updatedAt additions deletions baseRefName headRefName headRefOid reviewDecision
        author { login }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 1) {
                  checkRunCountsByState { state count }
                  statusContextCountsByState { state count }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

interface StateCount {
  state: string;
  count: number;
}

interface GraphQlRollup {
  state: string;
  contexts?: { checkRunCountsByState?: StateCount[]; statusContextCountsByState?: StateCount[] };
}

interface GraphQlPullRequest {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  reviewDecision: string | null;
  author: { login: string } | null;
  commits: { nodes: Array<{ commit: { statusCheckRollup: GraphQlRollup | null } }> };
}

const PASSING = new Set(["SUCCESS", "NEUTRAL", "COMPLETED"]);
const FAILING = new Set(["FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE", "CANCELLED", "ACTION_REQUIRED"]);
const PENDING = new Set(["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "EXPECTED"]);

interface GraphQlResponse {
  data?: {
    repository: { pullRequests: { totalCount: number; nodes: GraphQlPullRequest[] } } | null;
  };
}

// Talks to github.com or a GitHub Enterprise host through `gh`, which owns authentication.
export class GitHubAdapter implements HostAdapter {
  private readonly host: string;
  private readonly gh: GhRunner;

  constructor(host: string, gh: GhRunner) {
    this.host = host;
    this.gh = gh;
  }

  async listOpenPullRequests(repo: RepoRef, options: ListOptions): Promise<PullRequestPage> {
    const args = [
      "api",
      "graphql",
      "--hostname",
      this.host,
      "-f",
      `query=${QUERY}`,
      "-f",
      `owner=${repo.owner}`,
      "-f",
      `name=${repo.name}`,
      "-F",
      `first=${options.limit}`,
    ];
    if (options.base !== undefined) {
      args.push("-f", `base=${options.base}`);
    }
    const result = await this.gh(args, options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs });
    if (result.code !== 0) {
      throw this.mapError(result, repo);
    }
    const repository = (JSON.parse(result.stdout) as GraphQlResponse).data?.repository;
    if (!repository) {
      throw notFound(repo);
    }
    return {
      prs: repository.pullRequests.nodes.map(toPullRequest),
      total: repository.pullRequests.totalCount,
    };
  }

  cloneUrl(repo: RepoRef): string {
    return `https://${this.host}/${repo.owner}/${repo.name}.git`;
  }

  pullHeadRef(number: number): string {
    return `refs/pull/${number}/head`;
  }

  // Clears any configured helpers so git asks gh, and only gh, for credentials.
  gitArgs(): string[] {
    return ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"];
  }

  private mapError(result: GhResult, repo: RepoRef): CliError {
    const stderr = result.stderr.trim();
    if (/Could not resolve to a Repository/i.test(stderr) || /HTTP 404/.test(stderr)) {
      return notFound(repo);
    }
    if (/gh auth login|not logged in|authentication|HTTP 401|Bad credentials/i.test(stderr)) {
      return new CliError(`gh is not logged in to ${this.host}`, "AUTH_REQUIRED", [
        `Run \`gh auth login --hostname ${this.host}\``,
      ]);
    }
    if (/rate limit/i.test(stderr)) {
      return new CliError(`${this.host} rate limit reached`, "HOST_ERROR", ["Wait a few minutes, then run it again"]);
    }
    if (result.code === 124 || /timed out|timeout/i.test(stderr)) {
      return new CliError(`${this.host} did not answer in time`, "HOST_ERROR", ["Run it again"]);
    }
    return new CliError(`gh api failed: ${stderr || `exit ${result.code}`}`, "HOST_ERROR");
  }
}

function notFound(repo: RepoRef): CliError {
  return new CliError(`Repository ${repo.owner}/${repo.name} not found or not visible to your gh login`, "REPO_NOT_FOUND", [
    "Check the owner/repo spelling, or run `gh auth status` to see which account gh uses",
  ]);
}

function toPullRequest(node: GraphQlPullRequest): PullRequest {
  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup ?? null;
  return {
    number: node.number,
    title: node.title,
    author: node.author?.login ?? "ghost",
    base: node.baseRefName,
    headRef: node.headRefName,
    headSha: node.headRefOid,
    draft: node.isDraft,
    review: toReview(node.reviewDecision),
    checks: toChecks(rollup?.state),
    checkCounts: toCheckCounts(rollup),
    additions: node.additions,
    deletions: node.deletions,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    url: node.url,
  };
}

function toCheckCounts(rollup: GraphQlRollup | null): CheckCounts {
  const counts: CheckCounts = { passing: 0, failing: 0, pending: 0, skipped: 0 };
  const all = [...(rollup?.contexts?.checkRunCountsByState ?? []), ...(rollup?.contexts?.statusContextCountsByState ?? [])];
  for (const { state, count } of all) {
    if (PASSING.has(state)) counts.passing += count;
    else if (FAILING.has(state)) counts.failing += count;
    else if (PENDING.has(state)) counts.pending += count;
    else counts.skipped += count;
  }
  return counts;
}

function toReview(decision: string | null): Review {
  switch (decision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes";
    case "REVIEW_REQUIRED":
      return "required";
    default:
      return "none";
  }
}

function toChecks(state: string | undefined): Checks {
  switch (state) {
    case "SUCCESS":
      return "passing";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    case "FAILURE":
    case "ERROR":
      return "failing";
    default:
      return "none";
  }
}
