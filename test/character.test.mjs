import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PORTRAIT_BYTES,
  getCharacterPortrait,
  normalizeCharacterDetail,
  normalizeCharacterList,
  validateCharacterListRequest,
} from "../dist/tools/character.js";

function summary(overrides = {}) {
  return {
    id: 10,
    name: "Aria Brightwood",
    level: 5,
    classDescription: "Bard 3 / Fighter 2",
    raceName: "Elf",
    campaignId: 7,
    campaignName: "Synthetic Campaign",
    status: 1,
    createdDate: Date.parse("2025-01-02T03:04:05Z"),
    lastModifiedDate: Date.parse("2025-03-04T05:06:07Z"),
    ...overrides,
  };
}

function page(data, pagination = null) {
  return {
    id: 0,
    success: true,
    message: null,
    data: {
      characters: data,
      characterSlotLimit: 6,
      canUnlockCharacters: false,
    },
    pagination,
  };
}

test("normalizes multiple character-list pages and deterministic defaults", () => {
  const result = normalizeCharacterList([
    page([summary({ id: 20, name: "zoe", campaignId: null, campaignName: null })]),
    page([summary({ id: 3, name: "Ária" }), summary({ id: 2, name: "Ária" })]),
  ]);

  assert.equal(result.total, 3);
  assert.equal(result.count, 3);
  assert.deepEqual(result.characters.map(({ id }) => id), ["2", "3", "20"]);
  assert.equal(result.characters[0].createdAt, "2025-01-02T03:04:05.000Z");
  assert.deepEqual(result.filters, {
    names: [], classes: [], species: [], campaignIds: [], level: null, minLevel: null, maxLevel: null,
  });
  assert.deepEqual(result.sort, { field: "name", direction: "asc" });
});

test("normalizes both current numeric and compatible string character timestamps", () => {
  const result = normalizeCharacterList([page([
    summary({ id: 1 }),
    summary({
      id: 2,
      createdDate: "2024-01-02T03:04:05Z",
      lastModifiedDate: "2024-03-04T05:06:07Z",
    }),
  ])]);

  assert.equal(result.characters.find(({ id }) => id === "1").createdAt, "2025-01-02T03:04:05.000Z");
  assert.equal(result.characters.find(({ id }) => id === "2").modifiedAt, "2024-03-04T05:06:07.000Z");
});

test("applies field-aware filters with OR inside categories and AND across them", () => {
  const input = page([
    summary(),
    summary({ id: 11, name: "Aria Stone", classDescription: "Wizard 5", raceName: "Half-Elf" }),
    summary({ id: 12, name: "Borin", classDescription: "Bard 5", raceName: "Elf", campaignId: 8, campaignName: "Other" }),
  ]);
  const result = normalizeCharacterList([input], {
    names: ["bright", "missing"],
    classes: ["fighter", "wizard"],
    species: ["elf"],
    campaignIds: ["7", "9"],
    minLevel: 3,
    maxLevel: 5,
  });
  assert.deepEqual(result.characters.map(({ id }) => id), ["10"]);
  assert.equal(normalizeCharacterList([input], { species: ["elf"] }).count, 2);
  assert.equal(normalizeCharacterList([input], { species: ["half-elf"] }).count, 1);
});

test("sorts every supported field and applies stable name/ID tie-breakers", () => {
  const input = page([
    summary({ id: 10, name: "Beta", level: 2, createdDate: "2025-01-03Z", lastModifiedDate: "2025-01-01Z" }),
    summary({ id: 2, name: "Alpha", level: 8, createdDate: "2025-01-01Z", lastModifiedDate: "2025-01-03Z" }),
    summary({ id: 3, name: "Alpha", level: 8, createdDate: "2025-01-02Z", lastModifiedDate: "2025-01-02Z" }),
  ]);
  assert.deepEqual(normalizeCharacterList([input], { sortBy: "level", sortDirection: "desc" }).characters.map(({ id }) => id), ["2", "3", "10"]);
  assert.deepEqual(normalizeCharacterList([input], { sortBy: "created" }).characters.map(({ id }) => id), ["2", "3", "10"]);
  assert.deepEqual(normalizeCharacterList([input], { sortBy: "modified" }).characters.map(({ id }) => id), ["10", "3", "2"]);
});

test("rejects contradictory requests and malformed upstream pages atomically", () => {
  assert.throws(() => validateCharacterListRequest({ level: 3, minLevel: 2 }), /cannot be combined/);
  assert.throws(() => validateCharacterListRequest({ minLevel: 5, maxLevel: 4 }), /greater/);
  assert.throws(() => validateCharacterListRequest({ names: ["   "] }), /empty/);
  assert.throws(() => validateCharacterListRequest({ campaignIds: ["not-an-id"] }), /decimal/);
  assert.throws(() => normalizeCharacterList([page([summary()]), page([{ id: 2 }])]), /summary shape/);
  assert.throws(() => normalizeCharacterList([page([summary()]), page([summary()])]), /duplicate/);
  assert.throws(() => normalizeCharacterList([{ success: true, data: [], pagination: null }]), /response shape/);
  assert.throws(() => normalizeCharacterList([page([summary({ lastModifiedDate: "invalid" })])]), /modification date/);
});

test("normalizes complete character detail and nullable portrait URL", () => {
  const portraitUrl = "https://www.dndbeyond.com/avatars/synthetic.jpeg?width=150";
  const result = normalizeCharacterDetail({
    id: 0,
    success: true,
    message: null,
    data: { id: 4242, name: "Synthetic Hero", decorations: { avatarUrl: portraitUrl }, nested: { retained: true } },
    pagination: null,
  }, "4242");
  assert.equal(result.portraitUrl, portraitUrl);
  assert.equal(result.character.nested.retained, true);
  assert.equal(normalizeCharacterDetail({ success: true, data: { id: 4242, decorations: null } }, "4242").portraitUrl, null);
});

test("preserves a large complete character payload without truncation", () => {
  const largeText = "x".repeat(512 * 1024);
  const result = normalizeCharacterDetail({
    success: true,
    data: { id: 4242, decorations: null, notes: { backstory: largeText } },
  }, "4242");
  assert.equal(result.character.notes.backstory.length, largeText.length);
});

test("rejects changed detail wrappers, ID mismatches, and malformed portrait URLs", () => {
  assert.throws(() => normalizeCharacterDetail({ data: { id: 4242 } }, "4242"), /response shape/);
  assert.throws(() => normalizeCharacterDetail({ success: true, data: { id: 7 } }, "4242"), /different ID/);
  assert.throws(() => normalizeCharacterDetail({ success: true, data: { id: 4242, decorations: { avatarUrl: 7 } } }, "4242"), /portrait URL/);
  assert.throws(() => normalizeCharacterDetail({ success: true, data: { id: 4242, decorations: { avatarUrl: "http://example.test/a.jpg" } } }, "4242"), /non-HTTPS/);
});

function portraitContext({ avatarUrl, bytes, mimeType = "image/jpeg", status = 200, headers = {}, responseUrl = avatarUrl }) {
  const pageObject = {
    goto: async () => {},
    waitForTimeout: async () => {},
    url: () => "https://www.dndbeyond.com",
    evaluate: async (_callback, argument) => argument === undefined
      ? true
      : { success: true, data: { id: Number(argument), decorations: { avatarUrl } } },
  };
  return {
    pages: () => [pageObject],
    request: {
      get: async () => ({
        ok: () => status >= 200 && status < 300,
        status: () => status,
        url: () => responseUrl,
        headers: () => ({ "content-type": mimeType, "content-length": String(bytes?.length ?? 0), ...headers }),
        body: async () => bytes ?? Buffer.alloc(0),
      }),
    },
  };
}

const imageCases = [
  ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00])],
  ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ["image/webp", Buffer.from("RIFF0000WEBP")],
  ["image/gif", Buffer.from("GIF89a")],
];

test("returns validated JPEG, PNG, WebP, and GIF portrait bytes", async () => {
  for (const [mimeType, bytes] of imageCases) {
    const result = await getCharacterPortrait(portraitContext({
      avatarUrl: `https://www.dndbeyond.com/avatars/synthetic.${mimeType.split("/")[1]}`,
      bytes,
      mimeType,
    }), "4242");
    assert.equal(result.metadata.available, true);
    assert.equal(result.metadata.mimeType, mimeType);
    assert.deepEqual(result.bytes, bytes);
  }
});

test("normalizes a supported but incorrect upstream MIME declaration from the image signature", async () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d", "hex");
  const result = await getCharacterPortrait(portraitContext({
    avatarUrl: "https://www.dndbeyond.com/avatar.png",
    bytes: png,
    mimeType: "image/jpeg",
  }), "4242");

  assert.equal(result.metadata.mimeType, "image/png");
  assert.deepEqual(result.bytes, png);
});

test("returns valid absence without fetching an image", async () => {
  let fetched = false;
  const context = portraitContext({ avatarUrl: null });
  context.request.get = async () => { fetched = true; throw new Error("must not fetch"); };
  const result = await getCharacterPortrait(context, "4242");
  assert.deepEqual(result.metadata, {
    characterId: "4242", available: false, portraitUrl: null, mimeType: null, byteCount: 0,
  });
  assert.equal(result.bytes, null);
  assert.equal(fetched, false);
});

test("rejects unsafe and invalid portrait responses", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  await assert.rejects(getCharacterPortrait(portraitContext({ avatarUrl: "https://example.test/avatar.jpg", bytes: jpeg }), "4242"), /unapproved host/);
  await assert.rejects(getCharacterPortrait(portraitContext({ avatarUrl: "https://www.dndbeyond.com/avatar.jpg", bytes: jpeg, status: 500 }), "4242"), /HTTP 500/);
  await assert.rejects(getCharacterPortrait(portraitContext({ avatarUrl: "https://www.dndbeyond.com/avatar.jpg", bytes: jpeg, mimeType: "text/html" }), "4242"), /non-image/);
  await assert.rejects(getCharacterPortrait(portraitContext({ avatarUrl: "https://www.dndbeyond.com/avatar.jpg", bytes: Buffer.from("wrong") }), "4242"), /recognized image signature/);
  await assert.rejects(getCharacterPortrait(portraitContext({
    avatarUrl: "https://www.dndbeyond.com/avatar.jpg",
    bytes: jpeg,
    status: 302,
    headers: { location: "https://example.test/redirected.jpg" },
  }), "4242"), /unapproved host/);
  await assert.rejects(getCharacterPortrait(portraitContext({
    avatarUrl: "https://www.dndbeyond.com/avatar.jpg",
    bytes: jpeg,
    headers: { "content-length": String(MAX_PORTRAIT_BYTES + 1) },
  }), "4242"), /5 MiB/);
  const oversized = Buffer.alloc(MAX_PORTRAIT_BYTES + 1);
  oversized.set([0xff, 0xd8, 0xff]);
  await assert.rejects(getCharacterPortrait(portraitContext({
    avatarUrl: "https://www.dndbeyond.com/avatar.jpg",
    bytes: oversized,
  }), "4242"), /5 MiB/);
});
