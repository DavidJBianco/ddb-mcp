export interface SegmentPosition {
  segmentIndex: number;
  offset: number;
}

export interface PaginationSegment<T> {
  text: string;
  values: readonly T[];
}

export interface SegmentPage<T> {
  text: string;
  next: SegmentPosition | null;
  values: T[];
}

interface PaginationErrors {
  limit: string;
  position: string;
  outside: string;
  offset: string;
}

export function encodeOpaqueCursor(payload: object): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeOpaqueCursorObject(cursor: string, expectedMessage: string, objectMessage: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!decoded || Buffer.from(decoded, "utf8").toString("base64url") !== cursor) throw new Error("non-canonical encoding");
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error(expectedMessage);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(objectMessage);
  return parsed as Record<string, unknown>;
}

export function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function paginateSegments<T>(
  segments: readonly PaginationSegment<T>[],
  maxChars: number,
  maximumChars: number,
  start: SegmentPosition = { segmentIndex: 0, offset: 0 },
  errors: PaginationErrors
): SegmentPage<T> {
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > maximumChars) throw new Error(errors.limit);
  if (!Number.isInteger(start.segmentIndex) || !Number.isInteger(start.offset) || start.segmentIndex < 0 || start.offset < 0) {
    throw new Error(errors.position);
  }
  if (start.segmentIndex > segments.length || (start.segmentIndex === segments.length && start.offset !== 0)) {
    throw new Error(errors.outside);
  }
  if (segments.length === 0 || start.segmentIndex === segments.length) return { text: "", next: null, values: [] };

  const selected = new Set<T>();
  let remaining = maxChars;
  let segmentIndex = start.segmentIndex;
  let offset = start.offset;
  let text = "";

  while (segmentIndex < segments.length && remaining > 0) {
    const segment = segments[segmentIndex];
    const points = Array.from(segment.text);
    if (offset > points.length) throw new Error(errors.offset);
    const available = points.length - offset;
    if (available === 0) {
      segmentIndex += 1;
      offset = 0;
      continue;
    }
    if (available <= remaining) {
      text += points.slice(offset).join("");
      remaining -= available;
      segment.values.forEach((value) => selected.add(value));
      segmentIndex += 1;
      offset = 0;
      continue;
    }
    if (text === "") {
      text = points.slice(offset, offset + remaining).join("");
      segment.values.forEach((value) => selected.add(value));
      offset += remaining;
    }
    break;
  }

  return {
    text,
    next: segmentIndex >= segments.length ? null : { segmentIndex, offset },
    values: [...selected],
  };
}

export function splitTextAtNewlines(value: string): PaginationSegment<never>[] {
  if (value === "") return [];
  const segments: PaginationSegment<never>[] = [];
  let start = 0;
  while (start < value.length) {
    const newline = value.indexOf("\n", start);
    const end = newline === -1 ? value.length : newline + 1;
    segments.push({ text: value.slice(start, end), values: [] });
    start = end;
  }
  return segments;
}
