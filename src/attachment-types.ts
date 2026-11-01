/** Immutable private input. Names and content are untrusted task data. */
export type GoalAttachment = {
  id:string; projectId:string; name:string; size:number; mediaType:string; sha256:string;
  preview:{kind:'image'}|{kind:'text';excerpt:string;truncated:boolean}|{kind:'file';reason?:'unsupported'|'decode_failed'};
};
export type AttachmentContinuation = {id:string;at:string;note:string;attachments:GoalAttachment[];afterAttemptId?:string};
export const ATTACHMENT_FILE_LIMIT=10*1024*1024;
export const ATTACHMENT_TOTAL_LIMIT=32*1024*1024;
