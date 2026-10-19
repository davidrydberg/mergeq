#!/usr/bin/env node
import { cacheRoot } from "../cache.js";
import { runCli } from "../cli.js";
import { createGhRunner } from "../hosts/gh.js";
import { adapterFor } from "../hosts/index.js";

const gh = createGhRunner(process.env);

process.exitCode = await runCli(
  process.argv.slice(2),
  {
    cwd: process.cwd(),
    env: process.env,
    cacheRoot: cacheRoot(process.env),
    now: () => new Date(),
    adapterFor: (repo) => adapterFor(repo, gh),
  },
  { write: (text) => process.stdout.write(text), isTTY: process.stdout.isTTY === true, columns: process.stdout.columns },
);
