const RegExpExec = RegExp.prototype.exec;
const Apply = Reflect.apply;
// A request target is a path and an optional query. A fragment is refused.
const RequestTarget = /^([^?#]*)(\?[^#]*)?$/;
// Path text that URL parsing rewrites: dot segments in any spelling,
// backslashes, and unencoded spaces or control characters. Such a path is
// not sent as written, so it is never selected.
// deno-lint-ignore no-control-regex
const RewrittenPath = /[\x00-\x20\\]|(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i;
const SourcePath = /^\/projects\/[^/]+\/files\/[^/]+$/;
const AssetPath = /^\/projects\/[^/]+\/knowledge\/assets\/[^/]+$/;
const LegacyMovePath = /^\/projects\/[^/]+\/files\/move$/;
// Canonical move: one encoded file segment, then the literal action. The legacy
// route above stays until the API removes it.
const MovePath = /^\/projects\/[^/]+\/files\/[^/]+\/move$/;
const CommitPath = /^\/projects\/[^/]+\/commit$/;
const DraftPath = /^\/projects\/[^/]+\/branches\/[^/]+\/files\/[^/]+\/draft$/;
const IndexPath = /^\/projects\/[^/]+\/branches\/[^/]+\/files\/[^/]+\/index$/;

function matches(pattern: RegExp, value: string): boolean {
  return Apply(RegExpExec, pattern, [value]) !== null;
}

/** Select file mutations before the API resolves canonical paths, aliases or UUIDs. */
export function isRuntimeFileMutationRequest(method: string, path: string): boolean {
  const target = Apply(RegExpExec, RequestTarget, [path]) as RegExpExecArray | null;
  if (target === null) return false;
  const pathname = target[1] ?? "";
  if (matches(RewrittenPath, pathname)) return false;
  // Only the routes that take a selector as a query accept one.
  const hasQuery = target[2] !== undefined;
  if (method === "PUT" || method === "DELETE") {
    return matches(SourcePath, pathname) ||
      (!hasQuery && matches(DraftPath, pathname)) ||
      (method === "PUT" && matches(AssetPath, pathname));
  }
  return method === "POST" && (matches(MovePath, pathname) ||
    (!hasQuery && (matches(LegacyMovePath, pathname) ||
      matches(CommitPath, pathname) ||
      matches(IndexPath, pathname))));
}
