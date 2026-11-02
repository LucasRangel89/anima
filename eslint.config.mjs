import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  { ignores: [".next/**", "node_modules/**", "out/**", "build/**", "next-env.d.ts", "python-reference/**", "site/**", "playwright-report/**", "test-results/**"] },
];

export default eslintConfig;
