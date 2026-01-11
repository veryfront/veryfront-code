import { assertEquals, assertExists } from "jsr:@std/assert@1";
import {
  checkVersionCompatibility,
  detectReactVersion,
  getReactVersionInfo,
  getRecommendedSSRMethod,
  hasFeature,
} from "../index.ts";

Deno.test("React version detection", async (t) => {
  await t.step("should detect React version", () => {
    const info = detectReactVersion();

    assertExists(info.version);
    assertExists(info.major);
    assertExists(info.minor);
    assertExists(info.patch);
    assertEquals(typeof info.isReact17, "boolean");
    assertEquals(typeof info.isReact18, "boolean");
    assertEquals(typeof info.isReact19, "boolean");
  });

  await t.step("should detect React features", () => {
    const info = getReactVersionInfo();

    assertExists(info.features);
    assertEquals(typeof info.features.suspense, "boolean");
    assertEquals(typeof info.features.streaming, "boolean");
    assertEquals(typeof info.features.renderToString, "boolean");
  });

  await t.step("should cache version info", () => {
    const info1 = getReactVersionInfo();
    const info2 = getReactVersionInfo();

    assertEquals(info1, info2); // Should be the same reference
  });
});

Deno.test("Feature detection", async (t) => {
  await t.step("should check if feature exists", () => {
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

Deno.test("SSR method recommendation", async (t) => {
  await t.step("should recommend appropriate SSR method", () => {
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

Deno.test("Version compatibility check", async (t) => {
  await t.step("should check compatibility for required features", () => {
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
