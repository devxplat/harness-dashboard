import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

const VISIBLE_JSX_ATTRIBUTES = new Set([
  "aria-label",
  "placeholder",
  "title",
  "alt",
  "label",
  "message",
  "description",
  "emptyMessage",
]);

const ALLOWED_UI_LITERALS = new Set([
  "AI",
  "API",
  "CLI",
  "DORA",
  "GitHub",
  "Google",
  "Claude",
  "OpenAI",
  "Gemini",
  "Cursor",
  "Google Antigravity",
  "GitHub Copilot",
  "opencode",
  "RTK",
  "Merge SHA",
  "MTTR",
]);

function hasHumanLetters(value) {
  return /[\p{L}]/u.test(value);
}

function isAllowedLiteral(value) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return (
    !normalized ||
    !hasHumanLetters(normalized) ||
    ALLOWED_UI_LITERALS.has(normalized) ||
    /^(r|n|m|n=)$/.test(normalized) ||
    /^[A-Z0-9_./:# -]+$/.test(normalized)
  );
}

function hasI18nExemption(context, node) {
  return context
    .sourceCode
    .getCommentsBefore(node)
    .some((comment) => comment.value.includes("i18n-exempt:"));
}

function calleeName(node) {
  if (!node) return "";
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    const object = calleeName(node.object);
    const property = calleeName(node.property);
    return object && property ? `${object}.${property}` : object || property;
  }
  return "";
}

const i18nNoHardcodedUiStrings = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow hardcoded user-visible strings in frontend production code.",
    },
    messages: {
      hardcoded: "User-visible string must use i18n: {{value}}",
    },
    schema: [],
  },
  create(context) {
    function report(node, value) {
      if (isAllowedLiteral(value) || hasI18nExemption(context, node)) return;
      context.report({
        node,
        messageId: "hardcoded",
        data: { value: value.replace(/\s+/g, " ").trim().slice(0, 80) },
      });
    }

    function reportStringExpressions(node) {
      if (!node) return;
      switch (node.type) {
        case "Literal":
          if (typeof node.value === "string") report(node, node.value);
          return;
        case "TemplateLiteral":
          if (node.expressions.length === 0) {
            report(node, node.quasis.map((quasi) => quasi.value.cooked ?? "").join(""));
          }
          return;
        case "ConditionalExpression":
          reportStringExpressions(node.consequent);
          reportStringExpressions(node.alternate);
          return;
        case "LogicalExpression":
          reportStringExpressions(node.right);
          return;
        default:
          return;
      }
    }

    return {
      JSXText(node) {
        report(node, node.value);
      },
      JSXExpressionContainer(node) {
        if (node.parent?.type !== "JSXElement" && node.parent?.type !== "JSXFragment") return;
        reportStringExpressions(node.expression);
      },
      JSXAttribute(node) {
        if (!VISIBLE_JSX_ATTRIBUTES.has(node.name?.name)) return;
        if (node.value?.type === "Literal" && typeof node.value.value === "string") {
          report(node.value, node.value.value);
        }
        if (node.value?.type === "JSXExpressionContainer") {
          reportStringExpressions(node.value.expression);
        }
      },
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (!/^toast\.(success|error|info|warning|promise)$/.test(name)) return;
        const first = node.arguments[0];
        if (first?.type === "Literal" && typeof first.value === "string") {
          report(first, first.value);
        }
      },
    };
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.codex/**",
      "**/out/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/target/**",
      "**/tmp/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    ignores: [
      "apps/web/**/*.test.{ts,tsx}",
      "apps/web/e2e/**",
      "apps/web/components/ui/**",
      "apps/web/lib/i18n/locales/**",
    ],
    plugins: {
      "harness-i18n": {
        rules: {
          "no-hardcoded-ui-strings": i18nNoHardcodedUiStrings,
        },
      },
    },
    rules: {
      "harness-i18n/no-hardcoded-ui-strings": "error",
    },
  },
  {
    // Plain JS (config + node scripts) run under Node.
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly", Buffer: "readonly" },
    },
  },
  prettier,
);
