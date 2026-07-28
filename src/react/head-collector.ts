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

interface HeadScript {
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

export const HEAD_COLLECTOR_SYMBOL = Symbol.for("veryfront.react.collect-head");
const HEAD_COLLECTOR_STATE_SYMBOL = Symbol.for(
  "veryfront.react.head-collector-state.v1",
);

/**
 * Head tags that are single-valued per the HTML / Open Graph / Twitter-card
 * specs — a document has exactly one canonical URL, one title, one `og:title`,
 * one robots directive, and so on. For these keys a later (page) tag overrides
 * an earlier (layout) tag with the same key, honouring the documented
 * page-over-layout contract.
 *
 * Every *other* tag accumulates, and accumulate is the deliberate safe default:
 * `rel` values and OG property namespaces are open-ended and full of
 * legitimately-repeatable tags (`og:image`, `<link rel="preload">`, `hreflang`
 * alternates, `rel="me"`, the vertical `article:` / `video:` / `music:`
 * namespaces). Mis-classifying an unlisted key as single-valued would silently
 * drop valid metadata; mis-classifying an unlisted single-valued key as
 * repeatable merely leaves a duplicate — the pre-existing behaviour, never data
 * loss. So we enumerate the small, closed singleton set and default the
 * open-ended rest to accumulate.
 */
const SINGLETON_META_KEYS = new Set<string>([
  // Standard HTML metas
  "description",
  "robots",
  "viewport",
  "referrer",
  "color-scheme",
  "application-name",
  "generator",
  // Open Graph — single-valued core
  "og:title",
  "og:description",
  "og:url",
  "og:type",
  "og:site_name",
  "og:locale",
  // Twitter cards — one per document
  "twitter:card",
  "twitter:site",
  "twitter:creator",
  "twitter:title",
  "twitter:description",
  "twitter:image",
  "twitter:image:alt",
]);

const SINGLETON_LINK_RELS = new Set<string>([
  "canonical",
  "manifest",
  "amphtml",
]);

/** The dedupe key for a meta: `property` (og/twitter) or `name`, else none. */
function metaKey(meta: HeadMeta): string | undefined {
  return meta.property ?? meta.name ?? undefined;
}

function createEmpty(): CollectedHead {
  return { metas: [], links: [], styles: [], scripts: [] };
}

type HeadCollector = (data: Partial<CollectedHead>) => void;

interface HeadCollectorState {
  readonly storage: AsyncLocalStorage<CollectedHead>;
  readonly collect: HeadCollector;
}

function createHeadCollectorState(): HeadCollectorState {
  const storage = new AsyncLocalStorage<CollectedHead>();
  function collectHead(data: Partial<CollectedHead>): void {
    const collected = storage.getStore();
    if (!collected) return;

    if (data.title !== undefined) collected.title = data.title;
    if (data.description !== undefined) collected.description = data.description;

    for (const meta of data.metas ?? []) {
      if (meta.name === "description" && meta.content) {
        collected.description = meta.content;
      }
      const key = metaKey(meta);
      // Single-valued keys override the earlier (layout) tag; every other key
      // (and keyless metas) accumulates.
      if (key && SINGLETON_META_KEYS.has(key)) {
        const idx = collected.metas.findIndex((m) => metaKey(m) === key);
        if (idx !== -1) {
          collected.metas[idx] = meta;
          continue;
        }
      }
      collected.metas.push(meta);
    }

    for (const link of data.links ?? []) {
      const rel = link.rel;
      // A single-valued `rel` (canonical, manifest, …) overrides the earlier
      // tag; every other rel (stylesheet, preload, icon, alternate, …) accumulates.
      if (rel && SINGLETON_LINK_RELS.has(rel)) {
        const idx = collected.links.findIndex((l) => l.rel === rel);
        if (idx !== -1) {
          collected.links[idx] = link;
          continue;
        }
      }
      collected.links.push(link);
    }
    if (data.styles?.length) collected.styles.push(...data.styles);
    for (const script of data.scripts ?? []) {
      // Dedupe by id or src
      const isDupe = collected.scripts.some((s) =>
        (script.id && s.id === script.id) ||
        (script.src && s.src === script.src)
      );
      if (!isDupe) collected.scripts.push(script);
    }
  }

  return { storage, collect: collectHead };
}

const globalHeadCollectorState = globalThis as typeof globalThis & {
  [HEAD_COLLECTOR_STATE_SYMBOL]?: HeadCollectorState;
};
const headCollectorState = globalHeadCollectorState[HEAD_COLLECTOR_STATE_SYMBOL] ??=
  createHeadCollectorState();
const headStorage = headCollectorState.storage;

/**
 * Collects metadata into the current request context.
 *
 * The shared function identity is intentional: server bundles can evaluate this
 * module through more than one URL, and every copy must dispatch into the same
 * request-scoped storage.
 */
export const collectHead: HeadCollector = headCollectorState.collect;

const globalHeadCollector = globalThis as typeof globalThis & {
  [HEAD_COLLECTOR_SYMBOL]?: HeadCollector;
};
globalHeadCollector[HEAD_COLLECTOR_SYMBOL] = collectHead;

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
