import type * as React from "react";
import { serverLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { ClientComponentMeta, RSCPayload, RSCRendererOptions } from "../types.ts";
import { treeToHTML } from "./html-generator.ts";
import { renderTree } from "./tree-processor.ts";

const logger = serverLogger.component("rsc");

export class RSCRenderer {
  private clientManifest: Map<string, ClientComponentMeta>;
  private mode: "development" | "production";
  private clientRefs = new Map<string, string>();

  constructor(options: RSCRendererOptions) {
    this.clientManifest = options.clientManifest;
    this.mode = options.mode ?? "development";
  }

  renderToPayload(
    Component: React.ComponentType<any> | React.ReactElement,
    props: Record<string, unknown> = {},
  ): Promise<RSCPayload> {
    return withSpan(
      "rsc.renderToPayload",
      async () => {
        this.clientRefs.clear();

        try {
          const tree = await renderTree(Component, props, this.clientManifest, this.clientRefs);
          const html = await treeToHTML(tree);

          return {
            html,
            clientRefs: Object.fromEntries(this.clientRefs),
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
}
