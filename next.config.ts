import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["tar"],
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
