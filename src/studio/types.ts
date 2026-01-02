/**
 * Studio Communication Types
 *
 * Message types for postMessage communication between Studio and Renderer iframe.
 * These must be compatible with veryfront-frontend's message types.
 */

// Console log method types (from console-feed)
export type LogMethod =
  | "log"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "table"
  | "clear"
  | "time"
  | "timeEnd"
  | "count"
  | "assert"
  | "command"
  | "result"
  | "dir";

export interface LogMessage {
  method: LogMethod;
  data?: unknown[];
  timestamp?: string;
}

// Navigator tree node (simplified for SSR - no AST positions)
export type NavigatorNodeType = "root" | "component" | "element" | "markdown" | "text";

export interface NavigatorNode {
  id: string;
  name: string;
  type: NavigatorNodeType;
  path: string;
  parentId: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
  children: NavigatorNode[];
  text?: string;
  isRemote?: boolean;
}

// Bundler error/warning message
export interface BundlerMessage {
  type: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

// Messages FROM Renderer → Studio
export type MessageFromRenderer =
  | {
    action: "appLoaded";
    url: string;
  }
  | {
    action: "appUnloaded";
    url: string;
  }
  | {
    action: "appUpdated";
    url: string;
    id: string;
    isInitialLoad?: boolean;
    nodesStore?: Record<string, unknown>;
    errors?: BundlerMessage[];
    warnings?: BundlerMessage[];
  }
  | {
    action: "runtimeError";
    url: string;
    errors?: BundlerMessage[];
  }
  | {
    action: "treeUpdated";
    id: string;
    url: string;
    tree: NavigatorNode;
  }
  | {
    action: "setSelectedNode";
    id: string;
  }
  | {
    action: "errorPageLoaded";
    url: string;
  }
  | {
    action: "onPageTransitionStart";
    url: string;
    projectId: string;
  }
  | {
    action: "onPageTransitionEnd";
    url: string;
    projectId: string;
    id: string;
    params: Record<string, string>;
  }
  | {
    action: "colorMode";
    value: string;
  }
  | {
    action: "openFile";
    filePath: string;
    lineNumber: number | string;
    columnNumber?: number | string;
  }
  | {
    action: "logEvent";
    value: LogMessage;
  }
  | {
    action: "focusEditor";
  }
  | {
    action: "duplicateNode";
    id: string;
  }
  | {
    action: "deleteNode";
    id: string;
  }
  | {
    action: "wrapNode";
    id: string;
    element: string;
  }
  | {
    action: "changeNodeElement";
    id: string;
    element: string;
  }
  | {
    action: "openNodeFile";
    id: string;
  }
  | {
    action: "forkNode";
    id: string;
  }
  | {
    action: "editNodeProps";
    id: string;
  };

// Messages FROM Studio → Renderer
export type MessageFromStudio =
  | {
    action: "routeChange";
    url: string;
  }
  | {
    action: "colorMode";
    value: string;
  }
  | {
    action: "toggleLayout";
    value: boolean;
  }
  | {
    action: "toggleInspectMode";
    value: boolean;
    deselectElements?: boolean;
  }
  | {
    action: "goBack";
  }
  | {
    action: "goForward";
  }
  | {
    action: "reload";
  }
  | {
    action: "providerId";
    id: string;
  }
  | {
    action: "layoutId";
    id: string;
  }
  | {
    action: "setSelectedNode";
    id: string;
    scroll?: boolean;
  }
  | {
    action: "setHoveredNode";
    id: string;
  };

// Data attributes used for element identification
export const DATA_VF_ID = "data-vf-id";
export const DATA_VF_SELECTOR = "data-vf-selector";
export const DATA_VF_TEXT = "data-vf-text";
export const DATA_VF_IGNORE = "data-vf-ignore";
export const DATA_VF_SELECTION = "data-vf-selection";
