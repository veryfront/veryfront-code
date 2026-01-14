import aspectRatio from "https://esm.sh/@tailwindcss/aspect-ratio@0.4.2"
import typography from "https://esm.sh/@tailwindcss/typography@0.5.16"
import animate from "https://esm.sh/tailwindcss-animate@1.0.5"
import scrollbarHide from "https://esm.sh/tailwind-scrollbar-hide@1.1.7"
import scrollbar from "https://esm.sh/tailwind-scrollbar@4.0.2"
import defaultTheme from "https://esm.sh/tailwindcss@3.4.17/defaultTheme"

export default {
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1.25rem",
        sm: "1.75rem",
        md: "2.15rem",
      },
      screens: {
        "2xl": "1400px",
      },
    },
    aspectRatio: {
      auto: "auto",
      square: "1 / 1",
      video: "16 / 9",
      photo: "4 / 3",
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
      screens: {
        xs: "480px",
      },
      fontFamily: {
        sans: ["GellixVF", ...defaultTheme.fontFamily.sans],
        serif: ["Flecha"],
        display: ["GellixVF"],
      },
      typography: {
        DEFAULT: {
          css: {
            "code::before": {
              content: "none", // don’t generate the pseudo-element
            },
            "code::after": {
              content: "none",
            },
            maxWidth: "100ch",
            h1: {
              color: "hsl(var(--foreground))",
              "@apply scroll-m-20 text-3xl md:text-4xl lg:text-5xl font-bold font-display":
                "",
            },
            h2: {
              color: "hsl(var(--foreground))",
              "@apply scroll-m-20 text-xl md:text-2xl lg:text-3xl font-medium mt-12 mb-5":
                "",
            },
            h3: {
              color: "hsl(var(--foreground))",
              "@apply scroll-m-20 text-lg md:text-xl lg:text-2xl font-medium mt-12 mb-5":
                "",
            },
            h4: {
              color: "hsl(var(--muted))",
              "@apply scroll-m-20 md:text-lg lg:text-xl font-medium mt-7 mt-10 mb-5":
                "",
            },
            h5: {
              color: "hsl(var(--foreground))",
              "@apply scroll-m-20 text-sm md:text-base lg:text-lg font-medium mt-8 mb-5":
                "",
            },
            blockquote: {
              color: "hsl(var(--foreground))",
              "@apply mt-6 border-l-2 pl-6 italic": "",
            },
            strong: {
              color: "hsl(var(--foreground))",
            },
            code: {
              "@apply relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-medium":
                "",
            },
            a: {
              color: "hsl(var(--foreground))",
              "@apply underline underline-offset-4 hover:no-underline focus:no-underline":
                "",
            },
            p: {
              color: "hsl(var(--foreground))",
              "@apply leading-7 [&:not(:first-child)]:mt-4": "",
            },
            ul: {
              color: "hsl(var(--foreground))",
              "@apply leading-7 [&:not(:first-child)]:mt-6": "",
            },
            ol: {
              color: "hsl(var(--foreground))",
              "@apply leading-7 [&:not(:first-child)]:mt-6": "",
            },
            table: {
              "@apply text-foreground w-full border rounded-xl leading-6": "",
            },
            thead: {
              "@apply border border-b": "",
            },
            tr: {
              "@apply border border-b": "",
            },
            "tr:nth-child(even)": {
              backgroundColor: "hsl(var(--border) / 0.25)",
            },
            "tr:last-child": {
              "@apply border-b-0": "",
            },
            th: {
              "@apply px-3 py-2 text-left font-semibold border border-r": "",
            },
            "th:last-child": {
              "@apply border-r-0": "",
            },
            td: {
              "@apply px-3 py-2 border border-r": "",
            },
            "td:last-child": {
              "@apply border-r-0": "",
            },
            "tbody tr:nth-child(even)": {
              backgroundColor: "hsl(var(--muted) / 0.3)",
            },
            pre: {
              "@apply bg-card text-foreground": "",
            },
            code: {
              "@apply bg-border/30 text-foreground rounded-lg text-xs font-mono px-2 py-1":
                "",
            },
          },
        },
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: "hsl(var(--muted))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        highlight: {
          DEFAULT: "hsl(var(--highlight))",
          foreground: "hsl(var(--highlight-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        panel: {
          DEFAULT: "hsl(var(--panel))",
          foreground: "hsl(var(--panel-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        divider: "hsl(var(--divider))",
        input: "hsl(var(--input))",
        "input-foreground": "hsl(var(--input-foreground))",
        "input-border": "hsl(var(--input-border))",
        "input-placeholder": "hsl(var(--input-placeholder))",
        ring: "hsl(var(--ring))",
        success: "hsl(var(--success))",
        "code-block": "hsl(var(--code-block))",
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "calc(var(--radius) + 2px)",
        xl: "calc(var(--radius) + 4px)",
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "calc(var(--radius) + 2px)",
        xl: "calc(var(--radius) + 4px)",
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
        "bounce-spin": {
          "0%, 100%": {
            transform: "translateY(0) rotate(0deg)",
            animationTimingFunction: "ease-in-out",
          },
          "25%": {
            transform: "translateY(-30%) rotate(90deg)",
            animationTimingFunction: "ease-in",
          },
          "50%": {
            transform: "translateY(0) rotate(180deg)",
            animationTimingFunction: "ease-out",
          },
          "75%": {
            transform: "translateY(-15%) rotate(270deg)",
            animationTimingFunction: "ease-in",
          },
        },
        "background-position": {
          "0%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
          "100%": { backgroundPosition: "0% 50%" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        background: "background-position 10s ease infinite alternate",
        "bounce-spin":
          "bounce-spin 2.5s cubic-bezier(0.25, 1, 0.5, 1) infinite",
      },
      backgroundSize: {
        "300%": "300%",
      },
    },
  },
  plugins: [animate, aspectRatio, typography, scrollbar, scrollbarHide],
}
