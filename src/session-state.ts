import type { BrowserContext, Page } from "playwright";

export const SESSION_SCHEMA_VERSION = 1;
export const MAX_SESSION_BYTES = 1_048_576;
export const AUTH_REQUIRED_MESSAGE =
  "D&D Beyond authentication is missing or expired. Ask the user to run ddb-mcp-auth login on the Docker host, complete authentication in the browser, and then retry this request.";

export interface StorageState {
  cookies: Array<Record<string, unknown>>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

export class AuthenticationRequiredError extends Error {
  constructor(message = AUTH_REQUIRED_MESSAGE) {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

export function isDdbHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\./, "");
  return normalized === "dndbeyond.com" || normalized.endsWith(".dndbeyond.com");
}

export function validateStorageState(input: string | Buffer): StorageState {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  if (bytes.length === 0 || bytes.length > MAX_SESSION_BYTES) {
    throw new Error(`Session state must contain between 1 and ${MAX_SESSION_BYTES} bytes.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Session state is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Session state must be a JSON object.");
  }

  const state = parsed as Record<string, unknown>;
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw new Error("Session state must contain cookies and origins arrays.");
  }
  if (state.cookies.length === 0) {
    throw new Error("Session state contains no D&D Beyond cookies.");
  }

  for (const cookie of state.cookies) {
    if (!cookie || typeof cookie !== "object" || Array.isArray(cookie)) {
      throw new Error("Session state contains an invalid cookie.");
    }
    const value = cookie as Record<string, unknown>;
    if (
      typeof value.name !== "string" ||
      typeof value.value !== "string" ||
      typeof value.domain !== "string" ||
      typeof value.path !== "string" ||
      typeof value.expires !== "number" ||
      typeof value.httpOnly !== "boolean" ||
      typeof value.secure !== "boolean" ||
      !["Strict", "Lax", "None"].includes(String(value.sameSite))
    ) {
      throw new Error("Session state contains an invalid cookie shape.");
    }
    if (!isDdbHostname(value.domain)) {
      throw new Error("Session state contains a cookie outside dndbeyond.com.");
    }
  }
  const now = Date.now() / 1000;
  if (!(state.cookies as Array<Record<string, unknown>>).some((cookie) => cookie.expires === -1 || Number(cookie.expires) > now)) {
    throw new Error("Session state contains only expired cookies.");
  }

  for (const originEntry of state.origins) {
    if (!originEntry || typeof originEntry !== "object" || Array.isArray(originEntry)) {
      throw new Error("Session state contains an invalid origin.");
    }
    const value = originEntry as Record<string, unknown>;
    if (typeof value.origin !== "string" || !Array.isArray(value.localStorage)) {
      throw new Error("Session state contains an invalid origin shape.");
    }
    let origin: URL;
    try {
      origin = new URL(value.origin);
    } catch {
      throw new Error("Session state contains a malformed origin.");
    }
    if (origin.protocol !== "https:" || !isDdbHostname(origin.hostname)) {
      throw new Error("Session state contains an origin outside dndbeyond.com.");
    }
    for (const item of value.localStorage) {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        typeof (item as Record<string, unknown>).name !== "string" ||
        typeof (item as Record<string, unknown>).value !== "string"
      ) {
        throw new Error("Session state contains invalid local storage.");
      }
    }
  }

  return parsed as StorageState;
}

export async function isLoggedInOnCurrentPage(page: Page): Promise<boolean> {
  try {
    const currentUrl = page.url();
    if (!currentUrl.includes("dndbeyond.com") || currentUrl.includes("/login") || currentUrl.includes("/sign-in")) {
      return false;
    }
    return await page.evaluate(() => {
      const signIn = Array.from(document.querySelectorAll("a, button")).find((element) => {
        const text = (element.textContent ?? "").trim().toLowerCase();
        return text === "sign in" || text === "log in";
      });
      return !signIn;
    });
  } catch {
    return false;
  }
}

export function throwIfAuthenticationRedirect(page: Page): void {
  let current: URL;
  try {
    current = new URL(page.url());
  } catch {
    throw new AuthenticationRequiredError();
  }
  if (
    !isDdbHostname(current.hostname) ||
    current.pathname === "/login" ||
    current.pathname.startsWith("/login/") ||
    current.pathname === "/sign-in" ||
    current.pathname.startsWith("/sign-in/")
  ) {
    throw new AuthenticationRequiredError();
  }
}

export async function verifyContextAuthentication(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto("https://www.dndbeyond.com", { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForTimeout(2_000);
    if (!(await isLoggedInOnCurrentPage(page))) throw new AuthenticationRequiredError();
  } finally {
    await page.close().catch(() => undefined);
  }
}
