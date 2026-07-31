import type { RenderOptions } from "./types.ts";

/** @internal Marker carried only between trusted renderer layers. */
export const RENDER_OPTIONS_SNAPSHOT = Symbol(
  "veryfront.renderOptionsSnapshot",
);

type SnapshottedRenderOptions = RenderOptions & {
  readonly [RENDER_OPTIONS_SNAPSHOT]: true;
};

const MAX_DEPENDENCY_PINNING_ENTRIES = 10_000;
const MAX_DEPENDENCY_PINNING_CHARACTERS = 1024 * 1024;

function snapshotDependencyPinningDependencies(
  dependencies: RenderOptions["dependencyPinningDependencies"],
): RenderOptions["dependencyPinningDependencies"] {
  if (dependencies === undefined) return undefined;
  if (
    dependencies === null ||
    typeof dependencies !== "object" ||
    Array.isArray(dependencies)
  ) {
    throw new TypeError("Dependency pinning dependencies must be an object");
  }

  const entries = Object.entries(dependencies);
  if (entries.length > MAX_DEPENDENCY_PINNING_ENTRIES) {
    throw new RangeError(
      `Dependency pinning dependencies exceed the ${MAX_DEPENDENCY_PINNING_ENTRIES}-entry limit`,
    );
  }

  const snapshot = Object.create(null) as Record<string, string>;
  let characterCount = 0;
  for (const [name, declaration] of entries) {
    if (
      name.length === 0 ||
      typeof declaration !== "string"
    ) {
      throw new TypeError(
        "Dependency pinning dependencies require non-empty names and string declarations",
      );
    }
    characterCount += name.length + declaration.length;
    if (characterCount > MAX_DEPENDENCY_PINNING_CHARACTERS) {
      throw new RangeError(
        `Dependency pinning dependencies exceed the ${MAX_DEPENDENCY_PINNING_CHARACTERS}-character limit`,
      );
    }
    snapshot[name] = declaration;
  }
  return Object.freeze(snapshot);
}

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
  const dependencyPinningDependencies = snapshotDependencyPinningDependencies(
    input.dependencyPinningDependencies,
  );
  const snapshot: SnapshottedRenderOptions = {
    ...input,
    ...(request ? { request: request.clone() } : {}),
    ...(url ? { url: new URL(url.href) } : {}),
    ...(input.params ? { params: snapshotParams(input.params) } : {}),
    ...(input.props ? { props: { ...input.props } } : {}),
    ...(input.layoutProps ? { layoutProps: snapshotLayoutProps(input.layoutProps) } : {}),
    ...(dependencyPinningDependencies ? { dependencyPinningDependencies } : {}),
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
