/**
 * Tests for error tracing integration
 */

import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";
import { attachErrorToActiveSpan, attachErrorToSpan } from "./tracing.ts";
import { CONFIG_NOT_FOUND, RENDER_ERROR } from "./error-registry.ts";
import type { Span } from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";

describe("tracing", () => {
  describe("attachErrorToSpan", () => {
    it("should set span status to ERROR with error title", () => {
      const statusCalls: Array<{ code: number; message: string }> = [];

      const mockSpan: Span = {
        setStatus: (status) => {
          statusCalls.push(status);
        },
        setAttributes: () => {},
        addEvent: () => {},
      } as unknown as Span;

      const error = CONFIG_NOT_FOUND.create({
        detail: "Missing config file",
      });

      attachErrorToSpan(error, mockSpan);

      assertEquals(statusCalls.length, 1);
      assertEquals(statusCalls[0].code, SpanStatusCode.ERROR);
      assertEquals(statusCalls[0].message, "Configuration file not found");
    });

    it("should set error attributes with slug, category, and status", () => {
      const attributeCalls: Array<Record<string, string | number>> = [];

      const mockSpan: Span = {
        setStatus: () => {},
        setAttributes: (attributes) => {
          attributeCalls.push(attributes as Record<string, string | number>);
        },
        addEvent: () => {},
      } as unknown as Span;

      const error = CONFIG_NOT_FOUND.create();

      attachErrorToSpan(error, mockSpan);

      assertEquals(attributeCalls.length, 1);
      assertEquals(attributeCalls[0]["error.slug"], "config-not-found");
      assertEquals(attributeCalls[0]["error.category"], "CONFIG");
      assertEquals(attributeCalls[0]["error.status"], 404);
    });

    it("should add error event with slug and detail", () => {
      const eventCalls: Array<{ name: string; attributes: Record<string, string> }> = [];

      const mockSpan: Span = {
        setStatus: () => {},
        setAttributes: () => {},
        addEvent: (name, attributes) => {
          eventCalls.push({ name, attributes: attributes as Record<string, string> });
        },
      } as unknown as Span;

      const error = RENDER_ERROR.create({
        detail: "Component threw during render",
      });

      attachErrorToSpan(error, mockSpan);

      assertEquals(eventCalls.length, 1);
      assertEquals(eventCalls[0].name, "error");
      assertEquals(eventCalls[0].attributes["error.slug"], "render-error");
      assertEquals(eventCalls[0].attributes["error.detail"], "Component threw during render");
      assertEquals(
        eventCalls[0].attributes["error.suggestion"],
        "Check component for runtime errors",
      );
    });

    it("should handle errors without detail or suggestion", () => {
      const eventCalls: Array<{ name: string; attributes: Record<string, string> }> = [];

      const mockSpan: Span = {
        setStatus: () => {},
        setAttributes: () => {},
        addEvent: (name, attributes) => {
          eventCalls.push({ name, attributes: attributes as Record<string, string> });
        },
      } as unknown as Span;

      const error = RENDER_ERROR.create();

      attachErrorToSpan(error, mockSpan);

      assertEquals(eventCalls.length, 1);
      // RENDER_ERROR has no detail by default
      assertEquals(eventCalls[0].attributes["error.detail"], "");
      // RENDER_ERROR has a default suggestion
      assertEquals(
        eventCalls[0].attributes["error.suggestion"],
        "Check component for runtime errors",
      );
    });

    it("should handle different error types", () => {
      const attributeCalls: Array<Record<string, string | number>> = [];

      const mockSpan: Span = {
        setStatus: () => {},
        setAttributes: (attributes) => {
          attributeCalls.push(attributes as Record<string, string | number>);
        },
        addEvent: () => {},
      } as unknown as Span;

      const error = RENDER_ERROR.create();

      attachErrorToSpan(error, mockSpan);

      assertEquals(attributeCalls[0]["error.slug"], "render-error");
      assertEquals(attributeCalls[0]["error.category"], "RUNTIME");
      assertEquals(attributeCalls[0]["error.status"], 500);
    });
  });

  describe("attachErrorToActiveSpan", () => {
    it("should attach error to active span when available", () => {
      const statusCalls: Array<{ code: number; message: string }> = [];

      const mockSpan: Span = {
        setStatus: (status) => {
          statusCalls.push(status);
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
      assertEquals(statusCalls[0].code, SpanStatusCode.ERROR);
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
