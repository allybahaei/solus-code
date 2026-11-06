// Shared ESLint config for the packages/* workspaces. apps/web has its own (Next) config.
import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/node_modules/**", "**/dist/**", "apps/**"]),
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: { process: "readonly", setTimeout: "readonly", setInterval: "readonly" } },
  },
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
]);
