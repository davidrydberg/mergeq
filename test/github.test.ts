import { describe, expect, it } from "vitest";
import { createGhRunner, type GhResult, type GhRunner } from "../src/hosts/gh.js";
import { GitHubAdapter } from "../src/hosts/github.js";
import { adapterFor } from "../src/hosts/index.js";

const repo = { host: "github.com", owner: "acme", name: "shop" };

function fakeGh(result: Partial<GhResult>, calls: string[][] = []): GhRunner {
  return async (args) => {
    calls.push(args);
    return { stdout: "", stderr: "", code: 0, ...result };
  };
}

const page = {
  data: {
    repository: {
      pullRequests: {
        totalCount: 9,
        nodes: [
          {
            number: 7,
            title: "Add thing",
            url: "https://github.com/acme/shop/pull/7",
            isDraft: false,
            createdAt: "2026-10-01T00:00:00Z",
            additions: 3,
            deletions: 1,
            baseRefName: "main",
            headRefOid: "abc",
            reviewDecision: "CHANGES_REQUESTED",
            author: null,
            commits: { nodes: [{ commit: { statusCheckRollup: { state: "ERROR" } } }] },
          },
        ],
      },
    },
  },
};

describe("GitHubAdapter", () => {
  it("queries through gh api graphql on the repo's host and maps the result", async () => {
    const calls: string[][] = [];
    const adapter = new GitHubAdapter("github.com", fakeGh({ stdout: JSON.stringify(page) }, calls));
    const result = await adapter.listOpenPullRequests(repo, { limit: 5, base: "main" });
    expect(result.total).toBe(9);
    expect(result.prs[0]).toMatchObject({ number: 7, author: "ghost", review: "changes", checks: "failing", headSha: "abc" });
    expect(calls[0]?.slice(0, 4)).toEqual(["api", "graphql", "--hostname", "github.com"]);
    expect(calls[0]).toContain("first=5");
    expect(calls[0]).toContain("base=main");
  });

  it.each([
    ["GraphQL: Could not resolve to a Repository with the name 'acme/shop'. (repository)", "REPO_NOT_FOUND"],
    ["To get started with GitHub CLI, please run:  gh auth login", "AUTH_REQUIRED"],
    ["HTTP 401: Bad credentials (https://api.github.com/graphql)", "AUTH_REQUIRED"],
    ["GraphQL: API rate limit exceeded for user ID 1.", "HOST_ERROR"],
  ])("maps gh error %s to %s", async (stderr, code) => {
    const adapter = new GitHubAdapter("github.com", fakeGh({ code: 1, stderr }));
    await expect(adapter.listOpenPullRequests(repo, { limit: 5 })).rejects.toMatchObject({ code });
  });

  it("tells you which host to log in to", async () => {
    const adapter = new GitHubAdapter("git.example.com", fakeGh({ code: 4, stderr: "not logged in to any GitHub hosts" }));
    await expect(adapter.listOpenPullRequests(repo, { limit: 5 })).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      suggestions: ["Run `gh auth login --hostname git.example.com`"],
    });
  });

  it("lets git authenticate through gh and nothing else", () => {
    const adapter = new GitHubAdapter("git.example.com", fakeGh({}));
    expect(adapter.gitArgs()).toEqual(["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"]);
    expect(adapter.cloneUrl(repo)).toBe("https://git.example.com/acme/shop.git");
  });
});

describe("adapterFor", () => {
  it("treats github.com as GitHub without asking gh", async () => {
    const calls: string[][] = [];
    await adapterFor(repo, fakeGh({}, calls));
    expect(calls).toEqual([]);
  });

  it("accepts an enterprise host that gh is logged in to", async () => {
    const calls: string[][] = [];
    const adapter = await adapterFor({ ...repo, host: "git.example.com" }, fakeGh({ code: 0 }, calls));
    expect(calls).toEqual([["auth", "status", "--hostname", "git.example.com"]]);
    expect(adapter.cloneUrl(repo)).toBe("https://git.example.com/acme/shop.git");
  });

  it("rejects a host gh does not know", async () => {
    await expect(adapterFor({ ...repo, host: "gitlab.com" }, fakeGh({ code: 1 }))).rejects.toMatchObject({
      code: "UNSUPPORTED_HOST",
    });
  });
});

describe("createGhRunner", () => {
  it("reports a missing gh as GH_REQUIRED with install help", async () => {
    const gh = createGhRunner({ PATH: "/nonexistent" });
    await expect(gh(["--version"])).rejects.toMatchObject({
      code: "GH_REQUIRED",
      suggestions: ["Install the GitHub CLI: https://cli.github.com", "Then run `gh auth login`"],
    });
  });
});
