/**
 * useWorkflowList Hook
 *
 * React hook for listing and filtering workflow runs.
 *
 * @example
 * ```tsx
 * import { useWorkflowList } from 'veryfront/ai/workflow/react';
 *
 * function WorkflowList() {
 *   const {
 *     runs,
 *     isLoading,
 *     hasMore,
 *     loadMore,
 *     setFilter,
 *   } = useWorkflowList({
 *     workflowId: 'content-pipeline',
 *     status: 'running',
 *   });
 *
 *   return (
 *     <div>
 *       {runs.map(run => (
 *         <div key={run.id}>
 *           {run.id} - {run.status}
 *         </div>
 *       ))}
 *       {hasMore && (
 *         <button onClick={loadMore}>Load More</button>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */

import { useCallback, useEffect, useState } from "react";
import type { RunFilter, WorkflowRun, WorkflowStatus } from "../types.ts";

/**
 * Options for useWorkflowList hook
 */
export interface UseWorkflowListOptions {
  /** Filter by workflow ID */
  workflowId?: string;

  /** Filter by status */
  status?: WorkflowStatus | WorkflowStatus[];

  /** Filter runs created after this date */
  createdAfter?: Date;

  /** Filter runs created before this date */
  createdBefore?: Date;

  /** Page size (defaults to 20) */
  pageSize?: number;

  /** API endpoint base (defaults to /api/workflows) */
  apiBase?: string;

  /** Enable automatic refresh */
  autoRefresh?: boolean;

  /** Refresh interval in ms (defaults to 5000) */
  refreshInterval?: number;
}

/**
 * Result from useWorkflowList hook
 */
export interface UseWorkflowListResult {
  /** List of workflow runs */
  runs: WorkflowRun[];

  /** Total count (if available) */
  totalCount?: number;

  /** Loading state */
  isLoading: boolean;

  /** Error state */
  error: Error | null;

  /** Whether there are more results */
  hasMore: boolean;

  /** Load more results */
  loadMore: () => Promise<void>;

  /** Refresh the list */
  refresh: () => Promise<void>;

  /** Update the filter */
  setFilter: (filter: Partial<UseWorkflowListOptions>) => void;

  /** Current filter */
  filter: RunFilter;
}

/**
 * useWorkflowList - List and filter workflow runs
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

  /**
   * Build query string from filter
   */
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
        statuses.forEach((s) => params.append("status", s));
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

  /**
   * Fetch runs
   */
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
        const nextCursor = data.cursor;
        const total = data.totalCount;

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

  /**
   * Initial fetch
   */
  useEffect(() => {
    const doFetch = async () => {
      setIsLoading(true);
      await fetchRuns(false);
      setIsLoading(false);
    };

    doFetch();
  }, [filter]); // Re-fetch when filter changes

  /**
   * Auto-refresh setup
   */
  useEffect(() => {
    if (!autoRefresh) return;

    const intervalId = setInterval(() => {
      fetchRuns(false);
    }, refreshInterval);

    return () => clearInterval(intervalId);
  }, [autoRefresh, refreshInterval, fetchRuns]);

  /**
   * Load more results
   */
  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading) return;
    setIsLoading(true);
    await fetchRuns(true);
    setIsLoading(false);
  }, [hasMore, isLoading, fetchRuns]);

  /**
   * Refresh the list
   */
  const refresh = useCallback(async () => {
    setCursor(undefined);
    setIsLoading(true);
    await fetchRuns(false);
    setIsLoading(false);
  }, [fetchRuns]);

  /**
   * Update filter
   */
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
