import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for error tracing integration
 */

import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";
import { attachErrorToActiveSpan, attachErrorToSpan } from "./tracing.ts";
import { CONFIG_NOT_FOUND, RENDER_ERROR } from "./error-registry.ts";
import type { Span } from "#veryfront/observability/tracing/api-shim.ts";
import { SpanStatusCode } from "#veryfront/observability/tracing/api-shim.ts";

function firstCall<T>(calls: T[]): T {
  const call = calls[0];
  if (call === undefined) throw new Error("Expected a captured span call");
  return call;
}

describe("tracing", () => {
  describe("attachErrorToSpan", () => {
    it("should set span status to ERROR with a stable error slug", () => {
      const statusCalls: Array<{ code: number; message: string }> = [];

      const mockSpan: Span = {
        setStatus: (status: { code: number; message?: string }) => {
          statusCalls.push({ code: status.code, message: status.message ?? "" });
        },
        setAttributes: () => {},
        addEvent: () => {},
      } as unknown as Span;

      const error = CONFIG_NOT_FOUND.create({
        detail: "Missing config file",
      });

      attachErrorToSpan(error, mockSpan);

      assertEquals(statusCalls.length, 1);
      const status = firstCall(statusCalls);
      assertEquals(status.code, SpanStatusCode.ERROR);
      assertEquals(status.message, "config-not-found");
    });

    it("should set error attributes with slug, category, and status", () => {
      const attributeCalls: Array<Record<string, string | number>> = [];

      const mockSpan: Span = {
        setStatus: () => {},
        setAttributes: (attributes: unknown) => {
          attributeCalls.push(attributes as Record<string, string | number>);
        },
        addEvent: () => {},
      } as unknown as Span;

      const error = CONFIG_NOT_FOUND.create();

      attachErrorToSpan(error, mockSpan);

      assertEquals(attributeCalls.length, 1);
      const attributes = firstCall(attributeCalls);
      assertEquals(attributes["error.slug"], "config-not-found");
      assertEquals(attributes["error.category"], "CONFIG");
      assertEquals(attributes["error.status"], 404);
    });

    it("should add an error event without raw diagnostic text", () => {
      const eventCalls: Array<{
        name: string;
        attributes: Record<string, string | number>;
      }> = [];

      const mockSpan: Span = {
        setStatus: () => {},
        setAttributes: () => {},
        addEvent: (name: string, attributes?: unknown) => {
          eventCalls.push({
            name,
            attributes: attributes as Record<string, string | number>,
          });
        },
      } as unknown as Span;

      const error = RENDER_ERROR.create({
        detail: "Component threw during render",
      });

      attachErrorToSpan(error, mockSpan);

      assertEquals(eventCalls.length, 1);
      const event = firstCall(eventCalls);
      assertEquals(event.name, "error");
      assertEquals(event.attributes["error.slug"], "render-error");
      assertEquals(event.attributes["error.detail"], undefined);
      assertEquals(event.attributes["error.suggestion"], undefined);
      assertEquals(JSON.stringify(eventCalls).includes("Component threw during render"), false);
    });

    it("should handle errors without detail or suggestion", () => {
      const eventCalls: Array<{
        name: string;
        attributes: Record<string, string | number>;
      }> = [];

      const mockSpan: Span = {
        setStatus: () => {},
        setAttributes: () => {},
        addEvent: (name: string, attributes?: unknown) => {
          eventCalls.push({
            name,
            attributes: attributes as Record<string, string | number>,
          });
        },
      } as unknown as Span;

      const error = RENDER_ERROR.create();

      attachErrorToSpan(error, mockSpan);

      assertEquals(eventCalls.length, 1);
      const event = firstCall(eventCalls);
      assertEquals(event.attributes["error.detail"], undefined);
      assertEquals(event.attributes["error.suggestion"], undefined);
    });

    it("should handle different error types", () => {
      const attributeCalls: Array<Record<string, string | number>> = [];

      const mockSpan: Span = {
        setStatus: () => {},
        setAttributes: (attributes: unknown) => {
          attributeCalls.push(attributes as Record<string, string | number>);
        },
        addEvent: () => {},
      } as unknown as Span;

      const error = RENDER_ERROR.create();

      attachErrorToSpan(error, mockSpan);

      const attributes = firstCall(attributeCalls);
      assertEquals(attributes["error.slug"], "render-error");
      assertEquals(attributes["error.category"], "RUNTIME");
      assertEquals(attributes["error.status"], 500);
    });
  });

  describe("attachErrorToActiveSpan", () => {
    it("should attach error to active span when available", () => {
      const statusCalls: Array<{ code: number; message: string }> = [];

      const mockSpan: Span = {
        setStatus: (status: { code: number; message?: string }) => {
          statusCalls.push({ code: status.code, message: status.message ?? "" });
        },
        setAttributes: () => {},
        addEvent: () => {},
      } as unknown as Span;

      const mockTrace = {
        getActiveSpan: () => mockSpan,
      };

      const error = CONFIG_NOT_FOUND.create();

      attachErrorToActiveSpan(error, mockTrace);

      assertEquals(statusCalls.length, 1);
      assertEquals(firstCall(statusCalls).code, SpanStatusCode.ERROR);
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
