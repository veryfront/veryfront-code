import * as dntShim from "../../../_dnt.shims.js";
import { useCallback, useEffect, useState } from "react";
/**
 * List and filter workflow runs.
 */
export function useWorkflowList(options = {}) {
    const { workflowId, status, createdAfter, createdBefore, pageSize = 20, apiBase = "/api/workflows", autoRefresh = false, refreshInterval = 5000, } = options;
    const [runs, setRuns] = useState([]);
    const [totalCount, setTotalCount] = useState();
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [cursor, setCursor] = useState();
    const [filter, setFilterState] = useState({
        workflowId,
        status,
        createdAfter,
        createdBefore,
        limit: pageSize,
    });
    const buildQueryString = useCallback((filterToUse, cursorToUse) => {
        const params = new URLSearchParams();
        if (filterToUse.workflowId)
            params.set("workflowId", filterToUse.workflowId);
        if (filterToUse.status) {
            const statuses = Array.isArray(filterToUse.status)
                ? filterToUse.status
                : [filterToUse.status];
            for (const s of statuses)
                params.append("status", s);
        }
        if (filterToUse.createdAfter) {
            params.set("createdAfter", filterToUse.createdAfter.toISOString());
        }
        if (filterToUse.createdBefore) {
            params.set("createdBefore", filterToUse.createdBefore.toISOString());
        }
        if (filterToUse.limit)
            params.set("limit", String(filterToUse.limit));
        if (cursorToUse)
            params.set("cursor", cursorToUse);
        return params.toString();
    }, []);
    const fetchRuns = useCallback(async (append = false) => {
        try {
            const queryString = buildQueryString(filter, append ? cursor : undefined);
            const response = await dntShim.fetch(`${apiBase}/runs?${queryString}`);
            if (!response.ok)
                throw new Error(`Failed to fetch runs: ${response.status}`);
            const data = await response.json();
            const fetchedRuns = (data.runs ?? data);
            const nextCursor = data.cursor;
            const total = data.totalCount;
            setRuns((prev) => (append ? [...prev, ...fetchedRuns] : fetchedRuns));
            setCursor(nextCursor);
            setHasMore(Boolean(nextCursor) || fetchedRuns.length === filter.limit);
            setTotalCount(total);
            setError(null);
        }
        catch (error) {
            setError(error instanceof Error ? error : new Error(String(error)));
        }
    }, [apiBase, buildQueryString, cursor, filter]);
    useEffect(() => {
        let cancelled = false;
        async function doFetch() {
            setIsLoading(true);
            await fetchRuns(false);
            if (!cancelled)
                setIsLoading(false);
        }
        doFetch();
        return () => {
            cancelled = true;
        };
    }, [fetchRuns, filter]);
    useEffect(() => {
        if (!autoRefresh)
            return;
        const intervalId = dntShim.setInterval(() => {
            fetchRuns(false);
        }, refreshInterval);
        return () => clearInterval(intervalId);
    }, [autoRefresh, fetchRuns, refreshInterval]);
    const loadMore = useCallback(async () => {
        if (!hasMore || isLoading)
            return;
        setIsLoading(true);
        await fetchRuns(true);
        setIsLoading(false);
    }, [fetchRuns, hasMore, isLoading]);
    const refresh = useCallback(async () => {
        setCursor(undefined);
        setIsLoading(true);
        await fetchRuns(false);
        setIsLoading(false);
    }, [fetchRuns]);
    const setFilter = useCallback((newFilter) => {
        setCursor(undefined); // Reset pagination
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
