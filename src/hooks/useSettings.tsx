import { useEffect, useState } from "react";
import { SETTINGS, Setting } from "../utils/Settings";
import { setLocale } from "../l10n";

export function useSettings() {
  const [fontSize, setFontSize] = useState<number>(SETTINGS.defaults.fontSize);
  const [paddingBottom, setPaddingBottom] = useState<number>(SETTINGS.defaults.paddingBottom);
  const [country, setCountry] = useState<string>(SETTINGS.defaults.country);
  const [stores, setStores] = useState<number[]>(SETTINGS.defaults.stores);
  const [enabled, setEnabled] = useState<boolean>(SETTINGS.defaults.enabled);
  const [dateFormat, setDateFormat] = useState<string>(SETTINGS.defaults.dateFormat);
  const [showQuickLinks, setShowQuickLinks] = useState<boolean>(SETTINGS.defaults.showQuickLinks);
  const [showPredictions, setShowPredictions] = useState<boolean>(SETTINGS.defaults.showPredictions);
  const [providers, setProviders] = useState<string[]>(SETTINGS.defaults.providers);
  const [historyRange, setHistoryRange] = useState<string>(SETTINGS.defaults.historyRange);
  const [locale, setLocaleState] = useState<string>(SETTINGS.defaults.locale);

  useEffect(() => {
    let mounted = true;
    async function loadAll() {
      const loadedFontSize = await SETTINGS.load(Setting.FONTSIZE);
      if (!mounted) return;
      if (loadedFontSize) setFontSize(Number(loadedFontSize));

      const loadedPaddingBottom = await SETTINGS.load(Setting.PADDING_BOTTOM);
      if (!mounted) return;
      if (loadedPaddingBottom) setPaddingBottom(Number(loadedPaddingBottom));

      const loadedCountry = await SETTINGS.load(Setting.COUNTRY);
      if (!mounted) return;
      if (loadedCountry) setCountry(String(loadedCountry));

      const loadedStores = await SETTINGS.load(Setting.STORES);
      if (!mounted) return;
      if (loadedStores) setStores(loadedStores);

      const loadedEnabled = await SETTINGS.load(Setting.ENABLED);
      if (!mounted) return;
      if (loadedEnabled !== undefined) setEnabled(Boolean(loadedEnabled));

      const loadedDateFormat = await SETTINGS.load(Setting.DATE_FORMAT);
      if (!mounted) return;
      if (loadedDateFormat) setDateFormat(String(loadedDateFormat));

      const loadedShowQuickLinks = await SETTINGS.load(Setting.SHOW_QUICK_LINKS);
      if (!mounted) return;
      if (loadedShowQuickLinks !== undefined) setShowQuickLinks(Boolean(loadedShowQuickLinks));

      const loadedShowPredictions = await SETTINGS.load(Setting.SHOW_PREDICTIONS);
      if (!mounted) return;
      if (loadedShowPredictions !== undefined) setShowPredictions(Boolean(loadedShowPredictions));

      const loadedProviders = await SETTINGS.load(Setting.PROVIDERS);
      if (!mounted) return;
      if (loadedProviders) setProviders(loadedProviders);

      const loadedHistoryRange = await SETTINGS.load(Setting.HISTORY_RANGE);
      if (!mounted) return;
      if (loadedHistoryRange) setHistoryRange(String(loadedHistoryRange));

      const loadedLocale = await SETTINGS.load(Setting.LOCALE);
      if (!mounted) return;
      if (loadedLocale) {
        setLocaleState(String(loadedLocale));
        setLocale(String(loadedLocale));
      }
    }

    loadAll();
    return () => { mounted = false };
  }, []);

  const saveFontSize = (s: number) => {
    setFontSize(s);
    SETTINGS.save(Setting.FONTSIZE, s);
  }

  const savePaddingBottom = (p: number) => {
    setPaddingBottom(p);
    SETTINGS.save(Setting.PADDING_BOTTOM, p);
  }

  const saveCountry = (c: string) => {
    setCountry(c);
    SETTINGS.save(Setting.COUNTRY, c);
  }

  const saveStores = (s: number[]) => {
    setStores(s);
    SETTINGS.save(Setting.STORES, s);
  }

  const toggleStore = (storeId: number) => {
    const newStores = stores.includes(storeId)
      ? stores.filter(id => id !== storeId)
      : [...stores, storeId];
    saveStores(newStores);
  }

  const toggleEnabled = () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    SETTINGS.save(Setting.ENABLED, newEnabled);
  }

  const saveDateFormat = (f: string) => {
    setDateFormat(f);
    SETTINGS.save(Setting.DATE_FORMAT, f);
  }

  const toggleShowQuickLinks = () => {
    const newVal = !showQuickLinks;
    setShowQuickLinks(newVal);
    SETTINGS.save(Setting.SHOW_QUICK_LINKS, newVal);
  }

  const toggleShowPredictions = () => {
    const newVal = !showPredictions;
    setShowPredictions(newVal);
    SETTINGS.save(Setting.SHOW_PREDICTIONS, newVal);
  }

  const saveProviders = (p: string[]) => {
    setProviders(p);
    SETTINGS.save(Setting.PROVIDERS, p);
  }

  const toggleProvider = (providerId: string) => {
    const newProviders = providers.includes(providerId)
      ? providers.filter(id => id !== providerId)
      : [...providers, providerId];
    saveProviders(newProviders);
  }

  const saveHistoryRange = (Range: string) => {
    setHistoryRange(Range);
    SETTINGS.save(Setting.HISTORY_RANGE, Range);
  }

  const saveLocale = (l: string) => {
    setLocaleState(l);
    setLocale(l);
    SETTINGS.save(Setting.LOCALE, l);
  }

  return {
    fontSize,
    saveFontSize,
    paddingBottom,
    savePaddingBottom,
    country,
    saveCountry,
    stores,
    saveStores,
    toggleStore,
    enabled,
    toggleEnabled,
    dateFormat,
    saveDateFormat,
    showQuickLinks,
    toggleShowQuickLinks,
    showPredictions,
    toggleShowPredictions,
    providers,
    toggleProvider,
    historyRange,
    saveHistoryRange,
    locale,
    saveLocale,
  }
}
