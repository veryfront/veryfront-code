/**
 * Main RSC renderer class
 *
 * Minimal React Server Components renderer for Veryfront.
 * This implementation focuses on simplicity over features:
 * - No streaming (can be added later)
 * - Simple JSON serialization (no Flight protocol)
 * - Direct component rendering
 *
 * @module rsc-renderer
 */

import type * as React from "react";
import { serverLogger as logger } from "@veryfront/utils";
import type { ClientComponentMeta, RSCPayload, RSCRendererOptions } from "../types.ts";
import { treeToHTML } from "./html-generator.ts";
import { renderTree } from "./tree-processor.ts";

/**
 * RSC Renderer
 *
 * Handles rendering of React Server Components to HTML payloads
 * with client component references.
 */
export class RSCRenderer {
  private clientManifest: Map<string, ClientComponentMeta>;
  private projectDir: string;
  private mode: "development" | "production";
  private clientRefs: Map<string, string> = new Map();

  /**
   * Create a new RSC renderer
   *
   * @param options - Renderer options
   */
  constructor(options: RSCRendererOptions) {
    this.clientManifest = options.clientManifest;
    this.projectDir = options.projectDir;
    this.mode = options.mode || "development";
  }

  /**
   * Render a component tree to an RSC payload
   *
   * @param Component - Component or element to render
   * @param props - Props to pass to component
   * @returns RSC payload with HTML and client references
   */
  async renderToPayload(
    Component: React.ComponentType<any> | React.ReactElement,
    props: Record<string, unknown> = {},
  ): Promise<RSCPayload> {
    // Reset client refs for this render
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
  }
}
