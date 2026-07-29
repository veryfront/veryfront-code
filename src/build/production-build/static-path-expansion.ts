import type { StaticPathsResult } from "#veryfront/data";
import { BUILD_FAILED } from "#veryfront/errors";
import type { RouteInfo } from "#veryfront/server/build-types.ts";
import {
  compileRoutePattern,
  containsPathControlCharacters,
  type ParsedRouteParameter,
  parseRouteParameterSegment,
} from "#veryfront/utils/route-path-utils.ts";
import {
  MAX_BUILD_STATIC_CATCH_ALL_SEGMENTS,
  MAX_BUILD_STATIC_PATH_CHARACTERS,
  MAX_BUILD_STATIC_PATH_UTF8_BYTES,
  MAX_BUILD_STATIC_PATHS,
} from "../../data/static-path-limits.ts";

const textEncoder = new TextEncoder();

export interface StaticPathsResolver {
  getStaticPaths(slug: string): Promise<StaticPathsResult | null>;
}

type TemplateSegment =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "parameter"; readonly parameter: ParsedRouteParameter };

interface StaticPathTemplate {
  readonly path: string;
  readonly segments: readonly TemplateSegment[];
  readonly parameterNames: ReadonlySet<string>;
}

function buildError(detail: string, cause?: unknown): Error {
  return BUILD_FAILED.create({ detail, cause });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portableCollisionKey(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Literal static routes may contain a percent sign. Their raw path still
    // participates in portable collision checks; generated paths are always
    // canonical encodeURIComponent output and cannot reach this branch.
  }
  return decoded.replaceAll("\\", "/").normalize("NFC").toLocaleLowerCase("en-US");
}

class StaticPathBudget {
  private count = 0;
  private utf8Bytes = 0;
  private readonly pathsByCollisionKey = new Map<string, string>();

  register(path: string): void {
    this.count++;
    if (this.count > MAX_BUILD_STATIC_PATHS) {
      throw new RangeError(
        `Static production builds support at most ${
          MAX_BUILD_STATIC_PATHS.toLocaleString("en-US")
        } paths`,
      );
    }
    if (path.length > MAX_BUILD_STATIC_PATH_CHARACTERS) {
      throw new RangeError(
        `Static route paths must not exceed ${
          MAX_BUILD_STATIC_PATH_CHARACTERS.toLocaleString("en-US")
        } characters`,
      );
    }

    this.utf8Bytes += textEncoder.encode(path).byteLength;
    if (this.utf8Bytes > MAX_BUILD_STATIC_PATH_UTF8_BYTES) {
      throw new RangeError(
        `Static route paths exceed the ${
          MAX_BUILD_STATIC_PATH_UTF8_BYTES.toLocaleString("en-US")
        }-byte aggregate UTF-8 budget`,
      );
    }

    const key = portableCollisionKey(path);
    const existing = this.pathsByCollisionKey.get(key);
    if (existing !== undefined) {
      throw buildError(
        `Static route collision between ${JSON.stringify(existing)} and ${JSON.stringify(path)}`,
      );
    }
    this.pathsByCollisionKey.set(key, path);
  }
}

function compileStaticPathTemplate(path: string): StaticPathTemplate {
  const compiled = compileRoutePattern(path);
  if (!compiled.valid || compiled.parameters.length === 0 || !path.startsWith("/")) {
    throw buildError(`Invalid dynamic Pages route template ${JSON.stringify(path)}`);
  }

  const parameterNames = new Set<string>();
  const segments = path.split("/").slice(1).map((segment): TemplateSegment => {
    const parameter = parseRouteParameterSegment(segment);
    if (!parameter) return { kind: "literal", value: segment };
    if (parameterNames.has(parameter.name)) {
      throw buildError(
        `Dynamic Pages route template ${JSON.stringify(path)} repeats parameter ${
          JSON.stringify(parameter.name)
        }`,
      );
    }
    parameterNames.add(parameter.name);
    return { kind: "parameter", parameter };
  });

  return { path, segments, parameterNames };
}

function requireParamRecord(
  value: unknown,
  template: StaticPathTemplate,
): Record<string, string | string[]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw buildError(
      `getStaticPaths entry for ${JSON.stringify(template.path)} must provide a params object`,
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw buildError(
      `getStaticPaths params for ${JSON.stringify(template.path)} must be a plain object`,
    );
  }

  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== template.parameterNames.size ||
    keys.some((key) => typeof key !== "string" || !template.parameterNames.has(key))
  ) {
    throw buildError(
      `getStaticPaths params for ${
        JSON.stringify(template.path)
      } must exactly match its route parameters`,
    );
  }
  for (const key of keys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw buildError(
        `getStaticPaths params for ${
          JSON.stringify(template.path)
        } must use enumerable data properties`,
      );
    }
  }
  return value as Record<string, string | string[]>;
}

function encodeParamSegment(
  value: unknown,
  parameterName: string,
  templatePath: string,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    containsPathControlCharacters(value)
  ) {
    throw buildError(
      `getStaticPaths parameter ${JSON.stringify(parameterName)} for ${
        JSON.stringify(templatePath)
      } is invalid`,
    );
  }

  let encoded: string;
  try {
    encoded = encodeURIComponent(value);
  } catch (cause) {
    throw buildError(
      `getStaticPaths parameter ${JSON.stringify(parameterName)} for ${
        JSON.stringify(templatePath)
      } cannot be encoded losslessly`,
      cause,
    );
  }
  if (decodeURIComponent(encoded) !== value) {
    throw buildError(
      `getStaticPaths parameter ${JSON.stringify(parameterName)} for ${
        JSON.stringify(templatePath)
      } cannot be encoded losslessly`,
    );
  }
  return encoded;
}

function snapshotParamArray(
  value: unknown,
  parameter: ParsedRouteParameter,
  templatePath: string,
): string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw buildError(
      `getStaticPaths catch-all parameter ${JSON.stringify(parameter.name)} for ${
        JSON.stringify(templatePath)
      } must be a plain array`,
    );
  }
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    throw buildError(
      `getStaticPaths catch-all parameter ${JSON.stringify(parameter.name)} for ${
        JSON.stringify(templatePath)
      } has an invalid length`,
    );
  }
  if (length > MAX_BUILD_STATIC_CATCH_ALL_SEGMENTS) {
    throw new RangeError(
      `getStaticPaths catch-all parameters support at most ${
        MAX_BUILD_STATIC_CATCH_ALL_SEGMENTS.toLocaleString("en-US")
      } segments`,
    );
  }
  if (parameter.kind === "catch-all" && length === 0) {
    throw buildError(
      `getStaticPaths catch-all parameter ${JSON.stringify(parameter.name)} for ${
        JSON.stringify(templatePath)
      } must not be empty`,
    );
  }

  const snapshot = new Array<string>(length);
  let count = 0;
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string") {
      throw buildError(`getStaticPaths catch-all arrays must not contain named properties`);
    }
    const index = Number(key);
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= length ||
      String(index) !== key ||
      !descriptor?.enumerable ||
      !("value" in descriptor)
    ) {
      throw buildError(`getStaticPaths catch-all arrays must contain dense data properties`);
    }
    snapshot[index] = descriptor.value as string;
    count++;
  }
  if (count !== length) {
    throw buildError(`getStaticPaths catch-all arrays must not contain holes`);
  }
  return snapshot;
}

function materializePath(
  template: StaticPathTemplate,
  rawParams: unknown,
): { path: string; params: Record<string, string | string[]> } {
  const params = requireParamRecord(rawParams, template);
  const concreteSegments: string[] = [];
  const snapshot: Record<string, string | string[]> = {};

  for (const segment of template.segments) {
    if (segment.kind === "literal") {
      concreteSegments.push(segment.value);
      continue;
    }

    const { parameter } = segment;
    const descriptor = Reflect.getOwnPropertyDescriptor(params, parameter.name)!;
    const rawValue = (descriptor as PropertyDescriptor & { value: unknown }).value;
    if (parameter.kind === "dynamic") {
      const encoded = encodeParamSegment(rawValue, parameter.name, template.path);
      concreteSegments.push(`${encoded}${parameter.suffix}`);
      Object.defineProperty(snapshot, parameter.name, {
        configurable: true,
        enumerable: true,
        value: rawValue,
        writable: true,
      });
      continue;
    }

    const values = snapshotParamArray(rawValue, parameter, template.path);
    const encoded = values.map((value) => encodeParamSegment(value, parameter.name, template.path));
    if (encoded.length > 0 && parameter.suffix) {
      encoded[encoded.length - 1] += parameter.suffix;
    }
    concreteSegments.push(...encoded);
    Object.defineProperty(snapshot, parameter.name, {
      configurable: true,
      enumerable: true,
      value: values,
      writable: true,
    });
  }

  return {
    path: `/${concreteSegments.join("/")}`,
    params: snapshot,
  };
}

/** Expand Pages Router templates before any output is planned or written. */
export async function expandPagesStaticPaths(
  routes: readonly RouteInfo[],
  resolver: StaticPathsResolver,
): Promise<RouteInfo[]> {
  const expanded: RouteInfo[] = [];
  const budget = new StaticPathBudget();

  for (const route of routes) {
    if (!route.templatePath) {
      budget.register(route.path);
      expanded.push(route);
      continue;
    }
    const template = compileStaticPathTemplate(route.templatePath);
    const result = await resolver.getStaticPaths(route.slug);
    if (result === null) {
      throw buildError(
        `Dynamic Pages route ${JSON.stringify(route.templatePath)} must export getStaticPaths`,
      );
    }
    if (result.fallback !== false) {
      throw buildError(
        `Dynamic Pages route ${JSON.stringify(route.templatePath)} requires fallback: false; ` +
          `${JSON.stringify(result.fallback)} is not supported by static production builds`,
      );
    }

    for (const entry of result.paths) {
      const materialized = materializePath(template, entry.params);
      budget.register(materialized.path);
      expanded.push({
        ...route,
        path: materialized.path,
        slug: materialized.path === "/" ? "index" : materialized.path.slice(1),
        templatePath: route.templatePath,
        params: materialized.params,
      });
    }
  }

  return expanded.sort((left, right) => compareText(left.path, right.path));
}
