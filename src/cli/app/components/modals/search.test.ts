/**
 * Tests for search modal
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  closeSearch,
  getSelectedResult,
  handleSearchKey,
  moveSearchDown,
  moveSearchUp,
  openSearch,
  renderSearch,
  searchSources,
  setSearchResults,
  updateSearchQuery,
} from "./search.ts";
import { createSearchState } from "../../core/types.ts";

describe("openSearch", () => {
  it("opens search with empty state", () => {
    const state = createSearchState();
    const result = openSearch()(state);

    expect(result.open).toBe(true);
    expect(result.query).toBe("");
    expect(result.results).toEqual([]);
    expect(result.loading).toBe(false);
  });
});

describe("closeSearch", () => {
  it("resets state", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = updateSearchQuery("test")(state);

    const result = closeSearch()(state);

    expect(result.open).toBe(false);
    expect(result.query).toBe("");
    expect(result.results).toEqual([]);
  });
});

describe("updateSearchQuery", () => {
  it("updates query", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = updateSearchQuery("test")(state);

    expect(state.query).toBe("test");
    expect(state.selectedIndex).toBe(0);
  });

  it("sets loading when query is not empty", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = updateSearchQuery("test")(state);

    expect(state.loading).toBe(true);
  });

  it("clears loading when query is empty", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = updateSearchQuery("")(state);

    expect(state.loading).toBe(false);
  });
});

describe("setSearchResults", () => {
  it("sets results and clears loading", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = updateSearchQuery("test")(state);

    const results = [
      { type: "file" as const, id: "1", label: "test.ts", score: 100 },
    ];

    state = setSearchResults(results)(state);

    expect(state.results).toEqual(results);
    expect(state.loading).toBe(false);
    expect(state.selectedIndex).toBe(0);
  });
});

describe("moveSearchUp", () => {
  it("moves up", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = setSearchResults([
      { type: "file", id: "1", label: "a", score: 100 },
      { type: "file", id: "2", label: "b", score: 90 },
    ])(state);
    state = { ...state, selectedIndex: 1 };

    const result = moveSearchUp()(state);
    expect(result.selectedIndex).toBe(0);
  });

  it("wraps to bottom", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = setSearchResults([
      { type: "file", id: "1", label: "a", score: 100 },
      { type: "file", id: "2", label: "b", score: 90 },
    ])(state);

    const result = moveSearchUp()(state);
    expect(result.selectedIndex).toBe(1);
  });

  it("handles empty results", () => {
    let state = createSearchState();
    state = openSearch()(state);

    const result = moveSearchUp()(state);
    expect(result.selectedIndex).toBe(0);
  });
});

describe("moveSearchDown", () => {
  it("moves down", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = setSearchResults([
      { type: "file", id: "1", label: "a", score: 100 },
      { type: "file", id: "2", label: "b", score: 90 },
    ])(state);

    const result = moveSearchDown()(state);
    expect(result.selectedIndex).toBe(1);
  });

  it("wraps to top", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = setSearchResults([
      { type: "file", id: "1", label: "a", score: 100 },
      { type: "file", id: "2", label: "b", score: 90 },
    ])(state);
    state = { ...state, selectedIndex: 1 };

    const result = moveSearchDown()(state);
    expect(result.selectedIndex).toBe(0);
  });
});

describe("getSelectedResult", () => {
  it("returns selected result", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = setSearchResults([
      { type: "file", id: "1", label: "test.ts", score: 100 },
    ])(state);

    const result = getSelectedResult(state);
    expect(result?.id).toBe("1");
  });

  it("returns null for empty results", () => {
    const state = createSearchState();
    expect(getSelectedResult(state)).toBeNull();
  });
});

describe("searchSources", () => {
  it("searches across sources", () => {
    const sources = [
      {
        type: "file" as const,
        items: [
          { id: "1", label: "index.ts", path: "src/index.ts" },
          { id: "2", label: "main.ts", path: "src/main.ts" },
        ],
      },
      {
        type: "route" as const,
        items: [
          { id: "3", label: "GET /api/users", path: "/api/users" },
        ],
      },
    ];

    const results = searchSources("index", sources);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.label).toContain("index");
  });

  it("returns empty for empty query", () => {
    const sources = [
      { type: "file" as const, items: [{ id: "1", label: "test" }] },
    ];

    const results = searchSources("", sources);
    expect(results).toEqual([]);
  });

  it("scores by relevance", () => {
    const sources = [
      {
        type: "file" as const,
        items: [
          { id: "1", label: "index.ts" },
          { id: "2", label: "main_index.ts" },
        ],
      },
    ];

    const results = searchSources("index", sources);

    // Exact match at start should score higher
    expect(results[0]?.id).toBe("1");
  });

  it("limits results", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      label: `test${i}`,
    }));

    const sources = [{ type: "file" as const, items }];
    const results = searchSources("test", sources);

    expect(results.length).toBeLessThanOrEqual(20);
  });
});

describe("renderSearch", () => {
  it("returns empty when closed", () => {
    const state = createSearchState();
    expect(renderSearch(state)).toBe("");
  });

  it("renders search box", () => {
    let state = createSearchState();
    state = openSearch()(state);

    const result = renderSearch(state);
    expect(result).toContain(">"); // Input prefix
    expect(result).toContain("select");
    expect(result).toContain("Esc");
  });

  it("shows query", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = updateSearchQuery("myquery")(state);

    const result = renderSearch(state);
    expect(result).toContain("myquery");
  });

  it("shows loading state", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = updateSearchQuery("test")(state);

    const result = renderSearch(state);
    expect(result).toContain("Searching");
  });

  it("shows no results message", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = updateSearchQuery("xyz")(state);
    state = setSearchResults([])(state);

    const result = renderSearch(state);
    expect(result).toContain("No results");
  });
});

describe("handleSearchKey", () => {
  it("returns not handled when closed", () => {
    const state = createSearchState();
    const result = handleSearchKey("a", state);
    expect(result.handled).toBe(false);
  });

  it("handles escape", () => {
    let state = createSearchState();
    state = openSearch()(state);

    const result = handleSearchKey("\x1b", state);
    expect(result.handled).toBe(true);
    expect(result.close).toBe(true);
  });

  it("handles enter to select", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = setSearchResults([
      { type: "file", id: "1", label: "test", score: 100 },
    ])(state);

    const result = handleSearchKey("\r", state);
    expect(result.handled).toBe(true);
    expect(result.close).toBe(true);
    expect(result.selectResult?.id).toBe("1");
  });

  it("handles up arrow", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = setSearchResults([
      { type: "file", id: "1", label: "a", score: 100 },
      { type: "file", id: "2", label: "b", score: 90 },
    ])(state);
    state = { ...state, selectedIndex: 1 };

    const result = handleSearchKey("\x1b[A", state);
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles down arrow", () => {
    let state = createSearchState();
    state = openSearch()(state);

    const result = handleSearchKey("\x1b[B", state);
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles backspace", () => {
    let state = createSearchState();
    state = openSearch()(state);
    state = updateSearchQuery("test")(state);

    const result = handleSearchKey("\x7f", state);
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles character input", () => {
    let state = createSearchState();
    state = openSearch()(state);

    const result = handleSearchKey("a", state);
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });
});
