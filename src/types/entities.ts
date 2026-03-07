export interface Frontmatter {
  title?: string;
  description?: string;
  layout?: string;
  tags?: string[];
  date?: string;
  published?: boolean;
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
  path: string;
  slug: string;
  type: "page" | "layout" | "component";
  content: string;
  frontmatter: Frontmatter;
  kind?: "mdx" | "tsx";
  isLayout?: boolean;
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
  isComponent: boolean;
  isPage: boolean;
}

function detectFileKind(ext?: string): "mdx" | "tsx" | undefined {
  if (ext === "mdx") return "mdx";
  if (ext === "tsx" || ext === "ts" || ext === "jsx" || ext === "js") return "tsx";
  return undefined;
}

function detectEntityTypeFromFlags(
  isLayout: boolean,
  isComponent: boolean,
): Entity["type"] {
  if (isLayout) return "layout";
  if (isComponent) return "component";
  return "page";
}

export function detectEntityType(
  fileName: string,
  frontmatter: Frontmatter = {},
): EntityTypeInfo {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const lowerBase = baseName.toLowerCase();

  const ext = fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  const kind = detectFileKind(ext);

  const isLayout = lowerBase === "layout" ||
    baseName.endsWith("Layout") ||
    lowerBase.includes("layout") ||
    frontmatter.isLayout === true;

  const isDynamicRoute = fileName[0] === "[";

  const isComponent = !isLayout && !isDynamicRoute && fileName[0] === fileName[0]?.toUpperCase();

  const isPage = !isLayout && !isComponent;

  return {
    type: detectEntityTypeFromFlags(isLayout, isComponent),
    kind,
    isLayout,
    isComponent,
    isPage,
  };
}
