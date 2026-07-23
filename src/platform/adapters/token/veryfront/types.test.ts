import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { createTokenConfig, type TokenStorageAdapterConfig } from "./types.ts";

function cloudConfig(
  veryfront: NonNullable<TokenStorageAdapterConfig["veryfront"]>,
): TokenStorageAdapterConfig {
  return { type: "veryfront-api", veryfront };
}

function captureConfigError(config: TokenStorageAdapterConfig): VeryfrontError {
  try {
    createTokenConfig(config);
  } catch (error) {
    return error as VeryfrontError;
  }
  throw new Error("Expected configuration validation to fail");
}

describe("platform/adapters/token/veryfront/types", () => {
  it("normalizes a base URL path and applies immutable defaults", () => {
    const config = createTokenConfig(
      cloudConfig({
        apiToken: "<TOKEN>",
        projectSlug: "test-project",
        apiBaseUrl: "  HTTPS://api.example.com/custom/path///  ",
      }),
    );

    assertEquals(config.apiBaseUrl, "https://api.example.com/custom/path");
    assertEquals(config.timeoutMs, 30_000);
    assertEquals(config.retry, {
      maxRetries: 3,
      initialDelay: 1_000,
      maxDelay: 10_000,
    });
    assertEquals(Object.isFrozen(config), true);
    assertEquals(Object.isFrozen(config.retry), true);
  });

  it("snapshots nested retry configuration", () => {
    const retry = { maxRetries: 1, initialDelay: 2, maxDelay: 3 };
    const source = cloudConfig({
      apiToken: "<TOKEN>",
      projectSlug: "test-project",
      retry,
    });
    const config = createTokenConfig(source);

    retry.maxRetries = 99;
    retry.initialDelay = 99;
    retry.maxDelay = 99;

    assertEquals(config.retry, { maxRetries: 1, initialDelay: 2, maxDelay: 3 });
  });

  it("rejects blank token and project credentials", () => {
    for (
      const [field, value] of [
        ["apiToken", "   "],
        ["projectSlug", "\t\n"],
      ] as const
    ) {
      const veryfront = {
        apiToken: "<TOKEN>",
        projectSlug: "test-project",
        [field]: value,
      };

      assertThrows(
        () => createTokenConfig(cloudConfig(veryfront)),
        VeryfrontError,
      );
    }
  });

  it("rejects base URLs that are unsafe for an HTTP API", () => {
    for (
      const apiBaseUrl of [
        "relative/path",
        "ftp://api.example.com",
        "https://user:password@api.example.com",
        "https://api.example.com/path?token=<TOKEN>",
        "https://api.example.com/path#fragment",
      ]
    ) {
      assertThrows(
        () =>
          createTokenConfig(
            cloudConfig({
              apiToken: "<TOKEN>",
              projectSlug: "test-project",
              apiBaseUrl,
            }),
          ),
        VeryfrontError,
      );
    }
  });

  it("rejects invalid retry and timeout values", () => {
    const invalidConfigurations: TokenStorageAdapterConfig[] = [
      cloudConfig({
        apiToken: "<TOKEN>",
        projectSlug: "test-project",
        retry: { maxRetries: -1 },
      }),
      cloudConfig({
        apiToken: "<TOKEN>",
        projectSlug: "test-project",
        retry: { maxRetries: 1.5 },
      }),
      cloudConfig({
        apiToken: "<TOKEN>",
        projectSlug: "test-project",
        retry: { maxRetries: 101 },
      }),
      cloudConfig({
        apiToken: "<TOKEN>",
        projectSlug: "test-project",
        retry: { initialDelay: -1 },
      }),
      cloudConfig({
        apiToken: "<TOKEN>",
        projectSlug: "test-project",
        retry: { maxDelay: Number.POSITIVE_INFINITY },
      }),
      cloudConfig({
        apiToken: "<TOKEN>",
        projectSlug: "test-project",
        retry: { initialDelay: 10, maxDelay: 5 },
      }),
      cloudConfig({
        apiToken: "<TOKEN>",
        projectSlug: "test-project",
        timeoutMs: 0,
      }),
      cloudConfig({
        apiToken: "<TOKEN>",
        projectSlug: "test-project",
        timeoutMs: 1.5,
      }),
    ];

    for (const config of invalidConfigurations) {
      assertThrows(() => createTokenConfig(config), VeryfrontError);
    }
  });

  it("does not expose rejected configuration values", async () => {
    const secret = "PRIVATE_CONFIG_CANARY";
    const error = captureConfigError(
      cloudConfig({
        apiToken: secret,
        projectSlug: "test-project",
        apiBaseUrl: `https://${secret}:password@example.com/path?token=${secret}`,
      }),
    );

    assertEquals(
      JSON.stringify({
        message: error.message,
        detail: error.detail,
        context: error.context,
        cause: error.cause,
      }).includes(secret),
      false,
    );

    await assertRejects(
      () => Promise.reject(error),
      VeryfrontError,
    );
  });
});
