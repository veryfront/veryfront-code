import { assert } from "#veryfront/testing/assert";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { LocalBlobStorage } from "#veryfront/workflow/blob/local-storage.ts";
import { VeryfrontCloudBlobStorage } from "#veryfront/workflow/blob/veryfront-cloud-storage.ts";
import { resolveStorage } from "#veryfront/chat/uploads";

/**
 * Backend selection for chat uploads reads the deployment environment and the
 * Veryfront Cloud bootstrap straight from process env, so it lives here rather
 * than beside the handler: the colocated unit test stays hermetic and this
 * case gets to mutate the host env it actually depends on.
 */
const STORAGE_ENV_KEYS = [
  "VERYFRONT_ENV",
  "NODE_ENV",
  "DENO_ENV",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_SERVICE_LAYER",
] as const;

describe("chat/upload-handler storage selection", () => {
  const originalEnv = new Map<string, string | undefined>(
    STORAGE_ENV_KEYS.map((key) => [key, getEnv(key)]),
  );

  function clearStorageEnv(): void {
    for (const key of STORAGE_ENV_KEYS) {
      try {
        deleteEnv(key);
      } catch {
        // expected: env may already be unset
      }
    }
  }

  afterEach(() => {
    clearStorageEnv();
    for (const [key, value] of originalEnv) {
      if (value !== undefined) setEnv(key, value);
    }
  });

  it("selects disk in dev and Veryfront Cloud only once deployed", () => {
    clearStorageEnv();
    setEnv("VERYFRONT_API_TOKEN", "vf_upload_test");
    setEnv("VERYFRONT_PROJECT_SLUG", "upload-test-project");

    setEnv("VERYFRONT_ENV", "development");
    assert(
      resolveStorage({}) instanceof LocalBlobStorage,
      "local dev uploads must stay on disk even when the cloud bootstrap is present",
    );

    setEnv("VERYFRONT_ENV", "production");
    assert(
      resolveStorage({}) instanceof VeryfrontCloudBlobStorage,
      "a deployed project with the cloud bootstrap must upload to Veryfront Cloud",
    );

    deleteEnv("VERYFRONT_API_TOKEN");
    deleteEnv("VERYFRONT_PROJECT_SLUG");
    assert(
      resolveStorage({}) instanceof LocalBlobStorage,
      "a deployment without the cloud bootstrap must fall back to disk",
    );
  });
});
