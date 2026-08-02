import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { hasControlCharacters } from "./string-validation.ts";

const MAX_GLOB_NESTING = 16;
const MAX_GLOB_NODES = 512;
const MAX_GLOB_ALTERNATIVES = 256;
const MAX_GLOB_MATCH_OPERATIONS = 250_000;

interface GlobSequence {
  nodes: GlobNode[];
}

type GlobNode =
  | { kind: "literal"; value: string }
  | { kind: "any-character" }
  | { kind: "any-characters" }
  | { kind: "character-class"; negated: boolean; atoms: CharacterClassAtom[] }
  | { kind: "alternatives"; alternatives: GlobSequence[] }
  | {
    kind: "repeat";
    alternatives: GlobSequence[];
    minimum: 0 | 1;
    maximum: 1 | "unbounded";
  }
  | { kind: "negative"; alternatives: GlobSequence[] };

type CharacterClassAtom =
  | { kind: "character"; value: string }
  | { kind: "range"; start: number; end: number }
  | { kind: "posix"; name: PosixCharacterClass };

type PosixCharacterClass =
  | "alnum"
  | "alpha"
  | "ascii"
  | "blank"
  | "cntrl"
  | "digit"
  | "graph"
  | "lower"
  | "print"
  | "punct"
  | "space"
  | "upper"
  | "word"
  | "xdigit";

interface CompiledSegment {
  readonly literalValue?: string;
  matches(value: string, budget: MatchBudget): boolean;
}

interface MatchBudget {
  consume(count?: number): void;
}

type CompiledPathSegment = "globstar" | CompiledSegment;

export interface PathGlobMatcher {
  /** The portable, slash-separated pattern supplied at compilation time. */
  readonly pattern: string;
  /** Leading path segments that contain no glob syntax after parsing escapes. */
  readonly staticPrefixSegments: readonly string[];
  /** Number of path segments in the complete normalized pattern. */
  readonly segmentCount: number;
  /** Return whether the complete candidate path matches the complete pattern. */
  test(path: string): boolean;
}

function requireSafeGlobText(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    hasControlCharacters(value)
  ) {
    throw new TypeError(
      `${label} must be a safe non-empty string of at most ${MAX_PATH_LENGTH_CHARS} characters`,
    );
  }
}

function invalidPattern(pattern: string, detail: string): TypeError {
  return new TypeError(`Invalid path glob ${JSON.stringify(pattern)}: ${detail}`);
}

function createMatchBudget(pattern: string): MatchBudget {
  let operations = 0;
  return {
    consume(count = 1): void {
      operations += count;
      if (operations > MAX_GLOB_MATCH_OPERATIONS) {
        throw new TypeError(
          `Path glob ${JSON.stringify(pattern)} exceeds the bounded matching complexity`,
        );
      }
    },
  };
}

class SegmentParser {
  private index = 0;
  private nodeCount = 0;
  private alternativeCount = 0;

  constructor(
    private readonly segment: string,
    private readonly fullPattern: string,
  ) {}

  parse(): GlobSequence {
    const sequence = this.parseSequence(new Set(), 0);
    if (this.index !== this.segment.length) {
      throw invalidPattern(this.fullPattern, "contains an unmatched group delimiter");
    }
    return sequence;
  }

  private addNode<T extends GlobNode>(node: T): T {
    this.nodeCount++;
    if (this.nodeCount > MAX_GLOB_NODES) {
      throw invalidPattern(
        this.fullPattern,
        `contains more than ${MAX_GLOB_NODES} matcher nodes`,
      );
    }
    return node;
  }

  private parseSequence(stops: ReadonlySet<string>, depth: number): GlobSequence {
    const nodes: GlobNode[] = [];
    let literal = "";
    const flushLiteral = (): void => {
      if (literal.length === 0) return;
      nodes.push(this.addNode({ kind: "literal", value: literal }));
      literal = "";
    };

    while (this.index < this.segment.length) {
      const character = this.segment[this.index]!;
      if (stops.has(character)) break;

      if (character === "\\") {
        if (this.index + 1 >= this.segment.length) {
          throw invalidPattern(this.fullPattern, "ends with an incomplete escape");
        }
        literal += this.segment[this.index + 1]!;
        this.index += 2;
        continue;
      }

      if (character === "[") {
        flushLiteral();
        nodes.push(this.parseCharacterClass());
        continue;
      }

      if (character === "{") {
        flushLiteral();
        this.index++;
        nodes.push(this.addNode({
          kind: "alternatives",
          alternatives: this.parseAlternatives("}", ",", depth + 1),
        }));
        continue;
      }

      const next = this.segment[this.index + 1];
      if (
        next === "(" &&
        (character === "?" || character === "*" || character === "+" ||
          character === "@" || character === "!")
      ) {
        flushLiteral();
        this.index += 2;
        const alternatives = this.parseAlternatives(")", "|", depth + 1);
        if (character === "@") {
          nodes.push(this.addNode({ kind: "alternatives", alternatives }));
        } else if (character === "!") {
          nodes.push(this.addNode({ kind: "negative", alternatives }));
        } else {
          nodes.push(this.addNode({
            kind: "repeat",
            alternatives,
            minimum: character === "+" ? 1 : 0,
            maximum: character === "?" ? 1 : "unbounded",
          }));
        }
        continue;
      }

      if (character === "*") {
        flushLiteral();
        while (this.segment[this.index + 1] === "*") this.index++;
        this.index++;
        nodes.push(this.addNode({ kind: "any-characters" }));
        continue;
      }

      if (character === "?") {
        flushLiteral();
        this.index++;
        nodes.push(this.addNode({ kind: "any-character" }));
        continue;
      }

      // Parentheses are ordinary path characters unless they close an
      // extended group. This matters for framework route-group directories
      // such as `app/(marketing)`. A closing brace remains invalid because an
      // opening brace always starts a brace-alternative group in this grammar.
      if (character === "}") {
        throw invalidPattern(
          this.fullPattern,
          `contains an unmatched ${JSON.stringify(character)}`,
        );
      }

      literal += character;
      this.index++;
    }

    flushLiteral();
    return { nodes };
  }

  private parseAlternatives(
    closingCharacter: ")" | "}",
    separator: "|" | ",",
    depth: number,
  ): GlobSequence[] {
    if (depth > MAX_GLOB_NESTING) {
      throw invalidPattern(
        this.fullPattern,
        `nests groups more than ${MAX_GLOB_NESTING} levels`,
      );
    }

    const alternatives: GlobSequence[] = [];
    const stops = new Set([separator, closingCharacter]);
    while (true) {
      alternatives.push(this.parseSequence(stops, depth));
      this.alternativeCount++;
      if (this.alternativeCount > MAX_GLOB_ALTERNATIVES) {
        throw invalidPattern(
          this.fullPattern,
          `contains more than ${MAX_GLOB_ALTERNATIVES} alternatives`,
        );
      }

      const character = this.segment[this.index];
      if (character === closingCharacter) {
        this.index++;
        return alternatives;
      }
      if (character !== separator) {
        throw invalidPattern(
          this.fullPattern,
          `contains an unclosed ${closingCharacter === ")" ? "extended group" : "brace group"}`,
        );
      }
      this.index++;
    }
  }

  private parseCharacterClass(): GlobNode {
    this.index++;
    let negated = false;
    if (this.segment[this.index] === "!") {
      negated = true;
      this.index++;
    }

    const atoms: CharacterClassAtom[] = [];
    while (this.index < this.segment.length && this.segment[this.index] !== "]") {
      const atom = this.parseCharacterClassAtom();
      if (
        atom.kind === "character" &&
        this.segment[this.index] === "-" &&
        this.segment[this.index + 1] !== "]" &&
        this.segment[this.index + 1] !== undefined
      ) {
        this.index++;
        const end = this.parseCharacterClassAtom();
        if (end.kind !== "character") {
          throw invalidPattern(this.fullPattern, "uses a character class as a range endpoint");
        }
        const startCode = atom.value.charCodeAt(0);
        const endCode = end.value.charCodeAt(0);
        if (startCode > endCode) {
          throw invalidPattern(this.fullPattern, "contains a descending character range");
        }
        atoms.push({ kind: "range", start: startCode, end: endCode });
      } else {
        atoms.push(atom);
      }
    }

    if (this.segment[this.index] !== "]") {
      throw invalidPattern(this.fullPattern, "contains an unclosed character class");
    }
    this.index++;
    if (atoms.length === 0) {
      throw invalidPattern(this.fullPattern, "contains an empty character class");
    }
    return this.addNode({ kind: "character-class", negated, atoms });
  }

  private parseCharacterClassAtom(): CharacterClassAtom {
    if (
      this.segment[this.index] === "[" &&
      this.segment[this.index + 1] === ":"
    ) {
      const close = this.segment.indexOf(":]", this.index + 2);
      if (close === -1) {
        throw invalidPattern(this.fullPattern, "contains an unclosed POSIX character class");
      }
      const name = this.segment.slice(this.index + 2, close);
      if (!isPosixCharacterClass(name)) {
        throw invalidPattern(
          this.fullPattern,
          `contains unsupported POSIX character class ${JSON.stringify(name)}`,
        );
      }
      this.index = close + 2;
      return { kind: "posix", name };
    }

    let value = this.segment[this.index];
    if (value === "\\") {
      value = this.segment[this.index + 1];
      if (value === undefined) {
        throw invalidPattern(this.fullPattern, "ends with an incomplete character-class escape");
      }
      this.index += 2;
    } else {
      this.index++;
    }
    return { kind: "character", value: value! };
  }
}

function isPosixCharacterClass(value: string): value is PosixCharacterClass {
  return value === "alnum" || value === "alpha" || value === "ascii" ||
    value === "blank" || value === "cntrl" || value === "digit" ||
    value === "graph" || value === "lower" || value === "print" ||
    value === "punct" || value === "space" || value === "upper" ||
    value === "word" || value === "xdigit";
}

function matchesPosixClass(character: string, name: PosixCharacterClass): boolean {
  const code = character.charCodeAt(0);
  switch (name) {
    case "alnum":
      return code >= 0x30 && code <= 0x39 || code >= 0x41 && code <= 0x5a ||
        code >= 0x61 && code <= 0x7a;
    case "alpha":
      return code >= 0x41 && code <= 0x5a || code >= 0x61 && code <= 0x7a;
    case "ascii":
      return code <= 0x7f;
    case "blank":
      return character === " " || character === "\t";
    case "cntrl":
      return code <= 0x1f || code === 0x7f;
    case "digit":
      return code >= 0x30 && code <= 0x39;
    case "graph":
      return code >= 0x21 && code <= 0x7e;
    case "lower":
      return code >= 0x61 && code <= 0x7a;
    case "print":
      return code >= 0x20 && code <= 0x7e;
    case "punct":
      return code >= 0x21 && code <= 0x2f || code >= 0x3a && code <= 0x40 ||
        code >= 0x5b && code <= 0x60 || code >= 0x7b && code <= 0x7e;
    case "space":
      return character === " " || character === "\t" || character === "\n" ||
        character === "\r" || character === "\v" || character === "\f";
    case "upper":
      return code >= 0x41 && code <= 0x5a;
    case "word":
      return code >= 0x30 && code <= 0x39 || code >= 0x41 && code <= 0x5a ||
        code >= 0x61 && code <= 0x7a || character === "_";
    case "xdigit":
      return code >= 0x30 && code <= 0x39 || code >= 0x41 && code <= 0x46 ||
        code >= 0x61 && code <= 0x66;
  }
}

function compileSegment(segment: string, pattern: string): CompiledSegment {
  const sequence = new SegmentParser(segment, pattern).parse();
  const literalValue = sequence.nodes.every((node) => node.kind === "literal")
    ? sequence.nodes.map((node) => node.value).join("")
    : undefined;

  return {
    literalValue,
    matches(value: string, budget: MatchBudget): boolean {
      const sequenceMemo = new WeakMap<GlobSequence, Map<number, ReadonlySet<number>>>();
      const nodeMemo = new WeakMap<GlobNode, Map<number, ReadonlySet<number>>>();

      const evaluateAlternatives = (
        alternatives: readonly GlobSequence[],
        start: number,
      ): Set<number> => {
        const ends = new Set<number>();
        for (const alternative of alternatives) {
          budget.consume();
          for (const end of evaluateSequence(alternative, start)) ends.add(end);
        }
        return ends;
      };

      const evaluateNode = (node: GlobNode, start: number): ReadonlySet<number> => {
        budget.consume();
        let starts = nodeMemo.get(node);
        if (!starts) {
          starts = new Map();
          nodeMemo.set(node, starts);
        }
        const cached = starts.get(start);
        if (cached) return cached;

        const ends = new Set<number>();
        switch (node.kind) {
          case "literal":
            if (value.startsWith(node.value, start)) ends.add(start + node.value.length);
            break;
          case "any-character":
            if (start < value.length) ends.add(start + 1);
            break;
          case "any-characters":
            budget.consume(value.length - start + 1);
            for (let end = start; end <= value.length; end++) ends.add(end);
            break;
          case "character-class": {
            if (start >= value.length) break;
            const character = value[start]!;
            const code = character.charCodeAt(0);
            budget.consume(node.atoms.length);
            const included = node.atoms.some((atom) => {
              if (atom.kind === "character") return atom.value === character;
              if (atom.kind === "range") return code >= atom.start && code <= atom.end;
              return matchesPosixClass(character, atom.name);
            });
            if (included !== node.negated) ends.add(start + 1);
            break;
          }
          case "alternatives":
            for (const end of evaluateAlternatives(node.alternatives, start)) ends.add(end);
            break;
          case "negative": {
            const excluded = evaluateAlternatives(node.alternatives, start);
            // A negative extglob is a negative lookahead followed by a
            // segment-local wildcard. Any forbidden alternative that matches
            // at this position rejects the whole node; it is not merely one
            // disallowed end position among otherwise valid prefixes.
            // An empty alternative excludes only the zero-length endpoint; it
            // must not turn the entire negative group into match-nothing.
            let excludesNonEmptyPrefix = false;
            for (const end of excluded) {
              if (end > start) {
                excludesNonEmptyPrefix = true;
                break;
              }
            }
            if (!excludesNonEmptyPrefix) {
              budget.consume(value.length - start + 1);
              for (let end = start; end <= value.length; end++) {
                if (!excluded.has(end)) ends.add(end);
              }
            }
            break;
          }
          case "repeat": {
            if (node.maximum === 1) {
              ends.add(start);
              for (const end of evaluateAlternatives(node.alternatives, start)) ends.add(end);
              break;
            }

            const pending: number[] = [];
            if (node.minimum === 0) {
              ends.add(start);
              pending.push(start);
            } else {
              for (const end of evaluateAlternatives(node.alternatives, start)) {
                budget.consume();
                if (ends.has(end)) continue;
                ends.add(end);
                pending.push(end);
              }
            }
            for (let index = 0; index < pending.length; index++) {
              budget.consume();
              for (const end of evaluateAlternatives(node.alternatives, pending[index]!)) {
                if (ends.has(end)) continue;
                ends.add(end);
                pending.push(end);
              }
            }
            break;
          }
        }

        starts.set(start, ends);
        return ends;
      };

      const evaluateSequence = (
        current: GlobSequence,
        start: number,
      ): ReadonlySet<number> => {
        budget.consume();
        let starts = sequenceMemo.get(current);
        if (!starts) {
          starts = new Map();
          sequenceMemo.set(current, starts);
        }
        const cached = starts.get(start);
        if (cached) return cached;

        let positions = new Set([start]);
        for (const node of current.nodes) {
          const nextPositions = new Set<number>();
          for (const position of positions) {
            budget.consume();
            for (const end of evaluateNode(node, position)) nextPositions.add(end);
          }
          positions = nextPositions;
          if (positions.size === 0) break;
        }
        starts.set(start, positions);
        return positions;
      };

      return evaluateSequence(sequence, 0).has(value.length);
    },
  };
}

function normalizePattern(value: string): { absolute: boolean; segments: string[] } {
  return {
    absolute: value.startsWith("/"),
    // Repeated and trailing separators have no matching significance.
    segments: value.split("/").filter((segment) => segment.length > 0),
  };
}

function normalizeCandidatePath(
  value: string,
): { absolute: boolean; trailingSeparator: boolean; segments: string[] } {
  const portable = value.replaceAll("\\", "/");
  return {
    absolute: portable.startsWith("/"),
    // A trailing separator is significant when it is the separator required
    // before a final globstar that consumes zero complete segments.
    trailingSeparator: portable.endsWith("/"),
    segments: portable.split("/").filter((segment) => segment.length > 0),
  };
}

/**
 * Compile a bounded, dependency-free path glob.
 *
 * `*` and `?` stay within one path segment. A segment containing only `**`
 * matches zero or more complete segments. Brace alternatives, character
 * classes, POSIX character classes, and Bash-style extended groups are
 * supported. Backslash escapes the following pattern character. Candidates
 * accept either slash style and matching is always anchored to the full path.
 */
export function compilePathGlob(pattern: string): PathGlobMatcher {
  requireSafeGlobText(pattern, "Path glob pattern");
  const normalizedPattern = normalizePattern(pattern);
  const compiledSegments: CompiledPathSegment[] = normalizedPattern.segments.map(
    (segment) => segment === "**" ? "globstar" : compileSegment(segment, pattern),
  );
  const staticPrefixSegments: string[] = [];
  for (const segment of compiledSegments) {
    if (segment === "globstar" || segment.literalValue === undefined) break;
    staticPrefixSegments.push(segment.literalValue);
  }

  const test = (path: string): boolean => {
    requireSafeGlobText(path, "Path glob candidate");
    const candidate = normalizeCandidatePath(path);
    if (candidate.absolute !== normalizedPattern.absolute) return false;
    const budget = createMatchBudget(pattern);
    let reachablePathIndexes = new Set([0]);

    for (let segmentIndex = 0; segmentIndex < compiledSegments.length; segmentIndex++) {
      const segment = compiledSegments[segmentIndex]!;
      budget.consume();
      if (segment === "globstar") {
        let firstReachable = candidate.segments.length + 1;
        for (const pathIndex of reachablePathIndexes) {
          if (pathIndex < firstReachable) firstReachable = pathIndex;
        }
        reachablePathIndexes = new Set<number>();
        // Every non-leading pattern segment has a separator before it. A
        // globstar may consume zero segments only when that separator exists:
        // either another candidate segment follows or the candidate itself
        // ends in a separator. This preserves `a/**` != `a` while retaining
        // the zero-segment behavior of `a/**/b` and leading `**/b`.
        if (
          segmentIndex > 0 &&
          firstReachable === candidate.segments.length &&
          !candidate.trailingSeparator
        ) {
          continue;
        }
        budget.consume(candidate.segments.length - firstReachable + 1);
        for (
          let pathIndex = firstReachable;
          pathIndex <= candidate.segments.length;
          pathIndex++
        ) {
          reachablePathIndexes.add(pathIndex);
        }
        continue;
      }

      const nextReachablePathIndexes = new Set<number>();
      for (const pathIndex of reachablePathIndexes) {
        budget.consume();
        if (
          pathIndex < candidate.segments.length &&
          segment.matches(candidate.segments[pathIndex]!, budget)
        ) {
          nextReachablePathIndexes.add(pathIndex + 1);
        }
      }
      reachablePathIndexes = nextReachablePathIndexes;
      if (reachablePathIndexes.size === 0) return false;
    }

    return reachablePathIndexes.has(candidate.segments.length);
  };

  return Object.freeze({
    pattern,
    staticPrefixSegments: Object.freeze(staticPrefixSegments),
    segmentCount: compiledSegments.length,
    test,
  });
}
