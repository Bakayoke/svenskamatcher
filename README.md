# Svenska Matcher

Webbapp för att visa svenska fotbollsmatcher per datum eller intervall, med filter för herr/dam, ålderskategori och liga.

## API-status (viktigt)

Endpointen `https://www.svenskfotboll.se/api/matches-today/games/` är **inte** ett officiellt öppet API för tredjepart. SvFF har historiskt blockerat skrapning och erbjuder i stället:

- **Förenings-API** för medlemsföreningar ([portal](https://api-fogis-association.developer.azure-api.net/))
- **Kommersiell/utökad åtkomst** via avtal — kontakta [api-support@svenskfotboll.se](mailto:api-support@svenskfotboll.se)

Den här appen proxar website-endpointen med cache och begränsat intervall (max 14 dagar) för lokal/hobby-användning. Publicera inte i produktion utan tillstånd från SvFF.

## Stack

- React + Vite (frontend)
- Cloudflare Worker (API-proxy + static assets) — samma upplägg som övriga sidor
- `react-day-picker` för kalender

## Deploy (Cloudflare Workers)

Ingen Railway behövs. API-proxyn körs i samma Worker som frontend.

```bash
npm run deploy
```

Custom domains (`svenskamatcher.com` / `www`) sätts via `routes` i `wrangler.toml` med `custom_domain = true`.

## Kom igång (lokalt)

```bash
npm install
npm run dev
```

Öppna [http://localhost:5175](http://localhost:5175). I utvecklingsläge proxas SvFF via Vite-middleware.

## Scripts

| Script          | Beskrivning                |
| --------------- | -------------------------- |
| `npm run dev`   | Lokal frontend + API       |
| `npm run build` | Bygg frontend              |
| `npm run deploy`| Bygg + deploy till Cloudflare |

## Filter

- Datum eller intervall via kalender
- Herr / dam
- Ålderskategori (Senior, Ungdom, …)
- Specifika ligor/tävlingar
- Fritext (lag, arena, liganamn)
