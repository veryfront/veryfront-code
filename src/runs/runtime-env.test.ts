import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildTaskContextEnv,
  INJECTED_TASK_ENV_JSON,
  MAX_INJECTED_TASK_ENV_JSON_BYTES,
  mergeInjectedWorkflowEnv,
  readInjectedProjectEnv,
} from "./runtime-env.ts";

describe("runs/runtime-env", () => {
  it("returns an empty object only when injected env JSON is missing", () => {
    assertEquals(readInjectedProjectEnv({}), {});
  });

  it("fails closed when injected env JSON is malformed or not a string map", () => {
    for (
      const raw of [
        "not-json",
        "[]",
        "null",
        '{"SAFE_VALUE":123}',
        '{"INVALID-NAME":"value"}',
      ]
    ) {
      assertThrows(
        () => readInjectedProjectEnv({ [INJECTED_TASK_ENV_JSON]: raw }),
        TypeError,
        INJECTED_TASK_ENV_JSON,
      );
    }
  });

  it("rejects injected env JSON above the bounded platform payload limit", () => {
    const oversized = `{"VALUE":"${"x".repeat(MAX_INJECTED_TASK_ENV_JSON_BYTES)}"}`;
    assertThrows(
      () => readInjectedProjectEnv({ [INJECTED_TASK_ENV_JSON]: oversized }),
      RangeError,
      "exceeds",
    );
  });

  it("filters unsafe and all framework or tenant control env keys", () => {
    assertEquals(
      readInjectedProjectEnv({
        [INJECTED_TASK_ENV_JSON]:
          '{"SAFE_VALUE":"ok","VERYFRONT_API_TOKEN":"secret","VERYFRONT_PROXY_API_CLIENT_SECRET":"proxy-secret","veryfront_release_app_private_key":"private-key","TENANT_SECRET":"tenant-secret","tenant_token":"tenant-token","__proto__":"polluted"}',
      }),
      {
        SAFE_VALUE: "ok",
      },
    );
  });

  it("builds task context env from visible and allowlisted injected values", () => {
    assertEquals(
      buildTaskContextEnv(
        {
          PUBLIC_VALUE: "existing",
          OVERRIDDEN_VALUE: "existing",
          VERYFRONT_API_TOKEN: "secret",
          TENANT_SECRET: "tenant-secret",
          [INJECTED_TASK_ENV_JSON]: JSON.stringify({
            OVERRIDDEN_VALUE: "injected",
            ALLOWED_INJECTED: "yes",
            VERYFRONT_PROJECT_ID: "hidden",
          }),
        },
        ["PUBLIC_VALUE", "OVERRIDDEN_VALUE", "ALLOWED_INJECTED"],
      ),
      {
        PUBLIC_VALUE: "existing",
        OVERRIDDEN_VALUE: "injected",
        ALLOWED_INJECTED: "yes",
      },
    );
  });

  it("never exposes framework or tenant host variables through task context", () => {
    assertEquals(
      buildTaskContextEnv({
        PUBLIC_VALUE: "visible",
        VERYFRONT_PROXY_API_CLIENT_SECRET: "proxy-secret",
        VERYFRONT_RELEASE_APP_PRIVATE_KEY: "private-key",
        veryfront_api_token: "case-insensitive-control-secret",
        TENANT_TOKEN: "tenant-token",
        tenant_project_id: "tenant-project",
      }),
      {
        PUBLIC_VALUE: "visible",
      },
    );
  });

  it("merges existing workflow env with filtered injected values", () => {
    assertEquals(
      mergeInjectedWorkflowEnv(
        {
          SAFE_EXISTING: "keep",
          OVERRIDDEN_VALUE: "existing",
          VERYFRONT_API_URL: "https://secret.test",
          TENANT_SECRET: "tenant-secret",
        },
        {
          [INJECTED_TASK_ENV_JSON]: JSON.stringify({
            OVERRIDDEN_VALUE: "injected",
            SAFE_INJECTED: "added",
            VERYFRONT_API_TOKEN: "secret",
          }),
        },
      ),
      {
        SAFE_EXISTING: "keep",
        OVERRIDDEN_VALUE: "injected",
        SAFE_INJECTED: "added",
      },
    );
  });

  it("returns undefined when no safe workflow env remains", () => {
    assertEquals(
      mergeInjectedWorkflowEnv(
        {
          VERYFRONT_API_URL: "https://secret.test",
          VERYFRONT_API_TOKEN: "secret",
        },
        {
          [INJECTED_TASK_ENV_JSON]: JSON.stringify({
            VERYFRONT_PROJECT_ID: "hidden",
          }),
        },
      ),
      undefined,
    );
  });
});
