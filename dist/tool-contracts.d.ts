import { z } from "zod";
export declare const libraryBookSchema: z.ZodObject<{
    title: z.ZodString;
    slug: z.ZodString;
    ownership: z.ZodString;
    url: z.ZodString;
}, z.core.$strict>;
export declare const libraryEnvelopeSchema: z.ZodObject<{
    count: z.ZodNumber;
    books: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        slug: z.ZodString;
        ownership: z.ZodString;
        url: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const searchEnvelopeSchema: z.ZodObject<{
    query: z.ZodString;
    category: z.ZodEnum<{
        spells: "spells";
        monsters: "monsters";
        items: "items";
        races: "races";
        classes: "classes";
        feats: "feats";
        sourcebooks: "sourcebooks";
        all: "all";
    }>;
    url: z.ZodString;
    count: z.ZodNumber;
    results: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        name: z.ZodString;
        type: z.ZodLiteral<"sourcebook">;
        url: z.ZodString;
        bookSlug: z.ZodNullable<z.ZodString>;
        access: z.ZodEnum<{
            accessible: "accessible";
            unavailable: "unavailable";
            unknown: "unknown";
        }>;
        sources: z.ZodTuple<[], null>;
    }, z.core.$strict>, z.ZodObject<{
        name: z.ZodString;
        type: z.ZodString;
        url: z.ZodString;
        sources: z.ZodArray<z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            url: z.ZodNullable<z.ZodString>;
            bookSlug: z.ZodNullable<z.ZodString>;
            chapterSlug: z.ZodNullable<z.ZodString>;
        }, z.core.$strict>>;
        creatureId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        monster: z.ZodOptional<z.ZodObject<{
            source: z.ZodNullable<z.ZodString>;
            edition: z.ZodNullable<z.ZodEnum<{
                "5e": "5e";
                "5.5e": "5.5e";
            }>>;
            legacy: z.ZodBoolean;
            challengeRating: z.ZodNullable<z.ZodString>;
            type: z.ZodNullable<z.ZodString>;
            tags: z.ZodArray<z.ZodString>;
            access: z.ZodEnum<{
                accessible: "accessible";
                unavailable: "unavailable";
                unknown: "unknown";
            }>;
        }, z.core.$strict>>;
    }, z.core.$strict>]>>;
}, z.core.$strict>;
export declare const readBookResultSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        outline: "outline";
        content: "content";
    }>;
    book: z.ZodObject<{
        slug: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    scope: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
        bookSlug: z.ZodString;
        title: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        chapterSlug: z.ZodString;
        title: z.ZodString;
    }, z.core.$strict>]>>;
    chapter: z.ZodOptional<z.ZodObject<{
        slug: z.ZodString;
        title: z.ZodString;
        url: z.ZodString;
    }, z.core.$strict>>;
    section: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        level: z.ZodNumber;
        parentId: z.ZodNullable<z.ZodString>;
        chapterSlug: z.ZodOptional<z.ZodString>;
        url: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    url: z.ZodOptional<z.ZodString>;
    entries: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        level: z.ZodNumber;
        parentId: z.ZodNullable<z.ZodString>;
        chapterSlug: z.ZodOptional<z.ZodString>;
        url: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
    text: z.ZodOptional<z.ZodString>;
    images: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        alt: z.ZodString;
        caption: z.ZodString;
        url: z.ZodString;
    }, z.core.$strict>>>;
    nextCursor: z.ZodNullable<z.ZodString>;
    done: z.ZodBoolean;
    maxChars: z.ZodOptional<z.ZodNumber>;
    serverMaxChars: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const statBlockCandidateSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    url: z.ZodString;
    source: z.ZodNullable<z.ZodString>;
    edition: z.ZodNullable<z.ZodEnum<{
        "5e": "5e";
        "5.5e": "5.5e";
    }>>;
    legacy: z.ZodBoolean;
    challengeRating: z.ZodNullable<z.ZodString>;
    type: z.ZodNullable<z.ZodString>;
    tags: z.ZodArray<z.ZodString>;
    access: z.ZodEnum<{
        accessible: "accessible";
        unavailable: "unavailable";
        unknown: "unknown";
    }>;
    accessFailure: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const statBlockSchema: z.ZodObject<{
    kind: z.ZodLiteral<"stat_block">;
    creature: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        url: z.ZodString;
        source: z.ZodNullable<z.ZodString>;
        edition: z.ZodNullable<z.ZodEnum<{
            "5e": "5e";
            "5.5e": "5.5e";
        }>>;
        legacy: z.ZodBoolean;
        size: z.ZodNullable<z.ZodString>;
        type: z.ZodNullable<z.ZodString>;
        alignment: z.ZodNullable<z.ZodString>;
        tags: z.ZodArray<z.ZodString>;
        challengeRating: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
    attributes: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        value: z.ZodString;
    }, z.core.$strict>>;
    abilities: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        score: z.ZodNullable<z.ZodNumber>;
        modifier: z.ZodNullable<z.ZodString>;
        save: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    sections: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        kind: z.ZodString;
        entries: z.ZodArray<z.ZodObject<{
            name: z.ZodNullable<z.ZodString>;
            text: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    markdown: z.ZodString;
}, z.core.$strict>;
export declare const statBlockResultSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        stat_block: "stat_block";
        candidates: "candidates";
        not_found: "not_found";
    }>;
    creature: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        url: z.ZodString;
        source: z.ZodNullable<z.ZodString>;
        edition: z.ZodNullable<z.ZodEnum<{
            "5e": "5e";
            "5.5e": "5.5e";
        }>>;
        legacy: z.ZodBoolean;
        size: z.ZodNullable<z.ZodString>;
        type: z.ZodNullable<z.ZodString>;
        alignment: z.ZodNullable<z.ZodString>;
        tags: z.ZodArray<z.ZodString>;
        challengeRating: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    attributes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        value: z.ZodString;
    }, z.core.$strict>>>;
    abilities: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        score: z.ZodNullable<z.ZodNumber>;
        modifier: z.ZodNullable<z.ZodString>;
        save: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>>;
    sections: z.ZodOptional<z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        kind: z.ZodString;
        entries: z.ZodArray<z.ZodObject<{
            name: z.ZodNullable<z.ZodString>;
            text: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>>;
    markdown: z.ZodOptional<z.ZodString>;
    query: z.ZodOptional<z.ZodString>;
    normalizedQuery: z.ZodOptional<z.ZodString>;
    legacy: z.ZodOptional<z.ZodEnum<{
        include: "include";
        exclude: "exclude";
        only: "only";
    }>>;
    candidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        url: z.ZodString;
        source: z.ZodNullable<z.ZodString>;
        edition: z.ZodNullable<z.ZodEnum<{
            "5e": "5e";
            "5.5e": "5.5e";
        }>>;
        legacy: z.ZodBoolean;
        challengeRating: z.ZodNullable<z.ZodString>;
        type: z.ZodNullable<z.ZodString>;
        tags: z.ZodArray<z.ZodString>;
        access: z.ZodEnum<{
            accessible: "accessible";
            unavailable: "unavailable";
            unknown: "unknown";
        }>;
        accessFailure: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const statBlockResolutionSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        candidates: "candidates";
        not_found: "not_found";
        resolved: "resolved";
    }>;
    query: z.ZodNullable<z.ZodString>;
    normalizedQuery: z.ZodNullable<z.ZodString>;
    legacy: z.ZodEnum<{
        include: "include";
        exclude: "exclude";
        only: "only";
    }>;
    candidate: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        url: z.ZodString;
        source: z.ZodNullable<z.ZodString>;
        edition: z.ZodNullable<z.ZodEnum<{
            "5e": "5e";
            "5.5e": "5.5e";
        }>>;
        legacy: z.ZodBoolean;
        challengeRating: z.ZodNullable<z.ZodString>;
        type: z.ZodNullable<z.ZodString>;
        tags: z.ZodArray<z.ZodString>;
        access: z.ZodEnum<{
            accessible: "accessible";
            unavailable: "unavailable";
            unknown: "unknown";
        }>;
        accessFailure: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    candidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        url: z.ZodString;
        source: z.ZodNullable<z.ZodString>;
        edition: z.ZodNullable<z.ZodEnum<{
            "5e": "5e";
            "5.5e": "5.5e";
        }>>;
        legacy: z.ZodBoolean;
        challengeRating: z.ZodNullable<z.ZodString>;
        type: z.ZodNullable<z.ZodString>;
        tags: z.ZodArray<z.ZodString>;
        access: z.ZodEnum<{
            accessible: "accessible";
            unavailable: "unavailable";
            unknown: "unknown";
        }>;
        accessFailure: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
//# sourceMappingURL=tool-contracts.d.ts.map