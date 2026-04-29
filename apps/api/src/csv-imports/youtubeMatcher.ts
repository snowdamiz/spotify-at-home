import type {
  ExternalDiscoveryResult,
  ImportPolicyMode
} from "@broadside/shared";
import type { YouTubeDiscoveryClient } from "../external-discovery/youtube.js";
import type { CsvImportItem } from "./repositories.js";

const primarySearchLimit = 12;
const fallbackSearchLimit = 10;
const defaultSearchQueryBudget = 2;
const confidentScore = 0.78;
const strongScore = 0.86;
const ambiguityMargin = 0.06;

interface Candidate {
  query: string;
  rank: number;
  result: ExternalDiscoveryResult;
}

export interface CsvYouTubeMatch {
  discovery: ExternalDiscoveryResult;
  query: string;
  rank: number;
  score: number;
}

export class CsvYouTubeMatchError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export async function findBestCsvYouTubeMatch(input: {
  afterSearch?: (query: string) => Promise<void> | void;
  beforeSearch?: (query: string) => Promise<void> | void;
  importPolicyMode: ImportPolicyMode;
  item: CsvImportItem;
  maxSearchQueries?: number;
  shouldContinue?: () => boolean;
  youtubeProvider: YouTubeDiscoveryClient;
}): Promise<CsvYouTubeMatch> {
  if (!input.youtubeProvider.search) {
    throw new CsvYouTubeMatchError("youtube_search_unavailable", "YouTube search is unavailable.");
  }

  const candidatesBySourceId = new Map<string, Candidate>();
  const queries = csvSearchQueries(input.item).slice(
    0,
    normalizeSearchQueryBudget(input.maxSearchQueries)
  );

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    if (input.shouldContinue?.() === false) {
      throw new CsvYouTubeMatchError("csv_import_canceled", "CSV import canceled.");
    }

    const query = queries[queryIndex];
    await input.beforeSearch?.(query);

    if (input.shouldContinue?.() === false) {
      throw new CsvYouTubeMatchError("csv_import_canceled", "CSV import canceled.");
    }

    let discoveryResults;

    try {
      discoveryResults = await input.youtubeProvider.search(
        query,
        input.importPolicyMode,
        { limit: queryIndex === 0 ? primarySearchLimit : fallbackSearchLimit }
      );
    } finally {
      await input.afterSearch?.(query);
    }

    if (input.shouldContinue?.() === false) {
      throw new CsvYouTubeMatchError("csv_import_canceled", "CSV import canceled.");
    }

    discoveryResults.results.forEach((result, rank) => {
      if (isLiveYouTubeTitle(result.title)) {
        return;
      }

      const existing = candidatesBySourceId.get(result.sourceId);

      if (!existing || rank < existing.rank) {
        candidatesBySourceId.set(result.sourceId, { query, rank, result });
      }
    });

    const best = chooseBestScoredCandidate(input.item, [...candidatesBySourceId.values()]);

    if (best && best.score >= strongScore) {
      return best;
    }
  }

  const best = chooseBestScoredCandidate(input.item, [...candidatesBySourceId.values()]);

  if (!best) {
    throw new CsvYouTubeMatchError("youtube_match_not_found", "No YouTube match was found.");
  }

  if (best.score < confidentScore) {
    throw new CsvYouTubeMatchError(
      "youtube_match_low_confidence",
      `No confident YouTube match was found for "${input.item.title}".`
    );
  }

  return best;
}

function csvSearchQueries(item: CsvImportItem) {
  return uniqueStrings([
    [item.artist, item.title].filter(Boolean).join(" "),
    [item.artist, item.title, item.album].filter(Boolean).join(" "),
    item.searchQuery,
    [item.title, item.artist].filter(Boolean).join(" ")
  ].map(normalizeSearchQueryText).filter(Boolean));
}

function normalizeSearchQueryBudget(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : defaultSearchQueryBudget;
}

function normalizeSearchQueryText(query: string) {
  return query
    .replace(/\bofficial\s+audio\b/gi, " ")
    .replace(/\\/g, " ")
    .replace(/[’]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function chooseBestScoredCandidate(item: CsvImportItem, candidates: Candidate[]) {
  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(item, candidate)
    }))
    .sort((left, right) => right.score - left.score);
  const best = scored[0];

  if (!best) {
    return null;
  }

  const second = scored[1];
  const margin = best.score - (second?.score ?? 0);

  if (
    best.score >= strongScore ||
    margin >= ambiguityMargin ||
    (second?.score ?? 0) < confidentScore ||
    (second && best.score >= confidentScore && areLikelySameCsvTrack(item, best, second))
  ) {
    return {
      discovery: best.result,
      query: best.query,
      rank: best.rank,
      score: roundScore(best.score)
    };
  }

  return {
    discovery: best.result,
    query: best.query,
    rank: best.rank,
    score: roundScore(Math.min(best.score, confidentScore - 0.01))
  };
}

function scoreCandidate(item: CsvImportItem, candidate: Candidate) {
  const result = candidate.result;
  const titleScore = scoreTitle(item, result.title);
  const artistScore = scoreArtist(item, result);
  const durationScore = scoreDuration(item.durationMs, result.durationMs);
  const qualityScore = scoreSourceQuality(item, result);
  const variantPenalty = scoreVariantPenalty(item, result);
  const rankPenalty = Math.min(candidate.rank, 10) * 0.006;

  let score =
    titleScore * 0.46 +
    artistScore * 0.24 +
    durationScore * 0.22 +
    qualityScore * 0.08 -
    variantPenalty -
    rankPenalty;

  if (titleScore < 0.45 && artistScore < 0.6) {
    score = Math.min(score, 0.48);
  }

  const durationDifference = durationDifferenceSeconds(item.durationMs, result.durationMs);

  if (Number.isFinite(durationDifference) && durationDifference > 70 && titleScore < 0.92) {
    score = Math.min(score, 0.68);
  }

  return clamp(score, 0, 1);
}

function scoreTitle(item: CsvImportItem, candidateTitle: string) {
  const expectedTokens = meaningfulTokens(normalizeTitle(item.title));
  const artistTokens = meaningfulTokens(normalizeBasic(item.artist ?? ""));
  const candidateTokens = meaningfulTokens(normalizeTitle(candidateTitle))
    .filter((token) => !artistTokens.includes(token));

  if (expectedTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const recall = tokenOverlap(expectedTokens, candidateTokens) / expectedTokens.length;
  const dice = diceCoefficient(expectedTokens, candidateTokens);
  const phraseBonus = normalizedIncludes(candidateTitle, item.title) ? 0.12 : 0;

  return clamp((recall * 0.68) + (dice * 0.32) + phraseBonus, 0, 1);
}

function scoreArtist(item: CsvImportItem, result: ExternalDiscoveryResult) {
  if (!item.artist) {
    return 0.65;
  }

  const artist = normalizeBasic(item.artist);
  const artistTokens = meaningfulTokens(artist);
  const candidateText = normalizeBasic([result.title, result.creator].filter(Boolean).join(" "));

  if (!artistTokens.length) {
    return 0.65;
  }

  if (artist.length >= 4 && candidateText.includes(artist)) {
    return 1;
  }

  const overlap = tokenOverlap(artistTokens, meaningfulTokens(candidateText));
  const recall = overlap / artistTokens.length;

  if (result.creator && isLikelyOfficialArtistChannel(item, result.creator)) {
    return Math.max(0.9, recall);
  }

  return clamp(recall, 0, 1);
}

function scoreDuration(expectedMs: number | null, candidateMs: number | null) {
  const difference = durationDifferenceSeconds(expectedMs, candidateMs);

  if (!Number.isFinite(difference)) {
    return 0.62;
  }

  if (difference <= 2) return 1;
  if (difference <= 5) return 0.95;
  if (difference <= 10) return 0.86;
  if (difference <= 20) return 0.66;
  if (difference <= 35) return 0.42;
  if (difference <= 55) return 0.2;

  return 0;
}

function scoreSourceQuality(item: CsvImportItem, result: ExternalDiscoveryResult) {
  const text = normalizeBasic([result.title, result.creator].filter(Boolean).join(" "));
  let score = 0.5;

  if (/\bofficial\b/.test(text)) score += 0.16;
  if (/\bofficial audio\b|\baudio\b|\bvisualizer\b/.test(text)) score += 0.12;
  if (result.creator && isLikelyOfficialArtistChannel(item, result.creator)) score += 0.22;
  if (/\bvevo\b|\btopic\b/.test(text)) score += 0.12;
  if (/\blyric(s)?\b|\blyric video\b/.test(text)) score -= 0.05;

  return clamp(score, 0, 1);
}

function scoreVariantPenalty(item: CsvImportItem, result: ExternalDiscoveryResult) {
  const expected = normalizeBasic([item.title, item.album].filter(Boolean).join(" "));
  const candidate = normalizeBasic([result.title, result.creator].filter(Boolean).join(" "));
  const penalties = [
    { terms: ["karaoke"], value: 0.45 },
    { terms: ["cover"], value: 0.34 },
    { terms: ["reaction", "review", "tutorial", "translation", "translated", "和訳"], value: 0.34 },
    { terms: ["unreleased"], value: 0.3 },
    { terms: ["sped up", "speed up", "slowed", "reverb", "nightcore"], value: 0.28 },
    { terms: ["1 hour", "one hour", "loop", "extended mix"], value: 0.28 },
    { terms: ["live", "concert"], value: 0.2 },
    { terms: ["remix", "mashup"], value: 0.18 },
    { terms: ["instrumental", "acoustic"], value: 0.16 },
    { terms: ["clean", "sad version", "best version"], value: 0.12 },
    { terms: ["full album", "playlist", "mix"], value: 0.16 }
  ];

  return penalties.reduce((penalty, group) => {
    const candidateHasTerm = group.terms.some((term) => candidate.includes(term));
    const expectedHasTerm = group.terms.some((term) => expected.includes(term));

    return candidateHasTerm && !expectedHasTerm ? penalty + group.value : penalty;
  }, 0);
}

function isLikelyOfficialArtistChannel(item: CsvImportItem, creator: string) {
  const artistTokens = meaningfulTokens(normalizeBasic(item.artist ?? ""));
  const creatorText = normalizeBasic(creator.replace(/\s*-\s*topic$/i, ""));

  if (!artistTokens.length) {
    return false;
  }

  const creatorTokens = meaningfulTokens(creatorText);

  return tokenOverlap(artistTokens, creatorTokens) / artistTokens.length >= 0.75;
}

function normalizeTitle(value: string) {
  const withoutIgnoredQualifiers = value
    .replace(/\(([^)]*)\)/g, (_, inner: string) => isIgnoredTitleQualifier(inner) ? " " : ` ${inner} `)
    .replace(/\[([^\]]*)\]/g, (_, inner: string) => isIgnoredTitleQualifier(inner) ? " " : ` ${inner} `);

  return normalizeBasic(withoutIgnoredQualifiers)
    .replace(
      /\b(official music video|official video|music video|official audio|audio only|visualizer|lyrics?|hd|hq|4k|remaster(ed)?|explicit|clean|provided to youtube by|official|feat|ft|featuring|with)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBasic(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(value: string) {
  return value.split(" ").filter(Boolean);
}

function tokenOverlap(left: string[], right: string[]) {
  const rightSet = new Set(right);

  return new Set(left).size === 0
    ? 0
    : [...new Set(left)].filter((token) => rightSet.has(token)).length;
}

function diceCoefficient(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  if (leftSet.size + rightSet.size === 0) {
    return 0;
  }

  const overlap = [...leftSet].filter((token) => rightSet.has(token)).length;

  return (2 * overlap) / (leftSet.size + rightSet.size);
}

function normalizedIncludes(haystack: string, needle: string) {
  const normalizedHaystack = normalizeTitle(haystack);
  const normalizedNeedle = normalizeTitle(needle);

  return normalizedNeedle.length >= 4 && normalizedHaystack.includes(normalizedNeedle);
}

function isIgnoredTitleQualifier(value: string) {
  return isDescriptor(value) || isCollaboratorQualifier(value);
}

function isDescriptor(value: string) {
  return /\b(official|video|audio|lyrics?|visualizer|hd|hq|4k|remaster(ed)?|explicit|clean)\b/i.test(value);
}

function isCollaboratorQualifier(value: string) {
  return /\b(feat|ft|featuring|with)\b/i.test(value);
}

function isLiveYouTubeTitle(value: string) {
  return /\blive\b/i.test(value);
}

function areLikelySameCsvTrack(item: CsvImportItem, left: Candidate & { score: number }, right: Candidate & { score: number }) {
  const leftTitleScore = scoreTitle(item, left.result.title);
  const rightTitleScore = scoreTitle(item, right.result.title);
  const leftDurationDifference = durationDifferenceSeconds(item.durationMs, left.result.durationMs);
  const rightDurationDifference = durationDifferenceSeconds(item.durationMs, right.result.durationMs);

  return (
    leftTitleScore >= 0.72 &&
    rightTitleScore >= 0.72 &&
    Number.isFinite(leftDurationDifference) &&
    Number.isFinite(rightDurationDifference) &&
    leftDurationDifference <= 10 &&
    rightDurationDifference <= 10
  );
}

function durationDifferenceSeconds(expectedMs: number | null, candidateMs: number | null) {
  if (!expectedMs || !candidateMs) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(expectedMs - candidateMs) / 1000;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function roundScore(value: number) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
