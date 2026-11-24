import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // v0.6 起模板库取代「我的风格」「摄影布景」两页（技术写法 13.9），旧地址跳到模板库
  async redirects() {
    return [
      { source: "/style", destination: "/templates", permanent: false },
      { source: "/scenes", destination: "/templates", permanent: false },
    ];
  },
  partialPrefetching: true,
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
