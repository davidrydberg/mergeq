import { execFile } from "node:child_process";

export interface GitOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  allowFailure?: boolean;
  allowCodes?: number[];
}

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function git(args: string[], options: GitOptions = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 60_000,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...options.env },
      },
      (error, stdout, stderr) => {
        const code = error ? exitCode(error) : 0;
        if (code === 0 || options.allowFailure || options.allowCodes?.includes(code)) {
          resolve({ stdout, stderr, code });
          return;
        }
        reject(new Error(`git ${args[0]} failed (${code}): ${stderr.trim() || error?.message}`));
      },
    );
  });
}

function exitCode(error: Error & { code?: unknown; killed?: boolean }): number {
  if (typeof error.code === "number") {
    return error.code;
  }
  return error.killed ? 124 : 1;
}
