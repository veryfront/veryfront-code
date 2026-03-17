import { z } from "zod";

export const logMethodSchema = z.enum([
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
]);

export const LogMessageSchema = z.object({
  method: logMethodSchema,
  data: z.array(z.unknown()).optional(),
  timestamp: z.string().optional(),
});

export const navigatorNodeTypeSchema = z.enum([
  "root",
  "component",
  "element",
  "markdown",
  "text",
]);

export const NavigatorNodeSchema: z.ZodType<{
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
}> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: navigatorNodeTypeSchema,
    path: z.string(),
    parentId: z.string(),
    start: z.object({
      line: z.number().int().nonnegative(),
      column: z.number().int().nonnegative(),
    }),
    end: z.object({
      line: z.number().int().nonnegative(),
      column: z.number().int().nonnegative(),
    }),
    children: z.array(NavigatorNodeSchema),
    text: z.string().optional(),
    isRemote: z.boolean().optional(),
  })
);

export const ErrorMessageSchema = z.object({
  type: z.enum(["error", "warning"]),
  message: z.string(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().nonnegative().optional(),
});

/** postMessage events from Renderer to Studio */
export const MessageFromRendererSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("appLoaded"),
    url: z.string(),
  }),
  z.object({
    action: z.literal("appUnloaded"),
    url: z.string(),
  }),
  z.object({
    action: z.literal("appUpdated"),
    url: z.string(),
    id: z.string().optional(),
    isInitialLoad: z.boolean().optional(),
    hasError: z.boolean().optional(),
    nodesStore: z.record(z.unknown()).optional(),
    errors: z.array(ErrorMessageSchema).optional(),
    warnings: z.array(ErrorMessageSchema).optional(),
  }),
  z.object({
    action: z.literal("runtimeError"),
    url: z.string(),
    errors: z.array(ErrorMessageSchema).optional(),
  }),
  z.object({
    action: z.literal("treeUpdated"),
    id: z.string(),
    url: z.string(),
    tree: NavigatorNodeSchema,
  }),
  z.object({
    action: z.literal("setSelectedNode"),
    id: z.string().nullable(),
    node: z.object({
      name: z.string(),
      type: z.string(),
      file: z.string(),
      line: z.number(),
      column: z.number(),
      text: z.string(),
    }).optional(),
  }),
  z.object({
    action: z.literal("errorPageLoaded"),
    url: z.string(),
  }),
  z.object({
    action: z.literal("onPageTransitionStart"),
    url: z.string(),
    projectId: z.string(),
  }),
  z.object({
    action: z.literal("onPageTransitionEnd"),
    url: z.string(),
    projectId: z.string(),
    id: z.string(),
    params: z.record(z.string()),
  }),
  z.object({
    action: z.literal("colorMode"),
    value: z.string(),
  }),
  z.object({
    action: z.literal("openFile"),
    filePath: z.string(),
    lineNumber: z.union([z.number(), z.string()]),
    columnNumber: z.union([z.number(), z.string()]).optional(),
    symbolName: z.string().optional(),
  }),
  z.object({
    action: z.literal("logEvent"),
    value: LogMessageSchema,
  }),
  z.object({
    action: z.literal("duplicateNode"),
    id: z.string(),
  }),
  z.object({
    action: z.literal("deleteNode"),
    id: z.string(),
  }),
  z.object({
    action: z.literal("wrapNode"),
    id: z.string(),
    element: z.string(),
  }),
  z.object({
    action: z.literal("changeNodeElement"),
    id: z.string(),
    element: z.string(),
  }),
  z.object({
    action: z.literal("openNodeFile"),
    id: z.string(),
  }),
  z.object({
    action: z.literal("forkNode"),
    id: z.string(),
  }),
  z.object({
    action: z.literal("editNodeProps"),
    id: z.string(),
  }),
  z.object({
    action: z.literal("chatMessage"),
    prompt: z.string(),
  }),
]);

/** postMessage events from Studio to Renderer */
export const MessageFromStudioSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("routeChange"),
    url: z.string(),
  }),
  z.object({
    action: z.literal("colorMode"),
    value: z.string(),
  }),
  z.object({
    action: z.literal("toggleLayout"),
    value: z.boolean(),
  }),
  z.object({
    action: z.literal("toggleInspectMode"),
    value: z.boolean(),
    deselectElements: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("goBack"),
  }),
  z.object({
    action: z.literal("goForward"),
  }),
  z.object({
    action: z.literal("reload"),
  }),
  z.object({
    action: z.literal("providerId"),
    id: z.string(),
  }),
  z.object({
    action: z.literal("layoutId"),
    id: z.string(),
  }),
  z.object({
    action: z.literal("setSelectedNode"),
    id: z.string(),
    scroll: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("setHoveredNode"),
    id: z.string(),
  }),
]);

// Inferred types
export type LogMethod = z.infer<typeof logMethodSchema>;
export type LogMessage = z.infer<typeof LogMessageSchema>;
export type NavigatorNodeType = z.infer<typeof navigatorNodeTypeSchema>;
export type NavigatorNode = z.infer<typeof NavigatorNodeSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type MessageFromRenderer = z.infer<typeof MessageFromRendererSchema>;
export type MessageFromStudio = z.infer<typeof MessageFromStudioSchema>;
