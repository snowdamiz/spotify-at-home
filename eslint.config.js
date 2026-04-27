import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/dist/**",
      "**/.expo/**",
      "**/.next/**",
      "**/node_modules/**"
    ]
  },
  {
    files: [
      "**/*.js",
      "**/*.mjs",
      "**/*.ts",
      "**/*.tsx"
    ],
    languageOptions: {
      globals: {
        console: "readonly",
        document: "readonly",
        File: "readonly",
        FileList: "readonly",
        FileReader: "readonly",
        HTMLAudioElement: "readonly",
        process: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        window: "readonly"
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          "prefer": "type-imports"
        }
      ]
    }
  }
);
