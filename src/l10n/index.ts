import { en } from "./en";

// Currently only English is supported.
// To add a new language:
//   1. Copy template.ts → <lang>.ts (e.g. de.ts)
//   2. Fill in all the translated strings
//   3. Import it here and add to the `locales` map
//   4. Wire up a language setting in Settings.ts + DeckyMenuOption.tsx

const locales: Record<string, Record<string, string>> = {
    en,
};

let currentLocale = "en";

/**
 * Set the active locale. Falls back to "en" if not found.
 */
export function setLocale(locale: string) {
    currentLocale = locales[locale] ? locale : "en";
}

/**
 * Translate a key. Returns the localized string, falling back to English,
 * or the raw key if no translation exists.
 */
export function t(key: string): string {
    return locales[currentLocale]?.[key] ?? locales["en"]?.[key] ?? key;
}

/**
 * Get all available locales with their display names.
 */
export function getAvailableLocales(): { data: string; label: string }[] {
    return Object.keys(locales).map(code => ({
        data: code,
        label: locales[code]["language.name"] || code
    }));
}
