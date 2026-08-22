import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const image = process.env.DDB_MCP_TEST_IMAGE ?? "ddb-mcp:test";

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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
  assert.ok(inspection.Config.Volumes["/home/mcp/.config/ddb-mcp"]);
  assert.match(inspection.Architecture, /^(amd64|arm64)$/);

  assert.equal(docker(["run", "--rm", "--entrypoint", "id", image, "-u"]), "10001");
});

test("production image contains no test or session material", () => {
  const forbidden = docker([
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    image,
    "-c",
    "find /app /home/mcp -path /app/node_modules -prune -o -type f \\( -name 'session.json' -o -name 'settings.json' -o -path '*/test/*' -o -name '*.env' \\) -print",
  ]);
  assert.equal(forbidden, "");
  assert.equal(
    docker(["run", "--rm", "--entrypoint", "sh", image, "-c", "test ! -e /app/test && echo clean"]),
    "clean"
  );
  assert.equal(
    docker([
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      image,
      "-c",
      "for path in /app/src /app/.git /app/.github /app/AGENTS.md /app/TODO.md /app/Dockerfile /app/tsconfig.json /app/docker-mcp.yaml; do test ! -e \"$path\" || exit 1; done; echo clean",
    ]),
    "clean"
  );

  const history = docker(["image", "history", "--no-trunc", "--format", "{{.CreatedBy}}", image]);
  assert.doesNotMatch(history, /session\.json|settings\.json|cookie|authorization|password/i);
});

test("session directory is writable while a read-only session bind remains immutable", async (t) => {
  const volume = `ddb-mcp-test-${process.pid}-${Date.now()}`;
  docker(["volume", "create", volume]);
  t.after(() => {
    spawnSync("docker", ["volume", "rm", "--force", volume], { stdio: "ignore" });
  });

  assert.equal(
    docker([
      "run",
      "--rm",
      "--mount",
      `type=volume,src=${volume},dst=/home/mcp/.config/ddb-mcp`,
      "--entrypoint",
      "sh",
      image,
      "-c",
      "touch /home/mcp/.config/ddb-mcp/session.json && test -w /home/mcp/.config/ddb-mcp/session.json && echo writable",
    ]),
    "writable"
  );

  const directory = await mkdtemp(join(tmpdir(), "ddb-mcp-session-test-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const sessionPath = join(directory, "session.json");
  await writeFile(sessionPath, "{}", { mode: 0o644 });

  assert.equal(
    docker([
      "run",
      "--rm",
      "--mount",
      `type=bind,src=${sessionPath},dst=/home/mcp/.config/ddb-mcp/session.json,readonly`,
      "--entrypoint",
      "sh",
      image,
      "-c",
      "test -r /home/mcp/.config/ddb-mcp/session.json && ! test -w /home/mcp/.config/ddb-mcp/session.json && echo readonly",
    ]),
    "readonly"
  );
});

test("missing session state is accepted by the production entrypoint", { timeout: 30_000 }, () => {
  const result = spawnSync(
    "docker",
    ["run", "--rm", "--interactive", "--network", "none", image],
    { input: "", encoding: "utf8", timeout: 20_000 }
  );

  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /session|cookie|credential/i);
});

test("the production entrypoint forwards termination and exits promptly", { timeout: 15_000 }, async (t) => {
  const name = `ddb-mcp-signal-${process.pid}-${Date.now()}`;
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
