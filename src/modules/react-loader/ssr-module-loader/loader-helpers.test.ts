import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { classifyImportError, createTransformCapacityError } from "./loader-helpers.ts";

describe("ssr-module-loader helpers", () => {
  it("classifies missing http bundle imports", () => {
    assertEquals(
      classifyImportError(
        new Error("Cannot find module '/tmp/veryfront-http-bundle/http-deadbeef.mjs'"),
      ),
      {
        type: "http-bundle-missing",
        hash: "deadbeef",
        message: "Cannot find module '/tmp/veryfront-http-bundle/http-deadbeef.mjs'",
      },
    );
  });

  it("classifies missing module errors", () => {
    assertEquals(
      classifyImportError(new Error("Module not found: ./missing.ts")),
      { type: "module-not-found", message: "Module not found: ./missing.ts" },
    );
  });

  it("classifies unknown errors", () => {
    assertEquals(
      classifyImportError("permission denied"),
      { type: "unknown", message: "permission denied" },
    );
  });

  it("creates plain capacity errors", () => {
    const error = createTransformCapacityError("plain", "Too busy", "/tmp/file.tsx");
    assertEquals(error.message, "Too busy");
    assertEquals(error.name, "Error");
  });

  it("creates build capacity errors with the requested message", () => {
    const error = createTransformCapacityError("build", "Too busy", "/tmp/file.tsx");
    assertEquals(error.message, "Too busy");
    assertEquals(error.name.length > 0, true);
  });
});
