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
import {
  aggregateManagedHeadDescriptors,
  assertManagedHeadDescriptorBudget,
  headLinkSingletonKeyFromRecord,
  headMetaSingletonKeyFromRecord,
  headScriptKeysIntersect,
  inspectManagedHeadPayload,
  type ManagedHeadDescriptor,
  MAX_MANAGED_HEAD_BYTES,
  MAX_MANAGED_HEAD_ENTRIES,
  MAX_MANAGED_HEAD_PAYLOAD_BYTES,
  scriptIdentityKeysFromRecord,
} from "#veryfront/html/managed-head-protocol.ts";
import type { ServerRenderContextValue } from "./server-render-context.ts";

export interface HeadMeta {
  name?: string;
  property?: string;
  content?: string;
  [key: string]: string | undefined;
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

export interface HeadStyle {
  content: string;
  [key: string]: string | undefined;
}

export interface CollectedHead {
  title?: string;
  description?: string;
  metas: HeadMeta[];
  links: HeadLink[];
  styles: Array<string | HeadStyle>;
  /** Blocking scripts - injected at top of <head> before CSS */
  scripts: HeadScript[];
}

export const HEAD_COLLECTOR_SYMBOL = Symbol.for("veryfront.react.collect-head");
const HEAD_COLLECTOR_STATE_SYMBOL = Symbol.for(
  "veryfront.react.head-collector-state.v2",
);
const HEAD_RENDER_NONCE_SYMBOL = Symbol.for(
  "veryfront.react.head-render-nonce.v1",
);
const HEAD_RENDER_REGISTRATIONS_SYMBOL = Symbol.for(
  "veryfront.react.head-render-registrations.v1",
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
function createEmpty(): CollectedHead {
  return { metas: [], links: [], styles: [], scripts: [] };
}

type HeadCollector = (data: Partial<CollectedHead>) => void;
interface RegisteredHeadPayload {
  readonly token: string;
  readonly descriptors: readonly ManagedHeadDescriptor[];
}

interface HeadRegistrationState {
  readonly byPayload: Map<string, RegisteredHeadPayload>;
  readonly byToken: Map<string, RegisteredHeadPayload>;
  entryCount: number;
  descriptorBytes: number;
  payloadBytes: number;
}

interface HeadCollectorState {
  readonly storage: AsyncLocalStorage<HeadCollectorContext>;
  readonly collect: HeadCollector;
}

type HeadCollectorContext = CollectedHead & {
  /** Response-scoped CSP nonce available while React owns the render call. */
  readonly [HEAD_RENDER_NONCE_SYMBOL]?: string;
  /** Payloads registered by Head instances during this render only. */
  readonly [HEAD_RENDER_REGISTRATIONS_SYMBOL]: HeadRegistrationState;
};

function collectInto(
  collected: CollectedHead,
  data: Partial<CollectedHead>,
): void {
  if (data.title !== undefined) collected.title = data.title;
  if (data.description !== undefined) collected.description = data.description;

  for (const meta of data.metas ?? []) {
    const singletonKey = headMetaSingletonKeyFromRecord(meta);
    if (singletonKey === "meta:description") {
      collected.description = meta.content ?? "";
    }
    // Single-valued keys override the earlier (layout) tag; every other key
    // (and keyless metas) accumulates.
    if (singletonKey) {
      const idx = collected.metas.findIndex((existing) =>
        headMetaSingletonKeyFromRecord(existing) === singletonKey
      );
      if (idx !== -1) {
        collected.metas[idx] = meta;
        continue;
      }
    }
    collected.metas.push(meta);
  }

  for (const link of data.links ?? []) {
    const singletonKey = headLinkSingletonKeyFromRecord(link);
    // A single-valued `rel` (canonical, manifest, …) overrides the earlier
    // tag; every other rel (stylesheet, preload, icon, alternate, …) accumulates.
    if (singletonKey) {
      const idx = collected.links.findIndex((existing) =>
        headLinkSingletonKeyFromRecord(existing) === singletonKey
      );
      if (idx !== -1) {
        collected.links[idx] = link;
        continue;
      }
    }
    collected.links.push(link);
  }
  if (data.styles?.length) collected.styles.push(...data.styles);
  for (const script of data.scripts ?? []) {
    const incomingKeys = scriptIdentityKeysFromRecord(script);
    const isDupe = incomingKeys.length > 0 &&
      collected.scripts.some((existing) =>
        headScriptKeysIntersect(
          scriptIdentityKeysFromRecord(existing),
          incomingKeys,
        )
      );
    if (!isDupe) collected.scripts.push(script);
  }
}

function collectDescriptors(
  collected: CollectedHead,
  descriptors: readonly ManagedHeadDescriptor[],
): void {
  for (const descriptor of descriptors) {
    const attributes = Object.fromEntries(descriptor.attributes);
    switch (descriptor.tagName) {
      case "title":
        collectInto(collected, { title: descriptor.content ?? "" });
        break;
      case "meta":
        collectInto(collected, { metas: [attributes] });
        break;
      case "link":
        collectInto(collected, { links: [attributes] });
        break;
      case "style":
        collectInto(collected, {
          styles: [
            descriptor.attributes.length === 0
              ? descriptor.content ?? ""
              : { ...attributes, content: descriptor.content ?? "" },
          ],
        });
        break;
      case "script":
        collectInto(collected, {
          scripts: [{
            ...attributes,
            ...(descriptor.content !== undefined && { content: descriptor.content }),
          }],
        });
        break;
    }
  }
}

function createRegistrationState(): HeadRegistrationState {
  return {
    byPayload: new Map(),
    byToken: new Map(),
    entryCount: 0,
    descriptorBytes: 0,
    payloadBytes: 0,
  };
}

function createCommitToken(registrations: HeadRegistrationState): string {
  for (let attempt = 0; attempt < 4; attempt++) {
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    if (!registrations.byToken.has(token)) return token;
  }
  throw new TypeError("Unable to allocate a unique managed-head commit token");
}

function createHeadCollectorState(): HeadCollectorState {
  const storage = new AsyncLocalStorage<HeadCollectorContext>();
  const collect: HeadCollector = (data) => {
    const collected = storage.getStore();
    if (collected) collectInto(collected, data);
  };
  return { storage, collect };
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

function registerPayloadForContext(
  context: HeadCollectorContext,
  payload: string,
): string {
  const registrations = context[HEAD_RENDER_REGISTRATIONS_SYMBOL];
  const existing = registrations.byPayload.get(payload);
  if (existing) return existing.token;

  const inspected = inspectManagedHeadPayload(payload);
  const nextEntryCount = registrations.entryCount + inspected.entryCount;
  const nextDescriptorBytes = registrations.descriptorBytes + inspected.descriptorBytes;
  const nextPayloadBytes = registrations.payloadBytes + inspected.payloadBytes;
  if (nextEntryCount > MAX_MANAGED_HEAD_ENTRIES) {
    throw new TypeError(
      `Managed head exceeds the ${MAX_MANAGED_HEAD_ENTRIES}-entry request limit`,
    );
  }
  if (nextDescriptorBytes > MAX_MANAGED_HEAD_BYTES) {
    throw new TypeError(
      `Managed head exceeds the ${MAX_MANAGED_HEAD_BYTES}-byte request limit`,
    );
  }
  if (nextPayloadBytes > MAX_MANAGED_HEAD_PAYLOAD_BYTES) {
    throw new TypeError(
      `Managed head exceeds the ${MAX_MANAGED_HEAD_PAYLOAD_BYTES}-byte payload request limit`,
    );
  }
  if (registrations.byPayload.size >= MAX_MANAGED_HEAD_ENTRIES) {
    throw new TypeError(
      `Managed head exceeds the ${MAX_MANAGED_HEAD_ENTRIES}-registration request limit`,
    );
  }

  const token = createCommitToken(registrations);
  const registration = { token, descriptors: inspected.descriptors };
  registrations.byPayload.set(payload, registration);
  registrations.byToken.set(token, registration);
  registrations.entryCount = nextEntryCount;
  registrations.descriptorBytes = nextDescriptorBytes;
  registrations.payloadBytes = nextPayloadBytes;
  return token;
}

export async function runWithHeadCollector<T>(
  fn: (renderContext: ServerRenderContextValue) => T | Promise<T>,
  options: { nonce?: string } = {},
): Promise<{ result: T; head: CollectedHead }> {
  const head = createEmpty() as HeadCollectorContext;
  Object.defineProperty(head, HEAD_RENDER_REGISTRATIONS_SYMBOL, {
    value: createRegistrationState(),
    enumerable: false,
  });
  if (options.nonce) {
    Object.defineProperty(head, HEAD_RENDER_NONCE_SYMBOL, {
      value: options.nonce,
      enumerable: false,
    });
  }
  const renderContext = Object.freeze<ServerRenderContextValue>({
    ...(options.nonce ? { nonce: options.nonce } : {}),
    registerHeadPayload: (payload) => registerPayloadForContext(head, payload),
  });
  const result = await headStorage.run(head, () => fn(renderContext));
  return { result, head };
}

export function getHeadCollectorContext(): CollectedHead | null {
  return headStorage.getStore() ?? null;
}

/**
 * Return the nonce bound to the active server render. Browser builds use the
 * no-op async-context polyfill, so this never exposes a nonce outside SSR.
 */
export function getHeadCollectorNonce(): string | undefined {
  return headStorage.getStore()?.[HEAD_RENDER_NONCE_SYMBOL];
}

/**
 * Materialize only Head payloads whose server-only commit token appears in the
 * completed React HTML. Tokens and payloads are bound to `head`'s render
 * context, so ordinary SSR markup cannot manufacture trusted head entries.
 */
export function resolveCommittedHeadRegistrations(
  head: CollectedHead,
  commitTokens: readonly string[],
): CollectedHead {
  const resolved = createEmpty();
  collectInto(resolved, head);

  const registrations = (head as HeadCollectorContext)[HEAD_RENDER_REGISTRATIONS_SYMBOL];
  if (!registrations || commitTokens.length === 0) return resolved;

  const descriptors: ManagedHeadDescriptor[] = [];
  for (const token of commitTokens) {
    const registration = registrations.byToken.get(token);
    if (registration) descriptors.push(...registration.descriptors);
  }
  const committed = aggregateManagedHeadDescriptors(descriptors);
  assertManagedHeadDescriptorBudget(committed);
  collectDescriptors(resolved, committed);
  return resolved;
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

  const registrations = (store as HeadCollectorContext)[HEAD_RENDER_REGISTRATIONS_SYMBOL];
  if (registrations) {
    registrations.byPayload.clear();
    registrations.byToken.clear();
    registrations.entryCount = 0;
    registrations.descriptorBytes = 0;
    registrations.payloadBytes = 0;
  }
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
