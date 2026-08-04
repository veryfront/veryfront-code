/**
 * `MarkdownRendererProvider` contract — an extension-owned rich Markdown
 * renderer for React surfaces.
 *
 * Core presents Markdown source verbatim in an escaped `<pre><code>` surface.
 * A provider supplies the semantic renderer: parsing, sanitization, link and
 * image policy, and fenced-code presentation all belong to the extension.
 *
 * @module extensions/markdown/markdown-renderer-provider
 */

/** Contract name used to register and resolve a Markdown renderer provider. */
export const MarkdownRendererProviderName = "MarkdownRendererProvider";

/**
 * A rich Markdown renderer supplied by an extension.
 *
 * `renderer` is a React component implementing the `MarkdownRendererProps`
 * contract from `veryfront/markdown`. It is typed as `unknown` here so the
 * extension registry stays free of React types; consumers narrow it at the
 * React boundary.
 */
export interface MarkdownRendererProvider {
  /** Stable identifier of the providing extension, for diagnostics. */
  readonly id: string;
  /** React component implementing `MarkdownRendererProps`. */
  readonly renderer: unknown;
}

/** Build a {@link MarkdownRendererProvider} with a validated shape. */
export function createMarkdownRendererProvider(
  id: string,
  renderer: unknown,
): MarkdownRendererProvider {
  if (id.trim() === "") {
    throw new TypeError("A Markdown renderer provider must declare a non-empty id.");
  }
  // `typeof null === "object"`, so null is rejected explicitly: a provider with
  // no usable renderer must not register.
  if (renderer === null || (typeof renderer !== "function" && typeof renderer !== "object")) {
    throw new TypeError(
      "A Markdown renderer provider must supply a React component as its renderer.",
    );
  }
  return Object.freeze({ id, renderer });
}

/** Snapshot a provider for diagnostics without exposing the component itself. */
export function snapshotMarkdownRendererProvider(
  provider: MarkdownRendererProvider,
): Readonly<{ id: string; hasRenderer: boolean }> {
  return Object.freeze({
    id: provider.id,
    hasRenderer: provider.renderer !== undefined && provider.renderer !== null,
  });
}
