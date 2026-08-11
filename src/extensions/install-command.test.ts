import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatInstallCommand } from "./install-command.ts";
import { getRecommendation } from "./recommendations.ts";

describe("extensions/install-command", () => {
  it("prefixes the npm registry for Deno, which otherwise resolves to JSR", () => {
    // `deno add @veryfront/ext-css-lightning` exits with
    // "@veryfront/ext-css-lightning is missing a prefix" because Deno reads an
    // unprefixed specifier as JSR, and jsr.io hosts no `@veryfront` scope.
    assertEquals(
      formatInstallCommand("@veryfront/ext-css-lightning", "deno"),
      "deno add npm:@veryfront/ext-css-lightning",
    );
  });

  it("uses the runtime's own client for Node and Bun", () => {
    assertEquals(
      formatInstallCommand("@veryfront/ext-css-lightning", "node"),
      "npm install @veryfront/ext-css-lightning",
    );
    assertEquals(
      formatInstallCommand("@veryfront/ext-css-lightning", "bun"),
      "bun add @veryfront/ext-css-lightning",
    );
  });

  it("falls back to npm for hosts without a native package client", () => {
    assertEquals(
      formatInstallCommand("@veryfront/ext-image-sharp", "cloudflare"),
      "npm install @veryfront/ext-image-sharp",
    );
    assertEquals(
      formatInstallCommand("@veryfront/ext-image-sharp", "unknown"),
      "npm install @veryfront/ext-image-sharp",
    );
  });

  it("never doubles an npm: prefix a recommendation already carries", () => {
    // `RedisRuntimeProvider` is recorded as `npm:@veryfront/ext-redis`, so a
    // caller that pasted the value straight into a command would emit
    // `npm install npm:@veryfront/ext-redis`.
    const recorded = getRecommendation("RedisRuntimeProvider");
    assertEquals(recorded, "npm:@veryfront/ext-redis");
    assertEquals(
      formatInstallCommand(recorded ?? "", "node"),
      "npm install @veryfront/ext-redis",
    );
    assertEquals(
      formatInstallCommand(recorded ?? "", "deno"),
      "deno add npm:@veryfront/ext-redis",
    );
  });
});
