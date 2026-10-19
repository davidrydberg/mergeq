import type { RepoRef } from "../repo.js";

export type Checks = "passing" | "pending" | "failing" | "none";
export type Review = "approved" | "changes" | "required" | "none";

export interface CheckCounts {
  passing: number;
  failing: number;
  pending: number;
  skipped: number;
}

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  base: string;
  headRef: string;
  headSha: string;
  draft: boolean;
  review: Review;
  checks: Checks;
  additions: number;
  deletions: number;
  checkCounts: CheckCounts;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface PullRequestPage {
  prs: PullRequest[];
  total: number;
}

export interface ListOptions {
  limit: number;
  base?: string;
  timeoutMs?: number;
}

// Everything that differs between git hosts. The git work itself is host-neutral.
export interface HostAdapter {
  listOpenPullRequests(repo: RepoRef, options: ListOptions): Promise<PullRequestPage>;
  cloneUrl(repo: RepoRef): string;
  pullHeadRef(number: number): string;
  gitArgs(): string[];
}
