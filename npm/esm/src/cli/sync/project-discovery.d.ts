import { type UserInfo } from "../auth/login.js";
export interface RemoteProject {
    id: string;
    slug: string;
    name: string;
    description?: string;
    updatedAt?: string;
}
export interface ProjectDiscoveryResult {
    user: UserInfo | null;
    projects: RemoteProject[];
    error?: string;
}
/**
 * Fetch remote projects for the authenticated user.
 *
 * @returns List of projects the user has access to, or empty array if not authenticated
 */
export declare function fetchRemoteProjects(): Promise<ProjectDiscoveryResult>;
/**
 * Check if the user is authenticated (has valid token).
 */
export declare function isAuthenticated(): Promise<boolean>;
/**
 * Get the current authenticated user, or null if not authenticated.
 */
export declare function getCurrentUser(): Promise<UserInfo | null>;
//# sourceMappingURL=project-discovery.d.ts.map