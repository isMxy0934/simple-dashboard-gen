import js from "@eslint/js";
import tseslint from "typescript-eslint";
import noIdentityInRequest from "./eslint-rules/no-identity-in-request.js";

const TS_LINT_FILES = ["src/app/api/**/*.ts", "src/server/auth/**/*.ts"];
const JS_LINT_FILES = ["eslint-rules/**/*.js"];

export default [
  {
    files: [...TS_LINT_FILES, ...JS_LINT_FILES],
    rules: js.configs.recommended.rules,
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: TS_LINT_FILES,
  })),
  {
    files: ["src/app/api/**/*.ts"],
    plugins: {
      sds: {
        rules: {
          "no-identity-in-request": noIdentityInRequest,
        },
      },
    },
    rules: {
      "sds/no-identity-in-request": "error",
    },
  },
  {
    files: JS_LINT_FILES,
    languageOptions: {
      sourceType: "module",
    },
  },
  {
    files: TS_LINT_FILES,
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-useless-assignment": "off",
    },
  },
];
