/**
 * Tests for select-grid component
 */

import { assertEquals } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { navigateGrid } from "./select-grid.ts";

describe("select-grid", () => {
  describe("navigateGrid", () => {
    // Test with a 3x3 grid (9 items, 3 columns)
    const columns = 3;
    const totalItems = 9;

    describe("left navigation", () => {
      it("moves left within row", () => {
        assertEquals(navigateGrid(1, "left", columns, totalItems), 0);
        assertEquals(navigateGrid(4, "left", columns, totalItems), 3);
      });

      it("wraps to end from first item", () => {
        assertEquals(navigateGrid(0, "left", columns, totalItems), 8);
      });
    });

    describe("right navigation", () => {
      it("moves right within row", () => {
        assertEquals(navigateGrid(0, "right", columns, totalItems), 1);
        assertEquals(navigateGrid(4, "right", columns, totalItems), 5);
      });

      it("wraps to start from last item", () => {
        assertEquals(navigateGrid(8, "right", columns, totalItems), 0);
      });
    });

    describe("up navigation", () => {
      it("moves up within column", () => {
        assertEquals(navigateGrid(4, "up", columns, totalItems), 1);
        assertEquals(navigateGrid(7, "up", columns, totalItems), 4);
      });

      it("wraps to last row from first row", () => {
        assertEquals(navigateGrid(1, "up", columns, totalItems), 7);
      });
    });

    describe("down navigation", () => {
      it("moves down within column", () => {
        assertEquals(navigateGrid(1, "down", columns, totalItems), 4);
        assertEquals(navigateGrid(4, "down", columns, totalItems), 7);
      });

      it("wraps to first row from last row", () => {
        assertEquals(navigateGrid(7, "down", columns, totalItems), 1);
      });
    });

    describe("edge cases", () => {
      it("returns -1 for empty grid", () => {
        assertEquals(navigateGrid(0, "left", 3, 0), -1);
      });

      it("handles incomplete last row", () => {
        // Grid with 7 items in 3 columns:
        // [0] [1] [2]
        // [3] [4] [5]
        // [6]
        const items = 7;

        // Down from col 1 should go to last row, clamp to last item
        assertEquals(navigateGrid(4, "down", 3, items), 6);

        // Down from col 2 also clamps to last item (6) since (2,2) doesn't exist
        assertEquals(navigateGrid(5, "down", 3, items), 6);
      });

      it("handles single item", () => {
        assertEquals(navigateGrid(0, "left", 1, 1), 0);
        assertEquals(navigateGrid(0, "right", 1, 1), 0);
        assertEquals(navigateGrid(0, "up", 1, 1), 0);
        assertEquals(navigateGrid(0, "down", 1, 1), 0);
      });

      it("handles single row", () => {
        // [0] [1] [2]
        assertEquals(navigateGrid(1, "up", 3, 3), 1);
        assertEquals(navigateGrid(1, "down", 3, 3), 1);
      });

      it("handles single column", () => {
        // [0]
        // [1]
        // [2]
        assertEquals(navigateGrid(1, "left", 1, 3), 0);
        assertEquals(navigateGrid(1, "right", 1, 3), 2);
      });
    });
  });
});
