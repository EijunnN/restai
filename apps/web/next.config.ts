import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@restai/ui", "@restai/validators", "@restai/types", "@restai/config"],
};

export default nextConfig;
