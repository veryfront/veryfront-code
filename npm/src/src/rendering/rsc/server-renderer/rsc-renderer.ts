import type * as React from "react";
import { serverLogger as logger } from "../../../utils/index.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import type { ClientComponentMeta, RSCPayload, RSCRendererOptions } from "../types.js";
import { treeToHTML } from "./html-generator.js";
import { renderTree } from "./tree-processor.js";

export class RSCRenderer {
  private clientManifest: Map<string, ClientComponentMeta>;
  private mode: "development" | "production";
  private clientRefs: Map<string, string> = new Map();

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
          logger.error("[RSC] Render error:", error);
          throw error;
        }
      },
      { "rsc.mode": this.mode },
    );
  }
}
