import { z } from "zod";
import { getPage, isLoggedIn } from "../browser.js";
import { campaignDetailEnvelopeSchema, campaignListEnvelopeSchema, campaignRoleSchema, campaignSortFieldSchema, } from "../tool-contracts.js";
import { AuthenticationRequiredError, throwIfAuthenticationRedirect } from "../session-state.js";
import { cachedMetadata } from "./metadata-cache.js";
import { openDomReadyPage, waitForRenderedContent } from "./page-readiness.js";
const DDB_ORIGIN = "https://www.dndbeyond.com";
const CAMPAIGN_DETAILS_ORIGIN = "https://api.dndbeyond.com";
const CAMPAIGN_TIMEOUT_MS = 30_000;
const CAMPAIGN_RESPONSE_TIMEOUT_MS = 15_000;
export const CAMPAIGN_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
const upstreamCampaignDetailsSchema = z.object({
    data: z.object({
        activeCharacters: z.array(z.object({
            id: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
            isPrivate: z.boolean(),
            name: z.string(),
            userId: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
        }).passthrough()),
        activePlayers: z.array(z.object({
            displayName: z.string(),
            id: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
        }).passthrough()),
        contentSharingEnabled: z.boolean(),
        dateCreated: z.string(),
        dmDisplayName: z.string(),
        dmId: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
        id: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
        itemSharingEnabled: z.boolean(),
        name: z.string(),
        status: z.number().int(),
    }).passthrough(),
}).passthrough();
const upstreamShortCharactersSchema = z.object({
    data: z.array(z.object({
        characterStatus: z.number().int(),
        id: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
        isAssigned: z.boolean(),
        name: z.string(),
        userId: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
        userName: z.string(),
    }).passthrough()),
    status: z.string(),
}).passthrough();
function normalizeText(value) {
    return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}
function canonicalValues(values, label) {
    if (!values)
        return [];
    return values.map((value) => {
        const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
        if (!normalized)
            throw new Error(`${label} filters cannot contain empty values.`);
        return normalized;
    });
}
function numericId(value, label) {
    const id = String(value);
    if (!/^\d+$/.test(id))
        throw new Error(`Campaign data contained an invalid ${label}.`);
    return id;
}
function compareNumericIds(left, right) {
    const normalizedLeft = left.replace(/^0+(?=\d)/, "");
    const normalizedRight = right.replace(/^0+(?=\d)/, "");
    return normalizedLeft.length - normalizedRight.length || normalizedLeft.localeCompare(normalizedRight);
}
function validateIsoDate(value, label) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new Error(`${label} must use YYYY-MM-DD.`);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new Error(`${label} must be a real calendar date.`);
    }
    return value;
}
function normalizeRenderedDate(value) {
    const text = value.normalize("NFKC").trim();
    const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
    if (iso)
        return validateIsoDate(iso, "Campaign creation date");
    const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (us) {
        const [, month, day, year] = us;
        return validateIsoDate(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`, "Campaign creation date");
    }
    throw new Error("Campaign list contained an unrecognized creation date.");
}
function normalizeDateTime(value) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp))
        throw new Error("Campaign details contained an invalid creation date.");
    return new Date(timestamp).toISOString();
}
function normalizeRole(value) {
    const role = normalizeText(value.replace(/^role:\s*/i, ""));
    if (role.includes("dungeon master") || role === "dm")
        return "dungeon_master";
    if (role.includes("player"))
        return "player";
    return "unknown";
}
function normalizePlayerCount(value) {
    const matched = value.match(/\d+/)?.[0];
    if (!matched)
        throw new Error("Campaign list contained an invalid player count.");
    return Number(matched);
}
function normalizeSharing(value) {
    const sharing = normalizeText(value);
    if (/disabled|not\s+enabled|inactive|\boff\b/.test(sharing))
        return false;
    if (/enabled|active|\bon\b/.test(sharing))
        return true;
    throw new Error("Campaign list contained an unrecognized content-sharing state.");
}
function canonicalCampaignUrl(id) {
    return `${DDB_ORIGIN}/campaigns/${id}`;
}
export function validateCampaignListRequest(request) {
    canonicalValues(request.names, "Name");
    for (const id of request.campaignIds ?? []) {
        if (!/^\d+$/.test(id))
            throw new Error("Campaign IDs must contain only decimal digits.");
    }
    for (const role of request.roles ?? [])
        campaignRoleSchema.parse(role);
    const after = request.createdOnOrAfter === undefined
        ? undefined
        : validateIsoDate(request.createdOnOrAfter, "created_on_or_after");
    const before = request.createdOnOrBefore === undefined
        ? undefined
        : validateIsoDate(request.createdOnOrBefore, "created_on_or_before");
    if (after && before && after > before) {
        throw new Error("created_on_or_after cannot be later than created_on_or_before.");
    }
    for (const [label, value] of [["min_players", request.minPlayers], ["max_players", request.maxPlayers]]) {
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
            throw new Error(`${label} must be a non-negative integer.`);
        }
    }
    if (request.minPlayers !== undefined && request.maxPlayers !== undefined && request.minPlayers > request.maxPlayers) {
        throw new Error("min_players cannot be greater than max_players.");
    }
    if (request.sortBy !== undefined)
        campaignSortFieldSchema.parse(request.sortBy);
    if (request.sortDirection !== undefined && !["asc", "desc"].includes(request.sortDirection)) {
        throw new Error("sort_direction must be asc or desc.");
    }
}
export function normalizeCampaignList(extracted, request = {}) {
    validateCampaignListRequest(request);
    if (!extracted.recognized)
        throw new Error("D&D Beyond campaign-list structure was not recognized.");
    const campaigns = extracted.items.map((item) => {
        const id = numericId(item.id, "campaign ID");
        const name = item.name.normalize("NFKC").trim().replace(/\s+/g, " ");
        if (!name)
            throw new Error("Campaign list contained an empty campaign name.");
        return {
            id,
            name,
            role: normalizeRole(item.roleText),
            createdOn: normalizeRenderedDate(item.createdText),
            playerCount: normalizePlayerCount(item.playerCountText),
            contentSharingEnabled: normalizeSharing(item.sharingText),
            url: canonicalCampaignUrl(id),
        };
    });
    const seen = new Set();
    for (const campaign of campaigns) {
        if (seen.has(campaign.id))
            throw new Error("Campaign list contained a duplicate campaign ID.");
        seen.add(campaign.id);
    }
    const names = canonicalValues(request.names, "Name");
    const campaignIds = request.campaignIds ?? [];
    const roles = request.roles ?? [];
    const normalizedNames = names.map(normalizeText);
    const filtered = campaigns.filter((campaign) => {
        if (normalizedNames.length > 0 && !normalizedNames.some((name) => normalizeText(campaign.name).includes(name)))
            return false;
        if (campaignIds.length > 0 && !campaignIds.includes(campaign.id))
            return false;
        if (roles.length > 0 && !roles.includes(campaign.role))
            return false;
        if (request.createdOnOrAfter !== undefined && campaign.createdOn < request.createdOnOrAfter)
            return false;
        if (request.createdOnOrBefore !== undefined && campaign.createdOn > request.createdOnOrBefore)
            return false;
        if (request.minPlayers !== undefined && campaign.playerCount < request.minPlayers)
            return false;
        if (request.maxPlayers !== undefined && campaign.playerCount > request.maxPlayers)
            return false;
        if (request.contentSharingEnabled !== undefined && campaign.contentSharingEnabled !== request.contentSharingEnabled)
            return false;
        return true;
    });
    const field = request.sortBy ?? "name";
    const direction = request.sortDirection ?? "asc";
    filtered.sort((left, right) => {
        let primary = 0;
        if (field === "name")
            primary = normalizeText(left.name).localeCompare(normalizeText(right.name), "en-US");
        if (field === "role")
            primary = left.role.localeCompare(right.role);
        if (field === "created")
            primary = left.createdOn.localeCompare(right.createdOn);
        if (field === "players")
            primary = left.playerCount - right.playerCount;
        if (field === "content_sharing")
            primary = Number(left.contentSharingEnabled) - Number(right.contentSharingEnabled);
        if (primary !== 0)
            return direction === "asc" ? primary : -primary;
        const nameTie = normalizeText(left.name).localeCompare(normalizeText(right.name), "en-US");
        return nameTie || compareNumericIds(left.id, right.id);
    });
    return campaignListEnvelopeSchema.parse({
        count: filtered.length,
        total: campaigns.length,
        filters: {
            names,
            campaignIds: [...campaignIds],
            roles: [...roles],
            createdOnOrAfter: request.createdOnOrAfter ?? null,
            createdOnOrBefore: request.createdOnOrBefore ?? null,
            minPlayers: request.minPlayers ?? null,
            maxPlayers: request.maxPlayers ?? null,
            contentSharingEnabled: request.contentSharingEnabled ?? null,
        },
        sort: { field, direction },
        campaigns: filtered,
    });
}
export async function listMyCampaigns(context, request = {}) {
    validateCampaignListRequest(request);
    const currentPage = await getPage(context);
    if (!(await isLoggedIn(currentPage)))
        throw new AuthenticationRequiredError();
    const extracted = (await cachedMetadata(context, "campaign-summaries", CAMPAIGN_LIST_CACHE_TTL_MS, async () => {
        const page = await getPage(context);
        await openDomReadyPage(page, `${DDB_ORIGIN}/my-campaigns`, CAMPAIGN_TIMEOUT_MS);
        throwIfAuthenticationRedirect(page);
        await waitForRenderedContent(page, "li.ddb-campaigns-list-item-wrapper, main", CAMPAIGN_RESPONSE_TIMEOUT_MS);
        return page.evaluate(() => {
            const items = Array.from(document.querySelectorAll("li.ddb-campaigns-list-item-wrapper"));
            const unknownListItems = items.length === 0 && document.querySelectorAll("main ul li").length > 0;
            const recognized = items.length > 0 || (!unknownListItems && Boolean(document.querySelector("main ul"))) ||
                /no campaigns/i.test(document.querySelector("main")?.textContent ?? "");
            return {
                recognized,
                items: items.map((element) => {
                    const links = Array.from(element.querySelectorAll("a[href]"));
                    const canonical = links.find((link) => /^\/campaigns\/\d+\/?$/.test(new URL(link.href).pathname));
                    const id = canonical?.href.match(/\/campaigns\/(\d+)/)?.[1] ?? "";
                    return {
                        id,
                        name: element.querySelector(".ddb-campaigns-list-item-body-title")?.textContent?.trim() ?? "",
                        roleText: element.querySelector(".ddb-campaigns-list-item-body-role")?.textContent?.trim() ?? "",
                        createdText: element.querySelector(".ddb-campaigns-list-item-body-date")?.textContent?.trim() ?? "",
                        playerCountText: element.querySelector(".player-count, .ddb-campaigns-list-item-body-players .count")?.textContent?.trim() ?? "",
                        sharingText: element.querySelector(".ddb-campaigns-list-item-body-sharing")?.textContent?.trim() ?? "",
                    };
                }),
            };
        });
    }, { refresh: request.refresh })).value;
    return normalizeCampaignList(extracted, request);
}
function isCampaignResponse(response, origin, path) {
    try {
        const url = new URL(response.url());
        return url.origin === origin && url.pathname === path;
    }
    catch {
        return false;
    }
}
async function waitForOptionalResponse(page, origin, path) {
    try {
        return await page.waitForResponse((response) => isCampaignResponse(response, origin, path), {
            timeout: CAMPAIGN_RESPONSE_TIMEOUT_MS,
        });
    }
    catch {
        return null;
    }
}
async function responseJson(response) {
    if (!response)
        return null;
    if (response.status() === 401 || response.status() === 403)
        throw new AuthenticationRequiredError();
    if (!response.ok())
        return null;
    try {
        return await response.json();
    }
    catch {
        return null;
    }
}
function unavailable() {
    return { state: "unavailable", value: null, provenance: null };
}
function populated(value, provenance) {
    const empty = (typeof value === "string" && value.length === 0) || (Array.isArray(value) && value.length === 0);
    return { state: empty ? "empty" : "available", value, provenance };
}
function renderedSection(section) {
    return section.present ? populated(section.text, "rendered-dom") : unavailable();
}
function safeDdbUrl(value) {
    try {
        const url = new URL(value);
        if (url.origin !== DDB_ORIGIN || url.username || url.password || url.protocol !== "https:")
            return null;
        return url;
    }
    catch {
        return null;
    }
}
function campaignLinkKind(marker) {
    const normalized = normalizeText(marker);
    if (normalized.includes("edit"))
        return "edit";
    if (normalized.includes("manage"))
        return "manage";
    if (normalized.includes("setting"))
        return "settings";
    return "other";
}
export async function getCampaign(context, campaignId, request = {}) {
    if (!/^\d+$/.test(campaignId))
        throw new Error("Campaign ID must contain only decimal digits.");
    const includePrivateNotes = request.includePrivateNotes ?? true;
    const includeInviteLink = request.includeInviteLink ?? false;
    const includeAdministrationLinks = request.includeAdministrationLinks ?? false;
    const page = await getPage(context);
    if (!(await isLoggedIn(page)))
        throw new AuthenticationRequiredError();
    const detailPath = `/campaigns/v1/details/${campaignId}`;
    const shortCharactersPath = `/api/campaign/stt/active-short-characters/${campaignId}`;
    const detailsPromise = waitForOptionalResponse(page, CAMPAIGN_DETAILS_ORIGIN, detailPath);
    const shortCharactersPromise = waitForOptionalResponse(page, DDB_ORIGIN, shortCharactersPath);
    await openDomReadyPage(page, canonicalCampaignUrl(campaignId), CAMPAIGN_TIMEOUT_MS);
    throwIfAuthenticationRedirect(page);
    await waitForRenderedContent(page, "h1.page-title, .ddb-campaigns-detail", CAMPAIGN_RESPONSE_TIMEOUT_MS);
    const [detailsEnvelope, shortEnvelope] = await Promise.all([
        detailsPromise.then(responseJson),
        shortCharactersPromise.then(responseJson),
    ]);
    const dom = await page.evaluate(({ includePrivateNotes, includeInviteLink, includeAdministrationLinks }) => {
        const textSection = (selector) => {
            const element = document.querySelector(selector);
            return { present: Boolean(element), text: element?.textContent?.normalize("NFKC").trim().replace(/\s+/g, " ") ?? "" };
        };
        const characterCards = Array.from(document.querySelectorAll("li.ddb-campaigns-character-card-wrapper"));
        const characters = characterCards.flatMap((element) => {
            const link = element.querySelector("a[href*='/characters/']");
            const id = link?.href.match(/\/characters\/(\d+)/)?.[1];
            if (!id)
                return [];
            return [{
                    id,
                    name: element.querySelector(".ddb-campaigns-character-card-header-upper-character-info-primary")?.textContent?.trim() ?? "",
                }];
        });
        let inviteUrl = null;
        if (includeInviteLink) {
            const invite = document.querySelector(".ddb-campaigns-invite-container [data-clipboard-text], .ddb-campaigns-invite-wrapper [data-clipboard-text], .ddb-campaigns-invite-container a[href]");
            inviteUrl = invite?.getAttribute("data-clipboard-text") ?? (invite instanceof HTMLAnchorElement ? invite.href : null);
        }
        const administrationLinks = [];
        if (includeAdministrationLinks) {
            document.querySelectorAll("a[href]").forEach((node) => {
                const link = node;
                const marker = `${link.pathname} ${link.className} ${link.getAttribute("aria-label") ?? ""}`.toLocaleLowerCase("en-US");
                if (!link.pathname.startsWith("/campaigns/"))
                    return;
                if (!/edit|manage|setting/.test(marker))
                    return;
                if (/deactivate|delete|remove|reset|leave/.test(marker))
                    return;
                if (link.hasAttribute("data-confirm-message"))
                    return;
                administrationLinks.push({ marker, url: link.href });
            });
        }
        const currentUser = document.querySelector(".user-role-registered-users[data-userid], [data-userid][user-avatar]");
        const dmControlsVisible = Boolean(document.querySelector(".ddb-campaigns-detail-body-dm-notes-private, .ddb-campaigns-invite-wrapper, [class*='campaign'][class*='deactivate']"));
        return {
            name: document.querySelector("h1.page-title, h1")?.textContent?.normalize("NFKC").trim().replace(/\s+/g, " ") ?? "",
            currentUserId: currentUser?.getAttribute("data-userid")?.match(/^\d+$/)?.[0] ?? null,
            dmControlsVisible,
            description: textSection(".ddb-campaigns-detail-header-secondary-description, .ddb-campaigns-detail > p"),
            publicNotes: textSection(".ddb-campaigns-detail-body-dm-notes-public"),
            privateNotes: includePrivateNotes
                ? textSection(".ddb-campaigns-detail-body-dm-notes-private")
                : { present: false, text: "" },
            characterSectionPresent: Boolean(document.querySelector(".ddb-campaigns-detail-body-listing, .RPGCampaignCharacter-listing, li.ddb-campaigns-character-card-wrapper")),
            characters,
            inviteUrl,
            administrationLinks,
        };
    }, { includePrivateNotes, includeInviteLink, includeAdministrationLinks });
    const parsedDetails = upstreamCampaignDetailsSchema.safeParse(detailsEnvelope);
    const details = parsedDetails.success && numericId(parsedDetails.data.data.id, "campaign ID") === campaignId
        ? parsedDetails.data.data
        : null;
    const parsedShort = upstreamShortCharactersSchema.safeParse(shortEnvelope);
    const shortCharacters = parsedShort.success ? parsedShort.data.data : null;
    const structuredName = details?.name.normalize("NFKC").trim().replace(/\s+/g, " ") ?? "";
    if (structuredName && dom.name && normalizeText(structuredName) !== normalizeText(dom.name)) {
        throw new Error("Campaign identity did not match the rendered page.");
    }
    const name = structuredName || dom.name;
    if (!name)
        throw new Error("D&D Beyond campaign page did not expose a campaign name.");
    const detailsDmId = details ? numericId(details.dmId, "dungeon master ID") : null;
    let viewerRole = "unknown";
    if (detailsDmId && dom.currentUserId)
        viewerRole = detailsDmId === dom.currentUserId ? "dungeon_master" : "player";
    else if (dom.dmControlsVisible)
        viewerRole = "dungeon_master";
    const players = details?.activePlayers.map((player) => ({
        id: numericId(player.id, "player ID"),
        displayName: player.displayName.normalize("NFKC").trim().replace(/\s+/g, " "),
    })).sort((left, right) => normalizeText(left.displayName).localeCompare(normalizeText(right.displayName), "en-US") || compareNumericIds(left.id, right.id));
    const playerById = new Map((players ?? []).map((player) => [player.id, player.displayName]));
    const detailsCharacters = new Map((details?.activeCharacters ?? []).map((character) => [numericId(character.id, "character ID"), character]));
    const shortById = new Map((shortCharacters ?? []).map((character) => [numericId(character.id, "character ID"), character]));
    const characters = dom.characters.map((visible) => {
        const detail = detailsCharacters.get(visible.id);
        const short = shortById.get(visible.id);
        const playerId = detail ? numericId(detail.userId, "player ID") : short ? numericId(short.userId, "player ID") : null;
        return {
            id: visible.id,
            name: visible.name || detail?.name.normalize("NFKC").trim() || short?.name.normalize("NFKC").trim() || "",
            playerId,
            playerName: playerId ? playerById.get(playerId) ?? short?.userName.normalize("NFKC").trim() ?? null : null,
            isPrivate: detail?.isPrivate ?? null,
            status: short?.characterStatus ?? null,
            isAssigned: short?.isAssigned ?? null,
            url: `${DDB_ORIGIN}/characters/${visible.id}`,
        };
    });
    let invite = unavailable();
    if (includeInviteLink && dom.inviteUrl) {
        const url = safeDdbUrl(dom.inviteUrl);
        if (url && /\/campaigns\/(?:join|invite)(?:\/|$)/.test(url.pathname)) {
            invite = populated({ kind: "invite", url: url.href }, "rendered-dom");
        }
    }
    const administration = includeAdministrationLinks
        ? populated([...new Map(dom.administrationLinks.flatMap((candidate) => {
                const url = safeDdbUrl(candidate.url);
                if (!url || !url.pathname.startsWith("/campaigns/") || /deactivate|delete|remove|reset|leave/i.test(url.pathname))
                    return [];
                const value = { kind: campaignLinkKind(candidate.marker), url: url.href };
                return [[`${value.kind}:${value.url}`, value]];
            })).values()], "rendered-dom")
        : unavailable();
    const result = {
        source: "dndbeyond-campaign",
        schemaVersion: "v1",
        partial: details === null || (dom.characters.length > 0 && shortCharacters === null),
        campaign: {
            id: campaignId,
            name,
            url: canonicalCampaignUrl(campaignId),
            viewerRole,
            identityProvenance: details ? "campaign-details-v1" : "rendered-dom",
            status: details ? populated(details.status, "campaign-details-v1") : unavailable(),
            createdAt: details ? populated(normalizeDateTime(details.dateCreated), "campaign-details-v1") : unavailable(),
            dungeonMaster: details ? populated({
                id: detailsDmId,
                displayName: details.dmDisplayName.normalize("NFKC").trim().replace(/\s+/g, " "),
            }, "campaign-details-v1") : unavailable(),
            sharing: details ? populated({
                contentEnabled: details.contentSharingEnabled,
                itemEnabled: details.itemSharingEnabled,
            }, "campaign-details-v1") : unavailable(),
            players: players ? populated(players, "campaign-details-v1") : unavailable(),
            characters: dom.characterSectionPresent ? populated(characters, details ? "campaign-details-v1" : "rendered-dom") : unavailable(),
            description: renderedSection(dom.description),
            notes: {
                public: renderedSection(dom.publicNotes),
                private: includePrivateNotes ? renderedSection(dom.privateNotes) : unavailable(),
            },
            links: {
                canonical: canonicalCampaignUrl(campaignId),
                invite,
                administration,
            },
        },
    };
    return campaignDetailEnvelopeSchema.parse(result);
}
//# sourceMappingURL=campaign.js.map