import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  requireWorkflowApiBaseUrl,
  requireWorkflowContentSource,
  type WorkflowSourceAuthority,
} from "#veryfront/workflow/source-authority.ts";
import { requireWorkflowSourceIntegrationPolicy } from "#veryfront/workflow/source-integration-policy.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";

describe("workflow source boundaries with hostile ambient intrinsics", () => {
  it("does not let descriptor prototype pollution turn accessors into data properties", () => {
    let getterCalls = 0;
    const authority = Object.defineProperty(
      { productionMode: true, environmentName: "Production" },
      "releaseId",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "release-from-getter";
        },
      },
    ) as WorkflowSourceAuthority;

    Object.defineProperty(Object.prototype, "value", {
      value: "polluted-release",
      configurable: true,
    });
    try {
      assertThrows(
        () => requireWorkflowContentSource(authority),
        VeryfrontError,
        "must contain only own data properties",
      );
      assertEquals(getterCalls, 0);
    } finally {
      delete (Object.prototype as { value?: unknown }).value;
    }
  });

  it("does not let descriptor prototype pollution supply a policy snapshot", () => {
    const pollutedPolicy = normalizeSourceIntegrationPolicy(undefined);
    let getterCalls = 0;
    const run = Object.defineProperty({ id: "polluted-descriptor" }, "sourceIntegrationPolicy", {
      enumerable: true,
      get() {
        getterCalls++;
        return normalizeSourceIntegrationPolicy(undefined);
      },
    });

    Object.defineProperty(Object.prototype, "value", {
      value: pollutedPolicy,
      configurable: true,
    });
    try {
      assertThrows(
        () => requireWorkflowSourceIntegrationPolicy(run as never),
        VeryfrontError,
        "invalid source integration policy snapshot",
      );
      assertEquals(getterCalls, 0);
    } finally {
      delete (Object.prototype as { value?: unknown }).value;
    }
  });

  it("does not trust a replaced String.prototype.trim for source IDs", () => {
    const originalTrim = String.prototype.trim;
    const originalCharCodeAt = String.prototype.charCodeAt;
    const stringValueOf = String.prototype.valueOf;
    try {
      String.prototype.trim = function () {
        return Reflect.apply(stringValueOf, this, []) as string;
      };
      String.prototype.charCodeAt = () => 65;
      assertThrows(
        () =>
          requireWorkflowContentSource({
            productionMode: true,
            releaseId: " release ",
          }),
        VeryfrontError,
        "release ID must be a bounded non-empty canonical identifier",
      );
      assertThrows(
        () =>
          requireWorkflowContentSource({
            productionMode: true,
            releaseId: "release\u0000suffix",
          }),
        VeryfrontError,
        "release ID must be a bounded non-empty canonical identifier",
      );
    } finally {
      String.prototype.trim = originalTrim;
      String.prototype.charCodeAt = originalCharCodeAt;
    }
  });

  it("does not trust a replaced URL constructor", () => {
    const OriginalURL = globalThis.URL;
    try {
      globalThis.URL = class {
        protocol = "https:";
        username = "";
        password = "";
        search = "";
        hash = "";
        href = "https://attacker.example";
      } as unknown as typeof URL;
      assertThrows(
        () => requireWorkflowApiBaseUrl("not a URL"),
        VeryfrontError,
        "valid HTTP(S) URL",
      );
    } finally {
      globalThis.URL = OriginalURL;
    }
  });

  it("does not trust live string search or replacement methods for API URLs", () => {
    const originalIncludes = String.prototype.includes;
    const originalReplace = String.prototype.replace;
    try {
      String.prototype.includes = () => false;
      String.prototype.replace = () => "https://attacker.example";
      assertThrows(
        () => requireWorkflowApiBaseUrl("https://api.example.test?"),
        VeryfrontError,
      );
      assertEquals(
        requireWorkflowApiBaseUrl("https://api.example.test/path/"),
        "https://api.example.test/path",
      );
    } finally {
      String.prototype.includes = originalIncludes;
      String.prototype.replace = originalReplace;
    }
  });
});
