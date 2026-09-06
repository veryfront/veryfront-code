import type * as React from "react";
import { serverLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { ClientComponentMeta, RSCPayload, RSCRendererOptions } from "../types.ts";
import { appendClientModuleVersion, buildClientModuleUrl } from "../client-module-strategy.ts";
import type { RSCComponentProps } from "./component-detector.ts";
import { treeToHTML } from "./html-generator.ts";
import { renderTree } from "./tree-processor.ts";
import type { ReactServerRuntime } from "#veryfront/react/compat/ssr-adapter/server-loader.ts";

const logger = serverLogger.component("rsc");

export class RSCRenderer {
  private clientManifest: Map<string, ClientComponentMeta>;
  private mode: "development" | "production";
  private clientModuleStrategy: "fs" | "rsc-module";
  private reactVersion?: string;

  constructor(options: RSCRendererOptions) {
    // Defaults to production. An omitted mode used to select development,
    // which puts the whole rendered tree into the RSC payload (see
    // `renderToPayload`) and selects the filesystem client module strategy.
    this.mode = options.mode ?? "production";
    this.clientModuleStrategy = options.clientModuleStrategy ??
      (this.mode === "development" ? "fs" : "rsc-module");
    this.reactVersion = options.reactVersion;
    this.clientManifest = this.resolveClientManifest(options.clientManifest);
  }

  renderToPayload<Props extends RSCComponentProps = RSCComponentProps>(
    Component: React.ComponentType<Props> | React.ReactElement,
    props: Props = {} as Props,
    options: { reactVersion?: string; reactRuntime?: ReactServerRuntime } = {},
  ): Promise<RSCPayload> {
    return withSpan(
      "rsc.renderToPayload",
      async () => {
        const clientRefs = new Map<string, string>();

        try {
          const tree = await renderTree(
            Component,
            props,
            this.clientManifest,
            clientRefs,
            options.reactVersion ?? this.reactVersion,
            options.reactRuntime,
          );
          const html = await treeToHTML(tree, clientRefs, this.clientManifest);

          return {
            html,
            clientRefs: Object.fromEntries(clientRefs),
            tree: this.mode === "development" ? tree : undefined,
          };
        } catch (error) {
          logger.error("Render error:", error);
          throw error;
        }
      },
      { "rsc.mode": this.mode },
    );
  }

  private resolveClientManifest(
    manifest: Map<string, ClientComponentMeta>,
  ): Map<string, ClientComponentMeta> {
    const resolved = new Map<string, ClientComponentMeta>();
    for (const [id, meta] of manifest) {
      if (this.clientModuleStrategy === "fs") {
        resolved.set(id, {
          ...meta,
          path: appendClientModuleVersion(meta.path, meta.contentHash),
        });
        continue;
      }

      const rel = meta.rel;
      if (!rel) {
        resolved.set(id, {
          ...meta,
          path: appendClientModuleVersion(meta.path, meta.contentHash),
        });
        continue;
      }

      const moduleUrl = buildClientModuleUrl({
        strategy: "rsc-module",
        rel,
        version: meta.contentHash,
      });
      if (!moduleUrl) {
        throw new Error(`Client component ${id} has an invalid project-relative module path`);
      }

      resolved.set(id, { ...meta, path: moduleUrl });
    }

    return resolved;
  }
}
