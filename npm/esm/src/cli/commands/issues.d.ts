/**
 * CLI command for file-based issue tracking
 *
 * @module cli/commands/issues
 */
export declare function issuesCommand(args: {
    _: (string | number)[];
    title?: string;
    t?: string;
    body?: string;
    b?: string;
    labels?: string;
    l?: string;
    milestone?: string;
    m?: string;
    assignees?: string;
    a?: string;
    prefix?: string;
    state?: string;
    assignee?: string;
    json?: boolean;
    j?: boolean;
    verbose?: boolean;
    v?: boolean;
    delete?: boolean;
    d?: boolean;
    limit?: number;
    sort?: string;
    dir?: string;
    [key: string]: any;
}): Promise<void>;
//# sourceMappingURL=issues.d.ts.map