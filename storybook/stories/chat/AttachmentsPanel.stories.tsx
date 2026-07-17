import type { Meta, StoryObj } from "@storybook/react-vite";
import { AttachmentPill, AttachmentsPanel } from "veryfront/chat";
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

const importCode = `import { AttachmentsPanel } from "veryfront/chat"`;

const compositionTree =
  `AttachmentsPanel  <- render it: <AttachmentsPanel uploads={uploads} />
AttachmentsPanel.Root  <- or compose it: context (uploads, callbacks, file picker)
  +-- AttachmentsPanel.Header <- "Attachments" title + close button (when onClose set)
  +-- AttachmentsPanel.List   <- flex-gap column of attachment cards
  |     +-- AttachmentsPanel.Item    <- composes <AttachmentPill> and an overflow menu
  |     |     +-- AttachmentsPanel.Item.Icon     <- file-type icon square
  |     |     +-- AttachmentsPanel.Item.Preview  <- image thumbnail (image files)
  |     |     +-- AttachmentsPanel.Item.Remove   <- delete control (onRemoveUpload)
  |     |     (name / size: use AttachmentPill.Label or read useAttachments)
  +-- AttachmentsPanel.Empty  <- empty state (heading, hint, upload action)
  +-- AttachmentsPanel.Action <- upload/attach button (opens the native picker)`;

function AttachmentsPanelDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="AttachmentsPanel"
        lead="A scrollable list of attachments with remove and add-more actions, plus an empty state."
      />

      <DocsSection
        title="Attachments"
        description="Each row composes the shared `AttachmentPill`, including its file badge or image thumbnail, name, and size, with an overflow menu for open and delete actions."
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
        title="Loading"
        description="While the initial list is fetched, pass `loading` to show skeleton rows instead of flashing the empty state. A non-empty `uploads` list always wins, so a cached list paints without a skeleton flash."
      >
        <DocsExampleAuto of={Loading} />
      </DocsSection>

      <DocsSection
        title="Compose"
        description="Use `AttachmentsPanel.Root` and its parts to recompose the panel, reorder or restyle the list, replace item rows, or replace the empty state. Every part takes `className`."
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
          component="AttachmentsPanel"
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
              name: "loading",
              type: "boolean",
              default: "false",
              description:
                "Show skeleton rows while the initial list loads (only when uploads is empty)",
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
              description:
                "Resolved file URL; renders an image thumbnail when the file is an image",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/AttachmentsPanel",
  component: AttachmentsPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: AttachmentsPanelDocsPage },
  },
} satisfies Meta<typeof AttachmentsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UploadedFiles: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { AttachmentsPanel } from "veryfront/chat";

<AttachmentsPanel
  uploads={[
    { id: "upload-1", name: "run-analysis.csv", size: 24424, type: "text/csv" },
    { id: "upload-2", name: "prompt-notes.md", size: 9812, type: "text/markdown" },
  ]}
  onRemoveUpload={(id) => removeUpload(id)}
  onAttach={(files) => attach(files)}
/>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Uploaded files">
        <div className="h-[280px]">
          <AttachmentsPanel
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
  parameters: {
    docs: {
      source: {
        code: `import { AttachmentsPanel } from "veryfront/chat";

<AttachmentsPanel uploads={[]} onAttach={(files) => attach(files)} />`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Empty">
        <div className="h-[280px]">
          <AttachmentsPanel uploads={[]} onAttach={() => undefined} />
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Loading: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code:
          `import { AttachmentsPanel, useAttachments } from "veryfront/chat";

const uploads = useAttachments({ url: "/api/uploads" });

<AttachmentsPanel
  uploads={uploads.items}
  loading={uploads.isLoading}
  onRemoveUpload={(id) => uploads.remove(id)}
  onAttach={(files) => uploads.upload(files)}
/>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Loading">
        <div className="h-[280px]">
          <AttachmentsPanel uploads={[]} loading onAttach={() => undefined} />
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const ComposedRow: Story = {
  name: "Composed row (Item leaves)",
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { AttachmentPill, AttachmentsPanel } from "veryfront/chat";

// Own the row: compose it from the domain leaves (.Icon derives pill state,
// .Remove wires to onRemoveUpload) + AttachmentPill.Label for name/size. Plain
// text isn't a leaf — read useAttachments() or use .Label.
<AttachmentsPanel.Root uploads={uploads} onRemoveUpload={remove}>
  <div className="flex-1 overflow-y-auto px-4 py-4">
    <AttachmentsPanel.List>
      {uploads.map((file) => (
        <AttachmentsPanel.Item key={file.id} file={file}>
          <AttachmentsPanel.Item.Icon />
          <AttachmentPill.Label />
          <AttachmentsPanel.Item.Remove />
        </AttachmentsPanel.Item>
      ))}
    </AttachmentsPanel.List>
  </div>
</AttachmentsPanel.Root>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Composed row">
        <div className="h-[280px]">
          <AttachmentsPanel.Root uploads={uploads} onRemoveUpload={() => undefined}>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <AttachmentsPanel.List>
                {uploads.map((file) => (
                  <AttachmentsPanel.Item key={file.id} file={file}>
                    <AttachmentsPanel.Item.Icon />
                    <AttachmentPill.Label />
                    <AttachmentsPanel.Item.Remove />
                  </AttachmentsPanel.Item>
                ))}
              </AttachmentsPanel.List>
            </div>
          </AttachmentsPanel.Root>
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
        code: `import { AttachmentsPanel } from "veryfront/chat";

// Recompose the panel: a restyled list with the rows in reverse order.
<AttachmentsPanel.Root uploads={uploads} onRemoveUpload={remove} onAttach={attach}>
  <div className="flex-1 overflow-y-auto px-4 py-4">
    <AttachmentsPanel.List>
      {[...uploads].reverse().map((file) => (
        <AttachmentsPanel.Item key={file.id} file={file} />
      ))}
      <AttachmentsPanel.Action variant="more">Add another</AttachmentsPanel.Action>
    </AttachmentsPanel.List>
  </div>
</AttachmentsPanel.Root>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Composed">
        <div className="h-[280px]">
          <AttachmentsPanel.Root
            uploads={uploads}
            onRemoveUpload={() => undefined}
            onAttach={() => undefined}
          >
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <AttachmentsPanel.List>
                {[...uploads].reverse().map((file) => (
                  <AttachmentsPanel.Item key={file.id} file={file} />
                ))}
                <AttachmentsPanel.Action variant="more">
                  Add another
                </AttachmentsPanel.Action>
              </AttachmentsPanel.List>
            </div>
          </AttachmentsPanel.Root>
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};
