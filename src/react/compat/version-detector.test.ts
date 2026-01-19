import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  checkVersionCompatibility,
  detectReactVersion,
  getReactVersionInfo,
  getRecommendedSSRMethod,
  hasFeature,
} from "../index.ts";

describe("React version detection", () => {
  it("should detect React version", () => {
    const info = detectReactVersion();

    assertExists(info.version);
    assertExists(info.major);
    assertExists(info.minor);
    assertExists(info.patch);
    assertEquals(typeof info.isReact17, "boolean");
    assertEquals(typeof info.isReact18, "boolean");
    assertEquals(typeof info.isReact19, "boolean");
  });

  it("should detect React features", () => {
    const info = getReactVersionInfo();

    assertExists(info.features);
    assertEquals(typeof info.features.suspense, "boolean");
    assertEquals(typeof info.features.streaming, "boolean");
    assertEquals(typeof info.features.renderToString, "boolean");
  });

  it("should cache version info", () => {
    const info1 = getReactVersionInfo();
    const info2 = getReactVersionInfo();

    assertEquals(info1, info2); // Should be the same reference
  });
});

describe("Feature detection", () => {
  it("should check if feature exists", () => {
    assertEquals(hasFeature("renderToString"), true);
    assertEquals(hasFeature("renderToStaticMarkup"), true);

    const info = getReactVersionInfo();
    if (info.isReact18 || info.isReact19) {
      assertEquals(hasFeature("streaming"), true);
      assertEquals(hasFeature("suspense"), true);
    }

    if (info.isReact19) {
      assertEquals(hasFeature("useFormStatus"), true);
      assertEquals(hasFeature("serverActions"), true);
    }
  });
});

describe("SSR method recommendation", () => {
  it("should recommend appropriate SSR method", () => {
    const method = getRecommendedSSRMethod();
    const info = getReactVersionInfo();

    if (info.isReact19) {
      assertEquals(method, "readable-stream");
    } else if (info.isReact18) {
      assertEquals(method === "stream" || method === "readable-stream", true);
    } else {
      assertEquals(method, "string");
    }
  });
});

describe("Version compatibility check", () => {
  it("should check compatibility for required features", () => {
    const info = getReactVersionInfo();

    const basicCheck = checkVersionCompatibility(["renderToString"]);
    assertEquals(basicCheck.compatible, true);
    assertEquals(basicCheck.errors.length, 0);

    if (info.isReact17) {
      const react18Check = checkVersionCompatibility(["streaming", "suspense"]);
      assertEquals(react18Check.compatible, false);
      assertEquals(react18Check.errors.length > 0, true);
    } else {
      const react18Check = checkVersionCompatibility(["streaming", "suspense"]);
      assertEquals(react18Check.compatible, true);
      assertEquals(react18Check.errors.length, 0);
    }

    if (!info.isReact19) {
      const react19Check = checkVersionCompatibility(["useFormStatus", "serverActions"]);
      assertEquals(react19Check.warnings.length > 0, true);
    }
  });
});
