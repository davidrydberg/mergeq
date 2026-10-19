import type { HostAdapter } from "./hosts/host.js";
import type { RepoRef } from "./repo.js";

export interface Deps {
  cwd: string;
  env: NodeJS.ProcessEnv;
  cacheRoot: string;
  now: () => Date;
  adapterFor: (repo: RepoRef) => Promise<HostAdapter>;
}
