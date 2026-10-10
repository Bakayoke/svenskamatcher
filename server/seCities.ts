/** Approximate city centers for instant geocoding (no network). */

export type CityPoint = { lat: number; lon: number; label: string }

/** lowercase name → point */
export const SE_CITIES: Record<string, CityPoint> = {
  stockholm: { lat: 59.3293, lon: 18.0686, label: 'Stockholm' },
  göteborg: { lat: 57.7089, lon: 11.9746, label: 'Göteborg' },
  gothenburg: { lat: 57.7089, lon: 11.9746, label: 'Göteborg' },
  malmö: { lat: 55.605, lon: 13.0038, label: 'Malmö' },
  uppsala: { lat: 59.8586, lon: 17.6389, label: 'Uppsala' },
  linköping: { lat: 58.4108, lon: 15.6214, label: 'Linköping' },
  'västerås': { lat: 59.6099, lon: 16.5448, label: 'Västerås' },
  örebro: { lat: 59.2753, lon: 15.2134, label: 'Örebro' },
  helsingborg: { lat: 56.0465, lon: 12.6945, label: 'Helsingborg' },
  jönköping: { lat: 57.7826, lon: 14.1618, label: 'Jönköping' },
  norrköping: { lat: 58.5877, lon: 16.1924, label: 'Norrköping' },
  lund: { lat: 55.7047, lon: 13.191, label: 'Lund' },
  umeå: { lat: 63.8258, lon: 20.263, label: 'Umeå' },
  gävle: { lat: 60.6749, lon: 17.1413, label: 'Gävle' },
  borås: { lat: 57.721, lon: 12.9401, label: 'Borås' },
  söderhamn: { lat: 61.3037, lon: 17.0592, label: 'Söderhamn' },
  eskilstuna: { lat: 59.3666, lon: 16.5077, label: 'Eskilstuna' },
  södertälje: { lat: 59.1955, lon: 17.6252, label: 'Södertälje' },
  karlstad: { lat: 59.3793, lon: 13.5036, label: 'Karlstad' },
  trollhättan: { lat: 58.2837, lon: 12.2886, label: 'Trollhättan' },
  växjö: { lat: 56.8777, lon: 14.8091, label: 'Växjö' },
  halmstad: { lat: 56.6745, lon: 12.8578, label: 'Halmstad' },
  sundsvall: { lat: 62.3908, lon: 17.3069, label: 'Sundsvall' },
  luleå: { lat: 65.5842, lon: 22.1547, label: 'Luleå' },
  trelleborg: { lat: 55.3751, lon: 13.1569, label: 'Trelleborg' },
  kristianstad: { lat: 56.0294, lon: 14.1567, label: 'Kristianstad' },
  kalmar: { lat: 56.6634, lon: 16.3567, label: 'Kalmar' },
  falun: { lat: 60.6065, lon: 15.6355, label: 'Falun' },
  skövde: { lat: 58.3912, lon: 13.845, label: 'Skövde' },
  uddevalla: { lat: 58.3478, lon: 11.9424, label: 'Uddevalla' },
  mölndal: { lat: 57.6554, lon: 12.0139, label: 'Mölndal' },
  solna: { lat: 59.3608, lon: 18.0000, label: 'Solna' },
  sollentuna: { lat: 59.428, lon: 17.951, label: 'Sollentuna' },
  huddinge: { lat: 59.237, lon: 17.9819, label: 'Huddinge' },
  nacka: { lat: 59.3105, lon: 18.1635, label: 'Nacka' },
  tyresö: { lat: 59.242, lon: 18.221, label: 'Tyresö' },
  märsta: { lat: 59.621, lon: 17.857, label: 'Märsta' },
  nyköping: { lat: 58.753, lon: 17.012, label: 'Nyköping' },
  mjölby: { lat: 58.325, lon: 15.131, label: 'Mjölby' },
  tranås: { lat: 58.037, lon: 14.978, label: 'Tranås' },
  nässjö: { lat: 57.653, lon: 14.697, label: 'Nässjö' },
  värnamo: { lat: 57.186, lon: 14.04, label: 'Värnamo' },
  ljungby: { lat: 56.833, lon: 13.941, label: 'Ljungby' },
  hässleholm: { lat: 56.159, lon: 13.766, label: 'Hässleholm' },
  landskrona: { lat: 55.8708, lon: 12.8302, label: 'Landskrona' },
  ängelholm: { lat: 56.2428, lon: 12.8622, label: 'Ängelholm' },
  höör: { lat: 55.934, lon: 13.54, label: 'Höör' },
  alvesta: { lat: 56.899, lon: 14.556, label: 'Alvesta' },
  järfälla: { lat: 59.415, lon: 17.835, label: 'Järfälla' },
  taby: { lat: 59.4439, lon: 18.0687, label: 'Täby' },
  täby: { lat: 59.4439, lon: 18.0687, label: 'Täby' },
  botkyrka: { lat: 59.2, lon: 17.82, label: 'Botkyrka' },
  handen: { lat: 59.16, lon: 18.13, label: 'Haninge' },
  haninge: { lat: 59.167, lon: 18.144, label: 'Haninge' },
  bromma: { lat: 59.34, lon: 17.94, label: 'Bromma' },
  enskede: { lat: 59.28, lon: 18.08, label: 'Enskede' },
  åkersberga: { lat: 59.479, lon: 18.3, label: 'Åkersberga' },
  norrtälje: { lat: 59.7578, lon: 18.705, label: 'Norrtälje' },
  strängnäs: { lat: 59.377, lon: 17.031, label: 'Strängnäs' },
  katrineholm: { lat: 59.0, lon: 16.207, label: 'Katrineholm' },
  motala: { lat: 58.537, lon: 15.037, label: 'Motala' },
  vimmerby: { lat: 57.665, lon: 15.858, label: 'Vimmerby' },
  västervik: { lat: 57.758, lon: 16.637, label: 'Västervik' },
  oskarshamn: { lat: 57.264, lon: 16.448, label: 'Oskarshamn' },
  karlskrona: { lat: 56.1612, lon: 15.5869, label: 'Karlskrona' },
  karlshamn: { lat: 56.1706, lon: 14.861, label: 'Karlshamn' },
  ronneby: { lat: 56.21, lon: 15.276, label: 'Ronneby' },
  ystad: { lat: 55.4297, lon: 13.82, label: 'Ystad' },
  eslöv: { lat: 55.839, lon: 13.304, label: 'Eslöv' },
  staffanstorp: { lat: 55.642, lon: 13.208, label: 'Staffanstorp' },
  lomma: { lat: 55.675, lon: 13.092, label: 'Lomma' },
  bjärred: { lat: 55.72, lon: 13.025, label: 'Bjärred' },
  höganäs: { lat: 56.2, lon: 12.558, label: 'Höganäs' },
  falkenberg: { lat: 56.9055, lon: 12.4912, label: 'Falkenberg' },
  varberg: { lat: 57.1056, lon: 12.2502, label: 'Varberg' },
  kungälv: { lat: 57.8708, lon: 11.9805, label: 'Kungälv' },
  lerum: { lat: 57.77, lon: 12.269, label: 'Lerum' },
  partille: { lat: 57.739, lon: 12.106, label: 'Partille' },
  kungsbacka: { lat: 57.487, lon: 12.076, label: 'Kungsbacka' },
  borlänge: { lat: 60.4858, lon: 15.437, label: 'Borlänge' },
  hudiksvall: { lat: 61.727, lon: 17.105, label: 'Hudiksvall' },
  örnsköldsvik: { lat: 63.2909, lon: 18.7153, label: 'Örnsköldsvik' },
  skellefteå: { lat: 64.7507, lon: 20.9528, label: 'Skellefteå' },
  piteå: { lat: 65.3172, lon: 21.4794, label: 'Piteå' },
  kiruna: { lat: 67.8557, lon: 20.2253, label: 'Kiruna' },
  östersund: { lat: 63.1792, lon: 14.6357, label: 'Östersund' },
  sundbyberg: { lat: 59.361, lon: 17.971, label: 'Sundbyberg' },
  danderyd: { lat: 59.398, lon: 18.04, label: 'Danderyd' },
  lidingö: { lat: 59.3667, lon: 18.15, label: 'Lidingö' },
  vällingby: { lat: 59.363, lon: 17.872, label: 'Vällingby' },
  farsta: { lat: 59.243, lon: 18.093, label: 'Farsta' },
  skärholmen: { lat: 59.276, lon: 17.907, label: 'Skärholmen' },
}

const CITY_KEYS = Object.keys(SE_CITIES).sort((a, b) => b.length - a.length)

/** Match a free-text venue/place to a known city center when possible. */
export function lookupSwedishPlace(query: string): CityPoint | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return null
  if (SE_CITIES[q]) return SE_CITIES[q]!

  // "Arena, Solna" / "IP Uppsala"
  const afterComma = q.split(',').pop()?.trim()
  if (afterComma && SE_CITIES[afterComma]) return SE_CITIES[afterComma]!

  for (const key of CITY_KEYS) {
    if (key.length < 3) continue
    if (q === key || q.endsWith(` ${key}`) || q.includes(` ${key} `) || q.startsWith(`${key} `)) {
      return SE_CITIES[key]!
    }
    // bare inclusion for longer names
    if (key.length >= 5 && q.includes(key)) return SE_CITIES[key]!
  }
  return null
}
