// Shared date helpers. The business runs on Cairo time and its working week starts on Saturday.
export const TZ = "Africa/Cairo";
const DAY = 86400000;

function offsetMs(ms: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of 00:00 Cairo time on the given calendar day (YYYY-MM-DD). */
export function cairoMidnight(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetMs(guess - 3 * 3600000);
  return new Date(guess - offsetMs(first));
}

export const todayCairo = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
export const addDays = (dateStr: string, n: number) => new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The Saturday that starts the Saturday–Friday week containing the given day. */
export function weekStart(dateStr: string) {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday … 6 = Saturday
  return addDays(dateStr, -((day + 1) % 7));
}

/** UTC instants bounding the Saturday–Friday week that contains the given day: [from, to). */
export function weekRange(dateStr: string) {
  const start = weekStart(dateStr);
  return { start, end: addDays(start, 6), from: cairoMidnight(start), to: cairoMidnight(addDays(start, 7)) };
}
