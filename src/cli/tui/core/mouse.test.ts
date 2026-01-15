/**
 * Tests for mouse event handling
 */

import { assertEquals } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import {
  findHitArea,
  type HitArea,
  isInHitArea,
  type MouseEvent,
  parseMouseEvent,
} from "./mouse.ts";

describe("mouse", () => {
  describe("parseMouseEvent", () => {
    it("parses left click", () => {
      // SGR1006 format: \x1b[<0;10;5M = left press at (10, 5)
      const event = parseMouseEvent("\x1b[<0;10;5M");
      assertEquals(event?.type, "press");
      assertEquals(event?.button, "left");
      assertEquals(event?.x, 10);
      assertEquals(event?.y, 5);
      assertEquals(event?.modifiers.shift, false);
      assertEquals(event?.modifiers.alt, false);
      assertEquals(event?.modifiers.ctrl, false);
    });

    it("parses left release", () => {
      const event = parseMouseEvent("\x1b[<0;10;5m");
      assertEquals(event?.type, "release");
      assertEquals(event?.button, "left");
    });

    it("parses middle click", () => {
      const event = parseMouseEvent("\x1b[<1;20;10M");
      assertEquals(event?.button, "middle");
      assertEquals(event?.x, 20);
      assertEquals(event?.y, 10);
    });

    it("parses right click", () => {
      const event = parseMouseEvent("\x1b[<2;15;8M");
      assertEquals(event?.button, "right");
    });

    it("parses scroll up", () => {
      const event = parseMouseEvent("\x1b[<64;10;5M");
      assertEquals(event?.button, "scrollUp");
      assertEquals(event?.type, "press");
    });

    it("parses scroll down", () => {
      const event = parseMouseEvent("\x1b[<65;10;5M");
      assertEquals(event?.button, "scrollDown");
    });

    it("parses shift modifier", () => {
      // Button 0 + shift (4) = 4
      const event = parseMouseEvent("\x1b[<4;10;5M");
      assertEquals(event?.modifiers.shift, true);
      assertEquals(event?.modifiers.alt, false);
      assertEquals(event?.modifiers.ctrl, false);
    });

    it("parses alt modifier", () => {
      // Button 0 + alt (8) = 8
      const event = parseMouseEvent("\x1b[<8;10;5M");
      assertEquals(event?.modifiers.alt, true);
    });

    it("parses ctrl modifier", () => {
      // Button 0 + ctrl (16) = 16
      const event = parseMouseEvent("\x1b[<16;10;5M");
      assertEquals(event?.modifiers.ctrl, true);
    });

    it("parses combined modifiers", () => {
      // Button 0 + shift (4) + alt (8) + ctrl (16) = 28
      const event = parseMouseEvent("\x1b[<28;10;5M");
      assertEquals(event?.modifiers.shift, true);
      assertEquals(event?.modifiers.alt, true);
      assertEquals(event?.modifiers.ctrl, true);
    });

    it("parses drag event", () => {
      // Button 32 = left drag
      const event = parseMouseEvent("\x1b[<32;10;5M");
      assertEquals(event?.type, "drag");
      assertEquals(event?.button, "left");
    });

    it("returns null for invalid input", () => {
      assertEquals(parseMouseEvent("invalid"), null);
      assertEquals(parseMouseEvent(""), null);
      assertEquals(parseMouseEvent("\x1b[invalid"), null);
    });

    it("accepts Uint8Array input", () => {
      const data = new TextEncoder().encode("\x1b[<0;10;5M");
      const event = parseMouseEvent(data);
      assertEquals(event?.button, "left");
      assertEquals(event?.x, 10);
      assertEquals(event?.y, 5);
    });
  });

  describe("isInHitArea", () => {
    const area: HitArea = {
      x: 10,
      y: 5,
      width: 20,
      height: 3,
      id: "test",
    };

    it("returns true for point inside area", () => {
      const event: MouseEvent = {
        type: "press",
        button: "left",
        x: 15,
        y: 6,
        modifiers: { shift: false, alt: false, ctrl: false },
      };
      assertEquals(isInHitArea(event, area), true);
    });

    it("returns true for point at top-left corner", () => {
      const event: MouseEvent = {
        type: "press",
        button: "left",
        x: 10,
        y: 5,
        modifiers: { shift: false, alt: false, ctrl: false },
      };
      assertEquals(isInHitArea(event, area), true);
    });

    it("returns false for point at bottom-right (exclusive)", () => {
      const event: MouseEvent = {
        type: "press",
        button: "left",
        x: 30, // x + width
        y: 8, // y + height
        modifiers: { shift: false, alt: false, ctrl: false },
      };
      assertEquals(isInHitArea(event, area), false);
    });

    it("returns false for point outside area", () => {
      const event: MouseEvent = {
        type: "press",
        button: "left",
        x: 5,
        y: 2,
        modifiers: { shift: false, alt: false, ctrl: false },
      };
      assertEquals(isInHitArea(event, area), false);
    });
  });

  describe("findHitArea", () => {
    const areas: HitArea[] = [
      { x: 0, y: 0, width: 10, height: 3, id: "first" },
      { x: 15, y: 0, width: 10, height: 3, id: "second" },
      { x: 0, y: 5, width: 10, height: 3, id: "third" },
    ];

    it("finds correct hit area", () => {
      const event: MouseEvent = {
        type: "press",
        button: "left",
        x: 5,
        y: 1,
        modifiers: { shift: false, alt: false, ctrl: false },
      };
      const found = findHitArea(event, areas);
      assertEquals(found?.id, "first");
    });

    it("returns null when no area matches", () => {
      const event: MouseEvent = {
        type: "press",
        button: "left",
        x: 50,
        y: 50,
        modifiers: { shift: false, alt: false, ctrl: false },
      };
      assertEquals(findHitArea(event, areas), null);
    });

    it("returns topmost (last) area when overlapping", () => {
      const overlappingAreas: HitArea[] = [
        { x: 0, y: 0, width: 20, height: 10, id: "bottom" },
        { x: 5, y: 5, width: 10, height: 5, id: "top" },
      ];
      const event: MouseEvent = {
        type: "press",
        button: "left",
        x: 8,
        y: 7,
        modifiers: { shift: false, alt: false, ctrl: false },
      };
      const found = findHitArea(event, overlappingAreas);
      assertEquals(found?.id, "top");
    });
  });
});
