import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const image = process.env.DDB_MCP_TEST_IMAGE ?? "ddb-mcp:test";

test("Docker MCP Toolkit catalog entry describes the production image contract", async () => {
  const catalog = await readFile(new URL("../../docker-mcp.yaml", import.meta.url), "utf8");

  assert.match(catalog, /^name: ddb-mcp-local$/m);
  assert.match(catalog, /^type: server$/m);
  assert.match(catalog, /^image: ddb-mcp-local:latest$/m);
  assert.match(catalog, /^\s+- ddb-mcp-session:\/home\/mcp\/\.config\/ddb-mcp$/m);
});

test("Docker MCP Toolkit accepts the candidate through a profile", async (t) => {
  const version = spawnSync("docker", ["mcp", "version"], { encoding: "utf8" });
  if (version.error?.code === "ENOENT" || version.status !== 0) {
    t.skip("Docker MCP Toolkit is unavailable on this runner");
    return;
  }

  const toolkitHome = await mkdtemp(join(tmpdir(), "ddb-mcp-toolkit-"));
  t.after(async () => rm(toolkitHome, { recursive: true, force: true }));
  let plugin;
  try {
    plugin = await realpath(join(process.env.HOME, ".docker", "cli-plugins", "docker-mcp"));
  } catch {
    t.skip("Docker MCP Toolkit plugin cannot be isolated on this runner");
    return;
  }
  const pluginDirectory = join(toolkitHome, ".docker", "cli-plugins");
  await mkdir(pluginDirectory, { recursive: true });
  await symlink(plugin, join(pluginDirectory, "docker-mcp"));
  const catalogDirectory = join(toolkitHome, ".docker", "mcp", "catalogs");
  await mkdir(catalogDirectory, { recursive: true });

  const catalog = await readFile(new URL("../../docker-mcp.yaml", import.meta.url), "utf8");
  await writeFile(
    join(catalogDirectory, "ddb-mcp-local.yaml"),
    catalog.replace("image: ddb-mcp-local:latest", `image: ${image}`)
  );

  const environment = { ...process.env, HOME: toolkitHome };
  const profileId = `ddb-mcp-test-${process.pid}`;
  const created = spawnSync(
    "docker",
    [
      "mcp",
      "profile",
      "create",
      "--name",
      "DDB MCP test",
      "--id",
      profileId,
      "--server",
      "file://ddb-mcp-local.yaml",
    ],
    { encoding: "utf8", env: environment, timeout: 30_000 }
  );
  const createDiagnostics = `${created.stdout ?? ""}\n${created.stderr ?? ""}`;
  if (/Docker Desktop is not running|cannot connect to.*Docker Desktop/i.test(createDiagnostics)) {
    t.skip("Docker MCP Toolkit runtime is unavailable");
    return;
  }
  assert.equal(
    created.status,
    0,
    `Toolkit rejected the local server definition: ${createDiagnostics.trim()}`
  );

  t.after(() => {
    spawnSync("docker", ["mcp", "profile", "remove", profileId], {
      env: environment,
      stdio: "ignore",
    });
  });

  const result = spawnSync(
    "docker",
    ["mcp", "gateway", "run", "--dry-run", "--profile", profileId],
    { encoding: "utf8", env: environment, timeout: 30_000 }
  );
  const diagnostics = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  if (/Docker Desktop is not running|cannot connect to.*Docker Desktop/i.test(diagnostics)) {
    t.skip("Docker MCP Toolkit runtime is unavailable");
    return;
  }

  assert.equal(result.signal, null);
  assert.equal(result.status, 0, "Toolkit gateway dry-run rejected the candidate image");
});
