import assert from "node:assert/strict";
import test from "node:test";

import {
  dockerLiveArguments,
  parseManagedLiveSessionVolume,
  validateLiveSessionVolumeName,
} from "./support/live-docker.mjs";

const managedInspection = JSON.stringify([{
  Name: "mysterium-session",
  Labels: {
    "io.github.davidjbianco.mysterium.purpose": "session",
    "io.github.davidjbianco.mysterium.managed-by": "mysterium-auth",
  },
}]);

test("offline safeguard: Docker session volume must be helper-managed", () => {
  assert.equal(validateLiveSessionVolumeName("mysterium-session"), "mysterium-session");
  assert.equal(parseManagedLiveSessionVolume(managedInspection, "mysterium-session").Name, "mysterium-session");
  assert.throws(() => validateLiveSessionVolumeName("../session"), /invalid/);
  assert.throws(() => parseManagedLiveSessionVolume("not-json", "mysterium-session"), /invalid.*inspection/);
  assert.throws(
    () => parseManagedLiveSessionVolume(managedInspection, "another-volume"),
    /not managed by mysterium-auth/
  );
});

test("offline safeguard: Docker session mount must be read-only", () => {
  const args = dockerLiveArguments({
    image: "mysterium:live",
    containerName: "mysterium-live-test-1",
    sessionVolume: "mysterium-session",
    outputDirectory: "/tmp/mysterium-output",
  });
  assert.ok(args.includes("type=volume,src=mysterium-session,dst=/home/mcp/.config/mysterium,readonly"));
  assert.ok(args.includes("type=bind,src=/tmp/mysterium-output,dst=/tmp/mysterium-live-output"));
  assert.equal(args.some((argument) => argument.includes("session.json")), false);
});
