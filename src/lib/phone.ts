const arabicDigits: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };

export function normalizeEgyptianPhone(input: string) {
  let value = input.trim().replace(/[٠-٩۰-۹]/g, (digit) => arabicDigits[digit] ?? digit).replace(/[\s()-]/g, "");
  if (value.startsWith("0020")) value = `+${value.slice(2)}`;
  if (value.startsWith("+20")) value = value.slice(3);
  else if (value.startsWith("0")) value = value.slice(1);
  if (!/^1[0125]\d{8}$/.test(value)) return null;
  return { phone: `+20${value}`, initialPassword: value };
}
