import {
  findHostedConfigIncompatibility,
  formatHostedConfigIncompatibility,
} from "./hosted-compatibility.ts";
import * as publicConfig from "./index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("veryfront/config public exports", () => {
  it("exposes hosted compatibility checks to CLI consumers", () => {
    assertEquals(
      publicConfig.findHostedConfigIncompatibility,
      findHostedConfigIncompatibility,
    );
    assertEquals(
      publicConfig.formatHostedConfigIncompatibility,
      formatHostedConfigIncompatibility,
    );
  });
});
