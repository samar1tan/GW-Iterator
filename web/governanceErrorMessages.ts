import type {MessageKey} from './locales/en';
import {APIError} from './api';

export const governanceErrorKeys:Record<string,MessageKey>={
  RUNTIME_EXECUTION_POLICY_REQUIRED:'runtimeExecutionUpdateRequired',
  KNOWLEDGE_CONTEXT_REQUIRED:'knowledgePreparationError',KNOWLEDGE_METADATA_OVERFLOW:'knowledgeMetadataError',KNOWLEDGE_REFERENCE_CHANGED:'knowledgeVersionError',KNOWLEDGE_LOCATION_CHANGED:'knowledgeLocationError',KNOWLEDGE_SCOPE:'knowledgeScopeError',KNOWLEDGE_NOT_FOUND:'knowledgeEntryError',INVALID_KNOWLEDGE_REFERENCE:'knowledgeVersionError',INVALID_KNOWLEDGE_CURSOR:'knowledgeQueryError',INVALID_KNOWLEDGE_QUERY:'knowledgeQueryError',INVALID_KNOWLEDGE_FEEDBACK:'knowledgeFeedbackError',INVALID_KNOWLEDGE_RELATIONSHIP:'knowledgeRelationshipError',LESSON_REVIEW_REQUIRED:'knowledgeReviewError',INVALID_LESSON_REVIEW:'knowledgeReviewInputError',LESSON_REQUIRED:'knowledgeRetainedError',
  TEMPLATE_PREVIEW_STALE:'templateStaleError',TEMPLATE_PREVIEW_NOT_FOUND:'templateStaleError',TEMPLATE_NOT_FOUND:'templateMissingError',TEMPLATE_RETIRED:'templateRetiredError',TEMPLATE_PREVIEW_BLOCKED:'templateBlockedError',TEMPLATE_SOURCE_MISSING:'templateSourceError',INVALID_TEMPLATE_RESOLUTION:'templateResolutionError',INVALID_TEMPLATE_TARGET:'templateTargetError',INVALID_TEMPLATE_REQUIREMENTS:'templateRequirementsInputError',TEMPLATE_APPLY_FAILED:'templateApplyError',
};
export function governanceError(message:string|undefined,code?:string):unknown{return message&&code&&governanceErrorKeys[code]?new APIError(409,code,message):message;}
