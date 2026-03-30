import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  formatJsonOutput,
  getOutputPath,
  isJsonMode,
  setJsonMode,
  setOutputPath,
  streamJsonLine,
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
      setJsonMode(false);
    });

    it("can toggle back to false", () => {
      setJsonMode(true);
      setJsonMode(false);
      assertEquals(isJsonMode(), false);
    });
  });

  describe("setOutputPath / getOutputPath", () => {
    it("defaults to null", () => {
      setOutputPath(null);
      assertEquals(getOutputPath(), null);
    });

    it("stores a path", () => {
      setOutputPath("/tmp/output.json");
      assertEquals(getOutputPath(), "/tmp/output.json");
      setOutputPath(null);
    });

    it("can be reset to null", () => {
      setOutputPath("/tmp/test.json");
      setOutputPath(null);
      assertEquals(getOutputPath(), null);
    });
  });

  describe("createSuccessEnvelope", () => {
    it("creates envelope with command and data", () => {
      const envelope = createSuccessEnvelope("deploy", {
        url: "https://example.com",
      });
      assertEquals(envelope.success, true);
      assertEquals(envelope.command, "deploy");
      assertEquals(envelope.data, { url: "https://example.com" });
    });

    it("includes timing when provided", () => {
      const envelope = createSuccessEnvelope("build", { chunks: 5 }, {
        duration_ms: 3200,
      });
      assertEquals(envelope.timing, { duration_ms: 3200 });
    });

    it("omits timing when not provided", () => {
      const envelope = createSuccessEnvelope("whoami", { user: "test" });
      assertEquals(envelope.timing, undefined);
    });

    it("handles empty data object", () => {
      const envelope = createSuccessEnvelope("clean", {});
      assertEquals(envelope.success, true);
      assertEquals(envelope.data, {});
    });

    it("handles null data", () => {
      const envelope = createSuccessEnvelope("test", null);
      assertEquals(envelope.data, null);
    });

    it("handles array data", () => {
      const envelope = createSuccessEnvelope("list", [1, 2, 3]);
      assertEquals(envelope.data, [1, 2, 3]);
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

    it("omits context when not provided", () => {
      const envelope = createErrorEnvelope("test", {
        code: "TEST_ERROR",
        slug: "test-failed",
        message: "Tests failed",
      });
      assertEquals(envelope.error.context, undefined);
    });
  });

  describe("formatJsonOutput", () => {
    it("returns pretty-printed JSON string", () => {
      const output = formatJsonOutput({
        success: true,
        command: "test",
        data: {},
      });
      assertEquals(
        output,
        JSON.stringify({ success: true, command: "test", data: {} }, null, 2),
      );
    });

    it("preserves nested structure", () => {
      const envelope = createSuccessEnvelope("deploy", {
        release: { id: "123", version: "1.0" },
      });
      const output = formatJsonOutput(envelope);
      const parsed = JSON.parse(output);
      assertEquals(parsed.data.release.id, "123");
    });

    it("error envelope is valid JSON", () => {
      const envelope = createErrorEnvelope("cmd", {
        code: "ERR",
        slug: "s",
        message: "m",
      });
      const output = formatJsonOutput(envelope);
      const parsed = JSON.parse(output);
      assertEquals(parsed.success, false);
      assertEquals(parsed.error.code, "ERR");
    });
  });

  describe("streamJsonLine", () => {
    it("is a function", () => {
      assertEquals(typeof streamJsonLine, "function");
    });
  });
});
