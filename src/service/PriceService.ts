import { ServerAPI } from "decky-frontend-lib";
import { SETTINGS, Setting } from "../utils/Settings";
import { STORES } from "../utils/Stores";
import { providerAuthService } from "./ProviderAuthService";

/*
 * PriceService resolves Steam app ids to ITAD game ids, fetches price history,
 * and returns normalized data for StoreInjector rendering.
 *
 * Security model:
 * - Uses key material only from ProviderAuthService.
 * - Calls fixed ITAD endpoints over HTTPS.
 * - Handles multiple fetchNoCors result shapes defensively.
 * - Returns structured errors without throwing into UI flow.
 */
export interface PriceData {
    lowest: { amount: number; currency: string; date: string; store: string; storeId: number };
    history: { amount: number; currency: string; date: string; store?: string; storeId?: number }[];
    urls: { steamdb: string; itad: string };
}

class PriceService {
    // =========================================================================
    // PART 1: Service State + Bootstrap
    // Purpose: Hold the ServerAPI dependency and initialize it once.
    // =========================================================================
    private serverApi: ServerAPI | undefined;
    private readonly LOOKUP_HOST = "api.isthereanydeal.com";
    private readonly LOOKUP_PATH = "/games/lookup/v1";
    private readonly HISTORY_HOST = "api.isthereanydeal.com";
    private readonly HISTORY_PATH = "/games/history/v2";
    private readonly MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB hard cap

    public init(serverApi: ServerAPI) {
        this.serverApi = serverApi;
    }

    public getSteamDBUrl(appId: string): string {
        return `https://steamdb.info/app/${appId}/`;
    }

    // =========================================================================
    // PART 2: Input + URL + Payload Guards
    // Purpose: Constrain request targets and response formats before parsing.
    // =========================================================================

    private isValidAppId(appId: string): boolean {
        return /^\d{1,12}$/.test(appId);
    }

    private isValidCountry(country: string): boolean {
        return /^[A-Z]{2}$/.test(country);
    }

    private buildLookupUrl(apiKey: string, appId: string): string {
        const url = new URL(`https://${this.LOOKUP_HOST}${this.LOOKUP_PATH}`);
        url.searchParams.set("key", apiKey);
        url.searchParams.set("appid", appId);
        return url.toString();
    }

    private buildHistoryUrl(apiKey: string, gameId: string, country: string, shops: string, sinceIso: string): string {
        const url = new URL(`https://${this.HISTORY_HOST}${this.HISTORY_PATH}`);
        url.searchParams.set("key", apiKey);
        url.searchParams.set("id", gameId);
        url.searchParams.set("country", country);
        url.searchParams.set("shops", shops);
        url.searchParams.set("since", sinceIso);
        return url.toString();
    }

    private isAllowedApiUrl(urlString: string): boolean {
        try {
            const url = new URL(urlString);
            const isLookup = url.hostname === this.LOOKUP_HOST && url.pathname === this.LOOKUP_PATH;
            const isHistory = url.hostname === this.HISTORY_HOST && url.pathname === this.HISTORY_PATH;
            return url.protocol === "https:" && (isLookup || isHistory);
        } catch {
            return false;
        }
    }

    private parseBodyString(result: unknown): string | null {
        if (result && typeof result === "object" && "body" in result && typeof (result as any).body === "string") {
            return (result as any).body;
        }
        if (typeof result === "string") {
            return result;
        }
        return null;
    }

    private parseLookupResponse(result: unknown): { gameId: string; gameSlug: string } | null {
        const body = this.parseBodyString(result);
        if (!body || body.length > this.MAX_RESPONSE_BYTES) return null;

        let data: unknown;
        try {
            data = JSON.parse(body);
        } catch {
            return null;
        }

        if (!data || typeof data !== "object" || Array.isArray(data)) return null;
        const obj = data as Record<string, unknown>;
        if (obj.found !== true) return null;
        if (!obj.game || typeof obj.game !== "object" || Array.isArray(obj.game)) return null;

        const game = obj.game as Record<string, unknown>;
        const gameId = game.id;
        const gameSlug = game.slug;
        if (typeof gameId !== "string" || gameId.length === 0 || gameId.length > 128) return null;
        if (typeof gameSlug !== "string" || gameSlug.length === 0 || gameSlug.length > 128) return null;

        return { gameId, gameSlug };
    }

    private parseHistoryResponse(result: unknown): any[] | null {
        const body = this.parseBodyString(result);
        if (!body || body.length > this.MAX_RESPONSE_BYTES) return null;

        let data: unknown;
        try {
            data = JSON.parse(body);
        } catch {
            return null;
        }

        if (!Array.isArray(data)) return null;
        return data;
    }

    // =========================================================================
    // PART 3: Main Price Lookup Flow
    // Purpose: Resolve ITAD game id, fetch history, and produce normalized output.
    // Security:
    // - Requires initialized ServerAPI + valid provider key.
    // - Uses HTTPS ITAD API endpoints only.
    // - Fails closed to { data: null, error } on malformed responses.
    // =========================================================================
    public async getLowestPrice(appId: string): Promise<{ data: PriceData | null, error?: string, debug?: any }> {
        if (!this.serverApi) return { data: null, error: "ServerAPI not initialized" };
        if (!this.isValidAppId(appId)) return { data: null, error: "Invalid app id format" };

        const apiKey = await providerAuthService.getItadKey();
        if (!apiKey) return { data: null, error: "Failed to fetch ITAD API key" };

        const lookupUrl = this.buildLookupUrl(apiKey, appId);
        let historyUrl = "";

        try {
            const rawCountry = await SETTINGS.load(Setting.COUNTRY) || "US";
            const country = this.isValidCountry(rawCountry) ? rawCountry : "US";
            const providers = await SETTINGS.load(Setting.PROVIDERS) || ["itad"];
            const storesArr = await SETTINGS.load(Setting.STORES) || [61];
            const validStores = Array.isArray(storesArr) ? storesArr : [61];
            const storesWithSteam = validStores.includes(61) ? validStores : [...validStores, 61];
            const safeStoreIds = storesWithSteam
                .filter((id) => Number.isInteger(id) && id >= 0 && id <= 9999)
                .map((id) => String(id));
            const shopsParam = safeStoreIds.length > 0 ? safeStoreIds.join(",") : "61";

            if (!providers.includes("itad")) {
                // For now we only support ITAD, if not selected, we could return null or fallback
                // but user likely expects at least one provider to work if they enabled the plugin.
                // We'll proceed with ITAD for now but could handle other providers here.
            }

            // PART 3A: Lookup ITAD game metadata from Steam app id.
            // Removed <any> generic type argument to avoid "Untyped function calls..." error
            if (!this.isAllowedApiUrl(lookupUrl)) {
                return { data: null, error: "Lookup URL failed security policy", debug: { lookupUrl } };
            }
            const lookupRes = await this.serverApi.fetchNoCors(lookupUrl, { method: "GET" });

            if (!lookupRes.success) {
                return { data: null, error: "Lookup fetch failed", debug: { lookupUrl } };
            }

            const parsedLookup = this.parseLookupResponse(lookupRes.result);
            if (!parsedLookup) {
                return { data: null, error: "Invalid lookup response", debug: { lookupUrl } };
            }

            const gameId = parsedLookup.gameId;
            const gameSlug = parsedLookup.gameSlug;

            // PART 3B: Fetch historical deals for configured country/stores.
            const since = new Date();
            since.setFullYear(since.getFullYear() - 5);
            // ITAD requires full ISO 8601 format WITHOUT milliseconds (e.g. 2024-02-10T00:00:00Z)
            const sinceStr = since.toISOString().split('.')[0] + "Z";

            historyUrl = this.buildHistoryUrl(apiKey, gameId, country, shopsParam, sinceStr);

            // Removed <any> generic type argument to avoid "Untyped function calls..." error
            if (!this.isAllowedApiUrl(historyUrl)) {
                return { data: null, error: "History URL failed security policy", debug: { lookupUrl, historyUrl } };
            }
            const historyRes = await this.serverApi.fetchNoCors(historyUrl, { method: "GET" });

            if (!historyRes.success) {
                return { data: null, error: "History fetch failed", debug: { lookupUrl, historyUrl } };
            }

            const historyData = this.parseHistoryResponse(historyRes.result);

            if (!historyData) {
                return {
                    data: null,
                    error: "Invalid history response",
                    debug: { lookupUrl, historyUrl }
                };
            }
            if (historyData.length === 0) {
                return { data: null, error: "No history entries", debug: { lookupUrl, historyUrl } };
            }

            // PART 3C: Parse/normalize deal entries and compute lowest value.
            // Parse deals - history/v2 returns FLAT array:
            // [ { timestamp, shop: { id, name }, deal: { price: { amount, currency }, regular: {...}, cut } }, ... ]
            let lowestPrice = Infinity;
            let lowestEntry: any = null;
            const historyPoints: { amount: number; currency: string; date: string; store: string; storeId: number }[] = [];

            for (const entry of historyData) {
                const amount = entry.deal?.price?.amount;
                const currency = entry.deal?.price?.currency || "USD";
                const date = entry.timestamp;
                const storeId = entry.shop?.id || 0;
                const storeName = STORES.find(s => s.id === storeId)?.title || entry.shop?.name || "Unknown";

                if (typeof amount === 'number' && date) {
                    historyPoints.push({ amount, currency, date, store: storeName, storeId });

                    if (amount < lowestPrice) {
                        lowestPrice = amount;
                        lowestEntry = entry;
                    }
                }
            }

            // PART 3D: Sort points for deterministic graph rendering order.
            historyPoints.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            if (lowestPrice !== Infinity && lowestEntry) {
                const storeId = lowestEntry.shop?.id || 0;
                const store = STORES.find(s => s.id === storeId)?.title || lowestEntry.shop?.name || "Unknown";
                const slug = gameSlug || appId;
                const currency = lowestEntry.deal?.price?.currency || "USD";

                return {
                    data: {
                        lowest: {
                            amount: lowestPrice,
                            currency: currency,
                            date: lowestEntry.timestamp || new Date().toISOString(),
                            store: store,
                            storeId: storeId
                        },
                        history: historyPoints,
                        urls: {
                            steamdb: this.getSteamDBUrl(appId),
                            itad: `https://isthereanydeal.com/game/${slug}/`
                        }
                    },
                    debug: { lookupUrl, historyUrl, entries: historyData.length }
                };
            }

            return { data: null, error: "No valid deals in history", debug: { lookupUrl, historyUrl } };

        } catch (e) {
            console.error(e);
            return { data: null, error: "Exception: " + e, debug: { lookupUrl, historyUrl } };
        }
    }
}

export const priceService = new PriceService();
