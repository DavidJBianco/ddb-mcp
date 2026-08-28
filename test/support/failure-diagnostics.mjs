const DDB_HOSTS = new Set([
  "dndbeyond.com",
  "www.dndbeyond.com",
  "character-service.dndbeyond.com",
]);

function asText(value) {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}\n${value.stack ?? ""}`;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function safeErrorType(value) {
  if (!(value instanceof Error)) return undefined;
  return /^[A-Za-z][A-Za-z0-9]*(?:Error)?$/.test(value.name) ? value.name : "Error";
}

function classifyEndpoint(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!DDB_HOSTS.has(url.hostname) || url.protocol !== "https:") return undefined;

    const segments = url.pathname.split("/").filter(Boolean);
    if (url.hostname === "character-service.dndbeyond.com") {
      return `${url.hostname}/${segments.slice(0, 3).join("/")}${segments.length > 3 ? "/[redacted]" : ""}`;
    }

    if (segments.length === 0) return url.hostname;
    const publicRoute = new Set(["characters", "campaigns", "search", "spells", "sources", "my-content"]);
    const first = publicRoute.has(segments[0]) ? segments[0] : "[redacted]";
    return `${url.hostname}/${first}${segments.length > 1 ? "/[redacted]" : ""}`;
  } catch {
    return undefined;
  }
}

/**
 * Convert arbitrary live-site failures into useful allowlisted metadata. The
 * original message is never included because it can contain account content.
 */
export function summarizeLiveFailure(value, { stderr = "" } = {}) {
  const raw = `${asText(value) ?? ""}\n${stderr}`;
  const fields = [];
  const type = safeErrorType(value);
  if (type) fields.push(`error type: ${type}`);

  const statuses = [...raw.matchAll(/\b(?:HTTP(?: status)?\s*[:=]?\s*)?([45]\d{2})\b/gi)].map((match) => match[1]);
  if (statuses.length > 0) fields.push(`HTTP status: ${[...new Set(statuses)].join(", ")}`);

  const categories = [];
  const categoryPatterns = [
    ["authentication or authorization", /\b(?:auth(?:entication|orization)?|unauthorized|forbidden|log(?:ged)?[ -]?out|sign[ -]?in|401|403)\b/i],
    ["timeout", /(?:timeout|timed[ _-]?out)/i],
    ["navigation or network", /(?:navigation|net::ERR_|ECONN|ENOTFOUND|network)/i],
    ["selector or DOM", /\b(?:selector|locator|element|DOM)\b/i],
    ["inaccessible content", /\b(?:not accessible|unavailable|view in store|marketplace)\b/i],
    ["stat-block layout", /(?:stat-block.*(?:layout|incomplete)|Armor Class\/AC|Hit Points\/HP)/i],
    ["browser closed", /\b(?:browser|page|context).*(?:closed|crashed|disconnected)\b/i],
    ["filesystem", /\b(?:ENOENT|EACCES|EPERM|read-only file system)\b/i],
    ["JSON or response shape", /\b(?:malformed JSON|JSON parse|(?:response|summary|wrapper) shape)\b/i],
  ];
  for (const [label, pattern] of categoryPatterns) {
    if (pattern.test(raw)) categories.push(label);
  }
  fields.push(`category: ${categories.length > 0 ? categories.join(", ") : "unclassified failure"}`);

  const endpoints = [...raw.matchAll(/https:\/\/[^\s"'<>]+/g)]
    .map((match) => classifyEndpoint(match[0]))
    .filter(Boolean);
  if (endpoints.length > 0) fields.push(`endpoint: ${[...new Set(endpoints)].join(", ")}`);

  const codes = [...raw.matchAll(/\b(net::ERR_[A-Z_]+|E(?:ACCES|CONNREFUSED|CONNRESET|HOSTUNREACH|NETUNREACH|NOENT|PERM|PIPE|TIMEDOUT))\b/g)]
    .map((match) => match[1]);
  if (codes.length > 0) fields.push(`error code: ${[...new Set(codes)].join(", ")}`);

  const stderrLines = stderr.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  if (stderrLines > 0) fields.push(`captured server stderr lines: ${stderrLines}`);
  fields.push("private response content, identifiers, and paths redacted");
  return fields.join("; ");
}

export function captureStderr(transport) {
  const chunks = [];
  transport.stderr?.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  return () => Buffer.concat(chunks).toString("utf8").trim();
}

export async function withFailureDiagnostics(operation, diagnostics, callback) {
  try {
    return await callback();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const details = diagnostics();
    throw new Error(`${message}\n${operation} diagnostics:${details ? `\n${details}` : " no subprocess stderr captured"}`);
  }
}
