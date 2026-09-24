/**
 * Canonical peer-address parsing shared by the trusted-proxy runtime and the
 * config schema.
 *
 * Keep this module a dependency-free leaf. The config schema is part of the
 * browser-safe `veryfront/index.client` graph, so it must not reach the
 * trusted-proxy runtime, which pulls `identity.ts` and its `node:util` use.
 *
 * @module security/application-auth/peer-address
 */

const DECIMAL_OCTET_PATTERN = /^(?:0|[1-9][0-9]{0,2})$/;
const IPV4_MAPPED_IPV6_PATTERN = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

const apply = Reflect.apply;
const arrayPush = Array.prototype.push;
const NativeNumber = Number;
const numberIsSafeInteger = NativeNumber.isSafeInteger;
const numberParseInt = NativeNumber.parseInt;
const numberToString = NativeNumber.prototype.toString;
const regexpExec = RegExp.prototype.exec;
const regexpTest = RegExp.prototype.test;
const stringIncludes = String.prototype.includes;
const stringSlice = String.prototype.slice;
const stringSplit = String.prototype.split;
const stringStartsWith = String.prototype.startsWith;
const stringToLowerCase = String.prototype.toLowerCase;
const stringTrim = String.prototype.trim;

function arrayAppend<T>(array: T[], value: T): void {
  apply(arrayPush, array, [value]);
}

export function canonicalizePeerAddress(hostname: string): string | null {
  if (hostname.length === 0 || hostname !== (apply(stringTrim, hostname, []) as string)) {
    return null;
  }
  if (
    apply(stringIncludes, hostname, ["/"]) as boolean ||
    apply(stringIncludes, hostname, ["%"]) as boolean ||
    apply(stringIncludes, hostname, ["["]) as boolean ||
    apply(stringIncludes, hostname, ["]"]) as boolean
  ) {
    return null;
  }

  const ipv4 = parseCanonicalIpv4(hostname);
  if (ipv4 !== null) return `ipv4:${ipv4}`;

  const mappedPrefix = "::ffff:";
  const lower = apply(stringToLowerCase, hostname, []) as string;
  if (apply(stringStartsWith, lower, [mappedPrefix]) as boolean) {
    const mappedDotted = parseCanonicalIpv4(
      apply(stringSlice, hostname, [mappedPrefix.length]) as string,
    );
    if (mappedDotted !== null) return `ipv4:${mappedDotted}`;
  }

  const ipv6 = canonicalizeIpv6(hostname);
  if (ipv6 === null) return null;
  const mapped = apply(regexpExec, IPV4_MAPPED_IPV6_PATTERN, [ipv6]) as RegExpExecArray | null;
  if (mapped !== null) {
    const high = apply(numberParseInt, NativeNumber, [mapped[1]!, 16]) as number;
    const low = apply(numberParseInt, NativeNumber, [mapped[2]!, 16]) as number;
    return `ipv4:${(high >>> 8) & 0xff}.${high & 0xff}.${(low >>> 8) & 0xff}.${low & 0xff}`;
  }
  return `ipv6:${ipv6}`;
}

function parseCanonicalIpv4(hostname: string): string | null {
  const octets = apply(stringSplit, hostname, ["."]) as string[];
  if (octets.length !== 4) return null;

  const parsed: number[] = [];
  for (let index = 0; index < octets.length; index += 1) {
    const octet = octets[index]!;
    if (!(apply(regexpTest, DECIMAL_OCTET_PATTERN, [octet]) as boolean)) return null;
    const value = apply(NativeNumber, undefined, [octet]) as number;
    if (value > 255) return null;
    arrayAppend(parsed, value);
  }
  return `${parsed[0]}.${parsed[1]}.${parsed[2]}.${parsed[3]}`;
}

function canonicalizeIpv6(hostname: string): string | null {
  if (!(apply(stringIncludes, hostname, [":"]) as boolean)) return null;
  const words = parseIpv6Words(hostname);
  return words === null ? null : formatIpv6Words(words);
}

function parseIpv6Words(hostname: string): readonly number[] | null {
  const doubleColonParts = apply(stringSplit, hostname, ["::"]) as string[];
  if (doubleColonParts.length > 2) return null;

  const left = parseIpv6WordSide(doubleColonParts[0]!);
  if (left === null) return null;
  const right = doubleColonParts.length === 2 ? parseIpv6WordSide(doubleColonParts[1]!) : [];
  if (right === null) return null;

  if (doubleColonParts.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;

  const words: number[] = [];
  for (let index = 0; index < left.length; index += 1) arrayAppend(words, left[index]!);
  for (let index = 0; index < missing; index += 1) arrayAppend(words, 0);
  for (let index = 0; index < right.length; index += 1) arrayAppend(words, right[index]!);
  return words;
}

function parseIpv6WordSide(value: string): number[] | null {
  if (value.length === 0) return [];
  const rawWords = apply(stringSplit, value, [":"]) as string[];
  const words: number[] = [];
  for (let index = 0; index < rawWords.length; index += 1) {
    const rawWord = rawWords[index]!;
    if (rawWord.length === 0 || rawWord.length > 4) return null;
    if (!(apply(regexpTest, /^[0-9a-fA-F]{1,4}$/, [rawWord]) as boolean)) return null;
    const word = apply(numberParseInt, NativeNumber, [rawWord, 16]) as number;
    if (!numberIsSafeInteger(word) || word < 0 || word > 0xffff) return null;
    arrayAppend(words, word);
  }
  return words;
}

function formatIpv6Words(words: readonly number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;

  for (let index = 0; index <= words.length; index += 1) {
    if (index < words.length && words[index] === 0) {
      if (currentStart === -1) currentStart = index;
      currentLength += 1;
      continue;
    }
    if (currentLength > bestLength && currentLength > 1) {
      bestStart = currentStart;
      bestLength = currentLength;
    }
    currentStart = -1;
    currentLength = 0;
  }

  if (bestStart === -1) return joinIpv6Words(words, 0, words.length);

  const left = joinIpv6Words(words, 0, bestStart);
  const right = joinIpv6Words(words, bestStart + bestLength, words.length);
  if (left.length === 0 && right.length === 0) return "::";
  if (left.length === 0) return `::${right}`;
  if (right.length === 0) return `${left}::`;
  return `${left}::${right}`;
}

function joinIpv6Words(words: readonly number[], start: number, end: number): string {
  let output = "";
  for (let index = start; index < end; index += 1) {
    if (index > start) output += ":";
    output += apply(numberToString, words[index]!, [16]) as string;
  }
  return output;
}
