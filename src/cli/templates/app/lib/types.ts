/**
 * Type definitions for app template library modules
 * @module cli/templates/app/lib/types
 */

/**
 * Represents a template file with path and content
 */
export interface TemplateFile {
  /** Relative path where the file should be created */
  path: string;
  /** Content of the template file */
  content: string;
}
