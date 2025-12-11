
import type * as React from "react";
import { serverLogger as logger } from "@veryfront/utils";
import type { ClientComponentMeta, RSCPayload, RSCRendererOptions } from "../types.ts";
import { treeToHTML } from "./html-generator.ts";
import { renderTree } from "./tree-processor.ts";

export class RSCRenderer {
  private clientManifest: Map<string, ClientComponentMeta>;
  private projectDir: string;
  private mode: "development" | "production";
  private clientRefs: Map<string, string> = new Map();

  constructor(options: RSCRendererOptions) {
    this.clientManifest = options.clientManifest;
    this.projectDir = options.projectDir;
    this.mode = options.mode || "development";
  }

  async renderToPayload(
    Component: React.ComponentType<any> | React.ReactElement,
    props: Record<string, unknown> = {},
  ): Promise<RSCPayload> {
    this.clientRefs.clear();

    try {
      const tree = await renderTree(Component, props, this.clientManifest, this.clientRefs);

      const html = await treeToHTML(tree);

      const clientRefs: Record<string, string> = {};
      for (const [id, path] of this.clientRefs) {
        clientRefs[id] = path;
      }

      return {
        html,
        clientRefs,
        tree: this.mode === "development" ? tree : undefined,
      };
    } catch (error) {
      logger.error("[RSC] Render error:", error);
      throw error;
    }
  }
}
