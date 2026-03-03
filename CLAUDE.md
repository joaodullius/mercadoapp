# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run dev          # start dev server (localhost:5173)
npm run build        # production build → dist/
npm run preview      # preview production build locally
vercel               # deploy preview
vercel --prod        # deploy to production
```

## Architecture

Single-page React app (no router) with a Vercel serverless API proxy. The entire frontend lives in **`src/App.jsx`** — there are no separate component files.

**Data layer** — all state is persisted to `localStorage` under the key `mercadomap_v1` with the shape:
```js
{ receipts: [], products: {}, entries: [], dictionary: {} }
```
`products` is a map keyed by `productKey(name, brand)`. `dictionary` maps raw receipt strings to interpreted product objects to improve future AI parses.

**API routing** (`src/App.jsx` → `callClaude()`) — when running on `*.vercel.app`, requests go to `/api/claude` (the serverless proxy at `api/claude.js`); otherwise they call the Anthropic API directly. This means local dev requires an Anthropic API key exposed to the browser, or you need to proxy manually.

**`api/claude.js`** — Vercel serverless function that forwards POST requests to `https://api.anthropic.com/v1/messages` using the `ANTHROPIC_API_KEY` environment variable. Set this in the Vercel project settings.

**Styling** — all inline styles, no CSS files or frameworks. The color palette is defined in the `C` constant and style helpers in the `s` object, both at the top of `App.jsx`.

**AI model** — uses `claude-sonnet-4-20250514` to parse Brazilian grocery receipts (notas fiscais) from images or PDFs. The prompt is in Portuguese and expects a JSON array back.

## Key env var

| Variable | Where | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Vercel project settings | Authenticates the `/api/claude` proxy |
