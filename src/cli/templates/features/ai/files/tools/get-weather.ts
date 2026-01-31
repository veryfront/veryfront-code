import { tool } from "veryfront/tool";
import { z } from "zod";

const mockWeather: Record<string, { temp: number; condition: string }> = {
  "San Francisco, CA": { temp: 65, condition: "Foggy" },
  "New York, NY": { temp: 75, condition: "Sunny" },
  "London, UK": { temp: 60, condition: "Rainy" },
  "Tokyo, Japan": { temp: 80, condition: "Humid" },
};

export default tool({
  description: "Get the current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("The city and state, e.g. San Francisco, CA"),
  }),
  execute: ({ location }: { location: string }): {
    location: string;
    temperature: number;
    condition: string;
    unit: "fahrenheit";
  } => {
    const { temp, condition } = mockWeather[location] ?? {
      temp: 70,
      condition: "Clear",
    };

    return {
      location,
      temperature: temp,
      condition,
      unit: "fahrenheit",
    };
  },
});
