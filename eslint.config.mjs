import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import perfectionist from "eslint-plugin-perfectionist";
import { Alphabet } from "eslint-plugin-perfectionist/alphabet";
import tseslint from "typescript-eslint";

const alphabet = Alphabet.generateRecommendedAlphabet()
  .sortByLocaleCompare("en-US")
  .placeAllWithCaseBeforeAllWithOtherCase("uppercase")
  .getCharacters();

export default tseslint.config(
  {
    ignores: ["node_modules/", "dist/", "scripts/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ...perfectionist.configs["recommended-alphabetical"],
    rules: Object.fromEntries(
      Object.entries(
        perfectionist.configs["recommended-alphabetical"].rules,
      ).map(([rule, [severity]]) => [rule, [severity, { order: "asc" }]]),
    ),
    settings: {
      perfectionist: {
        alphabet,
        ignoreCase: false,
        type: "custom",
      },
    },
  },
  {
    files: ["src/agents/opencode/plugin.source"],
    languageOptions: {
      globals: {
        Request: "readonly",
        RequestInit: "readonly",
        Response: "readonly",
        TextDecoder: "readonly",
        URL: "readonly",
        fetch: "readonly",
        process: "readonly",
      },
      parser: tseslint.parser,
      parserOptions: {
        extraFileExtensions: [".source"],
      },
    },
  },
  prettier,
  {
    files: [
      "src/app/dialogs/dialog-input-dispatch.ts",
      "src/input/router.test.ts",
      "src/input/router.ts",
      "src/tmux/escape.ts",
      "src/util/csiu-reencode.ts",
      "src/util/keybindings.ts",
      "src/util/terminal-probe.ts",
      "src/util/text.ts",
    ],
    rules: {
      "no-control-regex": "off",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  }
);
