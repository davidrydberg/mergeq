import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import type { Deps } from "../src/deps.js";
import { stripAnsi } from "../src/style.js";
import { buildFixture } from "./fixture.js";

async function cli(argv: string[], deps: Deps, tty: boolean, columns = 80): Promise<string> {
  let out = "";
  await runCli(argv, deps, {
    write: (text) => {
      out += text;
    },
    isTTY: tty,
    columns,
  });
  return out;
}

describe("human view", () => {
  const fixture = buildFixture();
  const plain = () => fixture.deps({ env: { NO_COLOR: "1" } });

  it("renders status with order, reasons, blocked PRs, conflicts and next steps", async () => {
    const out = await cli(["status", "acme/shop"], plain(), true);
    expect(out).toContain("acme/shop  5 open PRs\n2 ready  1 waiting  2 blocked  1 conflict pair");
    expect(out).toContain("MERGE ORDER\n   1  #1  PR 1");
    expect(out).toContain("\u2713 2 passing  review approved  base main  updated 9d ago");
    expect(out).toContain("! conflicts with #2, which merges later  ahead of #2 (older)");
    expect(out).toContain("! rebase after #1 (both touch a.txt)  ahead of #3 (ready)");
    expect(out).toContain("\u2022 1 pending \u2713 1 passing  review none");
    expect(out).toContain("\u2713 no conflicts  behind #2 (still waiting)");
    expect(out).toContain("BLOCKED");
    expect(out).toContain("\u2717 conflicts with main");
    expect(out).toContain("files: d.txt");
    expect(out).toContain("CONFLICTS\n  #1 <-> #2   a.txt");
    expect(out).toContain("NEXT\n  mergeq pr 2           see why #2 needs a rebase");
    expect(out).not.toContain("\u001b[");
  });

  it("keeps every line within the terminal width", async () => {
    const out = await cli(["status", "acme/shop"], plain(), true, 60);
    for (const line of out.split("\n")) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(60);
    }
  });

  it("renders one PR with files, conflicts and its place in the order", async () => {
    const out = await cli(["pr", "2", "--repo", "acme/shop"], plain(), true);
    expect(out).toContain("#2  PR 2\nhttps://example.test/pull/2\ndev  opened 18d ago  updated 8d ago  feature-2 -> main");
    expect(out).toContain("  order    2 of 3  ! rebase after #1 (both touch a.txt)");
    expect(out).toContain("  base main  \u2713 merges cleanly\n  #1         ! a.txt");
    expect(out).toContain("FILES (1)\n  +1 -1  a.txt");
  });

  it("colors only when allowed", async () => {
    expect(await cli(["status", "acme/shop"], fixture.deps({ env: {} }), true)).toContain("\u001b[32m");
    expect(await cli(["status", "acme/shop", "--pretty"], fixture.deps({ env: {} }), false)).not.toContain("\u001b[");
    expect(await cli(["status", "acme/shop", "--pretty"], fixture.deps({ env: { FORCE_COLOR: "1" } }), false)).toContain("\u001b[");
  });

  it("uses TOON when piped or asked for, and the human view on a terminal or when asked for", async () => {
    expect(await cli(["status", "acme/shop"], plain(), false)).toContain("prs[5]{number,title");
    expect(await cli(["status", "acme/shop", "--toon"], plain(), true)).toContain("prs[5]{number,title");
    expect(await cli(["status", "acme/shop", "--pretty"], plain(), false)).toContain("MERGE ORDER");
    expect(JSON.parse(await cli(["status", "acme/shop", "--json"], plain(), true))).toHaveProperty("pairs");
  });

  it("prints readable help on a terminal and TOON help when piped", async () => {
    for (const argv of [["--help"], ["-h"], ["help"]]) {
      const out = await cli(argv, plain(), true);
      expect(out).toContain("COMMANDS\n");
      expect(out).toContain("EXAMPLES\n");
      expect(out).toContain("mergeq status owner/repo other/repo --base main");
    }
    expect(await cli(["status", "--help"], plain(), true)).toContain("FLAGS\n  --base <branch>");
    expect(await cli(["pr", "--help"], plain(), true)).toContain("mergeq pr 42 --repo owner/repo");
    expect(await cli(["--help"], plain(), false)).toContain("commands[3]:");
  });

  it("renders errors for people on a terminal", async () => {
    const out = await cli(["pr", "99", "--repo", "acme/shop"], plain(), true);
    expect(out).toContain("\u2717 PR #99 is not open");
    expect(out).toContain("(NOT_FOUND)");
  });
});
