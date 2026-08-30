import assert from "node:assert/strict";
import test from "node:test";

import { cachedMetadata, clearMetadataCache } from "../dist/tools/metadata-cache.js";

test("metadata cache is per owner, fixed-TTL, refreshable, and failure-safe", async () => {
  const owner = {};
  const otherOwner = {};
  let now = 0;
  let loads = 0;
  const load = async () => ({ generation: ++loads });

  assert.deepEqual(await cachedMetadata(owner, "books", 100, load, { now: () => now }), {
    value: { generation: 1 }, status: "refreshed",
  });
  now = 80;
  assert.deepEqual(await cachedMetadata(owner, "books", 100, load, { now: () => now }), {
    value: { generation: 1 }, status: "hit",
  });
  now = 101;
  assert.equal((await cachedMetadata(owner, "books", 100, load, { now: () => now })).value.generation, 2);
  assert.equal((await cachedMetadata(owner, "books", 100, load, { refresh: true, now: () => now })).value.generation, 3);
  assert.equal((await cachedMetadata(otherOwner, "books", 100, load, { now: () => now })).value.generation, 4);

  clearMetadataCache(owner, "books");
  await assert.rejects(cachedMetadata(owner, "books", 100, async () => { throw new Error("synthetic failure"); }), /synthetic failure/);
  assert.equal((await cachedMetadata(owner, "books", 100, load, { now: () => now })).value.generation, 5);
});

test("metadata cache coalesces concurrent loads", async () => {
  const owner = {};
  let release;
  let loads = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const load = async () => {
    loads += 1;
    await pending;
    return ["ready"];
  };
  const first = cachedMetadata(owner, "campaigns", 100, load);
  const second = cachedMetadata(owner, "campaigns", 100, load);
  release();
  assert.deepEqual((await first).value, ["ready"]);
  assert.deepEqual((await second).value, ["ready"]);
  assert.equal(loads, 1);
});
