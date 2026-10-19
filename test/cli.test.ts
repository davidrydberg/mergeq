import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { ghRequired } from "../src/hosts/gh.js";
import type { Deps } from "../src/deps.js";
import { buildFixture } from "./fixture.js";

async function cli(argv: string[], deps: Deps, tty = false): Promise<{ code: number; out: string }> {
  let out = "";
  const code = await runCli(argv, deps, {
    write: (text) => {
      out += text;
    },
    isTTY: tty,
    columns: 100,
  });
  return { code, out };
}

function cloneWithOrigin(url: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mergeq-home-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["remote", "add", "origin", url], { cwd: dir });
  return dir;
}

describe("mergeq cli", () => {
  const fixture = buildFixture();

  it("prints help and version", async () => {
    expect((await cli(["--help"], fixture.deps())).out).toContain("usage: mergeq [command]");
    expect((await cli(["status", "--help"], fixture.deps())).out).toContain("--limit <n>");
    expect((await cli(["--version"], fixture.deps())).out).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it("rejects unknown commands, leading flags and bad flags with exit 2", async () => {
    for (const argv of [["nope"], ["--wat"], ["status", "--wat"], ["status", "--json", "--toon"], ["status", "--limit", "0"], ["pr", "abc"]]) {
      const result = await cli(argv, fixture.deps());
      expect(result.code).toBe(2);
      expect(result.out).toContain("code: VALIDATION_ERROR");
      expect(result.out).toContain("help[1]:");
    }
  });

  it("renders status as TOON tables with help lines", async () => {
    const { code, out } = await cli(["status", "acme/shop"], fixture.deps());
    expect(code).toBe(0);
    expect(out).toContain("repo: github.com/acme/shop");
    expect(out).toContain("count: 5");
    expect(out).toContain("prs[5]{number,title,base,author,draft,checks,review,size,areas,conflicts_base,conflicts_with}:");
    expect(out).toContain("2,PR 2,main,dev,no,passing,none,+1/-1,(root),no,\"#1\"");
    expect(out).toContain("order[3]{position,number,title,note}:");
    expect(out).toContain("2,2,PR 2,ready; rebase after #1");
    expect(out).toContain("conflicts[1]{a,b,files}:");
    expect(out).toMatch(/help\[\d+\]:\n {2}Run `mergeq pr <number>`/);
  });

  it("returns the full analysis with --json", async () => {
    const { out } = await cli(["status", "acme/shop", "--json"], fixture.deps());
    const parsed = JSON.parse(out) as { repo: string; pairs: unknown[]; prs: Array<{ files: string[] }> };
    expect(parsed.repo).toBe("github.com/acme/shop");
    expect(parsed.pairs).toEqual([{ a: 1, b: 2, files: ["a.txt"] }]);
    expect(parsed.prs[0]?.files).toEqual(["a.txt"]);
  });

  it("explains one PR", async () => {
    const { code, out } = await cli(["pr", "2", "--repo", "acme/shop"], fixture.deps());
    expect(code).toBe(0);
    expect(out).toContain("order: \"2 of 3: ready; rebase after #1\"");
    expect(out).toContain("conflicts_with[1]{pr,title,files}:");
    expect(out).toContain("Merge #1 first, then rebase #2");
  });

  it("reports a PR that is not open as NOT_FOUND with exit 1", async () => {
    const { code, out } = await cli(["pr", "99", "--repo", "acme/shop"], fixture.deps());
    expect(code).toBe(1);
    expect(out).toContain("code: NOT_FOUND");
  });

  it("home prints one line outside a repository", async () => {
    const { code, out } = await cli([], fixture.deps({ cwd: mkdtempSync(join(tmpdir(), "mergeq-empty-")) }));
    expect(code).toBe(0);
    expect(out.trim().split("\n")).toHaveLength(1);
  });

  it("home combines the cached analysis with live counts", async () => {
    await cli(["status", "acme/shop"], fixture.deps());
    const cwd = cloneWithOrigin("git@github.com:acme/shop.git");
    const { code, out } = await cli([], fixture.deps({ cwd }));
    expect(code).toBe(0);
    expect(out).toContain("open: 5");
    expect(out).toContain("checks_and_review_ok: 3");
    expect(out).toContain("conflicting: 3");
    expect(out).toContain("analysis: 0s ago");
    expect(out).toContain("next[3]{position,number,title,note}:");
  });

  it("home falls back to the cache when the host does not answer", async () => {
    await cli(["status", "acme/shop"], fixture.deps());
    const cwd = cloneWithOrigin("https://github.com/acme/shop.git");
    const slow = { ...fixture.adapter, listOpenPullRequests: () => Promise.reject(new Error("timeout")) };
    const { out } = await cli([], fixture.deps({ cwd, adapterFor: async () => slow }));
    expect(out).toContain("open: 5\nsource: cache (GitHub did not answer in time)");
  });

  it("home prints one install line and exits 0 when gh is missing", async () => {
    const cwd = cloneWithOrigin("https://github.com/acme/shop.git");
    const noGh = { ...fixture.adapter, listOpenPullRequests: () => Promise.reject(ghRequired()) };
    const { code, out } = await cli([], fixture.deps({ cwd, adapterFor: async () => noGh }));
    expect(code).toBe(0);
    expect(out).toBe("mergeq: needs the GitHub CLI. Install the GitHub CLI: https://cli.github.com, then run `gh auth login`\n");
  });

  it("status reports a missing gh as GH_REQUIRED", async () => {
    const { code, out } = await cli(["status", "acme/shop"], fixture.deps({ adapterFor: async () => Promise.reject(ghRequired()) }));
    expect(code).toBe(1);
    expect(out).toContain("code: GH_REQUIRED");
    expect(out).toContain("Install the GitHub CLI: https://cli.github.com");
  });
});
