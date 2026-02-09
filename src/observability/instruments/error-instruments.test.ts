/**
 * Tests for error metrics instruments
 */

import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";
import { recordError } from "./error-instruments.ts";
import { CONFIG_NOT_FOUND, RENDER_ERROR } from "#veryfront/errors/error-registry.ts";
import type { Counter } from "@opentelemetry/api";

describe("error-instruments", () => {
  describe("recordError", () => {
    it("should record error with slug, category, and status labels", () => {
      const calls: Array<{ value: number; attributes: Record<string, string> }> = [];

      const mockCounter: Counter = {
        add: (value, attributes) => {
          calls.push({ value, attributes: attributes as Record<string, string> });
        },
      } as Counter;

      const error = CONFIG_NOT_FOUND.create({
        detail: "Missing config file",
      });

      recordError(error, mockCounter);

      assertEquals(calls.length, 1);
      assertEquals(calls[0].value, 1);
      assertEquals(calls[0].attributes.slug, "config-not-found");
      assertEquals(calls[0].attributes.category, "CONFIG");
      assertEquals(calls[0].attributes.status, "404");
    });

    it("should handle different error types", () => {
      const calls: Array<{ value: number; attributes: Record<string, string> }> = [];

      const mockCounter: Counter = {
        add: (value, attributes) => {
          calls.push({ value, attributes: attributes as Record<string, string> });
        },
      } as Counter;

      const error = RENDER_ERROR.create();

      recordError(error, mockCounter);

      assertEquals(calls.length, 1);
      assertEquals(calls[0].attributes.slug, "render-error");
      assertEquals(calls[0].attributes.category, "RUNTIME");
      assertEquals(calls[0].attributes.status, "500");
    });

    it("should do nothing when counter is null", () => {
      const error = CONFIG_NOT_FOUND.create();

      // Should not throw
      recordError(error, null);
    });

    it("should do nothing when counter is undefined", () => {
      const error = CONFIG_NOT_FOUND.create();

      // Should not throw
      recordError(error, undefined);
    });

    it("should convert status to string", () => {
      const calls: Array<{ value: number; attributes: Record<string, string> }> = [];

      const mockCounter: Counter = {
        add: (value, attributes) => {
          calls.push({ value, attributes: attributes as Record<string, string> });
        },
      } as Counter;

      const error = CONFIG_NOT_FOUND.create();

      recordError(error, mockCounter);

      assertEquals(typeof calls[0].attributes.status, "string");
      assertEquals(calls[0].attributes.status, "404");
    });
  });
});
