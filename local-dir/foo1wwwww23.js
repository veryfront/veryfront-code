import aspectRatio from "https://esm.sh/@tailwindcss/aspect-ratio@0.4.2";
import typography from "https://esm.sh/@tailwindcss/typography";
import forms from "https://esm.sh/@tailwindcss/forms";
import animate from "https://cdn.skypack.dev/tailwindcss-animate@1.0.5";

export default {
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        md: "2rem",
      },
      screens: {
        "2xl": "1400px",
      },
    },
    aspectRatio: {
      auto: "auto",
      square: "1 / 1",
      video: "16 / 9",
      "1": "1",
      "2": "2",
      "3": "3",
      "4": "4",
      "5": "5",
      "6": "6",
      "7": "7",
      "8": "8",
      "9": "9",
      "10": "10",
      "11": "11",
      "12": "12",
      "13": "13",
      "14": "14",
      "15": "15",
      "16": "16",
    },
    extend: {
      typography: {
        DEFAULT: {
          css: {
            maxWidth: "100ch",
            h1: {
              "@apply scroll-m-20 text-5xl md:text-6xl lg:text-8xl font-bold tracking-tighter":
                "",
            },
            h2: {
              "@apply scroll-m-20 border-b pb-2 text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight transition-colors first:mt-0":
                "",
            },
            h3: {
              "@apply scroll-m-20 text-2xl md:text-3xl lg:text-4xl font-semibold tracking-tight":
                "",
            },
            h4: {
              "@apply scroll-m-20 text-2xl font-semibold tracking-tight": "",
            },
            h5: {
              "@apply scroll-m-20 text-lg font-semibold tracking-tight": "",
            },
            blockquote: {
              "@apply mt-6 border-l-2 pl-6 italic": "",
            },
            code: {
              "@apply relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold":
                "",
            },
            p: {
              "@apply leading-7 [&:not(:first-child)]:mt-6": "",
            },
          },
        },
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: 0,
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: 0,
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate, aspectRatio, typography, forms({ strategy: "class" })],
};
