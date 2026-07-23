import "#veryfront/schemas/_test-setup.ts";
import { assertNotStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { confluenceConfig, jiraConfig } from "./atlassian.ts";
import { calendarConfig, gmailConfig } from "./google.ts";
import { outlookConfig, teamsConfig } from "./microsoft.ts";

describe("OAuth provider configuration isolation", () => {
  it("does not share nested authorization parameter maps between services", () => {
    assertNotStrictEquals(gmailConfig.additionalAuthParams, calendarConfig.additionalAuthParams);
    assertNotStrictEquals(outlookConfig.additionalAuthParams, teamsConfig.additionalAuthParams);
    assertNotStrictEquals(jiraConfig.additionalAuthParams, confluenceConfig.additionalAuthParams);
  });
});
