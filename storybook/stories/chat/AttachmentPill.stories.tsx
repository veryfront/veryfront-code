import type { Meta, StoryObj } from "@storybook/react-vite";
import { AttachmentPill } from "veryfront/chat";
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

const importCode = `import { AttachmentPill } from "veryfront/chat"`;

const compositionTree =
  `AttachmentPill  <- render it: <AttachmentPill attachment={info} />
AttachmentPill.Root  <- or compose it: context and derived view state
  +-- AttachmentPill.Thumbnail  <- image square for image attachments
  +-- AttachmentPill.Icon       <- state glyph or file-extension square
  +-- AttachmentPill.Label      <- name and secondary state line
  +-- AttachmentPill.Retry      <- retry control when onRetry is present
  +-- AttachmentPill.Remove     <- remove control when onRemove is present`;

function AttachmentDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="AttachmentPill"
        lead="A compact chip representing one chat attachment, with a file glyph, name, size, and optional remove control."
      />

      <DocsSection
        title="Ready"
        description="Ready attachments show the file-type glyph, name, and size, with a remove button on hover."
      >
        <DocsExampleAuto of={Ready} />
      </DocsSection>

      <DocsSection
        title="Uploading (legacy status)"
        description="The legacy `status: 'uploading'` dims the chip and spins over the icon box. Prefer `state` for new code. See Upload states below."
      >
        <DocsExampleAuto of={Uploading} />
      </DocsSection>

      <DocsSection
        title="Image thumbnail"
        description="Image attachments render an inline thumbnail from `attachment.preview` (falling back to the resolved `url`)."
      >
        <DocsExampleAuto of={WithPreview} />
      </DocsSection>

      <DocsSection
        title="Upload states"
        description="Set `attachment.state` to drive the full upload lifecycle: `selected` (dashed, ready to upload), `uploading` (spinner and `progress` percent), `processing`, `uploaded` (check), and `error` (retry via `onRetry`)."
      >
        <DocsExampleAuto of={States} />
      </DocsSection>

      <DocsSection
        title="Compose"
        description="Use `AttachmentPill.Root` and its parts to recompose the chip, reorder controls, restyle a section, or replace the thumbnail with the icon box."
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
          component="AttachmentPill"
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
              name: "className",
              type: "string",
              description:
                "Additional class names for the chip (merged via cn)",
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
                "Upload lifecycle state; sets the glyph, label, and treatment",
            },
            {
              name: "progress",
              type: "number",
              description:
                "Upload progress from 0 to 100, shown in the uploading label",
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
  title: "Chat/Components/AttachmentPill",
  component: AttachmentPill,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: AttachmentDocsPage },
  },
} satisfies Meta<typeof AttachmentPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Ready attachments">
        <div className="flex flex-wrap gap-2 [&>*]:w-[200px]">
          {attachments.map((attachment) => (
            <AttachmentPill
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
        code: `<div className="flex flex-wrap gap-2 [&>*]:w-[200px]">
  {attachments.map((attachment) => (
    <AttachmentPill
      key={attachment.id}
      attachment={attachment}
      onRemove={handleRemove}
    />
  ))}
</div>`,
      },
    },
  },
};

export const Uploading: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Uploading">
        <AttachmentPill
          className="w-[200px]"
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
        code: `<AttachmentPill
  className="w-[200px]"
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
      <ReviewSurface label="Image thumbnail">
        <AttachmentPill
          className="w-[200px]"
          attachment={{
            id: "preview",
            name: "cover.png",
            type: "image/png",
            size: 40218,
            preview:
              "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='indigo'/><circle cx='20' cy='20' r='9' fill='white'/></svg>",
          }}
          onRemove={() => undefined}
        />
      </ReviewSurface>
    </StoryFrame>
  ),
  parameters: {
    docs: {
      source: {
        code: `<AttachmentPill
  className="w-[200px]"
  attachment={{
    id: "preview",
    name: "cover.png",
    type: "image/png",
    size: 40218,
    preview: coverImageUrl, // image src rendered as an inline thumbnail
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
        <AttachmentPill.Root
          className="w-[200px]"
          attachment={{
            id: "composed",
            name: "handoff-notes.md",
            type: "md",
            size: 2418,
          }}
          onRemove={() => undefined}
        >
          <AttachmentPill.Icon />
          <AttachmentPill.Label />
          <AttachmentPill.Remove className="ring-1 ring-[var(--edge)]" />
        </AttachmentPill.Root>
      </ReviewSurface>
    </StoryFrame>
  ),
  parameters: {
    docs: {
      source: {
        code: `import { AttachmentPill } from "veryfront/chat";

// Recompose the chip: icon box + label, then a restyled remove control.
<AttachmentPill.Root className="w-[200px]" attachment={info} onRemove={handleRemove}>
  <AttachmentPill.Icon />
  <AttachmentPill.Label />
  <AttachmentPill.Remove className="ring-1 ring-[var(--edge)]" />
</AttachmentPill.Root>`,
      },
    },
  },
};

export const States: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Upload lifecycle">
        <div className="flex flex-col gap-2 [&>*]:w-[200px]">
          <AttachmentPill
            attachment={{
              id: "selected",
              name: "agent-prd.md",
              type: "md",
              size: 18432,
              state: "selected",
            }}
            onRemove={() => undefined}
          />
          <AttachmentPill
            attachment={{
              id: "uploading",
              name: "run-export.csv",
              type: "csv",
              state: "uploading",
              progress: 62,
            }}
          />
          <AttachmentPill
            attachment={{
              id: "processing",
              name: "handoff-notes.md",
              type: "md",
              state: "processing",
            }}
          />
          <AttachmentPill
            attachment={{
              id: "uploaded",
              name: "release-log.txt",
              type: "txt",
              size: 8102,
              state: "uploaded",
            }}
            onRemove={() => undefined}
          />
          <AttachmentPill
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
        code: `<div className="flex flex-col gap-2 [&>*]:w-[200px]">
  <AttachmentPill
    attachment={{ id: "selected", name: "agent-prd.md", type: "md", size: 18432, state: "selected" }}
    onRemove={handleRemove}
  />
  <AttachmentPill
    attachment={{ id: "uploading", name: "run-export.csv", type: "csv", state: "uploading", progress: 62 }}
  />
  <AttachmentPill
    attachment={{ id: "processing", name: "handoff-notes.md", type: "md", state: "processing" }}
  />
  <AttachmentPill
    attachment={{ id: "uploaded", name: "release-log.txt", type: "txt", size: 8102, state: "uploaded" }}
    onRemove={handleRemove}
  />
  <AttachmentPill
    attachment={{ id: "error", name: "screenshot.png", type: "png", state: "error" }}
    onRetry={handleRetry}
    onRemove={handleRemove}
  />
</div>`,
      },
    },
  },
};
