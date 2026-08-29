import { AuthenticationRequiredError, isDdbHostname } from "./session-state.js";
const DDB_AUTH_URL = "https://auth-service.dndbeyond.com/v1/cobalt-token";
const SERVICE_REQUEST_TIMEOUT_MS = 15_000;
export class DdbServiceRequestError extends Error {
    status;
    constructor(status) {
        const message = status === 403
            ? "D&D Beyond denied the authenticated service request (HTTP 403)."
            : `D&D Beyond service request returned HTTP ${status}.`;
        super(message);
        this.name = "DdbServiceRequestError";
        this.status = status;
    }
}
function validateServiceUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error("D&D Beyond service URL is invalid.");
    }
    if (url.protocol !== "https:" || !isDdbHostname(url.hostname) || url.username || url.password) {
        throw new Error("D&D Beyond service URL must use HTTPS on a dndbeyond.com host.");
    }
    return url.href;
}
/**
 * Performs a read-only D&D Beyond JSON request with the same short-term bearer
 * token flow used by D&D Beyond's web applications. The token is acquired and
 * consumed inside the browser page; it is never returned to Node.js callers.
 */
export async function fetchAuthenticatedDdbJson(page, serviceUrl) {
    const url = validateServiceUrl(serviceUrl);
    const result = await page.evaluate(async ({ authUrl, timeoutMs, url }) => {
        const fetchWithTimeout = async (input, init) => {
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
            try {
                return await fetch(input, { ...init, signal: controller.signal });
            }
            finally {
                window.clearTimeout(timeout);
            }
        };
        const authResponse = await fetchWithTimeout(authUrl, {
            credentials: "include",
            method: "POST",
            headers: { Accept: "application/json" },
        });
        if (!authResponse.ok)
            return { kind: "authentication-http-error", status: authResponse.status };
        let authBody;
        try {
            authBody = await authResponse.json();
        }
        catch {
            return { kind: "authentication-shape-error" };
        }
        const token = authBody && typeof authBody === "object" && !Array.isArray(authBody)
            ? authBody.token
            : null;
        if (typeof token !== "string" || token.length === 0)
            return { kind: "authentication-shape-error" };
        const response = await fetchWithTimeout(url, {
            credentials: "include",
            method: "GET",
            headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        });
        if (!response.ok)
            return { kind: "service-http-error", status: response.status };
        try {
            return { kind: "success", body: await response.json() };
        }
        catch {
            return { kind: "service-json-error" };
        }
    }, { authUrl: DDB_AUTH_URL, timeoutMs: SERVICE_REQUEST_TIMEOUT_MS, url });
    if (result.kind === "success")
        return result.body;
    if (result.kind === "authentication-shape-error" ||
        (result.kind === "authentication-http-error" && (result.status === 401 || result.status === 403)) ||
        (result.kind === "service-http-error" && result.status === 401)) {
        throw new AuthenticationRequiredError();
    }
    if (result.kind === "authentication-http-error") {
        throw new Error(`D&D Beyond authentication service returned HTTP ${result.status}.`);
    }
    if (result.kind === "service-http-error")
        throw new DdbServiceRequestError(result.status);
    throw new Error("D&D Beyond returned a non-JSON service response.");
}
//# sourceMappingURL=service-auth.js.map