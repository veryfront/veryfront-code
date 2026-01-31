import type { ReactNode } from "react";

interface EmptyStateProps {
  message: string;
}

export function EmptyState({ message }: EmptyStateProps): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-gray-400">
      <div className="w-10 h-10 border border-gray-200 rounded-lg mb-3 flex items-center justify-center bg-white">
        <div className="w-3.5 h-3.5 border-2 border-gray-200 rounded" />
      </div>
      <p className="text-sm">{message}</p>
    </div>
  );
}

export function LoadingSpinner(): ReactNode {
  return (
    <div className="w-4 h-4 border-2 border-gray-200 border-t-sky-500 rounded-full animate-spin" />
  );
}

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = "Loading..." }: LoadingStateProps): ReactNode {
  return (
    <div className="p-4 flex items-center gap-2 text-sm text-gray-400">
      <LoadingSpinner />
      {message}
    </div>
  );
}

interface ErrorStateProps {
  error: string;
}

export function ErrorState({ error }: ErrorStateProps): ReactNode {
  return <div className="p-4 text-sm text-red-600">Error: {error}</div>;
}

interface ResultBoxProps {
  success: boolean;
  label: string;
  duration?: number;
  children: ReactNode;
}

export function ResultBox({ success, label, duration, children }: ResultBoxProps): ReactNode {
  const headerClassName = success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700";

  return (
    <div className="mt-4 border rounded overflow-hidden">
      <div className={`px-3 py-2 text-xs font-medium flex items-center gap-2 ${headerClassName}`}>
        {label}
        {duration !== undefined && (
          <span className="ml-auto text-gray-400 font-normal">{duration}ms</span>
        )}
      </div>
      <pre className="p-3 text-xs font-mono text-gray-600 overflow-auto max-h-60 whitespace-pre-wrap">
        {children}
      </pre>
    </div>
  );
}

interface ActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingText?: string;
  children: ReactNode;
}

export function ActionButton({
  onClick,
  disabled,
  loading,
  loadingText,
  children,
}: ActionButtonProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="mt-3 px-4 py-2 bg-sky-500 text-white text-sm font-medium rounded hover:bg-sky-600 disabled:opacity-50"
    >
      {loading ? loadingText : children}
    </button>
  );
}

interface DetailHeaderProps {
  title: string;
  description?: string;
}

export function DetailHeader({ title, description }: DetailHeaderProps): ReactNode {
  return (
    <div className="mb-6">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {description && <p className="text-sm text-gray-500">{description}</p>}
    </div>
  );
}

interface PageLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function PageLayout({ title, description, children }: PageLayoutProps): ReactNode {
  return (
    <div className="h-[calc(100vh-89px)] overflow-y-auto">
      <main className="p-5 bg-gray-50 max-w-5xl">
        <DetailHeader title={title} description={description} />
        {children}
      </main>
    </div>
  );
}

interface TwoColumnLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function TwoColumnLayout({ sidebar, children }: TwoColumnLayoutProps): ReactNode {
  return (
    <div className="grid grid-cols-[240px_1fr] h-[calc(100vh-89px)]">
      {sidebar}
      <main className="overflow-y-auto p-5 bg-gray-50">{children}</main>
    </div>
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
