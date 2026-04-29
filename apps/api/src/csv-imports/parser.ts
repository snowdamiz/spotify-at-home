export interface CsvImportFileInput {
  fileName: string;
  contentBase64?: string;
  content?: string;
}

export interface ParsedCsvTrack {
  album: string | null;
  artist: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  isrc: string | null;
  sourceKey: string;
  sourceUrl: string | null;
  title: string;
}

export interface ParsedCsvPlaylist {
  fileName: string;
  playlistName: string;
  tracks: ParsedCsvTrack[];
  warnings: string[];
}

const titleAliases = [
  "track name",
  "track",
  "track title",
  "song",
  "song title",
  "title",
  "name"
];
const artistAliases = [
  "artist name(s)",
  "artists",
  "artist",
  "artist name",
  "artist names",
  "performer"
];
const albumAliases = ["album name", "album", "release", "release title"];
const durationAliases = [
  "track duration (ms)",
  "duration (ms)",
  "duration ms",
  "duration",
  "length"
];
const artworkAliases = [
  "album image url",
  "image url",
  "artwork url",
  "cover url",
  "album art"
];
const sourceAliases = [
  "track uri",
  "spotify uri",
  "track url",
  "spotify url",
  "external url",
  "url"
];
const isrcAliases = ["isrc"];

export class CsvImportParseError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function parseCsvImportFile(input: CsvImportFileInput): ParsedCsvPlaylist {
  const text = decodeCsvContent(input);
  const rows = parseDelimitedRows(text);

  if (rows.length === 0) {
    throw new CsvImportParseError("csv_import_empty", "CSV file is empty.");
  }

  const headers = rows[0].map(normalizeHeader);
  const columns = {
    album: findColumn(headers, albumAliases),
    artist: findColumn(headers, artistAliases),
    artworkUrl: findColumn(headers, artworkAliases),
    duration: findColumn(headers, durationAliases),
    isrc: findColumn(headers, isrcAliases),
    source: findColumn(headers, sourceAliases),
    title: findColumn(headers, titleAliases)
  };

  if (columns.title === -1) {
    throw new CsvImportParseError(
      "csv_import_title_column_missing",
      "CSV must include a track title column."
    );
  }

  const warnings: string[] = [];
  const playlistName = playlistNameFromFile(input.fileName);
  const tracks: ParsedCsvTrack[] = [];

  for (const row of rows.slice(1)) {
    const title = cell(row, columns.title);

    if (!title) {
      continue;
    }

    const artist = cell(row, columns.artist);
    const album = cell(row, columns.album);
    const sourceUrl = cell(row, columns.source);
    const isrc = cell(row, columns.isrc);
    const durationMs = parseDurationMs(cell(row, columns.duration));
    const sourceKey = sourceKeyForTrack({
      album,
      artist,
      isrc,
      sourceUrl,
      title
    });

    tracks.push({
      album,
      artist,
      artworkUrl: cell(row, columns.artworkUrl),
      durationMs,
      isrc,
      sourceKey,
      sourceUrl,
      title
    });
  }

  if (tracks.length === 0) {
    warnings.push("No tracks were found in the CSV rows.");
  }

  return {
    fileName: input.fileName,
    playlistName,
    tracks,
    warnings
  };
}

function decodeCsvContent(input: CsvImportFileInput) {
  if (typeof input.content === "string") {
    return stripBom(input.content);
  }

  if (typeof input.contentBase64 === "string" && input.contentBase64.trim()) {
    return stripBom(Buffer.from(input.contentBase64, "base64").toString("utf8"));
  }

  throw new CsvImportParseError("csv_import_content_missing", "CSV content is missing.");
}

function parseDelimitedRows(text: string) {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        current += "\"";
        index += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(current);
      current = "";
    } else if (char === "\n") {
      row.push(trimTrailingCarriageReturn(current));
      rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  if (current.length > 0 || row.length > 0) {
    row.push(trimTrailingCarriageReturn(current));
    rows.push(row);
  }

  return rows.filter((parsedRow) => parsedRow.some((value) => value.trim() !== ""));
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [
    [",", countDelimiter(firstLine, ",")],
    ["\t", countDelimiter(firstLine, "\t")],
    [";", countDelimiter(firstLine, ";")]
  ] as const;

  return counts.reduce((best, candidate) => candidate[1] > best[1] ? candidate : best)[0];
}

function countDelimiter(line: string, delimiter: string) {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }

  return count;
}

function findColumn(headers: string[], aliases: string[]) {
  for (const alias of aliases) {
    const exact = headers.indexOf(alias);

    if (exact !== -1) {
      return exact;
    }
  }

  return headers.findIndex((header) => aliases.some((alias) => header.includes(alias)));
}

function cell(row: string[], index: number) {
  if (index < 0) {
    return null;
  }

  const value = row[index]?.trim();

  return value ? value : null;
}

function sourceKeyForTrack(input: {
  album: string | null;
  artist: string | null;
  isrc: string | null;
  sourceUrl: string | null;
  title: string;
}) {
  const trackUriId = input.sourceUrl?.match(/spotify:track:([A-Za-z0-9]+)/)?.[1] ??
    input.sourceUrl?.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/)?.[1] ??
    null;

  if (trackUriId) {
    return `track:${trackUriId}`;
  }

  if (input.isrc) {
    return `isrc:${input.isrc.toLowerCase()}`;
  }

  return [
    input.title,
    input.artist ?? "",
    input.album ?? ""
  ]
    .join("|")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseDurationMs(value: string | null) {
  if (!value) {
    return null;
  }

  const numeric = Number(value);

  if (Number.isFinite(numeric)) {
    return numeric > 10_000 ? Math.round(numeric) : Math.round(numeric * 1000);
  }

  const parts = value.split(":").map((part) => Number.parseInt(part, 10));

  if (parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  if (parts.length === 2) {
    return ((parts[0] * 60) + parts[1]) * 1000;
  }

  if (parts.length === 3) {
    return ((parts[0] * 3600) + (parts[1] * 60) + parts[2]) * 1000;
  }

  return null;
}

function playlistNameFromFile(fileName: string) {
  const baseName = fileName
    .split(/[\\/]/)
    .at(-1)!
    .replace(/\.(csv|tsv|txt)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!baseName) {
    return "CSV import";
  }

  return baseName
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function stripBom(value: string) {
  return value.replace(/^\uFEFF/, "");
}

function trimTrailingCarriageReturn(value: string) {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}
