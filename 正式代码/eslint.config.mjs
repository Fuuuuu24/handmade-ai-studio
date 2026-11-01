import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // React Bits 组件（src/components/bits/，见其 README.md）是第三方源码：为了动画在渲染时读 ref、在副作用里设状态，
  // 这几条规则对它们关掉，保持和上游一致、便于对照；本项目自己的代码仍然全部检查
  {
    files: ["src/components/bits/**"],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "@next/next/no-img-element": "off",
    },
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
