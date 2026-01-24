import * as React from "react";
import { cn } from "../theme.ts";

export interface IconProps {
  className?: string;
}

type SvgProps = {
  className?: string;
  viewBox: string;
  fill: string;
  stroke: string;
  strokeWidth: string;
  strokeLinecap: "round";
  strokeLinejoin: "round";
};

function Svg(
  { className, children }: React.PropsWithChildren<Pick<SvgProps, "className">>,
): React.ReactElement {
  return React.createElement(
    "svg",
    {
      className: cn("size-4", className),
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

export function CircleIcon({ className }: IconProps): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    React.createElement("circle", { cx: "12", cy: "12", r: "10" }),
  );
}

export function ClockIcon({ className }: IconProps): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    React.createElement("circle", { cx: "12", cy: "12", r: "10" }),
    React.createElement("polyline", { points: "12 6 12 12 16 14" }),
  );
}

export function CheckCircleIcon({ className }: IconProps): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    React.createElement("path", { d: "M22 11.08V12a10 10 0 1 1-5.93-9.14" }),
    React.createElement("polyline", { points: "22 4 12 14.01 9 11.01" }),
  );
}

export function XCircleIcon({ className }: IconProps): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    React.createElement("circle", { cx: "12", cy: "12", r: "10" }),
    React.createElement("line", { x1: "15", y1: "9", x2: "9", y2: "15" }),
    React.createElement("line", { x1: "9", y1: "9", x2: "15", y2: "15" }),
  );
}

export function WrenchIcon({ className }: IconProps): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    React.createElement("path", {
      d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
    }),
  );
}

export function ChevronDownIcon({ className }: IconProps): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    React.createElement("polyline", { points: "6 9 12 15 18 9" }),
  );
}

export function BrainIcon({ className }: IconProps): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    React.createElement("path", {
      d: "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",
    }),
    React.createElement("path", {
      d: "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",
    }),
    React.createElement("path", { d: "M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" }),
    React.createElement("path", { d: "M17.599 6.5a3 3 0 0 0 .399-1.375" }),
    React.createElement("path", { d: "M6.003 5.125A3 3 0 0 0 6.401 6.5" }),
    React.createElement("path", { d: "M3.477 10.896a4 4 0 0 1 .585-.396" }),
    React.createElement("path", { d: "M19.938 10.5a4 4 0 0 1 .585.396" }),
    React.createElement("path", { d: "M6 18a4 4 0 0 1-1.967-.516" }),
    React.createElement("path", { d: "M19.967 17.484A4 4 0 0 1 18 18" }),
  );
}

export function MessageSquareIcon({ className }: IconProps): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    React.createElement("path", {
      d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    }),
  );
}

export function ArrowDownIcon({ className }: IconProps): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    React.createElement("line", { x1: "12", y1: "5", x2: "12", y2: "19" }),
    React.createElement("polyline", { points: "19 12 12 19 5 12" }),
  );
}

export function SendIcon({ className }: IconProps): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    React.createElement("line", { x1: "22", y1: "2", x2: "11", y2: "13" }),
    React.createElement("polygon", { points: "22 2 15 22 11 13 2 9 22 2" }),
  );
}

export function StopIcon({ className }: IconProps): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    React.createElement("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2", ry: "2" }),
  );
}

export function RefreshCwIcon({ className }: IconProps): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    React.createElement("path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }),
    React.createElement("path", { d: "M21 3v5h-5" }),
    React.createElement("path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }),
    React.createElement("path", { d: "M8 16H3v5" }),
  );
}

export function CopyIcon({ className }: IconProps): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    React.createElement("rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }),
    React.createElement("path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }),
  );
}

export function CheckIcon({ className }: IconProps): React.ReactElement {
  return React.createElement(
    Svg,
    { className },
    React.createElement("polyline", { points: "20 6 9 17 4 12" }),
  );
}
