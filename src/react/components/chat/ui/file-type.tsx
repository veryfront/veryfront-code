/**
 * FileType — ported 1:1 from Veryfront Studio. The canonical file-type
 * identity primitive: one distinct hue per extension. This is the single
 * sanctioned place where Tailwind named-colour utilities live (the per-file-
 * type identity palette) — every other primitive uses `[var(--token)]`. Only
 * the `DEFAULT` style and `vf-type`/`vf-weight` classes are remapped to
 * veryfront's vocabulary. Private to the chat module.
 *
 * Exports the soft-fill `FileType` (lists/tables), the solid-fill
 * `FileTypeThumb` (chip thumbnails), and the `getFileTypeLabel` helper.
 *
 * @module react/components/chat/ui/file-type
 */
import * as React from "react";
import { cn } from "../theme.ts";

interface ExtStyle {
  bg: string;
  text: string;
  /** Solid fill variant for thumb-style badges (AttachmentPill). */
  solid: string;
  label: string;
}

const EXT_STYLES: Record<string, ExtStyle> = {
  // Markdown / docs
  md: { bg: "bg-blue-500/15", text: "text-blue-600 dark:text-blue-400", solid: "bg-blue-500", label: "Markdown" },
  mdx: { bg: "bg-violet-500/15", text: "text-violet-600 dark:text-violet-400", solid: "bg-violet-500", label: "MDX" },
  txt: { bg: "bg-gray-500/15", text: "text-gray-600 dark:text-gray-400", solid: "bg-gray-500", label: "Text File" },

  // PDFs / Office
  pdf: { bg: "bg-red-500/15", text: "text-red-600 dark:text-red-400", solid: "bg-red-600", label: "PDF Document" },
  doc: { bg: "bg-blue-600/15", text: "text-blue-700 dark:text-blue-300", solid: "bg-blue-600", label: "Word Document" },
  docx: { bg: "bg-blue-600/15", text: "text-blue-700 dark:text-blue-300", solid: "bg-blue-600", label: "Word Document" },
  xls: { bg: "bg-emerald-600/15", text: "text-emerald-700 dark:text-emerald-300", solid: "bg-emerald-600", label: "Excel" },
  xlsx: { bg: "bg-emerald-600/15", text: "text-emerald-700 dark:text-emerald-300", solid: "bg-emerald-600", label: "Excel" },
  ppt: { bg: "bg-orange-600/15", text: "text-orange-700 dark:text-orange-300", solid: "bg-orange-600", label: "PowerPoint" },
  pptx: { bg: "bg-orange-600/15", text: "text-orange-700 dark:text-orange-300", solid: "bg-orange-600", label: "PowerPoint" },

  // Images
  png: { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400", solid: "bg-emerald-500", label: "PNG Image" },
  jpg: { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400", solid: "bg-emerald-500", label: "JPEG Image" },
  jpeg: { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400", solid: "bg-emerald-500", label: "JPEG Image" },
  gif: { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400", solid: "bg-emerald-500", label: "GIF Image" },
  webp: { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400", solid: "bg-emerald-500", label: "WebP Image" },
  svg: { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400", solid: "bg-emerald-500", label: "SVG Image" },

  // Code / data
  js: { bg: "bg-yellow-500/15", text: "text-yellow-700 dark:text-yellow-400", solid: "bg-yellow-600", label: "JavaScript" },
  jsx: { bg: "bg-yellow-500/15", text: "text-yellow-700 dark:text-yellow-400", solid: "bg-yellow-600", label: "JavaScript React" },
  ts: { bg: "bg-blue-500/15", text: "text-blue-600 dark:text-blue-400", solid: "bg-blue-600", label: "TypeScript" },
  tsx: { bg: "bg-blue-500/15", text: "text-blue-600 dark:text-blue-400", solid: "bg-blue-600", label: "TypeScript React" },
  py: { bg: "bg-purple-500/15", text: "text-purple-700 dark:text-purple-300", solid: "bg-purple-600", label: "Python" },
  rb: { bg: "bg-red-500/15", text: "text-red-600 dark:text-red-400", solid: "bg-red-600", label: "Ruby" },
  go: { bg: "bg-cyan-500/15", text: "text-cyan-700 dark:text-cyan-300", solid: "bg-cyan-600", label: "Go" },
  rs: { bg: "bg-orange-500/15", text: "text-orange-700 dark:text-orange-300", solid: "bg-orange-600", label: "Rust" },
  java: { bg: "bg-orange-500/15", text: "text-orange-700 dark:text-orange-300", solid: "bg-orange-600", label: "Java" },
  json: { bg: "bg-amber-500/15", text: "text-amber-700 dark:text-amber-300", solid: "bg-slate-600", label: "JSON" },
  csv: { bg: "bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300", solid: "bg-emerald-600", label: "CSV Data" },
  xml: { bg: "bg-slate-500/15", text: "text-slate-700 dark:text-slate-300", solid: "bg-slate-600", label: "XML" },
  yaml: { bg: "bg-slate-500/15", text: "text-slate-700 dark:text-slate-300", solid: "bg-slate-600", label: "YAML" },
  yml: { bg: "bg-slate-500/15", text: "text-slate-700 dark:text-slate-300", solid: "bg-slate-600", label: "YAML" },
  html: { bg: "bg-orange-500/15", text: "text-orange-700 dark:text-orange-300", solid: "bg-orange-500", label: "HTML" },
};

const DEFAULT: ExtStyle = {
  bg: "bg-[var(--accent)]",
  text: "text-[var(--foreground)]",
  solid: "bg-slate-500",
  label: "File",
};

function lookup(ext: string): ExtStyle {
  return EXT_STYLES[ext.toLowerCase()] ?? DEFAULT;
}

/** Human label for a file extension, falling back to the media type. */
export function getFileTypeLabel(ext: string, mediaType?: string): string {
  return EXT_STYLES[ext.toLowerCase()]?.label ??
    mediaType?.split("/").pop()?.toUpperCase() ?? "File";
}

/** Props accepted by `<FileType>` / `<FileTypeThumb>`. */
export interface FileTypeProps {
  extension: string;
  className?: string;
}

/** Soft-fill badge — rounded square, tinted background, extension label. */
export function FileType(
  { extension, className }: FileTypeProps,
): React.ReactElement {
  const { bg, text } = lookup(extension);
  return (
    <div
      className={cn(
        "size-9 shrink-0 rounded-lg flex items-center justify-center",
        bg,
        className,
      )}
      data-testid="file-type-badge"
    >
      <span className={cn("text-xs font-medium leading-none", text)}>
        {extension.toUpperCase()}
      </span>
    </div>
  );
}

/** Solid-fill thumbnail — full-saturation square with white `.ext` text. */
export function FileTypeThumb(
  { extension, className }: FileTypeProps,
): React.ReactElement {
  const { solid } = lookup(extension);
  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-md text-xs font-medium text-white",
        solid,
        className,
      )}
      data-testid="file-type-thumb"
    >
      <span>.{extension}</span>
    </div>
  );
}
