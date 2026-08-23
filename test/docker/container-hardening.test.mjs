import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const image = process.env.MYSTERIUM_TEST_IMAGE ?? "mysterium:test";

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

let containerSequence = 0;
function dockerRun(label, args) {
  const name = `mysterium-test-${label}-${process.pid}-${++containerSequence}`;
  try {
    return docker(["run", "--rm", "--name", name, ...args]);
  } finally {
    spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
  }
}

function dockerRunInput(label, args, input) {
  const name = `mysterium-test-${label}-${process.pid}-${++containerSequence}`;
  try {
    const result = spawnSync("docker", ["run", "--rm", "--interactive", "--name", name, ...args], {
      input,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  } finally {
    spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
  }
}

test("production image declares the non-root MCP runtime contract", () => {
  const [inspection] = JSON.parse(docker(["image", "inspect", image]));

  assert.equal(inspection.Config.User, "mcp");
  assert.deepEqual(inspection.Config.Entrypoint, [
    "tini",
    "--",
    "xvfb-run",
    "-a",
    "--server-args=-screen 0 1280x1024x24",
    "node",
    "dist/index.js",
  ]);
  assert.ok(inspection.Config.Volumes["/home/mcp/.config/mysterium"]);
  assert.match(inspection.Architecture, /^(amd64|arm64)$/);

  assert.equal(dockerRun("uid", ["--entrypoint", "id", image, "-u"]), "10001");
});

test("production image contains no test or session material", () => {
  const forbidden = dockerRun("forbidden-files", [
    "--entrypoint",
    "sh",
    image,
    "-c",
    "find /app /home/mcp -path /app/node_modules -prune -o -type f \\( -name 'session.json' -o -name 'settings.json' -o -path '*/test/*' -o -name '*.env' \\) -print",
  ]);
  assert.equal(forbidden, "");
  assert.equal(
    dockerRun("test-files", ["--entrypoint", "sh", image, "-c", "test ! -e /app/test && echo clean"]),
    "clean"
  );
  assert.equal(
    dockerRun("repository-files", [
      "--entrypoint",
      "sh",
      image,
      "-c",
      "for path in /app/src /app/.git /app/.github /app/AGENTS.md /app/TODO.md /app/Dockerfile /app/tsconfig.json /app/mysterium.yaml; do test ! -e \"$path\" || exit 1; done; echo clean",
    ]),
    "clean"
  );

  const history = docker(["image", "history", "--no-trunc", "--format", "{{.CreatedBy}}", image]);
  assert.doesNotMatch(history, /session\.json|settings\.json|cookie|authorization|password/i);
});

test("session administration is writable only through an explicit mount while the MCP mount remains read-only", async (t) => {
  const volume = `mysterium-test-${process.pid}-${Date.now()}`;
  docker(["volume", "create", volume]);
  t.after(() => {
    spawnSync("docker", ["volume", "rm", "--force", volume], { stdio: "ignore" });
  });

  const validState = JSON.stringify({
    cookies: [{ name: "synthetic", value: "private", domain: ".dndbeyond.com", path: "/", expires: 4102444800, httpOnly: true, secure: true, sameSite: "Lax" }],
    origins: [],
  });
  assert.match(
    dockerRunInput("session-volume", [
      "--mount",
      `type=volume,src=${volume},dst=/home/mcp/.config/mysterium`,
      "--entrypoint",
      "node",
      image,
      "dist/session-admin.js",
      "import",
    ], validState),
    /"status":"imported"/
  );

  assert.equal(
    dockerRun("readonly-session", [
      "--mount",
      `type=volume,src=${volume},dst=/home/mcp/.config/mysterium,readonly`,
      "--entrypoint",
      "sh",
      image,
      "-c",
      "test -r /home/mcp/.config/mysterium/session.json && ! test -w /home/mcp/.config/mysterium/session.json && echo readonly",
    ]),
    "readonly"
  );
});

test("the non-root image can write a group-scoped external output mount", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mysterium-output-test-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  await chmod(directory, 0o730);

  assert.equal(
    dockerRun("external-output", [
      "--group-add",
      String(process.getgid?.() ?? 0),
      "--mount",
      `type=bind,src=${directory},dst=/output`,
      "--entrypoint",
      "sh",
      image,
      "-c",
      "touch /output/result.json && echo writable",
    ]),
    "writable"
  );
});

test("missing session state is accepted by the production entrypoint", { timeout: 30_000 }, () => {
  const name = `mysterium-test-missing-session-${process.pid}`;
  let result;
  try {
    result = spawnSync(
      "docker",
      ["run", "--rm", "--name", name, "--interactive", "--network", "none", image],
      { input: "", encoding: "utf8", timeout: 20_000 }
    );
  } finally {
    spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
  }

  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /session|cookie|credential/i);
});

test("the production entrypoint forwards termination and exits promptly", { timeout: 15_000 }, async (t) => {
  const name = `mysterium-signal-${process.pid}-${Date.now()}`;
  const child = spawn(
    "docker",
    ["run", "--rm", "--interactive", "--name", name, "--network", "none", image],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  t.after(() => {
    child.kill("SIGKILL");
    spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
  });

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = spawnSync("docker", ["inspect", "--format", "{{.State.Running}}", name], {
      encoding: "utf8",
    });
    if (state.status === 0 && state.stdout.trim() === "true") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.equal(docker(["inspect", "--format", "{{.State.Running}}", name]), "true");
  const childExit = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("docker run did not exit after termination")), 7_000);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  const started = Date.now();
  docker(["stop", "--time", "5", name]);
  const exit = await childExit;

  assert.equal(exit.signal, null);
  assert.ok([0, 143].includes(exit.code), `unexpected docker run exit code ${exit.code}`);
  assert.ok(Date.now() - started < 7_000);
});
