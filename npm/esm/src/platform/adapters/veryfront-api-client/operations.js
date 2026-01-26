import { logger } from "../../../utils/index.js";
import { z } from "zod";
import { requestWithRetry } from "./retry-handler.js";
import { VeryfrontAPIError } from "./types.js";
import { BranchFileDetailSchema, EnvironmentFileDetailSchema, ListBranchFilesResponseSchema, ListEnvironmentFilesResponseSchema, ListProjectsResponseSchema, ListReleaseFilesResponseSchema, ProjectSchema, ReleaseFileDetailSchema, } from "./schemas.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../../observability/tracing/span-names.js";
function buildListParams(options) {
    const { cursor, limit = 100, pattern, sortBy = "updated_at", sortOrder = "desc" } = options;
    const params = new URLSearchParams({
        limit: String(limit),
        sort_by: sortBy,
        sort_order: sortOrder,
    });
    if (cursor)
        params.set("cursor", cursor);
    if (pattern)
        params.set("pattern", pattern);
    return params;
}
export class VeryfrontAPIOperations {
    apiBaseUrl;
    retryConfig;
    projectId;
    tokenProvider;
    constructor(apiBaseUrl, tokenOrProvider, retryConfig, projectId) {
        this.apiBaseUrl = apiBaseUrl;
        this.retryConfig = retryConfig;
        this.projectId = projectId;
        this.tokenProvider = typeof tokenOrProvider === "string"
            ? () => tokenOrProvider
            : tokenOrProvider;
    }
    setTokenProvider(provider) {
        this.tokenProvider = provider;
    }
    getToken() {
        return this.tokenProvider();
    }
    setProjectId(projectId) {
        this.projectId = projectId;
    }
    getProjectId() {
        if (this.projectId)
            return this.projectId;
        throw new VeryfrontAPIError("Veryfront API client not initialized. Call initialize() with a project ID first.");
    }
    async listProjects(options) {
        const params = new URLSearchParams();
        if (options?.search)
            params.set("search", options.search);
        if (options?.limit)
            params.set("limit", String(options.limit));
        if (options?.sortBy)
            params.set("sort_by", options.sortBy);
        if (options?.sortOrder)
            params.set("sort_order", options.sortOrder);
        const query = params.toString();
        const raw = await this.request(query ? `/projects?${query}` : "/projects");
        return ListProjectsResponseSchema.parse(raw).data;
    }
    async getProject(projectRef) {
        const raw = await this.request(`/projects/${encodeURIComponent(projectRef)}`);
        return ProjectSchema.parse(raw);
    }
    async listBranchFiles(projectRef, branchName = "main", options = {}) {
        const params = buildListParams(options);
        const url = `/projects/${encodeURIComponent(projectRef)}/branches/${encodeURIComponent(branchName)}/files?${params}`;
        logger.debug("[API] listBranchFiles", { projectRef, branchName, pattern: options.pattern });
        const raw = await this.request(url);
        const response = ListBranchFilesResponseSchema.parse(raw);
        return {
            files: response.data.map((f) => ({
                id: f.id,
                path: f.path,
                content: f.content,
                type: f.type,
                size: f.size,
                updated_at: f.updated_at,
            })),
            page_info: response.page_info,
        };
    }
    async listAllBranchFiles(projectRef, branchName = "main", options = {}) {
        const allFiles = [];
        let cursor;
        do {
            const result = await this.listBranchFiles(projectRef, branchName, {
                ...options,
                cursor,
                limit: 100,
            });
            allFiles.push(...result.files);
            cursor = result.page_info.next ?? undefined;
        } while (cursor);
        logger.debug("[API] listAllBranchFiles DONE", {
            projectRef,
            branchName,
            totalFiles: allFiles.length,
        });
        return allFiles;
    }
    getBranchFile(projectRef, branchName, pathOrId) {
        return withSpan(SpanNames.API_GET_FILE, async () => {
            const url = `/projects/${encodeURIComponent(projectRef)}/branches/${encodeURIComponent(branchName)}/files/${encodeURIComponent(pathOrId)}`;
            logger.debug("[API] getBranchFile", { projectRef, branchName, pathOrId });
            const raw = await this.request(url);
            const response = BranchFileDetailSchema.parse(raw);
            return {
                path: response.path,
                content: response.content,
                id: response.id,
                type: response.type,
                size: response.size,
            };
        }, {
            "api.operation": "getBranchFile",
            "api.project": projectRef,
            "api.branch": branchName,
            "api.path": pathOrId,
        });
    }
    async listEnvironmentFiles(projectRef, environmentName = "production", options = {}) {
        const params = buildListParams(options);
        const url = `/projects/${encodeURIComponent(projectRef)}/environments/${encodeURIComponent(environmentName)}/files?${params}`;
        logger.debug("[API] listEnvironmentFiles", {
            projectRef,
            environmentName,
            pattern: options.pattern,
        });
        const raw = await this.request(url);
        const response = ListEnvironmentFilesResponseSchema.parse(raw);
        return {
            files: response.data.map((f) => ({
                id: f.id,
                version_id: f.version_id,
                path: f.path,
                content: f.content,
                type: f.type,
                size: f.size,
                updated_at: f.updated_at,
            })),
            page_info: response.page_info,
            release_id: response.release_id,
            release_version: response.release_version,
            environment_id: response.environment_id,
            environment_name: response.environment_name,
        };
    }
    async listAllEnvironmentFiles(projectRef, environmentName = "production", options = {}) {
        const allFiles = [];
        let cursor;
        do {
            const result = await this.listEnvironmentFiles(projectRef, environmentName, {
                ...options,
                cursor,
                limit: 100,
            });
            allFiles.push(...result.files);
            cursor = result.page_info.next ?? undefined;
        } while (cursor);
        logger.debug("[API] listAllEnvironmentFiles", {
            projectRef,
            environmentName,
            totalFiles: allFiles.length,
        });
        return allFiles;
    }
    getEnvironmentFile(projectRef, environmentName, pathOrId) {
        return withSpan(SpanNames.API_GET_FILE, async () => {
            const url = `/projects/${encodeURIComponent(projectRef)}/environments/${encodeURIComponent(environmentName)}/files/${encodeURIComponent(pathOrId)}`;
            logger.debug("[API] getEnvironmentFile", { projectRef, environmentName, pathOrId });
            const raw = await this.request(url);
            const response = EnvironmentFileDetailSchema.parse(raw);
            return {
                path: response.path,
                content: response.content,
                id: response.id,
                version_id: response.version_id,
                release_id: response.release_id,
                release_version: response.release_version,
            };
        }, {
            "api.operation": "getEnvironmentFile",
            "api.project": projectRef,
            "api.environment": environmentName,
            "api.path": pathOrId,
        });
    }
    async listReleaseFiles(projectRef, version = "latest", options = {}) {
        const params = buildListParams(options);
        const url = `/projects/${encodeURIComponent(projectRef)}/releases/${encodeURIComponent(version)}/files?${params}`;
        logger.debug("[API] listReleaseFiles", { projectRef, version, pattern: options.pattern });
        const raw = await this.request(url);
        const response = ListReleaseFilesResponseSchema.parse(raw);
        return {
            files: response.data.map((f) => ({
                id: f.id,
                version_id: f.version_id,
                path: f.path,
                content: f.content,
                type: f.type,
                size: f.size,
                updated_at: f.updated_at,
            })),
            page_info: response.page_info,
            release_id: response.release_id,
            release_version: response.release_version,
        };
    }
    async listAllReleaseFiles(projectRef, version = "latest", options = {}) {
        const allFiles = [];
        let cursor;
        do {
            const result = await this.listReleaseFiles(projectRef, version, {
                ...options,
                cursor,
                limit: 100,
            });
            allFiles.push(...result.files);
            cursor = result.page_info.next ?? undefined;
        } while (cursor);
        return allFiles;
    }
    getReleaseFile(projectRef, version, pathOrId) {
        return withSpan(SpanNames.API_GET_FILE, async () => {
            const url = `/projects/${encodeURIComponent(projectRef)}/releases/${encodeURIComponent(version)}/files/${encodeURIComponent(pathOrId)}`;
            logger.debug("[API] getReleaseFile", { projectRef, version, pathOrId });
            const raw = await this.request(url);
            const response = ReleaseFileDetailSchema.parse(raw);
            return {
                path: response.path,
                content: response.content,
                id: response.id,
                version_id: response.version_id,
                release_id: response.release_id,
                release_version: response.release_version,
            };
        }, {
            "api.operation": "getReleaseFile",
            "api.project": projectRef,
            "api.version": version,
            "api.path": pathOrId,
        });
    }
    lookupProjectByDomain(domain) {
        return withSpan(SpanNames.API_DOMAIN_LOOKUP, async () => {
            const domainWithoutPort = domain.replace(/:\d+$/, "");
            const url = `/projects/${encodeURIComponent(domainWithoutPort)}`;
            logger.debug("[API] lookupProjectByDomain", { domain });
            try {
                const raw = await this.request(url);
                const project = ProjectSchema.extend({
                    environments: z
                        .array(z.object({
                        id: z.string().uuid(),
                        name: z.string(),
                        domains: z.array(z.string()).optional(),
                        active_release_id: z.string().uuid().nullable().optional(),
                    }))
                        .optional(),
                }).parse(raw);
                const matchingEnv = project.environments?.find((env) => env.domains?.some((d) => d.toLowerCase() === domainWithoutPort.toLowerCase()));
                const response = {
                    project_id: project.id,
                    project_slug: project.slug,
                    project_name: project.name,
                    environment: matchingEnv ? { id: matchingEnv.id, name: matchingEnv.name } : null,
                    release_id: matchingEnv?.active_release_id ?? null,
                };
                logger.debug("[API] Domain lookup result", {
                    domain,
                    projectSlug: response.project_slug,
                    environment: response.environment?.name,
                });
                return response;
            }
            catch (error) {
                if (error instanceof Error && error.message.includes("404")) {
                    logger.debug("[API] No project found for domain", { domain });
                    return null;
                }
                throw error;
            }
        }, { "api.domain": domain });
    }
    request(endpoint) {
        return withSpan(SpanNames.API_REQUEST, () => {
            const url = `${this.apiBaseUrl}${endpoint}`;
            return requestWithRetry(url, this.tokenProvider(), this.retryConfig);
        }, { "api.endpoint": endpoint, "api.base_url": this.apiBaseUrl });
    }
}
