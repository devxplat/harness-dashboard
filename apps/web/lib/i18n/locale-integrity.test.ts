import { describe, expect, it } from "vitest";
import { LOCALES } from "./config";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ja from "./locales/ja.json";
import nl from "./locales/nl.json";
import pt from "./locales/pt.json";
import zh from "./locales/zh.json";

const RESOURCES = { de, en, es, ja, nl, pt, zh } as const;

function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? { [prefix]: String(value) } : {};
  }
  return Object.entries(value).reduce<Record<string, string>>((acc, [key, nested]) => {
    Object.assign(acc, flatten(nested, prefix ? `${prefix}.${key}` : key));
    return acc;
  }, {});
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1]!).sort();
}

describe("locale resources", () => {
  it("has one JSON resource for every configured locale", () => {
    expect(Object.keys(RESOURCES).sort()).toEqual(LOCALES.map((locale) => locale.code).sort());
  });

  it("keeps every locale in key and interpolation sync with English", () => {
    const english = flatten(en);
    const englishKeys = Object.keys(english).sort();

    for (const locale of LOCALES) {
      const current = flatten(RESOURCES[locale.code]);
      expect(Object.keys(current).sort(), locale.code).toEqual(englishKeys);
      for (const key of englishKeys) {
        expect(placeholders(current[key] ?? ""), `${locale.code}:${key}`).toEqual(
          placeholders(english[key] ?? ""),
        );
      }
    }
  });
});
