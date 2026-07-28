import type { CollectedHead } from "#veryfront/react/head-collector.ts";
import type { MdxBundle } from "#veryfront/types";
import type { MDXFrontmatter } from "#veryfront/transforms/mdx/types.ts";
import {
  BOOLEAN_HEAD_ATTRIBUTES,
  HEAD_PROVENANCE_ATTRIBUTE,
  headLinkSingletonKeyFromRecord,
  headMetaSingletonKeyFromRecord,
  headScriptKeysIntersect,
  isHeadFrameworkAttribute,
  managedHeadContentHash,
  normalizeManagedHeadString,
  scriptIdentityKeysFromRecord,
} from "#veryfront/html/managed-head-protocol.ts";
import {
  buildAttributes,
  escapeInlineScriptContent,
  escapeInlineStyleContent,
} from "#veryfront/html/html-escape.ts";
import { toHTMLFrontmatter } from "../frontmatter.ts";

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

export function buildHeadElements(head?: CollectedHead): { scripts: string; other: string } {
  if (!head) return { scripts: "", other: "" };

  const scriptParts: string[] = [];
  const otherParts: string[] = [];

  for (const script of head.scripts ?? []) {
    const { content, ...attrs } = script;
    const attrPairs: [string, string][] = [[HEAD_PROVENANCE_ATTRIBUTE, "true"]];

    for (const [k, v] of Object.entries(attrs)) {
      const normalizedKey = k.toLowerCase();
      if (
        v != null &&
        !/^on/i.test(normalizedKey) &&
        !isHeadFrameworkAttribute(normalizedKey)
      ) {
        attrPairs.push([k, v]);
      }
    }

    if (content !== undefined && !attrs.id) {
      attrPairs.push(["data-vf-hash", managedHeadContentHash(content)]);
    }

    const attrStr = buildAttributes(Object.fromEntries(attrPairs));
    scriptParts.push(
      `<script ${attrStr}>${
        content === undefined ? "" : escapeInlineScriptContent(content)
      }</script>`,
    );
  }

  const metas = (head.description !== undefined &&
      !head.metas.some((meta) => headMetaSingletonKeyFromRecord(meta) === "meta:description")
    ? [{ name: "description", content: head.description }, ...head.metas]
    : head.metas).filter((meta) => !hasCharsetAttribute(meta));
  for (const meta of metas) {
    const attrs: [string, string][] = [[HEAD_PROVENANCE_ATTRIBUTE, "true"]];
    for (const [key, value] of Object.entries(meta)) {
      const normalizedKey = key.toLowerCase();
      if (
        value !== undefined &&
        !/^on/i.test(normalizedKey) &&
        !isHeadFrameworkAttribute(normalizedKey)
      ) {
        attrs.push([key, value]);
      }
    }
    if (attrs.length > 1) {
      otherParts.push(`<meta ${buildAttributes(Object.fromEntries(attrs))}>`);
    }
  }

  for (const link of head.links) {
    const linkAttrs = Object.fromEntries(
      Object.entries(link)
        .filter(([key, value]) => {
          const normalizedKey = key.toLowerCase();
          return value != null &&
            !/^on/i.test(normalizedKey) &&
            !isHeadFrameworkAttribute(normalizedKey);
        })
        .map(([k, v]) => [k, String(v)]),
    );
    if (Object.keys(linkAttrs).length === 0) continue;
    const attrs = { [HEAD_PROVENANCE_ATTRIBUTE]: "true", ...linkAttrs };
    const attrStr = buildAttributes(attrs);
    otherParts.push(`<link ${attrStr}>`);
  }

  for (const style of head.styles) {
    const { content, ...rawAttributes } = typeof style === "string" ? { content: style } : style;
    const attributes = Object.fromEntries(
      Object.entries(rawAttributes).filter(([key, value]) =>
        value !== undefined &&
        !/^on/i.test(key) &&
        !isHeadFrameworkAttribute(key)
      ),
    );
    const attrStr = buildAttributes({
      [HEAD_PROVENANCE_ATTRIBUTE]: "true",
      ...attributes,
    });
    otherParts.push(
      `<style ${attrStr}>${escapeInlineStyleContent(content)}</style>`,
    );
  }

  return {
    scripts: scriptParts.join("\n  "),
    other: otherParts.join("\n  "),
  };
}

export function mergeFrontmatter(context: FrontmatterContextLike): MDXFrontmatter {
  return toHTMLFrontmatter({
    ...toHTMLFrontmatter(context.pageInfo.entity.frontmatter),
    ...toHTMLFrontmatter(context.pageBundle.frontmatter),
    ...toHTMLFrontmatter(context.collectedMetadata),
  });
}
