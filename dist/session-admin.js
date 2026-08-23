import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { SESSION_PATH } from "./browser.js";
import { MAX_SESSION_BYTES, SESSION_SCHEMA_VERSION, validateStorageState, verifyContextAuthentication, } from "./session-state.js";
import { PACKAGE_VERSION } from "./version.js";
const METADATA_PATH = join(dirname(SESSION_PATH), "session-meta.json");
function emit(result) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
}
async function readStandardInput() {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_SESSION_BYTES)
            throw new Error("Candidate session state exceeds the size limit.");
        chunks.push(bytes);
    }
    return Buffer.concat(chunks);
}
async function verifyLive(path) {
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    try {
        const context = await browser.newContext({ storageState: path, viewport: { width: 1280, height: 800 } });
        try {
            await verifyContextAuthentication(context);
        }
        finally {
            await context.close();
        }
    }
    finally {
        await browser.close();
    }
}
async function importSession(live) {
    const candidate = await readStandardInput();
    validateStorageState(candidate);
    const sessionDirectory = dirname(SESSION_PATH);
    await mkdir(sessionDirectory, { recursive: true });
    const suffix = `${process.pid}-${Date.now()}`;
    const candidatePath = join(sessionDirectory, `.session-${suffix}.json`);
    const metadataCandidate = join(sessionDirectory, `.session-meta-${suffix}.json`);
    const helperVersion = process.env.MYSTERIUM_AUTH_HELPER_VERSION?.trim() || "unknown";
    const createdAt = new Date().toISOString();
    try {
        await writeFile(candidatePath, candidate, { mode: 0o600, flag: "wx" });
        await chmod(candidatePath, 0o600);
        if (live)
            await verifyLive(candidatePath);
        await writeFile(metadataCandidate, `${JSON.stringify({ schemaVersion: SESSION_SCHEMA_VERSION, helperVersion, serverVersion: PACKAGE_VERSION, createdAt }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
        await chmod(metadataCandidate, 0o600);
        await rename(candidatePath, SESSION_PATH);
        await rename(metadataCandidate, METADATA_PATH);
    }
    finally {
        await rm(candidatePath, { force: true });
        await rm(metadataCandidate, { force: true });
    }
    emit({ ok: true, status: live ? "authenticated" : "imported", schemaVersion: SESSION_SCHEMA_VERSION, helperVersion, createdAt });
}
async function validateSession(live) {
    validateStorageState(await readFile(SESSION_PATH));
    let metadata;
    try {
        metadata = JSON.parse(await readFile(METADATA_PATH, "utf8"));
    }
    catch {
        throw new Error("Session metadata is missing or malformed; run mysterium-auth login.");
    }
    if (metadata.schemaVersion !== SESSION_SCHEMA_VERSION ||
        typeof metadata.helperVersion !== "string" || metadata.helperVersion.length === 0 ||
        typeof metadata.serverVersion !== "string" || metadata.serverVersion.length === 0 ||
        typeof metadata.createdAt !== "string" || Number.isNaN(Date.parse(metadata.createdAt))) {
        throw new Error("Session metadata is incompatible; run mysterium-auth login.");
    }
    if (live)
        await verifyLive(SESSION_PATH);
    emit({
        ok: true,
        status: live ? "authenticated" : "valid",
        schemaVersion: SESSION_SCHEMA_VERSION,
        helperVersion: typeof metadata.helperVersion === "string" ? metadata.helperVersion : undefined,
        createdAt: typeof metadata.createdAt === "string" ? metadata.createdAt : undefined,
    });
}
async function resetSession() {
    await rm(SESSION_PATH, { force: true });
    await rm(METADATA_PATH, { force: true });
    emit({ ok: true, status: "reset", schemaVersion: SESSION_SCHEMA_VERSION });
}
async function sessionStatus() {
    try {
        const entries = await readdir(dirname(SESSION_PATH));
        if (entries.length === 0) {
            emit({ ok: true, status: "empty", schemaVersion: SESSION_SCHEMA_VERSION });
            return;
        }
        if (!entries.includes(basename(SESSION_PATH))) {
            emit({ ok: true, status: "nonempty-invalid", schemaVersion: SESSION_SCHEMA_VERSION });
            return;
        }
        const state = await readFile(SESSION_PATH);
        if (state.length === 0) {
            emit({ ok: true, status: "nonempty-invalid", schemaVersion: SESSION_SCHEMA_VERSION });
            return;
        }
        try {
            validateStorageState(state);
            emit({ ok: true, status: "valid", schemaVersion: SESSION_SCHEMA_VERSION });
        }
        catch {
            emit({ ok: true, status: "nonempty-invalid", schemaVersion: SESSION_SCHEMA_VERSION });
        }
    }
    catch (error) {
        if (error.code === "ENOENT") {
            emit({ ok: true, status: "empty", schemaVersion: SESSION_SCHEMA_VERSION });
            return;
        }
        throw error;
    }
}
export async function main(args = process.argv.slice(2)) {
    const [command, ...options] = args;
    const live = options.includes("--live");
    if (options.some((option) => option !== "--live"))
        throw new Error("Unsupported session-admin option.");
    switch (command) {
        case "import":
            await importSession(live);
            return;
        case "validate":
            await validateSession(live);
            return;
        case "reset":
            if (live)
                throw new Error("reset does not accept --live.");
            await resetSession();
            return;
        case "status":
            if (live)
                throw new Error("status does not accept --live.");
            await sessionStatus();
            return;
        default:
            throw new Error("Usage: session-admin <import|validate|reset|status> [--live]");
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        const message = error instanceof Error ? error.message : "Session administration failed.";
        process.stderr.write(`${message}\n`);
        process.exit(1);
    });
}
//# sourceMappingURL=session-admin.js.map