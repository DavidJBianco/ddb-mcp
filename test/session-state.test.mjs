import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AUTH_REQUIRED_MESSAGE,
  AuthenticationRequiredError,
  validateStorageState,
} from "../dist/session-state.js";

const validState = {
  cookies: [{
    name: "synthetic-session",
    value: "private-value",
    domain: ".dndbeyond.com",
    path: "/",
    expires: 4_102_444_800,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  }],
  origins: [{
    origin: "https://www.dndbeyond.com",
    localStorage: [{ name: "synthetic", value: "private-value" }],
  }],
};

function admin(sessionPath, args, input = "") {
  return spawnSync(process.execPath, ["dist/session-admin.js", ...args], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      MYSTERIUM_SESSION_PATH: sessionPath,
      MYSTERIUM_AUTH_HELPER_VERSION: "test-helper",
    },
    input,
    encoding: "utf8",
  });
}

test("storage-state validation accepts only D&D Beyond state", () => {
  assert.deepEqual(validateStorageState(JSON.stringify(validState)), validState);
  const externalCookie = structuredClone(validState);
  externalCookie.cookies[0].domain = ".google.com";
  assert.throws(() => validateStorageState(JSON.stringify(externalCookie)), /outside dndbeyond\.com/);
  const externalOrigin = structuredClone(validState);
  externalOrigin.origins[0].origin = "https://accounts.google.com";
  assert.throws(() => validateStorageState(JSON.stringify(externalOrigin)), /outside dndbeyond\.com/);
  assert.throws(() => validateStorageState("{}"), /cookies and origins arrays/);
  const expired = structuredClone(validState);
  expired.cookies[0].expires = 1;
  assert.throws(() => validateStorageState(JSON.stringify(expired)), /only expired cookies/);
});

test("authentication errors give the host-helper instruction", () => {
  assert.match(AUTH_REQUIRED_MESSAGE, /mysterium-auth login/);
  assert.equal(new AuthenticationRequiredError().message, AUTH_REQUIRED_MESSAGE);
});

test("session admin imports atomically, validates, preserves prior state, and resets", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mysterium-session-admin-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sessionPath = join(directory, "session.json");

  let result = admin(sessionPath, ["status"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "empty");

  const encoded = JSON.stringify(validState);
  result = admin(sessionPath, ["import"], encoded);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "imported");
  assert.equal(await readFile(sessionPath, "utf8"), encoded);
  assert.equal(JSON.parse(await readFile(join(directory, "session-meta.json"), "utf8")).helperVersion, "test-helper");
  assert.equal((await stat(sessionPath)).mode & 0o777, 0o600);
  assert.equal((await stat(join(directory, "session-meta.json"))).mode & 0o777, 0o600);

  result = admin(sessionPath, ["validate"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "valid");

  result = admin(sessionPath, ["import"], JSON.stringify({ ...validState, cookies: [] }));
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(sessionPath, "utf8"), encoded);
  assert.doesNotMatch(result.stderr, /private-value/);

  result = admin(sessionPath, ["reset"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "reset");
  assert.equal(JSON.parse(admin(sessionPath, ["status"]).stdout).status, "empty");
});

test("session admin refuses to classify an unlabeled nonempty directory as empty", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mysterium-session-status-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "unrelated-data"), "keep me");
  const result = admin(join(directory, "session.json"), ["status"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "nonempty-invalid");
});

test("missing session state is rejected before requesting a browser context", () => {
  const sessionPath = join(tmpdir(), `missing-mysterium-session-${process.pid}.json`);
  const script = `
    import('./dist/browser.js').then(async ({ getContext }) => {
      let requested = false;
      try {
        await getContext({ newContext: async () => { requested = true; } });
      } catch (error) {
        process.stdout.write(JSON.stringify({ requested, message: error.message }));
      }
    });
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, MYSTERIUM_SESSION_PATH: sessionPath },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.requested, false);
  assert.match(output.message, /mysterium-auth login/);
});

test("browser context is reused until an atomic session replacement is detected", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mysterium-session-reload-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sessionPath = join(directory, "session.json");
  await writeFile(sessionPath, JSON.stringify(validState), { mode: 0o600 });
  const script = `
    import { rename, writeFile } from 'node:fs/promises';
    import('./dist/browser.js').then(async ({ getContext }) => {
      let creations = 0;
      let closes = 0;
      const page = {
        goto: async () => {}, waitForTimeout: async () => {},
        url: () => 'https://www.dndbeyond.com/', evaluate: async () => true,
        close: async () => {},
      };
      const browser = { newContext: async () => ({
        newPage: async () => page, close: async () => { closes += 1; }, pages: () => [],
        id: ++creations,
      }) };
      const first = await getContext(browser);
      const second = await getContext(browser);
      const replacement = process.env.MYSTERIUM_SESSION_PATH + '.replacement';
      await writeFile(replacement, ${JSON.stringify(JSON.stringify(validState))}, { mode: 0o600 });
      await rename(replacement, process.env.MYSTERIUM_SESSION_PATH);
      const third = await getContext(browser);
      process.stdout.write(JSON.stringify({ creations, closes, same: first === second, changed: second !== third }));
    });
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, MYSTERIUM_SESSION_PATH: sessionPath },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { creations: 2, closes: 1, same: true, changed: true });
});

test("missing session state closes the previously authenticated browser context", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mysterium-session-removal-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sessionPath = join(directory, "session.json");
  await writeFile(sessionPath, JSON.stringify(validState), { mode: 0o600 });
  const script = `
    import { rm } from 'node:fs/promises';
    import('./dist/browser.js').then(async ({ getContext }) => {
      let creations = 0;
      let closes = 0;
      const page = {
        goto: async () => {}, waitForTimeout: async () => {},
        url: () => 'https://www.dndbeyond.com/', evaluate: async () => true,
        close: async () => {},
      };
      const browser = { newContext: async () => ({
        newPage: async () => page, close: async () => { closes += 1; }, pages: () => [],
      }) };
      await getContext(browser);
      creations += 1;
      await rm(process.env.MYSTERIUM_SESSION_PATH);
      let message = '';
      try {
        await getContext(browser);
      } catch (error) {
        message = error.message;
      }
      process.stdout.write(JSON.stringify({ creations, closes, message }));
    });
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, MYSTERIUM_SESSION_PATH: sessionPath },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual({ creations: output.creations, closes: output.closes }, { creations: 1, closes: 1 });
  assert.match(output.message, /mysterium-auth login/);
});
