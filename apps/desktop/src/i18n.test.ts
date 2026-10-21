// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import i18n from "./i18n";
import en from "./locales/en.json";
import es from "./locales/es.json";
afterEach(async () => {
  await i18n.changeLanguage("en");
});
it("keeps catalog keys and interpolation variables in sync", () => {
  expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    expect(es[key].match(/{{\w+}}/g) ?? []).toEqual(
      en[key].match(/{{\w+}}/g) ?? [],
    );
  }
});
it("switches language, document metadata and plural forms without translating source content", async () => {
  await i18n.changeLanguage("es");
  expect(i18n.t("History")).toBe("Historial");
  expect(i18n.t("{{count}} files", { count: 1 })).toBe("1 archivo");
  expect(i18n.t("{{count}} files", { count: 2 })).toBe("2 archivos");
  expect(document.documentElement.lang).toBe("es");
  expect(document.documentElement.dir).toBe("ltr");
  expect(i18n.t("Unknown source text")).toBe("Unknown source text");
  await i18n.changeLanguage("en");
  expect(i18n.t("{{count}} files", { count: 1 })).toBe("1 file");
});
