import { INVALID_ARGUMENT } from "#veryfront/errors";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const MAX_RESOURCE_ID_LENGTH = 512;
const MAX_RESOURCE_PATTERN_LENGTH = 2_048;
const MAX_RESOURCE_URI_LENGTH = 8_192;
const MAX_RESOURCE_PATTERN_SEGMENTS = 128;
const MAX_RESOURCE_PARAMETERS = 32;
const RESOURCE_PARAMETER_PATTERN = /:([A-Za-z_][A-Za-z0-9_]*)/g;
const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const UNSAFE_RAW_URI_CHARACTER_PATTERN = /["<>\\^`{|}]/u;

/** Internal marker copied by discovery until it replaces a generated pattern. */
export const GENERATED_RESOURCE_PATTERN = Symbol("veryfront.generatedResourcePattern");

/** Compiled representation of one validated resource URI pattern. */
export interface CompiledResourcePattern {
  readonly pattern: string;
  readonly expression: RegExp;
  readonly parameterNames: readonly string[];
  readonly literalLength: number;
  readonly structuralKey: string;
  readonly parts: readonly ResourcePatternPart[];
  readonly uriTemplate?: string;
}

type ResourcePatternPart =
  | Readonly<{ kind: "literal"; value: string }>
  | Readonly<{ kind: "parameter"; name: string }>;

function invalidResourceInput(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function hasUnsafeCharacters(value: string, rejectWhitespace: boolean): boolean {
  if (hasUnsafeControlCharacters(value) || value.includes("\u061c")) return true;
  for (let index = 0; index < value.length; index++) {
    if (rejectWhitespace && /\s/.test(value.charAt(index))) return true;
  }
  return false;
}

function assertEncodedUri(value: string, label: string): void {
  if (UNSAFE_RAW_URI_CHARACTER_PATTERN.test(value)) {
    invalidResourceInput(`${label} must not contain unsafe raw URI characters`);
  }
  try {
    decodeURI(value);
  } catch {
    invalidResourceInput(`${label} must use valid URI encoding`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parameterSearchStart(value: string): number {
  const scheme = URI_SCHEME_PATTERN.exec(value);
  const schemeEnd = scheme?.[0].length;
  const authorityStart = schemeEnd !== undefined && value.startsWith("//", schemeEnd)
    ? schemeEnd + 2
    : schemeEnd === undefined && value.startsWith("//")
    ? 2
    : undefined;
  if (authorityStart !== undefined) {
    const pathStart = value.indexOf("/", authorityStart);
    return pathStart === -1 ? value.length : pathStart;
  }
  if (schemeEnd === undefined) return 0;
  const pathStart = value.indexOf("/", schemeEnd);
  return pathStart === -1 ? value.length : pathStart;
}

function patternAtoms(compiled: CompiledResourcePattern): Array<string | null> {
  const atoms: Array<string | null> = [];
  for (const part of compiled.parts) {
    if (part.kind === "parameter") {
      atoms.push(null);
    } else {
      atoms.push(...part.value.split(""));
    }
  }
  return atoms;
}

interface PatternIntersectionState {
  readonly leftIndex: number;
  readonly leftConsumed: boolean;
  readonly rightIndex: number;
  readonly rightConsumed: boolean;
}

function intersectionStateKey(state: PatternIntersectionState): string {
  return [
    state.leftIndex,
    Number(state.leftConsumed),
    state.rightIndex,
    Number(state.rightConsumed),
  ].join(":");
}

/** Return whether two compiled patterns can match at least one identical URI. */
export function resourcePatternsOverlap(
  left: CompiledResourcePattern,
  right: CompiledResourcePattern,
): boolean {
  const leftAtoms = patternAtoms(left);
  const rightAtoms = patternAtoms(right);
  const pending: PatternIntersectionState[] = [{
    leftIndex: 0,
    leftConsumed: false,
    rightIndex: 0,
    rightConsumed: false,
  }];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const state = pending.pop() as PatternIntersectionState;
    const key = intersectionStateKey(state);
    if (visited.has(key)) continue;
    visited.add(key);

    if (state.leftIndex === leftAtoms.length && state.rightIndex === rightAtoms.length) {
      return true;
    }

    const leftAtom = leftAtoms[state.leftIndex];
    const rightAtom = rightAtoms[state.rightIndex];
    if (leftAtom === null && state.leftConsumed) {
      pending.push({ ...state, leftIndex: state.leftIndex + 1, leftConsumed: false });
    }
    if (rightAtom === null && state.rightConsumed) {
      pending.push({ ...state, rightIndex: state.rightIndex + 1, rightConsumed: false });
    }

    if (leftAtom === undefined || rightAtom === undefined) continue;
    if (leftAtom !== null && rightAtom !== null) {
      if (leftAtom === rightAtom) {
        pending.push({
          leftIndex: state.leftIndex + 1,
          leftConsumed: false,
          rightIndex: state.rightIndex + 1,
          rightConsumed: false,
        });
      }
      continue;
    }
    if (leftAtom === null && rightAtom === null) {
      pending.push({ ...state, leftConsumed: true, rightConsumed: true });
      continue;
    }
    if (leftAtom === null) {
      if (rightAtom !== "/") {
        pending.push({
          ...state,
          leftConsumed: true,
          rightIndex: state.rightIndex + 1,
          rightConsumed: false,
        });
      }
      continue;
    }
    if (leftAtom !== "/") {
      pending.push({
        ...state,
        leftIndex: state.leftIndex + 1,
        leftConsumed: false,
        rightConsumed: true,
      });
    }
  }
  return false;
}

/** Validate a stable resource identifier. */
export function assertResourceId(value: unknown): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_RESOURCE_ID_LENGTH ||
    hasUnsafeCharacters(value, true)
  ) {
    invalidResourceInput(
      "Resource id must be a non-empty bounded string without whitespace or control characters",
    );
  }
  return value;
}

/** Validate an incoming resource URI before matching it. */
export function assertResourceUri(value: unknown): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_RESOURCE_URI_LENGTH ||
    hasUnsafeCharacters(value, true)
  ) {
    invalidResourceInput(
      "Resource URI must be a non-empty bounded string without whitespace or control characters",
    );
  }
  assertEncodedUri(value, "Resource URI");
  return value;
}

/** Return whether a generated discovery placeholder is still unresolved. */
export function hasUnresolvedGeneratedResourcePattern(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  try {
    const generatedPattern = Reflect.get(value, GENERATED_RESOURCE_PATTERN);
    return typeof generatedPattern === "string" &&
      generatedPattern === Reflect.get(value, "pattern");
  } catch {
    invalidResourceInput("Resource definition properties must be readable");
  }
}

/** Compile a resource pattern with `:name` dynamic placeholders. */
export function compileResourcePattern(value: unknown): CompiledResourcePattern {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_RESOURCE_PATTERN_LENGTH || hasUnsafeCharacters(value, true)
  ) {
    invalidResourceInput(
      "Resource pattern must be a non-empty bounded string without whitespace or control characters",
    );
  }
  assertEncodedUri(value, "Resource pattern");

  const segments = value.split("/");
  if (segments.length > MAX_RESOURCE_PATTERN_SEGMENTS) {
    invalidResourceInput("Resource pattern has too many segments");
  }

  const parameterNames: string[] = [];
  const seenParameterNames = new Set<string>();
  const parameterSegmentStarts = new Set<number>();
  let literalLength = 0;
  let expression = "";
  const structuralParts: Array<readonly ["literal", string] | readonly ["parameter"]> = [];
  const parts: ResourcePatternPart[] = [];
  let uriTemplate = "";
  let cursor = 0;
  const searchStart = parameterSearchStart(value);

  for (const match of value.matchAll(RESOURCE_PARAMETER_PATTERN)) {
    const matchIndex = match.index;
    const parameterName = match[1];
    if (matchIndex === undefined || parameterName === undefined) {
      invalidResourceInput("Resource pattern parameters are invalid");
    }
    if (matchIndex < searchStart) continue;
    const literal = value.slice(cursor, matchIndex);
    if (parameterNames.length > 0 && literal.length === 0) {
      invalidResourceInput("Adjacent resource pattern parameters are ambiguous");
    }
    const segmentStart = value.lastIndexOf("/", matchIndex);
    if (parameterSegmentStarts.has(segmentStart)) {
      invalidResourceInput("Resource pattern segments must contain at most one parameter");
    }
    if (seenParameterNames.has(parameterName)) {
      invalidResourceInput("Resource pattern parameter names must be unique");
    }
    if (parameterNames.length >= MAX_RESOURCE_PARAMETERS) {
      invalidResourceInput("Resource pattern has too many parameters");
    }
    parameterSegmentStarts.add(segmentStart);
    seenParameterNames.add(parameterName);
    parameterNames.push(parameterName);
    literalLength += literal.length;
    expression += `${escapeRegExp(literal)}([^/]+)`;
    structuralParts.push(["literal", literal], ["parameter"]);
    parts.push(
      Object.freeze({ kind: "literal", value: literal }),
      Object.freeze({ kind: "parameter", name: parameterName }),
    );
    uriTemplate += `${literal}{${parameterName}}`;
    cursor = matchIndex + match[0].length;
  }
  const trailingLiteral = value.slice(cursor);
  literalLength += trailingLiteral.length;
  expression += escapeRegExp(trailingLiteral);
  structuralParts.push(["literal", trailingLiteral]);
  parts.push(Object.freeze({ kind: "literal", value: trailingLiteral }));
  uriTemplate += trailingLiteral;

  return Object.freeze({
    pattern: value,
    expression: new RegExp(`^${expression}$`),
    parameterNames: Object.freeze(parameterNames),
    literalLength,
    structuralKey: JSON.stringify(structuralParts),
    parts: Object.freeze(parts),
    ...(parameterNames.length === 0 ? {} : { uriTemplate }),
  });
}

/** Return the ordered raw parameter captures for a URI, or null when it does not match. */
export function matchResourcePattern(
  uri: string,
  compiled: CompiledResourcePattern,
): readonly string[] | null {
  const match = compiled.expression.exec(uri);
  return match ? match.slice(1) : null;
}

/** Decode matched parameter segments into a prototype-safe record. */
export function decodeResourceParams(
  captures: readonly string[],
  compiled: CompiledResourcePattern,
): Record<string, string> {
  const params = Object.create(null) as Record<string, string>;
  for (let index = 0; index < compiled.parameterNames.length; index++) {
    const parameterName = compiled.parameterNames[index];
    const capture = captures[index];
    if (parameterName === undefined || capture === undefined) {
      invalidResourceInput("Resource URI parameters do not match the compiled pattern");
    }
    try {
      params[parameterName] = decodeURIComponent(capture);
    } catch {
      invalidResourceInput("Resource URI parameter must use valid URI encoding");
    }
  }
  return params;
}
