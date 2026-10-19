import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { git } from "./git.js";
import type { HostAdapter } from "./hosts/host.js";
import { originRepo, repoSlug, type RepoRef } from "./repo.js";

export function cacheRoot(env: NodeJS.ProcessEnv): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "mergeq");
}

export function mirrorDir(root: string, repo: RepoRef): string {
  return join(root, repo.host, repo.owner, `${repo.name}.git`);
}

export function snapshotPath(root: string, repo: RepoRef): string {
  return join(root, repo.host, repo.owner, `${repo.name}.status.json`);
}

// A bare mirror owned by mergeq, so the user's own clones and worktrees are never touched.
export async function ensureMirror(root: string, repo: RepoRef, adapter: HostAdapter, cwd: string): Promise<string> {
  const dir = mirrorDir(root, repo);
  if (existsSync(join(dir, "HEAD"))) {
    return dir;
  }
  await mkdir(dirname(dir), { recursive: true });
  const reference = await localReference(repo, cwd);
  const args = [...adapter.gitArgs(), "clone", "--bare", "--quiet", "--no-tags"];
  if (reference) {
    args.push("--reference-if-able", reference, "--dissociate");
  }
  args.push(adapter.cloneUrl(repo), dir);
  await git(args, { timeoutMs: 600_000 });
  return dir;
}

export async function fetchRefs(dir: string, adapter: HostAdapter, refspecs: string[]): Promise<void> {
  if (refspecs.length === 0) {
    return;
  }
  await git([...adapter.gitArgs(), "fetch", "--quiet", "--no-tags", "--force", "origin", ...refspecs], {
    cwd: dir,
    timeoutMs: 300_000,
  });
}

export async function readSnapshot<T>(root: string, repo: RepoRef): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(snapshotPath(root, repo), "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function writeSnapshot(root: string, repo: RepoRef, value: unknown): Promise<void> {
  const path = snapshotPath(root, repo);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, path);
}

async function localReference(repo: RepoRef, cwd: string): Promise<string | undefined> {
  const origin = await originRepo(cwd);
  if (!origin || repoSlug(origin) !== repoSlug(repo)) {
    return undefined;
  }
  const result = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    timeoutMs: 3000,
    allowFailure: true,
  });
  return result.code === 0 ? result.stdout.trim() : undefined;
}
