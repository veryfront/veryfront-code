import type { RenderOptions } from "./types.ts";

/** @internal Marker carried only between trusted renderer layers. */
export const RENDER_OPTIONS_SNAPSHOT = Symbol(
  "veryfront.renderOptionsSnapshot",
);

type SnapshottedRenderOptions = RenderOptions & {
  readonly [RENDER_OPTIONS_SNAPSHOT]: true;
};

function snapshotParams(
  params: RenderOptions["params"],
): RenderOptions["params"] {
  if (!params) return params;
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  );
}

function snapshotLayoutProps(
  layoutProps: RenderOptions["layoutProps"],
): RenderOptions["layoutProps"] {
  if (!layoutProps) return layoutProps;
  return Object.fromEntries(
    Object.entries(layoutProps).map(([key, value]) => [key, { ...value }]),
  );
}

/**
 * Detach caller-owned request state before the first asynchronous boundary.
 *
 * Request cloning snapshots URL, method, headers, signal, and body stream;
 * URL cloning snapshots mutable search parameters. The marker prevents a
 * Renderer → RenderPipeline hand-off from cloning a request body twice.
 */
export function snapshotRenderOptions(
  options: RenderOptions | undefined,
): Readonly<RenderOptions> | undefined {
  if (!options) return undefined;
  if ((options as SnapshottedRenderOptions)[RENDER_OPTIONS_SNAPSHOT]) {
    return options;
  }

  const input = { ...options };
  const request = input.request;
  const url = input.url;
  const snapshot: SnapshottedRenderOptions = {
    ...input,
    ...(request ? { request: request.clone() } : {}),
    ...(url ? { url: new URL(url.href) } : {}),
    ...(input.params ? { params: snapshotParams(input.params) } : {}),
    ...(input.props ? { props: { ...input.props } } : {}),
    ...(input.layoutProps ? { layoutProps: snapshotLayoutProps(input.layoutProps) } : {}),
    ...(input.clientPageIsland
      ? {
        clientPageIsland: {
          ...input.clientPageIsland,
          clientLayoutPaths: [...input.clientPageIsland.clientLayoutPaths],
        },
      }
      : {}),
    [RENDER_OPTIONS_SNAPSHOT]: true,
  };
  return Object.freeze(snapshot);
}
