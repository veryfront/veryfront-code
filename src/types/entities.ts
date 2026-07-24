/** Parsed metadata attached to an MD or MDX entity. */
export interface Frontmatter {
  /** Human-readable page title. */
  title?: string;
  /** Human-readable page summary. */
  description?: string;
  /** Layout reference, or a boolean layout directive accepted by legacy content. */
  layout?: string | boolean;
  /** One tag or a list of tags attached to the entity. */
  tags?: string | string[];
  /** Publication date as parsed from source frontmatter. */
  date?: string | Date;
  /** Whether the entity is published. */
  published?: boolean;
  /** Whether the entity itself defines a layout. */
  isLayout?: boolean;
  /** Additional frontmatter fields preserved from source content. */
  [key: string]: unknown;
}

/** Metadata about a compiled entity bundle. */
export interface BundleInfo {
  /** Bundle identifier. */
  id: string;
  /** Bundle output path. */
  path: string;
  /** Bundle size in bytes. */
  size?: number;
  /** Content fingerprint for the bundle. */
  hash?: string;
  /** Source dependencies included in the bundle. */
  dependencies?: string[];
  /** Named exports exposed by the bundle. */
  exports?: string[];
  /** Whether compilation completed successfully. */
  compiled?: boolean;
  /** Time at which the bundle metadata was produced. */
  timestamp?: Date;
}

/** Data returned by an entity loader. */
export interface LoaderData {
  /** Props passed to the rendered entity. */
  props?: Record<string, unknown>;
  /** Loader-specific metadata. */
  metadata?: Record<string, unknown>;
  /** Sanitized loader error message. */
  error?: string;
  /** Time at which the loader data was produced. */
  timestamp?: Date;
}

/** Source entity discovered in a Veryfront project. */
export interface Entity {
  /** Stable entity identifier supplied by the content adapter. */
  id: string;
  /** Source path used by the active content adapter. */
  path: string;
  /** Route or filename slug for the entity. */
  slug: string;
  /** Entity role inferred from its filename and frontmatter. */
  type: "page" | "layout" | "component";
  /** Source body with frontmatter removed when parsing succeeds. */
  content: string;
  /** Parsed source frontmatter. */
  frontmatter: Frontmatter;
  /** Normalized source syntax. */
  kind?: "mdx" | "tsx";
  /** Whether the entity defines a layout. */
  isLayout?: boolean;
  /** Whether the entity defines a reusable component. */
  isComponent?: boolean;
  /** Whether the entity defines a routable page. */
  isPage?: boolean;
}

/** Entity discovery result with optional compilation and loader metadata. */
export interface EntityInfo {
  /** Discovered source entity. */
  entity: Entity;
  /** Optional compiled bundle metadata. */
  bundle?: BundleInfo | null;
  /** Optional data returned by the entity loader. */
  loaderData?: LoaderData | null;
}

/** Classification returned by {@link detectEntityType}. */
export interface EntityTypeInfo {
  /** Inferred entity role. */
  type: Entity["type"];
  /** Normalized source syntax. */
  kind?: "mdx" | "tsx";
  /** Whether the filename or frontmatter identifies a layout. */
  isLayout: boolean;
  /** Whether the filename identifies a reusable component. */
  isComponent: boolean;
  /** Whether the filename identifies a routable page. */
  isPage: boolean;
}

/** Returns whether a parsed value is a plain record that can be normalized as frontmatter. */
export function isFrontmatterRecord(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return !Array.isArray(value) && (prototype === Object.prototype || prototype === null);
  } catch {
    return false;
  }
}

/**
 * Copies a plain parsed record and removes values that violate known frontmatter
 * fields. Mutable known values such as tag arrays and dates are detached from
 * their source. Unknown fields are preserved for application-specific metadata.
 */
export function normalizeFrontmatter(value: unknown): Frontmatter {
  if (!isFrontmatterRecord(value)) return {};

  const normalized: Frontmatter = {};
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
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

  removeInvalidFrontmatterField(normalized, "title", (entry) => typeof entry === "string");
  removeInvalidFrontmatterField(normalized, "description", (entry) => typeof entry === "string");
  removeInvalidFrontmatterField(
    normalized,
    "layout",
    (entry) => typeof entry === "string" || typeof entry === "boolean",
  );
  normalizeFrontmatterTags(normalized);
  normalizeFrontmatterDate(normalized);
  removeInvalidFrontmatterField(normalized, "published", (entry) => typeof entry === "boolean");
  removeInvalidFrontmatterField(normalized, "isLayout", (entry) => typeof entry === "boolean");
  return normalized;
}

function normalizeFrontmatterDate(frontmatter: Frontmatter): void {
  const value = frontmatter.date;
  if (value === undefined || typeof value === "string") return;

  try {
    const timestamp = Date.prototype.getTime.call(value);
    if (Number.isFinite(timestamp)) {
      frontmatter.date = new Date(timestamp);
      return;
    }
  } catch {
    /* expected: non-Date values are removed below */
  }

  delete frontmatter.date;
}

function normalizeFrontmatterTags(frontmatter: Frontmatter): void {
  const value = frontmatter.tags;
  if (value === undefined || typeof value === "string") return;

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
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) return null;

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1) return null;

    const snapshot: string[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor || !descriptor.enumerable || !("value" in descriptor) ||
        typeof descriptor.value !== "string"
      ) {
        return null;
      }
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
  if (ext === "mdx" || ext === "md") return "mdx";
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

/**
 * Classifies a source filename as a page, layout, or component.
 *
 * Uppercase filenames represent components. Filenames ending in `layout` and
 * records with `isLayout: true` represent layouts. All other names represent pages.
 */
export function detectEntityType(
  fileName: string,
  frontmatter: Frontmatter = {},
): EntityTypeInfo {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const lowerBase = baseName.toLowerCase();

  const ext = fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  const kind = detectFileKind(ext);

  let hasLayoutFlag = false;
  if (isFrontmatterRecord(frontmatter)) {
    try {
      const descriptor = Reflect.getOwnPropertyDescriptor(frontmatter, "isLayout");
      hasLayoutFlag = !!descriptor && "value" in descriptor && descriptor.value === true;
    } catch {
      /* expected: an unreadable optional hint must not affect file classification */
    }
  }
  const isLayout = lowerBase.endsWith("layout") || hasLayoutFlag;

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
