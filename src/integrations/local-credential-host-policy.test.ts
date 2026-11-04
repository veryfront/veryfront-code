import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing";
import { VeryfrontError } from "#veryfront/errors";
import { createOutlookServiceAccountToolSource } from "./outlook-service-account.ts";
import {
  assertLocalCredentialHostGrant,
  HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV,
  isHostLocalIntegrationCredentialsEnabled,
} from "./local-credential-host-policy.ts";

describe("local integration credential host policy", () => {
  it("uses a stable operator-owned environment variable", () => {
    assertEquals(
      HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV,
      "VERYFRONT_HOST_ALLOW_LOCAL_INTEGRATION_CREDENTIALS",
    );
  });

  it("grants local credentials only for the exact value 1", () => {
    assertEquals(isHostLocalIntegrationCredentialsEnabled("1"), true);

    for (const value of [undefined, "", "0", "true", "yes", "on", " 1 ", "2"]) {
      assertEquals(
        isHostLocalIntegrationCredentialsEnabled(value),
        false,
        `${String(value)} must fail closed`,
      );
    }
  });

  it("reads the host environment by default", async () => {
    await withEnv({ [HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV]: "1" }, () => {
      assertEquals(isHostLocalIntegrationCredentialsEnabled(), true);
      return Promise.resolve();
    });

    await withEnv({ [HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV]: "true" }, () => {
      assertEquals(isHostLocalIntegrationCredentialsEnabled(), false);
      return Promise.resolve();
    });
  });
  it("names the required variable in the refusal", async () => {
    await withEnv({ [HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV]: "0" }, () => {
      const error = assertThrows(
        () => assertLocalCredentialHostGrant(),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV);
      assertStringIncludes(error.message, "=1");
      return Promise.resolve();
    });
  });

  it("refuses the Outlook attachment reader without the grant", async () => {
    const source = createOutlookServiceAccountToolSource({
      allowedTools: ["outlook__get_shared_mailbox_attachment"],
      credentialProvider: () => "unused",
    });
    await withEnv({ [HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV]: "0" }, async () => {
      const error = await assertRejects(
        () => source.readAttachment({ messageId: "m1", attachmentId: "a1" }),
      );
      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV);
    });
  });
});
