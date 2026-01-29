import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getEnvironmentType } from "./domain-lookup.ts";
import type { DomainLookupResult } from "./domain-lookup.ts";

function makeResult(envName: string | null): DomainLookupResult | null {
  if (!envName) return null;
  return {
    project_id: "p1",
    project_slug: "test",
    project_name: "Test",
    environment: { id: "e1", name: envName },
    release_id: null,
  };
}

describe("server/utils/domain-lookup", () => {
  describe("getEnvironmentType", () => {
    it("should return undefined for null result", () => {
      assertEquals(getEnvironmentType(null), undefined);
    });

    it("should return undefined for null environment", () => {
      const result: DomainLookupResult = {
        project_id: "p1",
        project_slug: "test",
        project_name: "Test",
        environment: null,
        release_id: null,
      };
      assertEquals(getEnvironmentType(result), undefined);
    });

    it("should return production for 'production' env", () => {
      assertEquals(getEnvironmentType(makeResult("production")), "production");
    });

    it("should return production for 'prod' env", () => {
      assertEquals(getEnvironmentType(makeResult("prod")), "production");
    });

    it("should return production for 'Production' (case-insensitive)", () => {
      assertEquals(getEnvironmentType(makeResult("Production")), "production");
    });

    it("should return preview for 'preview' env", () => {
      assertEquals(getEnvironmentType(makeResult("preview")), "preview");
    });

    it("should return preview for 'staging' env", () => {
      assertEquals(getEnvironmentType(makeResult("staging")), "preview");
    });

    it("should return preview for 'development' env", () => {
      assertEquals(getEnvironmentType(makeResult("development")), "preview");
    });

    it("should return production for unrecognized env names", () => {
      assertEquals(getEnvironmentType(makeResult("custom")), "production");
    });
  });
});
