import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Deps } from "../src/deps.js";
import type { HostAdapter, PullRequest } from "../src/hosts/host.js";
import type { RepoRef } from "../src/repo.js";

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

export interface Fixture {
  root: string;
  origin: string;
  work: string;
  cacheRoot: string;
  repo: RepoRef;
  prs: PullRequest[];
  adapter: HostAdapter;
  deps: (overrides?: Partial<Deps>) => Deps;
}

function run(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: ENV, encoding: "utf8" }).trim();
}

function commitFile(work: string, file: string, content: string, message: string): string {
  writeFileSync(join(work, file), content);
  run(work, "add", "-A");
  run(work, "commit", "-q", "-m", message);
  return run(work, "rev-parse", "HEAD");
}

// Five PRs against main: #1 and #2 edit the same line, #3 is independent, #4 is a draft, #5 conflicts with main.
export function buildFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "mergeq-test-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  const cacheRoot = join(root, "cache");
  run(root, "init", "-q", "--bare", "-b", "main", origin);
  run(root, "init", "-q", "-b", "main", work);
  run(work, "remote", "add", "origin", origin);
  execFileSync("mkdir", ["-p", join(work, "src")]);
  writeFileSync(join(work, "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(work, "b.txt"), "alpha\n");
  writeFileSync(join(work, "d.txt"), "first\n");
  commitFile(work, "src/c.ts", "export const c = 1;\n", "base");
  const base = run(work, "rev-parse", "HEAD");

  const branch = (number: number, file: string, content: string): string => {
    run(work, "checkout", "-q", "-b", `pr${number}`, base);
    const sha = commitFile(work, file, content, `pr ${number}`);
    run(work, "push", "-q", "origin", `${sha}:refs/pull/${number}/head`);
    return sha;
  };
  const heads = {
    1: branch(1, "a.txt", "ONE\ntwo\nthree\n"),
    2: branch(2, "a.txt", "uno\ntwo\nthree\n"),
    3: branch(3, "b.txt", "beta\n"),
    4: branch(4, "src/c.ts", "export const c = 2;\n"),
    5: branch(5, "d.txt", "from pr\n"),
  };
  run(work, "checkout", "-q", "main");
  commitFile(work, "d.txt", "from main\n", "main moves on");
  run(work, "push", "-q", "origin", "main");

  const pr = (number: keyof typeof heads, extra: Partial<PullRequest>): PullRequest => ({
    number,
    title: `PR ${number}`,
    author: "dev",
    base: "main",
    headRef: `feature-${number}`,
    headSha: heads[number],
    draft: false,
    review: "none",
    checks: "passing",
    additions: 1,
    deletions: 1,
    checkCounts: { passing: 2, failing: 0, pending: 0, skipped: 0 },
    createdAt: `2026-10-0${number}T00:00:00Z`,
    updatedAt: `2026-10-1${number}T00:00:00Z`,
    url: `https://example.test/pull/${number}`,
    ...extra,
  });
  const prs = [
    pr(1, { review: "approved" }),
    pr(2, {}),
    pr(3, { checks: "pending", checkCounts: { passing: 1, failing: 0, pending: 1, skipped: 0 } }),
    pr(4, { draft: true }),
    pr(5, {}),
  ];
  const adapter: HostAdapter = {
    listOpenPullRequests: async (_repo, options) => {
      const matching = prs.filter((candidate) => options.base === undefined || candidate.base === options.base);
      return { prs: matching.slice(0, options.limit), total: matching.length };
    },
    cloneUrl: () => origin,
    pullHeadRef: (number) => `refs/pull/${number}/head`,
    gitArgs: () => [],
  };
  const repo: RepoRef = { host: "github.com", owner: "acme", name: "shop" };
  return {
    root,
    origin,
    work,
    cacheRoot,
    repo,
    prs,
    adapter,
    deps: (overrides = {}) => ({
      cwd: root,
      env: {},
      cacheRoot,
      now: () => new Date("2026-10-19T12:00:00Z"),
      adapterFor: async () => adapter,
      ...overrides,
    }),
  };
}
