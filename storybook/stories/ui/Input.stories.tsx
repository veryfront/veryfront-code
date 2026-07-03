import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import {
  Input,
  Label,
} from "../../../src/react/components/chat/ui/index.ts";
import {
  CheckIcon,
  CopyIcon,
  SearchIcon,
} from "../../../src/react/components/chat/icons/index.ts";

const importCode = `import { Input } from "veryfront/chat/ui"`;

function InputDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Input"
        lead="Text input with variants, icons, validation, and read-only display."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="With Label">
        <DocsExampleAuto of={WithLabel} />
      </DocsSection>

      <DocsSection
        title="With Icon"
        description="Reach for this on search and filter inputs."
      >
        <DocsExampleAuto of={WithIcon} />
      </DocsSection>

      <DocsSection
        title="Read-only"
        description="Combine with font-mono for technical strings."
      >
        <DocsExampleAuto of={ReadOnly} />
      </DocsSection>

      <DocsSection
        title="Read-only with copy button"
        description="Pair with useClipboard for tokens and URLs."
      >
        <DocsExampleAuto of={ReadOnlyWithCopy} />
      </DocsSection>

      <DocsSection
        title="With Validation"
        description="Set data-invalid for the destructive ring."
      >
        <DocsExampleAuto of={WithValidation} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{`Input`}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Input"
          description="Text input field with variant support"
          props={[
            {
              name: "size",
              type: "'sm' | 'md' | 'lg'",
              default: "'lg'",
              description: "Height preset (38 / 42 / 48)",
            },
            {
              name: "icon",
              type: "ReactNode",
              description: "Leading icon rendered inside the field",
            },
            {
              name: "data-invalid",
              type: "boolean | 'true' | 'false'",
              description: "Toggles the destructive border for error states",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Input",
  component: Input,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: InputDocsPage },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Input placeholder="Project Name" />,
};

export const WithLabel: Story = {
  name: "With Label",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-2 w-72">
      <Label htmlFor="story-project-name">Project Name</Label>
      <Input id="story-project-name" placeholder="my-project" />
    </div>
  ),
};

export const WithIcon: Story = {
  name: "With Icon",
  tags: ["!dev"],
  render: () => (
    <Input
      icon={<SearchIcon className="size-4" />}
      placeholder="Search integrations..."
      className="w-72"
    />
  ),
};

export const ReadOnly: Story = {
  name: "Read-only",
  tags: ["!dev"],
  render: () => (
    <Input
      readOnly
      value="https://api.veryfront.com"
      className="font-mono text-sm w-80"
    />
  ),
};

export const ReadOnlyWithCopy: Story = {
  name: "Read-only with copy button",
  tags: ["!dev"],
  render: () => {
    const value = "vf_live_4f9c2b8e1a7d6c5b3a2e9f8d7c6b5a4e";
    const [isCopied, setIsCopied] = useState(false);
    const onCopy = () => {
      navigator.clipboard?.writeText(value);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1500);
    };
    return (
      <div className="flex flex-col gap-2 w-96">
        <Label size="sm" htmlFor="story-api-key">
          API key
        </Label>
        <div className="relative">
          <Input
            id="story-api-key"
            readOnly
            value={value}
            className="font-mono text-sm pr-12"
            onFocus={() => onCopy()}
          />
          <div className="absolute inset-y-0 right-0 flex items-center pr-1">
            <div className="pointer-events-none -ml-6 h-full w-6 bg-linear-to-r from-transparent to-input" />
            <button
              type="button"
              onClick={() => onCopy()}
              aria-label="Copy API key"
              className="flex items-center justify-center size-8 rounded-md text-foreground hover:text-foreground transition-colors cursor-pointer bg-secondary"
            >
              {isCopied
                ? <CheckIcon className="size-4 text-success" />
                : <CopyIcon className="size-4" />}
            </button>
          </div>
        </div>
      </div>
    );
  },
};

export const WithValidation: Story = {
  name: "With Validation",
  tags: ["!dev"],
  render: () => (
    <Input data-invalid={true} placeholder="Enter email" className="w-72" />
  ),
};

export const DateField: Story = {
  name: "Date Field",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-2 w-72">
      <Label htmlFor="story-expiration-date">Expiration Date</Label>
      <Input
        id="story-expiration-date"
        type="date"
        min="2026-05-04"
        defaultValue="2026-05-04"
      />
    </div>
  ),
};

export const Disabled: Story = {
  tags: ["!dev"],
  render: () => (
    <Input disabled placeholder="Disabled field" className="w-72" />
  ),
};

export const Small: Story = {
  name: "Small (h-9)",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-3 w-72">
      <Input size="md" placeholder="Filter projects..." />
      <Input
        size="md"
        icon={<SearchIcon className="size-4" />}
        placeholder="Search files..."
      />
    </div>
  ),
};
