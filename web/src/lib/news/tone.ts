/**
 * Headline tone from a published word list — "rules you can read", like the
 * signals. Each matched term is returned so the UI can show *why* a headline
 * reads positive or negative. Deliberately simple: no model, no hidden weights.
 *
 * score = (pos − neg) / max(pos + neg, 1) × min(1, (pos + neg) / 2)
 *   → −1…+1, damped when only one term matched.  label: ≥ +0.2 / ≤ −0.2.
 */
type Term = { re: RegExp; label: string; w: number };

const t = (pattern: string, label: string, w = 1): Term => ({ re: new RegExp(`\\b(?:${pattern})\\b`, "i"), label, w });

export const POSITIVE: Term[] = [
  t("surg(?:e|es|ed|ing)", "surge", 1.5),
  t("soar(?:s|ed|ing)?", "soar", 1.5),
  t("zoom(?:s|ed)?", "zoom", 1.2),
  t("jump(?:s|ed)?", "jump"),
  t("rall(?:y|ies|ied)", "rally"),
  t("climb(?:s|ed)?", "climb"),
  t("ris(?:e|es|ing)|rose", "rise", 0.6),
  t("gain(?:s|ed)?", "gain", 0.8),
  t("beat(?:s)? (?:estimates|expectations|street)", "beats estimates", 1.5),
  t("upgrade[sd]?", "upgrade", 1.3),
  t("outperform(?:s|ed)?", "outperform"),
  t("record highs?|all[- ]time highs?|52[- ]week highs?|lifetime highs?|multi[- ]year highs?|[0-9]+[- ]year highs?", "new high", 1.3),
  t("(?:profit|net income|pat|revenue|sales) (?:rises|jumps|surges|grows|up|climbs)", "earnings growth", 1.5),
  t("strong|robust|healthy", "strong", 0.7),
  t("wins?|bags?|secures?", "wins order", 0.8),
  t("order(?:s)? worth|order inflow|large deal|mega deal", "orders", 1),
  t("buyback", "buyback", 1),
  t("dividend|bonus issue", "payout", 0.6),
  t("approv(?:al|es|ed)", "approval", 0.6),
  t("raises? (?:guidance|target|stake)|hikes? target|target raised", "raised target", 1.2),
  t("bullish|buy rating|accumulate", "bullish view", 1),
  t("top gainer", "top gainer", 1),
  t("expan(?:d|ds|sion)|growth", "growth", 0.5),
];

export const NEGATIVE: Term[] = [
  t("plung(?:e|es|ed)|crash(?:es|ed)?|tank(?:s|ed)?", "plunge", 1.5),
  t("slump(?:s|ed)?|tumbl(?:e|es|ed)|sink(?:s)?|sank", "slump", 1.3),
  t("fall(?:s|en|ing)?|fell", "fall", 0.8),
  t("drop(?:s|ped)?|slid(?:e|es)?|declin(?:e|es|ed)", "decline", 0.8),
  t("loss(?:es)?|net loss", "loss", 1),
  t("miss(?:es|ed)? (?:estimates|expectations|street)", "misses estimates", 1.5),
  t("downgrade[sd]?", "downgrade", 1.3),
  t("underperform(?:s|ed)?", "underperform"),
  t("52[- ]week lows?|multi[- ]year lows?|[0-9]+[- ]year lows?|all[- ]time lows?", "new low", 1.3),
  t("(?:profit|net income|pat|revenue|sales) (?:falls|drops|declines|slumps|down|shrinks)", "earnings decline", 1.5),
  t("weak(?:er|ness)?|subdued|sluggish", "weak", 0.7),
  t("probe|raid|penalty|fined?|show[- ]cause|sebi order|ban(?:ned)?", "regulatory action", 1.3),
  t("fraud|scam|default(?:s|ed)?|insolvency", "fraud or default", 1.8),
  t("resign(?:s|ed|ation)?|exits?", "management exit", 0.8),
  t("cuts? (?:target|guidance)|target cut|lowers? (?:target|guidance)", "cut target", 1.2),
  t("bearish|sell rating|reduce rating", "bearish view", 1),
  t("lawsuit|litigation|recall|layoffs?", "legal or layoffs", 1),
  t("top loser", "top loser", 1),
  t("pressure|concern(?:s)?|worries|headwinds?", "headwinds", 0.5),
];

export type Tone = { score: number; label: "positive" | "negative" | "neutral"; terms: string[] };

export function scoreTone(text: string): Tone {
  let pos = 0;
  let neg = 0;
  const terms: string[] = [];
  for (const term of POSITIVE) if (term.re.test(text)) { pos += term.w; terms.push(`+${term.label}`); }
  for (const term of NEGATIVE) if (term.re.test(text)) { neg += term.w; terms.push(`−${term.label}`); }
  const total = pos + neg;
  const raw = total ? ((pos - neg) / Math.max(total, 1)) * Math.min(1, total / 2) : 0;
  const score = Math.max(-1, Math.min(1, Math.round(raw * 1000) / 1000));
  return { score, label: score >= 0.2 ? "positive" : score <= -0.2 ? "negative" : "neutral", terms };
}
