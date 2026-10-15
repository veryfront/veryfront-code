/** Keep framework and extension React imports in the consumer's single peer graph. */
export function normalizeReactPeerDependencies(pkg: {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}): void {
  for (const name of ["react", "react-dom"]) {
    const declaration = pkg.dependencies?.[name];
    if (declaration === undefined) continue;
    delete pkg.dependencies![name];
    pkg.peerDependencies ??= {};
    pkg.peerDependencies[name] = /^[0-9]+\.[0-9]+\.[0-9]+$/.test(declaration)
      ? `^${declaration}`
      : declaration;
  }
  if (pkg.dependencies && Object.keys(pkg.dependencies).length === 0) {
    delete pkg.dependencies;
  }
}
