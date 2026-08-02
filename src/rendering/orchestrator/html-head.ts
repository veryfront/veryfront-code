import {
  type CollectedHead,
  resolveCommittedHeadRegistrations,
} from "#veryfront/react/head-collector.ts";
import type { MdxBundle } from "#veryfront/types";
import type { MDXFrontmatter } from "#veryfront/transforms/mdx/types.ts";
import {
  BOOLEAN_HEAD_ATTRIBUTES,
  descriptorFromManagedHeadRecord,
  HEAD_PROVENANCE_ATTRIBUTE,
  HEAD_REACT_OWNER_ATTRIBUTE,
  HEAD_SERVER_COMMIT_ATTRIBUTE,
  headLinkSingletonKeyFromRecord,
  headMetaSingletonKeyFromRecord,
  headScriptKeysIntersect,
  isHeadFrameworkAttribute,
  type ManagedHeadAttribute,
  managedHeadContentHash,
  type ManagedHeadDescriptor,
  normalizeManagedHeadString,
  scriptIdentityKeysFromRecord,
} from "#veryfront/html/managed-head-protocol.ts";
import {
  buildAttributes,
  escapeInlineScriptContent,
  escapeInlineStyleContent,
} from "#veryfront/html/html-escape.ts";

interface FrontmatterContextLike {
  pageInfo: { entity: { frontmatter?: Record<string, unknown> } };
  pageBundle: Pick<MdxBundle, "frontmatter">;
  collectedMetadata?: Record<string, unknown>;
}

export interface MergedHeadShellState {
  readonly frontmatter: MDXFrontmatter;
  readonly emissionHead: CollectedHead | undefined;
  readonly marksViewport: boolean;
}

type HeadRecord = Readonly<Record<string, string | undefined>>;

export function resolveCommittedHeadFromHTML(
  html: string,
  requestHead: CollectedHead | undefined,
): CollectedHead | undefined {
  if (!requestHead) return undefined;

  const commitTokens: string[] = [];
  for (const match of html.matchAll(/<div\b[^>]*>/gi)) {
    const openingTag = match[0];
    if (
      !new RegExp(`\\s${HEAD_REACT_OWNER_ATTRIBUTE}=["']1["']`, "i").test(openingTag) ||
      !/\sdata-veryfront-head=["']1["']/i.test(openingTag)
    ) {
      continue;
    }
    const tokenMatch = openingTag.match(
      new RegExp(`\\s${HEAD_SERVER_COMMIT_ATTRIBUTE}=["']([a-f0-9]{48})["']`, "i"),
    );
    if (tokenMatch?.[1]) commitTokens.push(tokenMatch[1].toLowerCase());
  }
  return resolveCommittedHeadRegistrations(requestHead, commitTokens);
}

function canonicalHeadRecordSignature(
  record: HeadRecord,
  options: { readonly ignoreNonce?: boolean } = {},
): string {
  const normalized = new Map<string, string>();
  for (const [rawName, value] of Object.entries(record)) {
    if (value === undefined) continue;
    const name = rawName.toLowerCase();
    if (
      /^on/i.test(name) ||
      isHeadFrameworkAttribute(name) ||
      (options.ignoreNonce && name === "nonce")
    ) {
      continue;
    }

    const parsedValue = normalizeManagedHeadString(value);
    const normalizedValue = BOOLEAN_HEAD_ATTRIBUTES.has(name) ? "" : name === "name" ||
        name === "property" ||
        name === "rel" ||
        name === "charset"
      ? parsedValue.trim().toLowerCase()
      : parsedValue;
    normalized.set(name, normalizedValue);
  }
  return JSON.stringify(
    [...normalized.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function canonicalHeadLinkSignature(link: HeadRecord): string {
  const hasCrossOrigin = Object.keys(link).some((name) => name.toLowerCase() === "crossorigin");
  if (
    link.rel?.trim().toLowerCase() === "preload" &&
    link.as?.trim().toLowerCase() === "font" &&
    !hasCrossOrigin
  ) {
    return canonicalHeadRecordSignature({
      ...link,
      crossorigin: "anonymous",
    });
  }
  return canonicalHeadRecordSignature(link);
}

function hasCharsetAttribute(meta: HeadRecord): boolean {
  return Object.keys(meta).some((name) => name.toLowerCase() === "charset");
}

function styleRecord(
  style: CollectedHead["styles"][number],
): HeadRecord {
  return typeof style === "string" ? { content: style } : style;
}

/**
 * Merge semantic singletons before either serializer runs. The shell keeps
 * permanent charset ownership; collected Head supplies exact title and
 * metadata descriptors for every other declared node. Filtering losing and
 * output-equivalent structured entries here guarantees one authoritative SSR
 * node for hydration.
 */
export function mergeCollectedHeadWithShell(
  frontmatter: MDXFrontmatter,
  layoutFrontmatter: MDXFrontmatter,
  head: CollectedHead | undefined,
): MergedHeadShellState {
  if (!head) {
    return { frontmatter, emissionHead: undefined, marksViewport: false };
  }

  const managedMetas = head.metas.filter((meta) => !hasCharsetAttribute(meta));
  const collectedMetaKeys = new Set(
    managedMetas
      .map(headMetaSingletonKeyFromRecord)
      .filter((key): key is string => key !== undefined),
  );
  if (head.description !== undefined) collectedMetaKeys.add("meta:description");
  const collectedMetaSignatures = new Set(
    managedMetas.map((meta) => canonicalHeadRecordSignature(meta)),
  );

  const collectedLinkRels = new Set(
    head.links
      .map(headLinkSingletonKeyFromRecord)
      .filter((key): key is string => key !== undefined),
  );
  const collectedLinkSignatures = new Set(
    head.links.map(canonicalHeadLinkSignature),
  );
  const collectedScriptKeys = head.scripts.flatMap((script) =>
    scriptIdentityKeysFromRecord(script)
  );
  const collectedAnonymousScriptSignatures = new Set(
    head.scripts
      .filter((script) => scriptIdentityKeysFromRecord(script).length === 0)
      .map((script) => canonicalHeadRecordSignature(script, { ignoreNonce: true })),
  );
  const collectedStyleSignatures = new Set(
    head.styles.map((style) =>
      canonicalHeadRecordSignature(styleRecord(style), {
        ignoreNonce: true,
      })
    ),
  );

  const viewport = managedMetas.find((meta) =>
    headMetaSingletonKeyFromRecord(meta) === "meta:viewport"
  );
  const description = head.description ??
    managedMetas.find((meta) => headMetaSingletonKeyFromRecord(meta) === "meta:description")
      ?.content;
  const ownsDefaultThemeColor = collectedMetaKeys.has("meta:theme-color:");

  const effectiveMeta = frontmatter.meta ?? layoutFrontmatter.meta;
  const existingMeta = managedMetas.length > 0 && Array.isArray(effectiveMeta)
    ? effectiveMeta.filter((meta) => {
      const singletonKey = headMetaSingletonKeyFromRecord(meta);
      return (
        !singletonKey || !collectedMetaKeys.has(singletonKey)
      ) && !collectedMetaSignatures.has(canonicalHeadRecordSignature(meta));
    })
    : undefined;
  const effectiveLinks = frontmatter.links ?? layoutFrontmatter.links;
  const existingLinks = head.links.length > 0 && Array.isArray(effectiveLinks)
    ? effectiveLinks.filter((link) => {
      const singletonKey = headLinkSingletonKeyFromRecord(link);
      return (
        !singletonKey || !collectedLinkRels.has(singletonKey)
      ) && !collectedLinkSignatures.has(canonicalHeadLinkSignature(link));
    })
    : undefined;
  const effectiveIcons = frontmatter.icons ?? layoutFrontmatter.icons;
  const existingIcons = head.links.length > 0 && Array.isArray(effectiveIcons)
    ? effectiveIcons.filter((icon) =>
      !collectedLinkSignatures.has(
        canonicalHeadLinkSignature({
          ...icon,
          rel: icon.rel || "icon",
        }),
      )
    )
    : undefined;
  const effectiveStyles = frontmatter.styles ?? layoutFrontmatter.styles;
  const existingStyles = (head.links.length > 0 || head.styles.length > 0) &&
      Array.isArray(effectiveStyles)
    ? effectiveStyles.filter((style) => {
      if (style.href) {
        const { content: _content, rel: _rel, ...attributes } = style;
        return !collectedLinkSignatures.has(
          canonicalHeadLinkSignature({
            rel: "stylesheet",
            ...attributes,
          }),
        );
      }
      return !collectedStyleSignatures.has(
        canonicalHeadRecordSignature(style, { ignoreNonce: true }),
      );
    })
    : undefined;
  const effectiveScripts = frontmatter.scripts ?? layoutFrontmatter.scripts;
  const existingScripts = head.scripts.length > 0 && Array.isArray(effectiveScripts)
    ? effectiveScripts.filter((script) => {
      const keys = scriptIdentityKeysFromRecord(script);
      if (headScriptKeysIntersect(keys, collectedScriptKeys)) return false;
      return keys.length > 0 ||
        !collectedAnonymousScriptSignatures.has(
          canonicalHeadRecordSignature(script, { ignoreNonce: true }),
        );
    })
    : undefined;

  const filteredSocial = (
    prefix: "og" | "twitter",
    value: MDXFrontmatter["og"] | MDXFrontmatter["twitter"],
  ): typeof value => {
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).filter(([key, content]) => {
        const semanticKey = `meta:${prefix}:${key.toLowerCase()}`;
        const record = prefix === "og"
          ? { property: `${prefix}:${key}`, content: String(content) }
          : { name: `${prefix}:${key}`, content: String(content) };
        return !collectedMetaKeys.has(semanticKey) &&
          !collectedMetaSignatures.has(
            canonicalHeadRecordSignature(record),
          );
      }),
    );
  };

  return {
    frontmatter: {
      ...frontmatter,
      ...(head.title !== undefined && { title: head.title }),
      ...(description !== undefined && { description }),
      ...(viewport && { viewport: viewport.content ?? "" }),
      ...(ownsDefaultThemeColor && { themeColor: undefined }),
      ...(existingMeta !== undefined && { meta: existingMeta }),
      ...(existingLinks !== undefined && { links: existingLinks }),
      ...(existingIcons !== undefined && { icons: existingIcons }),
      ...(existingStyles !== undefined && { styles: existingStyles }),
      ...(existingScripts !== undefined && { scripts: existingScripts }),
      ...((frontmatter.og ?? layoutFrontmatter.og) && {
        og: filteredSocial("og", frontmatter.og ?? layoutFrontmatter.og),
      }),
      ...((frontmatter.twitter ?? layoutFrontmatter.twitter) && {
        twitter: filteredSocial(
          "twitter",
          frontmatter.twitter ?? layoutFrontmatter.twitter,
        ),
      }),
    },
    emissionHead: {
      ...head,
      metas: managedMetas,
    },
    marksViewport: viewport !== undefined,
  };
}

export function buildHeadElements(
  head?: CollectedHead,
  nonce?: string,
): { scripts: string; other: string } {
  if (!head) return { scripts: "", other: "" };

  const scriptParts: string[] = [];
  const otherParts: string[] = [];

  for (const script of head.scripts ?? []) {
    const descriptor = descriptorFromManagedHeadRecord(
      "script",
      script,
      { contentProperty: "content", ambientNonce: nonce },
    );
    if (!descriptor) continue;
    const attrPairs: ManagedHeadAttribute[] = [
      [HEAD_PROVENANCE_ATTRIBUTE, "true"],
      ...descriptor.attributes,
    ];

    if (
      descriptor.content !== undefined &&
      !descriptor.attributes.some(([name]) => name === "id")
    ) {
      attrPairs.push(["data-vf-hash", managedHeadContentHash(descriptor.content)]);
    }

    const attrStr = buildAttributes(Object.fromEntries(attrPairs));
    scriptParts.push(
      `<script ${attrStr}>${
        descriptor.content === undefined ? "" : escapeInlineScriptContent(descriptor.content)
      }</script>`,
    );
  }

  const metas = (head.description !== undefined &&
      !head.metas.some((meta) => headMetaSingletonKeyFromRecord(meta) === "meta:description")
    ? [{ name: "description", content: head.description }, ...head.metas]
    : head.metas).filter((meta) => !hasCharsetAttribute(meta));
  for (const meta of metas) {
    const descriptor = descriptorFromManagedHeadRecord("meta", meta);
    if (!descriptor) continue;
    const attrs: ManagedHeadAttribute[] = [
      [HEAD_PROVENANCE_ATTRIBUTE, "true"],
      ...descriptor.attributes,
    ];
    otherParts.push(`<meta ${buildAttributes(Object.fromEntries(attrs))}>`);
  }

  for (const link of head.links) {
    const descriptor = descriptorFromManagedHeadRecord("link", link);
    if (!descriptor) continue;
    const attrStr = buildAttributes(Object.fromEntries([
      [HEAD_PROVENANCE_ATTRIBUTE, "true"],
      ...descriptor.attributes,
    ]));
    otherParts.push(`<link ${attrStr}>`);
  }

  for (const style of head.styles) {
    const descriptor = descriptorFromManagedHeadRecord(
      "style",
      typeof style === "string" ? { content: style } : style,
      { contentProperty: "content", ambientNonce: nonce },
    );
    if (!descriptor) continue;
    const attrStr = buildAttributes(Object.fromEntries([
      [HEAD_PROVENANCE_ATTRIBUTE, "true"],
      ...descriptor.attributes,
    ]));
    otherParts.push(
      `<style ${attrStr}>${escapeInlineStyleContent(descriptor.content ?? "")}</style>`,
    );
  }

  return {
    scripts: scriptParts.join("\n  "),
    other: otherParts.join("\n  "),
  };
}

/**
 * Build the nonce-free transport representation of the committed React head.
 * The browser binds its active nonce when adopting these descriptors; a nonce
 * from one cached response must never become part of the portable payload.
 */
export function buildCollectedHeadDescriptors(
  head?: CollectedHead,
): ManagedHeadDescriptor[] {
  if (!head) return [];

  const descriptors: ManagedHeadDescriptor[] = [];
  const append = (descriptor: ManagedHeadDescriptor | null): void => {
    if (descriptor) descriptors.push(descriptor);
  };

  if (head.title !== undefined) {
    append(
      descriptorFromManagedHeadRecord(
        "title",
        { content: head.title },
        { contentProperty: "content" },
      ),
    );
  }

  const metas = (head.description !== undefined &&
      !head.metas.some((meta) => headMetaSingletonKeyFromRecord(meta) === "meta:description")
    ? [{ name: "description", content: head.description }, ...head.metas]
    : head.metas).filter((meta) => !hasCharsetAttribute(meta));
  for (const meta of metas) append(descriptorFromManagedHeadRecord("meta", meta));
  for (const link of head.links) append(descriptorFromManagedHeadRecord("link", link));
  for (const style of head.styles) {
    append(
      descriptorFromManagedHeadRecord(
        "style",
        typeof style === "string" ? { content: style } : style,
        { contentProperty: "content" },
      ),
    );
  }
  for (const script of head.scripts) {
    append(
      descriptorFromManagedHeadRecord(
        "script",
        script,
        { contentProperty: "content" },
      ),
    );
  }

  return descriptors;
}

export function mergeFrontmatter(context: FrontmatterContextLike): MDXFrontmatter {
  return {
    ...context.pageInfo.entity.frontmatter,
    ...context.pageBundle.frontmatter,
    ...(context.collectedMetadata ?? {}),
  } as MDXFrontmatter;
}
