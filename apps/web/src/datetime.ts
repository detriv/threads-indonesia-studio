const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Format an instant as the wall-clock value for a datetime-local input in WIB. */
export function jakartaInputValue(instant: string | Date | null | undefined): string {
  if (!instant) return '';
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + JAKARTA_OFFSET_MS).toISOString().slice(0, 16);
}

/** Convert a datetime-local wall-clock value explicitly interpreted as Asia/Jakarta to UTC ISO. */
export function jakartaInputToIso(value: string): string {
  if (!value) throw new Error('Pilih tanggal dan waktu WIB');
  const normalized = value.length === 16 ? `${value}:00` : value;
  const date = new Date(`${normalized}+07:00`);
  if (Number.isNaN(date.getTime())) throw new Error('Tanggal dan waktu WIB tidak valid');
  return date.toISOString();
}

/** Convert an ISO date filter into a UTC instant at start/end of the selected Jakarta day. */
export function jakartaDayBoundary(value: string, end = false): string | undefined {
  if (!value) return undefined;
  return jakartaInputToIso(`${value}T${end ? '23:59:59.999' : '00:00:00'}`);
}
