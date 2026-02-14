import { ServerAPI, findModuleChild } from "decky-frontend-lib"
import { CACHE } from "../utils/Cache"
import { priceService } from "../service/PriceService"
import { exchangeRateService } from "../service/ExchangeRateService"
import { SETTINGS, Setting } from "../utils/Settings"
import { t } from "../l10n"

/*
 * StoreInjector is the bridge between Decky and the Steam Store webview.
 *
 * High-level flow:
 * 1) Watch Steam Deck route changes to detect entry/exit of /steamweb.
 * 2) Connect to the local Chromium DevTools endpoint for the store tab.
 * 3) Track page navigations to keep the current appId in sync.
 * 4) Inject the Deckdeals UI block into store pages.
 * 5) Fetch deal data and update the injected UI via Runtime.evaluate calls.
 * 6) Tear everything down cleanly when leaving the store.
 *
 * Security notes for reviewers:
 * - DevTools endpoint is localhost only (`http://localhost:8080/json`).
 * - DOM writes happen only inside Steam Store pages after URL checks.
 * - appId is extracted from a strict numeric route regex.
 * - Most dynamic content is generated from plugin-owned data/settings.
 * - All listeners/sockets are detached on teardown to prevent stale handlers.
 */

// Tab metadata shape returned by the local DevTools /json endpoint.
type Tab = {
    description: string
    devtoolsFrontendUrl: string
    id: string
    title: string
    type: 'page'
    url: string
    webSocketDebuggerUrl: string
}

type Info = {
    hash: string
    key: string
    pathname: string
    search: string
    state: { force: number; url: string }
}

// Decky's internal router interface used to observe path changes.
const History: {
    listen: (callback: (info: Info) => void) => () => void;
    location?: Info;
} = findModuleChild((m) => {
    if (typeof m !== 'object') return undefined
    for (const prop in m) {
        if (m[prop]?.m_history) return m[prop].m_history
    }
})

export const injectStore = (serverApi: ServerAPI) => {
    // =========================================================================
    // PART 1: Lifecycle State + Early Exit
    // Purpose: Initialize runtime state and fail closed if router hooks are unavailable.
    // Security: On missing History API we do nothing except clear cached app id.
    // =========================================================================
    // Injector lifecycle state and transport handles.
    let isStoreMounted = false;
    if (!History || !History.listen) {
        return () => { CACHE.setValue(CACHE.APP_ID_KEY, ""); };
    }

    let storeWebSocket: WebSocket | null = null;
    let retryTimer: NodeJS.Timeout | null = null;
    let wsMessageId = 10; // Counter for WebSocket command IDs

    // =========================================================================
    // PART 2: `injectDeckDealsBox(appId)`
    // Purpose: Insert/replace the Deckdeals UI shell in the current Steam Store DOM.
    // Security: Requires an OPEN websocket and writes only within store page context.
    // =========================================================================
    // Section: UI injection.
    // Creates or replaces the Deckdeals module container in the store DOM.
    const injectDeckDealsBox = async (appId: string) => {
        if (!storeWebSocket || storeWebSocket.readyState !== WebSocket.OPEN) return;

        const historyRange = await SETTINGS.load(Setting.HISTORY_RANGE) || "1y";
        const historyRangeText = t("settings.historyRange." + historyRange);
        const steamDBUrl = `https://steamdb.info/app/${appId}/`;
        const settingsPadding = SETTINGS.defaults.paddingBottom;

        // Load setting for Quick Links to prevent flash
        const showQuickLinks = await SETTINGS.load(Setting.SHOW_QUICK_LINKS);
        // Default to true if undefined
        const showQuickLinksBool = showQuickLinks !== undefined ? showQuickLinks : true;
        const displayStyle = showQuickLinksBool ? 'flex' : 'none';

        // We inject a script that runs in the context of the store page (Steam browser)
        const js = `
            (function() {
                var appId = "${appId}";
                var boxId = 'dbpc-deckdeals-box-' + appId;
                
                // PART 2A (browser context): remove previous injected modules before re-insert.
                var existing = document.getElementById(boxId);
                if (existing) existing.remove();
                
                // PART 2B (browser context): clean up legacy id from older plugin versions.
                var oldLegacy = document.getElementById('dbpc-steamdb-box');
                if (oldLegacy) oldLegacy.remove();

                var wrapperDiv = document.createElement('div');
                wrapperDiv.id = boxId;
                wrapperDiv.className = 'game_area_purchase_game_wrapper';
                // Scoped class for easier cleanup if needed
                wrapperDiv.classList.add('deckdeals-injected-module'); 

                wrapperDiv.style.marginTop = '20px';
                wrapperDiv.style.marginBottom = '${settingsPadding}px'; 

                
                 // Close button logic for modal
                 var closeBtnHtml = '';

                wrapperDiv.innerHTML = \`
                    <div class="game_area_purchase_game" style="background: #3b5a7280; padding: 16px; border-radius: 4px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <h2 class="title" style="color: #fff; font-size: 18px; margin: 0;">${t("store.title")}</h2>

                        </div>
                        
                        <div class="Deckdeals-info" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                            <!-- Row 1, Col 1: Current Price -->
                            <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                                <div style="font-size: 10px; color: #8f98a0; margin-bottom: 2px; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">${t("store.currentPrice")}</div>
                                <div style="font-size: 15px; color: #fff; font-weight: bold; margin-bottom: 0px;">
                                    <span id="dd-current-${appId}">${t("store.loading")}</span>
                                </div>
                                <div id="dd-current-store-${appId}" style="font-size: 11px; color: #67c1f5; text-align: center;">
                                    <!-- Store -->
                                </div>
                            </div>

                            <!-- Row 1, Col 2: Lowest Price -->
                            <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                                <div style="font-size: 10px; color: #8f98a0; margin-bottom: 2px; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">${t("store.lowestPrice")}</div>
                                <div style="font-size: 15px; color: #fff; font-weight: bold; margin-bottom: 0px;">
                                    <span id="dd-lowest-${appId}">${t("store.loading")}</span>
                                </div>
                                <div id="dd-lowest-date-${appId}" style="font-size: 11px; color: #8f98a0; text-align: center;">
                                    <!-- Date - Store -->
                                </div>
                            </div>
                            
                            <!-- Row 2: Prediction (Full Width) -->
                            <div id="dd-prediction-${appId}" style="grid-column: 1 / -1; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 4px; display: none; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #67c1f5;">
                                <!-- Prediction content injected here -->
                            </div>
                        </div>

                        <!-- Graph Container -->
                        <div id="Deckdeals-content-${appId}" style="background: rgba(0, 0, 0, 0.2); padding: 10px; border-radius: 2px; margin-bottom: 10px;">
                            <div class="Deckdeals-graph-container" style="position: relative; height: 60px; width: 100%; margin: 0 0 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                <div id="dd-graph-${appId}" style="width: 100%; height: 100%; display: flex; align-items: flex-end;">
                                    <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #666; font-size: 12px;">${t("store.loadingGraph")}</div>
                                </div>
                                <!-- Overlay for dots -->
                                <div id="dd-graph-overlay-${appId}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;"></div>
                            </div>

                             <!-- Dedicated Hover Info -->
                            <div id="dd-hover-info-${appId}" style="height: 20px; font-size: 12px; color: #8f98a0; text-align: center; opacity: 1; transition: opacity 0.2s;">
                                ${t("store.graphHoverPrompt")}
                            </div>
                            
                            <!-- Disclaimer -->
                            <div style="font-size: 10px; color: #fff; opacity: 0.7; text-align: center; margin-top: 4px;">
                                ${t("store.historyDisclaimer").replace("{period}", historyRangeText)}
                            </div>
                        </div>
                        
                        <div class="Deckdeals-actions" id="dd-actions-${appId}" style="display: ${displayStyle}; gap: 10px;">
                            <a class="btn_blue_steamui btn_medium" href="${steamDBUrl}" target="_blank" style="padding: 6px 12px; font-size: 13px; flex: 1; text-align: center; text-decoration: none; color: white; border-radius: 2px;">
                                <span>${t("store.quickLinkSteamDb")}</span>
                            </a>
                            <a class="btn_blue_steamui btn_medium" href="#" id="dd-itad-link-${appId}" target="_blank" style="padding: 6px 12px; font-size: 13px; flex: 1; text-align: center; text-decoration: none; color: white; border-radius: 2px;">
                                <span>${t("store.quickLinkItad")}</span>
                            </a>
                        </div>
                    </div>
                \`;

                // Inject into Store Page (Standard)
                var purchaseArea = document.querySelector('.game_area_purchase');
                if (purchaseArea) {
                    purchaseArea.parentNode.insertBefore(wrapperDiv, purchaseArea);
                } else {
                    var areaParams = document.querySelector('.game_area_description');
                    if (areaParams) {
                        areaParams.parentNode.insertBefore(wrapperDiv, areaParams);
                    }
                }
            })();
        `;

        storeWebSocket.send(JSON.stringify({
            id: ++wsMessageId,
            method: "Runtime.evaluate",
            params: { expression: js }
        }));
    };

    // =========================================================================
    // PART 3: `updateDeckDealsBox(result, appId)`
    // Purpose: Render data into the injected UI and build graph/prediction visuals.
    // Security: Abort unless websocket is OPEN; settings/data are serialized once
    // before being evaluated in browser context.
    // =========================================================================
    const updateDeckDealsBox = async (result: { data: any, error?: string, debug?: any } | null, appId: string) => {
        if (!storeWebSocket || storeWebSocket.readyState !== WebSocket.OPEN) {
            return;
        }

        // Normalize service result shape for browser-side rendering.
        const data = result ? result.data : null;
        const error = result ? result.error : t("store.unknownError");

        // PART 3A: Load rendering preferences and country/currency settings.
        const dataJson = JSON.stringify(data);
        const errorJson = JSON.stringify(error);
        const dateFormat = await SETTINGS.load(Setting.DATE_FORMAT) || "default";
        const showQuickLinks = await SETTINGS.load(Setting.SHOW_QUICK_LINKS);
        const showQuickLinksBool = showQuickLinks !== undefined ? showQuickLinks : true;
        const showPredictions = await SETTINGS.load(Setting.SHOW_PREDICTIONS);
        const showPredictionsBool = showPredictions !== undefined ? showPredictions : true;
        const historyRange = await SETTINGS.load(Setting.HISTORY_RANGE) || "1y";
        const country = await SETTINGS.load(Setting.COUNTRY) || "US";

        // Determine target currency for conversion (user's native currency)
        const getNativeCurrency = (cc: string) => {
            const NativeMapping: Record<string, string> = {
                "NO": "NOK", "CH": "CHF", "DK": "DKK", "FI": "EUR", "SE": "SEK",
                "HK": "HKD", "MY": "MYR", "SG": "SGD", "TH": "THB", "VN": "VND",
                "AR": "ARS", "CL": "CLP", "CO": "COP", "PE": "PEN", "IL": "ILS",
                "SA": "SAR", "AE": "AED", "ZA": "ZAR", "TR": "TRY", "RU": "RUB",
                "MX": "MXN", "UA": "UAH", "CZ": "CZK", "HU": "HUF", "RO": "RON",
                "US": "USD", "CA": "CAD", "GB": "GBP", "PL": "PLN", "JP": "JPY",
                "KR": "KRW", "CN": "CNY", "TW": "TWD", "IN": "INR", "ID": "IDR",
                "PH": "PHP", "BR": "BRL", "AU": "AUD", "NZ": "NZD",
                "DE": "EUR", "FR": "EUR", "ES": "EUR", "IT": "EUR", "NL": "EUR",
                "AT": "EUR", "BE": "EUR", "PT": "EUR", "IE": "EUR"
            };
            return NativeMapping[cc] || "USD";
        };

        const targetCurrency = getNativeCurrency(country);

        // PART 3B: Exchange rates are optional; renderer remains functional without them.
        let exchangeRates = null;
        try {
            exchangeRates = await exchangeRateService.getExchangeRates(targetCurrency);
        } catch {
            // Continue without exchange rates - prices will be shown in original currencies
        }
        const exchangeRatesJson = JSON.stringify(exchangeRates);

        const js = `
            (function() {
                try {
                var data = ${dataJson};
                var error = ${errorJson};
                var dateFormat = "${dateFormat}";
                var showQuickLinks = ${showQuickLinksBool};
                var showPredictions = ${showPredictionsBool};
                var historyRange = "${historyRange}";
                var appId = "${appId}";
                var targetCurrency = "${targetCurrency}";
                var exchangeRates = ${exchangeRatesJson};
                
                // PART 3C (browser context): conversion + DOM lookup + rendering pipeline.
                var convertCurrency = function(amount, fromCurrency, toCurrency) {
                    if (!exchangeRates || !exchangeRates.rates) return amount;
                    if (fromCurrency === toCurrency) return amount;
                    
                    // If base currency matches target, direct conversion
                    if (exchangeRates.base === toCurrency && exchangeRates.rates[fromCurrency]) {
                        return amount / exchangeRates.rates[fromCurrency];
                    }
                    
                    // If base currency matches source, direct conversion
                    if (exchangeRates.base === fromCurrency && exchangeRates.rates[toCurrency]) {
                        return amount * exchangeRates.rates[toCurrency];
                    }
                    
                    // Cross-currency conversion through base
                    if (exchangeRates.rates[fromCurrency] && exchangeRates.rates[toCurrency]) {
                        var inBase = amount / exchangeRates.rates[fromCurrency];
                        return inBase * exchangeRates.rates[toCurrency];
                    }
                    
                    return amount; // Fallback if conversion not possible
                };
                
                var currentEl = document.getElementById('dd-current-' + appId);
                var currentStoreEl = document.getElementById('dd-current-store-' + appId);
                var lowestEl = document.getElementById('dd-lowest-' + appId);
                var lowestDateEl = document.getElementById('dd-lowest-date-' + appId);
                var diffEl = document.getElementById('dd-diff-' + appId);
                var graphEl = document.getElementById('dd-graph-' + appId);
                var overlayEl = document.getElementById('dd-graph-overlay-' + appId);
                var hoverInfoEl = document.getElementById('dd-hover-info-' + appId);
                var actionsEl = document.getElementById('dd-actions-' + appId);
                var predictionEl = document.getElementById('dd-prediction-' + appId);
                var itadLink = document.getElementById('dd-itad-link-' + appId);
                
                // Force Update Styles (Fix for stale DOM)
                var infoBox1 = document.querySelector('#dbpc-deckdeals-box-' + appId + ' .Deckdeals-info > div:nth-child(1)');
                var infoBox2 = document.querySelector('#dbpc-deckdeals-box-' + appId + ' .Deckdeals-info > div:nth-child(2)');
                
                var applyBadgeStyle = function(el) {
                    if (!el) return;
                    el.style.background = 'rgba(0,0,0,0.2)';
                    el.style.padding = '8px 12px';
                    el.style.borderRadius = '6px';
                    el.style.display = 'flex';
                    el.style.flexDirection = 'column';
                    el.style.alignItems = 'center';
                    el.style.justifyContent = 'center';
                    el.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
                };

                applyBadgeStyle(infoBox1);
                applyBadgeStyle(infoBox2);
                
                var formatDate = function(dateStr) {
                    try {
                        var d = new Date(dateStr);
                        if (isNaN(d.getTime())) return dateStr;
                        
                        if (dateFormat === 'US') {
                            var day = d.getDate().toString().padStart(2, '0');
                            var month = (d.getMonth() + 1).toString().padStart(2, '0');
                            var year = d.getFullYear();
                            return month + '/' + day + '/' + year;
                        }
                        if (dateFormat === 'EU') {
                            var day = d.getDate().toString().padStart(2, '0');
                            var month = (d.getMonth() + 1).toString().padStart(2, '0');
                            var year = d.getFullYear();
                            return day + '/' + month + '/' + year;
                        }
                        if (dateFormat === 'ISO') {
                             var day = d.getDate().toString().padStart(2, '0');
                            var month = (d.getMonth() + 1).toString().padStart(2, '0');
                            var year = d.getFullYear();
                            return year + '-' + month + '-' + day;
                        }
                        
                        return d.toLocaleDateString();
                    } catch (e) { return dateStr; }
                };

                if (!data) {
                    if (currentEl) currentEl.textContent = "${t("store.dataUnavailable")}";
                    if (lowestEl) lowestEl.textContent = "${t("store.dataUnavailable")}";
                    if (diffEl) diffEl.textContent = "";
                    if (graphEl) graphEl.innerHTML = '<div style="width:100%; text-align:center; color:#666;">' + (error || "${t("store.noData")}") + '</div>';
                    return;
                }

                // PART 3D: Filter history by configured range and normalize comparison currency.
                var startDate = new Date();
                
                if (historyRange === '3m') {
                    startDate.setMonth(startDate.getMonth() - 3);
                } else if (historyRange === '6m') {
                    startDate.setMonth(startDate.getMonth() - 6);
                } else if (historyRange === '2y') {
                    startDate.setFullYear(startDate.getFullYear() - 2);
                } else {
                    // Default 1y
                    startDate.setFullYear(startDate.getFullYear() - 1);
                }
                var startTime = startDate.getTime();

                var fullHistory = data.history || [];
                
                // Convert all prices to target currency for fair comparison
                var convertedHistory = fullHistory.map(function(entry) {
                    var convertedAmount = convertCurrency(entry.amount, entry.currency || 'USD', targetCurrency);
                    return {
                        amount: convertedAmount, // Converted for comparison
                        originalAmount: entry.amount, // Original for display
                        originalCurrency: entry.currency || 'USD',
                        date: entry.date,
                        store: entry.store,
                        storeId: entry.storeId || 0
                    };
                });
                var steamHistory = convertedHistory.filter(function(entry) {
                    return entry.storeId === 61 || entry.store === "Steam";
                });
                
                var filteredHistory = convertedHistory.filter(function(entry) {
                    return new Date(entry.date).getTime() >= startTime;
                });
                
                // Recalculate Lowest for the filtered period (using converted prices for comparison)
                var lowestInYear = null;
                var lowestPriceInYear = Infinity;

                filteredHistory.forEach(function(p) {
                    if (p.amount < lowestPriceInYear) {
                        lowestPriceInYear = p.amount;
                        lowestInYear = p;
                    }
                });
                
                var displayLowest = lowestInYear ? {
                    amount: lowestPriceInYear, // Converted amount for comparison
                    currency: targetCurrency,
                    date: lowestInYear.date,
                    store: lowestInYear.store,
                    originalAmount: lowestInYear.originalAmount, // Original for display
                    originalCurrency: lowestInYear.originalCurrency
                } : null;
                
                // 1. Update Current Price and Lowest Price Info (Moved up)
                var currentAmount = 0;
                var currentOriginalAmount = 0;
                var currentOriginalCurrency = targetCurrency;
                var currentStore = "Steam";
                var currentEntry = null;

                if (steamHistory.length > 0) {
                    currentEntry = steamHistory[steamHistory.length - 1];
                    currentAmount = currentEntry.amount; // Converted for comparison
                    currentOriginalAmount = currentEntry.originalAmount; // Original for display
                    currentOriginalCurrency = currentEntry.originalCurrency;
                }
                // --- DATA FILTERING END ---

                // PART 3E: Estimate next likely sale window from historical drop patterns.
                var predictNextSale = function(history, currentPrice) {
                    if (!history || history.length < 10) return null; // Need enough data

                    // 1. Find meaningful price drops (sales)
                    // A sale is defined as a price significantly lower than the *previous* price
                    // or lower than a moving average. Simple approach: lower than previous.
                    var sales = [];
                    for (var i = 1; i < history.length; i++) {
                        var curr = history[i];
                        var prev = history[i-1];
                        // If price dropped by at least 10%
                        if (curr.amount < prev.amount * 0.9) {
                            sales.push(curr);
                        }
                    }

                    if (sales.length === 0) return null;

                    // 2. Identify potential upcoming sales based on Day of Year
                    var now = new Date();
                    var currentYear = now.getFullYear();
                    // Day of Year helper
                    var getDayOfYear = function(date) {
                        var start = new Date(date.getFullYear(), 0, 0);
                        var diff = (date - start) + ((start.getTimezoneOffset() - date.getTimezoneOffset()) * 60 * 1000);
                        return Math.floor(diff / (1000 * 60 * 60 * 24));
                    };

                    var todayDOY = getDayOfYear(now);
                    var lookaheadDays = 60; // Look for sales in the next 2 months

                    // Group sales by specific events (Calendar dates)
                    // We look for sales that happened in previous years within [today, today + 60] window
                    var candidates = [];

                    sales.forEach(function(sale) {
                        var saleDate = new Date(sale.date);
                        var saleDOY = getDayOfYear(saleDate);

                        // Handle year wrap-around logic roughly? 
                        // Simplified: just look ahead in same year cycle.
                        // If saleDOY is > todayDOY and saleDOY < todayDOY + lookaheadDays
                        // It's a candidate "recurring" sale.
                        
                        var diff = saleDOY - todayDOY;
                        // Handle wrap around for end of year (e.g. today is Dec 1, look for Jan 1 sales)
                        if (diff < 0) diff += 365;

                        if (diff > 0 && diff <= lookaheadDays) {
                            candidates.push({
                                originalDate: saleDate,
                                amount: sale.amount,
                                originalAmount: sale.originalAmount,
                                originalCurrency: sale.originalCurrency,
                                store: sale.store,
                                diff: diff,
                                doy: saleDOY
                            });
                        }
                    });

                    if (candidates.length === 0) return null;

                    // 3. Cluster candidates
                    // If we have sales from multiple *different* years around the same time, strong signal.
                    // Sort by DOY diff
                    candidates.sort(function(a, b) { return a.diff - b.diff; });

                    // Find a cluster: e.g. at least 2 sales within 7 days of each other in DOY terms
                    // But from different years!
                    var clusters = [];
                    var currentCluster = [candidates[0]];
                    
                    for (var i = 1; i < candidates.length; i++) {
                        var c = candidates[i];
                        var prev = currentCluster[currentCluster.length - 1];
                        
                        // If within 10 days
                        if (Math.abs(c.diff - prev.diff) <= 10) {
                            currentCluster.push(c);
                        } else {
                            if (currentCluster.length >= 2) clusters.push(currentCluster);
                            currentCluster = [c];
                        }
                    }
                    if (currentCluster.length >= 2) clusters.push(currentCluster);

                    // Filter clusters to ensure year diversity (e.g. 2021, 2022)
                    var bestCluster = null;
                    for (var i = 0; i < clusters.length; i++) {
                        var cluster = clusters[i];
                        var years = new Set(cluster.map(function(c) { return c.originalDate.getFullYear(); }));
                        if (years.size >= 2) {
                            bestCluster = cluster;
                            break; // Take the earliest substantial cluster
                        }
                    }

                    if (!bestCluster) return null;

                    // EXTRA CHECK: If currently on sale, don't show prediction
                    // A sale is detected if currentPrice is at least 10% lower than the max price in our history snippet
                    var recentMax = 0;
                    history.forEach(function(h) { if (h.amount > recentMax) recentMax = h.amount; });
                    if (currentPrice < recentMax * 0.95) {
                        return null; // Don't show prediction while on sale
                    }

                    // 4. Formulate prediction
                    // Avg date
                    var avgDiff = 0;
                    var minPrice = Infinity;
                    bestCluster.forEach(function(c) { 
                        avgDiff += c.diff;
                        if (c.amount < minPrice) minPrice = c.amount;
                    });
                    avgDiff = Math.floor(avgDiff / bestCluster.length);

                    var predictedDate = new Date();
                    predictedDate.setDate(predictedDate.getDate() + avgDiff);
                    
                    return {
                        date: predictedDate,
                        price: minPrice,
                        basis: bestCluster
                    };
                };

                var escapeHtml = function(value) {
                    if (value === null || value === undefined) return '';
                    return String(value)
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#39;');
                };

                var showPredictionInfoModal = function(html) {
                    var existing = document.getElementById('dd-prediction-modal-overlay');
                    if (existing) existing.remove();

                    var overlay = document.createElement('div');
                    overlay.id = 'dd-prediction-modal-overlay';
                    overlay.style.position = 'fixed';
                    overlay.style.top = '0';
                    overlay.style.left = '0';
                    overlay.style.width = '100vw';
                    overlay.style.height = '100vh';
                    overlay.style.background = 'rgba(0, 0, 0, 0.7)';
                    overlay.style.zIndex = '2147483646';
                    overlay.style.display = 'flex';
                    overlay.style.alignItems = 'center';
                    overlay.style.justifyContent = 'center';
                    overlay.style.padding = '16px';

                    var modal = document.createElement('div');
                    modal.style.background = '#1b2838';
                    modal.style.border = '1px solid rgba(255,255,255,0.15)';
                    modal.style.borderRadius = '8px';
                    modal.style.maxWidth = '440px';
                    modal.style.width = '100%';
                    modal.style.color = '#c7d5e0';
                    modal.style.padding = '16px 18px';
                    modal.style.boxShadow = '0 12px 28px rgba(0,0,0,0.45)';

                    var closeRow = document.createElement('div');
                    closeRow.style.display = 'flex';
                    closeRow.style.justifyContent = 'flex-end';

                    var closeBtn = document.createElement('button');
                    closeBtn.type = 'button';
                    closeBtn.textContent = '×';
                    closeBtn.style.background = 'transparent';
                    closeBtn.style.border = 'none';
                    closeBtn.style.color = '#c7d5e0';
                    closeBtn.style.fontSize = '20px';
                    closeBtn.style.lineHeight = '20px';
                    closeBtn.style.cursor = 'pointer';
                    closeBtn.style.padding = '0';

                    var body = document.createElement('div');
                    body.style.fontSize = '13px';
                    body.style.lineHeight = '1.45';
                    body.style.marginTop = '4px';
                    body.innerHTML = html;

                    closeRow.appendChild(closeBtn);
                    modal.appendChild(closeRow);
                    modal.appendChild(body);
                    overlay.appendChild(modal);
                    document.body.appendChild(overlay);

                    var closeModal = function() {
                        overlay.remove();
                    };

                    closeBtn.addEventListener('click', closeModal);
                    overlay.addEventListener('click', closeModal);
                    modal.addEventListener('click', function(e) {
                        e.stopPropagation();
                    });
                };

                var prediction = predictNextSale(convertedHistory, currentAmount);
                if (!showPredictions && predictionEl) {
                    predictionEl.style.display = 'none';
                } else if (prediction && predictionEl) {
                    var pDateStr = formatDate(prediction.date);
                    var helpId = 'dd-prediction-help-' + appId;
                    var basisHtml = '<div style="font-size: 12px; color: #8f98a0; margin-bottom: 2px;">${t("store.predictionBasisTitle")}</div>';
                    prediction.basis.forEach(function(entry) {
                        var dateText = formatDate(entry.originalDate);
                        var priceAmount = typeof entry.originalAmount === 'number' ? entry.originalAmount : entry.amount;
                        var priceCurrency = entry.originalCurrency || targetCurrency;
                        var storeText = entry.store || '${t("store.unknownStore")}';
                        basisHtml += '<div style="font-size: 12px; color: #c7d5e0; margin-top: 6px;">' +
                            escapeHtml(dateText) + ' - ' + escapeHtml(priceAmount.toFixed(2) + ' ' + priceCurrency) + ' - ' + escapeHtml(storeText) +
                            '</div>';
                    });

                    var text = '<div style="font-size: 10px; color: #8f98a0; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">${t("store.predictedNextSaleLabel")}</div>';
                    text += '<div style="font-size: 13px; color: #fff; font-weight: bold; margin-top: 2px; display: flex; align-items: center; justify-content: center; gap: 6px;">' +
                        pDateStr +
                        '<button id="' + helpId + '" type="button" style="background: transparent; border: 1px solid #8f98a0; color: #8f98a0; width: 16px; height: 16px; border-radius: 50%; font-size: 10px; font-weight: bold; line-height: 14px; padding: 0; cursor: pointer;">?</button>' +
                        '</div>';
                    text += '<div style="font-size: 10px; color: #8f98a0; margin-top: 2px;">${t("store.predictionSubtext")}</div>';

                    predictionEl.innerHTML = text;
                    predictionEl.style.display = 'flex';

                    var helpBtn = document.getElementById(helpId);
                    if (helpBtn) {
                        helpBtn.addEventListener('click', function() {
                            showPredictionInfoModal(basisHtml);
                        });
                    }
                } else if (predictionEl) {
                    var helpId = 'dd-prediction-help-' + appId;
                    var unavailableHelp = "${t("store.predictionUnavailableHelp")}";

                    predictionEl.innerHTML =
                        '<div style="font-size: 10px; color: #8f98a0; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">${t("store.predictedNextSaleLabel")}</div>' +
                        '<div style="font-size: 13px; color: #8f98a0; margin-top: 2px; display: flex; align-items: center; justify-content: center; gap: 6px;">' +
                            '${t("store.predictionNoDate")}' +
                            '<button id="' + helpId + '" type="button" style="background: transparent; border: 1px solid #8f98a0; color: #8f98a0; width: 16px; height: 16px; border-radius: 50%; font-size: 10px; font-weight: bold; line-height: 14px; padding: 0; cursor: pointer;">?</button>' +
                        '</div>' +
                        '<div style="font-size: 10px; color: #8f98a0; margin-top: 2px;">${t("store.predictionSubtext")}</div>';
                    predictionEl.style.display = 'flex';

                    var helpBtn = document.getElementById(helpId);
                    if (helpBtn) {
                        helpBtn.addEventListener('click', function() {
                            showPredictionInfoModal(unavailableHelp);
                        });
                    }
                }
                // --- PREDICTION LOGIC END ---

                // 1. Update Current Price and Lowest Price Info - Logic moved up


                // PART 3F: Dedicated free-game rendering mode.
                if (currentEntry && currentAmount === 0 && convertedHistory.length > 0) {
                    // Mute normal elements
                    var contentDiv = document.getElementById('Deckdeals-content-' + appId);
                    var infoDiv = document.querySelector('#dbpc-deckdeals-box-' + appId + ' .Deckdeals-info');
                    
                    if (contentDiv) contentDiv.style.display = 'none';
                    if (infoDiv) {
                         // Reset grid to block for simple message
                         infoDiv.style.display = 'block';
                         infoDiv.innerHTML = '<div style="font-size: 14px; color: #beee11; font-weight: bold; padding: 5px 0;">${t("store.freeGame")}</div>';
                    }
                    if (predictionEl) predictionEl.style.display = 'none';
                } else {
                    // Update Current Price Text (show ORIGINAL currency)
                    if (currentEl && currentEntry) {
                        currentEl.textContent = currentOriginalAmount.toFixed(2) + ' ' + currentOriginalCurrency;
                    } else if (currentEl) {
                        currentEl.innerHTML = '<span style="color: #8f98a0;">${t("store.noDataRecent")}</span>';
                    }
                    
                    if (currentStoreEl) {
                        currentStoreEl.textContent = currentEntry ? currentStore : "";
                    }
    
                    // Calculate Difference (using converted amounts for accurate comparison)
                    var diffText = '';
                    var diffColor = '#c6d4df';
                    
                    if (currentAmount > 0 && displayLowest) {
                         if (currentAmount > displayLowest.amount + 0.01) {
                                 var diff = currentAmount - displayLowest.amount;
                                 var percent = ((diff / currentAmount) * 100).toFixed(0);
                                 diffText = '-' + percent + '%';
                                 diffColor = '#beee11'; // highlight discount
                            } else if (Math.abs(currentAmount - displayLowest.amount) < 0.01) {
                                 // All year low
                                 diffText = '${t("store.allYearLow")}';
                                 diffColor = '#ff9300';
                            }
                    }

                    // Update Lowest Price Label (Line 0: Label + Diff)
                    var lowestLabelEl = document.querySelector('#dbpc-deckdeals-box-' + appId + ' .Deckdeals-info > div:nth-child(2) > div:first-child');
                    if (lowestLabelEl) {
                         var labelHtml = '${t("store.lowestPrice")}';
                         if (diffText) {
                             if (diffText === '${t("store.allYearLow")}') {
                                labelHtml += ' <span style="color: ' + diffColor + ';">(' + diffText + ')</span>';
                             } else {
                                labelHtml += ' <span style="color: ' + diffColor + '; font-weight: bold;">(' + diffText + ')</span>';
                             }
                         }
                         lowestLabelEl.innerHTML = labelHtml;
                    }

                    // Update Lowest Price (show ORIGINAL currency)
                    if (lowestEl) {
                        try {
                            if (displayLowest) {
                                lowestEl.innerHTML = displayLowest.originalAmount.toFixed(2) + ' ' + displayLowest.originalCurrency;
                            } else {
                                lowestEl.innerHTML = '<span style="color: #8f98a0;">${t("store.noDataRecent")}</span>';
                            }
                        } catch (e) {}
                    }
                    
                    // Update Lowest Date/Store (Line 2)
                    if (lowestDateEl && displayLowest) {
                        try {
                             var dateStr = formatDate(displayLowest.date);
                             lowestDateEl.innerHTML = dateStr + ' - <span style="color: #67c1f5;">' + displayLowest.store + '</span>';
                        } catch(e) {}
                    }
                }


                // PART 3G: Keep quick-links visibility and ITAD href in sync.
                var buttonContainer = actionsEl; 
                if (buttonContainer) {
                    buttonContainer.style.display = showQuickLinks ? 'flex' : 'none';
                }

                if (itadLink && data.urls) {
                    itadLink.href = data.urls.itad;
                }

                // PART 3H: Render stepped SVG graph + interactive hover dots.
                if (graphEl && overlayEl) {
                    if (filteredHistory.length > 1) {
                        graphEl.innerHTML = ''; // Clear loading
                        overlayEl.innerHTML = '';
                        
                        try {
                            var pts = filteredHistory;
                            var prices = pts.map(function(p) { return p.amount; });
                            var minPrice = Math.min.apply(null, prices);
                            var maxPrice = Math.max.apply(null, prices);
                            if (minPrice === maxPrice) maxPrice = minPrice + 1;
                            
                            var minTime = new Date(pts[0].date).getTime();
                            var maxTime = new Date().getTime(); // Now
                            var pointsStr = '';
                            
                            // Generate Stepped Path
                            var firstT = new Date(pts[0].date).getTime();
                            var firstX = (maxTime === minTime) ? 0 : ((firstT - minTime) / (maxTime - minTime)) * 100;
                            var firstRange = maxPrice - minPrice;
                            var firstVal = (pts[0].amount - minPrice) / firstRange;
                            var firstY = 50 - (firstVal * 40) - 5;
                            
                            pointsStr += firstX.toFixed(2) + ',' + firstY.toFixed(2) + ' ';

                            pts.forEach(function(pt, i) {
                                if (i === 0) return; 

                                var t = new Date(pt.date).getTime();
                                var x = ((t - minTime) / (maxTime - minTime)) * 100;
                                
                                var range = maxPrice - minPrice;
                                var val = (pt.amount - minPrice) / range;
                                var y = 50 - (val * 40) - 5;
                                
                                var prevPt = pts[i-1];
                                var prevVal = (prevPt.amount - minPrice) / range;
                                var prevY = 50 - (prevVal * 40) - 5;
                                
                                pointsStr += x.toFixed(2) + ',' + prevY.toFixed(2) + ' ';
                                pointsStr += x.toFixed(2) + ',' + y.toFixed(2) + ' ';
                            });

                            // Extend to "now"
                            var lastPt = pts[pts.length-1];
                            var range = maxPrice - minPrice;
                            var val = (lastPt.amount - minPrice) / range;
                            var lastY = 50 - (val * 40) - 5;
                            pointsStr += '100,' + lastY.toFixed(2);
        
                            var svg = '<svg viewBox="0 0 100 50" preserveAspectRatio="none" style="width: 100%; height: 100%; overflow: visible;" xmlns="http://www.w3.org/2000/svg">';
                            svg += '<polyline vector-effect="non-scaling-stroke" points="' + pointsStr + '" fill="none" stroke="#67c1f5" stroke-width="2" />';
                            svg += '</svg>';
                            
                            graphEl.innerHTML = svg;

                            // Generate Interactive HTML Dots with original prices displayed
                             pts.forEach(function(pt, i) {
                                var t = new Date(pt.date).getTime();
                                var x = ((t - minTime) / (maxTime - minTime)) * 100;
                                
                                var range = maxPrice - minPrice;
                                var val = (pt.amount - minPrice) / range;
                                var topPercent = ((50 - (val * 40) - 5) / 50) * 100;
                                
                                var dateStr = formatDate(pt.date);
                                // Show ORIGINAL currency in tooltip
                                var priceStr = pt.originalAmount.toFixed(2) + ' ' + pt.originalCurrency;
                                var storeStr = pt.store || "Steam";

                                var dot = document.createElement('div');
                                dot.style.position = 'absolute';
                                dot.style.left = x + '%';
                                dot.style.top = topPercent + '%';
                                dot.style.width = '6px';
                                dot.style.height = '6px';
                                dot.style.borderRadius = '50%';
                                dot.style.background = 'transparent';
                                dot.style.transform = 'translate(-50%, -50%)';
                                dot.style.cursor = 'pointer';
                                dot.style.pointerEvents = 'auto';
                                dot.style.transition = 'all 0.1s';
                                
                                dot.dataset.price = priceStr;
                                dot.dataset.date = dateStr;
                                dot.dataset.store = storeStr;
                                dot.className = 'dd-graph-dot';

                                overlayEl.appendChild(dot);
                            });

                        } catch(e) {}
                        
                        // PART 3I: Pointer interaction layer for graph hover/click.
                        var resetGraphState = function() {
                            var allDots = overlayEl.querySelectorAll('.dd-graph-dot');
                            allDots.forEach(function(d) {
                                d.style.backgroundColor = 'transparent';
                                d.style.width = '6px';
                                d.style.height = '6px';
                                d.style.border = 'none';
                                d.style.zIndex = '1';
                            });
                            if (hoverInfoEl) {
                                hoverInfoEl.innerHTML = '${t("store.graphHoverPrompt")}';
                                hoverInfoEl.style.color = '#8f98a0';
                                hoverInfoEl.style.opacity = '1';
                            }
                        };

                         var handleInteraction = function(e) {
                             var target = e.target;
                             if (target && target.classList.contains('dd-graph-dot')) {
                                 // Reset others first
                                 var allDots = overlayEl.querySelectorAll('.dd-graph-dot');
                                 allDots.forEach(function(d) {
                                     d.style.backgroundColor = 'transparent';
                                     d.style.width = '6px';
                                     d.style.height = '6px';
                                     d.style.border = 'none';
                                     d.style.zIndex = '1';
                                 });

                                 target.style.backgroundColor = '#fff';
                                 target.style.width = '10px';
                                 target.style.height = '10px';
                                 target.style.border = '2px solid #67c1f5';
                                 target.style.zIndex = '10'; // Bring to front
                                 
                                 var price = target.dataset.price;
                                 var date = target.dataset.date;
                                 var store = target.dataset.store;
                                 
                                 if (hoverInfoEl) {
                                     hoverInfoEl.innerHTML = '<span style="color: #beee11; font-weight: bold;">' + price + '</span> ${t("store.hoverOn")} <span style="color: #8f98a0;">' + date + ' (' + store + ')</span>';
                                     hoverInfoEl.style.color = '#fff'; // Brighten text
                                     hoverInfoEl.style.opacity = '1';
                                 }
                             } else if (e.type === 'click') {
                                 // Clicked background
                                 resetGraphState();
                             }
                        };
    
                        overlayEl.onmouseover = handleInteraction;
                        overlayEl.onclick = handleInteraction;
                        overlayEl.onmouseleave = resetGraphState;
                    } else {
                        graphEl.innerHTML = '<div style="width:100%; height: 100%; display:flex; align-items:center; justify-content:center; color:#666; font-size:12px;">${t("store.notEnoughHistory")}</div>';
                    }
                }

                } catch(err) {
                    var el = document.getElementById('dd-graph-' + "${appId}");
                    if (el) el.innerHTML = '<div style="width:100%; height: 100%; display:flex; align-items:center; justify-content:center; color:red; font-size:10px; text-align: center;">' + err + '</div>';
                }
            })();
        `;

        try {
            storeWebSocket.send(JSON.stringify({
                id: ++wsMessageId,
                method: "Runtime.evaluate",
                params: { expression: js }
            }));
        } catch {
        }
    }

    // =========================================================================
    // PART 4: `disconnectStoreDebugger()`
    // Purpose: Centralized teardown for websocket/listeners/retry timer/cache state.
    // Security: Removes handlers before close to avoid late message execution.
    // =========================================================================
    const disconnectStoreDebugger = () => {
        isStoreMounted = false; // Mark as inactive immediately

        if (storeWebSocket) {
            // Remove listeners to prevent any pending messages from firing
            storeWebSocket.onopen = null;
            storeWebSocket.onmessage = null;
            storeWebSocket.onclose = null;
            storeWebSocket.close();
            storeWebSocket = null;
        }
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
        // Force clear the cache
        CACHE.setValue(CACHE.APP_ID_KEY, "");
    };

    // =========================================================================
    // PART 5: `updateAppIdFromUrl(url)`
    // Purpose: Derive active app id from URL and trigger injection/update cycle.
    // Security:
    // - Reject non-store URLs.
    // - Extract appId with numeric regex only: /\/app\/([\d]+)\/?/
    // =========================================================================
    const updateAppIdFromUrl = async (url: string) => {
        // Guard: If we've already left the store view, do not update
        if (!isStoreMounted) {
            CACHE.setValue(CACHE.APP_ID_KEY, "");
            return;
        }

        if (!url.includes('https://store.steampowered.com')) {
            CACHE.setValue(CACHE.APP_ID_KEY, "");
            return;
        }



        const appId = url.match(/\/app\/([\d]+)\/?/)?.[1];
        CACHE.setValue(CACHE.APP_ID_KEY, appId ?? "");

        // Inject button into the store page when we have an appId and plugin is enabled
        if (appId) {
            // Check if plugin is enabled
            const enabled = await SETTINGS.load(Setting.ENABLED);
            if (!enabled) {
                return; // Plugin is disabled, don't inject
            }

            // Small delay to let the store page finish rendering
            setTimeout(async () => {
                try {
                    injectDeckDealsBox(appId);
                    const data = await priceService.getLowestPrice(appId);
                    await updateDeckDealsBox(data ?? null, appId);
                } catch {
                }
            }, 1500);
        }
    };

    // =========================================================================
    // PART 6: `connectToStoreDebugger(retries)`
    // Purpose: Discover store tab, open websocket, and subscribe to navigation events.
    // Security:
    // - Uses localhost endpoint only.
    // - Ignores sub-frame navigations (top-frame only).
    // - Re-checks `isStoreMounted` in each async callback.
    // =========================================================================
    const connectToStoreDebugger = async (retries = 3) => {
        // Stop if we navigated away during the async wait
        if (!isStoreMounted) {
            CACHE.setValue(CACHE.APP_ID_KEY, "");
            return;
        }

        try {
            // 1. Fetch the tabs
            const response = await serverApi.fetchNoCors<{ body: string }>('http://localhost:8080/json');
            if (!response.success) {
                if (retries > 0 && isStoreMounted) {
                    retryTimer = setTimeout(() => connectToStoreDebugger(retries - 1), 1000);
                    return;
                }
                CACHE.setValue(CACHE.APP_ID_KEY, "");
                return;
            }

            const tabs: Tab[] = JSON.parse(response.result.body) || [];
            const storeTab = tabs.find((tab) => tab.url.includes('https://store.steampowered.com'));

            // Early return if no store tab / websocket
            if (!storeTab || !storeTab.webSocketDebuggerUrl) {
                if (retries > 0 && isStoreMounted) {
                    retryTimer = setTimeout(() => connectToStoreDebugger(retries - 1), 1000);
                    return;
                }
                CACHE.setValue(CACHE.APP_ID_KEY, "");
                return;
            }

            // 2. Update the appId from the current URL
            updateAppIdFromUrl(storeTab.url);

            // 3. Connect to the websocket debugger to listen for navigation events
            if (storeWebSocket) {
                storeWebSocket.close();
            }
            storeWebSocket = new WebSocket(storeTab.webSocketDebuggerUrl);

            storeWebSocket.onopen = () => {
                if (!isStoreMounted) {
                    storeWebSocket?.close();
                    CACHE.setValue(CACHE.APP_ID_KEY, "");
                    return;
                }
                storeWebSocket?.send(JSON.stringify({ id: 1, method: "Page.enable" }));
            };

            storeWebSocket.onmessage = async (event) => {
                if (!isStoreMounted) {
                    CACHE.setValue(CACHE.APP_ID_KEY, "");
                    return; // Ignore messages if we aren't in the store view
                }

                try {
                    const data = JSON.parse(event.data);

                    // 1. Navigation Event
                    // Only react to top-level frame navigations, not sub-frames (ads, widgets, etc.)
                    if (data.method === "Page.frameNavigated" && data.params?.frame?.url && !data.params?.frame?.parentId) {
                        updateAppIdFromUrl(data.params.frame.url);
                    }

                } catch (e) {
                }
            };

            storeWebSocket.onclose = () => {
                if (isStoreMounted) {
                    CACHE.setValue(CACHE.APP_ID_KEY, "");
                }
            }

        } catch (e) {
            if (retries > 0 && isStoreMounted) {
                retryTimer = setTimeout(() => connectToStoreDebugger(retries - 1), 1000);
                return;
            }
            CACHE.setValue(CACHE.APP_ID_KEY, "");
            return;
        }
    };

    // =========================================================================
    // PART 7: `handleLocationChange(pathname)`
    // Purpose: Enter active mode on `/steamweb`, otherwise enforce teardown.
    // Security: Default behavior outside store path is cleanup.
    // =========================================================================
    const handleLocationChange = (pathname: string) => {
        if (pathname === '/steamweb') {
            // Set a small timeout to make sure the store tab url is updated after the navigation,
            // e.g. when going from the library to the store, a game's store page might still be loaded but then steamOS immediately navigates to the front page causing some weird timing issues.
            setTimeout(() => {
                if (!isStoreMounted) {
                    isStoreMounted = true;
                    connectToStoreDebugger();
                }
            }, 1000)

        }
        else {
            if (isStoreMounted) {
                disconnectStoreDebugger();
            }
        }
    };

    // =========================================================================
    // PART 8: Bootstrapping Router Listener
    // Purpose: Attach route observer so the injector follows UI navigation.
    // =========================================================================
    const stopHistoryListener = History.listen((info) => {
        handleLocationChange(info.pathname);
    });

    // PART 8A: Immediate sync for already-mounted routes after plugin startup/reload.
    if (History.location) {
        handleLocationChange(History.location.pathname);
    }



    // =========================================================================
    // PART 9: Public Teardown Function
    // Purpose: Unsubscribe all resources when plugin unloads.
    // =========================================================================
    return () => {

        disconnectStoreDebugger();
        stopHistoryListener();
    };
};
