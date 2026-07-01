import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Alert,
  AlertAction,
  AlertContent,
  AlertIcon,
} from "../../../src/react/components/chat/ui/index.ts";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  InfoIcon,
  XCircleIcon,
} from "../../../src/react/components/chat/icons/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const importCode = `import { Alert } from "veryfront/chat/ui"`;

const compositionTree = `Alert  <- soft-fill status callout (default / warning / error / success)
  +-- AlertIcon     <- leading status glyph
  +-- AlertContent  <- message body
  +-- AlertAction   <- trailing action (button / link)`;

function AlertDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Alert"
        lead="A soft-fill status callout — one of the sanctioned bg+border surfaces. The fill is a mode-invariant light pastel, so text stays dark in both themes."
      />

      <DocsSection
        title="Variants"
        description="`variant` sets the colour scheme: `default` (info), `warning`, `error`, `success`."
      >
        <DocsExampleAuto of={Variants} />
      </DocsSection>

      <DocsSection
        title="With action"
        description="Compose `AlertContent` with a trailing `AlertAction` for a retry or dismiss control."
      >
        <DocsExampleAuto of={WithAction} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Alert"
          description="Soft-fill status callout"
          props={[
            {
              name: "variant",
              type: '"default" | "warning" | "error" | "success"',
              description: "Colour scheme. Defaults to default (info)",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Alert",
  component: Alert,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: AlertDocsPage },
  },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Alert variants">
        <div className="flex flex-col gap-3">
          <Alert>
            <AlertIcon>
              <InfoIcon className="size-4" />
            </AlertIcon>
            <AlertContent>Heads up — this is an informational message.</AlertContent>
          </Alert>
          <Alert variant="warning">
            <AlertIcon>
              <AlertTriangleIcon className="size-4" />
            </AlertIcon>
            <AlertContent>Careful — this action can’t be undone.</AlertContent>
          </Alert>
          <Alert variant="error">
            <AlertIcon>
              <XCircleIcon className="size-4" />
            </AlertIcon>
            <AlertContent>Missing deploy token</AlertContent>
          </Alert>
          <Alert variant="success">
            <AlertIcon>
              <CheckCircleIcon className="size-4" />
            </AlertIcon>
            <AlertContent>Your changes were saved.</AlertContent>
          </Alert>
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const WithAction: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Alert with action">
        <Alert variant="error">
          <AlertIcon>
            <XCircleIcon className="size-4" />
          </AlertIcon>
          <AlertContent>Upload failed. Try again.</AlertContent>
          <AlertAction>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-sm font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </AlertAction>
        </Alert>
      </ReviewSurface>
    </StoryFrame>
  ),
};
