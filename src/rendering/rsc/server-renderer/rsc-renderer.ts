import type * as React from "react";
import { serverLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { ClientComponentMeta, RSCPayload, RSCRendererOptions } from "../types.ts";
import { appendClientModuleVersion, buildClientModuleUrl } from "../client-module-strategy.ts";
import { snapshotClientComponentMeta } from "../client-manifest-snapshot.ts";
import type { RSCComponentProps } from "./component-detector.ts";
import { treeToHTML } from "./html-generator.ts";
import { renderTree } from "./tree-processor.ts";

const logger = serverLogger.component("rsc");

export class RSCRenderer {
  private clientManifest: Map<string, ClientComponentMeta>;
  private mode: "development" | "production";
  private clientModuleStrategy: "fs" | "rsc-module";
  private reactVersion?: string;

  constructor(options: RSCRendererOptions) {
    this.mode = options.mode ?? "development";
    this.clientModuleStrategy = options.clientModuleStrategy ??
      (this.mode === "development" ? "fs" : "rsc-module");
    this.reactVersion = options.reactVersion;
    this.clientManifest = this.resolveClientManifest(options.clientManifest);
  }

  renderToPayload<Props extends RSCComponentProps = RSCComponentProps>(
    Component: React.ComponentType<Props> | React.ReactElement,
    props: Props = {} as Props,
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
            this.reactVersion,
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
    manifest: ReadonlyMap<string, ClientComponentMeta>,
  ): Map<string, ClientComponentMeta> {
    const resolved = new Map<string, ClientComponentMeta>();
    for (const [id, sourceMeta] of manifest) {
      const meta = snapshotClientComponentMeta(sourceMeta);
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
