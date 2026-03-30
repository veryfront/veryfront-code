import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  formatJsonOutput,
  isJsonMode,
  setJsonMode,
} from "./json-output.ts";

describe("json-output", () => {
  describe("isJsonMode / setJsonMode", () => {
    it("defaults to false", () => {
      setJsonMode(false);
      assertEquals(isJsonMode(), false);
    });

    it("can be set to true", () => {
      setJsonMode(true);
      assertEquals(isJsonMode(), true);
      setJsonMode(false); // cleanup
    });
  });

  describe("createSuccessEnvelope", () => {
    it("creates envelope with command and data", () => {
      const envelope = createSuccessEnvelope("deploy", { url: "https://example.com" });
      assertEquals(envelope.success, true);
      assertEquals(envelope.command, "deploy");
      assertEquals(envelope.data, { url: "https://example.com" });
    });

    it("includes timing when provided", () => {
      const envelope = createSuccessEnvelope("build", { chunks: 5 }, { duration_ms: 3200 });
      assertEquals(envelope.timing, { duration_ms: 3200 });
    });

    it("omits timing when not provided", () => {
      const envelope = createSuccessEnvelope("whoami", { user: "test" });
      assertEquals(envelope.timing, undefined);
    });
  });

  describe("createErrorEnvelope", () => {
    it("creates error envelope with code and message", () => {
      const envelope = createErrorEnvelope("deploy", {
        code: "PERMISSION_ERROR",
        slug: "deploy-not-authorized",
        message: "Not authorized to deploy",
      });
      assertEquals(envelope.success, false);
      assertEquals(envelope.command, "deploy");
      assertEquals(envelope.error.code, "PERMISSION_ERROR");
      assertEquals(envelope.error.slug, "deploy-not-authorized");
      assertEquals(envelope.error.message, "Not authorized to deploy");
    });

    it("includes context when provided", () => {
      const envelope = createErrorEnvelope("build", {
        code: "BUILD_ERROR",
        slug: "build-failed",
        message: "Build failed",
        context: { file: "index.tsx" },
      });
      assertEquals(envelope.error.context, { file: "index.tsx" });
    });
  });

  describe("formatJsonOutput", () => {
    it("returns pretty-printed JSON string", () => {
      const output = formatJsonOutput({ success: true, command: "test", data: {} });
      assertEquals(output, JSON.stringify({ success: true, command: "test", data: {} }, null, 2));
    });
  });
});
