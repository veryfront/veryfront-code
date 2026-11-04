const RegExpExec = RegExp.prototype.exec;
const Apply = Reflect.apply;
const SourcePath = /^\/projects\/[^/]+\/files\/[^/?#]+(?:\?[^#]*)?$/;
const AssetPath = /^\/projects\/[^/]+\/knowledge\/assets\/[^/?#]+(?:\?[^#]*)?$/;
const MovePath = /^\/projects\/[^/]+\/files\/move$/;
const CommitPath = /^\/projects\/[^/]+\/commit$/;
const DraftPath = /^\/projects\/[^/]+\/branches\/[^/]+\/files\/[^/]+\/draft$/;
const IndexPath = /^\/projects\/[^/]+\/branches\/[^/]+\/files\/[^/]+\/index$/;

/** Select file mutations before the API resolves canonical paths, aliases or UUIDs. */
export function isRuntimeFileMutationRequest(method: string, path: string): boolean {
  if (method === "PUT" || method === "DELETE") {
    return Apply(RegExpExec, SourcePath, [path]) !== null ||
      Apply(RegExpExec, DraftPath, [path]) !== null ||
      (method === "PUT" && Apply(RegExpExec, AssetPath, [path]) !== null);
  }
  return method === "POST" && (Apply(RegExpExec, MovePath, [path]) !== null ||
    Apply(RegExpExec, CommitPath, [path]) !== null ||
    Apply(RegExpExec, IndexPath, [path]) !== null);
}
