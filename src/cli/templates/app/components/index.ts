/**
 * App Components Templates - Main Orchestrator
 *
 * @module cli/templates/app/components
 *
 * This module aggregates all component templates for the app template.
 * Component templates are organized by category:
 * - Authentication components (Header, AuthProvider)
 * - Landing page components (HeroSection, FeatureGrid)
 * - Dashboard components (DashboardLayout, StatsGrid, RecentActivity)
 * - UI utility components (Toaster)
 */

import type { TemplateFile } from "./types.ts";
import { authComponentTemplates } from "./auth-templates.ts";
import { landingComponentTemplates } from "./landing-templates.ts";
import { dashboardComponentTemplates } from "./dashboard-templates.ts";
import { uiComponentTemplates } from "./ui-templates.ts";

/**
 * All app component templates combined
 *
 * This array contains all component template files that will be generated
 * when creating a new app project.
 */
export const appComponentTemplates: TemplateFile[] = [
  ...authComponentTemplates,
  ...landingComponentTemplates,
  ...dashboardComponentTemplates,
  ...uiComponentTemplates,
];

// Re-export types and individual template arrays
export type { TemplateFile };
export {
  authComponentTemplates,
  dashboardComponentTemplates,
  landingComponentTemplates,
  uiComponentTemplates,
};
