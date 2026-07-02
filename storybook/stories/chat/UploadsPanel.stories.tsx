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

const compositionTree =
  `UploadsPanel  <- render it: <UploadsPanel uploads={…} />
UploadsPanel.Root  <- or compose it: context (uploads, callbacks, file picker)
  +-- UploadsPanel.Header <- "Attachments" title + close button (when onClose set)
  +-- UploadsPanel.List   <- scrollable list of file rows
  |     +-- UploadsPanel.Item    <- one file row (icon, name, size, remove)
  +-- UploadsPanel.Empty  <- empty state (heading, hint, upload action)
  +-- UploadsPanel.Action <- upload/attach button (opens the native picker)`;

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

      <DocsSection
        title="Compose"
        description="Drop to `UploadsPanel.Root` + parts to recompose the panel — reorder or restyle the list, swap in your own `Item` rows, or replace the empty state. Every part takes `className`."
      >
        <DocsExampleAuto of={Composed} />
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
              name: "onClose",
              type: "() => void",
              description:
                "Called to dismiss the panel; renders the header close button",
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
  parameters: {
    docs: {
      source: {
        code: `import { UploadsPanel } from "veryfront/chat";

<UploadsPanel
  uploads={[
    { id: "upload-1", name: "run-analysis.csv", size: 24424, type: "text/csv" },
    { id: "upload-2", name: "prompt-notes.md", size: 9812, type: "text/markdown" },
  ]}
  onRemoveUpload={(id) => removeUpload(id)}
  onAttach={(files) => attach(files)}
  onClose={() => closePanel()}
/>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Uploaded files">
        <div className="h-[280px] rounded-[var(--radius-lg)] border border-[var(--outline-border)]">
          <UploadsPanel
            uploads={uploads}
            onRemoveUpload={() => undefined}
            onAttach={() => undefined}
            onClose={() => undefined}
          />
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Empty: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { UploadsPanel } from "veryfront/chat";

<UploadsPanel uploads={[]} onAttach={(files) => attach(files)} />`,
      },
    },
  },
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

export const Composed: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { UploadsPanel } from "veryfront/chat";

// Recompose the panel: a restyled list with the rows in reverse order.
<UploadsPanel.Root uploads={uploads} onRemoveUpload={remove} onAttach={attach}>
  <div className="flex-1 overflow-y-auto px-4 py-4">
    <UploadsPanel.List className="ring-1 ring-[var(--edge)] rounded-[var(--radius-md)] p-2">
      {[...uploads].reverse().map((file) => (
        <UploadsPanel.Item key={file.id} file={file} />
      ))}
      <UploadsPanel.Action variant="more">+ Add another</UploadsPanel.Action>
    </UploadsPanel.List>
  </div>
</UploadsPanel.Root>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Composed">
        <div className="h-[280px] rounded-[var(--radius-lg)] border border-[var(--outline-border)]">
          <UploadsPanel.Root
            uploads={uploads}
            onRemoveUpload={() => undefined}
            onAttach={() => undefined}
          >
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <UploadsPanel.List className="ring-1 ring-[var(--edge)] rounded-[var(--radius-md)] p-2">
                {[...uploads].reverse().map((file) => (
                  <UploadsPanel.Item key={file.id} file={file} />
                ))}
                <UploadsPanel.Action variant="more">
                  <span className="text-xs">+</span>
                  Add another
                </UploadsPanel.Action>
              </UploadsPanel.List>
            </div>
          </UploadsPanel.Root>
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};
