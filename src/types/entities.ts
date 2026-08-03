export interface Frontmatter {
  title?: string;
  description?: string;
  layout?: string | boolean;
  tags?: string[];
  date?: string;
  published?: boolean;
  isLayout?: boolean;
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

export function isFrontmatterRecord(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return !Array.isArray(value) &&
      (prototype === Object.prototype || prototype === null);
  } catch {
    return false;
  }
}

/**
 * Snapshot parsed frontmatter without invoking accessors, then remove values
 * that violate the framework's known metadata fields. Unknown fields remain
 * available to applications.
 */
export function normalizeFrontmatter(value: unknown): Frontmatter {
  if (!isFrontmatterRecord(value)) return {};

  const normalized: Frontmatter = {};
  try {
    for (
      const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(value),
      )
    ) {
      if (!descriptor.enumerable || !("value" in descriptor)) continue;
      Object.defineProperty(normalized, key, {
        configurable: true,
        enumerable: true,
        value: descriptor.value,
        writable: true,
      });
    }
  } catch {
    return {};
  }

  removeInvalidFrontmatterField(
    normalized,
    "title",
    (entry) => typeof entry === "string",
  );
  removeInvalidFrontmatterField(
    normalized,
    "description",
    (entry) => typeof entry === "string",
  );
  removeInvalidFrontmatterField(
    normalized,
    "layout",
    (entry) => typeof entry === "string" || typeof entry === "boolean",
  );
  normalizeFrontmatterTags(normalized);
  normalizeFrontmatterDate(normalized);
  removeInvalidFrontmatterField(
    normalized,
    "published",
    (entry) => typeof entry === "boolean",
  );
  removeInvalidFrontmatterField(
    normalized,
    "isLayout",
    (entry) => typeof entry === "boolean",
  );
  return normalized;
}

function normalizeFrontmatterDate(frontmatter: Frontmatter): void {
  const value = frontmatter.date;
  if (value !== undefined && typeof value !== "string") delete frontmatter.date;
}

function normalizeFrontmatterTags(frontmatter: Frontmatter): void {
  const value = frontmatter.tags;
  if (value === undefined) return;

  const tags = snapshotStringArray(value);
  if (tags === null) {
    delete frontmatter.tags;
    return;
  }
  frontmatter.tags = tags;
}

function snapshotStringArray(value: unknown): string[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)) return null;
    const length = lengthDescriptor.value;
    if (
      typeof length !== "number" || !Number.isSafeInteger(length) || length < 0
    ) return null;
    if (Reflect.ownKeys(value).length !== length + 1) return null;

    const snapshot: string[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor?.enumerable || !("value" in descriptor) ||
        typeof descriptor.value !== "string"
      ) return null;
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
}

function removeInvalidFrontmatterField(
  frontmatter: Frontmatter,
  key: keyof Frontmatter,
  isValid: (value: unknown) => boolean,
): void {
  const value = frontmatter[key];
  if (value !== undefined && !isValid(value)) delete frontmatter[key];
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

  const isComponent = !isLayout && !isDynamicRoute && /^[A-Z]/.test(baseName);

  const isPage = !isLayout && !isComponent;

  return {
    type: detectEntityTypeFromFlags(isLayout, isComponent),
    kind,
    isLayout,
    isComponent,
    isPage,
  };
}
