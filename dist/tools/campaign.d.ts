import type { BrowserContext } from "playwright";
import { z } from "zod";
import { campaignDetailEnvelopeSchema, campaignListEnvelopeSchema, campaignRoleSchema, campaignSortFieldSchema } from "../tool-contracts.js";
export type CampaignRole = z.infer<typeof campaignRoleSchema>;
export type CampaignSortField = z.infer<typeof campaignSortFieldSchema>;
export type CampaignSortDirection = "asc" | "desc";
export type CampaignListResult = z.infer<typeof campaignListEnvelopeSchema>;
export type CampaignDetailResult = z.infer<typeof campaignDetailEnvelopeSchema>;
export interface CampaignListRequest {
    names?: string[];
    campaignIds?: string[];
    roles?: CampaignRole[];
    createdOnOrAfter?: string;
    createdOnOrBefore?: string;
    minPlayers?: number;
    maxPlayers?: number;
    contentSharingEnabled?: boolean;
    sortBy?: CampaignSortField;
    sortDirection?: CampaignSortDirection;
}
export interface CampaignDetailRequest {
    includePrivateNotes?: boolean;
    includeInviteLink?: boolean;
    includeAdministrationLinks?: boolean;
}
interface ExtractedCampaignListItem {
    id: string;
    name: string;
    roleText: string;
    createdText: string;
    playerCountText: string;
    sharingText: string;
}
interface ExtractedCampaignList {
    recognized: boolean;
    items: ExtractedCampaignListItem[];
}
export declare function validateCampaignListRequest(request: CampaignListRequest): void;
export declare function normalizeCampaignList(extracted: ExtractedCampaignList, request?: CampaignListRequest): CampaignListResult;
export declare function listMyCampaigns(context: BrowserContext, request?: CampaignListRequest): Promise<CampaignListResult>;
export declare function getCampaign(context: BrowserContext, campaignId: string, request?: CampaignDetailRequest): Promise<CampaignDetailResult>;
export {};
//# sourceMappingURL=campaign.d.ts.map