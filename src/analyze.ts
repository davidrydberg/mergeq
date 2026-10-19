import { ensureMirror, fetchRefs } from "./cache.js";
import { changedFiles, checkMerge, mergedCommit, type FileStat } from "./conflicts.js";
import type { HostAdapter, PullRequest } from "./hosts/host.js";
import { planOrder, type BlockedItem, type OrderItem } from "./order.js";
import { repoSlug, type RepoRef } from "./repo.js";

export interface PrAnalysis extends PullRequest {
  files: string[];
  fileStats: FileStat[];
  areas: string[];
  conflictsBase: boolean;
  baseConflictFiles: string[];
  conflictsWith: number[];
}

export interface ConflictPair {
  a: number;
  b: number;
  files: string[];
}

export interface RepoAnalysis {
  repo: string;
  base: string | null;
  total: number;
  analyzedAt: string;
  prs: PrAnalysis[];
  pairs: ConflictPair[];
  order: OrderItem[];
  blocked: BlockedItem[];
}

export interface AnalyzeOptions {
  adapter: HostAdapter;
  cacheRoot: string;
  cwd: string;
  limit: number;
  base?: string;
  now?: () => Date;
}

const CONCURRENCY = 8;

export async function analyzeRepo(repo: RepoRef, options: AnalyzeOptions): Promise<RepoAnalysis> {
  const { adapter } = options;
  const listOptions = options.base === undefined ? { limit: options.limit } : { limit: options.limit, base: options.base };
  const page = await adapter.listOpenPullRequests(repo, listOptions);
  const analyzedAt = (options.now?.() ?? new Date()).toISOString();
  if (page.prs.length === 0) {
    return { repo: repoSlug(repo), base: options.base ?? null, total: page.total, analyzedAt, prs: [], pairs: [], order: [], blocked: [] };
  }

  const dir = await ensureMirror(options.cacheRoot, repo, adapter, options.cwd);
  const bases = [...new Set(page.prs.map((pr) => pr.base))];
  await fetchRefs(dir, adapter, [
    ...bases.map((base) => `+refs/heads/${base}:${baseRef(base)}`),
    ...page.prs.map((pr) => `+${adapter.pullHeadRef(pr.number)}:${pullRef(pr.number)}`),
  ]);

  const trees = new Map<number, string>();
  const prs = await mapLimit(page.prs, CONCURRENCY, async (pr): Promise<PrAnalysis> => {
    const [fileStats, check] = await Promise.all([
      changedFiles(dir, baseRef(pr.base), pullRef(pr.number)),
      checkMerge(dir, baseRef(pr.base), pullRef(pr.number)),
    ]);
    trees.set(pr.number, check.tree);
    const files = fileStats.map((file) => file.path);
    return {
      ...pr,
      files,
      fileStats,
      areas: topAreas(files),
      conflictsBase: check.conflict,
      baseConflictFiles: check.conflict ? check.files : [],
      conflictsWith: [],
    };
  });

  const pairs = await findPairs(dir, prs, trees);
  for (const pair of pairs) {
    prs.find((pr) => pr.number === pair.a)?.conflictsWith.push(pair.b);
    prs.find((pr) => pr.number === pair.b)?.conflictsWith.push(pair.a);
  }
  for (const pr of prs) {
    pr.conflictsWith.sort((a, b) => a - b);
  }
  const plan = planOrder(prs);
  return {
    repo: repoSlug(repo),
    base: options.base ?? null,
    total: page.total,
    analyzedAt,
    prs,
    pairs,
    order: plan.order,
    blocked: plan.blocked,
  };
}

// Only PRs on the same base that both merge cleanly and touch a shared path can conflict textually.
async function findPairs(dir: string, prs: PrAnalysis[], trees: Map<number, string>): Promise<ConflictPair[]> {
  const clean = prs.filter((pr) => !pr.conflictsBase);
  const candidates: Array<[PrAnalysis, PrAnalysis]> = [];
  for (let i = 0; i < clean.length; i++) {
    for (let j = i + 1; j < clean.length; j++) {
      const a = clean[i];
      const b = clean[j];
      if (a && b && a.base === b.base && overlaps(a.files, b.files)) {
        const [first, second] = a.number < b.number ? [a, b] : [b, a];
        candidates.push([first, second]);
      }
    }
  }
  const merged = new Map<number, Promise<string>>();
  const mergedFor = (pr: PrAnalysis): Promise<string> => {
    let commit = merged.get(pr.number);
    if (!commit) {
      commit = mergedCommit(dir, trees.get(pr.number) ?? "", baseRef(pr.base), pullRef(pr.number));
      merged.set(pr.number, commit);
    }
    return commit;
  };
  const results = await mapLimit(candidates, CONCURRENCY, async ([a, b]) => {
    const check = await checkMerge(dir, await mergedFor(a), pullRef(b.number));
    return check.conflict ? { a: a.number, b: b.number, files: check.files } : undefined;
  });
  return results.filter((pair): pair is ConflictPair => pair !== undefined).sort((x, y) => x.a - y.a || x.b - y.b);
}

function overlaps(a: string[], b: string[]): boolean {
  const set = new Set(a);
  return b.some((file) => set.has(file));
}

export function topAreas(files: string[], max = 3): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const slash = file.indexOf("/");
    const area = slash === -1 ? "(root)" : file.slice(0, slash);
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([area]) => area);
}

function baseRef(base: string): string {
  return `refs/mergeq/base/${base}`;
}

function pullRef(number: number): string {
  return `refs/mergeq/pull/${number}`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}
