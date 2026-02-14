import { ServerAPI } from "decky-frontend-lib";

export interface Credentials {
    itad_api_key: string;
    exchange_rate_api_key: string;
}

/*
 * ProviderAuthService fetches provider API keys from the Optideck endpoint
 * and caches them in-memory for a limited duration.
 *
 * Security model:
 * - Endpoint is pinned to a specific HTTPS host/path.
 * - Response body size is bounded.
 * - Payload must match strict schema (exact keys only).
 * - Key values must match expected character set and length.
 * - Any failure falls back to existing cached credentials.
 */
class ProviderAuthService {
    // =========================================================================
    // PART 1: Service State + Security Constants
    // Purpose: Define cache, endpoint, and strict validation limits.
    // =========================================================================
    private serverApi: ServerAPI | undefined;
    private credentials: Credentials | null = null;
    private readonly ENDPOINT = "https://api.optideck.gg/deckdeals/auth"; // This page stores the API keys needed for IATP and exchangerate-api
    private readonly CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours
    private readonly MAX_RESPONSE_BYTES = 4096;
    private readonly EXPECTED_KEYS: Array<keyof Credentials> = ["itad_api_key", "exchange_rate_api_key"];
    private readonly API_KEY_PATTERN = /^[A-Za-z0-9._-]{16,256}$/;
    private lastFetchTime: number = 0;

    // =========================================================================
    // PART 2: Public Bootstrap
    // Purpose: Inject Decky's ServerAPI dependency once at startup.
    // =========================================================================
    public init(serverApi: ServerAPI) {
        this.serverApi = serverApi;
    }

    // =========================================================================
    // PART 3: Endpoint Trust Boundary Validation
    // Purpose: Enforce HTTPS + pinned host/path before any network call.
    // =========================================================================
    private isValidEndpoint(): boolean {
        try {
            const endpoint = new URL(this.ENDPOINT);
            return endpoint.protocol === "https:" && endpoint.hostname === "api.optideck.gg" && endpoint.pathname === "/deckdeals/auth";
        } catch {
            return false;
        }
    }

    // =========================================================================
    // PART 4: Primitive Validators
    // Purpose: Validate API key format and supported response body container types.
    // =========================================================================
    private isSafeApiKey(value: unknown): value is string {
        return typeof value === "string" && this.API_KEY_PATTERN.test(value);
    }

    private parseResponseBody(result: unknown): string | null {
        if (result && typeof result === "object" && "body" in result && typeof (result as any).body === "string") {
            return (result as any).body;
        }
        if (typeof result === "string") {
            return result;
        }
        return null;
    }

    // =========================================================================
    // PART 5: Strict Payload Schema Gate
    // Purpose: Accept only exact expected object shape and key values.
    // Security: Rejects extra keys, missing keys, arrays, and invalid key strings.
    // =========================================================================
    private parseStrictCredentials(payload: unknown): Credentials | null {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            return null;
        }

        const obj = payload as Record<string, unknown>;
        const keys = Object.keys(obj);

        if (keys.length !== this.EXPECTED_KEYS.length) {
            return null;
        }

        for (const key of this.EXPECTED_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) {
                return null;
            }
        }

        const itadKey = obj.itad_api_key;
        const exchangeKey = obj.exchange_rate_api_key;

        if (!this.isSafeApiKey(itadKey) || !this.isSafeApiKey(exchangeKey)) {
            return null;
        }

        return {
            itad_api_key: itadKey,
            exchange_rate_api_key: exchangeKey
        };
    }

    // =========================================================================
    // PART 6: Fetch + Verify + Cache Credentials
    // Purpose: Retrieve remote credentials under strict policy and cache on success.
    // Security: Fails closed and returns prior cache on any validation/network error.
    // =========================================================================
    private async fetchCredentials(): Promise<Credentials | null> {
        if (!this.serverApi) return null;
        if (!this.isValidEndpoint()) {
            console.error("[Deckdeals] Invalid credentials endpoint configuration.");
            return this.credentials;
        }

        const now = Date.now();
        if (this.credentials && (now - this.lastFetchTime) < this.CACHE_DURATION) {
            return this.credentials;
        }

        try {
            console.log("[Deckdeals] Fetching remote credentials...");
            const response = await this.serverApi.fetchNoCors(this.ENDPOINT, {
                method: "GET",
                headers: {
                    "X-App-ID": "Deckdeals",
                    "User-Agent": "Deckdeals-Plugin"
                }
            });

            if (!response.success) {
                console.error("[Deckdeals] Failed to fetch credentials.");
                return this.credentials; // Return cached even if stale if fetch fails
            }

            const body = this.parseResponseBody(response.result);
            if (!body || body.length > this.MAX_RESPONSE_BYTES) {
                console.error("[Deckdeals] Credentials payload missing or too large.");
                return this.credentials;
            }

            const parsed = JSON.parse(body);
            const strictCredentials = this.parseStrictCredentials(parsed);

            if (!strictCredentials) {
                console.error("[Deckdeals] Credentials payload failed strict validation.");
                return this.credentials;
            }

            this.credentials = Object.freeze({ ...strictCredentials });
            this.lastFetchTime = now;
            return this.credentials;
        } catch {
            console.error("[Deckdeals] Error fetching credentials.");
        }

        return this.credentials;
    }

    // =========================================================================
    // PART 7: Public Read API
    // Purpose: Expose individual provider keys to caller services.
    // =========================================================================
    public async getItadKey(): Promise<string | null> {
        const credentials = await this.fetchCredentials();
        return credentials?.itad_api_key || null;
    }

    public async getExchangeRateKey(): Promise<string | null> {
        const credentials = await this.fetchCredentials();
        return credentials?.exchange_rate_api_key || null;
    }
}

export const providerAuthService = new ProviderAuthService();
