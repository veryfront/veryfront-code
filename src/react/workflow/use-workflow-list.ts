import { useCallback, useEffect, useMemo, useState } from "react";
import { REQUEST_ERROR } from "#veryfront/errors/error-registry.ts";
import type { RunFilter, WorkflowRun, WorkflowStatus } from "#veryfront/workflow/types.ts";
import { normalizeActiveTimerDelayMs, normalizePageSize } from "./option-normalization.ts";
import { parseWorkflowListResponse } from "./workflow-list-response.ts";

/** Default interval for auto-refreshing the workflow list */
const DEFAULT_REFRESH_INTERVAL_MS = 5_000;

/** Options accepted by use workflow list. */
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

/** Result returned from use workflow list. */
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

interface WorkflowListIdentity {
  readonly apiBase: string;
  readonly filter: RunFilter;
  active: boolean;
  cursor: string | undefined;
  requestController: AbortController | null;
  requestPromise: Promise<void> | null;
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
    pageSize: requestedPageSize = 20,
    apiBase = "/api/workflows",
    autoRefresh = false,
    refreshInterval = DEFAULT_REFRESH_INTERVAL_MS,
  } = options;
  const pageSize = normalizePageSize(requestedPageSize);
  const normalizedRefreshInterval = normalizeActiveTimerDelayMs(
    refreshInterval,
    "refreshInterval",
  );

  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [totalCount, setTotalCount] = useState<number | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const [filter, setFilterState] = useState<RunFilter>({
    workflowId,
    status,
    createdAfter,
    createdBefore,
    limit: pageSize,
  });
  const identity = useMemo<WorkflowListIdentity>(() => ({
    apiBase,
    filter,
    active: false,
    cursor: undefined,
    requestController: null,
    requestPromise: null,
  }), [apiBase, filter]);

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
    (
      owner: WorkflowListIdentity,
      append: boolean,
      cursorSnapshot: string | undefined,
      supersede: boolean,
    ): Promise<void> => {
      if (!owner.active) return Promise.resolve();
      if (owner.requestPromise) {
        if (!supersede) return Promise.resolve();
        owner.requestController?.abort();
      }

      const controller = new AbortController();
      owner.requestController = controller;
      setIsLoading(true);
      const request = (async (): Promise<void> => {
        try {
          const queryString = buildQueryString(
            owner.filter,
            append ? cursorSnapshot : undefined,
          );
          const response = await fetch(`${owner.apiBase}/runs?${queryString}`, {
            signal: controller.signal,
          });

          if (!response.ok) {
            throw REQUEST_ERROR.create({
              detail: `Failed to fetch runs: ${response.status}`,
              status: response.status,
            });
          }

          const data = parseWorkflowListResponse(await response.json());
          const fetchedRuns = data.runs;
          const nextCursor = data.cursor;
          const total = data.totalCount;

          if (
            controller.signal.aborted || !owner.active
          ) return;
          setRuns((prev) => (append ? [...prev, ...fetchedRuns] : fetchedRuns));
          owner.cursor = nextCursor;
          setHasMore(Boolean(nextCursor));
          setTotalCount(total);
          setError(null);
        } catch (err) {
          if (
            controller.signal.aborted || !owner.active ||
            (err instanceof Error && err.name === "AbortError")
          ) return;
          setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
          if (owner.requestController === controller) {
            owner.requestController = null;
            owner.requestPromise = null;
            if (owner.active) setIsLoading(false);
          }
        }
      })();
      owner.requestPromise = request;
      return request;
    },
    [buildQueryString],
  );

  useEffect(() => {
    identity.active = true;
    identity.cursor = undefined;
    setRuns([]);
    setTotalCount(undefined);
    setHasMore(false);
    setError(null);
    void fetchRuns(identity, false, undefined, true);

    return () => {
      identity.active = false;
      identity.requestController?.abort();
    };
  }, [fetchRuns, identity]);

  useEffect(() => {
    if (!autoRefresh) return;

    const intervalId = setInterval(() => {
      if (!identity.active || identity.requestPromise) return;
      void fetchRuns(
        identity,
        false,
        undefined,
        false,
      );
    }, normalizedRefreshInterval);

    return () => clearInterval(intervalId);
  }, [autoRefresh, fetchRuns, identity, normalizedRefreshInterval]);

  const loadMore = useCallback(async (): Promise<void> => {
    const cursor = identity.cursor;
    if (!identity.active || !hasMore || !cursor || identity.requestPromise) return;
    await fetchRuns(
      identity,
      true,
      cursor,
      false,
    );
  }, [fetchRuns, hasMore, identity]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!identity.active) return;
    identity.cursor = undefined;
    await fetchRuns(identity, false, undefined, true);
  }, [fetchRuns, identity]);

  const setFilter = useCallback((newFilter: Partial<UseWorkflowListOptions>): void => {
    const nextLimit = Object.hasOwn(newFilter, "pageSize") && newFilter.pageSize !== undefined
      ? normalizePageSize(newFilter.pageSize)
      : newFilter.pageSize;
    setFilterState((prev) => ({
      ...prev,
      workflowId: Object.hasOwn(newFilter, "workflowId") ? newFilter.workflowId : prev.workflowId,
      status: Object.hasOwn(newFilter, "status") ? newFilter.status : prev.status,
      createdAfter: Object.hasOwn(newFilter, "createdAfter")
        ? newFilter.createdAfter
        : prev.createdAfter,
      createdBefore: Object.hasOwn(newFilter, "createdBefore")
        ? newFilter.createdBefore
        : prev.createdBefore,
      limit: Object.hasOwn(newFilter, "pageSize") ? nextLimit : prev.limit,
    }));
  }, []);

  const ownsState = identity.active;
  return {
    runs: ownsState ? runs : [],
    totalCount: ownsState ? totalCount : undefined,
    isLoading: ownsState ? isLoading : true,
    error: ownsState ? error : null,
    hasMore: ownsState ? hasMore : false,
    loadMore,
    refresh,
    setFilter,
    filter,
  };
}
