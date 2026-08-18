import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { connectors } from "./_data.ts";
import {
  createLocalCredentialAuthPlan,
  resolveLocalCredentialAuth,
} from "./local-credential-auth.ts";
import type { LocalIntegrationCredentialProvider } from "./local-tool-source.ts";
import type { IntegrationConfig } from "./schema.ts";

const SECRET = "LOCAL_PROVIDER_SECRET_MUST_NOT_LEAK";
const defineProperty = Object.defineProperty;
const deleteProperty = Reflect.deleteProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

function appendRestorer(restorers: Array<() => void>, restorer: () => void): void {
  defineProperty(restorers, restorers.length, {
    configurable: true,
    enumerable: true,
    value: restorer,
    writable: true,
  });
}

function replaceProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): () => void {
  const descriptor = getOwnPropertyDescriptor(target, key);
  defineProperty(target, key, {
    configurable: true,
    value,
    writable: true,
  });
  return () => {
    if (descriptor) defineProperty(target, key, descriptor);
    else deleteProperty(target, key);
  };
}

function connector(name: string) {
  const value = connectors.find((candidate) => candidate.name === name);
  assert(value, `Missing test connector ${name}`);
  return value;
}

function providerFrom(values: Record<string, string>): LocalIntegrationCredentialProvider {
  return (name) => values[name];
}

describe("local integration credential auth", () => {
  it("rejects noncanonical credential names and unsupported token auth methods", () => {
    const invalidCredential = {
      name: "vercel",
      auth: {
        type: "api-key",
        keyName: "not canonical?",
      },
      envVars: [],
    } satisfies Pick<IntegrationConfig, "auth" | "envVars" | "name">;
    const credentialError = assertThrows(
      () => createLocalCredentialAuthPlan(invalidCredential),
      VeryfrontError,
    );
    assertInstanceOf(credentialError, VeryfrontError);
    assertEquals(credentialError.slug, "local-integration-config-invalid");

    for (const tokenAuthMethod of ["none", "body", "client_secret_basic"]) {
      const invalidOAuth = {
        name: "paypal",
        auth: {
          type: "oauth2",
          grantType: "client_credentials",
          tokenAuthMethod,
          tokenUrl: "https://oauth.example.test/token",
        },
        envVars: [],
      } satisfies Pick<IntegrationConfig, "auth" | "envVars" | "name">;
      const tokenMethodError = assertThrows(
        () => createLocalCredentialAuthPlan(invalidOAuth),
        VeryfrontError,
      );
      assertInstanceOf(tokenMethodError, VeryfrontError);
      assertEquals(tokenMethodError.slug, "local-integration-config-invalid");
    }
  });

  it("resolves header API-key and additional-header plans", async () => {
    const vercelPlan = createLocalCredentialAuthPlan(connector("vercel"));
    assertEquals(vercelPlan.requiredEnvironmentVariables, ["VERCEL_TOKEN"]);
    assertEquals(JSON.stringify(vercelPlan).includes(SECRET), false);

    const vercel = await resolveLocalCredentialAuth(
      vercelPlan,
      providerFrom({ VERCEL_TOKEN: SECRET }),
    );
    assertEquals(vercel.kind, "headers");
    assertEquals(vercel.headers, { Authorization: `Bearer ${SECRET}` });

    const datadogPlan = createLocalCredentialAuthPlan(connector("datadog"));
    const datadog = await resolveLocalCredentialAuth(
      datadogPlan,
      providerFrom({
        DD_API_KEY: "api-key",
        DD_APP_KEY: "app-key",
      }),
    );
    assertEquals(datadog.kind, "headers");
    assertEquals(datadog.headers, {
      "DD-API-KEY": "api-key",
      "DD-APPLICATION-KEY": "app-key",
    });
  });

  it("resolves HTTP Basic without exposing credentials in the safe plan", async () => {
    const plan = createLocalCredentialAuthPlan(connector("sendcloud"));
    assertEquals(plan.requiredEnvironmentVariables, [
      "SENDCLOUD_PUBLIC_KEY",
      "SENDCLOUD_SECRET_KEY",
    ]);

    const resolved = await resolveLocalCredentialAuth(
      plan,
      providerFrom({
        SENDCLOUD_PUBLIC_KEY: "public-key",
        SENDCLOUD_SECRET_KEY: SECRET,
      }),
    );

    assertEquals(resolved.kind, "headers");
    assertEquals(resolved.headers, {
      Authorization: `Basic ${btoa(`public-key:${SECRET}`)}`,
    });
    assertEquals(JSON.stringify(plan).includes(SECRET), false);
  });

  it("adds catalog-declared headers to HTTP Basic requests", async () => {
    const plan = createLocalCredentialAuthPlan(connector("billbee"));

    assertEquals(plan.requiredEnvironmentVariables, [
      "BILLBEE_USERNAME",
      "BILLBEE_API_PASSWORD",
      "BILLBEE_API_KEY",
    ]);
    const resolved = await resolveLocalCredentialAuth(
      plan,
      providerFrom({
        BILLBEE_USERNAME: "ada@example.test",
        BILLBEE_API_PASSWORD: SECRET,
        BILLBEE_API_KEY: "billbee-application-key",
      }),
    );

    assertEquals(resolved.kind, "headers");
    assertEquals(resolved.headers["X-Billbee-Api-Key"], "billbee-application-key");
  });

  it("builds a PayPal client-credentials token request", async () => {
    const plan = createLocalCredentialAuthPlan(connector("paypal"));
    assertEquals(plan.requiredEnvironmentVariables, [
      "PAYPAL_CLIENT_ID",
      "PAYPAL_CLIENT_SECRET",
    ]);

    const resolved = await resolveLocalCredentialAuth(
      plan,
      providerFrom({
        PAYPAL_CLIENT_ID: "paypal-client",
        PAYPAL_CLIENT_SECRET: SECRET,
      }),
    );

    assert(resolved.kind === "token-request");
    assertEquals(resolved.mode, "client-credentials");
    assertEquals(resolved.url, "https://api-m.paypal.com/v1/oauth2/token");
    assertEquals(resolved.headers, {
      Accept: "application/json",
      Authorization: `Basic ${btoa(`paypal-client:${SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    });
    assertEquals(resolved.body, "grant_type=client_credentials");
  });

  it("form-encodes OAuth Basic client credentials before encoding the header", async () => {
    const plan = createLocalCredentialAuthPlan(connector("paypal"));
    const clientId = "client id+with%reserved:characters";
    const clientSecret = "secret value+with%reserved:characters";
    const resolved = await resolveLocalCredentialAuth(
      plan,
      providerFrom({
        PAYPAL_CLIENT_ID: clientId,
        PAYPAL_CLIENT_SECRET: clientSecret,
      }),
    );

    assert(resolved.kind === "token-request");
    const encodedClientId = new URLSearchParams({ value: clientId }).toString().slice(
      "value=".length,
    );
    const encodedClientSecret = new URLSearchParams({ value: clientSecret }).toString().slice(
      "value=".length,
    );
    assertEquals(
      resolved.headers.Authorization,
      `Basic ${btoa(`${encodedClientId}:${encodedClientSecret}`)}`,
    );
  });

  it("uses catalog-declared client credential names when the connector prefix differs", () => {
    const plan = createLocalCredentialAuthPlan(connector("trusted-shops"));

    assertEquals(plan.requiredEnvironmentVariables, [
      "ETRUSTED_CLIENT_ID",
      "ETRUSTED_CLIENT_SECRET",
    ]);
  });

  it("includes catalog-declared parameters in client-credentials token requests", async () => {
    const plan = createLocalCredentialAuthPlan(connector("trusted-shops"));
    const resolved = await resolveLocalCredentialAuth(
      plan,
      providerFrom({
        ETRUSTED_CLIENT_ID: "trusted-shops-client",
        ETRUSTED_CLIENT_SECRET: SECRET,
        TRUSTED_SHOPS_CLIENT_ID: "trusted-shops-client",
        TRUSTED_SHOPS_CLIENT_SECRET: SECRET,
      }),
    );

    assert(resolved.kind === "token-request");
    assertEquals(
      resolved.body,
      `grant_type=client_credentials&client_id=trusted-shops-client&client_secret=${SECRET}&audience=https%3A%2F%2Fapi.etrusted.com`,
    );
  });

  it("builds a Salesforce service-account token request from its distinct vocabulary", async () => {
    const plan = createLocalCredentialAuthPlan(connector("salesforce"));
    assertEquals(plan.requiredEnvironmentVariables, [
      "SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID",
      "SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET",
      "SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL",
    ]);

    const resolved = await resolveLocalCredentialAuth(
      plan,
      providerFrom({
        SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID: "salesforce-client",
        SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET: SECRET,
        SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL: "https://acme.my.salesforce.com",
      }),
    );

    assert(resolved.kind === "token-request");
    assertEquals(resolved.mode, "salesforce-service-account");
    assertEquals(resolved.url, "https://acme.my.salesforce.com/services/oauth2/token");
    assertEquals(resolved.headers, {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    });
    assertEquals(
      resolved.body,
      `grant_type=client_credentials&client_id=salesforce-client&client_secret=${SECRET}`,
    );
  });

  it("keeps credential resolution independent from ambient collection primordials", async () => {
    const paypalConnector = connector("paypal");
    const salesforceConnector = connector("salesforce");
    const restorers: Array<() => void> = [];
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("ambient credential primordial used");
    };
    let paypal: Awaited<ReturnType<typeof resolveLocalCredentialAuth>> | undefined;
    let salesforce: Awaited<ReturnType<typeof resolveLocalCredentialAuth>> | undefined;

    try {
      appendRestorer(restorers, replaceProperty(Array, "isArray", poison));
      appendRestorer(restorers, replaceProperty(Array.prototype, "indexOf", poison));
      appendRestorer(restorers, replaceProperty(Array.prototype, "join", poison));
      // node:test uses Array.prototype.push while this async test is
      // suspended, so poisoning it would fail the host test harness rather
      // than exercise credential resolution.
      appendRestorer(restorers, replaceProperty(Array.prototype, "splice", poison));
      appendRestorer(restorers, replaceProperty(Object, "create", poison));
      appendRestorer(restorers, replaceProperty(Object, "entries", poison));
      appendRestorer(restorers, replaceProperty(Object, "freeze", poison));
      appendRestorer(restorers, replaceProperty(Object, "values", poison));
      appendRestorer(restorers, replaceProperty(String, "fromCharCode", poison));
      appendRestorer(restorers, replaceProperty(String.prototype, "charCodeAt", poison));
      appendRestorer(restorers, replaceProperty(String.prototype, "endsWith", poison));
      appendRestorer(restorers, replaceProperty(String.prototype, "includes", poison));
      appendRestorer(restorers, replaceProperty(String.prototype, "toLowerCase", poison));
      appendRestorer(restorers, replaceProperty(String.prototype, "trim", poison));
      // node:test also appends diagnostics to empty arrays while this async
      // test is suspended, so an inherited index-0 setter would fail the host
      // harness before the framework assertion can run.

      paypal = await resolveLocalCredentialAuth(
        createLocalCredentialAuthPlan(paypalConnector),
        providerFrom({
          PAYPAL_CLIENT_ID: "paypal-client",
          PAYPAL_CLIENT_SECRET: SECRET,
        }),
      );
      salesforce = await resolveLocalCredentialAuth(
        createLocalCredentialAuthPlan(salesforceConnector),
        providerFrom({
          SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID: "salesforce-client",
          SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET: SECRET,
          SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL: "https://acme.my.salesforce.com",
        }),
      );
    } finally {
      for (let index = restorers.length - 1; index >= 0; index--) restorers[index]?.();
    }

    assertEquals(poisonCalls, 0);
    assert(paypal);
    assert(paypal.kind === "token-request");
    assert(Object.isFrozen(paypal));
    assertEquals(paypal.body, "grant_type=client_credentials");
    assert(salesforce);
    assert(salesforce.kind === "token-request");
    assert(Object.isFrozen(salesforce));
    assertEquals(salesforce.url, "https://acme.my.salesforce.com/services/oauth2/token");
  });

  it("reports only missing variable names and calls a provider with names only", async () => {
    const calls: string[] = [];
    const plan = createLocalCredentialAuthPlan(connector("sendcloud"));
    const error = await assertRejects(
      () =>
        resolveLocalCredentialAuth(plan, (name) => {
          calls.push(name);
          return name === "SENDCLOUD_PUBLIC_KEY" ? "public-key" : undefined;
        }),
      VeryfrontError,
    );

    assertEquals(calls, ["SENDCLOUD_PUBLIC_KEY", "SENDCLOUD_SECRET_KEY"]);
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "local-integration-credentials-missing");
    assert(error.message.includes("SENDCLOUD_SECRET_KEY"));
    assertEquals(error.message.includes("public-key"), false);
    assertEquals(error.cause, undefined);
  });

  it("sorts missing credential variable names in configuration errors", async () => {
    const plan = createLocalCredentialAuthPlan(connector("billbee"));

    const error = await assertRejects(
      () => resolveLocalCredentialAuth(plan, () => undefined),
      VeryfrontError,
    );

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "local-integration-credentials-missing");
    assert(
      error.message.includes("BILLBEE_API_KEY, BILLBEE_API_PASSWORD, BILLBEE_USERNAME"),
      error.message,
    );
  });

  it("fails safely for invalid values, provider failures, and Salesforce login URLs", async () => {
    const plan = createLocalCredentialAuthPlan(connector("vercel"));
    for (const value of ["", " ", "x".repeat(16_385)]) {
      const error = await assertRejects(
        () => resolveLocalCredentialAuth(plan, () => value),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "local-integration-credentials-missing");
      if (value.length > 16_384) {
        assertEquals(error.message.includes(value), false);
      }
    }

    const providerError = await assertRejects(
      () =>
        resolveLocalCredentialAuth(plan, () => {
          throw new Error(SECRET);
        }),
      VeryfrontError,
    );
    assertInstanceOf(providerError, VeryfrontError);
    assertEquals(providerError.slug, "local-integration-credential-unavailable");
    assertEquals(providerError.message.includes(SECRET), false);
    assertEquals(providerError.cause, undefined);

    const salesforcePlan = createLocalCredentialAuthPlan(connector("salesforce"));
    for (
      const loginUrl of [
        "http://acme.my.salesforce.com",
        "https://login.salesforce.com",
        "https://acme.my.salesforce.com/path",
        "https://user@acme.my.salesforce.com",
        "https://acme.my.salesforce.com:8443",
      ]
    ) {
      const error = await assertRejects(
        () =>
          resolveLocalCredentialAuth(
            salesforcePlan,
            providerFrom({
              SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID: "client",
              SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET: SECRET,
              SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL: loginUrl,
            }),
          ),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "local-integration-config-invalid");
      assertEquals(error.message.includes(SECRET), false);
    }
  });

  it("rejects URL credentials and authorization-code OAuth in the auth module", async () => {
    for (const name of ["alphavantage", "slack"]) {
      const error = await assertRejects(
        async () => createLocalCredentialAuthPlan(connector(name)),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "local-integration-config-invalid");
    }
  });
});
