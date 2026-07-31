import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  outputFileTracingExcludes: {
    "/api/**/*": [
      "./app/**/*",
      "./lib/**/*",
      "./tests/**/*",
      "./Dockerfile",
      "./compose.yaml",
      "./README.md",
      "./eslint.config.mjs",
      "./next.config.ts",
      "./tsconfig*.json",
      "./tsconfig.tsbuildinfo",
      "./vitest.config.ts",
    ],
  },
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/@img/**/*",
      "./node_modules/sharp/**/*",
    ],
  },
};

export default nextConfig;
