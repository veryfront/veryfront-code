/**
 * Head Collector - Request-scoped metadata collection for SSR
 *
 * Collects head metadata during React SSR render, avoiding HTML parsing.
 * Works across Deno, Bun, and Node.js with no external dependencies.
 *
 * Usage:
 *   resetHeadCollector()           // Before render
 *   collectHead({ title: "..." })  // During render (from Head component)
 *   const data = flushHeadCollector()  // After render
 */

export interface HeadMeta {
  name?: string;
  property?: string;
  content: string;
}

export interface HeadLink {
  rel?: string;
  href?: string;
  [key: string]: string | undefined;
}

export interface CollectedHead {
  title?: string;
  description?: string;
  metas: HeadMeta[];
  links: HeadLink[];
  styles: string[];
}

function createEmpty(): CollectedHead {
  return { metas: [], links: [], styles: [] };
}

let collected: CollectedHead = createEmpty();

/**
 * Collect head metadata during SSR render.
 * Called by Head component for each child element.
 */
export function collectHead(data: Partial<CollectedHead>): void {
  if (data.title !== undefined) collected.title = data.title;
  if (data.description !== undefined) collected.description = data.description;

  if (data.metas?.length) {
    for (const meta of data.metas) {
      if (meta.name === "description" && meta.content) {
        collected.description = meta.content;
      }
      collected.metas.push(meta);
    }
  }

  if (data.links?.length) collected.links.push(...data.links);
  if (data.styles?.length) collected.styles.push(...data.styles);
}

/**
 * Flush collected head data and reset for next request.
 * Call after SSR render completes.
 */
export function flushHeadCollector(): CollectedHead {
  const result = collected;
  collected = createEmpty();
  return result;
}

/**
 * Reset collector before SSR render.
 * Ensures clean state for each request.
 */
export function resetHeadCollector(): void {
  collected = createEmpty();
}

/**
 * Check if any head data has been collected.
 */
export function hasCollectedHead(): boolean {
  return Boolean(
    collected.title ||
      collected.description ||
      collected.metas.length ||
      collected.links.length ||
      collected.styles.length,
  );
}
