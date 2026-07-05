// Maps national-team names (as returned by football-data.org, mainly for
// World Cup / continental competitions) to a flag emoji. Club team names
// (Premier League, La Liga, etc.) simply won't match and render without a
// flag, which is the correct behaviour there.
//
// Flags are derived from ISO 3166-1 alpha-2 codes using the standard
// "regional indicator symbol" trick, so we only need to maintain a
// name -> code table below, not the emoji themselves.

const NAME_TO_ISO: Record<string, string> = {
  Afghanistan: "AF", Albania: "AL", Algeria: "DZ", Andorra: "AD", Angola: "AO",
  Argentina: "AR", Armenia: "AM", Australia: "AU", Austria: "AT", Azerbaijan: "AZ",
  Bahrain: "BH", Bangladesh: "BD", Belarus: "BY", Belgium: "BE", Benin: "BJ",
  Bolivia: "BO", "Bosnia and Herzegovina": "BA", "Bosnia-Herzegovina": "BA",
  Botswana: "BW", Brazil: "BR",
  Bulgaria: "BG", "Burkina Faso": "BF", Burundi: "BI", Cambodia: "KH",
  Cameroon: "CM", Canada: "CA", "Cape Verde": "CV", "Cabo Verde": "CV",
  "Cape Verde Islands": "CV",
  "Central African Republic": "CF", Chad: "TD", Chile: "CL", China: "CN",
  "China PR": "CN", Colombia: "CO", Comoros: "KM", Congo: "CG",
  "Costa Rica": "CR", Croatia: "HR", Cuba: "CU", Curacao: "CW", Curaçao: "CW",
  Cyprus: "CY", "Czech Republic": "CZ", Czechia: "CZ", "DR Congo": "CD",
  "Congo DR": "CD", Denmark: "DK", Djibouti: "DJ", "Dominican Republic": "DO",
  Ecuador: "EC", Egypt: "EG", "El Salvador": "SV", England: "GB-ENG",
  "Equatorial Guinea": "GQ", Eritrea: "ER", Estonia: "EE", Eswatini: "SZ",
  Ethiopia: "ET", Fiji: "FJ", Finland: "FI", France: "FR", Gabon: "GA",
  Gambia: "GM", Georgia: "GE", Germany: "DE", Ghana: "GH", Greece: "GR",
  Grenada: "GD", Guatemala: "GT", Guinea: "GN", "Guinea-Bissau": "GW",
  Guyana: "GY", Haiti: "HT", Honduras: "HN", "Hong Kong": "HK", Hungary: "HU",
  Iceland: "IS", India: "IN", Indonesia: "ID", Iran: "IR", "IR Iran": "IR",
  Iraq: "IQ", Ireland: "IE", "Republic of Ireland": "IE", Israel: "IL",
  Italy: "IT", "Ivory Coast": "CI", "Côte d'Ivoire": "CI", Jamaica: "JM",
  Japan: "JP", Jordan: "JO", Kazakhstan: "KZ", Kenya: "KE", "South Korea": "KR",
  "Korea Republic": "KR", "North Korea": "KP", "Korea DPR": "KP", Kosovo: "XK",
  Kuwait: "KW", Kyrgyzstan: "KG", Laos: "LA", Latvia: "LV", Lebanon: "LB",
  Lesotho: "LS", Liberia: "LR", Libya: "LY", Liechtenstein: "LI",
  Lithuania: "LT", Luxembourg: "LU", Madagascar: "MG", Malawi: "MW",
  Malaysia: "MY", Maldives: "MV", Mali: "ML", Malta: "MT", Mauritania: "MR",
  Mauritius: "MU", Mexico: "MX", Moldova: "MD", Monaco: "MC", Mongolia: "MN",
  Montenegro: "ME", Morocco: "MA", Mozambique: "MZ", Myanmar: "MM",
  Namibia: "NA", Nepal: "NP", Netherlands: "NL", "New Zealand": "NZ",
  Nicaragua: "NI", Niger: "NE", Nigeria: "NG", "North Macedonia": "MK",
  "Northern Ireland": "GB-NIR", Norway: "NO", Oman: "OM", Pakistan: "PK",
  Panama: "PA", "Papua New Guinea": "PG", Paraguay: "PY", Peru: "PE",
  Philippines: "PH", Poland: "PL", Portugal: "PT", "Puerto Rico": "PR",
  Qatar: "QA", Romania: "RO", Russia: "RU", Rwanda: "RW",
  "Saudi Arabia": "SA", Scotland: "GB-SCT", Senegal: "SN", Serbia: "RS",
  "Sierra Leone": "SL", Singapore: "SG", Slovakia: "SK", Slovenia: "SI",
  "Solomon Islands": "SB", Somalia: "SO", "South Africa": "ZA",
  "South Sudan": "SS", Spain: "ES", "Sri Lanka": "LK", Sudan: "SD",
  Suriname: "SR", Sweden: "SE", Switzerland: "CH", Syria: "SY", Taiwan: "TW",
  "Chinese Taipei": "TW", Tajikistan: "TJ", Tanzania: "TZ", Thailand: "TH",
  Togo: "TG", "Trinidad and Tobago": "TT", Tunisia: "TN", Turkey: "TR",
  Türkiye: "TR", Turkmenistan: "TM", Uganda: "UG", Ukraine: "UA",
  "United Arab Emirates": "AE", "United States": "US", USA: "US",
  Uruguay: "UY", Uzbekistan: "UZ", Vanuatu: "VU", Venezuela: "VE",
  Vietnam: "VN", Wales: "GB-WLS", Yemen: "YE", Zambia: "ZM", Zimbabwe: "ZW",
  "Curaçao Islands": "CW", Kosova: "XK",
};

function isoToFlagEmoji(iso: string): string {
  // A few home-nation codes aren't real ISO country codes and don't have a
  // standard Unicode flag; fall back to a generic flag glyph for those.
  const specialFlags: Record<string, string> = {
    "GB-ENG": "🏴",
    "GB-SCT": "🏴",
    "GB-WLS": "🏴",
    XK: "🇽🇰",
  };
  if (specialFlags[iso]) return specialFlags[iso];
  if (iso.length !== 2) return "🏳️";
  const codePoints = [...iso.toUpperCase()].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65));
  return String.fromCodePoint(...codePoints);
}

export function flagForTeam(teamName: string): string | null {
  const iso = NAME_TO_ISO[teamName];
  if (!iso) return null;
  return isoToFlagEmoji(iso);
}
