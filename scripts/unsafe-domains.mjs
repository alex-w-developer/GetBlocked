// This optional list is separate from the tracker catalog and Decoy Mode scope.
const DISALLOWED_DOMAINS = new Set([
  "ads.google.com", "amazon.com", "business-api.tiktok.com", "cloudflare.com",
  "facebook.com", "github.com", "github.io", "google.com", "hubspot.com",
  "iceiy.com", "mailchimp.com", "microsoft.com", "pages.dev", "paypal.com",
  "platform.twitter.com", "replit.app", "sa.com", "stripe.com", "vercel.app",
  "weeblysite.com", "wuaze.com", "youtube.com", "za.com"
]);

export function validateUnsafeDomains(source) {
  if (!Array.isArray(source?.domains)) {
    throw new Error("Unsafe-domain source must contain a domains array.");
  }
  const seen = new Set();
  for (const domain of source.domains) {
    if (typeof domain !== "string" || domain.length > 253 ||
        domain !== domain.trim().toLowerCase() ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
      throw new Error(`Invalid unsafe domain: ${JSON.stringify(domain)}`);
    }
    if (DISALLOWED_DOMAINS.has(domain)) {
      throw new Error(`Refusing broad high-breakage unsafe domain: ${domain}`);
    }
    if (seen.has(domain)) {
      throw new Error(`Duplicate unsafe domain: ${domain}`);
    }
    seen.add(domain);
  }
  return [...seen].sort();
}
