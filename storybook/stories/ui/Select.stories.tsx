import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../../../src/react/components/chat/ui/index.ts";
import {
  CodeBracketsIcon,
  FileTextIcon,
  PanelLeftIcon,
  WrenchIcon,
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

const importCode = `import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  selectTriggerVariants,
} from "veryfront/chat/ui"`;

const compositionTree = `Select                           <- Root
+-- SelectTrigger                <- Button that opens the dropdown (size: xs|sm|md|lg)
|   +-- SelectValue              <- Displays the selected value or placeholder
+-- SelectContent                <- scrollable dropdown list
|   +-- SelectGroup              <- Groups related items together
|   |   +-- SelectLabel          <- Group heading label
|   |   +-- SelectItem           <- Individual option item`;

function SelectDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Select"
        lead="Single-value dropdown with optional grouping and trigger sizes."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="With Label">
        <DocsExampleAuto of={WithLabel} />
      </DocsSection>

      <DocsSection title="Disabled">
        <DocsExampleAuto of={Disabled} />
      </DocsSection>

      <DocsSection title="With Groups">
        <DocsExampleAuto of={WithGroups} />
      </DocsSection>

      <DocsSection
        title="With Icons and Groups"
        description="Render leading icons alongside item labels by composing children inside SelectItem. The trigger renders its own custom content so the icon stays visible when collapsed."
      >
        <DocsExampleAuto of={WithIconsAndGroups} />
      </DocsSection>

      <DocsSection title="Concurrency Policy" description="Real-world example from scheduled jobs.">
        <DocsExampleAuto of={ConcurrencyPolicy} />
      </DocsSection>

      <DocsSection title="Small (h-9)">
        <DocsExampleAuto of={Small} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Select"
          description="Root"
          props={[
            { name: "value", type: "string", description: "Controlled selected value" },
            { name: "defaultValue", type: "string", description: "Uncontrolled initial value" },
            { name: "onValueChange", type: "(value) => void", description: "Selection change handler" },
            { name: "open", type: "boolean", description: "Controlled open state" },
          ]}
        />
        <DocsPropsTable
          component="SelectTrigger"
          description="Button that opens the dropdown"
          props={[
            { name: "size", type: "'xs' | 'sm' | 'md' | 'lg'", default: "'lg'", description: "Trigger height/padding" },
            { name: "disabled", type: "boolean", description: "Disables the trigger" },
          ]}
        />
        <DocsPropsTable
          component="SelectValue"
          description="Displays the selected value or placeholder text"
          props={[{ name: "placeholder", type: "string", description: "Shown when no value is selected" }]}
        />
        <DocsPropsTable
          component="SelectContent"
          description="Scrollable dropdown list"
          props={[{ name: "className", type: "string", description: "Additional classes" }]}
        />
        <DocsPropsTable
          component="SelectGroup"
          description="Groups related items together — wrap with SelectLabel for a heading"
          props={[{ name: "children", type: "ReactNode", description: "Group items" }]}
        />
        <DocsPropsTable
          component="SelectLabel"
          description="Group heading label — rendered above a SelectGroup"
          props={[{ name: "children", type: "ReactNode", description: "Label content" }]}
        />
        <DocsPropsTable
          component="SelectItem"
          description="Individual option — renders a checkmark next to the selected value"
          props={[
            { name: "value", type: "string", description: "Option value (required)" },
            { name: "disabled", type: "boolean", description: "Disables the option" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Select",
  component: Select,
  subcomponents: { SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem },
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: SelectDocsPage },
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-72">
      <Select defaultValue="production">
        <SelectTrigger>
          <SelectValue placeholder="Select environment" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="production">Production</SelectItem>
          <SelectItem value="staging">Staging</SelectItem>
          <SelectItem value="preview">Preview</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
};

export const WithLabel: Story = {
  name: "With Label",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-2 w-72">
      <Label size="sm" htmlFor="story-environment">
        Environment
      </Label>
      <Select defaultValue="production">
        <SelectTrigger id="story-environment">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="production">Production</SelectItem>
          <SelectItem value="staging">Staging</SelectItem>
          <SelectItem value="preview">Preview</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
};

export const Disabled: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-72">
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder="Select a Project First" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="project-a">Project A</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
};

export const WithGroups: Story = {
  name: "With Groups",
  tags: ["!dev"],
  render: () => (
    <div className="w-72">
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Select a region" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>North America</SelectLabel>
            <SelectItem value="us-east">US East</SelectItem>
            <SelectItem value="us-west">US West</SelectItem>
            <SelectItem value="ca-central">Canada Central</SelectItem>
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Europe</SelectLabel>
            <SelectItem value="eu-west">EU West</SelectItem>
            <SelectItem value="eu-central">EU Central</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  ),
};

type DeploymentTarget = {
  value: string;
  label: string;
  icon: React.ReactNode;
};

const deploymentGroups: { label: string; targets: DeploymentTarget[] }[] = [
  {
    label: "Cloud",
    targets: [
      { value: "aws", label: "AWS", icon: <PanelLeftIcon className="size-4" /> },
      { value: "gcp", label: "Google Cloud", icon: <PanelLeftIcon className="size-4" /> },
      { value: "azure", label: "Azure", icon: <PanelLeftIcon className="size-4" /> },
    ],
  },
  {
    label: "Edge",
    targets: [
      { value: "cloudflare", label: "Cloudflare", icon: <CodeBracketsIcon className="size-4" /> },
      { value: "fastly", label: "Fastly", icon: <CodeBracketsIcon className="size-4" /> },
    ],
  },
  {
    label: "Self-hosted",
    targets: [
      { value: "bare-metal", label: "Bare metal", icon: <WrenchIcon className="size-4" /> },
      { value: "kubernetes", label: "Kubernetes", icon: <WrenchIcon className="size-4" /> },
      { value: "postgres", label: "Postgres", icon: <FileTextIcon className="size-4" /> },
      { value: "cdn", label: "CDN", icon: <FileTextIcon className="size-4" /> },
    ],
  },
];

const allDeploymentTargets = deploymentGroups.flatMap((group) => group.targets);

export const WithIconsAndGroups: Story = {
  name: "With Icons and Groups",
  tags: ["!dev"],
  render: () => {
    const [value, setValue] = useState("aws");
    const selected = allDeploymentTargets.find((target) => target.value === value);

    return (
      <div className="w-72">
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger aria-label="Deployment target">
            <div className="flex min-w-0 items-center gap-2.5 truncate">
              {selected?.icon}
              <span className="truncate">{selected?.label ?? "Select deployment target"}</span>
            </div>
          </SelectTrigger>
          <SelectContent>
            {deploymentGroups.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.targets.map((target) => (
                  <SelectItem key={target.value} value={target.value} className="gap-3">
                    <span className="flex min-w-0 items-center gap-3">
                      {target.icon}
                      <span className="truncate">{target.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  },
};

export const ConcurrencyPolicy: Story = {
  name: "Concurrency Policy",
  tags: ["!dev"],
  render: () => (
    <div className="w-72">
      <Select defaultValue="forbid">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="forbid">Forbid</SelectItem>
          <SelectItem value="allow">Allow</SelectItem>
          <SelectItem value="replace">Replace</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
};

export const Small: Story = {
  name: "Small (h-9)",
  tags: ["!dev"],
  render: () => (
    <div className="w-72">
      <Select defaultValue="recent">
        <SelectTrigger size="md">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="recent">Recent</SelectItem>
          <SelectItem value="name">Name</SelectItem>
          <SelectItem value="created">Created</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
};
