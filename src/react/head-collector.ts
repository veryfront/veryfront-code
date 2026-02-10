/**
 * Head Collector - Request-scoped metadata collection for SSR
 *
 * Collects head metadata during React SSR render using AsyncLocalStorage
 * for proper isolation between concurrent requests.
 *
 * Usage:
 *   const { result, head } = await runWithHeadCollector(() => renderToString(element));
 *   // head.title, head.description, head.metas are now available
 */

import { AsyncLocalStorage } from "node:async_hooks";

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

export interface HeadScript {
  /** Inline script content */
  content?: string;
  /** Script src URL */
  src?: string;
  /** Script type (default: text/javascript) */
  type?: string;
  /** Additional attributes */
  [key: string]: string | undefined;
}

export interface CollectedHead {
  title?: string;
  description?: string;
  metas: HeadMeta[];
  links: HeadLink[];
  styles: string[];
  /** Blocking scripts - injected at top of <head> before CSS */
  scripts: HeadScript[];
}

function createEmpty(): CollectedHead {
  return { metas: [], links: [], styles: [], scripts: [] };
}

const headStorage = new AsyncLocalStorage<CollectedHead>();

export async function runWithHeadCollector<T>(
  fn: () => T | Promise<T>,
): Promise<{ result: T; head: CollectedHead }> {
  const head = createEmpty();
  const result = await headStorage.run(head, fn);
  return { result, head };
}

export function getHeadCollectorContext(): CollectedHead | null {
  return headStorage.getStore() ?? null;
}

export function collectHead(data: Partial<CollectedHead>): void {
  const collected = headStorage.getStore();
  if (!collected) return;

  if (data.title !== undefined) collected.title = data.title;
  if (data.description !== undefined) collected.description = data.description;

  for (const meta of data.metas ?? []) {
    if (meta.name === "description" && meta.content) {
      collected.description = meta.content;
    }
    collected.metas.push(meta);
  }

  if (data.links?.length) collected.links.push(...data.links);
  if (data.styles?.length) collected.styles.push(...data.styles);
  if (data.scripts?.length) collected.scripts.push(...data.scripts);
}

export function hasCollectedHead(): boolean {
  const collected = headStorage.getStore();
  if (!collected) return false;

  return Boolean(
    collected.title ||
      collected.description ||
      collected.metas.length ||
      collected.links.length ||
      collected.styles.length ||
      collected.scripts.length,
  );
}

function clearCollectedHead(store: CollectedHead): void {
  store.title = undefined;
  store.description = undefined;
  store.metas = [];
  store.links = [];
  store.styles = [];
  store.scripts = [];
}

export function resetHeadCollector(): void {
  const store = headStorage.getStore();
  if (!store) return;
  clearCollectedHead(store);
}

export function flushHeadCollector(): CollectedHead {
  const store = headStorage.getStore();
  if (!store) return createEmpty();

  const result: CollectedHead = {
    ...store,
    metas: [...store.metas],
    links: [...store.links],
    styles: [...store.styles],
    scripts: [...store.scripts],
  };

  clearCollectedHead(store);
  return result;
}
