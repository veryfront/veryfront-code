/**
 * Composition globalThis hardening tests
 *
 * Verifies that the globalThis bridge properties (__vfGetAgent,
 * __vfRegisterAgent, __vfGetAllAgentIds) are non-writable,
 * non-enumerable, and non-configurable.
 *
 * @module agent/composition/composition.test
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

// Side-effect import: registers the globalThis bridges
import "./composition.ts";

const BRIDGE_KEYS = ["__vfGetAgent", "__vfRegisterAgent", "__vfGetAllAgentIds"] as const;

describe("globalThis agent registry bridges", () => {
  for (const key of BRIDGE_KEYS) {
    describe(key, () => {
      it("should be defined on globalThis", () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
        assertEquals(descriptor !== undefined, true, `${key} should exist on globalThis`);
        assertEquals(typeof descriptor!.value, "function", `${key} should be a function`);
      });

      it("should be non-writable", () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)!;
        assertEquals(descriptor.writable, false, `${key} should not be writable`);
      });

      it("should be non-enumerable", () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)!;
        assertEquals(descriptor.enumerable, false, `${key} should not be enumerable`);
      });

      it("should be non-configurable", () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)!;
        assertEquals(descriptor.configurable, false, `${key} should not be configurable`);
      });

      it("should throw on assignment in strict mode", () => {
        assertThrows(
          () => {
            "use strict";
            (globalThis as Record<string, unknown>)[key] = () => {};
          },
          TypeError,
        );
      });

      it("should not appear in Object.keys(globalThis)", () => {
        const keys = Object.keys(globalThis);
        assertEquals(keys.includes(key), false, `${key} should not be enumerable`);
      });

      it("should not be deletable", () => {
        assertThrows(
          () => {
            "use strict";
            delete (globalThis as Record<string, unknown>)[key];
          },
          TypeError,
        );
      });

      it("should not be reconfigurable", () => {
        assertThrows(
          () => {
            Object.defineProperty(globalThis, key, { value: () => {} });
          },
          TypeError,
        );
      });
    });
  }
});
