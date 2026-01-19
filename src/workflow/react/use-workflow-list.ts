import { useCallback, useEffect, useState } from "react";
import type { RunFilter, WorkflowRun, WorkflowStatus } from "#veryfront/workflow/types.ts";

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
export function useWorkflowList(
  options: UseWorkflowListOptions = {},
): UseWorkflowListResult {
  const {
    workflowId,
    status,
    createdAfter,
    createdBefore,
    pageSize = 20,
    apiBase = "/api/workflows",
    autoRefresh = false,
    refreshInterval = 5000,
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

  const buildQueryString = useCallback(
    (filterToUse: RunFilter, cursorToUse?: string): string => {
      const params = new URLSearchParams();

      if (filterToUse.workflowId) {
        params.set("workflowId", filterToUse.workflowId);
      }

      if (filterToUse.status) {
        const statuses = Array.isArray(filterToUse.status)
          ? filterToUse.status
          : [filterToUse.status];
        for (const s of statuses) {
          params.append("status", s);
        }
      }

      if (filterToUse.createdAfter) {
        params.set("createdAfter", filterToUse.createdAfter.toISOString());
      }

      if (filterToUse.createdBefore) {
        params.set("createdBefore", filterToUse.createdBefore.toISOString());
      }

      if (filterToUse.limit) {
        params.set("limit", String(filterToUse.limit));
      }

      if (cursorToUse) {
        params.set("cursor", cursorToUse);
      }

      return params.toString();
    },
    [],
  );

  const fetchRuns = useCallback(
    async (append: boolean = false) => {
      try {
        const queryString = buildQueryString(filter, append ? cursor : undefined);
        const response = await fetch(`${apiBase}/runs?${queryString}`);

        if (!response.ok) {
          throw new Error(`Failed to fetch runs: ${response.status}`);
        }

        const data = await response.json();
        const fetchedRuns = (data.runs || data) as WorkflowRun[];
        const { cursor: nextCursor, totalCount: total } = data;

        if (append) {
          setRuns((prev) => [...prev, ...fetchedRuns]);
        } else {
          setRuns(fetchedRuns);
        }

        setCursor(nextCursor);
        setHasMore(!!nextCursor || fetchedRuns.length === filter.limit);
        setTotalCount(total);
        setError(null);
      } catch (err) {
        const fetchError = err instanceof Error ? err : new Error(String(err));
        setError(fetchError);
      }
    },
    [apiBase, filter, cursor, buildQueryString],
  );

  useEffect(() => {
    const doFetch = async () => {
      setIsLoading(true);
      await fetchRuns(false);
      setIsLoading(false);
    };

    doFetch();
  }, [filter]);

  useEffect(() => {
    if (!autoRefresh) return;

    const intervalId = setInterval(() => {
      fetchRuns(false);
    }, refreshInterval);

    return () => clearInterval(intervalId);
  }, [autoRefresh, refreshInterval, fetchRuns]);

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading) return;
    setIsLoading(true);
    await fetchRuns(true);
    setIsLoading(false);
  }, [hasMore, isLoading, fetchRuns]);

  const refresh = useCallback(async () => {
    setCursor(undefined);
    setIsLoading(true);
    await fetchRuns(false);
    setIsLoading(false);
  }, [fetchRuns]);

  const setFilter = useCallback(
    (newFilter: Partial<UseWorkflowListOptions>) => {
      setCursor(undefined); // Reset pagination
      setFilterState((prev) => ({
        ...prev,
        workflowId: newFilter.workflowId ?? prev.workflowId,
        status: newFilter.status ?? prev.status,
        createdAfter: newFilter.createdAfter ?? prev.createdAfter,
        createdBefore: newFilter.createdBefore ?? prev.createdBefore,
        limit: newFilter.pageSize ?? prev.limit,
      }));
    },
    [],
  );

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
