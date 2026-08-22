import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

if (process.env.DDB_MCP_LIVE_TESTS !== "1") {
  process.stdout.write("Live Docker tests skipped; set DDB_MCP_LIVE_TESTS=1 to opt in.\n");
  process.exit(0);
}

let sessionPath = process.env.DDB_MCP_SESSION_PATH;
let validSession = typeof sessionPath === "string" && isAbsolute(sessionPath);
try {
  validSession &&= statSync(sessionPath).isFile();
  sessionPath = realpathSync(sessionPath);
} catch {
  validSession = false;
}
if (validSession) {
  const repositoryRelativePath = relative(repositoryRoot, sessionPath);
  validSession = repositoryRelativePath === ".." || repositoryRelativePath.startsWith(`..${sep}`);
}
if (!validSession) {
  process.stderr.write("Live Docker tests require an existing absolute session file outside the repository; path suppressed.\n");
  process.exit(1);
}

const image = process.env.DDB_MCP_LIVE_IMAGE ?? "ddb-mcp:live";
const build = spawnSync("docker", ["build", "--tag", image, "."], { stdio: "inherit" });
if (build.status !== 0) {
  process.stderr.write("Live Docker candidate image build failed.\n");
  process.exit(build.status ?? 1);
}

const stagingDirectory = mkdtempSync(join(tmpdir(), "ddb-mcp-live-session-"));
try {
  const stagedSession = join(stagingDirectory, "session.json");
  copyFileSync(sessionPath, stagedSession);
  chmodSync(stagedSession, 0o444);

  const suite = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", "test/live/live-read.test.mjs"],
    {
      env: {
        ...process.env,
        DDB_MCP_LIVE_TRANSPORT: "docker",
        DDB_MCP_LIVE_IMAGE: image,
        DDB_MCP_SESSION_PATH: stagedSession,
      },
      stdio: "inherit",
    }
  );
  process.exitCode = suite.status ?? 1;
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true });
}
