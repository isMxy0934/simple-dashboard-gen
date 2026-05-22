import js from "@eslint/js";
import tseslint from "typescript-eslint";
import noIdentityInRequest from "./eslint-rules/no-identity-in-request.js";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
      "sds/no-identity-in-request": "warn",
    },
  },
  {
    files: ["eslint-rules/**/*.js"],
    languageOptions: {
      sourceType: "module",
    },
  },
  {
    files: ["src/app/api/**/*.ts", "src/server/auth/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-useless-assignment": "off",
    },
  },
];
