import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BUILD_FAILED,
  BUILD_REGISTRY,
  COMPILATION_ERROR,
  MDX_COMPILE_ERROR,
} from "./error-registry/build.ts";
import { isTenantSourceBuildError } from "./tenant-classification.ts";

describe("errors/tenant-classification", () => {
  it("uses the Set membership intrinsic captured during module initialization", () => {
    const previous = Object.getOwnPropertyDescriptor(Set.prototype, "has");
    if (!previous || typeof previous.value !== "function") {
      throw new Error("Expected Set.prototype.has descriptor");
    }
    Object.defineProperty(Set.prototype, "has", {
      ...previous,
      value: () => true,
    });

    try {
      assertEquals(isTenantSourceBuildError(BUILD_FAILED.create()), false);
      assertEquals(isTenantSourceBuildError(MDX_COMPILE_ERROR.create()), true);
    } finally {
      Object.defineProperty(Set.prototype, "has", previous);
    }
  });

  it("classifies every BUILD registry slug and holds framework faults out", () => {
    // Derived from the registry rather than a hand-picked sample: a slug added
    // to either the registry or TENANT_BUILD_ERROR_SLUGS must be classified
    // here deliberately instead of inheriting a default verdict.
    const expectedTenantSlugs = [
      "markdown-compile-error",
      "mdx-compile-error",
      "typescript-error",
    ];
    const classifiedTenantSlugs: string[] = [];

    for (const [slug, definition] of Object.entries(BUILD_REGISTRY)) {
      const expected = expectedTenantSlugs.includes(slug);
      const actual = isTenantSourceBuildError(definition.create());
      assertEquals(
        actual,
        expected,
        `${slug} must classify as ${expected ? "tenant source" : "a framework fault"}`,
      );
      if (actual) classifiedTenantSlugs.push(slug);
    }

    assertEquals(
      classifiedTenantSlugs.sort(),
      expectedTenantSlugs,
      "tenant-source classification covers exactly the tenant-authored compile failures",
    );
  });

  it("requires an own data context marker without invoking accessors", () => {
    const inheritedContext = Object.create({ tenantBuildFailure: true });
    assertEquals(
      isTenantSourceBuildError(COMPILATION_ERROR.create({ context: inheritedContext })),
      false,
    );

    let getterRead = false;
    const accessorContext = Object.defineProperty({}, "tenantBuildFailure", {
      configurable: true,
      get() {
        getterRead = true;
        return true;
      },
    });
    const previousDescriptorValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      value: true,
    });
    try {
      assertEquals(
        isTenantSourceBuildError(COMPILATION_ERROR.create({ context: accessorContext })),
        false,
      );
      assertEquals(getterRead, false);
    } finally {
      if (previousDescriptorValue) {
        Object.defineProperty(Object.prototype, "value", previousDescriptorValue);
      } else {
        delete (Object.prototype as { value?: unknown }).value;
      }
    }
  });

  it("ignores Object prototype pollution while preserving explicit context markers", () => {
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "tenantBuildFailure");
    Object.defineProperty(Object.prototype, "tenantBuildFailure", {
      configurable: true,
      value: true,
    });

    try {
      assertEquals(
        isTenantSourceBuildError(COMPILATION_ERROR.create({ context: {} })),
        false,
      );
      assertEquals(
        isTenantSourceBuildError(
          COMPILATION_ERROR.create({ context: { tenantBuildFailure: true } }),
        ),
        true,
      );
    } finally {
      if (previous) {
        Object.defineProperty(Object.prototype, "tenantBuildFailure", previous);
      } else {
        delete (Object.prototype as { tenantBuildFailure?: unknown }).tenantBuildFailure;
      }
    }
  });
});
