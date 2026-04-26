export interface ByteRange {
  start: number;
  end: number;
}

export type ParsedRange = ByteRange | "invalid" | null;

export function parseRangeHeader(rangeHeader: string | undefined, sizeBytes: number): ParsedRange {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

  if (!match) {
    return rangeHeader.trim().startsWith("bytes=") ? "invalid" : null;
  }

  if (sizeBytes <= 0) {
    return "invalid";
  }

  const [, rawStart, rawEnd] = match;

  if (rawStart === "" && rawEnd === "") {
    return "invalid";
  }

  if (rawStart === "") {
    const suffixLength = Number(rawEnd);

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }

    return {
      start: Math.max(sizeBytes - suffixLength, 0),
      end: sizeBytes - 1
    };
  }

  const start = Number(rawStart);
  const end = rawEnd === "" ? sizeBytes - 1 : Number(rawEnd);

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= sizeBytes
  ) {
    return "invalid";
  }

  return {
    start,
    end: Math.min(end, sizeBytes - 1)
  };
}
