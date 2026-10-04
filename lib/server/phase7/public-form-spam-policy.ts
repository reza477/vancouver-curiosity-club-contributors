import type { PublicFormPayload } from "./public-form-contract";

const CAMPAIGN_DOMAINS = new Set([
  "search-vancouvercuriosityclub.com",
  "searchregister.pro",
  "searchindex.pro",
  "searchregister.live",
  "helpindex.pro",
]);

/** A review signal, never a deletion or an email-provider/topic/language block. */
export function isIndexRegistrationSolicitation(payload: PublicFormPayload): boolean {
  const text = Object.entries(payload)
    .filter(([key]) => !["name", "replyEmail", "topic"].includes(key))
    .flatMap(([, value]) => typeof value === "string" ? [value] : [])
    .join("\n");
  // Visitors must be able to report these campaigns or ask about their claims.
  if (/\b(?:spam|scam|phishing|suspicious|unsolicited|received|reporting)\b/iu.test(text)) return false;
  if (!/\b(?:google|bing|search index|search engine)\b/iu.test(text)) return false;
  if (!/\b(?:submit|register|registration|listing|listed|add your|indexing service)\b/iu.test(text)) return false;
  const urls = text.match(/https?:\/\/[^\s<>"']+/giu) ?? [];
  return urls.some((value) => {
    try {
      const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./u, "");
      return CAMPAIGN_DOMAINS.has(hostname);
    } catch {
      return false;
    }
  });
}
