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
  if (!/\b(?:submit|register|registration|list|listing|listed|add|feature|include|indexing service)\b/iu.test(text)) return false;
  const urls = text.match(/https?:\/\/[^\s<>"']+/giu) ?? [];
  const bareHosts = text.split(/\s+/u)
    .map((value) => value.replace(/^[([{<"'“‘]+|[)\]}>"'”’.,!?;:]+$/gu, ""))
    // Parse whole tokens, so email addresses, subdomains, and hostname
    // extensions cannot accidentally match a campaign host substring.
    .filter((value) => !value.includes("@") && /^[a-z0-9][a-z0-9.-]*(?:[/?#]|$)/iu.test(value))
    .map((value) => `https://${value}`);
  return [...urls, ...bareHosts].some((value) => {
    try {
      const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./u, "");
      return CAMPAIGN_DOMAINS.has(hostname);
    } catch {
      return false;
    }
  });
}
