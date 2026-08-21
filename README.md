# Svenska Matcher

Webbapp för att visa svenska fotbollsmatcher per datum eller intervall, med filter för herr/dam, ålderskategori och liga.

## API-status (viktigt)

Endpointen `https://www.svenskfotboll.se/api/matches-today/games/` är **inte** ett officiellt öppet API för tredjepart. SvFF har historiskt blockerat skrapning och erbjuder i stället:

- **Förenings-API** för medlemsföreningar ([portal](https://api-fogis-association.developer.azure-api.net/))
- **Kommersiell/utökad åtkomst** via avtal — kontakta [api-support@svenskfotboll.se](mailto:api-support@svenskfotboll.se)

Den här appen proxar website-endpointen med cache och begränsat intervall (max 14 dagar) för lokal/hobby-användning. Publicera inte i produktion utan tillstånd från SvFF.

## Stack

- React + Vite (frontend)
- Express (proxy `/api/matches`)
- `react-day-picker` för kalender

## Deploy (Cloudflare Pages)

Ingen separat backend behövs. API-proxyn körs som **Pages Functions** (`/functions/api/*`).

```bash
npm run deploy
```

Live:
- https://svenskamatcher.pages.dev
- Custom domain: koppla `svenskamatcher.com` under Pages → Custom domains

DNS (om Cloudflare inte skapar dem automatiskt):

| Type  | Name | Target                     | Proxy |
| ----- | ---- | -------------------------- | ----- |
| CNAME | `@`  | `svenskamatcher.pages.dev` | On    |
| CNAME | `www`| `svenskamatcher.pages.dev` | On    |

## Kom igång (lokalt)

```bash
npm install
npm run dev
```

Öppna [http://localhost:5175](http://localhost:5175). I utvecklingsläge proxas SvFF via Vite-middleware (ingen separat API-process behövs).

För produktionsliknande proxy: `npm run api` (port `8787`).

## Scripts

| Script        | Beskrivning                          |
| ------------- | ------------------------------------ |
| `npm run dev` | Frontend + API samtidigt             |
| `npm run api` | Endast proxy-server                  |
| `npm run build` | Bygg frontend                      |
| `npm start`   | Kör API (förutsätter byggd frontend om du serverar den separat) |

## Filter

- Datum eller intervall via kalender
- Herr / dam
- Ålderskategori (Senior, Ungdom, …)
- Specifika ligor/tävlingar
- Fritext (lag, arena, liganamn)
