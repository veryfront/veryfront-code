import "#veryfront/schemas/_test-setup.ts";
import { schemaToJsonSchema } from "#veryfront/schemas/index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  ErrorMessageSchema,
  LogMessageSchema,
  MessageFromRendererSchema,
  MessageFromStudioSchema,
  NavigatorNodeSchema,
} from "./studio.schema.ts";
import {
  MAX_STUDIO_NAVIGATOR_DEPTH,
  MAX_STUDIO_NAVIGATOR_NODES,
  MAX_STUDIO_ROUTE_PARAM_ENTRIES,
  MAX_STUDIO_ROUTE_PARAM_KEY_LENGTH,
  MAX_STUDIO_ROUTE_PARAM_VALUE_LENGTH,
  MAX_STUDIO_SCREENSHOT_DATA_LENGTH,
} from "../limits.ts";

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

    it("should preserve the navigator JSON schema contract", () => {
      const schema = schemaToJsonSchema(NavigatorNodeSchema);

      assertEquals(schema.type, "object");
      assertEquals(schema.properties?.id?.type, "string");
      assertEquals(schema.properties?.children?.type, "array");
    });

    it("should include the synthetic root in the navigator depth contract", () => {
      const nestedTree = (maxContentDepth: number) => {
        let nested: Record<string, unknown> = {
          id: "leaf",
          name: "div",
          type: "element",
          path: "page.mdx",
          parentId: "parent",
          start: { line: 0, column: 0 },
          end: { line: 0, column: 0 },
          children: [],
        };
        for (let depth = 0; depth < maxContentDepth; depth++) {
          nested = {
            id: `node-${depth}`,
            name: "div",
            type: "element",
            path: "page.mdx",
            parentId: "parent",
            start: { line: 0, column: 0 },
            end: { line: 0, column: 0 },
            children: [nested],
          };
        }
        return {
          id: "root",
          name: "root",
          type: "root",
          path: "",
          parentId: "",
          start: { line: 0, column: 0 },
          end: { line: 0, column: 0 },
          children: [nested],
        };
      };

      assertEquals(
        NavigatorNodeSchema.safeParse(nestedTree(MAX_STUDIO_NAVIGATOR_DEPTH)).success,
        true,
      );
      assertEquals(
        NavigatorNodeSchema.safeParse(nestedTree(MAX_STUDIO_NAVIGATOR_DEPTH + 1)).success,
        false,
      );
    });

    it("should bound the aggregate number of content nodes", () => {
      const contentNode = (id: string, children: Record<string, unknown>[] = []) => ({
        id,
        name: "div",
        type: "element",
        path: "page.mdx",
        parentId: "root",
        start: { line: 0, column: 0 },
        end: { line: 0, column: 0 },
        children,
      });
      const tree = (contentNodeCount: number) => ({
        id: "root",
        name: "root",
        type: "root",
        path: "",
        parentId: "",
        start: { line: 0, column: 0 },
        end: { line: 0, column: 0 },
        children: Array.from(
          { length: Math.ceil(contentNodeCount / 2) },
          (_, index) =>
            contentNode(
              `node-${index}`,
              index + Math.ceil(contentNodeCount / 2) < contentNodeCount
                ? [contentNode(`child-${index}`)]
                : [],
            ),
        ),
      });

      assertEquals(NavigatorNodeSchema.safeParse(tree(MAX_STUDIO_NAVIGATOR_NODES)).success, true);
      assertEquals(
        NavigatorNodeSchema.safeParse(tree(MAX_STUDIO_NAVIGATOR_NODES + 1)).success,
        false,
      );
    });

    it("should reject an oversized tree before recursively validating node fields", () => {
      let recursiveFieldReads = 0;
      const contentNode = (id: string) => ({
        id,
        get name() {
          recursiveFieldReads++;
          return "div";
        },
        type: "element",
        path: "page.mdx",
        parentId: "root",
        start: { line: 0, column: 0 },
        end: { line: 0, column: 0 },
        children: [],
      });
      const result = NavigatorNodeSchema.safeParse({
        id: "root",
        name: "root",
        type: "root",
        path: "",
        parentId: "",
        start: { line: 0, column: 0 },
        end: { line: 0, column: 0 },
        children: Array.from(
          { length: MAX_STUDIO_NAVIGATOR_NODES + 1 },
          (_, index) => contentNode(`node-${index}`),
        ),
      });

      assertEquals(result.success, false);
      assertEquals(recursiveFieldReads, 0);
    });

    it("should reject an over-depth tree before recursively validating node fields", () => {
      let nested: Record<string, unknown> = {
        id: "leaf",
        name: "div",
        type: "element",
        path: "page.mdx",
        parentId: "parent",
        start: { line: 0, column: 0 },
        end: { line: 0, column: 0 },
        children: [],
      };
      for (let depth = 0; depth <= MAX_STUDIO_NAVIGATOR_DEPTH; depth++) {
        nested = {
          id: `node-${depth}`,
          name: "div",
          type: "element",
          path: "page.mdx",
          parentId: "parent",
          start: { line: 0, column: 0 },
          end: { line: 0, column: 0 },
          children: [nested],
        };
      }
      let recursiveFieldReads = 0;
      const root = {
        id: "root",
        get name() {
          recursiveFieldReads++;
          return "root";
        },
        type: "root",
        path: "",
        parentId: "",
        start: { line: 0, column: 0 },
        end: { line: 0, column: 0 },
        children: [nested],
      };

      assertEquals(NavigatorNodeSchema.safeParse(root).success, false);
      assertEquals(recursiveFieldReads, 0);
    });

    it("should fail closed before reading inherited or accessor child collections", () => {
      let recursiveFieldReads = 0;
      let childrenGetterCalls = 0;
      const childPrototype = {
        children: Array.from({ length: MAX_STUDIO_NAVIGATOR_NODES + 1 }, (_, index) => ({
          id: `nested-${index}`,
          get name() {
            recursiveFieldReads++;
            return "div";
          },
          type: "element",
          path: "page.mdx",
          parentId: "parent",
          start: { line: 0, column: 0 },
          end: { line: 0, column: 0 },
          children: [],
        })),
      };
      const inheritedChildren = Object.assign(Object.create(childPrototype), {
        id: "child",
        name: "div",
        type: "element",
        path: "page.mdx",
        parentId: "root",
        start: { line: 0, column: 0 },
        end: { line: 0, column: 0 },
      });
      const accessorChildren = Object.defineProperty(
        {
          id: "accessor",
          name: "div",
          type: "element",
          path: "page.mdx",
          parentId: "root",
          start: { line: 0, column: 0 },
          end: { line: 0, column: 0 },
        },
        "children",
        {
          enumerable: true,
          get() {
            childrenGetterCalls++;
            return childPrototype.children;
          },
        },
      );
      const root = (child: unknown) => ({
        id: "root",
        name: "root",
        type: "root",
        path: "",
        parentId: "",
        start: { line: 0, column: 0 },
        end: { line: 0, column: 0 },
        children: [child],
      });

      assertEquals(NavigatorNodeSchema.safeParse(root(inheritedChildren)).success, false);
      assertEquals(NavigatorNodeSchema.safeParse(root(accessorChildren)).success, false);
      assertEquals(recursiveFieldReads, 0);
      assertEquals(childrenGetterCalls, 0);
    });
  });

  describe("ErrorMessageSchema", () => {
    it("should accept error message", () => {
      const result = ErrorMessageSchema.safeParse({
        type: "error",
        message: "Syntax error",
        file: "app.tsx",
        line: 42,
        column: 5,
      });
      assertEquals(result.success, true);
    });

    it("should accept warning message", () => {
      const result = ErrorMessageSchema.safeParse({
        type: "warning",
        message: "Unused variable",
      });
      assertEquals(result.success, true);
    });

    it("should reject invalid type", () => {
      const result = ErrorMessageSchema.safeParse({
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

    it("should accept appUpdated action with all supported fields", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "appUpdated",
        url: "https://example.com",
        id: "page-123",
        isInitialLoad: true,
        errors: [{ type: "error", message: "Error message" }],
        warnings: [{ type: "warning", message: "Warning message" }],
      });
      assertEquals(result.success, true);
    });

    it("should not expose the retired appUpdated nodesStore field", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "appUpdated",
        url: "https://example.com",
        nodesStore: { node1: { data: "value" } },
      });

      assertEquals(result.success, false);
    });

    it("should accept bounded page transition params", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "onPageTransitionEnd",
        url: "https://example.com/guides/intro",
        projectId: "project-1",
        id: "page-1",
        params: { slug: "guides/intro", locale: "en" },
      });

      assertEquals(result.success, true);
    });

    it("should reject page transition params beyond their resource bounds", () => {
      assertEquals(
        MessageFromRendererSchema.safeParse({
          action: "onPageTransitionEnd",
          url: "https://example.com",
          projectId: "project-1",
          id: "page-1",
          params: Object.fromEntries(
            Array.from({ length: MAX_STUDIO_ROUTE_PARAM_ENTRIES + 1 }, (_, index) => [
              `param-${index}`,
              "value",
            ]),
          ),
        }).success,
        false,
      );
      assertEquals(
        MessageFromRendererSchema.safeParse({
          action: "onPageTransitionEnd",
          url: "https://example.com",
          projectId: "project-1",
          id: "page-1",
          params: { ["k".repeat(MAX_STUDIO_ROUTE_PARAM_KEY_LENGTH + 1)]: "value" },
        }).success,
        false,
      );
      assertEquals(
        MessageFromRendererSchema.safeParse({
          action: "onPageTransitionEnd",
          url: "https://example.com",
          projectId: "project-1",
          id: "page-1",
          params: { slug: "v".repeat(MAX_STUDIO_ROUTE_PARAM_VALUE_LENGTH + 1) },
        }).success,
        false,
      );
    });

    it("should reject page transition param accessors without executing them", () => {
      let getterCalls = 0;
      const params = Object.defineProperty({}, "slug", {
        enumerable: true,
        get() {
          getterCalls++;
          return "guides/intro";
        },
      });

      const result = MessageFromRendererSchema.safeParse({
        action: "onPageTransitionEnd",
        url: "https://example.com",
        projectId: "project-1",
        id: "page-1",
        params,
      });

      assertEquals(result.success, false);
      assertEquals(getterCalls, 0);
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

    it("should accept screenshot results emitted by the bridge", () => {
      const single = MessageFromRendererSchema.safeParse({
        action: "screenshotResult",
        requestId: "request-1",
        multiple: false,
        success: true,
        data: `data:image/png;base64,${"a".repeat(100)}`,
        width: 100,
        height: 100,
      });
      const multiple = MessageFromRendererSchema.safeParse({
        action: "screenshotResult",
        requestId: 2,
        multiple: true,
        results: [{ success: false, error: "Capture failed", section: 1, totalSections: 2 }],
      });

      assertEquals(single.success, true);
      assertEquals(multiple.success, true);
    });

    it("should reject inconsistent or oversized aggregate screenshot results", () => {
      assertEquals(
        MessageFromRendererSchema.safeParse({
          action: "screenshotResult",
          multiple: true,
          success: true,
          results: [],
        }).success,
        false,
      );
      const halfPlusOne = "x".repeat(Math.floor(MAX_STUDIO_SCREENSHOT_DATA_LENGTH / 2) + 1);
      assertEquals(
        MessageFromRendererSchema.safeParse({
          action: "screenshotResult",
          multiple: true,
          results: [
            { success: true, data: halfPlusOne },
            { success: true, data: halfPlusOne },
          ],
        }).success,
        false,
      );
    });

    it("should reject single-capture fields on multi-section screenshot results", () => {
      const singleCaptureFields = [
        ["success", false],
        ["data", "data:image/png;base64,example"],
        ["width", 100],
        ["height", 100],
        ["scrollY", 0],
        ["totalHeight", 100],
        ["viewportHeight", 100],
        ["url", "https://example.com/page"],
        ["error", "Capture failed"],
      ] as const;

      for (const [field, value] of singleCaptureFields) {
        assertEquals(
          MessageFromRendererSchema.safeParse({
            action: "screenshotResult",
            multiple: true,
            results: [{ success: false, error: "Capture failed" }],
            [field]: value,
          }).success,
          false,
          `multi-section screenshotResult should reject top-level ${field}`,
        );
      }
    });

    it("should accept node manipulation actions", () => {
      const actions = [
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

    it("should accept chatMessage action", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "chatMessage",
        prompt: "Fix the error in src/app.tsx",
      });
      assertEquals(result.success, true);
    });

    it("should reject chatMessage without prompt", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "chatMessage",
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

    it("should accept appUpdated with hasError and errors[] array", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "appUpdated",
        url: "https://example.com",
        id: "page-123",
        isInitialLoad: true,
        hasError: true,
        errors: [
          {
            type: "error",
            message: "Cannot read property of undefined",
            file: "src/components/Button.tsx",
            line: 42,
            column: 7,
          },
        ],
      });
      assertEquals(result.success, true);
    });

    it("should accept appUpdated without id when hasError is true and errors[] is provided", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "appUpdated",
        url: "https://example.com",
        isInitialLoad: true,
        hasError: true,
        errors: [
          {
            type: "error",
            message: "Unexpected token",
            file: "src/app.tsx",
            line: 10,
            column: 3,
          },
        ],
      });
      assertEquals(result.success, true);
    });

    it("should accept appUpdated with only hasError and no errors[] array", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "appUpdated",
        url: "https://example.com",
        hasError: true,
      });
      assertEquals(result.success, true);
    });

    it("should accept appUpdated with errors[] containing minimal fields", () => {
      const result = MessageFromRendererSchema.safeParse({
        action: "appUpdated",
        url: "https://example.com",
        hasError: true,
        errors: [
          {
            type: "error",
            message: "Something failed",
          },
        ],
      });
      assertEquals(result.success, true);
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

    it("should reject unsupported values and keep message-level compatibility", () => {
      assertEquals(
        MessageFromStudioSchema.safeParse({ action: "colorMode", value: "sepia" }).success,
        false,
      );
      assertEquals(
        MessageFromStudioSchema.safeParse({ action: "reload", unexpected: true }).success,
        true,
      );
      assertEquals(
        MessageFromStudioSchema.safeParse({
          action: "screenshot",
          responseFormat: "png",
          options: { fullPage: true, captureTarget: "viewport" },
        }).success,
        false,
      );
    });

    it("should reject retired no-op actions", () => {
      for (
        const message of [
          { action: "toggleLayout", value: true },
          { action: "providerId", id: "provider-123" },
          { action: "layoutId", id: "layout-456" },
        ]
      ) {
        assertEquals(MessageFromStudioSchema.safeParse(message).success, false);
      }
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
      assertEquals(
        MessageFromStudioSchema.safeParse({ action: "setHoveredNode", id: "" }).success,
        true,
      );
    });

    it("should reject NUL bytes in fields rejected by the runtime parser", () => {
      for (
        const message of [
          { action: "routeChange", url: "/safe\0hidden" },
          { action: "setSelectedNode", id: "node\0hidden" },
          { action: "setHoveredNode", id: "node\0hidden" },
          { action: "screenshot", requestId: "request\0hidden" },
        ]
      ) {
        assertEquals(
          MessageFromStudioSchema.safeParse(message).success,
          false,
          `${message.action} should reject NUL bytes`,
        );
      }

      assertEquals(
        MessageFromStudioSchema.safeParse({
          action: "screenshot",
          requestId: Number.MAX_SAFE_INTEGER + 1,
        }).success,
        false,
      );
    });

    it("should accept bounded single and multi-section screenshot actions", () => {
      const singleResult = MessageFromStudioSchema.safeParse({
        action: "screenshot",
        requestId: "request-1",
        options: {
          scrollTo: 120,
          fullPage: false,
        },
      });
      const multipleResult = MessageFromStudioSchema.safeParse({
        action: "screenshot",
        multipleSections: true,
        sectionCount: 3,
      });

      assertEquals(singleResult.success, true);
      assertEquals(multipleResult.success, true);
    });

    it("should reject invalid or inert screenshot options", () => {
      assertEquals(
        MessageFromStudioSchema.safeParse({
          action: "screenshot",
          multipleSections: true,
          sectionCount: 21,
        }).success,
        false,
      );
      assertEquals(
        MessageFromStudioSchema.safeParse({
          action: "screenshot",
          options: { quality: 0.8 },
        }).success,
        false,
      );
      assertEquals(
        MessageFromStudioSchema.safeParse({
          action: "screenshot",
          sectionCount: 3,
        }).success,
        false,
      );
      assertEquals(
        MessageFromStudioSchema.safeParse({
          action: "screenshot",
          multipleSections: false,
          sectionCount: 3,
        }).success,
        false,
      );
      assertEquals(
        MessageFromStudioSchema.safeParse({
          action: "screenshot",
          multipleSections: true,
          options: { scrollTo: 120 },
        }).success,
        false,
      );
      assertEquals(
        MessageFromStudioSchema.safeParse({
          action: "screenshot",
          multipleSections: true,
          options: { fullPage: false },
        }).success,
        false,
      );
      assertEquals(
        MessageFromStudioSchema.safeParse({
          action: "screenshot",
          multipleSections: true,
          options: {},
        }).success,
        false,
      );
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
