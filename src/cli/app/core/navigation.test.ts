/**
 * Tests for navigation stack module
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  canGoBack,
  clear,
  depth,
  getBreadcrumbs,
  getParams,
  GO_TO_SHORTCUTS,
  goTo,
  handleGoToShortcut,
  hasView,
  navigate,
  peek,
  peekPrevious,
  pop,
  push,
  replace,
  saveScrollPosition,
} from "./navigation.ts";
import { createNavStack } from "./types.ts";

describe("push", () => {
  it("adds entry to empty stack", () => {
    const stack = createNavStack();
    const result = push("dashboard")(stack);

    expect(result.stack).toHaveLength(1);
    expect(result.stack[0]?.view).toBe("dashboard");
  });

  it("adds entry to existing stack", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    stack = push("project-detail")(stack);

    expect(stack.stack).toHaveLength(2);
    expect(stack.stack[1]?.view).toBe("project-detail");
  });

  it("preserves params", () => {
    const stack = createNavStack();
    const result = push("project-detail", { projectId: "test-123" })(stack);

    expect(result.stack[0]?.params?.projectId).toBe("test-123");
  });

  it("trims stack when exceeds max size", () => {
    let stack = { ...createNavStack(), maxSize: 3 };
    stack = push("dashboard")(stack);
    stack = push("settings")(stack);
    stack = push("help")(stack);
    stack = push("resources")(stack);

    expect(stack.stack).toHaveLength(3);
    // Oldest (dashboard) should be removed
    expect(stack.stack[0]?.view).toBe("settings");
    expect(stack.stack[2]?.view).toBe("resources");
  });
});

describe("pop", () => {
  it("returns empty result for empty stack", () => {
    const stack = createNavStack();
    const result = pop(stack);

    expect(result.popped).toBeNull();
    expect(result.stack.stack).toHaveLength(0);
  });

  it("removes and returns top entry", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    stack = push("settings")(stack);

    const result = pop(stack);

    expect(result.popped?.view).toBe("settings");
    expect(result.stack.stack).toHaveLength(1);
    expect(result.stack.stack[0]?.view).toBe("dashboard");
  });

  it("preserves params in popped entry", () => {
    let stack = createNavStack();
    stack = push("project-detail", { id: "123" })(stack);

    const result = pop(stack);

    expect(result.popped?.params?.id).toBe("123");
  });
});

describe("peek", () => {
  it("returns null for empty stack", () => {
    const stack = createNavStack();
    expect(peek(stack)).toBeNull();
  });

  it("returns top entry without modifying stack", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    stack = push("settings")(stack);

    const result = peek(stack);

    expect(result?.view).toBe("settings");
    expect(stack.stack).toHaveLength(2);
  });
});

describe("peekPrevious", () => {
  it("returns null for empty stack", () => {
    const stack = createNavStack();
    expect(peekPrevious(stack)).toBeNull();
  });

  it("returns null for single-entry stack", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);

    expect(peekPrevious(stack)).toBeNull();
  });

  it("returns second-to-top entry", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    stack = push("settings")(stack);
    stack = push("help")(stack);

    const result = peekPrevious(stack);

    expect(result?.view).toBe("settings");
  });
});

describe("replace", () => {
  it("pushes to empty stack", () => {
    const stack = createNavStack();
    const result = replace("dashboard")(stack);

    expect(result.stack).toHaveLength(1);
    expect(result.stack[0]?.view).toBe("dashboard");
  });

  it("replaces top entry", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    stack = push("settings")(stack);
    stack = replace("help")(stack);

    expect(stack.stack).toHaveLength(2);
    expect(stack.stack[1]?.view).toBe("help");
  });

  it("preserves params in new entry", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    stack = replace("project-detail", { id: "abc" })(stack);

    expect(stack.stack[0]?.params?.id).toBe("abc");
  });
});

describe("navigate", () => {
  it("pushes new view", () => {
    let stack = createNavStack();
    stack = navigate("dashboard")(stack);

    expect(stack.stack).toHaveLength(1);
    expect(peek(stack)?.view).toBe("dashboard");
  });
});

describe("goTo", () => {
  it("pushes view if not in history", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    stack = goTo("settings")(stack);

    expect(stack.stack).toHaveLength(2);
    expect(peek(stack)?.view).toBe("settings");
  });

  it("pops back to existing view", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    stack = push("settings")(stack);
    stack = push("help")(stack);
    stack = push("resources")(stack);
    stack = goTo("settings")(stack);

    expect(stack.stack).toHaveLength(2);
    expect(peek(stack)?.view).toBe("settings");
  });

  it("finds most recent occurrence", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    stack = push("settings")(stack);
    stack = push("dashboard")(stack); // Second dashboard
    stack = push("help")(stack);
    stack = goTo("dashboard")(stack);

    expect(stack.stack).toHaveLength(3);
    expect(peek(stack)?.view).toBe("dashboard");
    // The one at index 0 should still exist
    expect(stack.stack[0]?.view).toBe("dashboard");
  });
});

describe("clear", () => {
  it("removes all entries", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    stack = push("settings")(stack);
    stack = clear()(stack);

    expect(stack.stack).toHaveLength(0);
  });

  it("preserves max size", () => {
    let stack = { ...createNavStack(), maxSize: 5 };
    stack = push("dashboard")(stack);
    stack = clear()(stack);

    expect(stack.maxSize).toBe(5);
  });
});

describe("saveScrollPosition", () => {
  it("does nothing for empty stack", () => {
    const stack = createNavStack();
    const result = saveScrollPosition(100)(stack);

    expect(result.stack).toHaveLength(0);
  });

  it("saves position to top entry", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    stack = saveScrollPosition(250)(stack);

    expect(peek(stack)?.scrollPosition).toBe(250);
  });

  it("preserves other entry data", () => {
    let stack = createNavStack();
    stack = push("project-detail", { id: "test" })(stack);
    stack = saveScrollPosition(100)(stack);

    const entry = peek(stack);
    expect(entry?.params?.id).toBe("test");
    expect(entry?.scrollPosition).toBe(100);
  });
});

describe("GO_TO_SHORTCUTS", () => {
  it("maps d to dashboard", () => {
    expect(GO_TO_SHORTCUTS["d"]).toBe("dashboard");
  });

  it("maps p to project-detail", () => {
    expect(GO_TO_SHORTCUTS["p"]).toBe("project-detail");
  });

  it("maps r to resources", () => {
    expect(GO_TO_SHORTCUTS["r"]).toBe("resources");
  });

  it("maps s to settings", () => {
    expect(GO_TO_SHORTCUTS["s"]).toBe("settings");
  });

  it("maps h to help", () => {
    expect(GO_TO_SHORTCUTS["h"]).toBe("help");
  });
});

describe("handleGoToShortcut", () => {
  it("returns view for valid shortcut", () => {
    expect(handleGoToShortcut("d")).toBe("dashboard");
    expect(handleGoToShortcut("s")).toBe("settings");
  });

  it("returns null for invalid shortcut", () => {
    expect(handleGoToShortcut("x")).toBeNull();
    expect(handleGoToShortcut("z")).toBeNull();
    expect(handleGoToShortcut("")).toBeNull();
  });
});

describe("getBreadcrumbs", () => {
  it("returns empty array for empty stack", () => {
    const stack = createNavStack();
    expect(getBreadcrumbs(stack)).toEqual([]);
  });

  it("returns views in order", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    stack = push("settings")(stack);
    stack = push("help")(stack);

    expect(getBreadcrumbs(stack)).toEqual(["dashboard", "settings", "help"]);
  });
});

describe("canGoBack", () => {
  it("returns false for empty stack", () => {
    const stack = createNavStack();
    expect(canGoBack(stack)).toBe(false);
  });

  it("returns true for non-empty stack", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    expect(canGoBack(stack)).toBe(true);
  });
});

describe("depth", () => {
  it("returns 0 for empty stack", () => {
    const stack = createNavStack();
    expect(depth(stack)).toBe(0);
  });

  it("returns correct depth", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    stack = push("settings")(stack);
    stack = push("help")(stack);

    expect(depth(stack)).toBe(3);
  });
});

describe("hasView", () => {
  it("returns false for empty stack", () => {
    const stack = createNavStack();
    expect(hasView(stack, "dashboard")).toBe(false);
  });

  it("returns true if view exists", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);
    stack = push("settings")(stack);

    expect(hasView(stack, "dashboard")).toBe(true);
    expect(hasView(stack, "settings")).toBe(true);
  });

  it("returns false if view not in stack", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);

    expect(hasView(stack, "help")).toBe(false);
  });
});

describe("getParams", () => {
  it("returns undefined for empty stack", () => {
    const stack = createNavStack();
    expect(getParams(stack, "dashboard")).toBeUndefined();
  });

  it("returns undefined if view not found", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);

    expect(getParams(stack, "settings")).toBeUndefined();
  });

  it("returns params for most recent occurrence", () => {
    let stack = createNavStack();
    stack = push("project-detail", { id: "first" })(stack);
    stack = push("settings")(stack);
    stack = push("project-detail", { id: "second" })(stack);

    expect(getParams(stack, "project-detail")?.id).toBe("second");
  });

  it("returns undefined if entry has no params", () => {
    let stack = createNavStack();
    stack = push("dashboard")(stack);

    expect(getParams(stack, "dashboard")).toBeUndefined();
  });
});
