import { z } from "zod";

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

// File extension regex - must end with a valid extension
const FILE_PATH_REGEX = /\.(mdx?|tsx?|jsx?)$/;

// Zod schema for Frontmatter values - matches the index signature
const FrontmatterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.undefined(),
]);

/**
 * Zod schema for Frontmatter validation.
 */
export const FrontmatterSchema: z.ZodType<Frontmatter> = z.record(
  z.string(),
  FrontmatterValueSchema,
);

/**
 * Zod schema for Entity validation.
 * Used to catch programming errors early when entities are created or transformed.
 */
export const EntitySchema: z.ZodType<Entity> = z.object({
  id: z.string().uuid("Entity id must be a valid UUID"),
  path: z
    .string()
    .min(1, "Entity path cannot be empty")
    .regex(
      FILE_PATH_REGEX,
      "Entity path must end with a valid file extension (.md, .mdx, .ts, .tsx, .js, .jsx)",
    ),
  slug: z.string().min(1, "Entity slug cannot be empty"),
  type: z.enum(["page", "layout", "component"]),
  content: z.string(),
  frontmatter: FrontmatterSchema,
  kind: z.enum(["mdx", "tsx"]).optional(),
  isLayout: z.boolean().optional(),
  isComponent: z.boolean().optional(),
  isPage: z.boolean().optional(),
});

/**
 * Validate an Entity object and throw if invalid.
 * Use this at system boundaries where entities are created from external data.
 */
export function validateEntity(entity: unknown): Entity {
  return EntitySchema.parse(entity);
}

/**
 * Safely validate an Entity, returning result or null.
 * Use for optional validation where you want to handle errors gracefully.
 */
export function safeValidateEntity(entity: unknown): Entity | null {
  const result = EntitySchema.safeParse(entity);
  if (!result.success) return null;
  return result.data;
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
