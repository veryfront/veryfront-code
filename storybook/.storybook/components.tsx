import LinkTo from "@storybook/addon-links/react";
import * as React from "react";
import { cn } from "./docs/cn";
import { DocsH3, DocsH4, renderInlineCode } from "./docs/markdown";

/**
 * Shared layout components for brand and overview story pages.
 * These ensure consistent structure across all design system pages.
 *
 * Studio's version pulls `Card`/`Text` from `@/components` and `@/studio`
 * (banned here). Those primitives are reimplemented inline below as plain,
 * token-styled elements so the page/grid kit stays dependency-free.
 */

/** Lead/body text. Replaces Studio's `Text` primitive. */
function Text({
  children,
  size = "md",
  weight,
  tone,
  className,
}: {
  children: React.ReactNode;
  size?: "xs" | "sm" | "md" | "lg";
  weight?: "normal" | "medium";
  tone?: "default" | "meta";
  className?: string;
}) {
  // Faithful to Studio's Text: tone `default` is always `text-foreground` —
  // the design system has no grey-by-size hierarchy; only `meta` is muted.
  const sizeClass = {
    xs: "text-xs",
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
  }[size];
  return (
    <p
      className={cn(
        sizeClass,
        weight === "medium" ? "font-medium" : "font-normal",
        tone === "meta" ? "text-faint" : "text-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Action card — Studio's `<Card chevron>` (compact + solid surface) wrapping
 *  a `<CardTitle size="md">`, expressed with the exact resolved classes (cva /
 *  Radix are unavailable here). Solid surface is `bg-secondary` with a
 *  transparent border (no visible outline) and no shadow; radius is `lg`. */
function NavCard(
  { title, chevron }: { title: string; chevron?: boolean },
): React.ReactElement {
  return (
    <div className="group flex w-full items-start gap-3 overflow-hidden rounded-lg border border-transparent bg-secondary px-4 pt-3 pb-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-base font-medium leading-tight text-foreground">
          {title}
        </div>
      </div>
      {chevron && (
        <svg
          className="size-4 shrink-0 self-center text-foreground opacity-60 transition group-hover:opacity-100 group-hover:translate-x-0.5"
          width="1em"
          height="1em"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      )}
    </div>
  );
}

/** Full-page wrapper with background and min-height. */
export function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="max-w-5xl mx-auto px-8 pb-20">{children}</div>
    </div>
  );
}

/** Hero section at the top of each page. */
export function PageHero({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("py-20 border-b border-edge", className)}>
      {children}
      <h1 className="text-2xl font-semibold tracking-tight mb-3">{title}</h1>
      <Text size="lg" className="max-w-xl">
        {renderInlineCode(description)}
      </Text>
    </div>
  );
}

export type NavGridEntry = { title: string; id: string };

/** Action-card grid used by Introduction and per-product Overview pages. */
export function NavGrid({ pages }: { pages: NavGridEntry[] }) {
  if (pages.length === 0) {
    return <p className="text-base text-muted-foreground">No matches.</p>;
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
      {pages.map((page) => {
        const [kind, story = "docs"] = page.id.split("--");
        return (
          <div
            key={page.title}
            className="[&_a]:no-underline [&_a]:block"
          >
            <LinkTo kind={kind} story={story}>
              <NavCard title={page.title} chevron />
            </LinkTo>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Count unique parent directories matched by a Vite `import.meta.glob` result.
 * Use to surface automatic, drift-free counts on inventory pages — one count
 * per component folder regardless of how many stories/test files it has.
 */
export function useGlobDirCount(glob: Record<string, unknown>): number {
  const dirs = new Set<string>();
  for (const path of Object.keys(glob)) {
    const parts = path.split("/");
    if (parts.length >= 2) dirs.add(parts.slice(0, -1).join("/"));
  }
  return dirs.size;
}

/** Content section with title, optional description, and divider. */
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-16 border-b border-edge last:border-b-0">
      <h2
        className={cn(
          "text-xl font-medium tracking-tight",
          description ? "mb-2" : "mb-10",
        )}
      >
        {title}
      </h2>
      {description && (
        <Text className="mb-10">{renderInlineCode(description)}</Text>
      )}
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------------------------------
 * Chrome system — shared primitives every brand and inventory story uses.
 *
 * Two rules govern this system:
 *   1. Grey is never applied below 16px (no muted tones on `size="xs"` / `size="sm"`).
 *   2. Sub-group titles inside a Section are visible Headings, not muted captions.
 * -------------------------------------------------------------------------------------------------*/

/** Visible sub-group title inside a Section. Renders identically to `### hello`. */
export function Subheading(
  { children, className }: {
    children: React.ReactNode;
    className?: string;
  },
) {
  return <DocsH3 className={cn("mt-0", className)}>{children}</DocsH3>;
}

/** Smaller subheading. Renders identically to `#### hello`. */
export function Subsubheading(
  { children, className }: {
    children: React.ReactNode;
    className?: string;
  },
) {
  return <DocsH4 className={cn("mt-0", className)}>{children}</DocsH4>;
}

/** Muted chrome paragraph. Always 16px (md) so soft tone stays legible. */
export function Caption(
  { children, className }: {
    children: React.ReactNode;
    className?: string;
  },
) {
  return <Text className={className}>{children}</Text>;
}

/** Small visible label above a value. Default tone — never grey under 16px. */
export function FieldLabel(
  { children, className }: {
    children: React.ReactNode;
    className?: string;
  },
) {
  return (
    <Text size="sm" weight="medium" className={cn("mb-1", className)}>
      {children}
    </Text>
  );
}

/** Label + content pair for typeface details, swatch metadata, etc. */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

/** Caption block under a swatch / specimen / radius card. */
export function SwatchCaption({
  name,
  description,
  meta,
  className,
}: {
  name: string;
  description?: string;
  meta?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Text weight="medium">{name}</Text>
      {description && <Caption>{renderInlineCode(description)}</Caption>}
      {meta && <Caption>{renderInlineCode(meta)}</Caption>}
    </div>
  );
}

/** Tiny inline measurement label (e.g. "28px", "1x"). Always default tone. */
export function MeasureLabel(
  { children, className }: {
    children: React.ReactNode;
    className?: string;
  },
) {
  return (
    <Text size="xs" weight="medium" className={className}>
      {children}
    </Text>
  );
}
