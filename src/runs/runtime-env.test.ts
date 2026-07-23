import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildTaskContextEnv,
  INJECTED_TASK_ENV_JSON,
  mergeInjectedWorkflowEnv,
  readInjectedProjectEnv,
} from "./runtime-env.ts";

describe("runs/runtime-env", () => {
  it("returns an empty object when injected env JSON is missing", () => {
    assertEquals(readInjectedProjectEnv({}), {});
  });

  it("fails closed when injected env JSON is malformed", () => {
    assertThrows(
      () => readInjectedProjectEnv({ [INJECTED_TASK_ENV_JSON]: "not-json" }),
      Error,
      "must contain a JSON object",
    );
    assertThrows(
      () => readInjectedProjectEnv({ [INJECTED_TASK_ENV_JSON]: "[]" }),
      Error,
      "must contain a JSON object",
    );
    assertThrows(
      () =>
        readInjectedProjectEnv({
          [INJECTED_TASK_ENV_JSON]: JSON.stringify({ INVALID_VALUE: 42 }),
        }),
      Error,
      "must be strings",
    );
    assertThrows(
      () =>
        readInjectedProjectEnv({
          [INJECTED_TASK_ENV_JSON]: "x".repeat(1_048_577),
        }),
      Error,
      "exceeds",
    );
  });

  it("filters unsafe and reserved injected env keys", () => {
    assertEquals(
      readInjectedProjectEnv({
        [INJECTED_TASK_ENV_JSON]:
          '{"SAFE_VALUE":"ok","VERYFRONT_API_TOKEN":"secret","VERYFRONT_AGENT_SERVICE_KEY":"service-secret","veryfront_proxy_api_client_secret":"proxy-secret","TENANT_SECRET":"tenant-secret","__proto__":"polluted"}',
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

  it("rejects invalid allowlists and ignores invalid runtime environment names", () => {
    assertThrows(
      () => buildTaskContextEnv({ SAFE: "value" }, ["BAD-NAME"]),
      Error,
      "environment variable name",
    );
    assertEquals(buildTaskContextEnv({ "BAD-NAME": "value" }), {});
  });

  it("rejects accessor-backed runtime environments without invoking them", () => {
    let reads = 0;
    const environment = {} as Record<string, string>;
    Object.defineProperty(environment, "SAFE", {
      enumerable: true,
      get() {
        reads += 1;
        return "value";
      },
    });

    assertThrows(
      () => buildTaskContextEnv(environment),
      Error,
      "must contain only enumerable data properties",
    );
    assertEquals(reads, 0);

    const injectedEnvironment = {} as Record<string, string>;
    Object.defineProperty(injectedEnvironment, INJECTED_TASK_ENV_JSON, {
      enumerable: true,
      get() {
        reads += 1;
        return '{"SAFE":"value"}';
      },
    });
    assertThrows(
      () => readInjectedProjectEnv(injectedEnvironment),
      Error,
      "must be a data property",
    );
    assertEquals(reads, 0);
  });

  it("ignores inherited injection and cannot pollute object prototypes", () => {
    const inherited = Object.create({ [INJECTED_TASK_ENV_JSON]: '{"INHERITED":"no"}' }) as Record<
      string,
      string
    >;
    assertEquals(readInjectedProjectEnv(inherited), {});

    const parsed = readInjectedProjectEnv({
      [INJECTED_TASK_ENV_JSON]:
        '{"SAFE":"yes","__proto__":{"polluted":"yes"},"constructor":"blocked"}',
    });
    assertEquals(parsed, { SAFE: "yes" });
    assertEquals(({} as { polluted?: string }).polluted, undefined);
  });

  it("rejects oversized, NUL-containing, and excessive environment values", () => {
    assertThrows(
      () => buildTaskContextEnv({ SAFE: "value\0suffix" }),
      Error,
      "invalid or oversized value",
    );
    assertThrows(
      () =>
        readInjectedProjectEnv({
          [INJECTED_TASK_ENV_JSON]: JSON.stringify({ SAFE: "x".repeat(1_048_577) }),
        }),
      Error,
      "exceeds",
    );
  });
});
