/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // Apply Demo: Playwright + serverless Chromium run inside the Node function.
  serverExternalPackages: ["playwright", "playwright-core", "@sparticuz/chromium"],
  outputFileTracingIncludes: Object.fromEntries(
    ["/api/apply-demo/run", "/api/apply-demo/real/review", "/api/apply-demo/real/submit"].map((route) => [
      route,
      ["./test-forms/**/*", "./node_modules/@sparticuz/chromium/bin/**", "./node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**"],
    ]),
  ),

  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default config;
