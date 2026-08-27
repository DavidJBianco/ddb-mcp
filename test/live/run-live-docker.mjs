import { spawnSync } from "node:child_process";

import {
  DEFAULT_LIVE_SESSION_VOLUME,
  parseManagedLiveSessionVolume,
  validateLiveSessionVolumeName,
} from "../support/live-docker.mjs";

let sessionVolume;
try {
  sessionVolume = validateLiveSessionVolumeName(
    process.env.MYSTERIUM_SESSION_VOLUME ?? DEFAULT_LIVE_SESSION_VOLUME
  );
} catch {
  process.stderr.write("Live Docker tests received an invalid session volume name.\n");
  process.exit(1);
}
const inspection = spawnSync("docker", ["volume", "inspect", sessionVolume], { encoding: "utf8" });
if (inspection.status !== 0) {
  process.stderr.write(
    `Live Docker tests require the helper-managed ${sessionVolume} volume; run make login first.\n`
  );
  process.exit(1);
}
try {
  parseManagedLiveSessionVolume(inspection.stdout, sessionVolume);
} catch {
  process.stderr.write(
    `Live Docker tests require the helper-managed ${sessionVolume} volume; run make login first.\n`
  );
  process.exit(1);
}

const image = process.env.MYSTERIUM_LIVE_IMAGE ?? "mysterium:live";
const containerName = `mysterium-live-test-${process.pid}`;
const skipBuild = process.env.MYSTERIUM_LIVE_SKIP_BUILD === "1";
if (skipBuild) {
  const candidate = spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" });
  if (candidate.status !== 0) {
    process.stderr.write("Live Docker tests could not find the prebuilt candidate image.\n");
    process.exit(candidate.status ?? 1);
  }
} else {
  const build = spawnSync("docker", ["build", "--tag", image, "."], { stdio: "inherit" });
  if (build.status !== 0) {
    process.stderr.write("Live Docker candidate image build failed.\n");
    process.exit(build.status ?? 1);
  }
}

let cleanedUp = false;

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  spawnSync("docker", ["rm", "--force", containerName], { stdio: "ignore" });
}

process.once("exit", cleanup);
process.once("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.once("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

try {
  const { MYSTERIUM_SESSION_PATH: _ignoredSessionPath, ...baseEnvironment } = process.env;
  const suite = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", "test/live/live-read.test.mjs"],
    {
      env: {
        ...baseEnvironment,
        MYSTERIUM_LIVE_TRANSPORT: "docker",
        MYSTERIUM_LIVE_IMAGE: image,
        MYSTERIUM_LIVE_CONTAINER_NAME: containerName,
        MYSTERIUM_SESSION_VOLUME: sessionVolume,
      },
      stdio: "inherit",
    }
  );
  process.exitCode = suite.status ?? 1;
} finally {
  // --rm handles the normal path; this handles failed tests and interrupted
  // MCP shutdown after the child process has returned control to this runner.
  cleanup();
}
