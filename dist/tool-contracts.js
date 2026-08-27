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
//# sourceMappingURL=tool-contracts.js.map