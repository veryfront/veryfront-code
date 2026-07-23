import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for error metrics instruments
 */

import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { recordError } from "./error-instruments.ts";
import { CONFIG_NOT_FOUND, RENDER_ERROR } from "#veryfront/errors/error-registry.ts";
import type { Counter } from "#veryfront/observability/tracing/api-shim.ts";

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
      const call = calls[0];
      assertExists(call);
      assertEquals(call.value, 1);
      assertEquals(call.attributes.slug, "config-not-found");
      assertEquals(call.attributes.category, "CONFIG");
      assertEquals(call.attributes.status, "404");
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
      const call = calls[0];
      assertExists(call);
      assertEquals(call.attributes.slug, "render-error");
      assertEquals(call.attributes.category, "RUNTIME");
      assertEquals(call.attributes.status, "500");
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

    it("does not let a metrics backend failure escape", () => {
      const error = CONFIG_NOT_FOUND.create();
      const counter = {
        add() {
          throw new Error("metrics backend unavailable");
        },
      } as Counter;

      recordError(error, counter);
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

      const call = calls[0];
      assertExists(call);
      assertEquals(typeof call.attributes.status, "string");
      assertEquals(call.attributes.status, "404");
    });
  });
});
