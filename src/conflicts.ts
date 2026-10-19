import { git } from "./git.js";

export interface MergeCheck {
  conflict: boolean;
  files: string[];
  tree: string;
}

const IDENTITY = {
  GIT_AUTHOR_NAME: "mergeq",
  GIT_AUTHOR_EMAIL: "mergeq@localhost",
  GIT_COMMITTER_NAME: "mergeq",
  GIT_COMMITTER_EMAIL: "mergeq@localhost",
};

// Exit 0 is a clean merge, exit 1 a conflicted one; the first line is the result tree either way.
export async function checkMerge(dir: string, ours: string, theirs: string): Promise<MergeCheck> {
  const result = await git(["merge-tree", "--write-tree", "--name-only", "--no-messages", ours, theirs], {
    cwd: dir,
    allowCodes: [1],
  });
  const [tree = "", ...files] = result.stdout.split("\n").filter(Boolean);
  return { conflict: result.code === 1, files, tree };
}

// Records "base with this PR merged" as a commit so the next PR can be merged on top of it.
export async function mergedCommit(dir: string, tree: string, base: string, head: string): Promise<string> {
  const result = await git(["commit-tree", tree, "-p", base, "-p", head, "-m", "mergeq simulation"], {
    cwd: dir,
    env: IDENTITY,
  });
  return result.stdout.trim();
}

export interface FileStat {
  path: string;
  additions: number;
  deletions: number;
}

// Binary files report "-" in numstat; they count as zero lines.
export async function changedFiles(dir: string, base: string, head: string): Promise<FileStat[]> {
  const result = await git(["diff", "--numstat", "-z", "--no-renames", `${base}...${head}`], { cwd: dir });
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [additions = "", deletions = "", ...path] = line.split("\t");
      return { path: path.join("\t"), additions: Number(additions) || 0, deletions: Number(deletions) || 0 };
    });
}
