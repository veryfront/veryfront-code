import type { Meta, StoryObj } from "@storybook/react-vite";
import { UploadsPanel } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { uploads } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const importCode = `import { UploadsPanel } from "veryfront/chat"`;

const compositionTree = `UploadsPanel  <- scrollable list of uploaded files
  +-- File row  <- icon, name (link when url set), size
  +-- Remove button  <- shown when onRemoveUpload is set
  +-- Upload action  <- shown when onAttach is set
  +-- Empty state  <- shown when uploads is empty`;

function UploadsPanelDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="UploadsPanel"
        lead="A scrollable list of previously uploaded files with remove and add-more actions, plus an empty state."
      />

      <DocsSection
        title="Uploaded files"
        description="Each file shows an icon, name (linked when a url is present), and size."
      >
        <DocsExampleAuto of={UploadedFiles} />
      </DocsSection>

      <DocsSection
        title="Empty"
        description="With no uploads the panel shows an empty state and, when `onAttach` is set, an upload button."
      >
        <DocsExampleAuto of={Empty} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="UploadsPanel"
          description="List of uploaded files"
          props={[
            {
              name: "uploads",
              type: "UploadedFile[]",
              default: "[]",
              description: "Files to list",
            },
            {
              name: "onRemoveUpload",
              type: "(id: string) => void",
              description: "Called to remove a file; enables the remove button",
            },
            {
              name: "onAttach",
              type: "(files: FileList) => void",
              description: "Called with new files; enables the upload actions",
            },
            {
              name: "attachAccept",
              type: "string",
              description: "accept attribute for the file input",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names for the wrapper",
            },
          ]}
        />
        <DocsPropsTable
          component="UploadedFile"
          description="Public contract for an uploaded file"
          props={[
            {
              name: "id",
              type: "string",
              description: "Unique file identifier",
            },
            {
              name: "name",
              type: "string",
              description: "File name shown in the row",
            },
            {
              name: "size",
              type: "number",
              description: "File size in bytes, shown when set",
            },
            {
              name: "type",
              type: "string",
              description: "MIME or file type",
            },
            {
              name: "url",
              type: "string",
              description: "When set, the name becomes a link to the file",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/UploadsPanel",
  component: UploadsPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: UploadsPanelDocsPage },
  },
} satisfies Meta<typeof UploadsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UploadedFiles: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Uploaded files">
        <div className="h-[280px] rounded-[var(--radius-lg)] border border-[var(--outline-border)]">
          <UploadsPanel
            uploads={uploads}
            onRemoveUpload={() => undefined}
            onAttach={() => undefined}
          />
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Empty: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Empty">
        <div className="h-[280px] rounded-[var(--radius-lg)] border border-[var(--outline-border)]">
          <UploadsPanel uploads={[]} onAttach={() => undefined} />
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};
