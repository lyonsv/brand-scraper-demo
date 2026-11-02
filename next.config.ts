import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // keep the dev-mode badge out of UI screenshots
  devIndicators: false,
  // Chromium drivers must stay plain Node modules (not bundled): playwright-core spawns the
  // browser and @sparticuz/chromium ships brotli-packed binaries next to its JS.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  // Files read at runtime that static tracing can't see.
  outputFileTracingIncludes: {
    "/api/scan": [
      "./src/lib/extract/*.js", // in-page scripts, read from disk and passed to page.evaluate
      "./node_modules/@sparticuz/chromium/bin/**", // chromium.br, fonts, swiftshader, al2023 libs
    ],
  },
  // Never ship the full `playwright` package or locally downloaded browsers to the function.
  outputFileTracingExcludes: {
    "*": ["./node_modules/playwright/**", "**/ms-playwright/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
