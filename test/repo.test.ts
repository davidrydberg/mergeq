import { describe, expect, it } from "vitest";
import { CliError } from "../src/errors.js";
import { parseRepoSpec } from "../src/repo.js";

describe("parseRepoSpec", () => {
  const shop = { host: "github.com", owner: "acme", name: "shop" };

  it.each([
    "acme/shop",
    "github.com/acme/shop",
    "https://github.com/acme/shop",
    "https://github.com/acme/shop.git",
    "https://user@github.com/acme/shop.git",
    "git@github.com:acme/shop.git",
    "ssh://git@github.com/acme/shop.git",
    "ssh://git@github.com:22/acme/shop",
  ])("reads %s", (spec) => {
    expect(parseRepoSpec(spec)).toEqual(shop);
  });

  it("keeps other hosts", () => {
    expect(parseRepoSpec("git@gitlab.example.com:team/app.git")).toEqual({
      host: "gitlab.example.com",
      owner: "team",
      name: "app",
    });
  });

  it("rejects specs it cannot read", () => {
    expect(() => parseRepoSpec("shop")).toThrow(CliError);
  });
});
