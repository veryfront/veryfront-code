import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildTaskContextEnv,
  INJECTED_TASK_ENV_JSON,
  isReservedTaskEnvKey,
  mergeInjectedWorkflowEnv,
  readInjectedProjectEnv,
} from "./runtime-env.ts";

describe("runs/runtime-env", () => {
  it("returns an empty object when injected env JSON is missing or invalid", () => {
    assertEquals(readInjectedProjectEnv({}), {});
    assertEquals(readInjectedProjectEnv({ [INJECTED_TASK_ENV_JSON]: "not-json" }), {});
    assertEquals(readInjectedProjectEnv({ [INJECTED_TASK_ENV_JSON]: "[]" }), {});
  });

  it("filters unsafe and reserved injected env keys", () => {
    assertEquals(
      readInjectedProjectEnv({
        [INJECTED_TASK_ENV_JSON]:
          '{"SAFE_VALUE":"ok","VERYFRONT_API_TOKEN":"secret","VERYFRONT_PUBLIC_API_BASE_URL":"https://attacker.test","TENANT_SECRET":"tenant-secret","nonString":123,"__proto__":"polluted"}',
      }),
      {
        SAFE_VALUE: "ok",
      },
    );
  });

  it("applies the same safety policy to ambient and existing workflow env", () => {
    const unsafeEnv = JSON.parse(
      '{"SAFE_VALUE":"ok","VERYFRONT_API_TOKEN":"secret","TENANT_SECRET":"tenant-secret","nonString":123,"__proto__":"polluted","constructor":"polluted","prototype":"polluted"}',
    ) as Record<string, string>;

    assertEquals(buildTaskContextEnv(unsafeEnv), { SAFE_VALUE: "ok" });
    assertEquals(mergeInjectedWorkflowEnv(unsafeEnv, {}), { SAFE_VALUE: "ok" });
  });

  it("reserves VERYFRONT_API_KEY like the token it can supply", () => {
    // The CLI and SDK accept the key as the credential, so a task or skill
    // script must never receive it through ambient or injected env.
    assertEquals(isReservedTaskEnvKey("VERYFRONT_API_KEY"), true);
    assertEquals(buildTaskContextEnv({ SAFE_VALUE: "ok", VERYFRONT_API_KEY: "<KEY>" }), {
      SAFE_VALUE: "ok",
    });
    assertEquals(
      readInjectedProjectEnv({
        [INJECTED_TASK_ENV_JSON]: '{"SAFE_VALUE":"ok","VERYFRONT_API_KEY":"<KEY>"}',
      }),
      { SAFE_VALUE: "ok" },
    );
  });

  it("reserves credential names in any letter case", () => {
    // On Windows the env loader case-folds names, so a project .env entry
    // spelled in lower case supplies the same credential.
    for (const key of ["veryfront_api_key", "Veryfront_Api_Token", "tenant_secret"]) {
      assertEquals(isReservedTaskEnvKey(key), true, key);
    }
    assertEquals(
      buildTaskContextEnv({ SAFE_VALUE: "ok", veryfront_api_key: "<KEY>" }),
      { SAFE_VALUE: "ok" },
    );
    assertEquals(isReservedTaskEnvKey("VERYFRONT_API_KEY_HINT"), false);
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
});
