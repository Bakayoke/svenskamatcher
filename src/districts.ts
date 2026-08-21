/** Best-effort SvFF district labels for clubAssociationId. */
export const DISTRICT_NAMES: Record<number, string> = {
  1: 'SvFF',
  2: 'Blekinge',
  6: 'Gästrikland',
  7: 'Göteborg',
  8: 'Halland',
  9: 'Hälsingland',
  10: 'Jämtland/Härjedalen',
  12: 'Norrbotten',
  13: 'Örebro län',
  14: 'Skåne',
  15: 'Småland',
  16: 'Stockholm',
  18: 'Uppland',
  19: 'Värmland',
  20: 'Västerbotten',
  21: 'Västergötland',
  22: 'Västmanland',
  24: 'Östergötland',
  28: 'Bohuslän',
}

export function districtName(id: number | undefined): string {
  if (id == null) return 'Okänt distrikt'
  return DISTRICT_NAMES[id] ?? `Distrikt ${id}`
}
