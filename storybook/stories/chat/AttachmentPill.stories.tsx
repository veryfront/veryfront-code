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

const compositionTree = `AttachmentPill  <- context: a single AttachmentInfo
  +-- Thumbnail  <- image preview or file-type glyph
  +-- Label  <- file name + size / status
  +-- Remove button  <- shown when onRemove is set
  +-- Hover preview  <- shown when attachment.preview is set`;

function AttachmentPillDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="AttachmentPill"
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
        description="An `uploading` status dims the pill and swaps the remove control for a spinner."
      >
        <DocsExampleAuto of={Uploading} />
      </DocsSection>

      <DocsSection
        title="With preview"
        description="Set `attachment.preview` to surface a hover preview of the file contents."
      >
        <DocsExampleAuto of={WithPreview} />
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
              description: "Upload state; 'uploading' shows a spinner",
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
    docs: { page: AttachmentPillDocsPage },
  },
} satisfies Meta<typeof AttachmentPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Ready attachments">
        <div className="flex flex-wrap gap-2">
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
};

export const Uploading: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Uploading">
        <AttachmentPill
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
};

export const WithPreview: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Preview on hover">
        <AttachmentPill
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
};
