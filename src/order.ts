import type { Checks, Review } from "./hosts/host.js";

export interface OrderInput {
  number: number;
  title: string;
  base: string;
  draft: boolean;
  checks: Checks;
  review: Review;
  additions: number;
  deletions: number;
  createdAt: string;
  conflictsBase: boolean;
  conflictsWith: number[];
}

export interface OrderItem {
  position: number;
  number: number;
  title: string;
  base: string;
  note: string;
  why: string;
  rebaseAfter: number[];
}

export interface BlockedItem {
  number: number;
  title: string;
  reason: string;
}

export interface Plan {
  order: OrderItem[];
  blocked: BlockedItem[];
}

export function planOrder(prs: OrderInput[]): Plan {
  const blocked: BlockedItem[] = [];
  const candidates: OrderInput[] = [];
  for (const pr of prs) {
    const reasons = blockReasons(pr);
    if (reasons.length > 0) {
      blocked.push({ number: pr.number, title: pr.title, reason: reasons.join(", ") });
    } else {
      candidates.push(pr);
    }
  }
  candidates.sort(compareCandidates);
  const placed = new Set<number>();
  const order = candidates.map((pr, index) => {
    const after = pr.conflictsWith.filter((other) => placed.has(other));
    placed.add(pr.number);
    return {
      position: index + 1,
      number: pr.number,
      title: pr.title,
      base: pr.base,
      note: noteFor(pr, after),
      why: whyHere(pr, candidates[index - 1], candidates[index + 1]),
      rebaseAfter: after,
    };
  });
  blocked.sort((a, b) => a.number - b.number);
  return { order, blocked };
}

function blockReasons(pr: OrderInput): string[] {
  const reasons: string[] = [];
  if (pr.draft) reasons.push("draft");
  if (pr.conflictsBase) reasons.push(`conflicts with ${pr.base}`);
  if (pr.checks === "failing") reasons.push("checks failing");
  if (pr.review === "changes") reasons.push("changes requested");
  return reasons;
}

function readiness(pr: OrderInput): number {
  const checksOk = pr.checks === "passing" || pr.checks === "none";
  const reviewOk = pr.review === "approved" || pr.review === "none";
  return checksOk && reviewOk ? 0 : 1;
}

function compareCandidates(a: OrderInput, b: OrderInput): number {
  return (
    readiness(a) - readiness(b) ||
    a.conflictsWith.length - b.conflictsWith.length ||
    a.additions + a.deletions - (b.additions + b.deletions) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.number - b.number
  );
}

function noteFor(pr: OrderInput, after: number[]): string {
  const notes: string[] = [];
  if (readiness(pr) === 0) {
    notes.push("ready");
  } else {
    const waiting: string[] = [];
    if (pr.checks === "pending") waiting.push("checks pending");
    if (pr.review === "required") waiting.push("review required");
    notes.push(`waiting: ${waiting.join(", ")}`);
  }
  if (after.length > 0) {
    notes.push(`rebase after ${after.map((n) => `#${n}`).join(" ")}`);
  }
  return notes.join("; ");
}

// Names the first sort key that separates this PR from its neighbour in the order.
function whyHere(pr: OrderInput, previous: OrderInput | undefined, next: OrderInput | undefined): string {
  if (next) {
    return `ahead of #${next.number} (${firstDifference(pr, next, ["ready", "fewer conflicts", "smaller", "older", "lower number"])})`;
  }
  if (previous) {
    return `behind #${previous.number} (${firstDifference(previous, pr, ["still waiting", "more conflicts", "larger", "newer", "higher number"])})`;
  }
  return "only mergeable PR";
}

function firstDifference(first: OrderInput, second: OrderInput, words: string[]): string {
  const pick = (index: number): string => words[index] ?? "";
  if (readiness(first) !== readiness(second)) return pick(0);
  if (first.conflictsWith.length !== second.conflictsWith.length) return pick(1);
  if (first.additions + first.deletions !== second.additions + second.deletions) return pick(2);
  if (first.createdAt !== second.createdAt) return pick(3);
  return pick(4);
}
