import { ServerAPI } from "decky-frontend-lib";
import { CACHE } from "../utils/Cache";
import { providerAuthService } from "./ProviderAuthService";

/*
 * ExchangeRateService provides currency conversion support with cache-first reads.
 *
 * Security model:
 * - Uses provider key from ProviderAuthService only.
 * - Calls fixed exchangerate-api HTTPS endpoint.
 * - Caches normalized rates object with timestamp-based freshness checks.
 * - Returns null on any validation/network parse failure.
 */
export interface ExchangeRates {
    base: string;
    rates: Record<string, number>;
    timestamp: number;
}

class ExchangeRateService {
    // =========================================================================
    // PART 1: Service State + Cache Policy
    // Purpose: Hold runtime dependencies and cache configuration.
    // =========================================================================
    private serverApi: ServerAPI | undefined;
    private readonly CACHE_KEY = "exchange_rates";
    private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
    private readonly API_HOST = "v6.exchangerate-api.com";
    private readonly MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB hard cap

    public init(serverApi: ServerAPI) {
        this.serverApi = serverApi;
    }

    private isValidCurrencyCode(currency: string): boolean {
        return /^[A-Z]{3}$/.test(currency);
    }

    private buildRatesUrl(apiKey: string, baseCurrency: string): string {
        const url = new URL(`https://${this.API_HOST}/v6/${apiKey}/latest/${baseCurrency}`);
        return url.toString();
    }

    private isAllowedRatesUrl(urlString: string): boolean {
        try {
            const url = new URL(urlString);
            const expectedPath = /^\/v6\/[A-Za-z0-9._-]{16,256}\/latest\/[A-Z]{3}$/;
            return url.protocol === "https:" && url.hostname === this.API_HOST && expectedPath.test(url.pathname);
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

    private parseStrictRatesPayload(payload: unknown, fallbackBase: string): ExchangeRates | null {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            return null;
        }

        const obj = payload as Record<string, unknown>;
        if (obj.result !== "success") return null;
        if (typeof obj.base_code !== "string" || !this.isValidCurrencyCode(obj.base_code)) return null;
        if (!obj.conversion_rates || typeof obj.conversion_rates !== "object" || Array.isArray(obj.conversion_rates)) return null;

        const rawRates = obj.conversion_rates as Record<string, unknown>;
        const normalizedRates: Record<string, number> = {};
        const entries = Object.entries(rawRates);
        if (entries.length === 0) return null;

        for (const [code, value] of entries) {
            if (!this.isValidCurrencyCode(code)) continue;
            if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
            normalizedRates[code] = value;
        }

        if (Object.keys(normalizedRates).length === 0) return null;

        return {
            base: obj.base_code || fallbackBase,
            rates: normalizedRates,
            timestamp: Date.now()
        };
    }

    // =========================================================================
    // PART 2: Public Rate Retrieval
    // Purpose: Cache-first entrypoint for rate consumers.
    // =========================================================================
    /**
     * Get exchange rates, using cache if available and fresh
     */
    public async getExchangeRates(baseCurrency: string = "USD"): Promise<ExchangeRates | null> {
        if (!this.serverApi) return null;
        if (!this.isValidCurrencyCode(baseCurrency)) return null;

        // Check cache first
        const cached = await this.getCachedRates(baseCurrency);
        if (cached) {
            return cached;
        }

        // Fetch fresh rates
        return await this.fetchExchangeRates(baseCurrency);
    }

    // =========================================================================
    // PART 3: Conversion Helpers
    // Purpose: Convert single or multiple amounts using fetched rates.
    // =========================================================================
    /**
     * Convert amount from one currency to another
     */
    public async convertCurrency(
        amount: number,
        fromCurrency: string,
        toCurrency: string
    ): Promise<number | null> {
        if (!this.isValidCurrencyCode(fromCurrency) || !this.isValidCurrencyCode(toCurrency)) return null;
        if (fromCurrency === toCurrency) return amount;

        const rates = await this.getExchangeRates(fromCurrency);
        if (!rates || !rates.rates[toCurrency]) {
            return null;
        }

        return amount * rates.rates[toCurrency];
    }

    /**
     * Convert multiple prices to a target currency
     */
    public async convertPrices(
        prices: Array<{ amount: number; currency: string }>,
        targetCurrency: string
    ): Promise<Array<{ amount: number; originalAmount: number; originalCurrency: string }>> {
        const converted = [];

        for (const price of prices) {
            const convertedAmount = await this.convertCurrency(
                price.amount,
                price.currency,
                targetCurrency
            );

            if (convertedAmount !== null) {
                converted.push({
                    amount: convertedAmount,
                    originalAmount: price.amount,
                    originalCurrency: price.currency
                });
            }
        }

        return converted;
    }

    // =========================================================================
    // PART 4: Cache Read Path
    // Purpose: Return rates only when object shape exists and age is acceptable.
    // =========================================================================
    private async getCachedRates(baseCurrency: string): Promise<ExchangeRates | null> {
        const cacheKey = `${this.CACHE_KEY}_${baseCurrency}`;
        const cached = await CACHE.loadValue(cacheKey);

        if (cached && typeof cached === 'object') {
            const rates = cached as ExchangeRates;
            const now = Date.now();

            // Check if cache is still fresh
            if (rates.timestamp && (now - rates.timestamp) < this.CACHE_DURATION) {
                return rates;
            }
        }

        return null;
    }

    // =========================================================================
    // PART 5: Remote Fetch + Parse + Cache Write
    // Purpose: Retrieve latest rates from provider and persist normalized shape.
    // Security:
    // - Requires initialized ServerAPI and provider key.
    // - Uses fixed HTTPS URL format.
    // - Rejects non-success payloads and malformed response shapes.
    // =========================================================================
    private async fetchExchangeRates(baseCurrency: string): Promise<ExchangeRates | null> {
        if (!this.serverApi) return null;
        if (!this.isValidCurrencyCode(baseCurrency)) return null;

        try {
            const apiKey = await providerAuthService.getExchangeRateKey();
            if (!apiKey) return null;

            const url = this.buildRatesUrl(apiKey, baseCurrency);
            if (!this.isAllowedRatesUrl(url)) {
                console.error("Exchange rate URL failed security policy.");
                return null;
            }

            // fetchNoCors might not support signal/timeout, so we'll rely on its default timeout
            const response = await this.serverApi.fetchNoCors(url, { method: "GET" });

            if (!response.success) {
                console.error("Failed to fetch exchange rates");
                return null;
            }

            const body = this.parseBodyString(response.result);
            if (!body || body.length > this.MAX_RESPONSE_BYTES) {
                console.error("Exchange rate payload missing or too large.");
                return null;
            }

            const parsed = JSON.parse(body);
            const rates = this.parseStrictRatesPayload(parsed, baseCurrency);
            if (!rates) {
                console.error("Invalid exchange rate response.");
                return null;
            }

            // Cache the rates
            const cacheKey = `${this.CACHE_KEY}_${baseCurrency}`;
            await CACHE.setValue(cacheKey, rates);

            return rates;
        } catch {
            console.error("Error fetching exchange rates.");
            return null;
        }
    }
}

export const exchangeRateService = new ExchangeRateService();
