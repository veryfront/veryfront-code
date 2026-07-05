import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  FileType,
  FileTypeThumb,
} from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const importBadge = `import { FileType } from "veryfront/chat/ui"`;
const importThumb = `import { FileTypeThumb } from "veryfront/chat/ui"`;
const importLabel = `import { getFileTypeLabel } from "veryfront/chat/ui"`;

const importCode = `${importBadge}\n${importThumb}\n${importLabel}`;

const compositionTree = `FileType
FileTypeThumb`;

function FileTypeDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="FileType"
        lead="Per-extension identity badge. The only place the Tailwind named-colour palette is sanctioned."
      />

      <DocsSection
        title="FileType — soft fill"
        description="Sits next to filename text in lists and tables."
      >
        <DocsExampleAuto of={Markdown} />
      </DocsSection>

      <DocsSection title="Common types">
        <DocsExampleAuto of={TypeScript} />
        <DocsExampleAuto of={PDF} />
      </DocsSection>

      <DocsSection
        title="Unknown extension"
        description="Falls back to a neutral fill — never invent a new hue."
      >
        <DocsExampleAuto of={Unknown} />
      </DocsSection>

      <DocsSection title="All extensions (badge variant)">
        <DocsExampleAuto of={Grid} />
      </DocsSection>

      <DocsSection
        title="FileTypeThumb — solid fill"
        description="Leading thumbnail slot in attachment chips."
      >
        <DocsExampleAuto of={ThumbGrid} />
      </DocsSection>

      <DocsSection
        title="Thumb vs Badge"
        description="Pick by surrounding density."
      >
        <DocsExampleAuto of={ThumbVsBadge} />
      </DocsSection>

      <DocsSection title="getFileTypeLabel()">
        <DocsCode
          code={`getFileTypeLabel('tsx')
// → 'TypeScript React'

getFileTypeLabel('zip', 'application/zip')
// → 'ZIP' (falls back to mediaType suffix)

getFileTypeLabel('???')
// → 'File'`}
        />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="FileType"
          description="Soft-fill identity badge for a file extension"
          props={[
            {
              name: "extension",
              type: "string",
              description: "File extension (e.g. 'pdf')",
            },
            {
              name: "className",
              type: "string",
              description: "Size / extra classes",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/FileType",
  component: FileType,
  tags: ["autodocs"],
  args: { extension: "tsx" },
  parameters: {
    layout: "centered",
    docs: { page: FileTypeDocsPage },
  },
} satisfies Meta<typeof FileType>;

export default meta;
type Story = StoryObj<typeof meta>;

const COMMON_EXTENSIONS = [
  "md",
  "mdx",
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "png",
  "jpg",
  "svg",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "rs",
  "go",
  "json",
  "csv",
  "yaml",
  "html",
] as const;

export const Markdown: Story = {
  tags: ["!dev"],
  render: () => <FileType extension="md" />,
};

export const TypeScript: Story = {
  tags: ["!dev"],
  render: () => <FileType extension="tsx" />,
};

export const PDF: Story = {
  tags: ["!dev"],
  render: () => <FileType extension="pdf" />,
};

export const Unknown: Story = {
  name: "Unknown extension (fallback)",
  tags: ["!dev"],
  render: () => <FileType extension="zip" />,
};

export const Grid: Story = {
  name: "All extensions (badge variant)",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {COMMON_EXTENSIONS.map((ext) => (
        <FileType key={ext} extension={ext} />
      ))}
    </div>
  ),
};

export const ThumbGrid: Story = {
  name: "All extensions (thumb variant)",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {COMMON_EXTENSIONS.map((ext) => (
        <FileTypeThumb key={ext} extension={ext} />
      ))}
    </div>
  ),
};

export const ThumbVsBadge: Story = {
  name: "Thumb vs Badge (side-by-side)",
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-6">
      <div className="flex flex-col items-center gap-2">
        <FileType extension="tsx" />
        <span className="text-xs text-foreground">FileType</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <FileTypeThumb extension="tsx" />
        <span className="text-xs text-foreground">FileTypeThumb</span>
      </div>
    </div>
  ),
};
