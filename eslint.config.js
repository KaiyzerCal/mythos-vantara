import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      // Build outputs / native shells — not our source.
      "android",
      "src-tauri",
      // Deno edge functions. This config declares browser globals and a
      // browser tsconfig, so linting Deno code here reports failures that
      // say nothing about whether the function is correct. They're checked
      // with `deno check` instead.
      "supabase/functions/**",
      // Emitted by scripts/generate-capabilities-manifest.mjs; the drift
      // check owns its contents, so lint findings here aren't actionable.
      "src/mavis/capabilitiesManifest.generated.*",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Off for the same reason no-unused-vars already is: `any` is used
      // deliberately and pervasively across this codebase (1600+ sites in
      // src/ alone, largely around Supabase row shapes and AI payloads).
      // Reporting every one buries the findings that do matter — with this
      // on, real react-hooks violations sat behind 4000 lines of noise.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
