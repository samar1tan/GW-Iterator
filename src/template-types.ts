import type {Actor,ControlTool,Effort,Pipeline,Project,RoleProfile,RunPolicy,Stage} from './contracts.ts';

export type TemplateKind='role'|'pipeline';
export type TemplateRef={id:string;revision:number;hash:string};
export type DefinitionOrigin=
  | {kind:'builtin';key:string;revision:number}
  | {kind:'manual';actor:string;at:string}
  | {kind:'copy';projectId:string;objectId:string;revision:number}
  | {kind:'adoption';adoptionId:string;revision:number}
  | {kind:'template';template:TemplateRef}
  | {kind:'import';actor:string;at:string}
  | {kind:'proposal';proposalId:string;runId?:string};
export type TemplateRequirements={sandbox?:RoleProfile['sandbox'];tools?:ControlTool[]};
export type RoleTemplateDefinition={kind:'role';name:string;description:string;instructions:string;inputs?:string[];outputs?:string[];checks?:string[];model?:string|null;effort?:Effort;requirements?:TemplateRequirements};
export type TemplateStage=Omit<Stage,'roleId'|'options'|'position'>&{roleSlot:string;bindingSlot?:string;githubMode?:'observe'|'dispatch'};
export type PipelineTemplateDefinition={kind:'pipeline';name:string;description:string;ownerRoleSlot:string;roleSlots:{id:string;name:string;requirements?:TemplateRequirements}[];stages:TemplateStage[];bindingSlots:{id:string;kind:'pipeline'|'github'}[];policy:RunPolicy};
export type TemplateDefinition=RoleTemplateDefinition|PipelineTemplateDefinition;
export type TemplateHead={id:string;kind:TemplateKind;name:string;purpose:string;useWhen?:string;avoidWhen?:string;latestRevision:number;recordRevision:number;status:'active'|'retired';updatedAt:string};
export type TemplateRevision={id:string;templateId:string;revision:number;hash:string;kind:TemplateKind;definition:TemplateDefinition;purpose:string;useWhen?:string;avoidWhen?:string;changeSummary:string;origin:DefinitionOrigin;createdAt:string};
export type TemplateTarget={kind:TemplateKind;id:string};
export type TemplateMappings={roles:Record<string,string>;external:Record<string,NonNullable<Stage['options']>>};
export type ProjectTemplateBinding={id:string;revision:number;projectId:string;target:TemplateTarget;template:TemplateRef;baseline:TemplateDefinition;mappings:TemplateMappings;projectOwnedPaths:string[];appliedAt:string};
export type TemplateSource={projectId:string;kind:TemplateKind;id:string;expectedProjectRevision:number;expectedPipelineRevision?:number};
export type CreateTemplateInput={source:TemplateSource;definition?:TemplateDefinition;purpose?:string;useWhen?:string;avoidWhen?:string;changeSummary?:string;idempotencyKey:string};
export type ReviseTemplateInput={expectedRecordRevision:number;definition:TemplateDefinition;purpose?:string;useWhen?:string;avoidWhen?:string;changeSummary:string;idempotencyKey:string};
export type RetireTemplateInput={expectedRecordRevision:number;retired:boolean};
export type TemplateConflictChoice='project'|'template';
export type TemplateChange={path:string;kind:'add'|'change'|'remove';base?:unknown;project?:unknown;template?:unknown;resolution:'project'|'template'|'unchanged'|'unresolved';conflict:boolean};
export type TemplateCheck={code:string;status:'passed'|'blocked';slot?:string;path?:string};
export type PreviewTemplateInput={template:{id:string;revision:number};target?:TemplateTarget;expectedProjectRevision:number;expectedPipelineRevision?:number;mappings?:Partial<TemplateMappings>;resolutions?:Record<string,TemplateConflictChoice>;releaseOwnedPaths?:string[]};
export type TemplateChangePreview={id:string;projectId:string;key:string;state:'ready'|'conflicts'|'blocked';target:TemplateTarget;template:TemplateRef;expectedProjectRevision:number;expectedPipelineRevision?:number;expectedBindingRevision?:number;candidate:RoleProfile|Pipeline;binding:ProjectTemplateBinding;changes:TemplateChange[];checks:TemplateCheck[];input:PreviewTemplateInput;createdAt:string};
export type ApplyTemplateInput={previewKey:string;idempotencyKey:string};
export type TemplateChangeReceipt={id:string;projectId:string;previewId:string;target:TemplateTarget;template:TemplateRef;binding:ProjectTemplateBinding;project:Project;pipeline?:Pipeline;appliedAt:string};
export type DefinitionCheckpoint<T>=(saved:T)=>void;
export type DefinitionMutation={origin?:DefinitionOrigin;bindingId?:string;managed?:boolean};
export type ProjectDefinitionMutation={roleOrigins?:Record<string,DefinitionOrigin>;roleBindingIds?:Record<string,string|undefined>;managed?:boolean};
export type TemplateRoleWriter=(projectId:string,expectedRevision:number,value:Partial<RoleProfile>,actor:Actor,roleId?:string,checkpoint?:DefinitionCheckpoint<Project>,mutation?:DefinitionMutation)=>Promise<Project>;
