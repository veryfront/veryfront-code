/**
 * Tests for resource viewer component
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  clearFilter,
  createResourceViewer,
  getCurrentItems,
  getFilteredItems,
  getSelectedItem,
  getTabCount,
  handleResourceViewerKey,
  moveDown,
  moveUp,
  nextTab,
  prevTab,
  renderDetailPane,
  renderResourceList,
  renderResourceViewer,
  renderTabBar,
  ResourceItemSchema,
  ResourceTypeSchema,
  ResourceViewerStateSchema as _ResourceViewerStateSchema,
  setActiveTab,
  setFilter,
  setResources,
  toggleDetail,
} from "./resource-viewer.ts";

describe("ResourceTypeSchema", () => {
  it("validates resource types", () => {
    expect(ResourceTypeSchema.parse("files")).toBe("files");
    expect(ResourceTypeSchema.parse("routes")).toBe("routes");
    expect(ResourceTypeSchema.parse("agents")).toBe("agents");
    expect(ResourceTypeSchema.parse("tools")).toBe("tools");
    expect(ResourceTypeSchema.parse("mcp")).toBe("mcp");
  });

  it("rejects invalid type", () => {
    expect(() => ResourceTypeSchema.parse("invalid")).toThrow();
  });
});

describe("ResourceItemSchema", () => {
  it("validates item", () => {
    const result = ResourceItemSchema.parse({
      id: "1",
      name: "index.ts",
      type: "files",
      status: "active",
      description: "Main entry point",
    });

    expect(result.id).toBe("1");
    expect(result.status).toBe("active");
  });

  it("validates minimal item", () => {
    const result = ResourceItemSchema.parse({
      id: "1",
      name: "test",
      type: "files",
    });

    expect(result.id).toBe("1");
    expect(result.status).toBeUndefined();
  });
});

describe("createResourceViewer", () => {
  it("creates initial state", () => {
    const state = createResourceViewer();

    expect(state.activeTab).toBe("files");
    expect(state.selectedIndex).toBe(0);
    expect(state.filter).toBe("");
    expect(state.showDetail).toBe(true);
    expect(state.resources.files).toEqual([]);
  });
});

describe("setActiveTab", () => {
  it("sets active tab", () => {
    let state = createResourceViewer();
    state = setActiveTab("routes")(state);

    expect(state.activeTab).toBe("routes");
    expect(state.selectedIndex).toBe(0);
  });
});

describe("nextTab", () => {
  it("cycles to next tab", () => {
    let state = createResourceViewer();
    state = nextTab()(state);

    expect(state.activeTab).toBe("routes");
  });

  it("wraps around", () => {
    let state = createResourceViewer();
    state = setActiveTab("mcp")(state);
    state = nextTab()(state);

    expect(state.activeTab).toBe("files");
  });
});

describe("prevTab", () => {
  it("cycles to previous tab", () => {
    let state = createResourceViewer();
    state = setActiveTab("routes")(state);
    state = prevTab()(state);

    expect(state.activeTab).toBe("files");
  });

  it("wraps around", () => {
    let state = createResourceViewer();
    state = prevTab()(state);

    expect(state.activeTab).toBe("mcp");
  });
});

describe("setResources", () => {
  it("sets resources for type", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "index.ts", type: "files" },
      { id: "2", name: "main.ts", type: "files" },
    ])(state);

    expect(state.resources.files.length).toBe(2);
  });
});

describe("moveUp/moveDown", () => {
  it("moves down", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "a", type: "files" },
      { id: "2", name: "b", type: "files" },
    ])(state);

    state = moveDown()(state);
    expect(state.selectedIndex).toBe(1);
  });

  it("moves up", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "a", type: "files" },
      { id: "2", name: "b", type: "files" },
    ])(state);
    state = { ...state, selectedIndex: 1 };

    state = moveUp()(state);
    expect(state.selectedIndex).toBe(0);
  });

  it("wraps at bottom", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "a", type: "files" },
      { id: "2", name: "b", type: "files" },
    ])(state);
    state = { ...state, selectedIndex: 1 };

    state = moveDown()(state);
    expect(state.selectedIndex).toBe(0);
  });

  it("wraps at top", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "a", type: "files" },
      { id: "2", name: "b", type: "files" },
    ])(state);

    state = moveUp()(state);
    expect(state.selectedIndex).toBe(1);
  });
});

describe("setFilter/clearFilter", () => {
  it("sets filter", () => {
    let state = createResourceViewer();
    state = setFilter("test")(state);

    expect(state.filter).toBe("test");
    expect(state.selectedIndex).toBe(0);
  });

  it("clears filter", () => {
    let state = createResourceViewer();
    state = setFilter("test")(state);
    state = clearFilter()(state);

    expect(state.filter).toBe("");
  });
});

describe("toggleDetail", () => {
  it("toggles detail pane", () => {
    let state = createResourceViewer();
    expect(state.showDetail).toBe(true);

    state = toggleDetail()(state);
    expect(state.showDetail).toBe(false);

    state = toggleDetail()(state);
    expect(state.showDetail).toBe(true);
  });
});

describe("getCurrentItems", () => {
  it("returns items for current tab", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "a", type: "files" },
    ])(state);
    state = setResources("routes", [
      { id: "2", name: "b", type: "routes" },
    ])(state);

    expect(getCurrentItems(state).length).toBe(1);
    expect(getCurrentItems(state)[0]?.id).toBe("1");

    state = setActiveTab("routes")(state);
    expect(getCurrentItems(state)[0]?.id).toBe("2");
  });
});

describe("getFilteredItems", () => {
  it("returns all items without filter", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "index.ts", type: "files" },
      { id: "2", name: "main.ts", type: "files" },
    ])(state);

    expect(getFilteredItems(state).length).toBe(2);
  });

  it("filters by name", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "index.ts", type: "files" },
      { id: "2", name: "main.ts", type: "files" },
    ])(state);
    state = setFilter("index")(state);

    const items = getFilteredItems(state);
    expect(items.length).toBe(1);
    expect(items[0]?.name).toBe("index.ts");
  });

  it("filters by description", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "a", type: "files", description: "Entry point" },
      { id: "2", name: "b", type: "files", description: "Main module" },
    ])(state);
    state = setFilter("entry")(state);

    const items = getFilteredItems(state);
    expect(items.length).toBe(1);
    expect(items[0]?.id).toBe("1");
  });
});

describe("getSelectedItem", () => {
  it("returns selected item", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "a", type: "files" },
      { id: "2", name: "b", type: "files" },
    ])(state);
    state = { ...state, selectedIndex: 1 };

    const item = getSelectedItem(state);
    expect(item?.id).toBe("2");
  });

  it("returns null for empty list", () => {
    const state = createResourceViewer();
    expect(getSelectedItem(state)).toBeNull();
  });
});

describe("getTabCount", () => {
  it("returns count for tab", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "a", type: "files" },
      { id: "2", name: "b", type: "files" },
    ])(state);

    expect(getTabCount(state, "files")).toBe(2);
    expect(getTabCount(state, "routes")).toBe(0);
  });
});

describe("renderTabBar", () => {
  it("renders tabs with counts", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "a", type: "files" },
    ])(state);

    const result = renderTabBar(state);

    expect(result).toContain("Files");
    expect(result).toContain("Routes");
    expect(result).toContain("(1)");
    expect(result).toContain("(0)");
  });
});

describe("renderResourceList", () => {
  it("renders items", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "index.ts", type: "files", status: "active" },
    ])(state);

    const result = renderResourceList(state);

    expect(result).toContain("index.ts");
    expect(result).toContain("›"); // Selection indicator
  });

  it("shows empty message", () => {
    const state = createResourceViewer();
    const result = renderResourceList(state);

    expect(result).toContain("No resources");
  });

  it("shows filter", () => {
    let state = createResourceViewer();
    state = setFilter("test")(state);

    const result = renderResourceList(state);

    expect(result).toContain("Filter:");
    expect(result).toContain("test");
  });
});

describe("renderDetailPane", () => {
  it("renders item details", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      {
        id: "1",
        name: "index.ts",
        type: "files",
        status: "active",
        description: "Main entry point",
      },
    ])(state);

    const result = renderDetailPane(state);

    expect(result).toContain("index.ts");
    expect(result).toContain("active");
    expect(result).toContain("Main entry point");
  });

  it("shows no selection message", () => {
    const state = createResourceViewer();
    const result = renderDetailPane(state);

    expect(result).toContain("No item selected");
  });
});

describe("renderResourceViewer", () => {
  it("renders full viewer", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "index.ts", type: "files" },
    ])(state);

    const result = renderResourceViewer(state);

    expect(result).toContain("Resources");
    expect(result).toContain("Files");
    expect(result).toContain("index.ts");
    expect(result).toContain("Tab switch");
  });
});

describe("handleResourceViewerKey", () => {
  it("handles escape", () => {
    const state = createResourceViewer();
    const result = handleResourceViewerKey("\x1b", state);

    expect(result.handled).toBe(true);
    expect(result.close).toBe(true);
  });

  it("handles tab for next tab", () => {
    const state = createResourceViewer();
    const result = handleResourceViewerKey("\t", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles up/down", () => {
    const state = createResourceViewer();

    const up = handleResourceViewerKey("k", state);
    expect(up.handled).toBe(true);
    expect(up.updater).toBeDefined();

    const down = handleResourceViewerKey("j", state);
    expect(down.handled).toBe(true);
    expect(down.updater).toBeDefined();
  });

  it("handles enter for open", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "test", type: "files" },
    ])(state);

    const result = handleResourceViewerKey("\r", state);

    expect(result.handled).toBe(true);
    expect(result.action).toBe("open");
    expect(result.selectedItem?.id).toBe("1");
  });

  it("handles l for logs", () => {
    let state = createResourceViewer();
    state = setResources("files", [
      { id: "1", name: "test", type: "files" },
    ])(state);

    const result = handleResourceViewerKey("l", state);

    expect(result.action).toBe("logs");
  });

  it("handles d for detail toggle", () => {
    const state = createResourceViewer();
    const result = handleResourceViewerKey("d", state);

    expect(result.updater).toBeDefined();
  });

  it("handles number keys for tab selection", () => {
    const state = createResourceViewer();

    const result = handleResourceViewerKey("2", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });
});
