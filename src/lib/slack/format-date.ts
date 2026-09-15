/**
 * Slack's date formatting token (`<!date^...>`) renders in each viewer's
 * own locale/timezone client-side — preferred over any server-rendered
 * date string, which would always show in the server's timezone. Includes
 * a plain-text fallback for surfaces that don't support the token.
 */
export function formatSlackDate(isoString: string): string {
  const epochSeconds = Math.floor(new Date(isoString).getTime() / 1000);
  const fallback = new Date(isoString).toISOString().slice(0, 10);
  return `<!date^${epochSeconds}^{date_short_pretty} at {time}|${fallback}>`;
}
