import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { atlassianServices, confluenceConfig, jiraConfig } from "./atlassian.ts";
import {
  calendarConfig,
  driveConfig,
  gmailConfig,
  googleServices,
  sheetsConfig,
} from "./google.ts";
import { microsoftServices, outlookConfig, teamsConfig } from "./microsoft.ts";

const authParamOwners: Array<readonly [string, Record<string, string>]> = Object
  .entries({ ...googleServices, ...microsoftServices, ...atlassianServices })
  .flatMap(([serviceId, config]) =>
    config.additionalAuthParams ? [[serviceId, config.additionalAuthParams] as const] : []
  );

describe("OAuth provider configuration isolation", () => {
  it("does not share nested authorization parameter maps between services", () => {
    assertNotStrictEquals(gmailConfig.additionalAuthParams, calendarConfig.additionalAuthParams);
    assertNotStrictEquals(outlookConfig.additionalAuthParams, teamsConfig.additionalAuthParams);
    assertNotStrictEquals(jiraConfig.additionalAuthParams, confluenceConfig.additionalAuthParams);

    for (let left = 0; left < authParamOwners.length; left++) {
      for (let right = left + 1; right < authParamOwners.length; right++) {
        const [leftId, leftParams] = authParamOwners[left]!;
        const [rightId, rightParams] = authParamOwners[right]!;
        assertNotStrictEquals(
          leftParams,
          rightParams,
          `${leftId} and ${rightId} share one additionalAuthParams object`,
        );
      }
    }
  });

  it("gives each service exclusive ownership of its authorization parameters", () => {
    // Reference inequality alone cannot tell a real copy from a delegating
    // alias, so mutate one service and prove its siblings keep their values.
    const restored = driveConfig.additionalAuthParams?.prompt;
    try {
      driveConfig.additionalAuthParams!.prompt = "select_account";
      assertEquals(
        sheetsConfig.additionalAuthParams?.prompt,
        "consent",
        "mutating Drive's additionalAuthParams must not rewrite Google Sheets consent behavior",
      );
      assertEquals(
        gmailConfig.additionalAuthParams?.prompt,
        "consent",
        "mutating Drive's additionalAuthParams must not rewrite Gmail consent behavior",
      );
    } finally {
      driveConfig.additionalAuthParams!.prompt = restored!;
    }

    for (const [serviceId, params] of authParamOwners) {
      const sentinel = `isolation-probe-${serviceId}`;
      try {
        params[sentinel] = "set";
        for (const [otherId, otherParams] of authParamOwners) {
          if (otherId === serviceId) continue;
          assertEquals(
            Object.hasOwn(otherParams, sentinel) || otherParams[sentinel] !== undefined,
            false,
            `${otherId} observed a parameter written to ${serviceId}`,
          );
        }
      } finally {
        delete params[sentinel];
      }
    }
  });
});
