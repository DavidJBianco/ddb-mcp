export function encodeOpaqueCursor(payload) {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
export function decodeOpaqueCursorObject(cursor, expectedMessage, objectMessage) {
    let parsed;
    try {
        const decoded = Buffer.from(cursor, "base64url").toString("utf8");
        if (!decoded || Buffer.from(decoded, "utf8").toString("base64url") !== cursor)
            throw new Error("non-canonical encoding");
        parsed = JSON.parse(decoded);
    }
    catch {
        throw new Error(expectedMessage);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error(objectMessage);
    return parsed;
}
export function codePointLength(value) {
    return Array.from(value).length;
}
export function paginateSegments(segments, maxChars, maximumChars, start = { segmentIndex: 0, offset: 0 }, errors) {
    if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > maximumChars)
        throw new Error(errors.limit);
    if (!Number.isInteger(start.segmentIndex) || !Number.isInteger(start.offset) || start.segmentIndex < 0 || start.offset < 0) {
        throw new Error(errors.position);
    }
    if (start.segmentIndex > segments.length || (start.segmentIndex === segments.length && start.offset !== 0)) {
        throw new Error(errors.outside);
    }
    if (segments.length === 0 || start.segmentIndex === segments.length)
        return { text: "", next: null, values: [] };
    const selected = new Set();
    let remaining = maxChars;
    let segmentIndex = start.segmentIndex;
    let offset = start.offset;
    let text = "";
    while (segmentIndex < segments.length && remaining > 0) {
        const segment = segments[segmentIndex];
        const points = Array.from(segment.text);
        if (offset > points.length)
            throw new Error(errors.offset);
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
export function splitTextAtNewlines(value) {
    if (value === "")
        return [];
    const segments = [];
    let start = 0;
    while (start < value.length) {
        const newline = value.indexOf("\n", start);
        const end = newline === -1 ? value.length : newline + 1;
        segments.push({ text: value.slice(start, end), values: [] });
        start = end;
    }
    return segments;
}
//# sourceMappingURL=pagination.js.map