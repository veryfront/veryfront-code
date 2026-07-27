import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import { readProxyStartupConfig } from "./startup-config.ts";

function environment(
  values: Readonly<Record<string, string>>,
): (name: string) => string | undefined {
  return (name) => Object.hasOwn(values, name) ? values[name] : undefined;
}

Deno.test("proxy startup configuration", async (t) => {
  await t.step("uses explicit development defaults only when values are absent", () => {
    const config = readProxyStartupConfig(() => undefined, false);

    assertEquals(config.production, false);
    assertEquals(config.proxyConfig, {
      apiBaseUrl: "https://api.veryfront.com",
      apiClientId: "",
      apiClientSecret: "",
      previewApiClientId: "",
      previewApiClientSecret: "",
      localProjects: {},
    });
    assertEquals(config.binding, { hostname: "0.0.0.0", port: 8_080 });
    assertEquals(config.productionServerUrl, "http://localhost:3001");
    assertEquals(config.apiInternalUrl, "https://api.veryfront.com");
    assertEquals(config.apiRequestTimeoutMs, 30_000);
    assertEquals(config.serverRequestTimeoutMs, 90_000);
    assertEquals(config.serverRetryCount, 1);
    assertEquals(config.serverRetryDelayMs, 100);
    assertEquals(config.shutdownDrainTimeoutMs, 25_000);
    assertEquals(config.shutdownCleanupTimeoutMs, 4_000);
    assertEquals(config.expectedReplicas, undefined);
    assertEquals(Object.isFrozen(config), true);
    assertEquals(Object.isFrozen(config.proxyConfig), true);
    assertEquals(Object.isFrozen(config.proxyConfig.localProjects), true);
  });

  await t.step("normalizes and snapshots explicit runtime configuration", () => {
    const config = readProxyStartupConfig(
      environment({
        VERYFRONT_PROXY_API_CLIENT_ID: "client-id",
        VERYFRONT_PROXY_API_CLIENT_SECRET: "client-secret",
        VERYFRONT_PROXY_API_BASE_URL: "https://api.example.com/control@v2/",
        LOCAL_PROJECTS: JSON.stringify({
          project: "/srv/projects/project",
        }),
        VERYFRONT_SERVER_URL: "https://renderer.example.com/",
        VERYFRONT_API_INTERNAL_URL: "http://api.internal/v1/",
        VERYFRONT_API_INTERNAL_USER: "internal-user",
        VERYFRONT_API_INTERNAL_PASS: "internal-password",
        VERYFRONT_API_REQUEST_TIMEOUT_MS: "45000",
        VERYFRONT_PROXY_URL: "http://127.0.0.1:9090",
        VERYFRONT_SERVER_REQUEST_TIMEOUT_MS: "120000",
        VERYFRONT_SERVER_RETRY_COUNT: "3",
        VERYFRONT_SERVER_RETRY_DELAY_MS: "250",
        SHUTDOWN_DRAIN_TIMEOUT_MS: "30000",
        SHUTDOWN_CLEANUP_TIMEOUT_MS: "3500",
        VERYFRONT_PROXY_EXPECTED_REPLICAS: "2",
        VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET: "development-secret",
      }),
      false,
    );

    assertEquals(config.proxyConfig.apiBaseUrl, "https://api.example.com/control@v2");
    assertEquals(config.proxyConfig.localProjects, {
      project: "/srv/projects/project",
    });
    assertEquals(config.binding, { hostname: "127.0.0.1", port: 9_090 });
    assertEquals(config.productionServerUrl, "https://renderer.example.com");
    assertEquals(config.apiInternalUrl, "http://api.internal/v1");
    assertEquals(config.apiInternalUser, "internal-user");
    assertEquals(config.apiInternalPass, "internal-password");
    assertEquals(config.apiRequestTimeoutMs, 45_000);
    assertEquals(config.serverRequestTimeoutMs, 120_000);
    assertEquals(config.serverRetryCount, 3);
    assertEquals(config.serverRetryDelayMs, 250);
    assertEquals(config.shutdownDrainTimeoutMs, 30_000);
    assertEquals(config.shutdownCleanupTimeoutMs, 3_500);
    assertEquals(config.expectedReplicas, 2);
  });

  await t.step("supports canonical URL and direct IPv6 bind hosts", () => {
    const viaUrl = readProxyStartupConfig(
      environment({
        VERYFRONT_PROXY_URL: "http://[::1]:8081",
      }),
      false,
    );
    assertEquals(viaUrl.binding, { hostname: "::1", port: 8_081 });

    const direct = readProxyStartupConfig(
      environment({
        HOST: "::",
        PORT: "8082",
      }),
      false,
    );
    assertEquals(direct.binding, { hostname: "::", port: 8_082 });
  });

  await t.step("requires all production routing authority", () => {
    const values = {
      VERYFRONT_SERVER_URL: "http://renderer.internal:3001",
      VERYFRONT_PROXY_EXPECTED_REPLICAS: "3",
      VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET: "x".repeat(32),
    };
    const config = readProxyStartupConfig(environment(values), true);
    assertEquals(config.production, true);
    assertEquals(config.expectedReplicas, 3);

    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({
            VERYFRONT_PROXY_EXPECTED_REPLICAS: "3",
            VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET: "x".repeat(32),
          }),
          true,
        ),
      Error,
      "VERYFRONT_SERVER_URL is required in production",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({
            VERYFRONT_SERVER_URL: values.VERYFRONT_SERVER_URL,
            VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET: "x".repeat(32),
          }),
          true,
        ),
      Error,
      "VERYFRONT_PROXY_EXPECTED_REPLICAS must be a positive integer",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({
            VERYFRONT_SERVER_URL: values.VERYFRONT_SERVER_URL,
            VERYFRONT_PROXY_EXPECTED_REPLICAS: "3",
            VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET: "too-short",
          }),
          true,
        ),
      Error,
      "must contain at least 32 bytes",
    );
  });

  await t.step("rejects malformed local project maps", () => {
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({ LOCAL_PROJECTS: "not-json" }),
          false,
        ),
      TypeError,
      "valid JSON",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({ LOCAL_PROJECTS: "[]" }),
          false,
        ),
      TypeError,
      "JSON object",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({
            LOCAL_PROJECTS: JSON.stringify({ Project: "/srv/project" }),
          }),
          false,
        ),
      TypeError,
      "invalid entry",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({
            LOCAL_PROJECTS: JSON.stringify({ project: "relative/path" }),
          }),
          false,
        ),
      TypeError,
      "invalid entry",
    );
  });

  await t.step("rejects ambiguous and unsafe URL or binding values", () => {
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({
            VERYFRONT_PROXY_API_BASE_URL: "file:///tmp/api",
          }),
          false,
        ),
      TypeError,
      "HTTP(S)",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({
            VERYFRONT_PROXY_API_BASE_URL: "https://user@api.example.com",
          }),
          false,
        ),
      TypeError,
      "HTTP(S)",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({
            VERYFRONT_SERVER_URL: "http://renderer.internal/path",
          }),
          false,
        ),
      TypeError,
      "HTTP(S) origin",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({
            VERYFRONT_PROXY_URL: "http://127.0.0.1:8080",
            PORT: "8081",
          }),
          false,
        ),
      TypeError,
      "cannot be combined",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({ HOST: "bad_host" }),
          false,
        ),
      TypeError,
      "bind hostname",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({ PORT: "8080junk" }),
          false,
        ),
      TypeError,
      "decimal integer",
    );
  });

  await t.step("rejects malformed timeout, retry, and replica policy", () => {
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({ VERYFRONT_API_REQUEST_TIMEOUT_MS: "0" }),
          false,
        ),
      RangeError,
      "between 1 and 300000",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({ VERYFRONT_SERVER_REQUEST_TIMEOUT_MS: "0" }),
          false,
        ),
      RangeError,
      "between 1 and 900000",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({ VERYFRONT_SERVER_RETRY_COUNT: "6" }),
          false,
        ),
      RangeError,
      "between 0 and 5",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({ VERYFRONT_SERVER_RETRY_DELAY_MS: "-1" }),
          false,
        ),
      TypeError,
      "decimal integer",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({ SHUTDOWN_DRAIN_TIMEOUT_MS: "invalid" }),
          false,
        ),
      TypeError,
      "decimal integer",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({ SHUTDOWN_CLEANUP_TIMEOUT_MS: "2147483648" }),
          false,
        ),
      RangeError,
      "between 0 and 2147483647",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({ VERYFRONT_PROXY_EXPECTED_REPLICAS: "2x" }),
          false,
        ),
      TypeError,
      "decimal integer",
    );
  });

  await t.step("rejects invalid readers, flags, and credential text", () => {
    assertThrows(
      () => readProxyStartupConfig(null as never, false),
      TypeError,
      "environment reader",
    );
    assertThrows(
      () => readProxyStartupConfig(() => undefined, "yes" as never),
      TypeError,
      "production flag",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          environment({
            VERYFRONT_PROXY_API_CLIENT_ID: " client-id",
          }),
          false,
        ),
      TypeError,
      "API_CLIENT_ID",
    );
    assertThrows(
      () =>
        readProxyStartupConfig(
          (() => null) as never,
          false,
        ),
      TypeError,
      "bounded string",
    );
  });
});
