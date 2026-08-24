import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_URL_LENGTH_FOR_VALIDATION } from "#veryfront/utils/constants/limits.ts";
import { MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS } from "./limits.ts";
import {
  requireWorkflowApiBaseUrl,
  requireWorkflowContentSource,
  type WorkflowSourceAuthority,
} from "./source-authority.ts";

describe("workflow source authority", () => {
  it("selects the canonical source for each runtime mode", () => {
    assertEquals(
      requireWorkflowContentSource({
        productionMode: true,
        releaseId: "release-1",
        environmentName: "Production",
      }),
      { type: "release", releaseId: "release-1" },
    );
    assertEquals(
      requireWorkflowContentSource({
        productionMode: true,
        releaseId: null,
        environmentName: "Production",
      }),
      { type: "environment", name: "Production" },
    );
    assertEquals(
      requireWorkflowContentSource({
        productionMode: false,
        branch: "feature/source-authority",
      }),
      { type: "branch", branch: "feature/source-authority" },
    );
  });

  it("rejects noncanonical and oversized selected source identifiers", () => {
    const invalidIdentifiers = [
      "",
      " ",
      " source",
      "source ",
      "source\u0000suffix",
      "source\u0085suffix",
      "x".repeat(MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS + 1),
    ];

    for (const value of invalidIdentifiers) {
      assertThrows(
        () =>
          requireWorkflowContentSource({
            productionMode: true,
            releaseId: value,
            environmentName: "Production",
          }),
        VeryfrontError,
        "release ID must be a bounded non-empty canonical identifier",
      );
      assertThrows(
        () =>
          requireWorkflowContentSource({
            productionMode: true,
            releaseId: null,
            environmentName: value,
          }),
        VeryfrontError,
        "environment name must be a bounded non-empty canonical identifier",
      );
      assertThrows(
        () => requireWorkflowContentSource({ productionMode: false, branch: value }),
        VeryfrontError,
        "branch must be a bounded non-empty canonical identifier",
      );
    }
  });

  it("accepts a source identifier at the shared opaque-ID limit", () => {
    const releaseId = "x".repeat(MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS);
    assertEquals(
      requireWorkflowContentSource({ productionMode: true, releaseId }),
      { type: "release", releaseId },
    );
  });

  it("does not reinterpret an invalid release ID as environment authority", () => {
    assertThrows(
      () =>
        requireWorkflowContentSource({
          productionMode: true,
          releaseId: " ",
          environmentName: "Production",
        }),
      VeryfrontError,
      "release ID must be a bounded non-empty canonical identifier",
    );
  });

  it("reads only own data properties and never invokes authority accessors", () => {
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

    assertThrows(
      () => requireWorkflowContentSource(authority),
      VeryfrontError,
      "must contain only own data properties",
    );
    assertEquals(getterCalls, 0);

    const inherited = Object.create({
      productionMode: false,
      branch: "inherited-branch",
    }) as WorkflowSourceAuthority;
    assertThrows(
      () => requireWorkflowContentSource(inherited),
      VeryfrontError,
      "productionMode must be an explicit boolean",
    );
  });

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

  it("fails closed when authority descriptors cannot be inspected", () => {
    const authority = new Proxy({ productionMode: false, branch: "main" }, {
      getOwnPropertyDescriptor() {
        throw new Error("project trap");
      },
    });

    assertThrows(
      () => requireWorkflowContentSource(authority),
      VeryfrontError,
      "must contain only own data properties",
    );
  });

  it("requires explicit source authority for the selected runtime mode", () => {
    assertThrows(
      () => requireWorkflowContentSource({ productionMode: true }),
      VeryfrontError,
      "requires a release ID or environment name",
    );
    assertThrows(
      () => requireWorkflowContentSource({ productionMode: false }),
      VeryfrontError,
      "requires an explicit branch",
    );
    assertThrows(
      () =>
        requireWorkflowContentSource(
          { productionMode: undefined } as unknown as WorkflowSourceAuthority,
        ),
      VeryfrontError,
      "productionMode must be an explicit boolean",
    );
  });
});

describe("workflow API base URL", () => {
  it("returns one canonical representation", () => {
    assertEquals(
      requireWorkflowApiBaseUrl("HTTPS://API.Example.TEST:443/v1/../api///"),
      "https://api.example.test/api",
    );
    assertEquals(
      requireWorkflowApiBaseUrl("https://api.example.test"),
      "https://api.example.test",
    );
    assertEquals(
      requireWorkflowApiBaseUrl("https://api.example.test/"),
      "https://api.example.test",
    );
  });

  it("enforces the URL input and canonical-output bounds", () => {
    const prefix = "https://api.example.test/";
    const exactLimit = prefix + "a".repeat(MAX_URL_LENGTH_FOR_VALIDATION - prefix.length);
    assertEquals(requireWorkflowApiBaseUrl(exactLimit), exactLimit);

    assertThrows(
      () => requireWorkflowApiBaseUrl(`${exactLimit}a`),
      VeryfrontError,
      "bounded canonical HTTP(S) URL",
    );

    const expandingPath = prefix + "\u00e9".repeat(400);
    assertEquals(expandingPath.length < MAX_URL_LENGTH_FOR_VALIDATION, true);
    assertThrows(
      () => requireWorkflowApiBaseUrl(expandingPath),
      VeryfrontError,
      "bounded canonical HTTP(S) URL",
    );
  });

  it("rejects whitespace, controls, and unsupported URL components", () => {
    const invalidValues: Array<string | undefined> = [
      undefined,
      "",
      " https://api.example.test",
      "https://api.example.test ",
      "https://api.example.test/control\u0000value",
      "https://api.example.test/control\u0085value",
      "ftp://api.example.test",
      "https://user:password@api.example.test",
      "https://api.example.test?",
      "https://api.example.test?source=preview",
      "https://api.example.test#",
      "https://api.example.test#source",
      "not a URL",
    ];

    for (const value of invalidValues) {
      assertThrows(() => requireWorkflowApiBaseUrl(value), VeryfrontError);
    }
  });
});
