import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The prompts live in /prompts as plain Markdown files and are read at runtime,
  // so they must be bundled with the serverless functions on Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["./prompts/**/*"],
  },
};

export default nextConfig;
