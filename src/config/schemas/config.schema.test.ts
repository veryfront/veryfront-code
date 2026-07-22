import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findUnknownTopLevelKeys, validateVeryfrontConfig } from "./config.schema.ts";

describe("configSchema", () => {
  it("validates valid config and finds unknown keys", () => {
    const cfg = validateVeryfrontConfig({
      router: "app",
      security: { cors: true, remoteHosts: ["https://esm.sh"] },
    });

    assertEquals(cfg.router, "app");
    assertEquals(findUnknownTopLevelKeys({ foo: 1, router: "pages" }), ["foo"]);
  });

  it("accepts build.ssg as a boolean", () => {
    const enabled = validateVeryfrontConfig({ build: { ssg: true } });
    assertEquals(enabled.build?.ssg, true);

    const disabled = validateVeryfrontConfig({ build: { ssg: false } });
    assertEquals(disabled.build?.ssg, false);

    const omitted = validateVeryfrontConfig({ build: {} });
    assertEquals(omitted.build?.ssg, undefined);
  });

  it("rejects non-boolean build.ssg", () => {
    assertThrows(
      () => validateVeryfrontConfig({ build: { ssg: "yes" } }),
      Error,
      "Invalid veryfront.config at build.ssg:",
    );
  });

  it("gives helpful error for invalid cors", () => {
    assertThrows(
      () => validateVeryfrontConfig({ security: { cors: { origin: 123 } } }),
      Error,
      "Invalid veryfront.config at security.cors:",
    );
  });

  it("accepts only the canonical source integration narrowing policy", () => {
    const cfg = validateVeryfrontConfig({
      integrations: {
        allow: {
          confluence: {},
          github: { allowedTools: ["list_repos"] },
        },
      },
    });

    assertEquals(cfg.integrations, {
      allow: {
        confluence: {},
        github: { allowedTools: ["list_repos"] },
      },
    });
    assertThrows(
      () =>
        validateVeryfrontConfig({
          integrations: {
            github: { tools: ["list_repos"], scope: "user" },
          },
        }),
      Error,
      "Invalid veryfront.config at integrations.allow:",
    );
    assertThrows(
      () =>
        validateVeryfrontConfig({
          integrations: {
            allow: {
              github: { allowedTools: ["list_repos"], scope: "user" },
            },
          },
        }),
      Error,
      "Invalid veryfront.config at integrations.allow.github:",
    );
    assertThrows(
      () =>
        validateVeryfrontConfig({
          integrations: {
            allow: { GitHub: {} },
          },
        }),
      Error,
      "Invalid veryfront.config at integrations.allow.GitHub: Invalid key in record.",
    );
    assertThrows(
      () =>
        validateVeryfrontConfig({
          integrations: {
            allow: { github: { allowedTools: ["github__list_repos"] } },
          },
        }),
      Error,
      "Expected a canonical connector-local tool ID",
    );
  });
});
