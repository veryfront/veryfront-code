import { tool } from "veryfront/ai";
import { z } from "zod";

export default tool({
  name: "weather",
  description: "Get current weather information for a location",
  parameters: z.object({
    location: z.string().describe("City name or location"),
    units: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("Temperature units"),
  }),
  execute: async ({ location, units }) => {
    // Demo implementation - returns mock data
    // In production, integrate with a real weather API
    const mockWeather = {
      "new york": { temp: 22, condition: "Partly cloudy", humidity: 65 },
      "london": { temp: 15, condition: "Rainy", humidity: 80 },
      "tokyo": { temp: 28, condition: "Sunny", humidity: 70 },
      "paris": { temp: 18, condition: "Cloudy", humidity: 72 },
      "sydney": { temp: 25, condition: "Clear", humidity: 55 },
    };

    const normalizedLocation = location.toLowerCase();
    const weather = mockWeather[normalizedLocation as keyof typeof mockWeather];

    if (!weather) {
      return {
        location,
        temperature: Math.floor(Math.random() * 30) + 5,
        units,
        condition: "Unknown",
        humidity: Math.floor(Math.random() * 50) + 30,
        note: "Demo data - integrate with a real weather API for production",
      };
    }

    const temp = units === "fahrenheit" ? Math.round(weather.temp * 9/5 + 32) : weather.temp;

    return {
      location,
      temperature: temp,
      units,
      condition: weather.condition,
      humidity: weather.humidity,
      note: "Demo data - integrate with a real weather API for production",
    };
  },
});
