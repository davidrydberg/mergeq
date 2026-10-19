import { CliError } from "./errors.js";
import { git } from "./git.js";

export interface RepoRef {
  host: string;
  owner: string;
  name: string;
}

export function repoSlug(repo: RepoRef): string {
  return `${repo.host}/${repo.owner}/${repo.name}`;
}

export function parseRepoSpec(spec: string): RepoRef {
  const trimmed = spec.trim();
  const path = remotePath(trimmed);
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 2 && !trimmed.includes("://") && !trimmed.includes("@")) {
    return toRef("github.com", segments[0], segments[1], spec);
  }
  if (segments.length === 3) {
    return toRef(segments[0], segments[1], segments[2], spec);
  }
  throw new CliError(`Cannot read "${spec}" as a repository`, "VALIDATION_ERROR", [
    "Use owner/repo, host/owner/repo, or a clone URL",
  ]);
}

export async function originRepo(cwd: string): Promise<RepoRef | undefined> {
  const result = await git(["remote", "get-url", "origin"], { cwd, timeoutMs: 3000, allowFailure: true });
  if (result.code !== 0) {
    return undefined;
  }
  try {
    return parseRepoSpec(result.stdout.trim());
  } catch {
    return undefined;
  }
}

// Reduces https, ssh and scp-style URLs to "host/owner/repo" (or "owner/repo" for shorthand).
function remotePath(spec: string): string {
  let rest = spec;
  const scheme = rest.match(/^[a-z][a-z0-9+.-]*:\/\//i);
  if (scheme) {
    rest = rest.slice(scheme[0].length);
    rest = rest.replace(/^[^@/]*@/, "");
    rest = rest.replace(/^([^/:]+):\d+\//, "$1/");
  } else {
    const scp = rest.match(/^[^@/]+@([^:/]+):(.+)$/);
    if (scp) {
      rest = `${scp[1]}/${scp[2]}`;
    }
  }
  return rest.replace(/\/+$/, "").replace(/\.git$/, "");
}

function toRef(host: string | undefined, owner: string | undefined, name: string | undefined, spec: string): RepoRef {
  if (!host || !owner || !name) {
    throw new CliError(`Cannot read "${spec}" as a repository`, "VALIDATION_ERROR");
  }
  return { host: host.toLowerCase(), owner, name };
}
