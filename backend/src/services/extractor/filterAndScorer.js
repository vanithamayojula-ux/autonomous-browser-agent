/**
 * Filtering & Scoring Service for Autonomous Web Search Results
 */

const JUNK_DOMAINS = [
  "wikipedia.org",
  "youtube.com",
  "music.youtube.com",
  "soundcloud.com",
  "discogs.com",
  "dictionary.com",
  "merriam-webster.com",
  "yometro.com",
  "chatgpt.com",
  "openai.com"
];

const HIGH_TRUST_DOMAINS = [
  "amazon.in",
  "amazon.com",
  "flipkart.com",
  "gsmarena.com",
  "theverge.com",
  "ndtv.com",
  "gadgets360.com",
  "91mobiles.com",
  "cnet.com",
  "techradar.com",
  "tomsguide.com",
  "digit.in",
  "mysmartprice.com"
];

function getSourceDomain(link) {
  if (!link) return "web.ref";
  try {
    const hostname = new URL(link).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch (e) {
    return "web.ref";
  }
}

function isJunkDomain(link) {
  if (!link) return true;
  try {
    const domain = getSourceDomain(link);
    return JUNK_DOMAINS.some(junk => domain.includes(junk));
  } catch (e) {
    return false;
  }
}

function calculateDomainTrustScore(domain) {
  if (HIGH_TRUST_DOMAINS.some(trusted => domain.includes(trusted))) {
    return 1.0;
  }
  if (domain.includes(".com") || domain.includes(".in") || domain.includes(".org") || domain.includes(".net")) {
    return 0.8;
  }
  return 0.2;
}

function parseNumericPrice(priceStr) {
  if (!priceStr || typeof priceStr !== "string") return null;
  const cleaned = priceStr.replace(/[^\d]/g, "");
  if (!cleaned) return null;
  const val = parseInt(cleaned, 10);
  return isNaN(val) ? null : val;
}

function scoreAndFilterResults(rawItems, userQuery) {
  if (!Array.isArray(rawItems)) return [];

  const queryTokens = userQuery.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const baseRelevanceKeywords = [
    ...queryTokens,
    "laptop", "notebook", "gaming", "macbook", "ultrabook", "zenbook",
    "asus", "dell", "lenovo", "hp", "flipkart", "amazon", "price", "spec", "phone", "mobile"
  ];

  const scored = [];

  for (const item of rawItems) {
    if (!item || !item.title || !item.link) continue;
    if (isJunkDomain(item.link)) continue;

    const domain = getSourceDomain(item.link);
    const combinedText = (item.title + " " + (item.snippet || "")).toLowerCase();

    // 1. Keyword match count
    let keywordMatchCount = 0;
    baseRelevanceKeywords.forEach(kw => {
      if (combinedText.includes(kw)) keywordMatchCount++;
    });

    // 2. Title relevance
    const titleLower = item.title.toLowerCase();
    const titleRelevance = queryTokens.some(t => titleLower.includes(t)) ||
                           titleLower.includes("laptop") ||
                           titleLower.includes("notebook") ||
                           titleLower.includes("phone");

    // 3. Domain trust score
    const domainTrustScore = calculateDomainTrustScore(domain);

    // 4. Combined score formula
    const score = parseFloat(((keywordMatchCount * 0.5) + (titleRelevance ? 2.0 : 0) + (domainTrustScore * 1.0)).toFixed(2));

    const priceNumeric = item.priceNumeric || parseNumericPrice(item.price);
    const formattedPrice = item.price || (priceNumeric ? `₹${priceNumeric.toLocaleString('en-IN')}` : null);

    scored.push({
      title: item.title.trim(),
      link: item.link,
      snippet: (item.snippet || "").trim(),
      image: item.image || `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
      price: formattedPrice,
      priceNumeric: priceNumeric,
      specs: Array.isArray(item.specs) && item.specs.length > 0 ? item.specs : [`Verified Result for ${userQuery}`],
      sourceDomain: domain,
      score: Math.max(score, 1.0)
    });
  }

  // Deduplicate by URL and Title
  const seenUrls = new Set();
  const seenTitles = new Set();
  const deduplicated = [];

  for (const item of scored) {
    const canonUrl = item.link.toLowerCase().replace(/\/$/, "");
    const normTitle = item.title.toLowerCase().replace(/[^\w]/g, "");

    if (seenUrls.has(canonUrl) || seenTitles.has(normTitle)) continue;

    seenUrls.add(canonUrl);
    seenTitles.add(normTitle);
    deduplicated.push(item);
  }

  // Sort descending by score
  deduplicated.sort((a, b) => b.score - a.score);

  return deduplicated;
}

module.exports = {
  getSourceDomain,
  isJunkDomain,
  scoreAndFilterResults,
  parseNumericPrice
};
