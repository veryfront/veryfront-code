import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  FileTypeBadge,
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

const importCode =
  `import { FileTypeBadge, FileTypeThumb, getFileTypeLabel } from "veryfront/chat/ui"`;

const exts = [
  "pdf", "doc", "xls", "ppt", "png", "svg",
  "ts", "tsx", "js", "py", "rs", "go", "json", "csv", "md", "zip",
];

function FileTypeBadgeDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="FileTypeBadge"
        lead="The canonical file-type identity primitive — one distinct hue per extension. Soft-fill `FileTypeBadge` for lists; solid-fill `FileTypeThumb` for chip thumbnails. This is the one sanctioned home for the file-type colour palette."
      />
      <DocsSection
        title="Soft fill"
        description="Tinted square + extension label, for list/table rows."
      >
        <DocsExampleAuto of={Soft} />
      </DocsSection>
      <DocsSection
        title="Solid thumb"
        description="Full-saturation thumbnail with white `.ext`, for chips."
      >
        <DocsExampleAuto of={Thumb} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>
      <DocsSection title="Composition">
        <DocsComposition>
          {`FileTypeBadge   <- soft tinted square (lists/tables)
FileTypeThumb   <- solid thumbnail (chips/attachments)
getFileTypeLabel(ext, mediaType?)  <- human label helper`}
        </DocsComposition>
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="FileTypeBadge / FileTypeThumb"
          props={[
            { name: "extension", type: "string", description: "File extension (e.g. 'pdf')" },
            { name: "className", type: "string", description: "Size / extra classes" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/FileTypeBadge",
  component: FileTypeBadge,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: FileTypeBadgeDocsPage } },
} satisfies Meta<typeof FileTypeBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Soft: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex max-w-[420px] flex-wrap gap-2">
      {exts.map((e) => <FileTypeBadge key={e} extension={e} />)}
    </div>
  ),
};
export const Thumb: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex max-w-[460px] flex-wrap gap-2">
      {exts.map((e) => <FileTypeThumb key={e} extension={e} />)}
    </div>
  ),
};
