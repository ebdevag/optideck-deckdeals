import { useSettings } from '../hooks/useSettings'
import { DropdownItem, PanelSection, PanelSectionRow, ToggleField } from 'decky-frontend-lib'
import { STORES } from '../utils/Stores';
import { PROVIDERS } from '../utils/Providers';
import { useState } from 'react';
import { FaChevronDown, FaChevronRight } from 'react-icons/fa';
import { t, getAvailableLocales } from '../l10n';
import { CURRENCY_METADATA } from '../utils/CurrencyMeta';

const DeckyMenuOption = () => {
  const {
    country,
    saveCountry,
    stores,
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
  } = useSettings();

  const [storesExpanded, setStoresExpanded] = useState(false);
  const [providersExpanded, setProvidersExpanded] = useState(false);

  // Major gaming regions/countries (Expanded)
  const countryOptions = [
    // North America
    { data: "US", label: "United States (US)" },
    { data: "CA", label: "Canada (CA)" },
    { data: "MX", label: "Mexico (MX)" },
    // Europe
    { data: "GB", label: "United Kingdom (GB)" },
    { data: "DE", label: "Germany (DE)" },
    { data: "FR", label: "France (FR)" },
    { data: "ES", label: "Spain (ES)" },
    { data: "IT", label: "Italy (IT)" },
    { data: "PL", label: "Poland (PL)" },
    { data: "NL", label: "Netherlands (NL)" },
    { data: "SE", label: "Sweden (SE)" },
    { data: "NO", label: "Norway (NO)" },
    { data: "CH", label: "Switzerland (CH)" },
    { data: "DK", label: "Denmark (DK)" },
    { data: "FI", label: "Finland (FI)" },
    { data: "AT", label: "Austria (AT)" },
    { data: "CZ", label: "Czech Republic (CZ)" },
    { data: "HU", label: "Hungary (HU)" },
    { data: "RO", label: "Romania (RO)" },
    { data: "UA", label: "Ukraine (UA)" },
    { data: "BE", label: "Belgium (BE)" },
    { data: "PT", label: "Portugal (PT)" },
    { data: "IE", label: "Ireland (IE)" },
    // Asia
    { data: "JP", label: "Japan (JP)" },
    { data: "KR", label: "South Korea (KR)" },
    { data: "CN", label: "China (CN)" },
    { data: "TW", label: "Taiwan (TW)" },
    { data: "HK", label: "Hong Kong (HK)" },
    { data: "IN", label: "India (IN)" },
    { data: "ID", label: "Indonesia (ID)" },
    { data: "MY", label: "Malaysia (MY)" },
    { data: "PH", label: "Philippines (PH)" },
    { data: "SG", label: "Singapore (SG)" },
    { data: "TH", label: "Thailand (TH)" },
    { data: "VN", label: "Vietnam (VN)" },
    // South America
    { data: "BR", label: "Brazil (BR)" },
    { data: "AR", label: "Argentina (AR)" },
    { data: "CL", label: "Chile (CL)" },
    { data: "CO", label: "Colombia (CO)" },
    { data: "PE", label: "Peru (PE)" },
    // Oceania
    { data: "AU", label: "Australia (AU)" },
    { data: "NZ", label: "New Zealand (NZ)" },
    // Middle East / Africa
    { data: "IL", label: "Israel (IL)" },
    { data: "SA", label: "Saudi Arabia (SA)" },
    { data: "AE", label: "United Arab Emirates (AE)" },
    { data: "ZA", label: "South Africa (ZA)" },
    { data: "TR", label: "Turkey (TR)" },
  ];

  const getCurrencyForCountry = (cc: string) => {
    const Mapping: Record<string, string> = {
      "US": "USD", "CA": "CAD", "MX": "USD",
      "GB": "GBP", "PL": "PLN", "JP": "JPY", "KR": "KRW", "CN": "CNY",
      "TW": "TWD", "IN": "INR", "ID": "IDR", "PH": "PHP", "BR": "BRL",
      "AU": "AUD", "NZ": "NZD",
      "DE": "EUR", "FR": "EUR", "ES": "EUR", "IT": "EUR", "NL": "EUR",
      "SE": "EUR", "NO": "EUR", "CH": "EUR", "DK": "EUR", "FI": "EUR",
      "AT": "EUR", "CZ": "EUR", "HU": "EUR", "RO": "EUR", "UA": "EUR",
      "BE": "EUR", "PT": "EUR", "IE": "EUR",
      "HK": "USD", "MY": "USD", "SG": "USD", "TH": "USD", "VN": "USD",
      "AR": "USD", "CL": "USD", "CO": "USD", "PE": "USD", "IL": "USD",
      "SA": "USD", "AE": "USD", "ZA": "USD", "TR": "USD"
    };
    return Mapping[cc] || "USD";
  };

  const getNativeCurrency = (cc: string) => {
    const NativeMapping: Record<string, string> = {
      "NO": "NOK", "CH": "CHF", "DK": "DKK", "FI": "EUR", "SE": "SEK",
      "HK": "HKD", "MY": "MYR", "SG": "SGD", "TH": "THB", "VN": "VND",
      "AR": "ARS", "CL": "CLP", "CO": "COP", "PE": "PEN", "IL": "ILS",
      "SA": "SAR", "AE": "AED", "ZA": "ZAR", "TR": "TRY", "RU": "RUB",
      "MX": "MXN", "UA": "UAH", "CZ": "CZK", "HU": "HUF", "RO": "RON"
    };
    // Default to mapping result if not in native mapping (meaning it likely matches)
    return NativeMapping[cc] || getCurrencyForCountry(cc);
  };

  const selectedStoreNames = STORES.filter(s => stores.includes(s.id)).map(s => s.title);
  const selectedProviderNames = PROVIDERS.filter(p => providers.includes(p.id)).map(p => p.title);
  const currentCurrency = getCurrencyForCountry(country);
  const nativeCurrency = getNativeCurrency(country);
  const showWarning = nativeCurrency !== currentCurrency;
  const currentCountryLabel = countryOptions.find(o => o.data === country)?.label?.split(' (')[0] || country;

  const getStoreCurrencyInfo = (storeTitle: string) => {
    const regionCurrencies = CURRENCY_METADATA[country]?.stores?.[storeTitle];
    if (!Array.isArray(regionCurrencies) || regionCurrencies.length === 0) {
      return { currencies: [] as string[], status: 'unknown' as const };
    }

    const currencies = [...new Set(regionCurrencies.filter(Boolean))];
    if (currencies.length === 0) {
      return { currencies: [] as string[], status: 'unknown' as const };
    }

    const includesNative = currencies.includes(nativeCurrency);
    if (includesNative && currencies.length === 1) {
      return { currencies, status: 'native' as const };
    }
    if (includesNative) {
      return { currencies, status: 'mixed' as const };
    }
    return { currencies, status: 'nonNative' as const };
  };

  const storesByCurrency = selectedStoreNames.reduce((acc, name) => {
    const info = getStoreCurrencyInfo(name);
    // Only include stores with known currency data
    if (info.status !== 'unknown') {
      info.currencies.forEach(curr => {
        if (!acc[curr]) acc[curr] = [];
        if (!acc[curr].includes(name)) acc[curr].push(name);
      });
    }
    return acc;
  }, {} as Record<string, string[]>);

  // Get ALL stores and their currencies for the current region (for info display)
  const allStoresCurrencyInfo = STORES.map(store => {
    const info = getStoreCurrencyInfo(store.title);
    return {
      name: store.title,
      id: store.id,
      currencies: info.currencies,
      status: info.status,
      isSelected: stores.includes(store.id)
    };
  }).filter(store => store.status !== 'unknown'); // Only show stores with data

  // Group all stores by currency
  const allStoresByCurrency = allStoresCurrencyInfo.reduce((acc, store) => {
    store.currencies.forEach(curr => {
      if (!acc[curr]) acc[curr] = { selected: [], unselected: [] };
      if (store.isSelected) {
        acc[curr].selected.push(store.name);
      } else {
        acc[curr].unselected.push(store.name);
      }
    });
    return acc;
  }, {} as Record<string, { selected: string[], unselected: string[] }>);

  const [expandedCurrencies, setExpandedCurrencies] = useState<Record<string, boolean>>({});
  const [showAllStores, setShowAllStores] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const toggleCurrencyExpand = (curr: string) => {
    setExpandedCurrencies(prev => ({ ...prev, [curr]: !prev[curr] }));
  };

  return (
    <>
      <PanelSection title={t("settings.general.title")}>
        <ToggleField
          label={t("settings.enable.label")}
          description={t("settings.enable.description")}
          checked={enabled}
          onChange={toggleEnabled}
        />
        <ToggleField
          label={t("settings.quickLinks.label")}
          description={t("settings.quickLinks.description")}
          checked={showQuickLinks}
          onChange={toggleShowQuickLinks}
        />
        <ToggleField
          label={t("settings.predictions.label")}
          description={t("settings.predictions.description")}
          checked={showPredictions}
          onChange={toggleShowPredictions}
        />
      </PanelSection>

      <PanelSection title={t("settings.display.title")}>
        <DropdownItem
          label={t("settings.dateFormat.label")}
          description={t("settings.dateFormat.description")}
          rgOptions={[
            { data: "default", label: t("settings.dateFormat.default") },
            { data: "US", label: t("settings.dateFormat.us") },
            { data: "EU", label: t("settings.dateFormat.eu") },
            { data: "ISO", label: t("settings.dateFormat.iso") },
          ]}
          selectedOption={dateFormat}
          onChange={(option) => saveDateFormat(option.data)}
        />
        <DropdownItem
          label={t("settings.historyRange.label")}
          description={t("settings.historyRange.description")}
          rgOptions={[
            { data: "3m", label: t("settings.historyRange.3m") },
            { data: "6m", label: t("settings.historyRange.6m") },
            { data: "1y", label: t("settings.historyRange.1y") },
            { data: "2y", label: t("settings.historyRange.2y") },
          ]}
          selectedOption={historyRange}
          onChange={(option) => saveHistoryRange(option.data)}
        />
      </PanelSection>

      <PanelSection title={t("settings.region.title")}>
        <DropdownItem
          label={t("settings.country.label")}
          description={t("settings.country.description")}
          rgOptions={countryOptions}
          selectedOption={countryOptions.find(option => option.data === country)?.data}
          onChange={(option) => saveCountry(option.data)}
        ></DropdownItem>
        <ToggleField
          label={t("settings.stores.showListLabel")}
          description={selectedStoreNames.length > 0
            ? (
              <span>
                <span style={{ color: '#67c1f5' }}>{t("settings.common.selectedPrefix")} </span>
                {selectedStoreNames.join(', ')}
              </span>
            )
            : t("settings.stores.noneSelected")}
          checked={storesExpanded}
          onChange={() => setStoresExpanded(!storesExpanded)}
        />
        {storesExpanded && STORES.map((store) => (
          <ToggleField
            key={store.id}
            label={store.title}
            checked={stores.includes(store.id)}
            onChange={() => toggleStore(store.id)}
          />
        ))}
        <div style={{
          background: 'rgba(255, 255, 255, 0.05)',
          padding: '12px',
          borderRadius: '8px',
          marginTop: '10px',
          fontSize: '12px',
          color: '#8f98a0',
          position: 'relative'
        }}>
          {/* Subtle tail for the bubble */}
          <div style={{
            position: 'absolute',
            top: '-6px',
            left: '10px',
            width: '0',
            height: '0',
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderBottom: '6px solid rgba(255, 255, 255, 0.05)'
          }} />

          <div style={{ lineHeight: '1.4' }}>
            <div style={{ marginBottom: '8px' }}>
              {t("settings.country.currencyHint").replace("{currency}", currentCurrency)}
            </div>

            {Object.keys(storesByCurrency).length > 1 && (
              <>
                <div style={{ marginBottom: '8px' }}>
                  <div
                    onClick={() => setShowHowItWorks(!showHowItWorks)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      color: '#67c1f5',
                      fontSize: '11px',
                      fontWeight: 600
                    }}
                  >
                    <span style={{ marginRight: '6px', fontSize: '10px' }}>
                      {showHowItWorks ? <FaChevronDown /> : <FaChevronRight />}
                    </span>
                    <span>{t("settings.stores.howItWorksLabel")}</span>
                  </div>
                  {showHowItWorks && (
                    <div style={{
                      marginTop: '6px',
                      fontSize: '11px',
                      lineHeight: '1.45',
                      color: '#c6d4df'
                    }}>
                      <div>{t("settings.stores.howItWorksBody1")}</div>
                      <div style={{ marginTop: '6px' }}>{t("settings.stores.howItWorksBody2")}</div>
                      <div style={{ marginTop: '6px' }}>{t("settings.stores.howItWorksBody3")}</div>
                    </div>
                  )}
                </div>

                <div style={{ 
                  fontSize: '11px', 
                  fontWeight: 600, 
                  color: '#8f98a0', 
                  marginBottom: '6px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  {t("settings.stores.selectedHeader")}
                </div>

                {Object.entries(storesByCurrency).map(([curr, names]) => (
                  <div key={curr} style={{ marginTop: '4px' }}>
                    <div
                      onClick={() => toggleCurrencyExpand(curr)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer',
                        color: curr === nativeCurrency ? '#beee11' : '#ffc107',
                        fontWeight: curr === nativeCurrency ? 400 : 500
                      }}
                    >
                      <span style={{ marginRight: '6px', fontSize: '10px' }}>
                        {expandedCurrencies[curr] ? <FaChevronDown /> : <FaChevronRight />}
                      </span>
                      <span>
                        {t("settings.country.storesReturning").replace("{currency}", curr)} {names.length}
                      </span>
                    </div>
                    {expandedCurrencies[curr] && (
                      <div style={{
                        paddingLeft: '16px',
                        fontSize: '11px',
                        color: '#6b7280',
                        marginTop: '2px'
                      }}>
                        {names.join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Show all stores button */}
            <div 
              onClick={() => setShowAllStores(!showAllStores)}
              style={{
                marginTop: '12px',
                padding: '8px',
                background: 'rgba(103, 193, 245, 0.05)',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                border: '1px solid rgba(103, 193, 245, 0.2)',
                transition: 'all 0.2s'
              }}
            >
              <span style={{ fontSize: '11px', color: '#67c1f5', fontWeight: 500 }}>
                {showAllStores
                  ? t("settings.stores.hideAllForCountry").replace("{country}", currentCountryLabel)
                  : t("settings.stores.showAllForCountry").replace("{country}", currentCountryLabel)}
              </span>
              <span style={{ fontSize: '10px', color: '#67c1f5' }}>
                {showAllStores ? <FaChevronDown /> : <FaChevronRight />}
              </span>
            </div>

            {/* All stores breakdown */}
            {showAllStores && (
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <div style={{ 
                  fontSize: '11px', 
                  fontWeight: 600, 
                  color: '#8f98a0', 
                  marginBottom: '6px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  {t("settings.stores.allAvailableHeader")}
                </div>
                {Object.entries(allStoresByCurrency)
                  .sort(([a], [b]) => {
                    // Sort: native currency first, then alphabetically
                    if (a === nativeCurrency) return -1;
                    if (b === nativeCurrency) return 1;
                    return a.localeCompare(b);
                  })
                  .map(([curr, storeGroups]) => {
                    const totalStores = storeGroups.selected.length + storeGroups.unselected.length;
                    return (
                      <div key={curr} style={{ marginTop: '6px' }}>
                        <div style={{
                          fontSize: '11px',
                          color: curr === nativeCurrency ? '#beee11' : '#ffc107',
                          fontWeight: 500,
                          marginBottom: '2px'
                        }}>
                          {curr} ({t("settings.stores.count").replace("{count}", String(totalStores))})
                        </div>
                        <div style={{
                          paddingLeft: '12px',
                          fontSize: '10px',
                          color: '#6b7280',
                          lineHeight: '1.5'
                        }}>
                          {storeGroups.selected.length > 0 && (
                            <div style={{ marginBottom: '2px' }}>
                              <span style={{ color: '#67c1f5' }}>
                                ✓ {t("settings.stores.selectedBadge")}:
                              </span>{" "}
                              {storeGroups.selected.join(", ")}
                            </div>
                          )}
                          {storeGroups.unselected.length > 0 && (
                            <div style={{ opacity: 0.7 }}>
                              <span>{t("settings.stores.availableBadge")}:</span>{" "}
                              {storeGroups.unselected.join(", ")}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                <div style={{ 
                  marginTop: '8px', 
                  fontSize: '10px', 
                  color: '#6b7280',
                  fontStyle: 'italic',
                  textAlign: 'center'
                }}>
                  {t("settings.stores.availableInCountry")
                    .replace("{count}", String(allStoresCurrencyInfo.length))
                    .replace("{country}", currentCountryLabel)}
                </div>
              </div>
            )}

            {showWarning && (
              <div style={{ color: '#ffc107', marginTop: '10px', fontSize: '11px', fontWeight: 500, borderTop: '1px solid rgba(255, 193, 7, 0.2)', paddingTop: '8px' }}>
                {t("settings.country.nativeCurrencyWarning")
                  .replace("{country}", currentCountryLabel)
                  .replace("{native}", nativeCurrency)
                  .replace("{fallback}", currentCurrency)}
              </div>
            )}
          </div>
        </div>
        <ToggleField
          label={t("settings.provider.showListLabel")}
          description={selectedProviderNames.length > 0
            ? (
              <span>
                <span style={{ color: '#67c1f5' }}>{t("settings.common.selectedPrefix")} </span>
                {selectedProviderNames.join(', ')}
              </span>
            )
            : t("settings.provider.noneSelected")}
          checked={providersExpanded}
          onChange={() => setProvidersExpanded(!providersExpanded)}
        />
        {providersExpanded && PROVIDERS.map((p) => (
          <ToggleField
            key={p.id}
            label={p.title}
            checked={providers.includes(p.id)}
            onChange={() => toggleProvider(p.id)}
          />
        ))}
      </PanelSection>

      <PanelSection title={t("settings.about.title")}>
        <PanelSectionRow>
          <div style={{
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            padding: '8px 10px',
            borderRadius: '6px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            lineHeight: '1.4'
          }}>
            <div style={{ fontSize: '10px', color: '#8f98a0', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
              {t("attribution.title")}
            </div>
            <div style={{ color: '#8f98a0', fontSize: '11px', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
              {t("attribution.line1")}
            </div>
            <div style={{ color: '#8f98a0', fontSize: '11px', marginTop: '2px', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
              {t("attribution.line2")}
            </div>
            <div style={{ color: '#8f98a0', fontSize: '11px', marginTop: '2px', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
              {t("attribution.line3")}
            </div>
            <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '2px', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
              {t("attribution.line4")}
            </div>
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={t("settings.language.title")}>
        <DropdownItem
          label={t("settings.language.label")}
          rgOptions={getAvailableLocales()}
          selectedOption={locale}
          onChange={(option) => saveLocale(option.data)}
        />
      </PanelSection>
    </>
  );
}

export default DeckyMenuOption
