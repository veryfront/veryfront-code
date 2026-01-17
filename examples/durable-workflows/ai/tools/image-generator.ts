import { tool } from "veryfront/tool";
import { z } from "zod";

export default tool({
  description: "Generate/find images based on a prompt using Unsplash",
  inputSchema: z.object({
    prompt: z.string().describe("Description/keywords for the image"),
    count: z.number().optional().default(1).describe("Number of images to generate"),
    width: z.number().optional().default(800).describe("Image width"),
    height: z.number().optional().default(600).describe("Image height"),
  }),
  execute: async ({ prompt, count = 1, width = 800, height = 600 }) => {
    // Use Unsplash Source API for keyword-based images
    const keywords = encodeURIComponent(prompt.replace(/[^a-zA-Z0-9 ]/g, "").trim());

    const images = Array.from({ length: count }, (_, i) => {
      // Add unique sig to get different images
      const sig = Date.now() + i;
      return {
        url: `https://source.unsplash.com/${width}x${height}/?${keywords}&sig=${sig}`,
        alt: `Image for: ${prompt}`,
        keywords: prompt,
        dimensions: { width, height },
      };
    });

    return {
      success: true,
      images,
      prompt,
      generatedAt: new Date().toISOString(),
    };
  },
});
