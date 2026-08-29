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
export declare const characterSummarySchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    level: z.ZodNumber;
    classDescription: z.ZodString;
    species: z.ZodString;
    campaign: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
    }, z.core.$strict>>;
    status: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    modifiedAt: z.ZodISODateTime;
}, z.core.$strict>;
export declare const characterListEnvelopeSchema: z.ZodObject<{
    count: z.ZodNumber;
    total: z.ZodNumber;
    filters: z.ZodObject<{
        names: z.ZodArray<z.ZodString>;
        classes: z.ZodArray<z.ZodString>;
        species: z.ZodArray<z.ZodString>;
        campaignIds: z.ZodArray<z.ZodString>;
        level: z.ZodNullable<z.ZodNumber>;
        minLevel: z.ZodNullable<z.ZodNumber>;
        maxLevel: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strict>;
    sort: z.ZodObject<{
        field: z.ZodEnum<{
            name: "name";
            level: "level";
            created: "created";
            modified: "modified";
        }>;
        direction: z.ZodEnum<{
            desc: "desc";
            asc: "asc";
        }>;
    }, z.core.$strict>;
    characters: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        level: z.ZodNumber;
        classDescription: z.ZodString;
        species: z.ZodString;
        campaign: z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
        }, z.core.$strict>>;
        status: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        modifiedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const characterDetailSchema: z.ZodObject<{
    source: z.ZodLiteral<"dndbeyond-character-service">;
    schemaVersion: z.ZodLiteral<"v5">;
    portraitUrl: z.ZodNullable<z.ZodURL>;
    character: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strict>;
export declare const characterPortraitMetadataSchema: z.ZodObject<{
    characterId: z.ZodString;
    available: z.ZodBoolean;
    portraitUrl: z.ZodNullable<z.ZodURL>;
    mimeType: z.ZodNullable<z.ZodEnum<{
        "image/jpeg": "image/jpeg";
        "image/png": "image/png";
        "image/webp": "image/webp";
        "image/gif": "image/gif";
    }>>;
    byteCount: z.ZodNumber;
}, z.core.$strict>;
export declare const campaignRoleSchema: z.ZodEnum<{
    unknown: "unknown";
    dungeon_master: "dungeon_master";
    player: "player";
}>;
export declare const campaignSortFieldSchema: z.ZodEnum<{
    name: "name";
    created: "created";
    role: "role";
    players: "players";
    content_sharing: "content_sharing";
}>;
export declare const campaignSummarySchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    role: z.ZodEnum<{
        unknown: "unknown";
        dungeon_master: "dungeon_master";
        player: "player";
    }>;
    createdOn: z.ZodString;
    playerCount: z.ZodNumber;
    contentSharingEnabled: z.ZodBoolean;
    url: z.ZodURL;
}, z.core.$strict>;
export declare const campaignListEnvelopeSchema: z.ZodObject<{
    count: z.ZodNumber;
    total: z.ZodNumber;
    filters: z.ZodObject<{
        names: z.ZodArray<z.ZodString>;
        campaignIds: z.ZodArray<z.ZodString>;
        roles: z.ZodArray<z.ZodEnum<{
            unknown: "unknown";
            dungeon_master: "dungeon_master";
            player: "player";
        }>>;
        createdOnOrAfter: z.ZodNullable<z.ZodString>;
        createdOnOrBefore: z.ZodNullable<z.ZodString>;
        minPlayers: z.ZodNullable<z.ZodNumber>;
        maxPlayers: z.ZodNullable<z.ZodNumber>;
        contentSharingEnabled: z.ZodNullable<z.ZodBoolean>;
    }, z.core.$strict>;
    sort: z.ZodObject<{
        field: z.ZodEnum<{
            name: "name";
            created: "created";
            role: "role";
            players: "players";
            content_sharing: "content_sharing";
        }>;
        direction: z.ZodEnum<{
            desc: "desc";
            asc: "asc";
        }>;
    }, z.core.$strict>;
    campaigns: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        role: z.ZodEnum<{
            unknown: "unknown";
            dungeon_master: "dungeon_master";
            player: "player";
        }>;
        createdOn: z.ZodString;
        playerCount: z.ZodNumber;
        contentSharingEnabled: z.ZodBoolean;
        url: z.ZodURL;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const campaignDetailEnvelopeSchema: z.ZodObject<{
    source: z.ZodLiteral<"dndbeyond-campaign">;
    schemaVersion: z.ZodLiteral<"v1">;
    partial: z.ZodBoolean;
    campaign: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        url: z.ZodURL;
        viewerRole: z.ZodEnum<{
            unknown: "unknown";
            dungeon_master: "dungeon_master";
            player: "player";
        }>;
        identityProvenance: z.ZodEnum<{
            "campaign-details-v1": "campaign-details-v1";
            "active-short-characters": "active-short-characters";
            "rendered-dom": "rendered-dom";
            derived: "derived";
        }>;
        status: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"available">;
            value: z.ZodNumber;
            provenance: z.ZodEnum<{
                "campaign-details-v1": "campaign-details-v1";
                "active-short-characters": "active-short-characters";
                "rendered-dom": "rendered-dom";
                derived: "derived";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"empty">;
            value: z.ZodNumber;
            provenance: z.ZodEnum<{
                "campaign-details-v1": "campaign-details-v1";
                "active-short-characters": "active-short-characters";
                "rendered-dom": "rendered-dom";
                derived: "derived";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unavailable">;
            value: z.ZodNull;
            provenance: z.ZodNull;
        }, z.core.$strict>], "state">;
        createdAt: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"available">;
            value: z.ZodISODateTime;
            provenance: z.ZodEnum<{
                "campaign-details-v1": "campaign-details-v1";
                "active-short-characters": "active-short-characters";
                "rendered-dom": "rendered-dom";
                derived: "derived";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"empty">;
            value: z.ZodISODateTime;
            provenance: z.ZodEnum<{
                "campaign-details-v1": "campaign-details-v1";
                "active-short-characters": "active-short-characters";
                "rendered-dom": "rendered-dom";
                derived: "derived";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unavailable">;
            value: z.ZodNull;
            provenance: z.ZodNull;
        }, z.core.$strict>], "state">;
        dungeonMaster: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"available">;
            value: z.ZodObject<{
                id: z.ZodString;
                displayName: z.ZodString;
            }, z.core.$strict>;
            provenance: z.ZodEnum<{
                "campaign-details-v1": "campaign-details-v1";
                "active-short-characters": "active-short-characters";
                "rendered-dom": "rendered-dom";
                derived: "derived";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"empty">;
            value: z.ZodObject<{
                id: z.ZodString;
                displayName: z.ZodString;
            }, z.core.$strict>;
            provenance: z.ZodEnum<{
                "campaign-details-v1": "campaign-details-v1";
                "active-short-characters": "active-short-characters";
                "rendered-dom": "rendered-dom";
                derived: "derived";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unavailable">;
            value: z.ZodNull;
            provenance: z.ZodNull;
        }, z.core.$strict>], "state">;
        sharing: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"available">;
            value: z.ZodObject<{
                contentEnabled: z.ZodBoolean;
                itemEnabled: z.ZodBoolean;
            }, z.core.$strict>;
            provenance: z.ZodEnum<{
                "campaign-details-v1": "campaign-details-v1";
                "active-short-characters": "active-short-characters";
                "rendered-dom": "rendered-dom";
                derived: "derived";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"empty">;
            value: z.ZodObject<{
                contentEnabled: z.ZodBoolean;
                itemEnabled: z.ZodBoolean;
            }, z.core.$strict>;
            provenance: z.ZodEnum<{
                "campaign-details-v1": "campaign-details-v1";
                "active-short-characters": "active-short-characters";
                "rendered-dom": "rendered-dom";
                derived: "derived";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unavailable">;
            value: z.ZodNull;
            provenance: z.ZodNull;
        }, z.core.$strict>], "state">;
        players: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"available">;
            value: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                displayName: z.ZodString;
            }, z.core.$strict>>;
            provenance: z.ZodEnum<{
                "campaign-details-v1": "campaign-details-v1";
                "active-short-characters": "active-short-characters";
                "rendered-dom": "rendered-dom";
                derived: "derived";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"empty">;
            value: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                displayName: z.ZodString;
            }, z.core.$strict>>;
            provenance: z.ZodEnum<{
                "campaign-details-v1": "campaign-details-v1";
                "active-short-characters": "active-short-characters";
                "rendered-dom": "rendered-dom";
                derived: "derived";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unavailable">;
            value: z.ZodNull;
            provenance: z.ZodNull;
        }, z.core.$strict>], "state">;
        characters: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"available">;
            value: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                playerId: z.ZodNullable<z.ZodString>;
                playerName: z.ZodNullable<z.ZodString>;
                isPrivate: z.ZodNullable<z.ZodBoolean>;
                status: z.ZodNullable<z.ZodNumber>;
                isAssigned: z.ZodNullable<z.ZodBoolean>;
                url: z.ZodURL;
            }, z.core.$strict>>;
            provenance: z.ZodEnum<{
                "campaign-details-v1": "campaign-details-v1";
                "active-short-characters": "active-short-characters";
                "rendered-dom": "rendered-dom";
                derived: "derived";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"empty">;
            value: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                playerId: z.ZodNullable<z.ZodString>;
                playerName: z.ZodNullable<z.ZodString>;
                isPrivate: z.ZodNullable<z.ZodBoolean>;
                status: z.ZodNullable<z.ZodNumber>;
                isAssigned: z.ZodNullable<z.ZodBoolean>;
                url: z.ZodURL;
            }, z.core.$strict>>;
            provenance: z.ZodEnum<{
                "campaign-details-v1": "campaign-details-v1";
                "active-short-characters": "active-short-characters";
                "rendered-dom": "rendered-dom";
                derived: "derived";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unavailable">;
            value: z.ZodNull;
            provenance: z.ZodNull;
        }, z.core.$strict>], "state">;
        description: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"available">;
            value: z.ZodString;
            provenance: z.ZodEnum<{
                "campaign-details-v1": "campaign-details-v1";
                "active-short-characters": "active-short-characters";
                "rendered-dom": "rendered-dom";
                derived: "derived";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"empty">;
            value: z.ZodString;
            provenance: z.ZodEnum<{
                "campaign-details-v1": "campaign-details-v1";
                "active-short-characters": "active-short-characters";
                "rendered-dom": "rendered-dom";
                derived: "derived";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unavailable">;
            value: z.ZodNull;
            provenance: z.ZodNull;
        }, z.core.$strict>], "state">;
        notes: z.ZodObject<{
            public: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"available">;
                value: z.ZodString;
                provenance: z.ZodEnum<{
                    "campaign-details-v1": "campaign-details-v1";
                    "active-short-characters": "active-short-characters";
                    "rendered-dom": "rendered-dom";
                    derived: "derived";
                }>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"empty">;
                value: z.ZodString;
                provenance: z.ZodEnum<{
                    "campaign-details-v1": "campaign-details-v1";
                    "active-short-characters": "active-short-characters";
                    "rendered-dom": "rendered-dom";
                    derived: "derived";
                }>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unavailable">;
                value: z.ZodNull;
                provenance: z.ZodNull;
            }, z.core.$strict>], "state">;
            private: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"available">;
                value: z.ZodString;
                provenance: z.ZodEnum<{
                    "campaign-details-v1": "campaign-details-v1";
                    "active-short-characters": "active-short-characters";
                    "rendered-dom": "rendered-dom";
                    derived: "derived";
                }>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"empty">;
                value: z.ZodString;
                provenance: z.ZodEnum<{
                    "campaign-details-v1": "campaign-details-v1";
                    "active-short-characters": "active-short-characters";
                    "rendered-dom": "rendered-dom";
                    derived: "derived";
                }>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unavailable">;
                value: z.ZodNull;
                provenance: z.ZodNull;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        links: z.ZodObject<{
            canonical: z.ZodURL;
            invite: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"available">;
                value: z.ZodObject<{
                    kind: z.ZodEnum<{
                        invite: "invite";
                        edit: "edit";
                        manage: "manage";
                        settings: "settings";
                        other: "other";
                    }>;
                    url: z.ZodURL;
                }, z.core.$strict>;
                provenance: z.ZodEnum<{
                    "campaign-details-v1": "campaign-details-v1";
                    "active-short-characters": "active-short-characters";
                    "rendered-dom": "rendered-dom";
                    derived: "derived";
                }>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"empty">;
                value: z.ZodObject<{
                    kind: z.ZodEnum<{
                        invite: "invite";
                        edit: "edit";
                        manage: "manage";
                        settings: "settings";
                        other: "other";
                    }>;
                    url: z.ZodURL;
                }, z.core.$strict>;
                provenance: z.ZodEnum<{
                    "campaign-details-v1": "campaign-details-v1";
                    "active-short-characters": "active-short-characters";
                    "rendered-dom": "rendered-dom";
                    derived: "derived";
                }>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unavailable">;
                value: z.ZodNull;
                provenance: z.ZodNull;
            }, z.core.$strict>], "state">;
            administration: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"available">;
                value: z.ZodArray<z.ZodObject<{
                    kind: z.ZodEnum<{
                        invite: "invite";
                        edit: "edit";
                        manage: "manage";
                        settings: "settings";
                        other: "other";
                    }>;
                    url: z.ZodURL;
                }, z.core.$strict>>;
                provenance: z.ZodEnum<{
                    "campaign-details-v1": "campaign-details-v1";
                    "active-short-characters": "active-short-characters";
                    "rendered-dom": "rendered-dom";
                    derived: "derived";
                }>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"empty">;
                value: z.ZodArray<z.ZodObject<{
                    kind: z.ZodEnum<{
                        invite: "invite";
                        edit: "edit";
                        manage: "manage";
                        settings: "settings";
                        other: "other";
                    }>;
                    url: z.ZodURL;
                }, z.core.$strict>>;
                provenance: z.ZodEnum<{
                    "campaign-details-v1": "campaign-details-v1";
                    "active-short-characters": "active-short-characters";
                    "rendered-dom": "rendered-dom";
                    derived: "derived";
                }>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unavailable">;
                value: z.ZodNull;
                provenance: z.ZodNull;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const pageContentEnvelopeSchema: z.ZodObject<{
    source: z.ZodLiteral<"dndbeyond-rendered-page">;
    schemaVersion: z.ZodLiteral<"v1">;
    operation: z.ZodEnum<{
        navigate: "navigate";
        current_page: "current_page";
    }>;
    requestedUrl: z.ZodNullable<z.ZodURL>;
    page: z.ZodObject<{
        url: z.ZodURL;
        title: z.ZodString;
    }, z.core.$strict>;
    text: z.ZodString;
    totalCharacters: z.ZodNumber;
    maxChars: z.ZodNumber;
    nextCursor: z.ZodNullable<z.ZodString>;
    done: z.ZodBoolean;
}, z.core.$strict>;
export declare const pageScreenshotMetadataSchema: z.ZodObject<{
    source: z.ZodLiteral<"dndbeyond-page-screenshot">;
    schemaVersion: z.ZodLiteral<"v1">;
    url: z.ZodURL;
    title: z.ZodString;
    scope: z.ZodEnum<{
        viewport: "viewport";
        element: "element";
    }>;
    selector: z.ZodNullable<z.ZodString>;
    width: z.ZodNumber;
    height: z.ZodNumber;
    mimeType: z.ZodLiteral<"image/png">;
    byteCount: z.ZodNumber;
}, z.core.$strict>;
export declare const searchEnvelopeSchema: z.ZodObject<{
    query: z.ZodString;
    category: z.ZodEnum<{
        classes: "classes";
        spells: "spells";
        monsters: "monsters";
        items: "items";
        races: "races";
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