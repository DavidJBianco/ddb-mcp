import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function dryRun(target) {
  return spawnSync("make", ["-n", target], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, BUILD_DOCKER_IMAGE: "1" },
  });
}

function occurrences(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

test("make test builds and runs every non-live bundle exactly once", () => {
  const result = dryRun("test");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm run build/);
  assert.match(result.stdout, /go -C cmd\/mysterium-auth build/);
  assert.match(result.stdout, /npm run test:offline/);
  assert.match(result.stdout, /npm run test:browser:only/);
  assert.match(result.stdout, /docker build --tag "mysterium:test"/);
  assert.match(result.stdout, /npm run "test:docker:run"/);
  assert.doesNotMatch(result.stdout, /test:live/);
});

test("make test-release reuses one candidate image for offline and live Docker tests", () => {
  const result = dryRun("test-release");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(occurrences(result.stdout, /docker build --tag "mysterium:test"/g), 1);
  assert.match(result.stdout, /MYSTERIUM_TEST_IMAGE="mysterium:test" npm run "test:docker:run"/);
  assert.match(result.stdout, /MYSTERIUM_LIVE_IMAGE="mysterium:test" MYSTERIUM_LIVE_SKIP_BUILD=1 npm run test:live:docker/);
});

test("targeted Make tests build only the artifacts they exercise", () => {
  const browser = dryRun("test-browser");
  assert.equal(browser.status, 0, browser.stderr);
  assert.match(browser.stdout, /npm run build/);
  assert.match(browser.stdout, /npm run test:browser:only/);
  assert.doesNotMatch(browser.stdout, /docker build|go -C cmd\/mysterium-auth build/);

  const docker = dryRun("test-docker");
  assert.equal(docker.status, 0, docker.stderr);
  assert.match(docker.stdout, /docker build --tag "mysterium:test"/);
  assert.match(docker.stdout, /npm run "test:docker:run"/);
  assert.doesNotMatch(docker.stdout, /npm run test:offline|test:live/);
});

test("the obsolete make test-all target is removed", () => {
  const result = dryRun("test-all");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No rule to make target/);
});
