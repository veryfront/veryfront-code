import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for error tracing integration
 */

import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { attachErrorToActiveSpan, attachErrorToSpan, type ErrorTraceSpan } from "./tracing.ts";
import { CONFIG_NOT_FOUND, RENDER_ERROR } from "./error-registry.ts";
import { SpanStatusCode } from "#veryfront/observability/tracing/api-shim.ts";

describe("tracing", () => {
  describe("attachErrorToSpan", () => {
    it("should set span status to ERROR with error title", () => {
      const statusCalls: Array<{ code: number; message?: string }> = [];

      const mockSpan: ErrorTraceSpan = {
        setStatus: (status) => {
          statusCalls.push(status);
        },
        setAttributes: () => {},
        addEvent: () => {},
      };

      const error = CONFIG_NOT_FOUND.create({
        detail: "Missing config file",
      });

      attachErrorToSpan(error, mockSpan);

      assertEquals(statusCalls.length, 1);
      const status = statusCalls[0];
      assertExists(status);
      assertEquals(status.code, SpanStatusCode.ERROR);
      assertEquals(status.message, "Configuration file not found");
    });

    it("should set error attributes with slug, category, and status", () => {
      const attributeCalls: Array<Record<string, string | number>> = [];

      const mockSpan: ErrorTraceSpan = {
        setStatus: () => {},
        setAttributes: (attributes) => {
          attributeCalls.push(attributes as Record<string, string | number>);
        },
        addEvent: () => {},
      };

      const error = CONFIG_NOT_FOUND.create();

      attachErrorToSpan(error, mockSpan);

      assertEquals(attributeCalls.length, 1);
      const attributes = attributeCalls[0];
      assertExists(attributes);
      assertEquals(attributes["error.slug"], "config-not-found");
      assertEquals(attributes["error.category"], "CONFIG");
      assertEquals(attributes["error.status"], 404);
    });

    it("should add only stable error identity to the event", () => {
      const eventCalls: Array<{ name: string; attributes: Record<string, string> }> = [];

      const mockSpan: ErrorTraceSpan = {
        setStatus: () => {},
        setAttributes: () => {},
        addEvent: (name, attributes) => {
          eventCalls.push({ name, attributes: attributes as Record<string, string> });
        },
      };

      const error = RENDER_ERROR.create({
        detail: "Component threw during render",
      });

      attachErrorToSpan(error, mockSpan);

      assertEquals(eventCalls.length, 1);
      const event = eventCalls[0];
      assertExists(event);
      assertEquals(event.name, "error");
      assertEquals(event.attributes["error.slug"], "render-error");
      assertEquals(event.attributes["error.detail"], undefined);
      assertEquals(event.attributes["error.suggestion"], undefined);
    });

    it("should handle errors without detail or suggestion", () => {
      const eventCalls: Array<{ name: string; attributes: Record<string, string> }> = [];

      const mockSpan: ErrorTraceSpan = {
        setStatus: () => {},
        setAttributes: () => {},
        addEvent: (name, attributes) => {
          eventCalls.push({ name, attributes: attributes as Record<string, string> });
        },
      };

      const error = RENDER_ERROR.create();

      attachErrorToSpan(error, mockSpan);

      assertEquals(eventCalls.length, 1);
      const event = eventCalls[0];
      assertExists(event);
      assertEquals(event.attributes, { "error.slug": "render-error" });
    });

    it("should handle different error types", () => {
      const attributeCalls: Array<Record<string, string | number>> = [];

      const mockSpan: ErrorTraceSpan = {
        setStatus: () => {},
        setAttributes: (attributes) => {
          attributeCalls.push(attributes as Record<string, string | number>);
        },
        addEvent: () => {},
      };

      const error = RENDER_ERROR.create();

      attachErrorToSpan(error, mockSpan);

      const attributes = attributeCalls[0];
      assertExists(attributes);
      assertEquals(attributes["error.slug"], "render-error");
      assertEquals(attributes["error.category"], "RUNTIME");
      assertEquals(attributes["error.status"], 500);
    });

    it("does not let a broken tracing implementation mask application errors", () => {
      const error = RENDER_ERROR.create({ detail: "private payload" });
      const mockSpan = {
        setStatus: () => {
          throw new Error("status failed");
        },
        setAttributes: () => {
          throw new Error("attributes failed");
        },
        addEvent: () => {
          throw new Error("event failed");
        },
      } as ErrorTraceSpan;

      attachErrorToSpan(error, mockSpan);
    });

    it("fails closed when mutable error identity is no longer valid", () => {
      const calls: Array<{ code: number; message?: string }> = [];
      const mockSpan: ErrorTraceSpan = {
        setStatus: (status) => calls.push(status),
        setAttributes: () => {},
        addEvent: () => {},
      };
      const error = RENDER_ERROR.create();
      Object.defineProperty(error, "title", {
        get() {
          throw new Error("getter leaked password=<TOKEN>");
        },
      });

      attachErrorToSpan(error, mockSpan);

      assertEquals(calls, [{ code: SpanStatusCode.ERROR, message: "Unknown/unclassified error" }]);
    });
  });

  describe("attachErrorToActiveSpan", () => {
    it("should attach error to active span when available", () => {
      const statusCalls: Array<{ code: number; message?: string }> = [];

      const mockSpan: ErrorTraceSpan = {
        setStatus: (status) => {
          statusCalls.push(status);
        },
        setAttributes: () => {},
        addEvent: () => {},
      };

      const mockTrace = {
        getActiveSpan: () => mockSpan,
      };

      const error = CONFIG_NOT_FOUND.create();

      attachErrorToActiveSpan(error, mockTrace);

      assertEquals(statusCalls.length, 1);
      const status = statusCalls[0];
      assertExists(status);
      assertEquals(status.code, SpanStatusCode.ERROR);
    });

    it("should do nothing when no active span", () => {
      const mockTrace = {
        getActiveSpan: () => undefined,
      };

      const error = CONFIG_NOT_FOUND.create();

      // Should not throw
      attachErrorToActiveSpan(error, mockTrace);
    });
  });
});
