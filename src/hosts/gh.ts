import { execFile } from "node:child_process";
import { CliError } from "../errors.js";

export interface GhResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type GhRunner = (args: string[], options?: { timeoutMs?: number }) => Promise<GhResult>;

export const GH_INSTALL_HINT = "Install the GitHub CLI: https://cli.github.com";

export function ghRequired(): CliError {
  return new CliError("mergeq needs the GitHub CLI (gh) on PATH", "GH_REQUIRED", [
    GH_INSTALL_HINT,
    "Then run `gh auth login`",
  ]);
}

// Resolves with the exit code instead of rejecting, so callers can map gh's own error messages.
export function createGhRunner(env: NodeJS.ProcessEnv): GhRunner {
  return (args, options = {}) =>
    new Promise((resolve, reject) => {
      execFile(
        "gh",
        args,
        {
          timeout: options.timeoutMs ?? 30_000,
          maxBuffer: 64 * 1024 * 1024,
          env: { ...env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" },
        },
        (error, stdout, stderr) => {
          if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
            reject(ghRequired());
            return;
          }
          const code = !error ? 0 : typeof error.code === "number" ? error.code : error.killed ? 124 : 1;
          resolve({ stdout, stderr, code });
        },
      );
    });
}
