/**
 * MCP tools for skill discovery and reference loading.
 */
import { z } from "zod";
import type { MCPTool } from "../tools.js";
declare const getSkillsInput: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
}, {
    name?: string | undefined;
}>;
type GetSkillsInput = z.infer<typeof getSkillsInput>;
interface SkillMetadata {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    tools?: string[];
}
interface SkillContent extends SkillMetadata {
    content: string;
    references?: string[];
}
interface GetSkillsResult {
    skills?: SkillMetadata[];
    skill?: SkillContent;
    error?: string;
}
export declare const vfGetSkills: MCPTool<GetSkillsInput, GetSkillsResult>;
declare const getSkillReferenceInput: z.ZodObject<{
    skill: z.ZodString;
    reference: z.ZodString;
}, "strip", z.ZodTypeAny, {
    skill: string;
    reference: string;
}, {
    skill: string;
    reference: string;
}>;
type GetSkillReferenceInput = z.infer<typeof getSkillReferenceInput>;
interface GetSkillReferenceResult {
    content?: string;
    error?: string;
}
export declare const vfGetSkillReference: MCPTool<GetSkillReferenceInput, GetSkillReferenceResult>;
export {};
//# sourceMappingURL=skill-tools.d.ts.map