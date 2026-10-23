/**
 * Keep host paths out of API module loader errors and logs.
 *
 * Redaction can run after project code has evaluated in this realm, so it uses
 * intrinsics captured at module load, never the live string, RegExp or URL
 * prototypes that code could have replaced.
 *
 * @module routing/api/module-loader/path-redaction
 */

const IntrinsicReflectApply = Reflect.apply;
const IntrinsicDecodeURIComponent = decodeURIComponent;
const RegExpPrototypeExec = RegExp.prototype.exec;
const StringPrototypeSlice = String.prototype.slice;

const REDACTION_FAILED = "<redacted path>";

function slice(text: string, start: number, end = text.length): string {
  return IntrinsicReflectApply(StringPrototypeSlice, text, [start, end]) as string;
}

/** Every match of global `pattern` in `text` replaced, in one linear pass. */
export function replaceMatches(
  text: string,
  pattern: RegExp,
  replace: (match: RegExpExecArray) => string,
): string {
  let result = "";
  let last = 0;
  pattern.lastIndex = 0;
  for (
    let match = IntrinsicReflectApply(RegExpPrototypeExec, pattern, [text]) as
      | RegExpExecArray
      | null;
    match !== null;
    match = IntrinsicReflectApply(RegExpPrototypeExec, pattern, [text]) as RegExpExecArray | null
  ) {
    result += slice(text, last, match.index) + replace(match);
    last = match.index + match[0].length;
    if (match[0].length === 0) pattern.lastIndex++;
  }
  return result + slice(text, last);
}

export function isSeparator(char: string | undefined): boolean {
  return char === "/" || char === "\\";
}

/** The text after the last `/` or `\`. */
export function lastPathSegment(path: string): string {
  let start = 0;
  for (let index = 0; index < path.length; index++) {
    if (isSeparator(path[index])) start = index + 1;
  }
  return slice(path, start);
}

/** `projectDir` without trailing separators, so `/app/` and `/app` agree. */
function trimmedRoot(projectDir: string): string {
  let end = projectDir.length;
  while (end > 1 && isSeparator(projectDir[end - 1])) end--;
  return slice(projectDir, 0, end);
}

/** Whether `path` starts with `root` followed by a separator, either kind. */
function startsWithRoot(path: string, root: string): boolean {
  for (let index = 0; index < root.length; index++) {
    const same = path[index] === root[index] ||
      (isSeparator(path[index]) && isSeparator(root[index]));
    if (!same) return false;
  }
  return isSeparator(path[root.length]);
}

/** Whether `path` climbs with a `..` segment, so its prefix proves nothing. */
function hasParentSegment(path: string): boolean {
  let segmentStart = 0;
  for (let index = 0; index <= path.length; index++) {
    if (index === path.length || isSeparator(path[index])) {
      if (
        index - segmentStart === 2 && path[segmentStart] === "." && path[segmentStart + 1] === "."
      ) return true;
      segmentStart = index + 1;
    }
  }
  return false;
}

/**
 * A path the code holds structurally (a module or location path, not text
 * scanned out of a message): project-relative inside the resolved
 * `projectDir`, else its file name. A `..` segment is never trusted inside.
 */
export function structuralPathLabel(path: string, projectDir: string): string {
  const root = trimmedRoot(projectDir);
  if (!hasParentSegment(path) && startsWithRoot(path, root)) return slice(path, root.length + 1);
  return lastPathSegment(path);
}

/** An `http(s)` URL by scheme and host only: a path can carry a token. */
export function remoteOrigin(url: string): string {
  const schemeEnd = url[4] === ":" ? 7 : 8;
  let hostEnd = schemeEnd;
  while (
    hostEnd < url.length && !isSeparator(url[hostEnd]) && url[hostEnd] !== "?" &&
    url[hostEnd] !== "#"
  ) hostEnd++;
  let hostStart = schemeEnd;
  for (let index = schemeEnd; index < hostEnd; index++) {
    if (url[index] === "@") hostStart = index + 1;
  }
  return (schemeEnd === 7 ? "http://" : "https://") + slice(url, hostStart, hostEnd);
}

/** A `file:` URL by its file name, without its query or fragment. */
function fileUrlName(url: string): string {
  let end = url.length;
  for (let index = 0; index < url.length; index++) {
    if (url[index] === "?" || url[index] === "#") {
      end = index;
      break;
    }
  }
  let path = slice(url, 5, end);
  if (path[0] === "/" && path[1] === "/") {
    // The authority is a host, never a file name.
    let start = 2;
    while (start < path.length && path[start] !== "/") start++;
    path = slice(path, start);
  }
  let name = lastPathSegment(path);
  try {
    name = IntrinsicDecodeURIComponent(name);
  } catch {
    // A malformed escape stays encoded.
  }
  // A decoded `%2F` or `%5C` is a separator too.
  return lastPathSegment(name);
}

// One pass, three kinds of token, each running to the next whitespace or quote:
// a `file:` URL, an `http(s)` URL, and an absolute path. A path may follow `:`
// or a sentence's `.` (`error:/home/a.ts`, `end./home/a.ts`), but not a word,
// another path character, or a relative `./` or `../`.
const FREE_TEXT_PATTERN =
  /(?<![\w-])(file:[^\s'"`]+)|(https?:\/\/[^\s'"`]+)|(?<![\w/\\])(?<!(?<![\w])\.)(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s'"`]+/gi;

/**
 * `text` with every absolute path and `file:` URL cut to its file name and
 * every `http(s)` URL cut to its origin. A path is taken through to the next
 * whitespace or quote, so a directory name is never left behind; an outside
 * path that itself contains whitespace is the accepted exception, since text
 * gives no way to tell where it ends. Never throws.
 */
export function redactFreeText(text: string): string {
  try {
    return replaceMatches(text, FREE_TEXT_PATTERN, (match) => {
      if (match[1] !== undefined) return fileUrlName(match[1]);
      if (match[2] !== undefined) return remoteOrigin(match[2]);
      return lastPathSegment(match[0]);
    });
  } catch {
    return REDACTION_FAILED;
  }
}
