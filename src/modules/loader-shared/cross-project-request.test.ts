import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertCrossProjectReference,
  buildCrossProjectRegistryUrl,
  normalizeCrossProjectModulePath,
  normalizeCrossProjectRegistryBaseUrl,
} from "./cross-project-request.ts";

describe("modules/loader-shared/cross-project-request", () => {
  it("decodes each encoded path segment exactly once", () => {
    assertEquals(
      normalizeCrossProjectModulePath("components/Hello%20world.tsx", {
        percentEncoded: true,
      }),
      "components/Hello world.tsx",
    );
    assertEquals(
      normalizeCrossProjectModulePath("components/%252e%252e.ts", {
        percentEncoded: true,
      }),
      "components/%2e%2e.ts",
    );
  });

  it("rejects traversal and encoded segment separators", () => {
    for (
      const path of [
        "../secret.ts",
        "%2e%2e/secret.ts",
        "components%2fsecret.ts",
        "components%5csecret.ts",
        "components/%00secret.ts",
        "components//secret.ts",
      ]
    ) {
      assertThrows(
        () =>
          normalizeCrossProjectModulePath(path, {
            percentEncoded: true,
          }),
        TypeError,
      );
    }
  });

  it("validates project references", () => {
    assertCrossProjectReference("acme-ui", "1.2.3");
    assertCrossProjectReference("acme-ui", "latest");
    assertThrows(
      () => assertCrossProjectReference("../acme", "latest"),
      TypeError,
      "slug is invalid",
    );
    assertThrows(
      () => assertCrossProjectReference("-acme", "latest"),
      TypeError,
      "slug is invalid",
    );
    assertThrows(
      () => assertCrossProjectReference("acme", "v1"),
      TypeError,
      "version is invalid",
    );
  });

  it("normalizes and validates registry base URLs", () => {
    assertEquals(
      normalizeCrossProjectRegistryBaseUrl(" https://registry.example.com/api/// "),
      "https://registry.example.com",
    );
    assertThrows(
      () => normalizeCrossProjectRegistryBaseUrl("file:///tmp/registry/api"),
      TypeError,
      "HTTP or HTTPS",
    );
    assertThrows(
      () => normalizeCrossProjectRegistryBaseUrl("https://user@registry.example.com/api"),
      TypeError,
      "credentials",
    );
  });

  it("constructs canonical encoded registry URLs", () => {
    assertEquals(
      buildCrossProjectRegistryUrl({
        registryBaseUrl: "https://registry.example.com/api",
        projectSlug: "acme-ui",
        version: "1.2.3",
        modulePath: "components/Hello world.tsx",
      }),
      "https://registry.example.com/acme-ui@1.2.3/@/components/Hello%20world.tsx",
    );
    assertEquals(
      buildCrossProjectRegistryUrl({
        registryBaseUrl: "https://registry.example.com/api",
        projectSlug: "acme-ui",
        version: "latest",
        modulePath: "index.ts",
      }),
      "https://registry.example.com/acme-ui/@/index.ts",
    );
    assertEquals(
      buildCrossProjectRegistryUrl({
        registryBaseUrl: "https://registry.example.com/api",
        projectSlug: "acme-ui",
        version: "latest",
        modulePath: "index.ts",
        includeLatestVersion: true,
      }),
      "https://registry.example.com/acme-ui@latest/@/index.ts",
    );
  });
});
