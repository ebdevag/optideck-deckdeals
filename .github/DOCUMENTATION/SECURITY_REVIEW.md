# Security Review Notes

This document summarizes security-relevant behavior, file responsibilities, and current hardening controls.

## Sectional Commenting Status

Structured `PART` section comments are implemented in:
- `src/patches/StoreInjector.ts`
- `src/service/ProviderAuthService.ts`
- `src/service/PriceService.ts`
- `src/service/ExchangeRateService.ts`

These comments are intended to support code audit and security review by making trust boundaries and control flow explicit.

## Settings Persistence and Privacy

Scope files:
- `main.py`
- `settings.py`
- `src/utils/Settings.ts`

Stored settings keys:
- `fontSize`
- `paddingBottom`
- `country`
- `stores`
- `enabled`
- `dateFormat`
- `showQuickLinks`
- `showPredictions`
- `providers`
- `historyRange`
- `locale`

Storage path and flow:
- Frontend settings reads/writes go through Decky RPC in `src/utils/Settings.ts` via `settings_load` and `settings_save`.
- Backend persistence is handled by `SettingsManager` in `settings.py`.
- File path root is `DECKY_PLUGIN_SETTINGS_DIR` (from `main.py` environment), with `settings.json` as the file name.

Privacy guarantees:
- No Steam account credentials are stored.
- No Steam session tokens are stored.
- No Steam inventory/profile data is stored.
- Only plugin configuration values are persisted.

## Operational Logging Policy

Scope files:
- `main.py`
- `src/service/ProviderAuthService.ts`
- `src/service/ExchangeRateService.ts`

Logging behavior:
- `main.py` logs migration events and settings-save key names only (no values).
- `src/service/ProviderAuthService.ts` logs high-level auth fetch/validation outcomes only.
- `src/service/ExchangeRateService.ts` logs high-level exchange-rate fetch/validation outcomes only.

Explicit non-logging guarantees:
- API keys are not logged.
- Raw provider payloads are not logged.
- Credential response bodies are not logged.
- Exchange-rate response bodies are not logged.
- User setting values are not logged by backend save path.

## External API Breach Mitigations (Response Hardening)

The plugin applies strict response filtering so compromised or malformed provider responses are rejected by default.

### Optideck credentials API (`src/service/ProviderAuthService.ts`)
- Endpoint pinning:
  - Only `https://api.optideck.gg/deckdeals/auth` is accepted.
- Response size bound:
  - Payload must be present and `<= 4096` bytes.
- Strict schema allowlist:
  - Object must contain exactly two keys: `itad_api_key`, `exchange_rate_api_key`.
  - Extra keys are rejected.
  - Missing keys are rejected.
- Strict value validation:
  - Keys must match `[A-Za-z0-9._-]{16,256}`.
- Fail-closed behavior:
  - Invalid responses are rejected and service falls back to prior in-memory cache (if present).

### ITAD APIs (`src/service/PriceService.ts`)
- Endpoint pinning:
  - Only HTTPS host/path combinations are allowed:
    - `/games/lookup/v1`
    - `/games/history/v2`
- Request input validation:
  - `appId` must be numeric.
  - `country` must be two uppercase letters (fallback to `US` otherwise).
  - Store IDs are filtered to bounded integer values.
- Response size bound:
  - Response body must be present and `<= 2MB`.
- Strict response checks:
  - Lookup response must contain `found: true` and valid `game.id` / `game.slug`.
  - History response must parse to an array.
- Fail-closed behavior:
  - Any URL-policy or schema violation returns a safe error and no data.

### ExchangeRate API (`src/service/ExchangeRateService.ts`)
- Endpoint pinning:
  - Only HTTPS URL pattern `v6.exchangerate-api.com/v6/<key>/latest/<CURRENCY>` is accepted.
- Request input validation:
  - Currency codes must match `[A-Z]{3}`.
- Response size bound:
  - Response body must be present and `<= 2MB`.
- Strict response checks:
  - `result` must equal `"success"`.
  - `base_code` must be a valid currency code.
  - `conversion_rates` must be an object with positive finite numeric values.
  - Invalid currency keys/rates are discarded; empty normalized results are rejected.
- Fail-closed behavior:
  - Invalid responses return `null`; caller continues without conversion rather than trusting malformed data.

## Repository File Inventory and Purpose

| File | Purpose |
|---|---|
| `main.py` | Decky backend entrypoint and RPC bridge for settings load/save and migration hooks. |
| `settings.py` | JSON settings manager used by backend RPC methods. |
| `plugin.json` | Plugin manifest metadata (name, author, publish metadata, backend entry file). |
| `deck.json` | Decky packaging/config metadata used by toolchain. |
| `package.json` | JS package metadata, scripts, dependencies. |
| `pnpm-lock.yaml` | Dependency lockfile for reproducible installs. |
| `rollup.config.js` | Frontend bundle build configuration. |
| `tsconfig.json` | TypeScript compiler configuration. |
| `decky_plugin.pyi` | Python typing stubs for Decky plugin runtime APIs. |
| `README.md` | End-user documentation and usage overview. |
| `LICENSE` | Project license. |
| `gh-image.jpeg` | README screenshot asset. |
| `src/index.tsx` | Frontend plugin bootstrap; initializes services and store injector. |
| `src/patches/StoreInjector.ts` | Steam Store webview integration: route tracking, websocket debugger connection, UI inject/update/teardown. |
| `src/service/ProviderAuthService.ts` | Fetches and strictly validates provider API credentials from Optideck endpoint; in-memory caching. |
| `src/service/PriceService.ts` | ITAD lookup/history retrieval, strict response checks, normalization for UI rendering. |
| `src/service/ExchangeRateService.ts` | Exchange-rate retrieval with strict URL/payload validation and cache-first access. |
| `src/utils/Settings.ts` | Frontend settings API wrapper over backend RPC and in-memory cache. |
| `src/utils/Cache.ts` | In-memory cache and subscriber notification utility. |
| `src/utils/Stores.ts` | Static store metadata mapping used for display names/IDs. |
| `src/utils/Providers.ts` | Static provider metadata/constants used by UI and services. |
| `src/utils/CurrencyMeta.ts` | Currency metadata/constants used for display/normalization helpers. |
| `src/hooks/useSettings.tsx` | React hook for consuming and updating plugin settings in UI. |
| `src/components/DeckyMenuOption.tsx` | Decky settings/menu UI component. |
| `src/l10n/index.ts` | Locale selection and translation lookup wiring. |
| `src/l10n/en.ts` | English translation strings. |
| `src/l10n/template.ts` | Translation template for new locales. |
| `src/types.d.ts` | Project-level TypeScript ambient declarations. |
| `.github/DOCUMENTATION/SECURITY_REVIEW.md` | This security review document. |
| `.github/DOCUMENTATION/FORK_AND_BUILD_ZIP.md` | Contributor guide for fork/build/zip workflow. |
| `.github/ISSUE_TEMPLATE/bug_report.md` | GitHub issue template for bug reports. |
| `.github/ISSUE_TEMPLATE/feature_request.md` | GitHub issue template for feature requests. |
