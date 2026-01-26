import { type RetryConfig } from "./retry-handler.js";
import { type LookupDomainResponse, type PageInfo, type Project, type ProjectFile } from "./schemas.js";
export type TokenProvider = () => string;
export interface ListFilesOptions {
    cursor?: string;
    limit?: number;
    pattern?: string;
    sortBy?: "path" | "updated_at";
    sortOrder?: "asc" | "desc";
}
export interface FileListResult {
    files: ProjectFile[];
    page_info: PageInfo;
    release_id?: string;
    release_version?: string | null;
    environment_id?: string;
    environment_name?: string;
}
export interface FileDetail {
    path: string;
    content: string;
    id?: string;
    version_id?: string;
    type?: string;
    size?: number;
    release_id?: string;
    release_version?: string | null;
}
export declare class VeryfrontAPIOperations {
    private apiBaseUrl;
    private retryConfig;
    private projectId?;
    private tokenProvider;
    constructor(apiBaseUrl: string, tokenOrProvider: string | TokenProvider, retryConfig: RetryConfig, projectId?: string | undefined);
    setTokenProvider(provider: TokenProvider): void;
    getToken(): string;
    setProjectId(projectId: string): void;
    getProjectId(): string;
    listProjects(options?: {
        search?: string;
        limit?: number;
        sortBy?: string;
        sortOrder?: "asc" | "desc";
    }): Promise<Project[]>;
    getProject(projectRef: string): Promise<Project>;
    listBranchFiles(projectRef: string, branchName?: string, options?: ListFilesOptions): Promise<FileListResult>;
    listAllBranchFiles(projectRef: string, branchName?: string, options?: Omit<ListFilesOptions, "cursor">): Promise<ProjectFile[]>;
    getBranchFile(projectRef: string, branchName: string, pathOrId: string): Promise<FileDetail>;
    listEnvironmentFiles(projectRef: string, environmentName?: string, options?: ListFilesOptions): Promise<FileListResult>;
    listAllEnvironmentFiles(projectRef: string, environmentName?: string, options?: Omit<ListFilesOptions, "cursor">): Promise<ProjectFile[]>;
    getEnvironmentFile(projectRef: string, environmentName: string, pathOrId: string): Promise<FileDetail>;
    listReleaseFiles(projectRef: string, version?: string, options?: ListFilesOptions): Promise<FileListResult>;
    listAllReleaseFiles(projectRef: string, version?: string, options?: Omit<ListFilesOptions, "cursor">): Promise<ProjectFile[]>;
    getReleaseFile(projectRef: string, version: string, pathOrId: string): Promise<FileDetail>;
    lookupProjectByDomain(domain: string): Promise<LookupDomainResponse | null>;
    private request;
}
//# sourceMappingURL=operations.d.ts.map