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
      "./node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**",
      // playwright-core loads browsers.json and other package files via dynamic require.
      // pnpm symlinks node_modules/playwright-core into .pnpm, so include the real path too.
      "./node_modules/playwright-core/**",
      "./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/**",
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
