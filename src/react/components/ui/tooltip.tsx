/**
 * Accessible tooltip primitives with a Radix-shaped API:
 * `TooltipProvider`, `Tooltip`, `TooltipTrigger`, and `TooltipContent`.
 *
 * A tooltip opens after the provider delay while its trigger is hovered or
 * focused. Content is portalled into the trigger document's nearest Veryfront
 * UI scope, positioned against the trigger, and dismissed with Escape.
 *
 * Each `Tooltip` owns one trigger and one content element. This invariant keeps
 * the generated IDs, interaction state, and positioning anchor unambiguous.
 *
 * @module react/components/ui/tooltip
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { cx as cn } from "./cva.ts";
import { UI_SCOPE_SELECTOR } from "./design-tokens.ts";
import { registerDismissableLayer } from "./dismissable-layer.ts";

type Side = "top" | "bottom" | "left" | "right";

const DEFAULT_PROVIDER_DELAY_MS = 700;
const MAX_PROVIDER_DELAY_MS = 5_000;
const DEFAULT_SIDE_OFFSET_PX = 6;
const VIEWPORT_PADDING_PX = 8;
const ARROW_EDGE_INSET_PX = 8;
const useIsomorphicLayoutEffect = typeof document === "undefined"
  ? React.useEffect
  : React.useLayoutEffect;

const REACT_MAJOR_VERSION = Number.parseInt(React.version, 10);
const SUPPORTS_REF_CLEANUP = Number.isFinite(REACT_MAJOR_VERSION) &&
  REACT_MAJOR_VERSION >= 19;

interface TooltipProviderValue {
  delayDuration: number;
}

interface TooltipContextValue {
  contentId: string;
  contentPresent: boolean;
  generatedContentId: string;
  generatedTriggerId: string;
  open: boolean;
  triggerElement: HTMLElement | null;
  dismiss: () => void;
  endFocus: () => void;
  endHover: () => void;
  registerContent: (id: string) => () => void;
  setTriggerDisabled: (element: HTMLElement, disabled: boolean) => void;
  setTriggerElement: (element: HTMLElement | null) => void;
  startFocus: () => void;
  startHover: () => void;
}

interface InteractionState {
  disabled: boolean;
  dismissed: boolean;
  focused: boolean;
  hovered: boolean;
}

interface TimerHost {
  clearTimeout(handle: number): void;
  setTimeout(handler: () => void, timeout: number): number;
}

interface PendingTimer {
  handle: number;
  host: TimerHost;
}

interface TooltipPosition {
  arrowOffset: number;
  left: number;
  side: Side;
  top: number;
  visible: boolean;
}

const TooltipProviderContext = React.createContext<TooltipProviderValue | null>(
  null,
);
const TooltipContext = React.createContext<TooltipContextValue | null>(null);

function normalizeDelayDuration(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PROVIDER_DELAY_MS;
  }
  return Math.min(MAX_PROVIDER_DELAY_MS, Math.max(0, value));
}

function normalizeSideOffset(value: number): number {
  return Number.isFinite(value) ? value : DEFAULT_SIDE_OFFSET_PX;
}

function stableDomId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "");
}

function mergeIdRefs(...values: Array<string | undefined>): string | undefined {
  const ids = new Set<string>();
  for (const value of values) {
    for (const id of value?.trim().split(/\s+/) ?? []) {
      if (id) ids.add(id);
    }
  }
  return ids.size > 0 ? [...ids].join(" ") : undefined;
}

function isElementDisabled(element: HTMLElement): boolean {
  return (element as HTMLElement & { disabled?: boolean }).disabled === true ||
    element.getAttribute("aria-disabled") === "true" ||
    element.matches(":disabled");
}

function containsRelatedTarget(
  element: HTMLElement,
  relatedTarget: EventTarget | null,
): boolean {
  return relatedTarget !== null &&
    typeof (relatedTarget as { nodeType?: unknown }).nodeType === "number" &&
    element.contains(relatedTarget as Node);
}

function composeEventHandlers<E extends { defaultPrevented: boolean }>(
  consumerHandler: ((event: E) => void) | undefined,
  tooltipHandler: (event: E) => void,
): (event: E) => void {
  return (event) => {
    consumerHandler?.(event);
    if (!event.defaultPrevented) tooltipHandler(event);
  };
}

function useDelayedOpen(
  delayDuration: number,
  canOpen: () => boolean,
  getTimerWindow: () => Window | null,
): {
  clearPending: () => void;
  close: () => void;
  open: boolean;
  requestOpen: () => void;
} {
  const [open, setOpen] = React.useState(false);
  const openRef = React.useRef(false);
  const pendingRef = React.useRef<PendingTimer | null>(null);

  const clearPending = React.useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pending.host.clearTimeout(pending.handle);
    pendingRef.current = null;
  }, []);

  const close = React.useCallback(() => {
    clearPending();
    openRef.current = false;
    setOpen(false);
  }, [clearPending]);

  const requestOpen = React.useCallback(() => {
    if (openRef.current || pendingRef.current || !canOpen()) return;
    if (delayDuration === 0) {
      openRef.current = true;
      setOpen(true);
      return;
    }

    const host: TimerHost = getTimerWindow() ?? globalThis;
    const handle = host.setTimeout(() => {
      pendingRef.current = null;
      if (!canOpen()) return;
      openRef.current = true;
      setOpen(true);
    }, delayDuration);
    pendingRef.current = { handle, host };
  }, [canOpen, delayDuration, getTimerWindow]);

  React.useEffect(() => clearPending, [clearPending]);

  return { clearPending, close, open, requestOpen };
}

function useTooltipInteractions(
  delayDuration: number,
  triggerRef: React.RefObject<HTMLElement | null>,
): {
  dismiss: () => void;
  endFocus: () => void;
  endHover: () => void;
  open: boolean;
  reset: () => void;
  setDisabled: (disabled: boolean) => void;
  startFocus: () => void;
  startHover: () => void;
} {
  const stateRef = React.useRef<InteractionState>({
    disabled: false,
    dismissed: false,
    focused: false,
    hovered: false,
  });
  const canOpen = React.useCallback(() => {
    const state = stateRef.current;
    return !state.disabled && !state.dismissed &&
      (state.hovered || state.focused);
  }, []);
  const getTimerWindow = React.useCallback(
    () => triggerRef.current?.ownerDocument.defaultView ?? null,
    [triggerRef],
  );
  const delayed = useDelayedOpen(delayDuration, canOpen, getTimerWindow);

  const closeIfInactive = React.useCallback(() => {
    const state = stateRef.current;
    if (state.hovered || state.focused) return;
    state.dismissed = false;
    delayed.close();
  }, [delayed.close]);

  const startHover = React.useCallback(() => {
    stateRef.current.hovered = true;
    delayed.requestOpen();
  }, [delayed.requestOpen]);
  const endHover = React.useCallback(() => {
    stateRef.current.hovered = false;
    closeIfInactive();
  }, [closeIfInactive]);
  const startFocus = React.useCallback(() => {
    stateRef.current.focused = true;
    delayed.requestOpen();
  }, [delayed.requestOpen]);
  const endFocus = React.useCallback(() => {
    stateRef.current.focused = false;
    closeIfInactive();
  }, [closeIfInactive]);

  const dismiss = React.useCallback(() => {
    stateRef.current.dismissed = true;
    delayed.close();
  }, [delayed.close]);
  const reset = React.useCallback(() => {
    const state = stateRef.current;
    state.dismissed = false;
    state.focused = false;
    state.hovered = false;
    delayed.close();
  }, [delayed.close]);
  const setDisabled = React.useCallback((disabled: boolean) => {
    stateRef.current.disabled = disabled;
    if (disabled) reset();
  }, [reset]);

  useIsomorphicLayoutEffect(() => {
    delayed.clearPending();
    if (canOpen()) delayed.requestOpen();
  }, [canOpen, delayDuration, delayed.clearPending, delayed.requestOpen]);

  return {
    dismiss,
    endFocus,
    endHover,
    open: delayed.open,
    reset,
    setDisabled,
    startFocus,
    startHover,
  };
}

/** Provide a shared opening delay. The default is 700 ms and values are clamped to 0-5000 ms. */
export function TooltipProvider(
  {
    children,
    delayDuration = DEFAULT_PROVIDER_DELAY_MS,
  }: { children: React.ReactNode; delayDuration?: number },
): React.ReactElement {
  const value = React.useMemo(
    () => ({ delayDuration: normalizeDelayDuration(delayDuration) }),
    [delayDuration],
  );
  return (
    <TooltipProviderContext.Provider value={value}>
      {children}
    </TooltipProviderContext.Provider>
  );
}

/** Tooltip root that owns trigger interaction, IDs, and dismissal state. */
export function Tooltip(
  { children }: { children: React.ReactNode },
): React.ReactElement {
  const provider = React.useContext(TooltipProviderContext);
  const reactId = stableDomId(React.useId());
  const generatedTriggerId = `vf-tooltip-trigger-${reactId}`;
  const generatedContentId = `vf-tooltip-content-${reactId}`;
  const triggerRef = React.useRef<HTMLElement>(null);
  const [triggerElement, setTriggerElementState] = React.useState<HTMLElement | null>(null);
  const [contentId, setContentId] = React.useState(generatedContentId);
  const [contentPresent, setContentPresent] = React.useState(false);
  const registeredContentIdRef = React.useRef<string | null>(null);
  const interactions = useTooltipInteractions(
    provider?.delayDuration ?? 0,
    triggerRef,
  );

  const setTriggerElement = React.useCallback((element: HTMLElement | null) => {
    const previous = triggerRef.current;
    if (previous === element) return;
    triggerRef.current = element;
    setTriggerElementState(element);
    if (previous !== null) interactions.reset();
  }, [interactions.reset]);

  const setTriggerDisabled = React.useCallback(
    (element: HTMLElement, disabled: boolean) => {
      if (triggerRef.current === element) interactions.setDisabled(disabled);
    },
    [interactions.setDisabled],
  );

  const registerContent = React.useCallback((id: string) => {
    registeredContentIdRef.current = id;
    setContentId(id);
    setContentPresent(true);
    return () => {
      if (registeredContentIdRef.current !== id) return;
      registeredContentIdRef.current = null;
      setContentId(generatedContentId);
      setContentPresent(false);
    };
  }, [generatedContentId]);

  const value = React.useMemo<TooltipContextValue>(
    () => ({
      contentId,
      contentPresent,
      dismiss: interactions.dismiss,
      endFocus: interactions.endFocus,
      endHover: interactions.endHover,
      generatedContentId,
      generatedTriggerId,
      open: interactions.open,
      registerContent,
      setTriggerDisabled,
      setTriggerElement,
      startFocus: interactions.startFocus,
      startHover: interactions.startHover,
      triggerElement,
    }),
    [
      contentId,
      contentPresent,
      generatedContentId,
      generatedTriggerId,
      interactions.dismiss,
      interactions.endFocus,
      interactions.endHover,
      interactions.open,
      interactions.startFocus,
      interactions.startHover,
      registerContent,
      setTriggerDisabled,
      setTriggerElement,
      triggerElement,
    ],
  );

  return (
    <span className="relative inline-flex">
      <TooltipContext.Provider value={value}>
        {children}
      </TooltipContext.Provider>
    </span>
  );
}

type TriggerChildProps =
  & React.HTMLAttributes<HTMLElement>
  & {
    disabled?: boolean;
    id?: string;
    ref?: React.Ref<HTMLElement>;
  };

type AnyProps = Record<string, unknown>;

function getChildRef(
  child: React.ReactElement<TriggerChildProps>,
  childProps: TriggerChildProps,
): React.Ref<HTMLElement> | undefined {
  if (childProps.ref !== undefined) return childProps.ref;
  // React 18 stores `ref` on the element rather than in `props`. React 19
  // warns when `element.ref` is read, so only use the legacy location when the
  // running React version is known to predate the props-based contract.
  if (
    Number.isFinite(REACT_MAJOR_VERSION) &&
    REACT_MAJOR_VERSION > 0 &&
    REACT_MAJOR_VERSION < 19
  ) {
    return (child as React.ReactElement<TriggerChildProps> & {
      ref?: React.Ref<HTMLElement>;
    }).ref;
  }
  return undefined;
}

function mergeAsChildProps(
  triggerProps: AnyProps,
  childProps: AnyProps,
): AnyProps {
  const merged: AnyProps = { ...triggerProps, ...childProps };
  for (const propName of Object.keys(childProps)) {
    const triggerValue = triggerProps[propName];
    const childValue = childProps[propName];
    if (
      /^on[A-Z]/.test(propName) &&
      typeof triggerValue === "function" &&
      typeof childValue === "function"
    ) {
      merged[propName] = (...args: unknown[]) => {
        (childValue as (...values: unknown[]) => void)(...args);
        (triggerValue as (...values: unknown[]) => void)(...args);
      };
    } else if (
      /^on[A-Z]/.test(propName) &&
      typeof triggerValue === "function"
    ) {
      merged[propName] = triggerValue;
    } else if (propName === "className") {
      merged[propName] = [triggerValue, childValue].filter(Boolean).join(" ");
    } else if (propName === "style") {
      merged[propName] = {
        ...(triggerValue as object),
        ...(childValue as object),
      };
    }
  }
  return merged;
}

function useComposedTriggerRef(
  triggerRef: React.RefCallback<HTMLElement>,
  childRef: React.Ref<HTMLElement> | undefined,
): React.RefCallback<HTMLElement> {
  const elementRef = React.useRef<HTMLElement | null>(null);
  const latestChildRef = React.useRef(childRef);
  const assignedChildRef = React.useRef<{
    cleanup?: () => void;
    ref: React.Ref<HTMLElement> | undefined;
  }>({ ref: undefined });
  latestChildRef.current = childRef;

  const detachChildRef = React.useCallback(() => {
    const assignment = assignedChildRef.current;
    assignedChildRef.current = { ref: undefined };
    if (assignment.cleanup) assignment.cleanup();
    else if (typeof assignment.ref === "function") assignment.ref(null);
    else if (assignment.ref) assignment.ref.current = null;
  }, []);

  const attachChildRef = React.useCallback(
    (ref: React.Ref<HTMLElement> | undefined, element: HTMLElement) => {
      const cleanup = typeof ref === "function" ? ref(element) : undefined;
      if (ref && typeof ref !== "function") ref.current = element;
      assignedChildRef.current = {
        cleanup: typeof cleanup === "function" ? cleanup : undefined,
        ref,
      };
    },
    [],
  );

  const composedRef = React.useCallback((element: HTMLElement | null) => {
    if (element === null) {
      if (elementRef.current === null) return;
      detachChildRef();
      elementRef.current = null;
      triggerRef(null);
      return;
    }

    elementRef.current = element;
    triggerRef(element);
    attachChildRef(latestChildRef.current, element);
    if (SUPPORTS_REF_CLEANUP) {
      return () => {
        if (elementRef.current !== element) return;
        detachChildRef();
        elementRef.current = null;
        triggerRef(null);
      };
    }
  }, [attachChildRef, detachChildRef, triggerRef]);

  useIsomorphicLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || assignedChildRef.current.ref === childRef) return;
    detachChildRef();
    attachChildRef(childRef, element);
  }, [attachChildRef, childRef, detachChildRef]);

  return composedRef;
}

/**
 * Tooltip trigger. The default span is keyboard-focusable; `asChild` merges
 * behavior onto one child element and retains that element's focus contract.
 */
export function TooltipTrigger(
  {
    children,
    asChild,
    id,
    "aria-describedby": describedBy,
    onBlur,
    onFocus,
    onKeyDown,
    onMouseEnter,
    onMouseLeave,
    tabIndex,
    ...props
  }:
    & React.HTMLAttributes<HTMLElement>
    & { children: React.ReactNode; asChild?: boolean },
): React.ReactElement {
  const context = React.useContext(TooltipContext);
  const child = asChild && React.isValidElement(children)
    ? children as React.ReactElement<TriggerChildProps>
    : null;
  const childProps = child?.props;
  const resolvedId = childProps?.id?.trim() || id?.trim() ||
    context?.generatedTriggerId;
  const resolvedDescribedBy = mergeIdRefs(
    childProps?.["aria-describedby"],
    describedBy,
    context?.open && context.contentPresent ? context.contentId : undefined,
  );
  const declaredDisabled = props["aria-disabled"] === true ||
    props["aria-disabled"] === "true" ||
    (props as TriggerChildProps).disabled === true ||
    childProps?.["aria-disabled"] === true ||
    childProps?.["aria-disabled"] === "true" ||
    childProps?.disabled === true;

  const triggerRef = React.useCallback((element: HTMLElement | null) => {
    context?.setTriggerElement(element);
  }, [context?.setTriggerElement]);
  const childRef = child && childProps ? getChildRef(child, childProps) : undefined;
  const composedRef = useComposedTriggerRef(triggerRef, childRef);

  useIsomorphicLayoutEffect(() => {
    const element = context?.triggerElement;
    if (!element) return;
    const updateDisabled = (): void => {
      context.setTriggerDisabled(
        element,
        declaredDisabled || isElementDisabled(element),
      );
    };
    updateDisabled();
    const MutationObserverCtor = element.ownerDocument.defaultView?.MutationObserver;
    const observer = MutationObserverCtor ? new MutationObserverCtor(updateDisabled) : null;
    observer?.observe(element, {
      attributeFilter: ["aria-disabled", "disabled"],
      attributes: true,
    });
    return () => {
      observer?.disconnect();
      context.setTriggerDisabled(element, true);
    };
  }, [
    context?.setTriggerDisabled,
    context?.triggerElement,
    declaredDisabled,
  ]);

  const internalMouseEnter = (event: React.MouseEvent<HTMLElement>): void => {
    if (!declaredDisabled && !isElementDisabled(event.currentTarget)) {
      context?.startHover();
    }
  };
  const internalMouseLeave = (): void => context?.endHover();
  const internalFocus = (event: React.FocusEvent<HTMLElement>): void => {
    if (!declaredDisabled && !isElementDisabled(event.currentTarget)) {
      context?.startFocus();
    }
  };
  const internalBlur = (event: React.FocusEvent<HTMLElement>): void => {
    if (!containsRelatedTarget(event.currentTarget, event.relatedTarget)) {
      context?.endFocus();
    }
  };
  const internalKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Escape") context?.dismiss();
  };

  const triggerProps: AnyProps & React.HTMLAttributes<HTMLElement> & {
    ref: React.RefCallback<HTMLElement>;
  } = {
    ...props,
    "aria-describedby": resolvedDescribedBy,
    id: resolvedId,
    onBlur: composeEventHandlers(onBlur, internalBlur),
    onFocus: composeEventHandlers(onFocus, internalFocus),
    onKeyDown: composeEventHandlers(onKeyDown, internalKeyDown),
    onMouseEnter: composeEventHandlers(onMouseEnter, internalMouseEnter),
    onMouseLeave: composeEventHandlers(onMouseLeave, internalMouseLeave),
    ref: composedRef,
    tabIndex: child ? tabIndex : (tabIndex ?? 0),
  };

  if (!child) return <span {...triggerProps}>{children}</span>;
  const mergedProps = mergeAsChildProps(
    triggerProps,
    childProps as AnyProps,
  );
  mergedProps["aria-describedby"] = resolvedDescribedBy;
  mergedProps.id = resolvedId;
  mergedProps.ref = composedRef;
  return React.cloneElement(child, mergedProps);
}

/** Which viewport edge each side would collide with, and its opposite. */
const opposite: Record<Side, Side> = {
  bottom: "top",
  left: "right",
  right: "left",
  top: "bottom",
};

function availableSpace(
  anchor: DOMRect,
  side: Side,
  viewportWidth: number,
  viewportHeight: number,
  offset: number,
): number {
  if (side === "top") return anchor.top - offset - VIEWPORT_PADDING_PX;
  if (side === "bottom") {
    return viewportHeight - anchor.bottom - offset - VIEWPORT_PADDING_PX;
  }
  if (side === "left") return anchor.left - offset - VIEWPORT_PADDING_PX;
  return viewportWidth - anchor.right - offset - VIEWPORT_PADDING_PX;
}

function clampAxis(value: number, contentSize: number, viewportSize: number): number {
  const minimum = Math.min(
    VIEWPORT_PADDING_PX,
    Math.max(0, viewportSize - contentSize),
  );
  const maximum = Math.max(
    minimum,
    viewportSize - contentSize - VIEWPORT_PADDING_PX,
  );
  return Math.min(Math.max(value, minimum), maximum);
}

function clampArrowOffset(value: number, contentSize: number): number {
  const inset = Math.min(ARROW_EDGE_INSET_PX, contentSize / 2);
  return Math.min(Math.max(value, inset), contentSize - inset);
}

/** Compute a fixed-position rect, flipping to the roomier opposite side on collision. */
function place(
  anchor: DOMRect,
  contentWidth: number,
  contentHeight: number,
  side: Side,
  offset: number,
  viewportWidth: number,
  viewportHeight: number,
): Omit<TooltipPosition, "visible"> {
  const oppositeSide = opposite[side];
  const required = side === "top" || side === "bottom" ? contentHeight : contentWidth;
  const preferredSpace = availableSpace(
    anchor,
    side,
    viewportWidth,
    viewportHeight,
    offset,
  );
  const oppositeSpace = availableSpace(
    anchor,
    oppositeSide,
    viewportWidth,
    viewportHeight,
    offset,
  );
  const chosen = preferredSpace >= required ||
      preferredSpace >= oppositeSpace
    ? side
    : oppositeSide;

  let idealTop: number;
  let idealLeft: number;
  if (chosen === "top") {
    idealTop = anchor.top - offset - contentHeight;
    idealLeft = anchor.left + anchor.width / 2 - contentWidth / 2;
  } else if (chosen === "bottom") {
    idealTop = anchor.bottom + offset;
    idealLeft = anchor.left + anchor.width / 2 - contentWidth / 2;
  } else if (chosen === "left") {
    idealTop = anchor.top + anchor.height / 2 - contentHeight / 2;
    idealLeft = anchor.left - offset - contentWidth;
  } else {
    idealTop = anchor.top + anchor.height / 2 - contentHeight / 2;
    idealLeft = anchor.right + offset;
  }

  const left = clampAxis(idealLeft, contentWidth, viewportWidth);
  const top = clampAxis(idealTop, contentHeight, viewportHeight);
  const verticalSide = chosen === "top" || chosen === "bottom";
  return {
    arrowOffset: verticalSide
      ? clampArrowOffset(
        anchor.left + anchor.width / 2 - left,
        contentWidth,
      )
      : clampArrowOffset(
        anchor.top + anchor.height / 2 - top,
        contentHeight,
      ),
    left,
    side: chosen,
    top,
  };
}

function samePosition(
  current: TooltipPosition,
  next: TooltipPosition,
): boolean {
  return current.arrowOffset === next.arrowOffset &&
    current.left === next.left &&
    current.side === next.side &&
    current.top === next.top &&
    current.visible === next.visible;
}

function trackPosition(
  trigger: HTMLElement,
  content: HTMLDivElement,
  side: Side,
  sideOffset: number,
  onPosition: (position: TooltipPosition) => void,
): () => void {
  const ownerDocument = trigger.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  const update = (): void => {
    const anchor = trigger.getBoundingClientRect();
    const viewportWidth = ownerWindow?.innerWidth ??
      ownerDocument.documentElement.clientWidth;
    const viewportHeight = ownerWindow?.innerHeight ??
      ownerDocument.documentElement.clientHeight;
    onPosition({
      ...place(
        anchor,
        content.offsetWidth,
        content.offsetHeight,
        side,
        sideOffset,
        viewportWidth,
        viewportHeight,
      ),
      visible: true,
    });
  };

  update();
  const animationFrame = typeof ownerWindow?.requestAnimationFrame === "function"
    ? ownerWindow.requestAnimationFrame(update)
    : undefined;
  ownerDocument.addEventListener("scroll", update, true);
  ownerWindow?.addEventListener("resize", update);
  const ResizeObserverCtor = ownerWindow?.ResizeObserver;
  const resizeObserver = ResizeObserverCtor ? new ResizeObserverCtor(update) : null;
  resizeObserver?.observe(trigger);
  resizeObserver?.observe(content);

  return () => {
    if (animationFrame !== undefined) {
      ownerWindow?.cancelAnimationFrame?.(animationFrame);
    }
    ownerDocument.removeEventListener("scroll", update, true);
    ownerWindow?.removeEventListener("resize", update);
    resizeObserver?.disconnect();
  };
}

// The rotated square straddles the trigger-facing edge of the tooltip.
const arrowClasses: Record<Side, string> = {
  bottom: "bottom-full -translate-x-1/2 translate-y-1/2 rotate-45",
  left: "left-full -translate-x-1/2 -translate-y-1/2 rotate-45",
  right: "right-full translate-x-1/2 -translate-y-1/2 rotate-45",
  top: "top-full -translate-x-1/2 -translate-y-1/2 rotate-45",
};

/** Props accepted by `<TooltipContent>`. */
export interface TooltipContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: Side;
  sideOffset?: number;
}

/** Tooltip content, portalled and collision-positioned against its trigger. */
export function TooltipContent(
  {
    side = "top",
    sideOffset = DEFAULT_SIDE_OFFSET_PX,
    className,
    children,
    id,
    style,
    ...props
  }: TooltipContentProps,
): React.ReactElement | null {
  const context = React.useContext(TooltipContext);
  const ref = React.useRef<HTMLDivElement>(null);
  const [portalReady, setPortalReady] = React.useState(false);
  const [position, setPosition] = React.useState<TooltipPosition>({
    arrowOffset: 0,
    left: 0,
    side,
    top: 0,
    visible: false,
  });
  const resolvedId = id?.trim() || context?.generatedContentId || "";
  const registerContent = context?.registerContent;
  const open = context?.open ?? false;
  const triggerElement = context?.triggerElement ?? null;
  const dismiss = context?.dismiss;
  const offset = normalizeSideOffset(sideOffset);

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!registerContent || !resolvedId) return;
    return registerContent(resolvedId);
  }, [registerContent, resolvedId]);

  useIsomorphicLayoutEffect(() => {
    const content = ref.current;
    if (!open || !portalReady || !triggerElement || !content) {
      setPosition((current) => current.visible ? { ...current, visible: false } : current);
      return;
    }
    return trackPosition(
      triggerElement,
      content,
      side,
      offset,
      (next) => {
        setPosition((current) => samePosition(current, next) ? current : next);
      },
    );
  }, [offset, open, portalReady, side, triggerElement]);

  useIsomorphicLayoutEffect(() => {
    const content = ref.current;
    if (!open || !portalReady || !content || !dismiss) return;
    return registerDismissableLayer(
      content.ownerDocument,
      () => ref.current,
      dismiss,
    );
  }, [dismiss, open, portalReady]);

  if (!open || !portalReady || !triggerElement) return null;
  const ownerDocument = triggerElement.ownerDocument;
  const container = triggerElement.closest<HTMLElement>(UI_SCOPE_SELECTOR) ??
    ownerDocument.body;

  return createPortal(
    <div
      {...props}
      ref={ref}
      id={resolvedId}
      role="tooltip"
      className={cn(
        "fixed z-[60] w-max rounded-md bg-[var(--primary)] px-2.5 py-1 text-xs font-medium text-[var(--secondary)] shadow-sm pointer-events-none",
        "dark:bg-[var(--secondary)] dark:text-[var(--foreground)]",
        className,
      )}
      style={{
        left: position.left,
        maxWidth: "min(20rem, calc(100vw - 1rem))",
        overflowWrap: "anywhere",
        position: "fixed",
        top: position.top,
        visibility: position.visible ? "visible" : "hidden",
        whiteSpace: "normal",
        ...style,
      }}
    >
      {children}
      <span
        aria-hidden="true"
        className={cn(
          "absolute size-2 bg-[var(--primary)] dark:bg-[var(--secondary)]",
          arrowClasses[position.side],
        )}
        style={position.side === "top" || position.side === "bottom"
          ? { left: position.arrowOffset }
          : { top: position.arrowOffset }}
      />
    </div>,
    container,
  );
}
