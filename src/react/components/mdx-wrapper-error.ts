/** MDX wrapper kind that cannot be executed by the synchronous React facade. */
export type MdxWrapperKind = "layout" | "provider";

/**
 * Raised when legacy React wrapper components receive compiled MDX code.
 *
 * Executing a string factory during render is intentionally unsupported. The
 * server rendering pipeline must load and validate the ESM module before it
 * constructs the React tree.
 */
export class MdxWrapperRenderError extends Error {
  override readonly name = "MdxWrapperRenderError";
  readonly code = "VF_REACT_ASYNC_MDX_REQUIRED";

  constructor(readonly wrapperKind: MdxWrapperKind) {
    const expectedExports = wrapperKind === "layout"
      ? "MDXLayout, MainLayout, or default"
      : "MDXWrapper or default";
    super(
      `${wrapperKind === "layout" ? "LayoutComponent" : "ProviderComponent"} cannot execute ` +
        `MdxBundle.compiledCode during React render. Load the compiled module with ` +
        `mdxRenderer.loadModuleESM(...) in the rendering pipeline, validate its ` +
        `${expectedExports} export, and render that component instead.`,
    );
  }
}

export function rejectSynchronousMdxWrapper(
  wrapperKind: MdxWrapperKind,
): never {
  throw new MdxWrapperRenderError(wrapperKind);
}
