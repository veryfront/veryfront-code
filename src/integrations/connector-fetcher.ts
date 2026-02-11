/**
 * Connector Fetcher
 *
 * Fetches integration connector definitions from the API with LRU caching.
 * GET /api/integrations/:name returns the full connector spec including tools and endpoints.
 */

import { logger } from "#veryfront/utils";
import type { IntegrationConnector } from "./types.ts";

interface CacheEntry {
  connector: IntegrationConnector;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100;
const cache = new Map<string, CacheEntry>();

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

export async function fetchConnector(
  integration: string,
  apiBaseUrl: string,
  apiToken?: string,
): Promise<IntegrationConnector | null> {
  // Check cache
  const cached = cache.get(integration);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.connector;
  }

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiToken) headers.Authorization = `Bearer ${apiToken}`;

    const url = `${apiBaseUrl}/integrations/${encodeURIComponent(integration)}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (response.status === 404) {
        logger.warn(`Connector not found: ${integration}`);
        return null;
      }
      logger.warn(`Failed to fetch connector: ${integration}`, {
        status: response.status,
      });
      return null;
    }

    const connector = (await response.json()) as IntegrationConnector;

    // Evict expired entries and enforce size limit
    evictExpired();
    if (cache.size >= MAX_CACHE_SIZE) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }

    cache.set(integration, { connector, expiresAt: Date.now() + CACHE_TTL_MS });
    return connector;
  } catch (error) {
    logger.error(`Error fetching connector: ${integration}`, {
      error: String(error),
    });
    return null;
  }
}

/** Clear the connector cache (for testing). */
export function clearConnectorCache(): void {
  cache.clear();
}
