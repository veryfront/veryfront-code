import * as React from "react";
import { COMPONENT_ERROR } from "#veryfront/errors/error-registry.ts";
import type { Source } from "./sources.tsx";
import { cn } from "../../theme.ts";

/** Props accepted by inline citation. */
export interface InlineCitationProps {
  index: number;
  source?: Source;
  className?: string;
  onClick?: (index: number) => void;
  /** Compose the trigger and hover card. */
  children?: React.ReactNode;
}

interface InlineCitationContextValue {
  index: number;
  source?: Source;
  triggerClasses?: string;
  onCitationClick?: (index: number) => void;
  cardVisible: boolean;
  cardStyle: React.CSSProperties;
  show: () => void;
  hide: () => void;
  setTriggerRef: (node: HTMLButtonElement | null) => void;
  setCardRef: (node: HTMLDivElement | null) => void;
}

const InlineCitationContext = React.createContext<InlineCitationContextValue | null>(null);

function useInlineCitation(): InlineCitationContextValue {
  const context = React.useContext(InlineCitationContext);
  if (!context) {
    throw COMPONENT_ERROR.create({
      detail: "InlineCitation parts must be used within an InlineCitation",
    });
  }
  return context;
}

/** Props accepted by `InlineCitation.Trigger`. */
export interface InlineCitationTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** Numbered citation trigger. */
function InlineCitationTrigger({
  className,
  children,
  onClick,
  onMouseEnter,
  onMouseLeave,
  ref,
  ...props
}: InlineCitationTriggerProps): React.ReactElement {
  const {
    index,
    triggerClasses,
    onCitationClick,
    show,
    hide,
    setTriggerRef,
  } = useInlineCitation();

  const setRef = React.useCallback((node: HTMLButtonElement | null) => {
    setTriggerRef(node);
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [ref, setTriggerRef]);

  return (
    <span className="relative inline-block">
      <button
        {...props}
        ref={setRef}
        type={props.type ?? "button"}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) onCitationClick?.(index);
        }}
        onMouseEnter={(event) => {
          show();
          onMouseEnter?.(event);
        }}
        onMouseLeave={(event) => {
          hide();
          onMouseLeave?.(event);
        }}
        className={cn(
          "inline-flex items-center justify-center",
          "size-[15px] rounded-full border border-[var(--outline-border)] text-[10px] font-semibold leading-none tabular-nums",
          "bg-[var(--secondary)] text-[var(--soft)] shadow-sm",
          "hover:border-[var(--faint)] hover:text-[var(--foreground)] transition-colors",
          "cursor-pointer align-super -translate-y-px ml-0.5",
          triggerClasses,
          className,
        )}
      >
        {children ?? index + 1}
      </button>
    </span>
  );
}
InlineCitationTrigger.displayName = "InlineCitation.Trigger";

/** Props accepted by `InlineCitation.Card`. */
export interface InlineCitationCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Positioned hover card. */
function InlineCitationCard({
  className,
  children,
  style,
  onMouseEnter,
  onMouseLeave,
  ref,
  ...props
}: InlineCitationCardProps): React.ReactElement | null {
  const {
    source,
    cardVisible,
    cardStyle,
    show,
    hide,
    setCardRef,
  } = useInlineCitation();

  const setRef = React.useCallback((node: HTMLDivElement | null) => {
    setCardRef(node);
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [ref, setCardRef]);

  if (!cardVisible || !source) return null;

  return (
    <div
      {...props}
      ref={setRef}
      style={{ ...cardStyle, ...style }}
      className={cn("w-80 animate-in fade-in duration-150", className)}
      onMouseEnter={(event) => {
        show();
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        hide();
        onMouseLeave?.(event);
      }}
    >
      {children ?? <InlineCitationCardBody source={source} />}
    </div>
  );
}
InlineCitationCard.displayName = "InlineCitation.Card";

function InlineCitationCardBody({ source }: { source: Source }): React.ReactElement {
  return (
    <div className="rounded-lg bg-[var(--popover)] p-3.5 text-left shadow-sm">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--foreground)] line-clamp-2">
          {source.title}
        </p>
        {source.url && (
          <p className="text-[10px] text-[var(--faint)] truncate mt-1 flex items-center gap-1">
            <svg
              className="size-2.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1 2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            {source.url}
          </p>
        )}
      </div>

      {source.snippet && (
        <div className="mt-2.5 border-l-2 border-[var(--outline-border)] pl-3">
          <p className="text-xs text-[var(--foreground)] line-clamp-4 leading-relaxed italic">
            {source.snippet}
          </p>
        </div>
      )}

      {source.score != null && (
        <div className="mt-2.5 flex items-center gap-2">
          <span className="text-[10px] text-[var(--faint)] shrink-0">
            Relevance
          </span>
          <div className="flex-1 h-1 rounded-full bg-[var(--edge-medium)] overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                source.score >= 0.7
                  ? "bg-emerald-500"
                  : source.score >= 0.4
                  ? "bg-amber-500"
                  : "bg-neutral-400",
              )}
              style={{ width: `${Math.round(source.score * 100)}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-[var(--faint)]">
            {Math.round(source.score * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}

/** Render inline citation. */
function InlineCitationRoot({
  index,
  source,
  className,
  onClick,
  children,
}: InlineCitationProps): React.ReactElement {
  const [cardVisible, setCardVisible] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [cardStyle, setCardStyle] = React.useState<React.CSSProperties>({});

  const positionCard = React.useCallback((card: HTMLDivElement | null) => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const measuredWidth = card?.getBoundingClientRect().width || 320;
    const viewportWidth = globalThis.innerWidth;
    const viewportHeight = globalThis.innerHeight;
    const centeredLeft = triggerRect.left + triggerRect.width / 2 - measuredWidth / 2;
    setCardStyle({
      position: "fixed",
      left: Math.max(8, Math.min(centeredLeft, viewportWidth - measuredWidth - 8)),
      bottom: viewportHeight - triggerRect.top + 8,
      zIndex: 9999,
    });
  }, []);

  const show = React.useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      positionCard(cardRef.current);
      setCardVisible(true);
    }, 150);
  }, [positionCard]);

  const hide = React.useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCardVisible(false), 100);
  }, []);

  const setTriggerRef = React.useCallback((node: HTMLButtonElement | null) => {
    triggerRef.current = node;
  }, []);
  const setCardRef = React.useCallback((node: HTMLDivElement | null) => {
    cardRef.current = node;
    if (node) positionCard(node);
  }, [positionCard]);

  React.useEffect(() => () => clearTimeout(timerRef.current), []);

  const contextValue = React.useMemo<InlineCitationContextValue>(() => ({
    index,
    source,
    triggerClasses: className,
    onCitationClick: onClick,
    cardVisible,
    cardStyle,
    show,
    hide,
    setTriggerRef,
    setCardRef,
  }), [
    index,
    source,
    className,
    onClick,
    cardVisible,
    cardStyle,
    show,
    hide,
    setTriggerRef,
    setCardRef,
  ]);

  return (
    <InlineCitationContext.Provider value={contextValue}>
      {children ?? (
        <>
          <InlineCitationTrigger />
          <InlineCitationCard />
        </>
      )}
    </InlineCitationContext.Provider>
  );
}
InlineCitationRoot.displayName = "InlineCitation";

/** Render the default citation or compose its `Trigger` and `Card` parts. */
export const InlineCitation = Object.assign(InlineCitationRoot, {
  Trigger: InlineCitationTrigger,
  Card: InlineCitationCard,
});
