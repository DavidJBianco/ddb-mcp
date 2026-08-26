import { createHash, randomUUID } from "node:crypto";
import { getPage, isLoggedIn } from "../browser.js";
import { AuthenticationRequiredError, throwIfAuthenticationRedirect } from "../session-state.js";
import { openDomReadyPage } from "./page-readiness.js";
export const PDF_ACQUISITION_TIMEOUT_MS = 90_000;
export const PDF_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_CHUNK_BYTES = 512 * 1024;
export const PDF_CACHE_TTL_MS = 60 * 60 * 1000;
export const PDF_CACHE_MAX_ENTRIES = 2;
export const PDF_CACHE_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const DDB_ORIGIN = "https://www.dndbeyond.com";
const PDF_PATH_PREFIX = "/sheet-pdfs/";
class PdfAcquisitionTimeoutError extends Error {
    constructor() {
        super("Character PDF export timed out.");
    }
}
function safeUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error("D&D Beyond returned an invalid PDF download link.");
    }
    if (url.protocol !== "https:" ||
        url.origin !== DDB_ORIGIN ||
        url.username !== "" ||
        url.password !== "" ||
        !url.pathname.startsWith(PDF_PATH_PREFIX)) {
        throw new Error("D&D Beyond returned an unsafe PDF download link.");
    }
    return url;
}
function contentLength(headers) {
    const value = headers["content-length"];
    if (value === undefined)
        return undefined;
    if (!/^\d+$/.test(value)) {
        throw new Error("D&D Beyond returned an invalid PDF content length.");
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        throw new Error("D&D Beyond returned an invalid PDF content length.");
    }
    return parsed;
}
async function defaultFetchPdf(context, url, timeout) {
    return context.request.get(url, {
        headers: { Accept: "application/pdf" },
        timeout,
    });
}
export async function acquireCharacterPdf(context, characterId, dependencies = {}) {
    const now = dependencies.now ?? Date.now;
    const deadline = now() + PDF_ACQUISITION_TIMEOUT_MS;
    const remaining = () => {
        const value = deadline - now();
        if (value <= 0)
            throw new PdfAcquisitionTimeoutError();
        return value;
    };
    const page = await getPage(context);
    if (!(await isLoggedIn(page)))
        throw new AuthenticationRequiredError();
    try {
        await openDomReadyPage(page, `${DDB_ORIGIN}/characters/${characterId}`, remaining());
        throwIfAuthenticationRedirect(page);
    }
    catch (error) {
        if (error instanceof AuthenticationRequiredError)
            throw error;
        if (error instanceof PdfAcquisitionTimeoutError)
            throw error;
        throw new Error("Unable to open the rendered character sheet for PDF export.");
    }
    try {
        await page.getByRole("button", { name: "Manage", exact: true }).click({ timeout: remaining() });
    }
    catch (error) {
        if (error instanceof PdfAcquisitionTimeoutError)
            throw error;
        throw new Error("The rendered character sheet did not expose its Manage control.");
    }
    try {
        await page.getByText("Export to PDF", { exact: true }).click({ timeout: remaining() });
    }
    catch (error) {
        if (error instanceof PdfAcquisitionTimeoutError)
            throw error;
        throw new Error("The rendered character sheet did not expose its Export to PDF control.");
    }
    const generatedLink = page.locator('a[href*="/sheet-pdfs/"]').first();
    let href;
    try {
        await generatedLink.waitFor({ state: "attached", timeout: remaining() });
        href = await generatedLink.getAttribute("href", { timeout: remaining() });
    }
    catch (error) {
        if (error instanceof PdfAcquisitionTimeoutError)
            throw error;
        throw new Error("D&D Beyond did not generate a PDF download link before the timeout.");
    }
    if (!href)
        throw new Error("D&D Beyond generated an empty PDF download link.");
    const generatedUrl = safeUrl(new URL(href, DDB_ORIGIN).href);
    const fetchPdf = dependencies.fetchPdf ?? defaultFetchPdf;
    let response;
    try {
        response = await fetchPdf(context, generatedUrl.href, remaining());
    }
    catch (error) {
        if (error instanceof PdfAcquisitionTimeoutError)
            throw error;
        throw new Error("Unable to retrieve the generated character PDF.");
    }
    safeUrl(response.url());
    if (response.status() !== 200) {
        throw new Error(`D&D Beyond returned HTTP ${response.status()} for the generated character PDF.`);
    }
    const headers = response.headers();
    const mimeType = (headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
    if (mimeType !== "application/pdf") {
        throw new Error("D&D Beyond returned a non-PDF response for character export.");
    }
    const declaredLength = contentLength(headers);
    if (declaredLength !== undefined && declaredLength > PDF_MAX_BYTES) {
        throw new Error("The generated character PDF exceeds the 25 MiB limit.");
    }
    let bytes;
    try {
        bytes = await response.body();
    }
    catch {
        throw new Error("Unable to read the generated character PDF.");
    }
    if (bytes.length > PDF_MAX_BYTES) {
        throw new Error("The generated character PDF exceeds the 25 MiB limit.");
    }
    if (declaredLength !== undefined && declaredLength !== bytes.length) {
        throw new Error("The generated character PDF length did not match its response metadata.");
    }
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new Error("The generated character file did not have a valid PDF signature.");
    }
    const filename = `dnd-beyond-character-${characterId}.pdf`;
    return {
        bytes,
        filename,
        title: filename,
        mimeType: "application/pdf",
        totalBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
    };
}
export class CharacterPdfStore {
    entries = new Map();
    totalBytes = 0;
    now;
    createHandle;
    constructor(dependencies = {}) {
        this.now = dependencies.now ?? Date.now;
        this.createHandle = dependencies.createHandle ?? randomUUID;
    }
    put(pdf) {
        this.purgeExpired();
        while (this.entries.size >= PDF_CACHE_MAX_ENTRIES ||
            this.totalBytes + pdf.totalBytes > PDF_CACHE_MAX_TOTAL_BYTES) {
            const oldest = this.entries.keys().next().value;
            if (!oldest)
                throw new Error("The character PDF cannot fit in the in-memory cache.");
            this.delete(oldest);
        }
        const handle = this.createHandle();
        const url = `mysterium://character-pdf/${encodeURIComponent(handle)}/${pdf.filename}`;
        const stored = {
            ...pdf,
            url,
            expiresAt: this.now() + PDF_CACHE_TTL_MS,
        };
        this.entries.set(url, stored);
        this.totalBytes += pdf.totalBytes;
        return {
            url,
            filename: pdf.filename,
            title: pdf.title,
            mimeType: pdf.mimeType,
            totalBytes: pdf.totalBytes,
            sha256: pdf.sha256,
            initialPage: 1,
        };
    }
    read(url, offset, byteCount) {
        if (!Number.isSafeInteger(offset) || offset < 0)
            throw new Error("PDF byte offset must be a non-negative integer.");
        if (!Number.isSafeInteger(byteCount) || byteCount < 1 || byteCount > PDF_CHUNK_BYTES) {
            throw new Error(`PDF byte count must be between 1 and ${PDF_CHUNK_BYTES}.`);
        }
        this.purgeExpired();
        const entry = this.entries.get(url);
        if (!entry)
            throw new Error("Character PDF is unavailable or expired; export it again.");
        this.entries.delete(url);
        entry.expiresAt = this.now() + PDF_CACHE_TTL_MS;
        this.entries.set(url, entry);
        const start = Math.min(offset, entry.totalBytes);
        const end = Math.min(start + byteCount, entry.totalBytes);
        const bytes = entry.bytes.subarray(start, end);
        return {
            url,
            bytes: bytes.toString("base64"),
            offset: start,
            byteCount: bytes.length,
            totalBytes: entry.totalBytes,
            hasMore: end < entry.totalBytes,
        };
    }
    purgeExpired() {
        const current = this.now();
        for (const [url, entry] of this.entries) {
            if (entry.expiresAt <= current)
                this.delete(url);
        }
    }
    delete(url) {
        const entry = this.entries.get(url);
        if (!entry)
            return;
        this.totalBytes -= entry.totalBytes;
        this.entries.delete(url);
    }
}
//# sourceMappingURL=character-pdf.js.map