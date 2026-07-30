# Studio bridge browser boundary

This private workspace is the dependency-free browser entry for the Studio
bridge. It is not a public Veryfront package.

`entry.ts` starts the bridge without optional capture support. Both the release
prebundler and the local source-mode handler bundle this same entry point. The
resulting JavaScript is checked into
`src/studio/bridge/bridge-bundle.generated.ts`; packaged runtimes serve that
artifact without loading packages dynamically.

Screenshot requests fail with an explicit capability error unless a configured
Studio capture extension supplies an alternative bridge bundle. Vendor imports,
runtime mapping, and browser behavior belong to that extension package.
