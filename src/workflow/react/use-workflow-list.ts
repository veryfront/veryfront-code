import { useCallback, useEffect, useState } from "react";
import { REQUEST_ERROR } from "#veryfront/errors";
import type { RunFilter, WorkflowRun, WorkflowStatus } from "#veryfront/workflow/types.ts";

/** Default interval for auto-refreshing the workflow list */
const DEFAULT_REFRESH_INTERVAL_MS = 5_000;

export interface UseWorkflowListOptions {
  workflowId?: string;
  status?: WorkflowStatus | WorkflowStatus[];
  createdAfter?: Date;
  createdBefore?: Date;
  pageSize?: number;
  apiBase?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export interface UseWorkflowListResult {
  runs: WorkflowRun[];
  totalCount?: number;
  isLoading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  setFilter: (filter: Partial<UseWorkflowListOptions>) => void;
  filter: RunFilter;
}

/**
 * List and filter workflow runs.
 */
export function useWorkflowList(options: UseWorkflowListOptions = {}): UseWorkflowListResult {
  const {
    workflowId,
    status,
    createdAfter,
    createdBefore,
    pageSize = 20,
    apiBase = "/api/workflows",
    autoRefresh = false,
    refreshInterval = DEFAULT_REFRESH_INTERVAL_MS,
  } = options;

  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [totalCount, setTotalCount] = useState<number | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();

  const [filter, setFilterState] = useState<RunFilter>({
    workflowId,
    status,
    createdAfter,
    createdBefore,
    limit: pageSize,
  });

  const buildQueryString = useCallback((filterToUse: RunFilter, cursorToUse?: string): string => {
    const params = new URLSearchParams();

    if (filterToUse.workflowId) params.set("workflowId", filterToUse.workflowId);

    if (filterToUse.status) {
      const statuses = Array.isArray(filterToUse.status)
        ? filterToUse.status
        : [filterToUse.status];
      for (const s of statuses) params.append("status", s);
    }

    if (filterToUse.createdAfter) {
      params.set("createdAfter", filterToUse.createdAfter.toISOString());
    }
    if (filterToUse.createdBefore) {
      params.set("createdBefore", filterToUse.createdBefore.toISOString());
    }
    if (filterToUse.limit) params.set("limit", String(filterToUse.limit));
    if (cursorToUse) params.set("cursor", cursorToUse);

    return params.toString();
  }, []);

  const fetchRuns = useCallback(
    async (append = false): Promise<void> => {
      try {
        const queryString = buildQueryString(filter, append ? cursor : undefined);
        const response = await fetch(`${apiBase}/runs?${queryString}`);

        if (!response.ok) {
          throw REQUEST_ERROR.create({
            detail: `Failed to fetch runs: ${response.status}`,
            status: response.status,
          });
        }

        const data: { runs?: WorkflowRun[]; cursor?: string; totalCount?: number } = await response
          .json();
        const fetchedRuns: WorkflowRun[] = data.runs ?? (data as unknown as WorkflowRun[]);
        const nextCursor: string | undefined = data.cursor;
        const total: number | undefined = data.totalCount;

        setRuns((prev) => (append ? [...prev, ...fetchedRuns] : fetchedRuns));
        setCursor(nextCursor);
        setHasMore(Boolean(nextCursor) || fetchedRuns.length === filter.limit);
        setTotalCount(total);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [apiBase, buildQueryString, cursor, filter],
  );

  useEffect(() => {
    let cancelled = false;

    async function doFetch(): Promise<void> {
      setIsLoading(true);
      await fetchRuns(false);
      if (!cancelled) setIsLoading(false);
    }

    doFetch();

    return () => {
      cancelled = true;
    };
  }, [fetchRuns, filter]);

  useEffect(() => {
    if (!autoRefresh) return;

    const intervalId = setInterval(() => {
      fetchRuns(false);
    }, refreshInterval);

    return () => clearInterval(intervalId);
  }, [autoRefresh, fetchRuns, refreshInterval]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || isLoading) return;

    setIsLoading(true);
    await fetchRuns(true);
    setIsLoading(false);
  }, [fetchRuns, hasMore, isLoading]);

  const refresh = useCallback(async (): Promise<void> => {
    setCursor(undefined);
    setIsLoading(true);
    await fetchRuns(false);
    setIsLoading(false);
  }, [fetchRuns]);

  const setFilter = useCallback((newFilter: Partial<UseWorkflowListOptions>): void => {
    setCursor(undefined);
    setFilterState((prev) => ({
      ...prev,
      workflowId: newFilter.workflowId ?? prev.workflowId,
      status: newFilter.status ?? prev.status,
      createdAfter: newFilter.createdAfter ?? prev.createdAfter,
      createdBefore: newFilter.createdBefore ?? prev.createdBefore,
      limit: newFilter.pageSize ?? prev.limit,
    }));
  }, []);

  return {
    runs,
    totalCount,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
    setFilter,
    filter,
  };
}
