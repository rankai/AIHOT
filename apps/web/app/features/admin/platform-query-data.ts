import { isSocialResearchOperation, socialQueryParameters } from "./social-research-data.ts";
import { isServiceResearchPlatform, serviceResearchParameters, type ServiceResearchParameters } from "./service-research-data.ts";
import { isResearchPlatform, researchQueryParameters } from "./research-platform-data.ts";
import { toutiaoQueryParameters } from "./toutiao-result-data.ts";
import { shipinhaoQueryParameters } from "./shipinhao-result-data.ts";
import { kuaishouQueryParameters } from "./kuaishou-result-data.ts";
import { instagramQueryParameters } from "./instagram-result-data.ts";
import { youtubeQueryParameters } from "./youtube-result-data.ts";
import { platformParameters, type PlatformOperation } from "./platform-types.ts";
/** Existing per-operation wire conversions, shared by one-off query and explicit collection drafts. */
export function platformQueryParameters(operation: PlatformOperation, values: Record<string, string>): ServiceResearchParameters {
  return isSocialResearchOperation(operation) ? socialQueryParameters(operation, values) : isServiceResearchPlatform(operation.platform) ? serviceResearchParameters(operation, values) : isResearchPlatform(operation.platform) ? researchQueryParameters(operation, values) : operation.platform === "toutiao" ? toutiaoQueryParameters(operation, values) : operation.platform === "shipinhao" ? shipinhaoQueryParameters(operation, values) : operation.platform === "kuaishou" ? kuaishouQueryParameters(operation, values) : operation.platform === "instagram" ? instagramQueryParameters(operation, values) : operation.platform === "youtube" ? youtubeQueryParameters(operation, values) : platformParameters(operation, values);
}
