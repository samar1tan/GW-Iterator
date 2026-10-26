import type {RoleProfile,Stage,Pipeline} from '../../src/contracts';
export type RemoteAgent = {id:string;name:string;description?:string;instructions?:string;runtime_id?:string;model?:string;thinking_level?:string;service_tier?:string;skill_ids?:string[];skills?:RemoteSkill[];status?:string;runtime_availability?:string;runtime_bound?:boolean;mcpConfigured?:boolean;runtimeConfigured?:boolean;permissionManaged?:boolean};
export type RemoteSkill = {id:string;name:string;description?:string};
export type RemoteRuntime = {id:string;name?:string;display_name?:string;runtime_type?:string;status?:string;provider?:string;profile_id?:string;metadata?:Record<string,unknown>};
export type RemoteMcp = {id:string;name:string;transport:string;enabled?:boolean;agent_count?:number};
export type TeamData = {roles:RoleProfile[];agents:RemoteAgent[];skills:RemoteSkill[];runtimes:RemoteRuntime[];connection:{connected:boolean;error?:string};revision:number;projectAgentIds?:string[];immutableAgentIds?:string[];mcpServers?:RemoteMcp[];capabilities?:{steer:boolean;pauseDispatch:boolean}};
export type PlatformStage = Stage & {position?:{x:number;y:number};inputs?:string[];outputs?:string[];checks?:string[];condition?:{stageId:string;outcome:'done'|'no_change'|'revise'|'blocked'}};
export type PlatformPipeline = Omit<Pipeline,'stages'> & {stages:PlatformStage[]};
export type PlatformRole = RoleProfile & {inputs?:string[];outputs?:string[];checks?:string[];multica?:{agentId?:string;runtimeId?:string;skillIds?:string[];mcpServerIds?:string[]}};
