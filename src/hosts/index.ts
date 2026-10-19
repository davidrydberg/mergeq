import { CliError } from "../errors.js";
import type { RepoRef } from "../repo.js";
import type { GhRunner } from "./gh.js";
import { GitHubAdapter } from "./github.js";
import type { HostAdapter } from "./host.js";

// github.com is always GitHub; any other host counts as GitHub Enterprise once gh is logged in to it.
export async function adapterFor(repo: RepoRef, gh: GhRunner): Promise<HostAdapter> {
  if (repo.host === "github.com") {
    return new GitHubAdapter(repo.host, gh);
  }
  const status = await gh(["auth", "status", "--hostname", repo.host], { timeoutMs: 5000 });
  if (status.code === 0) {
    return new GitHubAdapter(repo.host, gh);
  }
  throw new CliError(`${repo.host} is not a GitHub host that gh is logged in to`, "UNSUPPORTED_HOST", [
    `If ${repo.host} is GitHub Enterprise, run \`gh auth login --hostname ${repo.host}\``,
    "Other git hosts are not supported yet",
  ]);
}
