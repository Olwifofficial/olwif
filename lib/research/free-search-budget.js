export function freeSearchWindows(now = Date.now()) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid quota clock.");
  const month = date.toISOString().slice(0, 7), day = date.toISOString().slice(0, 10);
  return [
    {key: `free-web-day:${day}`, maximum: 30, expires: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)},
    {key: `free-web-month:${month}`, maximum: 900, expires: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)}
  ];
}
