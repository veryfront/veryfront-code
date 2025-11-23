/**
 * App Components Templates - Landing Page Components
 *
 * @module cli/templates/app/components/landing-templates
 */

import type { TemplateFile } from "./types.ts";

/**
 * Landing page component templates (HeroSection and FeatureGrid)
 */
export const landingComponentTemplates: TemplateFile[] = [
  {
    path: "components/HeroSection.tsx",
    content: `export function HeroSection() {
  return (
    <section className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center">
          <h1 className="text-5xl font-bold mb-6">
            Build Something Amazing
          </h1>
          <p className="text-xl mb-8 max-w-2xl mx-auto">
            A modern full-stack application template with authentication,
            API routes, and a beautiful UI.
          </p>
          <div className="flex gap-4 justify-center">
            <a
              href="/register"
              className="px-8 py-3 bg-white text-indigo-600 rounded-lg font-semibold hover:bg-gray-100 transition"
            >
              Get Started
            </a>
            <a
              href="/docs"
              className="px-8 py-3 border-2 border-white text-white rounded-lg font-semibold hover:bg-white hover:text-indigo-600 transition"
            >
              Learn More
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}`,
  },
  {
    path: "components/FeatureGrid.tsx",
    content: `const features = [
  {
    title: "Authentication",
    description: "Secure user authentication with sessions and JWT tokens",
    icon: "🔐",
  },
  {
    title: "API Routes",
    description: "Full-featured API with middleware and validation",
    icon: "🚀",
  },
  {
    title: "Database Ready",
    description: "Easy to connect any database with our data layer",
    icon: "💾",
  },
  {
    title: "Type Safe",
    description: "Full TypeScript support with runtime validation",
    icon: "✨",
  },
  {
    title: "Modern UI",
    description: "Beautiful components built with Tailwind CSS",
    icon: "🎨",
  },
  {
    title: "Production Ready",
    description: "Security, caching, and performance optimized",
    icon: "⚡",
  },
];

export function FeatureGrid() {
  return (
    <section className="py-16 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900">
            Everything You Need
          </h2>
          <p className="mt-4 text-xl text-gray-600">
            Start with a solid foundation and build from there
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition"
            >
              <div className="text-4xl mb-4">{feature.icon}</div>
              <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
              <p className="text-gray-600">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}`,
  },
];
