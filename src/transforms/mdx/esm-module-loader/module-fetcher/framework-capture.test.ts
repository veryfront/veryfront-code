import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join, resolve, toFileUrl } from "#veryfront/compat/path";
import {
  FRAMEWORK_ROOT,
  FRAMEWORK_SRC_DIR,
} from "#veryfront/platform/compat/framework-source-resolver.ts";
import {
  isCompiledFrameworkImage,
  publishedRuntimeHelperPath,
  resolveCapturedFrameworkReference,
} from "./framework-capture.ts";

describe("captured framework references", () => {
  it("distinguishes the active VFS mount from native and self-extracted roots", () => {
    const image = resolve("deno-compile-app");
    const native = resolve("app");
    assertEquals(
      isCompiledFrameworkImage(toFileUrl(join(image, "main.ts")).href, image),
      true,
    );
    assertEquals(
      isCompiledFrameworkImage(
        toFileUrl(join(image, "main.ts")).href,
        resolve("deno-compile-other"),
      ),
      false,
    );
    assertEquals(
      isCompiledFrameworkImage(toFileUrl(join(native, "src/main.ts")).href, native),
      false,
    );
    assertEquals(
      isCompiledFrameworkImage(
        toFileUrl(join(native, ".binary/hash/src/main.ts")).href,
        join(native, ".binary/hash"),
      ),
      false,
    );
    assertEquals(
      isCompiledFrameworkImage("https://example.invalid/main.ts", image),
      false,
    );
  });
  it("binds DNT helpers to the framework package, not the project", () => {
    assertEquals(
      resolveCapturedFrameworkReference(
        "../../_dnt.shims.js",
        join(FRAMEWORK_SRC_DIR, "react/server-render-context.js"),
      ),
      "/_vf_modules/_veryfront/_dnt.shims.js",
    );
    assertEquals(
      publishedRuntimeHelperPath("_dnt.shims.js"),
      join(FRAMEWORK_ROOT, "_dnt.shims.js"),
    );
    assertEquals(publishedRuntimeHelperPath("../_dnt.shims.js"), undefined);
  });
  it("resolves helper and source dependencies within the same package", () => {
    assertEquals(
      resolveCapturedFrameworkReference("./deno.js", join(FRAMEWORK_ROOT, "_dnt.shims.js")),
      "/_vf_modules/_veryfront/deno.js",
    );
    assertEquals(
      resolveCapturedFrameworkReference(
        "../head-collector.js",
        join(FRAMEWORK_SRC_DIR, "react/components/Head.tsx"),
      ),
      "/_vf_modules/_veryfront/react/head-collector.js",
    );
  });
  it("rejects package escapes and leaves bare imports to the import resolver", () => {
    assertThrows(
      () =>
        resolveCapturedFrameworkReference(
          "../../../outside.js",
          join(FRAMEWORK_SRC_DIR, "react/server-render-context.js"),
        ),
      TypeError,
      "escapes",
    );
    assertEquals(
      resolveCapturedFrameworkReference("react", join(FRAMEWORK_SRC_DIR, "react/context.ts")),
      undefined,
    );
  });
});
