# Fork and Build Your Own ZIP

This guide explains how to fork this repo and generate an installable Decky ZIP yourself.

## Requirements

- `git`
- `node` (LTS recommended)
- `pnpm`
- `zip` CLI utility

## 1. Fork and clone

1. Click **Fork** on GitHub for this repository.
2. Clone your fork locally:

```bash
git clone https://github.com/draftdev-sd/optideck-deckdeals.git
cd optideck-deckdeals
```

## 2. Install dependencies

```bash
pnpm install
```

## 3. Build and package ZIP

Run:

```bash
pnpm run archive
```

This command will:

1. Build the frontend bundle (`dist/index.js`).
2. Create a temporary `Deckdeals/` folder.
3. Copy required plugin files into that folder:
   - `dist/index.js`
   - `main.py`
   - `settings.py`
   - `plugin.json`
   - `package.json`
   - `README.md`
   - `LICENSE`
4. Create a ZIP named:
   - `optideck-deckdeals-v<version>-beta.zip`
5. Exclude common macOS metadata (`.DS_Store`, `__MACOSX/*`).
6. Remove the temporary `Deckdeals/` folder after packaging.

## 4. Install on Steam Deck

1. Copy the generated ZIP to your Steam Deck.
2. Open **Decky**.
3. Enable **Developer Mode**.
4. Go to the **Developer** tab.
5. Choose **Install Plugin from ZIP File** and select your ZIP.

## Notes

- The ZIP filename version comes from `package.json` (`version` field).
- If you changed files, rerun `pnpm run archive` to generate a fresh ZIP.
