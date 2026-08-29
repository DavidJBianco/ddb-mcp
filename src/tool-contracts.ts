import { z } from "zod";

const nullableString = z.string().nullable();
const searchAccessSchema = z.enum(["accessible", "unavailable", "unknown"]);
const editionSchema = z.enum(["5e", "5.5e"]).nullable();
const legacyFilterSchema = z.enum(["include", "exclude", "only"]);

export const libraryBookSchema = z.object({
  title: z.string(),
  slug: z.string(),
  ownership: z.string(),
  url: z.string(),
}).strict();

export const libraryEnvelopeSchema = z.object({
  count: z.number().int().nonnegative(),
  books: z.array(libraryBookSchema),
}).strict();

export const characterSummarySchema = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string(),
  level: z.number().int().nonnegative(),
  classDescription: z.string(),
  species: z.string(),
  campaign: z.object({
    id: z.string().regex(/^\d+$/),
    name: z.string(),
  }).strict().nullable(),
  status: z.number().int(),
  createdAt: z.iso.datetime(),
  modifiedAt: z.iso.datetime(),
}).strict();

export const characterListEnvelopeSchema = z.object({
  count: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  filters: z.object({
    names: z.array(z.string()),
    classes: z.array(z.string()),
    species: z.array(z.string()),
    campaignIds: z.array(z.string().regex(/^\d+$/)),
    level: z.number().int().nonnegative().nullable(),
    minLevel: z.number().int().nonnegative().nullable(),
    maxLevel: z.number().int().nonnegative().nullable(),
  }).strict(),
  sort: z.object({
    field: z.enum(["created", "name", "level", "modified"]),
    direction: z.enum(["asc", "desc"]),
  }).strict(),
  characters: z.array(characterSummarySchema),
}).strict();

export const characterDetailSchema = z.object({
  source: z.literal("dndbeyond-character-service"),
  schemaVersion: z.literal("v5"),
  portraitUrl: z.url().nullable(),
  character: z.record(z.string(), z.unknown()),
}).strict();

export const characterPortraitMetadataSchema = z.object({
  characterId: z.string().regex(/^\d+$/),
  available: z.boolean(),
  portraitUrl: z.url().nullable(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).nullable(),
  byteCount: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  const complete = value.available
    ? value.portraitUrl !== null && value.mimeType !== null && value.byteCount > 0
    : value.portraitUrl === null && value.mimeType === null && value.byteCount === 0;
  if (!complete) context.addIssue({ code: "custom", message: "Invalid character portrait metadata variant." });
});

export const campaignRoleSchema = z.enum(["dungeon_master", "player", "unknown"]);
export const campaignSortFieldSchema = z.enum(["name", "role", "created", "players", "content_sharing"]);
const campaignProvenanceSchema = z.enum([
  "campaign-details-v1",
  "active-short-characters",
  "rendered-dom",
  "derived",
]);

function campaignAvailabilitySchema<T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion("state", [
    z.object({
      state: z.literal("available"),
      value: valueSchema,
      provenance: campaignProvenanceSchema,
    }).strict(),
    z.object({
      state: z.literal("empty"),
      value: valueSchema,
      provenance: campaignProvenanceSchema,
    }).strict(),
    z.object({
      state: z.literal("unavailable"),
      value: z.null(),
      provenance: z.null(),
    }).strict(),
  ]);
}

export const campaignSummarySchema = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string(),
  role: campaignRoleSchema,
  createdOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  playerCount: z.number().int().nonnegative(),
  contentSharingEnabled: z.boolean(),
  url: z.url(),
}).strict();

export const campaignListEnvelopeSchema = z.object({
  count: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  filters: z.object({
    names: z.array(z.string()),
    campaignIds: z.array(z.string().regex(/^\d+$/)),
    roles: z.array(campaignRoleSchema),
    createdOnOrAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    createdOnOrBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    minPlayers: z.number().int().nonnegative().nullable(),
    maxPlayers: z.number().int().nonnegative().nullable(),
    contentSharingEnabled: z.boolean().nullable(),
  }).strict(),
  sort: z.object({
    field: campaignSortFieldSchema,
    direction: z.enum(["asc", "desc"]),
  }).strict(),
  campaigns: z.array(campaignSummarySchema),
}).strict();

const campaignDungeonMasterSchema = z.object({
  id: z.string().regex(/^\d+$/),
  displayName: z.string(),
}).strict();

const campaignSharingSchema = z.object({
  contentEnabled: z.boolean(),
  itemEnabled: z.boolean(),
}).strict();

const campaignPlayerSchema = z.object({
  id: z.string().regex(/^\d+$/),
  displayName: z.string(),
}).strict();

const campaignCharacterSchema = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string(),
  playerId: z.string().regex(/^\d+$/).nullable(),
  playerName: z.string().nullable(),
  isPrivate: z.boolean().nullable(),
  status: z.number().int().nullable(),
  isAssigned: z.boolean().nullable(),
  url: z.url(),
}).strict();

const campaignLinkSchema = z.object({
  kind: z.enum(["invite", "edit", "manage", "settings", "other"]),
  url: z.url(),
}).strict();

export const campaignDetailEnvelopeSchema = z.object({
  source: z.literal("dndbeyond-campaign"),
  schemaVersion: z.literal("v1"),
  partial: z.boolean(),
  campaign: z.object({
    id: z.string().regex(/^\d+$/),
    name: z.string(),
    url: z.url(),
    viewerRole: campaignRoleSchema,
    identityProvenance: campaignProvenanceSchema,
    status: campaignAvailabilitySchema(z.number().int()),
    createdAt: campaignAvailabilitySchema(z.iso.datetime()),
    dungeonMaster: campaignAvailabilitySchema(campaignDungeonMasterSchema),
    sharing: campaignAvailabilitySchema(campaignSharingSchema),
    players: campaignAvailabilitySchema(z.array(campaignPlayerSchema)),
    characters: campaignAvailabilitySchema(z.array(campaignCharacterSchema)),
    description: campaignAvailabilitySchema(z.string()),
    notes: z.object({
      public: campaignAvailabilitySchema(z.string()),
      private: campaignAvailabilitySchema(z.string()),
    }).strict(),
    links: z.object({
      canonical: z.url(),
      invite: campaignAvailabilitySchema(campaignLinkSchema),
      administration: campaignAvailabilitySchema(z.array(campaignLinkSchema)),
    }).strict(),
  }).strict(),
}).strict();

export const pageContentEnvelopeSchema = z.object({
  source: z.literal("dndbeyond-rendered-page"),
  schemaVersion: z.literal("v1"),
  operation: z.enum(["navigate", "current_page"]),
  requestedUrl: z.url().nullable(),
  page: z.object({
    url: z.url(),
    title: z.string(),
  }).strict(),
  text: z.string(),
  totalCharacters: z.number().int().nonnegative(),
  maxChars: z.number().int().positive().max(25_000),
  nextCursor: nullableString,
  done: z.boolean(),
}).strict().superRefine((value, context) => {
  if ((value.operation === "navigate") !== (value.requestedUrl !== null)) {
    context.addIssue({ code: "custom", message: "Invalid rendered-page operation and requested URL combination." });
  }
  if (value.done !== (value.nextCursor === null)) {
    context.addIssue({ code: "custom", message: "Invalid rendered-page cursor completion state." });
  }
});

export const pageScreenshotMetadataSchema = z.object({
  source: z.literal("dndbeyond-page-screenshot"),
  schemaVersion: z.literal("v1"),
  url: z.url(),
  title: z.string(),
  scope: z.enum(["viewport", "element"]),
  selector: nullableString,
  width: z.number().int().positive().max(4_096),
  height: z.number().int().positive().max(4_096),
  mimeType: z.literal("image/png"),
  byteCount: z.number().int().positive().max(5 * 1024 * 1024),
}).strict().superRefine((value, context) => {
  if ((value.scope === "viewport") !== (value.selector === null)) {
    context.addIssue({ code: "custom", message: "Invalid page screenshot scope and selector combination." });
  }
  if (value.width * value.height > 16_777_216) {
    context.addIssue({ code: "custom", message: "Page screenshot exceeds the maximum pixel count." });
  }
});

const sourceAttributionSchema = z.object({
  title: nullableString,
  url: nullableString,
  bookSlug: nullableString,
  chapterSlug: nullableString,
}).strict();

const monsterSearchMetadataSchema = z.object({
  source: nullableString,
  edition: editionSchema,
  legacy: z.boolean(),
  challengeRating: nullableString,
  type: nullableString,
  tags: z.array(z.string()),
  access: searchAccessSchema,
}).strict();

const ordinarySearchResultSchema = z.object({
  name: z.string(),
  type: z.string(),
  url: z.string(),
  sources: z.array(sourceAttributionSchema),
  creatureId: nullableString.optional(),
  monster: monsterSearchMetadataSchema.optional(),
}).strict();

const sourcebookSearchResultSchema = z.object({
  name: z.string(),
  type: z.literal("sourcebook"),
  url: z.string(),
  bookSlug: nullableString,
  access: searchAccessSchema,
  sources: z.tuple([]),
}).strict();

export const searchEnvelopeSchema = z.object({
  query: z.string(),
  category: z.enum(["spells", "monsters", "items", "races", "classes", "feats", "sourcebooks", "all"]),
  url: z.string(),
  count: z.number().int().nonnegative(),
  results: z.array(z.union([sourcebookSearchResultSchema, ordinarySearchResultSchema])),
}).strict();

const outlineEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  level: z.number().int(),
  parentId: nullableString,
  chapterSlug: z.string().optional(),
  url: z.string().optional(),
}).strict();

const imageMetadataSchema = z.object({
  id: z.string(),
  alt: z.string(),
  caption: z.string(),
  url: z.string(),
}).strict();

const outlineResultSchema = z.object({
  kind: z.literal("outline"),
  book: z.object({ slug: z.string(), title: z.string().optional() }).strict(),
  scope: z.union([
    z.object({ bookSlug: z.string(), title: z.string() }).strict(),
    z.object({ chapterSlug: z.string(), title: z.string() }).strict(),
  ]),
  url: z.string(),
  entries: z.array(outlineEntrySchema),
  nextCursor: z.null(),
  done: z.literal(true),
}).strict();

const contentResultSchema = z.object({
  kind: z.literal("content"),
  book: z.object({ slug: z.string() }).strict(),
  chapter: z.object({ slug: z.string(), title: z.string(), url: z.string() }).strict(),
  section: outlineEntrySchema.optional(),
  text: z.string(),
  images: z.array(imageMetadataSchema),
  nextCursor: nullableString,
  done: z.boolean(),
  maxChars: z.number().int().positive(),
  serverMaxChars: z.number().int().positive(),
}).strict();

const readBookResultUnion = z.discriminatedUnion("kind", [outlineResultSchema, contentResultSchema]);

export const readBookResultSchema = z.object({
  kind: z.enum(["outline", "content"]),
  book: z.object({ slug: z.string(), title: z.string().optional() }).strict(),
  scope: z.union([
    z.object({ bookSlug: z.string(), title: z.string() }).strict(),
    z.object({ chapterSlug: z.string(), title: z.string() }).strict(),
  ]).optional(),
  chapter: z.object({ slug: z.string(), title: z.string(), url: z.string() }).strict().optional(),
  section: outlineEntrySchema.optional(),
  url: z.string().optional(),
  entries: z.array(outlineEntrySchema).optional(),
  text: z.string().optional(),
  images: z.array(imageMetadataSchema).optional(),
  nextCursor: nullableString,
  done: z.boolean(),
  maxChars: z.number().int().positive().optional(),
  serverMaxChars: z.number().int().positive().optional(),
}).strict().superRefine((value, context) => {
  const parsed = readBookResultUnion.safeParse(value);
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: "Invalid sourcebook result variant." });
  }
});

export const statBlockCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  source: nullableString,
  edition: editionSchema,
  legacy: z.boolean(),
  challengeRating: nullableString,
  type: nullableString,
  tags: z.array(z.string()),
  access: searchAccessSchema,
  accessFailure: z.string().optional(),
}).strict();

const statBlockAttributeSchema = z.object({ label: z.string(), value: z.string() }).strict();
const statBlockAbilitySchema = z.object({
  name: z.string(),
  score: z.number().int().nullable(),
  modifier: nullableString,
  save: nullableString,
}).strict();
const statBlockEntrySchema = z.object({ name: nullableString, text: z.string() }).strict();
const statBlockSectionSchema = z.object({
  title: z.string(),
  kind: z.string(),
  entries: z.array(statBlockEntrySchema),
}).strict();

export const statBlockSchema = z.object({
  kind: z.literal("stat_block"),
  creature: z.object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    source: nullableString,
    edition: editionSchema,
    legacy: z.boolean(),
    size: nullableString,
    type: nullableString,
    alignment: nullableString,
    tags: z.array(z.string()),
    challengeRating: nullableString,
  }).strict(),
  attributes: z.array(statBlockAttributeSchema),
  abilities: z.array(statBlockAbilitySchema),
  sections: z.array(statBlockSectionSchema),
  markdown: z.string(),
}).strict();

const statBlockCandidatesSchema = z.object({
  kind: z.literal("candidates"),
  query: z.string(),
  normalizedQuery: z.string(),
  legacy: legacyFilterSchema,
  candidates: z.array(statBlockCandidateSchema),
}).strict();
const statBlockNotFoundSchema = z.object({
  kind: z.literal("not_found"),
  query: z.string(),
  normalizedQuery: z.string(),
  legacy: legacyFilterSchema,
  candidates: z.tuple([]),
}).strict();
const statBlockResolvedSchema = z.object({
  kind: z.literal("resolved"),
  query: nullableString,
  normalizedQuery: nullableString,
  legacy: legacyFilterSchema,
  candidate: statBlockCandidateSchema,
}).strict();

const statBlockResultUnion = z.discriminatedUnion("kind", [
  statBlockSchema,
  statBlockCandidatesSchema,
  statBlockNotFoundSchema,
]);
const statBlockResolutionUnion = z.discriminatedUnion("kind", [
  statBlockResolvedSchema,
  statBlockCandidatesSchema,
  statBlockNotFoundSchema,
]);

const statBlockResultObjectSchema = z.object({
  kind: z.enum(["stat_block", "candidates", "not_found"]),
  creature: statBlockSchema.shape.creature.optional(),
  attributes: z.array(statBlockAttributeSchema).optional(),
  abilities: z.array(statBlockAbilitySchema).optional(),
  sections: z.array(statBlockSectionSchema).optional(),
  markdown: z.string().optional(),
  query: z.string().optional(),
  normalizedQuery: z.string().optional(),
  legacy: legacyFilterSchema.optional(),
  candidates: z.array(statBlockCandidateSchema).optional(),
}).strict();

export const statBlockResultSchema = statBlockResultObjectSchema.superRefine((value, context) => {
  if (!statBlockResultUnion.safeParse(value).success) {
    context.addIssue({ code: "custom", message: "Invalid stat-block result variant." });
  }
});

const statBlockResolutionObjectSchema = z.object({
  kind: z.enum(["resolved", "candidates", "not_found"]),
  query: nullableString,
  normalizedQuery: nullableString,
  legacy: legacyFilterSchema,
  candidate: statBlockCandidateSchema.optional(),
  candidates: z.array(statBlockCandidateSchema).optional(),
}).strict();

export const statBlockResolutionSchema = statBlockResolutionObjectSchema.superRefine((value, context) => {
  if (!statBlockResolutionUnion.safeParse(value).success) {
    context.addIssue({ code: "custom", message: "Invalid stat-block resolution variant." });
  }
});
