import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { connectors } from "./_data.ts";
import {
  createLocalCredentialAuthPlan,
  resolveLocalCredentialAuth,
} from "./local-credential-auth.ts";
import type { LocalIntegrationCredentialProvider } from "./local-tool-source.ts";

const SECRET = "LOCAL_PROVIDER_SECRET_MUST_NOT_LEAK";

function connector(name: string) {
  const value = connectors.find((candidate) => candidate.name === name);
  assert(value, `Missing test connector ${name}`);
  return value;
}

function providerFrom(values: Record<string, string>): LocalIntegrationCredentialProvider {
  return (name) => values[name];
}

describe("local integration credential auth", () => {
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

    assertEquals(resolved.kind, "token-request");
    assertEquals(resolved.mode, "client-credentials");
    assertEquals(resolved.url, "https://api-m.paypal.com/v1/oauth2/token");
    assertEquals(resolved.headers, {
      Accept: "application/json",
      Authorization: `Basic ${btoa(`paypal-client:${SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    });
    assertEquals(resolved.body, "grant_type=client_credentials");
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

    assertEquals(resolved.kind, "token-request");
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
    assertEquals(error.slug, "local-integration-credentials-missing");
    assert(error.message.includes("SENDCLOUD_SECRET_KEY"));
    assertEquals(error.message.includes("public-key"), false);
    assertEquals(error.cause, undefined);
  });

  it("fails safely for invalid values, provider failures, and Salesforce login URLs", async () => {
    const plan = createLocalCredentialAuthPlan(connector("vercel"));
    for (const value of ["", " ", "x".repeat(16_385)]) {
      const error = await assertRejects(
        () => resolveLocalCredentialAuth(plan, () => value),
        VeryfrontError,
      );
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
      assertEquals(error.slug, "local-integration-config-invalid");
    }
  });
});
