import type { Meta, StoryObj } from "@storybook/react-vite";
import { Attachment } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { attachments } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const importCode = `import { Attachment } from "veryfront/chat"`;

const compositionTree =
  `Attachment  <- render it: <Attachment attachment={info} /> (chip anatomy)
Attachment.Root  <- or compose it: context (attachment, derived view state)
  +-- Attachment.Thumbnail  <- image square (shown for image attachments)
  +-- Attachment.Icon       <- state glyph / file-extension square
  +-- Attachment.Label      <- name + secondary state line
  +-- Attachment.Retry      <- retry control (error state, needs onRetry)
  +-- Attachment.Remove     <- remove (✕) control (needs onRemove)`;

function AttachmentDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Attachment"
        lead="A compact chip representing one chat attachment — file glyph, name, size, and an optional remove control."
      />

      <DocsSection
        title="Ready"
        description="Ready attachments show the file-type glyph, name, and size, with a remove button on hover."
      >
        <DocsExampleAuto of={Ready} />
      </DocsSection>

      <DocsSection
        title="Uploading"
        description="An `uploading` status dims the pill and shows a spinner over the thumbnail."
      >
        <DocsExampleAuto of={Uploading} />
      </DocsSection>

      <DocsSection
        title="With preview"
        description="Set `attachment.preview` to surface a hover preview of the file contents."
      >
        <DocsExampleAuto of={WithPreview} />
      </DocsSection>

      <DocsSection
        title="Upload states"
        description="Set `attachment.state` to drive the full upload lifecycle — `selected` (dashed, ready to upload), `uploading` (spinner + `progress` %), `processing`, `uploaded` (check), and `error` (retry via `onRetry`)."
      >
        <DocsExampleAuto of={States} />
      </DocsSection>

      <DocsSection
        title="Compose"
        description="Drop to `Attachment.Root` + parts to recompose the chip — reorder the controls, restyle a section with `className`, or swap the thumbnail for the icon box."
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
          component="Attachment"
          description="Renders a single attachment chip"
          props={[
            {
              name: "attachment",
              type: "AttachmentInfo",
              description: "The attachment to render",
            },
            {
              name: "onRemove",
              type: "(id: string) => void",
              description: "Called with the attachment id to remove it",
            },
            {
              name: "onRetry",
              type: "(id: string) => void",
              description:
                "Called to retry a failed upload (shows a retry button in the error state)",
            },
            {
              name: "icons",
              type: "AttachmentPillIcons",
              description: "Override the remove / retry glyphs ({ remove, retry })",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names for the chip (merged via cn)",
            },
          ]}
        />
        <DocsPropsTable
          component="AttachmentInfo"
          description="Public contract for an attachment"
          props={[
            {
              name: "id",
              type: "string",
              description: "Unique attachment identifier",
            },
            {
              name: "name",
              type: "string",
              description: "File name shown as the label",
            },
            {
              name: "status",
              type: "'uploading' | 'ready'",
              description:
                "Legacy two-value status; prefer `state` for the full lifecycle",
            },
            {
              name: "state",
              type:
                "'selected' | 'uploading' | 'processing' | 'uploaded' | 'error'",
              description:
                "Upload lifecycle state — sets the glyph, label, and treatment",
            },
            {
              name: "progress",
              type: "number",
              description:
                "Upload progress 0–100, shown in the uploading label",
            },
            {
              name: "type",
              type: "string",
              description: "MIME or file type, used for the glyph",
            },
            {
              name: "size",
              type: "number",
              description: "File size in bytes, shown when set",
            },
            {
              name: "preview",
              type: "string",
              description: "Image src or text preview shown on hover",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/Attachment",
  component: Attachment,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: AttachmentDocsPage },
  },
} satisfies Meta<typeof Attachment>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Ready attachments">
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <Attachment
              key={attachment.id}
              attachment={attachment}
              onRemove={() => undefined}
            />
          ))}
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
  parameters: {
    docs: {
      source: {
        code: `{attachments.map((attachment) => (
  <Attachment
    key={attachment.id}
    attachment={attachment}
    onRemove={handleRemove}
  />
))}`,
      },
    },
  },
};

export const Uploading: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Uploading">
        <Attachment
          attachment={{
            id: "uploading",
            name: "run-export.csv",
            size: 48492,
            type: "csv",
            status: "uploading",
          }}
        />
      </ReviewSurface>
    </StoryFrame>
  ),
  parameters: {
    docs: {
      source: {
        code: `<Attachment
  attachment={{
    id: "uploading",
    name: "run-export.csv",
    size: 48492,
    type: "csv",
    status: "uploading",
  }}
/>`,
      },
    },
  },
};

export const WithPreview: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Preview on hover">
        <Attachment
          attachment={{
            id: "preview",
            name: "handoff-notes.md",
            type: "md",
            size: 2418,
            preview:
              "Release notes: validate the agent run state, audit tool input, and verify error copy before deploy.",
          }}
          onRemove={() => undefined}
        />
      </ReviewSurface>
    </StoryFrame>
  ),
  parameters: {
    docs: {
      source: {
        code: `<Attachment
  attachment={{
    id: "preview",
    name: "handoff-notes.md",
    type: "md",
    size: 2418,
    preview: "Release notes: validate the agent run state...",
  }}
  onRemove={handleRemove}
/>`,
      },
    },
  },
};

export const Composed: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Recomposed chip">
        <Attachment.Root
          attachment={{
            id: "composed",
            name: "handoff-notes.md",
            type: "md",
            size: 2418,
          }}
          onRemove={() => undefined}
        >
          <Attachment.Icon />
          <Attachment.Label />
          <Attachment.Remove className="ring-1 ring-[var(--edge)]" />
        </Attachment.Root>
      </ReviewSurface>
    </StoryFrame>
  ),
  parameters: {
    docs: {
      source: {
        code: `import { Attachment } from "veryfront/chat";

// Recompose the chip: icon box + label, then a restyled remove control.
<Attachment.Root attachment={info} onRemove={handleRemove}>
  <Attachment.Icon />
  <Attachment.Label />
  <Attachment.Remove className="ring-1 ring-[var(--edge)]" />
</Attachment.Root>`,
      },
    },
  },
};

export const States: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Upload lifecycle">
        <div className="flex flex-col gap-2">
          <Attachment
            attachment={{
              id: "selected",
              name: "agent-prd.md",
              type: "md",
              size: 18432,
              state: "selected",
            }}
            onRemove={() => undefined}
          />
          <Attachment
            attachment={{
              id: "uploading",
              name: "run-export.csv",
              type: "csv",
              state: "uploading",
              progress: 62,
            }}
          />
          <Attachment
            attachment={{
              id: "processing",
              name: "handoff-notes.md",
              type: "md",
              state: "processing",
            }}
          />
          <Attachment
            attachment={{
              id: "uploaded",
              name: "release-log.txt",
              type: "txt",
              size: 8102,
              state: "uploaded",
            }}
            onRemove={() => undefined}
          />
          <Attachment
            attachment={{
              id: "error",
              name: "screenshot.png",
              type: "png",
              state: "error",
            }}
            onRetry={() => undefined}
            onRemove={() => undefined}
          />
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
  parameters: {
    docs: {
      source: {
        code: `<>
  <Attachment
    attachment={{ id: "selected", name: "agent-prd.md", type: "md", size: 18432, state: "selected" }}
    onRemove={handleRemove}
  />
  <Attachment
    attachment={{ id: "uploading", name: "run-export.csv", type: "csv", state: "uploading", progress: 62 }}
  />
  <Attachment
    attachment={{ id: "processing", name: "handoff-notes.md", type: "md", state: "processing" }}
  />
  <Attachment
    attachment={{ id: "uploaded", name: "release-log.txt", type: "txt", size: 8102, state: "uploaded" }}
    onRemove={handleRemove}
  />
  <Attachment
    attachment={{ id: "error", name: "screenshot.png", type: "png", state: "error" }}
    onRetry={handleRetry}
    onRemove={handleRemove}
  />
</>`,
      },
    },
  },
};
