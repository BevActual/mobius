/**
 * Quick answers for the launcher (docs/design/launcher.md, "Mobius's Raycast"): sums, percentages, units and time
 * zones, worked out as you type, with no model and nothing sent anywhere. Enter copies the answer.
 */
export interface QuickAnswer {
  /** The answer as shown, "1,234.5" or "9:00 PM in London". */
  value: string;
  /** What it answers, in words: "12% of 340", "5 km in miles". */
  question: string;
  /** What is copied: the bare number or time. */
  copy: string;
}

const fmt = (n: number) => {
  const rounded = Math.round(n * 1e10) / 1e10;
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 4 });
};

/** A plain sum: numbers, + - * / ^ and %, brackets. Null for anything else, or when there is nothing to work out. */
export function evaluate(text: string): number | null {
  const src = text.replace(/[×x]/g, '*').replace(/÷/g, '/').replace(/,/g, '').replace(/\s+/g, '');
  if (!/^[\d.+\-*/^%()]+$/.test(src) || !/[+\-*/^%]/.test(src.replace(/^-/, ''))) return null;
  let i = 0;
  const peek = () => src[i];
  const number = (): number => {
    const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i));
    if (!m) throw new Error('number');
    i += m[0].length;
    return Number(m[0]);
  };
  const atom = (): number => {
    if (peek() === '-') { i++; return -atom(); }
    if (peek() === '+') { i++; return atom(); }
    let v: number;
    if (peek() === '(') { i++; v = sum(); if (peek() !== ')') throw new Error(')'); i++; } else v = number();
    while (peek() === '%') { i++; v /= 100; }
    return v;
  };
  const power = (): number => { const base = atom(); if (peek() === '^') { i++; return base ** power(); } return base; };
  const product = (): number => {
    let v = power();
    while (peek() === '*' || peek() === '/') { const op = src[i++]; const r = power(); v = op === '*' ? v * r : v / r; }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === '+' || peek() === '-') { const op = src[i++]; const r = product(); v = op === '+' ? v + r : v - r; }
    return v;
  };
  try {
    const v = sum();
    return i === src.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Units by kind, each as how many of the kind's base unit it is. Temperature is worked out on its own. */
const UNITS: Record<string, { kind: string; base: number; name: string }> = {};
const add = (kind: string, base: number, name: string, ...aliases: string[]) => { for (const a of [name, ...aliases]) UNITS[a] = { kind, base, name }; };
add('length', 1, 'm', 'meter', 'meters', 'metre', 'metres');
add('length', 1000, 'km', 'kilometer', 'kilometers', 'kilometre', 'kilometres');
add('length', 0.01, 'cm', 'centimeter', 'centimeters');
add('length', 0.001, 'mm', 'millimeter', 'millimeters');
add('length', 1609.344, 'miles', 'mile', 'mi');
add('length', 0.9144, 'yards', 'yard', 'yd');
add('length', 0.3048, 'feet', 'foot', 'ft');
add('length', 0.0254, 'inches', 'inch', 'in');
add('mass', 1, 'kg', 'kilogram', 'kilograms', 'kilo', 'kilos');
add('mass', 0.001, 'g', 'gram', 'grams');
add('mass', 0.45359237, 'lb', 'lbs', 'pound', 'pounds');
add('mass', 0.028349523125, 'oz', 'ounce', 'ounces');
add('volume', 1, 'l', 'liter', 'liters', 'litre', 'litres');
add('volume', 0.001, 'ml', 'milliliter', 'milliliters');
add('volume', 3.785411784, 'gallons', 'gallon', 'gal');
add('volume', 0.2365882365, 'cups', 'cup');
add('speed', 1, 'km/h', 'kph', 'kmh');
add('speed', 1.609344, 'mph');
add('data', 1, 'MB', 'mb', 'megabyte', 'megabytes');
add('data', 1000, 'GB', 'gb', 'gigabyte', 'gigabytes');
add('data', 1e6, 'TB', 'tb', 'terabyte', 'terabytes');
const TEMPS: Record<string, 'C' | 'F' | 'K'> = { c: 'C', '°c': 'C', celsius: 'C', f: 'F', '°f': 'F', fahrenheit: 'F', k: 'K', kelvin: 'K' };

/** "5 km in miles", "70 f to c", "2.5 lb in kg". */
export function convert(text: string): QuickAnswer | null {
  const m = /^\s*(-?[\d.,]+)\s*([a-z°/]+)\s+(?:in|to|as)\s+([a-z°/]+)\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const [from, to] = [m[2]!, m[3]!];
  const tf = TEMPS[from.toLowerCase()], tt = TEMPS[to.toLowerCase()];
  if (tf && tt) {
    const c = tf === 'C' ? n : tf === 'F' ? (n - 32) * (5 / 9) : n - 273.15;
    const out = tt === 'C' ? c : tt === 'F' ? c * (9 / 5) + 32 : c + 273.15;
    const unit = tt === 'K' ? ' K' : `°${tt}`;
    return { value: `${fmt(out)}${unit}`, question: `${fmt(n)}${tf === 'K' ? ' K' : `°${tf}`} in ${tt === 'K' ? 'kelvin' : tt === 'C' ? 'Celsius' : 'Fahrenheit'}`, copy: fmt(out).replace(/,/g, '') };
  }
  const uf = UNITS[from] ?? UNITS[from.toLowerCase()], ut = UNITS[to] ?? UNITS[to.toLowerCase()];
  if (!uf || !ut || uf.kind !== ut.kind) return null;
  const out = (n * uf.base) / ut.base;
  return { value: `${fmt(out)} ${ut.name}`, question: `${fmt(n)} ${uf.name} in ${ut.name}`, copy: fmt(out).replace(/,/g, '') };
}

/** Places and zone letters people type, to IANA zones. */
const ZONES: Record<string, string> = {
  utc: 'UTC', gmt: 'UTC', pt: 'America/Los_Angeles', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', mt: 'America/Denver', ct: 'America/Chicago',
  et: 'America/New_York', est: 'America/New_York', edt: 'America/New_York', 'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles', seattle: 'America/Los_Angeles', denver: 'America/Denver', chicago: 'America/Chicago', 'new york': 'America/New_York',
  nyc: 'America/New_York', toronto: 'America/Toronto', london: 'Europe/London', uk: 'Europe/London', paris: 'Europe/Paris', berlin: 'Europe/Berlin',
  madrid: 'Europe/Madrid', amsterdam: 'Europe/Amsterdam', cet: 'Europe/Paris', dubai: 'Asia/Dubai', india: 'Asia/Kolkata', mumbai: 'Asia/Kolkata', ist: 'Asia/Kolkata',
  singapore: 'Asia/Singapore', 'hong kong': 'Asia/Hong_Kong', tokyo: 'Asia/Tokyo', jst: 'Asia/Tokyo', sydney: 'Australia/Sydney', auckland: 'Pacific/Auckland',
};

/** The wall-clock offset of `zone` at `at`, in minutes east of UTC. */
function offsetOf(zone: string, at: Date): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    .formatToParts(at).map((p) => [p.type, p.value]));
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return Math.round((wall - at.getTime()) / 60000);
}

/** "3pm PT in London", "9:30 tokyo to new york", "time in Paris". `now` and `here` (the computer's zone) are for tests. */
export function zoneTime(text: string, now = new Date(), here = Intl.DateTimeFormat().resolvedOptions().timeZone): QuickAnswer | null {
  const t = text.trim().toLowerCase();
  const show = (at: Date, zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(at);
  const named = (place: string) => place.replace(/\b\w/g, (c) => c.toUpperCase());
  const only = /^(?:time|what time is it)\s+in\s+(.+)$/.exec(t);
  if (only) {
    const zone = ZONES[only[1]!.trim()];
    if (!zone) return null;
    const value = show(now, zone);
    return { value: `${value} in ${named(only[1]!.trim())}`, question: `Time in ${named(only[1]!.trim())}`, copy: value };
  }
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*([a-z ]+?)?\s+(?:in|to)\s+([a-z ]+)$/.exec(t);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (m[3] === 'pm' && hour < 12) hour += 12;
  if (m[3] === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const fromName = m[4]?.trim();
  const from = fromName ? ZONES[fromName] : here;
  const to = ZONES[m[5]!.trim()];
  if (!from || !to) return null;
  // That wall time today in the first zone, then shown in the second.
  const guess = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));
  const at = new Date(guess.getTime() - offsetOf(from, guess) * 60000);
  const value = show(at, to);
  const said = `${show(at, from)}${fromName ? ` ${fromName.length <= 3 ? fromName.toUpperCase() : named(fromName)}` : ''}`;
  return { value: `${value} in ${named(m[5]!.trim())}`, question: `${said} in ${named(m[5]!.trim())}`, copy: value };
}

/** "12% of 340". */
function percentOf(text: string): QuickAnswer | null {
  const m = /^\s*(-?[\d.,]+)\s*%\s*of\s*(-?[\d.,]+)\s*$/i.exec(text);
  if (!m) return null;
  const v = (Number(m[1]!.replace(/,/g, '')) / 100) * Number(m[2]!.replace(/,/g, ''));
  return Number.isFinite(v) ? { value: fmt(v), question: `${m[1]}% of ${m[2]}`, copy: String(Math.round(v * 1e10) / 1e10) } : null;
}

/** The quick answer to what was typed, if it is one. */
export function quickAnswer(text: string, now?: Date, here?: string): QuickAnswer | null {
  if (text.trim().length < 3) return null;
  const pct = percentOf(text);
  if (pct) return pct;
  const sum = evaluate(text);
  if (sum !== null) return { value: fmt(sum), question: text.trim(), copy: String(Math.round(sum * 1e10) / 1e10) };
  return convert(text) ?? zoneTime(text, now, here);
}
