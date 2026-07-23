import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import {
  MAX_STUDIO_CONFIG_PATH_LENGTH,
  MAX_STUDIO_MESSAGE_ID_LENGTH,
  MAX_STUDIO_NAVIGATOR_DEPTH,
  MAX_STUDIO_NAVIGATOR_NODES,
  MAX_STUDIO_ROUTE_PARAM_ENTRIES,
  MAX_STUDIO_ROUTE_PARAM_KEY_LENGTH,
  MAX_STUDIO_ROUTE_PARAM_VALUE_LENGTH,
  MAX_STUDIO_SCREENSHOT_DATA_LENGTH,
  MAX_STUDIO_SCREENSHOT_REQUEST_ID_LENGTH,
  MAX_STUDIO_SCREENSHOT_SCROLL_OFFSET,
  MAX_STUDIO_SCREENSHOT_SECTIONS,
  MAX_STUDIO_URL_LENGTH,
} from "#veryfront/studio/limits.ts";

const MAX_STUDIO_ID_LENGTH = MAX_STUDIO_MESSAGE_ID_LENGTH;
const MAX_STUDIO_MODE_LENGTH = 64;
const MAX_SCREENSHOT_SECTIONS = MAX_STUDIO_SCREENSHOT_SECTIONS;
const MAX_SCREENSHOT_SCROLL_OFFSET = MAX_STUDIO_SCREENSHOT_SCROLL_OFFSET;
const MAX_STUDIO_PATH_LENGTH = MAX_STUDIO_CONFIG_PATH_LENGTH;
const MAX_STUDIO_TEXT_LENGTH = 65_536;
const MAX_STUDIO_ERRORS = 100;
const MAX_STUDIO_LOG_VALUES = 101;
const MAX_NAVIGATOR_CHILDREN = MAX_STUDIO_NAVIGATOR_NODES;
const MAX_NAVIGATOR_TEXT_LENGTH = 200;
const MAX_SOURCE_POSITION = 10_000_000;
const MAX_SCREENSHOT_DATA_LENGTH = MAX_STUDIO_SCREENSHOT_DATA_LENGTH;
const MAX_NAVIGATOR_SCHEMA_DEPTH = MAX_STUDIO_NAVIGATOR_DEPTH + 1;

function isBoundedTransitionParams(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length > MAX_STUDIO_ROUTE_PARAM_ENTRIES ||
      keys.some((key) => typeof key !== "string")
    ) {
      return false;
    }

    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!;
      if (
        !descriptor.enumerable || descriptor.get || descriptor.set ||
        key.length === 0 || key.length > MAX_STUDIO_ROUTE_PARAM_KEY_LENGTH || key.includes("\0") ||
        typeof descriptor.value !== "string" ||
        descriptor.value.length > MAX_STUDIO_ROUTE_PARAM_VALUE_LENGTH ||
        descriptor.value.includes("\0")
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

interface NavigatorNodeValue {
  id: string;
  name: string;
  type: "root" | "component" | "element" | "markdown" | "text";
  path: string;
  parentId: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
  children: NavigatorNodeValue[];
  text?: string;
  isRemote?: boolean;
}

interface NavigatorBudgetFrame {
  nodes: unknown[];
  length: number;
  index: number;
  depth: number;
}

function readOwnNavigatorChildren(value: unknown): unknown[] | null {
  if (value === null || typeof value !== "object") return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "children");
    return descriptor && "value" in descriptor && Array.isArray(descriptor.value)
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function readArrayLength(value: unknown[]): number | null {
  try {
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    return typeof length === "number" && Number.isSafeInteger(length) && length >= 0
      ? length
      : null;
  } catch {
    return null;
  }
}

function readOwnArrayItem(value: unknown[], index: number): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function navigatorTreeIsWithinBudget(value: unknown): boolean {
  const rootChildren = readOwnNavigatorChildren(value);
  if (!rootChildren) return false;

  const rootLength = readArrayLength(rootChildren);
  if (rootLength === null) return false;
  if (rootLength > MAX_STUDIO_NAVIGATOR_NODES) return false;

  let contentNodeCount = 0;
  const traversal: NavigatorBudgetFrame[] = [{
    nodes: rootChildren,
    length: rootLength,
    index: 0,
    depth: 1,
  }];
  while (traversal.length > 0) {
    const frame = traversal.at(-1)!;
    if (frame.index >= frame.length) {
      traversal.pop();
      continue;
    }

    const node = readOwnArrayItem(frame.nodes, frame.index++);
    contentNodeCount++;
    if (contentNodeCount > MAX_STUDIO_NAVIGATOR_NODES) return false;

    const children = readOwnNavigatorChildren(node);
    if (!children) return false;
    const childCount = readArrayLength(children);
    if (childCount === null) return false;
    if (childCount === 0) continue;
    if (frame.depth >= MAX_NAVIGATOR_SCHEMA_DEPTH) return false;
    if (childCount > MAX_STUDIO_NAVIGATOR_NODES - contentNodeCount) return false;
    traversal.push({ nodes: children, length: childCount, index: 0, depth: frame.depth + 1 });
  }
  return true;
}

export const getLogMethodSchema = defineSchema((v) =>
  v.enum([
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
  ])
);

export const getLogMessageSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1).max(MAX_STUDIO_ID_LENGTH).optional(),
    method: getLogMethodSchema(),
    data: v.array(v.unknown()).max(MAX_STUDIO_LOG_VALUES).optional(),
    timestamp: v.string().max(64).optional(),
  })
);

export const getNavigatorNodeTypeSchema = defineSchema((v) =>
  v.enum([
    "root",
    "component",
    "element",
    "markdown",
    "text",
  ])
);

export const getNavigatorNodeSchema = defineSchema((v): Schema<NavigatorNodeValue> => {
  const createNodeSchema = (depth: number): Schema<NavigatorNodeValue> => {
    const children = depth >= MAX_NAVIGATOR_SCHEMA_DEPTH
      ? v.array(v.unknown()).max(0)
      : v.array(createNodeSchema(depth + 1)).max(MAX_NAVIGATOR_CHILDREN);

    return v.object({
      id: v.string().min(1).max(MAX_STUDIO_ID_LENGTH),
      name: v.string().min(1).max(256),
      type: getNavigatorNodeTypeSchema(),
      path: v.string().max(MAX_STUDIO_PATH_LENGTH),
      parentId: v.string().max(MAX_STUDIO_ID_LENGTH),
      start: v.object({
        line: v.number().int().nonnegative().max(MAX_SOURCE_POSITION),
        column: v.number().int().nonnegative().max(MAX_SOURCE_POSITION),
      }),
      end: v.object({
        line: v.number().int().nonnegative().max(MAX_SOURCE_POSITION),
        column: v.number().int().nonnegative().max(MAX_SOURCE_POSITION),
      }),
      children,
      text: v.string().max(MAX_NAVIGATOR_TEXT_LENGTH).optional(),
      isRemote: v.boolean().optional(),
    }) as Schema<NavigatorNodeValue>;
  };

  // A custom input guard runs before the recursive output schema in every
  // SchemaValidator implementation that honors the contract's pipe semantics.
  return v.custom<NavigatorNodeValue>(
    navigatorTreeIsWithinBudget,
    "Navigator tree exceeds the depth or content node limit",
  ).pipe(createNodeSchema(0)).superRefine((root, context) => {
    let contentNodeCount = 0;
    const traversal = [{ nodes: root.children, index: 0 }];
    while (traversal.length > 0) {
      const frame = traversal.at(-1)!;
      if (frame.index >= frame.nodes.length) {
        traversal.pop();
        continue;
      }
      const node = frame.nodes[frame.index++]!;
      contentNodeCount++;
      if (contentNodeCount > MAX_STUDIO_NAVIGATOR_NODES) {
        context.addIssue({ message: "Navigator tree exceeds the content node limit" });
        return;
      }
      if (node.children.length > 0) traversal.push({ nodes: node.children, index: 0 });
    }
  });
});

export const getErrorMessageSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["error", "warning"]),
    message: v.string().max(MAX_STUDIO_TEXT_LENGTH),
    file: v.string().max(MAX_STUDIO_PATH_LENGTH).optional(),
    line: v.number().int().positive().max(MAX_SOURCE_POSITION).optional(),
    column: v.number().int().nonnegative().max(MAX_SOURCE_POSITION).optional(),
  })
);

export const getScreenshotCaptureResultSchema = defineSchema((v) =>
  v.object({
    success: v.boolean(),
    data: v.string().max(MAX_SCREENSHOT_DATA_LENGTH).optional(),
    width: v.number().int().positive().max(16_384).optional(),
    height: v.number().int().positive().max(16_384).optional(),
    scrollY: v.number().nonnegative().max(MAX_SCREENSHOT_SCROLL_OFFSET).optional(),
    totalHeight: v.number().nonnegative().max(MAX_SCREENSHOT_SCROLL_OFFSET).optional(),
    viewportHeight: v.number().nonnegative().max(MAX_SCREENSHOT_SCROLL_OFFSET).optional(),
    url: v.string().max(MAX_STUDIO_URL_LENGTH).optional(),
    error: v.string().max(2_048).optional(),
    section: v.number().int().min(1).max(MAX_SCREENSHOT_SECTIONS).optional(),
    totalSections: v.number().int().min(1).max(MAX_SCREENSHOT_SECTIONS).optional(),
  })
);

/** postMessage events from Renderer to Studio */
export const getMessageFromRendererSchema = defineSchema((v) =>
  v.discriminatedUnion("action", [
    v.object({
      action: v.literal("appLoaded"),
      url: v.string().max(MAX_STUDIO_URL_LENGTH),
    }),
    v.object({
      action: v.literal("appUnloaded"),
      url: v.string().max(MAX_STUDIO_URL_LENGTH),
    }),
    v.object({
      action: v.literal("appUpdated"),
      url: v.string().max(MAX_STUDIO_URL_LENGTH),
      id: v.string().max(MAX_STUDIO_ID_LENGTH).optional(),
      isInitialLoad: v.boolean().optional(),
      hasError: v.boolean().optional(),
      errors: v.array(getErrorMessageSchema()).max(MAX_STUDIO_ERRORS).optional(),
      warnings: v.array(getErrorMessageSchema()).max(MAX_STUDIO_ERRORS).optional(),
    }).strict(),
    v.object({
      action: v.literal("runtimeError"),
      url: v.string().max(MAX_STUDIO_URL_LENGTH),
      errors: v.array(getErrorMessageSchema()).max(MAX_STUDIO_ERRORS).optional(),
    }),
    v.object({
      action: v.literal("treeUpdated"),
      id: v.string().max(MAX_STUDIO_ID_LENGTH),
      url: v.string().max(MAX_STUDIO_URL_LENGTH),
      tree: getNavigatorNodeSchema(),
      sourceHash: v.string().max(256).nullable().optional(),
    }),
    v.object({
      action: v.literal("setSelectedNode"),
      id: v.string().max(MAX_STUDIO_ID_LENGTH).nullable(),
      node: v.object({
        name: v.string().max(256),
        type: v.string().max(64),
        file: v.string().max(MAX_STUDIO_PATH_LENGTH),
        line: v.number().int().nonnegative().max(MAX_SOURCE_POSITION),
        column: v.number().int().nonnegative().max(MAX_SOURCE_POSITION),
        text: v.string().max(MAX_NAVIGATOR_TEXT_LENGTH),
      }).optional(),
    }),
    v.object({
      action: v.literal("onPageTransitionStart"),
      url: v.string().max(MAX_STUDIO_URL_LENGTH),
      projectId: v.string().max(MAX_STUDIO_ID_LENGTH),
    }),
    v.object({
      action: v.literal("onPageTransitionEnd"),
      url: v.string().max(MAX_STUDIO_URL_LENGTH),
      projectId: v.string().max(MAX_STUDIO_ID_LENGTH),
      id: v.string().max(MAX_STUDIO_ID_LENGTH),
      params: v.custom<Record<string, string>>(
        isBoundedTransitionParams,
        "Page transition params exceed the supported limits",
      ).pipe(v.record(
        v.string().min(1).max(MAX_STUDIO_ROUTE_PARAM_KEY_LENGTH),
        v.string().max(MAX_STUDIO_ROUTE_PARAM_VALUE_LENGTH),
      )),
    }),
    v.object({
      action: v.literal("colorMode"),
      value: v.string().max(MAX_STUDIO_MODE_LENGTH),
    }),
    v.object({
      action: v.literal("openFile"),
      filePath: v.string().max(MAX_STUDIO_PATH_LENGTH),
      lineNumber: v.union([
        v.number().int().nonnegative().max(MAX_SOURCE_POSITION),
        v.string().max(16),
      ]),
      columnNumber: v.union([
        v.number().int().nonnegative().max(MAX_SOURCE_POSITION),
        v.string().max(16),
      ]).optional(),
      symbolName: v.string().max(256).optional(),
    }),
    v.object({
      action: v.literal("logEvent"),
      value: getLogMessageSchema(),
    }),
    v.object({
      action: v.literal("screenshotResult"),
      requestId: v.union([
        v.string().min(1).max(MAX_STUDIO_SCREENSHOT_REQUEST_ID_LENGTH).refine(
          (value) => !value.includes("\0"),
          "Screenshot request ID cannot contain NUL bytes",
        ),
        v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      ]).optional(),
      multiple: v.boolean(),
      success: v.boolean().optional(),
      data: v.string().max(MAX_SCREENSHOT_DATA_LENGTH).optional(),
      width: v.number().int().positive().max(16_384).optional(),
      height: v.number().int().positive().max(16_384).optional(),
      scrollY: v.number().nonnegative().max(MAX_SCREENSHOT_SCROLL_OFFSET).optional(),
      totalHeight: v.number().nonnegative().max(MAX_SCREENSHOT_SCROLL_OFFSET).optional(),
      viewportHeight: v.number().nonnegative().max(MAX_SCREENSHOT_SCROLL_OFFSET).optional(),
      url: v.string().max(MAX_STUDIO_URL_LENGTH).optional(),
      error: v.string().max(2_048).optional(),
      results: v.array(getScreenshotCaptureResultSchema()).min(1).max(MAX_SCREENSHOT_SECTIONS)
        .optional(),
    }).superRefine((message, context) => {
      const aggregateDataLength = (message.data?.length ?? 0) +
        (message.results?.reduce((total, result) => total + (result.data?.length ?? 0), 0) ?? 0);
      if (aggregateDataLength > MAX_SCREENSHOT_DATA_LENGTH) {
        context.addIssue({ message: "Screenshot result data exceeds the aggregate limit" });
      }
      if (message.multiple) {
        if (
          !message.results || message.results.length === 0 || message.success !== undefined ||
          message.data !== undefined || message.width !== undefined ||
          message.height !== undefined ||
          message.scrollY !== undefined || message.totalHeight !== undefined ||
          message.viewportHeight !== undefined || message.url !== undefined ||
          message.error !== undefined
        ) {
          context.addIssue({ message: "Multiple screenshot results must use only results" });
        }
      } else if (message.results !== undefined || message.success === undefined) {
        context.addIssue({ message: "Single screenshot results must include success" });
      }
    }),
    v.object({
      action: v.literal("duplicateNode"),
      id: v.string().max(MAX_STUDIO_ID_LENGTH),
    }),
    v.object({
      action: v.literal("deleteNode"),
      id: v.string().max(MAX_STUDIO_ID_LENGTH),
    }),
    v.object({
      action: v.literal("wrapNode"),
      id: v.string().max(MAX_STUDIO_ID_LENGTH),
      element: v.string().max(256),
    }),
    v.object({
      action: v.literal("changeNodeElement"),
      id: v.string().max(MAX_STUDIO_ID_LENGTH),
      element: v.string().max(256),
    }),
    v.object({
      action: v.literal("openNodeFile"),
      id: v.string().max(MAX_STUDIO_ID_LENGTH),
    }),
    v.object({
      action: v.literal("forkNode"),
      id: v.string().max(MAX_STUDIO_ID_LENGTH),
    }),
    v.object({
      action: v.literal("editNodeProps"),
      id: v.string().max(MAX_STUDIO_ID_LENGTH),
    }),
    v.object({
      action: v.literal("chatMessage"),
      prompt: v.string().max(MAX_STUDIO_TEXT_LENGTH),
    }),
  ])
);

/** postMessage events from Studio to Renderer */
export const getMessageFromStudioSchema = defineSchema((v) =>
  v.discriminatedUnion("action", [
    v.object({
      action: v.literal("routeChange"),
      url: v.string().min(1).max(MAX_STUDIO_URL_LENGTH).refine(
        (value) => !value.includes("\0"),
        "Studio route URL cannot contain NUL bytes",
      ),
    }),
    v.object({
      action: v.literal("colorMode"),
      value: v.enum(["light", "dark"]),
    }),
    v.object({
      action: v.literal("toggleInspectMode"),
      value: v.boolean(),
      deselectElements: v.boolean().optional(),
    }),
    v.object({
      action: v.literal("goBack"),
    }),
    v.object({
      action: v.literal("goForward"),
    }),
    v.object({
      action: v.literal("reload"),
    }),
    v.object({
      action: v.literal("setSelectedNode"),
      id: v.string().min(1).max(MAX_STUDIO_ID_LENGTH).refine(
        (value) => !value.includes("\0"),
        "Studio node ID cannot contain NUL bytes",
      ),
      scroll: v.boolean().optional(),
    }),
    v.object({
      action: v.literal("setHoveredNode"),
      id: v.string().max(MAX_STUDIO_ID_LENGTH).refine(
        (value) => !value.includes("\0"),
        "Studio node ID cannot contain NUL bytes",
      ),
    }),
    v.object({
      action: v.literal("screenshot"),
      requestId: v.union([
        v.string().min(1).max(MAX_STUDIO_SCREENSHOT_REQUEST_ID_LENGTH).refine(
          (value) => !value.includes("\0"),
          "Screenshot request ID cannot contain NUL bytes",
        ),
        v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      ]).optional(),
      multipleSections: v.boolean().optional(),
      sectionCount: v.number().int().min(1).max(MAX_SCREENSHOT_SECTIONS).optional(),
      options: v.object({
        scrollTo: v.number().min(0).max(MAX_SCREENSHOT_SCROLL_OFFSET).optional(),
        fullPage: v.boolean().optional(),
      }).strict().optional(),
    }).superRefine((message, context) => {
      if (message.sectionCount !== undefined && message.multipleSections !== true) {
        context.addIssue({
          message: "Screenshot sectionCount requires multipleSections to be true",
          path: ["sectionCount"],
        });
      }
      if (message.multipleSections === true && message.options !== undefined) {
        context.addIssue({
          message: "Multi-section screenshots do not accept screenshot options",
          path: ["options"],
        });
      }
    }),
  ])
);

// Backward-compatible re-exports
export const logMethodSchema = lazySchema(getLogMethodSchema);
export const LogMessageSchema = lazySchema(getLogMessageSchema);
export const navigatorNodeTypeSchema = lazySchema(getNavigatorNodeTypeSchema);
export const NavigatorNodeSchema = lazySchema(getNavigatorNodeSchema);
export const ErrorMessageSchema = lazySchema(getErrorMessageSchema);
export const MessageFromRendererSchema = lazySchema(getMessageFromRendererSchema);
export const MessageFromStudioSchema = lazySchema(getMessageFromStudioSchema);

// Inferred types
export type LogMethod = InferSchema<ReturnType<typeof getLogMethodSchema>>;
export type LogMessage = InferSchema<ReturnType<typeof getLogMessageSchema>>;
export type NavigatorNodeType = InferSchema<ReturnType<typeof getNavigatorNodeTypeSchema>>;
export type NavigatorNode = InferSchema<ReturnType<typeof getNavigatorNodeSchema>>;
export type ErrorMessage = InferSchema<ReturnType<typeof getErrorMessageSchema>>;
export type MessageFromRenderer = InferSchema<ReturnType<typeof getMessageFromRendererSchema>>;
export type MessageFromStudio = InferSchema<ReturnType<typeof getMessageFromStudioSchema>>;
