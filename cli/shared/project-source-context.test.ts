import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { getProxyProjectSourceContext } from "./project-source-context.ts";

const ENV_KEYS = [
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_ID",
  "VERYFRONT_BRANCH_REF",
  "TENANT_BRANCH_ID",
];

describe("getProxyProjectSourceContext", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) {
      Deno.env.delete(key);
    }
  });

  it("uses VERYFRONT_BRANCH_REF when it is set", () => {
    Deno.env.set("VERYFRONT_PROJECT_SLUG", "example-project");
    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_PROJECT_ID", "project-id");
    Deno.env.set("VERYFRONT_BRANCH_REF", "preview");
    Deno.env.set("TENANT_BRANCH_ID", "branch-id");

    assertEquals(getProxyProjectSourceContext(), {
      projectSlug: "example-project",
      token: "test-token",
      projectId: "project-id",
      branchRef: "preview",
    });
  });

  it("uses TENANT_BRANCH_ID when VERYFRONT_BRANCH_REF is not set", () => {
    Deno.env.set("VERYFRONT_PROJECT_SLUG", "example-project");
    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("TENANT_BRANCH_ID", "branch-id");

    assertEquals(getProxyProjectSourceContext(), {
      projectSlug: "example-project",
      token: "test-token",
      projectId: undefined,
      branchRef: "branch-id",
    });
  });
});
