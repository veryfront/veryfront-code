/**
 * Ai - Icons
 *
 * @module react/components/ai/icons
 */

import * as React from "react";
import { cn } from "../theme.ts";

export interface IconProps {
  className?: string;
}

type SvgProps = React.PropsWithChildren<{ className?: string }>;

function Svg({ className, children }: SvgProps): React.ReactElement {
  return React.createElement(
    "svg",
    {
      className: cn("size-4", className),
      width: "16",
      height: "16",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    children,
  );
}

type IconElementType =
  | "path"
  | "polyline"
  | "polygon"
  | "line"
  | "circle"
  | "rect";

interface IconElementSpec {
  type: IconElementType;
  props: Record<string, string>;
}

function renderIcon(
  className: string | undefined,
  elements: ReadonlyArray<IconElementSpec>,
): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    ...elements.map((element, index) =>
      React.createElement(element.type, {
        ...element.props,
        key: `${element.type}-${index}`,
      })
    ),
  );
}

const CIRCLE_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "circle", props: { cx: "12", cy: "12", r: "10" } },
];

const CLOCK_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "circle", props: { cx: "12", cy: "12", r: "10" } },
  { type: "polyline", props: { points: "12 6 12 12 16 14" } },
];

const CHECK_CIRCLE_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "path", props: { d: "M22 11.08V12a10 10 0 1 1-5.93-9.14" } },
  { type: "polyline", props: { points: "22 4 12 14.01 9 11.01" } },
];

const X_CIRCLE_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "circle", props: { cx: "12", cy: "12", r: "10" } },
  { type: "line", props: { x1: "15", y1: "9", x2: "9", y2: "15" } },
  { type: "line", props: { x1: "9", y1: "9", x2: "15", y2: "15" } },
];

const WRENCH_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  {
    type: "path",
    props: {
      d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
    },
  },
];

const CHEVRON_DOWN_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "polyline", props: { points: "6 9 12 15 18 9" } },
];

const BRAIN_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  {
    type: "path",
    props: {
      d: "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",
    },
  },
  {
    type: "path",
    props: {
      d: "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",
    },
  },
  { type: "path", props: { d: "M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" } },
  { type: "path", props: { d: "M17.599 6.5a3 3 0 0 0 .399-1.375" } },
  { type: "path", props: { d: "M6.003 5.125A3 3 0 0 0 6.401 6.5" } },
  { type: "path", props: { d: "M3.477 10.896a4 4 0 0 1 .585-.396" } },
  { type: "path", props: { d: "M19.938 10.5a4 4 0 0 1 .585.396" } },
  { type: "path", props: { d: "M6 18a4 4 0 0 1-1.967-.516" } },
  { type: "path", props: { d: "M19.967 17.484A4 4 0 0 1 18 18" } },
];

const MESSAGE_SQUARE_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  {
    type: "path",
    props: {
      d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    },
  },
];

const ARROW_DOWN_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "line", props: { x1: "12", y1: "5", x2: "12", y2: "19" } },
  { type: "polyline", props: { points: "19 12 12 19 5 12" } },
];

const SEND_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "line", props: { x1: "22", y1: "2", x2: "11", y2: "13" } },
  { type: "polygon", props: { points: "22 2 15 22 11 13 2 9 22 2" } },
];

const STOP_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  {
    type: "rect",
    props: { x: "3", y: "3", width: "18", height: "18", rx: "2", ry: "2" },
  },
];

const REFRESH_CW_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  {
    type: "path",
    props: { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" },
  },
  { type: "path", props: { d: "M21 3v5h-5" } },
  {
    type: "path",
    props: { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" },
  },
  { type: "path", props: { d: "M8 16H3v5" } },
];

const COPY_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  {
    type: "rect",
    props: { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" },
  },
  {
    type: "path",
    props: { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" },
  },
];

const PAPERCLIP_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  {
    type: "path",
    props: {
      d: "m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48",
    },
  },
];

const CHECK_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "polyline", props: { points: "20 6 9 17 4 12" } },
];

export function CircleIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, CIRCLE_ICON_ELEMENTS);
}

export function ClockIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, CLOCK_ICON_ELEMENTS);
}

export function CheckCircleIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, CHECK_CIRCLE_ICON_ELEMENTS);
}

export function XCircleIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, X_CIRCLE_ICON_ELEMENTS);
}

export function WrenchIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, WRENCH_ICON_ELEMENTS);
}

export function ChevronDownIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, CHEVRON_DOWN_ICON_ELEMENTS);
}

export function BrainIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, BRAIN_ICON_ELEMENTS);
}

export function MessageSquareIcon(
  { className }: IconProps,
): React.ReactElement {
  return renderIcon(className, MESSAGE_SQUARE_ICON_ELEMENTS);
}

export function ArrowDownIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, ARROW_DOWN_ICON_ELEMENTS);
}

export function SendIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, SEND_ICON_ELEMENTS);
}

export function StopIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, STOP_ICON_ELEMENTS);
}

export function RefreshCwIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, REFRESH_CW_ICON_ELEMENTS);
}

export function CopyIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, COPY_ICON_ELEMENTS);
}

export function PaperclipIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, PAPERCLIP_ICON_ELEMENTS);
}

export function CheckIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, CHECK_ICON_ELEMENTS);
}

const PLUS_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "line", props: { x1: "12", y1: "5", x2: "12", y2: "19" } },
  { type: "line", props: { x1: "5", y1: "12", x2: "19", y2: "12" } },
];

const TRASH_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "polyline", props: { points: "3 6 5 6 21 6" } },
  { type: "path", props: { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" } },
];

const PANEL_LEFT_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "rect", props: { width: "18", height: "18", x: "3", y: "3", rx: "2" } },
  { type: "line", props: { x1: "9", y1: "3", x2: "9", y2: "21" } },
];

const PENCIL_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "path", props: { d: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" } },
  { type: "path", props: { d: "m15 5 4 4" } },
];

export function PlusIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, PLUS_ICON_ELEMENTS);
}

export function TrashIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, TRASH_ICON_ELEMENTS);
}

export function PanelLeftIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, PANEL_LEFT_ICON_ELEMENTS);
}

export function PencilIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, PENCIL_ICON_ELEMENTS);
}

const SPARKLES_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "path", props: { d: "m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" } },
  { type: "path", props: { d: "M5 3v4" } },
  { type: "path", props: { d: "M19 17v4" } },
  { type: "path", props: { d: "M3 5h4" } },
  { type: "path", props: { d: "M17 19h4" } },
];

export function SparklesIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, SPARKLES_ICON_ELEMENTS);
}

const CODE_BRACKETS_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "polyline", props: { points: "16 18 22 12 16 6" } },
  { type: "polyline", props: { points: "8 6 2 12 8 18" } },
];

const TARGET_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "circle", props: { cx: "12", cy: "12", r: "10" } },
  { type: "circle", props: { cx: "12", cy: "12", r: "6" } },
  { type: "circle", props: { cx: "12", cy: "12", r: "2" } },
];

const FILE_TEXT_ICON_ELEMENTS: ReadonlyArray<IconElementSpec> = [
  { type: "path", props: { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" } },
  { type: "polyline", props: { points: "14 2 14 8 20 8" } },
  { type: "line", props: { x1: "16", y1: "13", x2: "8", y2: "13" } },
  { type: "line", props: { x1: "16", y1: "17", x2: "8", y2: "17" } },
  { type: "polyline", props: { points: "10 9 9 9 8 9" } },
];

export function CodeBracketsIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, CODE_BRACKETS_ICON_ELEMENTS);
}

export function TargetIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, TARGET_ICON_ELEMENTS);
}

export function FileTextIcon({ className }: IconProps): React.ReactElement {
  return renderIcon(className, FILE_TEXT_ICON_ELEMENTS);
}
