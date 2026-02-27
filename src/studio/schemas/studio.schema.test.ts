import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BundlerMessageSchema,
  LogMessageSchema,
  MessageFromRendererSchema,
  MessageFromStudioSchema,
  NavigatorNodeSchema,
} from "./studio.schema.ts";

describe("studio/schema", () => {
  describe("LogMessageSchema", () => {
    it("should accept valid log message", () => {
      const result = LogMessageSchema.safeParse({
        method: "log",
        data: ["Hello", "World"],
        timestamp: "2024-01-01T00:00:00Z",
      });
      assertEquals(result.success, true);
    });

    it("should accept all log methods", () => {
      const methods = [
        "log",
        "debug",
        "info",
        "warn",
        "error",
        "table",
        "clear",
        "time",
        "timeEnd",
        "count",
        "assert",
        "command",
        "result",
        "dir",
      ];

      for (const method of methods) {
        const result = LogMessageSchema.safeParse({ method });
        assertEquals(result.success, true, `${method} should be valid`);
      }
    });

    it("should accept message without optional fields", () => {
      const result = LogMessageSchema.safeParse({
        method: "info",
      });
      assertEquals(result.success, true);
    });

    it("should reject invalid method", () => {
      const result = LogMessageSchema.safeParse({
        method: "invalid",
      });
      assertEquals(result.success, false);
    });
  });

  describe("NavigatorNodeSchema", () => {
    it("should accept valid node without children", () => {
      const result = NavigatorNodeSchema.safeParse({
        id: "node-1",
        name: "Component",
        type: "component",
        path: "/path/to/component",
        parentId: "root",
        start: { line: 1, column: 0 },
        end: { line: 10, column: 0 },
        children: [],
      });
      assertEquals(result.success, true);
    });

    it("should accept all node types", () => {
      const types = ["root", "component", "element", "markdown", "text"];

      for (const type of types) {
        const result = NavigatorNodeSchema.safeParse({
          id: "node-1",
          name: "Test",
          type,
          path: "/test",
          parentId: "root",
          start: { line: 1, column: 0 },
          end: { line: 2, column: 0 },
          children: [],
        });
        assertEquals(result.success, true, `${type} should be valid`);
      }
    });

    it("should accept nested children recursively", () => {
      const result = NavigatorNodeSchema.safeParse({
        id: "root",
        name: "Root",
        type: "root",
        path: "/",
        parentId: "",
        start: { line: 0, column: 0 },
        end: { line: 100, column: 0 },
        children: [
          {
            id: "child-1",
            name: "Child",
            type: "component",
            path: "/child",
            parentId: "root",
            start: { line: 5, column: 0 },
            end: { line: 15, column: 0 },
            children: [
              {
                id: "grandchild",
                name: "Grandchild",
                type: "element",
                path: "/child/grandchild",
                parentId: "child-1",
                start: { line: 7, column: 2 },
                end: { line: 10, column: 2 },
                children: [],
              },
            ],
          },
        ],
      });
      assertEquals(result.success, true);
    });

    it("should accept optional text field", () => {
      const result = NavigatorNodeSchema.safeParse({
        id: "text-node",
        name: "Text",
        type: "text",
        path: "/text",
        parentId: "parent",
        start: { line: 1, column: 0 },
        end: { line: 1, column: 10 },
        children: [],
        text: "Hello World",
      });
      assertEquals(result.success, true);
    });

    it("should accept optional isRemote field", () => {
      const result = NavigatorNodeSchema.safeParse({
        id: "remote-node",
        name: "Remote",
        type: "component",
        path: "/remote",
        parentId: "root",
        start: { line: 1, column: 0 },
        end: { line: 5, column: 0 },
        children: [],
        isRemote: true,
      });
      assertEquals(result.success, true);
    });
  });

  describe("BundlerMessageSchema", () => {
    it("should accept error message", () => {
      const result = BundlerMessageSchema.safeParse({
        type: "error",
        message: "Syntax error",
        file: "app.tsx",
        line: 42,
        column: 5,
      });
      assertEquals(result.success, true);
    });

    it("should accept warning message", () => {
      const result = BundlerMessageSchema.safeParse({
        type: "warning",
        message: "Unused variable",
      });
      assertEquals(result.success, true);
    });

    it("should reject invalid type", () => {
      const result = BundlerMessageSchema.safeParse({
        type: "info",
        message: "Info message",
      });
      assertEquals(result.success, false);
    });
  });

  describe("MessageFromRendererSchema - discriminated union", () => {
    it("should accept appLoaded action", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "appLoaded",
        url: "https://example.com",
      });
      assertEquals(result.success, true);
    });

    it("should accept appUnloaded action", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "appUnloaded",
        url: "https://example.com",
      });
      assertEquals(result.success, true);
    });

    it("should accept appUpdated action with all fields", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "appUpdated",
        url: "https://example.com",
        id: "page-123",
        isInitialLoad: true,
        nodesStore: { node1: { data: "value" } },
        errors: [{ type: "error", message: "Error message" }],
        warnings: [{ type: "warning", message: "Warning message" }],
      });
      assertEquals(result.success, true);
    });

    it("should accept runtimeError action", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "runtimeError",
        url: "https://example.com",
        errors: [{ type: "error", message: "Runtime error" }],
      });
      assertEquals(result.success, true);
    });

    it("should accept treeUpdated action", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "treeUpdated",
        id: "tree-1",
        url: "https://example.com",
        tree: {
          id: "root",
          name: "Root",
          type: "root",
          path: "/",
          parentId: "",
          start: { line: 0, column: 0 },
          end: { line: 10, column: 0 },
          children: [],
        },
      });
      assertEquals(result.success, true);
    });

    it("should accept setSelectedNode action", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "setSelectedNode",
        id: "node-123",
      });
      assertEquals(result.success, true);
    });

    it("should accept openFile action", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "openFile",
        filePath: "/path/to/file.tsx",
        lineNumber: 42,
        columnNumber: 10,
      });
      assertEquals(result.success, true);
    });

    it("should accept openFile action with optional symbol name", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "openFile",
        filePath: "/path/to/file.tsx",
        lineNumber: 1,
        symbolName: "Button",
      });
      assertEquals(result.success, true);
    });

    it("should accept openFile action with string line number", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "openFile",
        filePath: "/path/to/file.tsx",
        lineNumber: "42",
      });
      assertEquals(result.success, true);
    });

    it("should accept logEvent action", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "logEvent",
        value: { method: "log", data: ["test"] },
      });
      assertEquals(result.success, true);
    });

    it("should accept markdown editor sync actions", () => {
      const actions = [
        {
          action: "markdownEditorReady",
          fileId: "f43f9fb3-4a3a-4eb8-b8d0-8b6f8a4ca03f",
          filePath: "docs/intro.md",
        },
        {
          action: "markdownContentChange",
          fileId: "f43f9fb3-4a3a-4eb8-b8d0-8b6f8a4ca03f",
          filePath: "docs/intro.md",
          content: "# Hello",
        },
        {
          action: "markdownSelectionChange",
          fileId: "f43f9fb3-4a3a-4eb8-b8d0-8b6f8a4ca03f",
          filePath: "docs/intro.md",
          start: 3,
          end: 9,
        },
      ];

      for (const action of actions) {
        const result = MessageFromRendererSchema.safeParse(action);
        assertEquals(
          result.success,
          true,
          `${action.action} should be valid`,
        );
      }
    });

    it("should accept node manipulation actions", () => {
      const actions = [
        { action: "focusEditor" },
        { action: "duplicateNode", id: "node-1" },
        { action: "deleteNode", id: "node-2" },
        { action: "wrapNode", id: "node-3", element: "div" },
        { action: "changeNodeElement", id: "node-4", element: "span" },
        { action: "openNodeFile", id: "node-5" },
        { action: "forkNode", id: "node-6" },
        { action: "editNodeProps", id: "node-7" },
      ];

      for (const action of actions) {
        const result = MessageFromRendererSchema.safeParse(action);
        assertEquals(
          result.success,
          true,
          `${action.action} should be valid`,
        );
      }
    });

    it("should reject missing required fields", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "appLoaded",
        // missing url
      });
      assertEquals(result.success, false);
    });

    it("should reject invalid action", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "invalidAction",
        url: "https://example.com",
      });
      assertEquals(result.success, false);
    });
  });

  describe("MessageFromStudioSchema - discriminated union", () => {
    it("should accept routeChange action", () => {
      const result = MessageFromStudioSchema.safeParse({
        action: "routeChange",
        url: "https://example.com/new-page",
      });
      assertEquals(result.success, true);
    });

    it("should accept colorMode action", () => {
      const result = MessageFromStudioSchema.safeParse({
        action: "colorMode",
        value: "dark",
      });
      assertEquals(result.success, true);
    });

    it("should accept toggleLayout action", () => {
      const result = MessageFromStudioSchema.safeParse({
        action: "toggleLayout",
        value: true,
      });
      assertEquals(result.success, true);
    });

    it("should accept toggleInspectMode action with optional deselect", () => {
      const result = MessageFromStudioSchema.safeParse({
        action: "toggleInspectMode",
        value: false,
        deselectElements: true,
      });
      assertEquals(result.success, true);
    });

    it("should accept navigation actions", () => {
      const actions = [
        { action: "goBack" },
        { action: "goForward" },
        { action: "reload" },
      ];

      for (const action of actions) {
        const result = MessageFromStudioSchema.safeParse(action);
        assertEquals(
          result.success,
          true,
          `${action.action} should be valid`,
        );
      }
    });

    it("should accept id-based actions", () => {
      const actions = [
        { action: "providerId", id: "provider-123" },
        { action: "layoutId", id: "layout-456" },
      ];

      for (const action of actions) {
        const result = MessageFromStudioSchema.safeParse(action);
        assertEquals(
          result.success,
          true,
          `${action.action} should be valid`,
        );
      }
    });

    it("should accept setSelectedNode action", () => {
      const result = MessageFromStudioSchema.safeParse({
        action: "setSelectedNode",
        id: "node-123",
        scroll: true,
      });
      assertEquals(result.success, true);
    });

    it("should accept setSelectedNode without scroll", () => {
      const result = MessageFromStudioSchema.safeParse({
        action: "setSelectedNode",
        id: "node-123",
      });
      assertEquals(result.success, true);
    });

    it("should accept setHoveredNode action", () => {
      const result = MessageFromStudioSchema.safeParse({
        action: "setHoveredNode",
        id: "node-456",
      });
      assertEquals(result.success, true);
    });

    it("should accept setMarkdownPersistState action", () => {
      const result = MessageFromStudioSchema.safeParse({
        action: "setMarkdownPersistState",
        fileId: "f43f9fb3-4a3a-4eb8-b8d0-8b6f8a4ca03f",
        status: "saved",
      });
      assertEquals(result.success, true);
    });

    it("should reject missing required fields", () => {
      const result = MessageFromStudioSchema.safeParse({
        action: "routeChange",
        // missing url
      });
      assertEquals(result.success, false);
    });

    it("should reject invalid action", () => {
      const result = MessageFromStudioSchema.safeParse({
        action: "unknownAction",
      });
      assertEquals(result.success, false);
    });
  });
});
