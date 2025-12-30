export interface Frontmatter {
  title?: string;
  description?: string;
  layout?: string;
  provider?: string;
  tags?: string[];
  date?: string;
  published?: boolean;
  priority?: number;
  [key: string]: string | number | boolean | string[] | undefined;
}

export interface BundleInfo {
  id: string;
  path: string;
  size?: number;
  hash?: string;
  dependencies?: string[];
  exports?: string[];
  compiled?: boolean;
  timestamp?: Date;
}

export interface LoaderData {
  props?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  error?: string;
  timestamp?: Date;
}

export interface Entity {
  id: string;
  slug: string;
  type: "page" | "layout" | "provider" | "component";
  content: string;
  frontmatter: Frontmatter;
  kind?: "mdx" | "tsx";
  isLayout?: boolean;
  isProvider?: boolean;
  isComponent?: boolean;
  isPage?: boolean;
}

export interface EntityInfo {
  entity: Entity;
  bundle?: BundleInfo | null;
  loaderData?: LoaderData | null;
}

export interface EntityTypeInfo {
  type: Entity["type"];
  kind?: "mdx" | "tsx";
  isLayout: boolean;
  isProvider: boolean;
  isComponent: boolean;
  isPage: boolean;
}

export function detectEntityType(
  fileName: string,
  frontmatter: Frontmatter = {},
): EntityTypeInfo {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const lowerBase = baseName.toLowerCase();

  // Detect file extension to determine kind
  const ext = fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  const kind: "mdx" | "tsx" | undefined = ext === "mdx"
    ? "mdx"
    : (ext === "tsx" || ext === "ts" || ext === "jsx" || ext === "js")
    ? "tsx"
    : undefined;

  const isLayout = lowerBase === "layout" || baseName.endsWith("Layout") ||
    lowerBase.includes("layout") || frontmatter.isLayout === true;

  const isProvider = lowerBase === "provider" || baseName.endsWith("Provider") ||
    frontmatter.isProvider === true;

  const isDynamicRoute = fileName[0] === "[";

  const isComponent = !isLayout && !isProvider && !isDynamicRoute &&
    fileName[0] === fileName[0]?.toUpperCase();

  const isPage = !isLayout && !isProvider && !isComponent;

  const type: Entity["type"] = isLayout
    ? "layout"
    : isProvider
    ? "provider"
    : isComponent
    ? "component"
    : "page";

  return {
    type,
    kind,
    isLayout,
    isProvider,
    isComponent,
    isPage,
  };
}
