import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";

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
    method: getLogMethodSchema(),
    data: v.array(v.unknown()).optional(),
    timestamp: v.string().optional(),
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

export const getNavigatorNodeSchema = defineSchema((v): Schema<{
  id: string;
  name: string;
  type: "root" | "component" | "element" | "markdown" | "text";
  path: string;
  parentId: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
  children: unknown[];
  text?: string;
  isRemote?: boolean;
}> =>
  v.lazy(() =>
    v.object({
      id: v.string(),
      name: v.string(),
      type: getNavigatorNodeTypeSchema(),
      path: v.string(),
      parentId: v.string(),
      start: v.object({
        line: v.number().int().nonnegative(),
        column: v.number().int().nonnegative(),
      }),
      end: v.object({
        line: v.number().int().nonnegative(),
        column: v.number().int().nonnegative(),
      }),
      children: v.array(getNavigatorNodeSchema()),
      text: v.string().optional(),
      isRemote: v.boolean().optional(),
    })
  ) as Schema<{
    id: string;
    name: string;
    type: "root" | "component" | "element" | "markdown" | "text";
    path: string;
    parentId: string;
    start: { line: number; column: number };
    end: { line: number; column: number };
    children: unknown[];
    text?: string;
    isRemote?: boolean;
  }>
);

export const getErrorMessageSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["error", "warning"]),
    message: v.string(),
    file: v.string().optional(),
    line: v.number().int().positive().optional(),
    column: v.number().int().nonnegative().optional(),
  })
);

/** postMessage events from Renderer to Studio */
export const getMessageFromRendererSchema = defineSchema((v) =>
  v.discriminatedUnion("action", [
    v.object({
      action: v.literal("appLoaded"),
      url: v.string(),
    }),
    v.object({
      action: v.literal("appUnloaded"),
      url: v.string(),
    }),
    v.object({
      action: v.literal("appUpdated"),
      url: v.string(),
      id: v.string().optional(),
      isInitialLoad: v.boolean().optional(),
      hasError: v.boolean().optional(),
      nodesStore: v.record(v.string(), v.unknown()).optional(),
      errors: v.array(getErrorMessageSchema()).optional(),
      warnings: v.array(getErrorMessageSchema()).optional(),
    }),
    v.object({
      action: v.literal("runtimeError"),
      url: v.string(),
      errors: v.array(getErrorMessageSchema()).optional(),
    }),
    v.object({
      action: v.literal("treeUpdated"),
      id: v.string(),
      url: v.string(),
      tree: getNavigatorNodeSchema(),
    }),
    v.object({
      action: v.literal("setSelectedNode"),
      id: v.string().nullable(),
      node: v.object({
        name: v.string(),
        type: v.string(),
        file: v.string(),
        line: v.number(),
        column: v.number(),
        text: v.string(),
      }).optional(),
    }),
    v.object({
      action: v.literal("onPageTransitionStart"),
      url: v.string(),
      projectId: v.string(),
    }),
    v.object({
      action: v.literal("onPageTransitionEnd"),
      url: v.string(),
      projectId: v.string(),
      id: v.string(),
      params: v.record(v.string(), v.string()),
    }),
    v.object({
      action: v.literal("colorMode"),
      value: v.string(),
    }),
    v.object({
      action: v.literal("openFile"),
      filePath: v.string(),
      lineNumber: v.union([v.number(), v.string()]),
      columnNumber: v.union([v.number(), v.string()]).optional(),
      symbolName: v.string().optional(),
    }),
    v.object({
      action: v.literal("logEvent"),
      value: getLogMessageSchema(),
    }),
    v.object({
      action: v.literal("duplicateNode"),
      id: v.string(),
    }),
    v.object({
      action: v.literal("deleteNode"),
      id: v.string(),
    }),
    v.object({
      action: v.literal("wrapNode"),
      id: v.string(),
      element: v.string(),
    }),
    v.object({
      action: v.literal("changeNodeElement"),
      id: v.string(),
      element: v.string(),
    }),
    v.object({
      action: v.literal("openNodeFile"),
      id: v.string(),
    }),
    v.object({
      action: v.literal("forkNode"),
      id: v.string(),
    }),
    v.object({
      action: v.literal("editNodeProps"),
      id: v.string(),
    }),
    v.object({
      action: v.literal("chatMessage"),
      prompt: v.string(),
    }),
  ])
);

/** postMessage events from Studio to Renderer */
export const getMessageFromStudioSchema = defineSchema((v) =>
  v.discriminatedUnion("action", [
    v.object({
      action: v.literal("routeChange"),
      url: v.string(),
    }),
    v.object({
      action: v.literal("colorMode"),
      value: v.string(),
    }),
    v.object({
      action: v.literal("toggleLayout"),
      value: v.boolean(),
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
      action: v.literal("providerId"),
      id: v.string(),
    }),
    v.object({
      action: v.literal("layoutId"),
      id: v.string(),
    }),
    v.object({
      action: v.literal("setSelectedNode"),
      id: v.string(),
      scroll: v.boolean().optional(),
    }),
    v.object({
      action: v.literal("setHoveredNode"),
      id: v.string(),
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
