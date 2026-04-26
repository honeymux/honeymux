import { readFileSync } from "node:fs";

const { types } = JSON.parse(
  readFileSync(".github/commitlint.json", "utf8"),
);

export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [(msg) => /^Signed-off-by: dependabot\[bot\]/m.test(msg)],
  rules: {
    "body-empty": [2, "never"],
    "body-leading-blank": [2, "always"],
    "body-max-line-length": [2, "always", 72],
    "footer-leading-blank": [2, "always"],
    "footer-max-line-length": [2, "always", 72],
    "header-max-length": [2, "always", 72],

    "type-enum": [2, "always", types],
  },
};
