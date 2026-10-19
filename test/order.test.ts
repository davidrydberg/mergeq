import { describe, expect, it } from "vitest";
import { planOrder, type OrderInput } from "../src/order.js";

const pr = (number: number, extra: Partial<OrderInput> = {}): OrderInput => ({
  number,
  title: `PR ${number}`,
  base: "main",
  draft: false,
  checks: "passing",
  review: "none",
  additions: 10,
  deletions: 0,
  createdAt: "2026-10-01T00:00:00Z",
  conflictsBase: false,
  conflictsWith: [],
  ...extra,
});

describe("planOrder", () => {
  it("puts ready PRs before waiting ones", () => {
    const plan = planOrder([pr(1, { review: "required" }), pr(2)]);
    expect(plan.order.map((item) => item.number)).toEqual([2, 1]);
    expect(plan.order[1]?.note).toBe("waiting: review required");
  });

  it("prefers fewer conflict partners, then smaller, then older", () => {
    const plan = planOrder([
      pr(1, { conflictsWith: [2] }),
      pr(2, { conflictsWith: [1] }),
      pr(3, { additions: 500 }),
      pr(4, { createdAt: "2026-09-01T00:00:00Z", additions: 500 }),
    ]);
    expect(plan.order.map((item) => item.number)).toEqual([4, 3, 1, 2]);
    expect(plan.order[3]?.note).toBe("ready; rebase after #1");
  });

  it("blocks drafts, base conflicts, failing checks and requested changes with every reason", () => {
    const plan = planOrder([
      pr(1, { draft: true, checks: "failing" }),
      pr(2, { conflictsBase: true }),
      pr(3, { review: "changes" }),
    ]);
    expect(plan.order).toEqual([]);
    expect(plan.blocked.map((item) => item.reason)).toEqual([
      "draft, checks failing",
      "conflicts with main",
      "changes requested",
    ]);
  });
});
