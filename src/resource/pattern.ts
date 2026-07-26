/**
 * Resource pattern parsing and matching.
 *
 * Patterns use `:name` parameters and otherwise match literally. Keeping the
 * parser in one place prevents registration, lookup, parameter extraction,
 * and MCP template rendering from drifting into subtly different grammars.
 */

import { ResourceUriSyntaxError, ResourceUriValidationError } from "./errors.ts";
import { containsControlCharacter } from "./string-validation.ts";

const PARAMETER_PATTERN = /:([A-Za-z_][A-Za-z0-9_]*)/g;
const INVALID_PATTERN_WHITESPACE = /\s/;
const RAW_URI_TEMPLATE_BRACE = /[{}]/;
export const MAX_RESOURCE_URI_LENGTH = 8 * 1024;
const MAX_RESOURCE_PATTERN_LENGTH = MAX_RESOURCE_URI_LENGTH;

export type ResourcePatternSegment =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "parameter"; readonly name: string };

export interface CompiledResourcePattern {
  readonly expression: RegExp;
  readonly parameterNames: readonly string[];
  readonly segments: readonly ResourcePatternSegment[];
  readonly signature: string;
  readonly template: string;
  readonly isTemplate: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function invalidPattern(pattern: unknown, detail: string): Error {
  return new Error(`Invalid resource pattern "${String(pattern)}": ${detail}`);
}

/** Reject malformed or unbounded URI input before registry matching. */
export function assertResourceUri(uri: string): void {
  if (typeof uri !== "string" || uri.length === 0) {
    throw new ResourceUriSyntaxError("must be a non-empty string");
  }
  if (uri.length > MAX_RESOURCE_URI_LENGTH) {
    throw new ResourceUriSyntaxError(
      `must not exceed ${MAX_RESOURCE_URI_LENGTH} characters`,
    );
  }
  if (containsControlCharacter(uri)) {
    throw new ResourceUriSyntaxError("contains control characters");
  }
  if (INVALID_PATTERN_WHITESPACE.test(uri)) {
    throw new ResourceUriSyntaxError("contains raw whitespace");
  }
}

/** Compile and validate a resource pattern. */
export function compileResourcePattern(pattern: string): CompiledResourcePattern {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw invalidPattern(pattern, "pattern must be a non-empty string");
  }
  if (pattern.length > MAX_RESOURCE_PATTERN_LENGTH) {
    throw invalidPattern(
      pattern,
      `pattern must not exceed ${MAX_RESOURCE_PATTERN_LENGTH} characters`,
    );
  }
  if (INVALID_PATTERN_WHITESPACE.test(pattern)) {
    throw invalidPattern(pattern, "raw whitespace is not allowed");
  }
  if (containsControlCharacter(pattern)) {
    throw invalidPattern(pattern, "control characters are not allowed");
  }
  if (RAW_URI_TEMPLATE_BRACE.test(pattern)) {
    throw invalidPattern(pattern, "raw URI-template braces are not allowed");
  }

  const parameterNames: string[] = [];
  const seenParameterNames = new Set<string>();
  const segments: ResourcePatternSegment[] = [];
  const expressionParts: string[] = [];
  const signatureParts: string[] = [];
  const templateParts: string[] = [];
  let lastIndex = 0;

  for (const segment of pattern.split("/")) {
    const parameter = /^:([A-Za-z_][A-Za-z0-9_]*)$/.exec(segment);
    if (parameter) {
      segments.push({ kind: "parameter", name: parameter[1]! });
      continue;
    }
    if (segment.startsWith(":")) {
      throw invalidPattern(pattern, `invalid parameter segment "${segment}"`);
    }
    PARAMETER_PATTERN.lastIndex = 0;
    if (PARAMETER_PATTERN.test(segment)) {
      throw invalidPattern(
        pattern,
        `parameter must occupy an entire path segment: "${segment}"`,
      );
    }
    segments.push({ kind: "literal", value: segment });
  }

  PARAMETER_PATTERN.lastIndex = 0;
  for (
    let match = PARAMETER_PATTERN.exec(pattern);
    match;
    match = PARAMETER_PATTERN.exec(pattern)
  ) {
    const name = match[1]!;
    if (seenParameterNames.has(name)) {
      throw invalidPattern(pattern, `duplicate parameter "${name}"`);
    }
    seenParameterNames.add(name);
    parameterNames.push(name);

    const literal = pattern.slice(lastIndex, match.index);
    // Query and fragment delimiters are part of the complete URI identity,
    // not part of a path-segment parameter. Callers that need those characters
    // inside a parameter must percent-encode them.
    expressionParts.push(escapeRegExp(literal), "([^/?#]+)");
    signatureParts.push(literal, ":");
    templateParts.push(literal, `{${name}}`);
    lastIndex = match.index + match[0].length;
  }

  const trailingLiteral = pattern.slice(lastIndex);
  expressionParts.push(escapeRegExp(trailingLiteral));
  signatureParts.push(trailingLiteral);
  templateParts.push(trailingLiteral);

  return {
    expression: new RegExp(`^${expressionParts.join("")}$`),
    parameterNames,
    segments,
    signature: signatureParts.join(""),
    template: templateParts.join(""),
    isTemplate: parameterNames.length > 0,
  };
}

/**
 * Whether two dynamic patterns can match at least one identical URI.
 *
 * Exact resources are intentionally excluded because lookup gives them
 * deterministic precedence over templates. Two templates are ambiguous when
 * they have the same segment count and no pair of literal segments conflicts.
 */
export function resourceTemplatePatternsOverlap(
  left: CompiledResourcePattern,
  right: CompiledResourcePattern,
): boolean {
  if (!left.isTemplate || !right.isTemplate) return false;
  if (left.segments.length !== right.segments.length) return false;

  return left.segments.every((leftSegment, index) => {
    const rightSegment = right.segments[index]!;
    return leftSegment.kind === "parameter" ||
      rightSegment.kind === "parameter" ||
      leftSegment.value === rightSegment.value;
  });
}

/** Match a URI and return decoded, own-property-only parameter values. */
export function extractResourcePatternParams(
  uri: string,
  compiled: CompiledResourcePattern,
): Record<string, string> {
  assertResourceUri(uri);
  const match = compiled.expression.exec(uri);
  if (!match) return {};

  const params: Record<string, string> = {};
  for (let index = 0; index < compiled.parameterNames.length; index++) {
    const name = compiled.parameterNames[index]!;
    const encodedValue = match[index + 1]!;
    let decodedValue: string;
    try {
      decodedValue = decodeURIComponent(encodedValue);
    } catch (error) {
      throw new ResourceUriValidationError(name, error);
    }
    Object.defineProperty(params, name, {
      configurable: true,
      enumerable: true,
      value: decodedValue,
      writable: true,
    });
  }
  return params;
}
