import { describe, expect, it } from "vitest";
import { analyzeRepo, topAreas } from "../src/analyze.js";
import { buildFixture } from "./fixture.js";

describe("analyzeRepo", () => {
  const fixture = buildFixture();
  const analysis = analyzeRepo(fixture.repo, {
    adapter: fixture.adapter,
    cacheRoot: fixture.cacheRoot,
    cwd: fixture.root,
    limit: 30,
    now: () => new Date("2026-10-19T12:00:00Z"),
  });

  it("finds the PR that conflicts with its base and the files involved", async () => {
    const result = await analysis;
    const pr5 = result.prs.find((pr) => pr.number === 5);
    expect(pr5?.conflictsBase).toBe(true);
    expect(pr5?.baseConflictFiles).toEqual(["d.txt"]);
    expect(result.prs.filter((pr) => pr.conflictsBase).map((pr) => pr.number)).toEqual([5]);
  });

  it("finds PRs that conflict with each other but not with the base", async () => {
    const result = await analysis;
    expect(result.pairs).toEqual([{ a: 1, b: 2, files: ["a.txt"] }]);
    expect(result.prs.find((pr) => pr.number === 2)?.conflictsWith).toEqual([1]);
    expect(result.prs.find((pr) => pr.number === 3)?.conflictsWith).toEqual([]);
  });

  it("lists the files each PR changes", async () => {
    const result = await analysis;
    expect(result.prs.find((pr) => pr.number === 4)?.files).toEqual(["src/c.ts"]);
    expect(result.prs.find((pr) => pr.number === 4)?.areas).toEqual(["src"]);
  });

  it("orders mergeable PRs and blocks the rest", async () => {
    const result = await analysis;
    expect(result.order.map((item) => [item.number, item.note])).toEqual([
      [1, "ready"],
      [2, "ready; rebase after #1"],
      [3, "waiting: checks pending"],
    ]);
    expect(result.blocked).toEqual([
      { number: 4, title: "PR 4", reason: "draft" },
      { number: 5, title: "PR 5", reason: "conflicts with main" },
    ]);
  });

  it("reuses the mirror on a second run", async () => {
    await analysis;
    const again = await analyzeRepo(fixture.repo, {
      adapter: fixture.adapter,
      cacheRoot: fixture.cacheRoot,
      cwd: fixture.root,
      limit: 2,
    });
    expect(again.prs.map((pr) => pr.number)).toEqual([1, 2]);
    expect(again.total).toBe(5);
  });
});

describe("topAreas", () => {
  it("ranks top-level directories by number of files", () => {
    expect(topAreas(["src/a.ts", "src/b.ts", "docs/x.md", "README.md", "test/t.ts", "test/u.ts"])).toEqual([
      "src",
      "test",
      "(root)",
    ]);
  });
});
