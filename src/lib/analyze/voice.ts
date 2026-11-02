import type { Voice, VoiceStats } from "../types";

const STOPWORDS = new Set(
  `a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just let me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself get got make made new one two use used using way like across every within without need needs want wants more most many much well also only into onto upon via per can't don't it's we're you're isn't aren't learn see read build built help helps start started`.split(
    /\s+/,
  ),
);

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "up", "via", "with", "vs", "from", "into", "your", "is"]);

const ACTION_VERBS = /^(get|start|try|sign|book|contact|talk|buy|shop|join|download|explore|learn|see|discover|create|build|request|watch|read|view|apply|subscribe|go|open|find|deploy|chat|log|schedule|claim|join|upgrade)\b/i;

export type CaseStyle = VoiceStats["caseStyle"];

/** Classify the capitalisation of a single headline. */
export function classifyCase(text: string): CaseStyle | null {
  const words = text.replace(/[^\p{L}\p{N}\s'’-]/gu, " ").split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length < 2) return null;
  const letters = words.join("");
  if (letters.length > 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return "upper";
  const rest = words.slice(1).filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  if (rest.length === 0) return "sentence";
  const capitalised = rest.filter((w) => /^\p{Lu}/u.test(w)).length;
  const ratio = capitalised / rest.length;
  if (ratio >= 0.7 && rest.length >= 1) return "title";
  if (ratio <= 0.34) return "sentence";
  return "mixed";
}

export function dominantCase(headlines: string[]): CaseStyle {
  const counts: Record<CaseStyle, number> = { sentence: 0, title: 0, upper: 0, mixed: 0 };
  let n = 0;
  for (const h of headlines) {
    const c = classifyCase(h);
    if (!c) continue;
    counts[c]++;
    n++;
  }
  if (n === 0) return "mixed";
  const [best, count] = (Object.entries(counts) as Array<[CaseStyle, number]>).sort((a, b) => b[1] - a[1])[0];
  return count / n > 0.5 ? best : "mixed";
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

export function topKeywords(texts: string[], n = 8): string[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    for (const raw of t.toLowerCase().split(/[^\p{L}\p{N}'’-]+/u)) {
      const w = raw.replace(/^['’-]+|['’-]+$/g, "");
      if (w.length < 4 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([w]) => w);
}

export interface VoiceInput {
  title: string;
  description: string;
  h1: string[];
  headings: string[];
  ctas: string[];
  paragraphs: string[];
}

const NAVIGATIONAL = /^(home|search|menu|your library|library|browse|log ?in|sign ?in|account|profile|settings|cart|bag|help|support|more|back|close|skip to (main )?content|main navigation|navigation|footer|header)$/i;

/** True for UI chrome labels ("Home", "Your Library") that say nothing about brand voice. */
export function isNavigational(s: string): boolean {
  return NAVIGATIONAL.test(s.trim());
}

export function analyzeVoice(raw: VoiceInput): Voice {
  const keep = (list: string[]) => list.filter((x) => !isNavigational(x));
  const input: VoiceInput = { ...raw, h1: keep(raw.h1), headings: keep(raw.headings), ctas: keep(raw.ctas) };
  const headlines = [...input.h1, ...input.headings].filter(Boolean);
  const avgHeadlineWords = headlines.length
    ? Math.round((headlines.reduce((s, h) => s + wordCount(h), 0) / headlines.length) * 10) / 10
    : 0;
  const caseStyle = dominantCase(headlines);
  const body = [input.description, ...input.paragraphs].filter(Boolean);
  const sentences = [...headlines, ...body.flatMap(splitSentences)];
  const exclamations = sentences.filter((s) => s.endsWith("!")).length;
  const exclamationRate = sentences.length ? Math.round((exclamations / sentences.length) * 1000) / 1000 : 0;
  const allText = [...headlines, ...body, ...input.ctas].join(" ");
  const words = wordCount(allText);
  const youCount = (allText.match(/\byou(r|rs|rself|'re|’re|'ll|’ll|'ve|’ve)?\b/gi) ?? []).length;
  const youRate = words ? Math.round((youCount / words) * 1000) / 10 : 0; // per 100 words

  const traits: string[] = [];
  if (headlines.length) {
    if (avgHeadlineWords <= 6) traits.push("Punchy, short headlines");
    else if (avgHeadlineWords >= 11) traits.push("Descriptive, long-form headlines");
    else traits.push("Balanced headline length");
  }
  if (caseStyle === "sentence") traits.push("Sentence case");
  if (caseStyle === "title") traits.push("Title Case");
  if (caseStyle === "upper") traits.push("ALL-CAPS headings");
  if (youRate >= 1.5) traits.push("Speaks directly to “you”");
  else if (words > 80 && youRate < 0.4) traits.push("Third-person, product-led");
  if (exclamationRate >= 0.08) traits.push("Energetic (uses exclamation marks)");
  else if (sentences.length >= 5 && exclamations === 0) traits.push("Calm, confident tone");
  const actionCtas = input.ctas.filter((c) => ACTION_VERBS.test(c)).length;
  if (input.ctas.length && actionCtas / input.ctas.length >= 0.5) traits.push("Action-led CTAs");
  if (headlines.filter((h) => /\d/.test(h)).length >= 2) traits.push("Leads with numbers & proof");
  if (headlines.some((h) => h.trim().endsWith("?"))) traits.push("Asks questions");

  return {
    title: input.title,
    description: input.description,
    headline: input.h1[0] ?? headlines[0] ?? input.title,
    headings: input.headings.slice(0, 6),
    ctas: input.ctas.slice(0, 8),
    keywords: topKeywords([...headlines, ...body]),
    traits,
    stats: { avgHeadlineWords, caseStyle, exclamationRate, youRate },
  };
}
