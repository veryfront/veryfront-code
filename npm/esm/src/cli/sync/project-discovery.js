/**
 * Project discovery - fetches remote projects for authenticated users.
 *
 * Uses existing auth module for token management and API client for project listing.
 */
import * as dntShim from "../../../_dnt.shims.js";
import { getApiUrl } from "../auth/constants.js";
import { readToken } from "../auth/token-store.js";
import { validateToken } from "../auth/login.js";
/**
 * Fetch remote projects for the authenticated user.
 *
 * @returns List of projects the user has access to, or empty array if not authenticated
 */
export async function fetchRemoteProjects() {
    // Try to get token from stored credentials
    const token = await readToken();
    if (!token) {
        return {
            user: null,
            projects: [],
            error: "Not authenticated. Press A to login.",
        };
    }
    // Validate token and get user info
    const user = await validateToken(token);
    if (!user) {
        return {
            user: null,
            projects: [],
            error: "Session expired. Press A to login again.",
        };
    }
    // Fetch projects from API
    try {
        const response = await dntShim.fetch(`${getApiUrl()}/projects`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
            },
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            return {
                user,
                projects: [],
                error: `Failed to fetch projects: ${errorText}`,
            };
        }
        const data = (await response.json());
        const projects = (data.data ?? []).map((p) => ({
            id: p.id,
            slug: p.slug,
            name: p.name,
            description: p.description,
            updatedAt: p.updatedAt,
        }));
        return { user, projects };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            user,
            projects: [],
            error: `Network error: ${message}`,
        };
    }
}
/**
 * Check if the user is authenticated (has valid token).
 */
export async function isAuthenticated() {
    const token = await readToken();
    if (!token)
        return false;
    const user = await validateToken(token);
    return user !== null;
}
/**
 * Get the current authenticated user, or null if not authenticated.
 */
export async function getCurrentUser() {
    const token = await readToken();
    if (!token)
        return null;
    return validateToken(token);
}
