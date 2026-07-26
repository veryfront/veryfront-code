# Studio bridge browser boundary

This private workspace boundary owns browser-only third-party code embedded in
the generated Studio bridge. It is not a public Veryfront package or an
extension users configure.

`entry.ts` installs the pinned `html2canvas-pro` implementation into the bridge
before the parent frame can request a screenshot. Both the release prebundler
and the local source-mode handler bundle this same entry point. The resulting
JavaScript is checked into
`src/studio/bridge/bridge-bundle.generated.ts`; packaged runtimes serve that
artifact and do not resolve `html2canvas-pro` dynamically.

Keeping the dependency here preserves the root framework's zero-third-party
core boundary while still recording the browser library and its transitive
packages as their own SBOM workspace boundary.
