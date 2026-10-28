import {execFile, spawn} from 'node:child_process';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {isAbsolute, resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {budgetTokens} from '../contracts.ts';
import {ACCOUNT_ALLOWANCE_TTL_MS,normalizeAccountObservation,unavailableAccountObservation} from '../account-allowance.ts';
import type {AccountAllowanceObservation} from '../account-allowance-types.ts';
import type {ControlTool, CodexInfo, ExecutionRef, ModelInfo, TaskOutput, Usage} from '../contracts.ts';
import type {AdapterEvent, CodexAdapter, CodexExecution, CodexExecutionInput, CodexGoalExecution, CodexGoalInput, CodexGoalResult, CodexNativeGoal} from './types.ts';

type JsonObject = Record<string, unknown>;
type RpcId = string | number;
export type CodexProcess = Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr' | 'once' | 'on' | 'kill'>;
export type CodexAdapterOptions = {
  binary?: string;
  defaultModel?: string;
  launch?: (binary: string) => CodexProcess;
  getVersion?: (binary: string) => Promise<string | undefined>;
  requestTimeoutMs?: number;
  interruptGraceMs?: number;
};
type PendingRequest = {resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>};
type ExecutionBoundary = 'dispatching' | 'not_dispatched' | 'terminal';
type StartupBoundary = {paidRequestSent: boolean; ref?: ExecutionRef};
type Message = {text: string; phase?: string; complete: boolean};
type ExecutionState = {
  kind: 'task';
  input: CodexExecutionInput; tools: Set<ControlTool>; ref: ExecutionRef;
  completion: CodexExecution['completion']; resolve: (value: {output: TaskOutput; usage?: Usage}) => void;
  reject: (error: Error) => void; messages: Map<string, Message>; usage?: Usage;
  toolEnd: Promise<never>; endTools: (error: Error) => void;
  settled: boolean; stopError?: Error; interrupting?: Promise<void>; timer?: ReturnType<typeof setTimeout>;
  stopTimer?: ReturnType<typeof setTimeout>; abort: () => void;
  boundary?: ExecutionBoundary; dispatchObserved?: boolean;
};
type GoalState = {
  kind: 'goal'; input: CodexGoalInput; tools: Set<ControlTool>; ref: ExecutionRef;
  completion: Promise<CodexGoalResult>; resolve: (value: CodexGoalResult) => void; reject: (error: Error) => void;
  toolEnd: Promise<never>; endTools: (error: Error) => void;
  settled: boolean; ending: boolean; setting: boolean; stopError?: Error; finalError?: Error; activeTurns: Set<string>; interrupting: Set<string>;
  goal?: CodexNativeGoal; clearConfirmed: boolean; cleanup?: Promise<void>; terminalStatus?: CodexGoalResult['status'];
  summary: string; terminalSummary?: string; timer?: ReturnType<typeof setTimeout>; stopTimer?: ReturnType<typeof setTimeout>;
  consecutiveFailedTurns: number; completedTurns: Set<string>; lastTurnError?: string;
  abort: () => void; usage?: Usage;
  boundary?: ExecutionBoundary; activationConfirmed?: boolean; dispatchObserved?: boolean;
};
type OwnedState = ExecutionState | GoalState;

const MAX_LINE_LENGTH = 8 * 1024 * 1024;
const MAX_OUTPUT_LENGTH = 2 * 1024 * 1024;
const stringProperty = {type: 'string'};
const pipelineProperty = {type: 'object', additionalProperties: true};
const stringArray = {type: 'array', items: stringProperty};
export const TOOL_DEFINITIONS: Record<ControlTool, {description: string; properties: JsonObject; required: string[]}> = {
  'project.bootstrap': {description: 'Record a proposed project configuration after read-only inspection. Knowledge kinds are document or artifact, as shown in the inspected manifest; they are not file. A validation rejection may be corrected once before reporting blocked. Applying the proposal is a separate owner action.', properties: {proposal: {type: 'object', additionalProperties: false, properties: {name:stringProperty,description:stringProperty,repository:stringProperty,rationale:stringProperty,roles:{type:'array',items:{type:'object',additionalProperties:false,properties:{id:stringProperty,instructions:stringProperty},required:['id','instructions']}},knowledgeSources:{type:'array',items:{type:'object',additionalProperties:false,properties:{path:stringProperty,kind:{type:'string',enum:['document','artifact']},roles:stringArray},required:['path','roles']}},pipelines:{type:'array',minItems:1,maxItems:4,items:{type:'object',additionalProperties:true}}},required:['name','description','repository','rationale','roles','knowledgeSources','pipelines']}, sources:stringArray}, required:['proposal','sources']},
  'intake.route': {description: 'Record the next bounded action for this supervised request: answer an informational question without child work, dispatch existing pipelines, retry an owned failed stage, complete from verified outcomes, ask a question, or stop. A read-only answer does not certify artifact delivery. Record concise reasons and expected benefit, not private reasoning.', properties: {action: {type:'string',enum:['answer','dispatch','retry','complete','clarify','stop']}, rationale:stringProperty,expectedGain:stringProperty,tasks:{type:'array',items:{type:'object',properties:{pipelineId:stringProperty,goal:stringProperty},required:['pipelineId','goal'],additionalProperties:false}},response:stringProperty,question:stringProperty,retry:{type:'object',properties:{runId:stringProperty,stageId:stringProperty,note:stringProperty},required:['runId','stageId','note'],additionalProperties:false}}, required:['action','rationale','expectedGain','tasks']},
  'context.read': {description: 'Read the current project and originating run context.', properties: {}, required: []},
  'knowledge.search': {description: 'Search task-relevant passages in this execution\'s frozen project corpus. Refine or translate the query during this ordinary task when lexical terms do not overlap. Hits include exact locators. To read a passage and its continuation, pass its complete locator in read instead of a query; no filesystem path is accepted. format v2 returns search coverage/cursor metadata.', properties: {query: stringProperty, role: stringProperty, kind: stringProperty,read:{type:'object',properties:{corpusId:stringProperty,entryId:stringProperty,revision:{type:'integer'},hash:stringProperty,chunkId:stringProperty,headingPath:stringArray,startLine:{type:'integer'},endLine:{type:'integer'},startOffset:{type:'integer'},endOffset:{type:'integer'}},required:['corpusId','entryId','revision','hash','chunkId','startLine','endLine'],additionalProperties:false},cursor:stringProperty,format:{type:'string',enum:['v2']}}, required: []},
  'knowledge.write': {description: 'Propose a reusable lesson for owner review, or record evidence-linked knowledge feedback. This capability does not make an agent lesson current or change frozen context, ranking or permissions.', properties: {title: stringProperty, content: stringProperty, roles: stringArray,feedback:{type:'object',additionalProperties:true}}, required: []},
  'pipeline.read': {description: 'Read one current-project pipeline, or list its pipelines.', properties: {pipelineId: stringProperty}, required: []},
  'pipeline.propose': {description: 'Propose a revised current-project pipeline with its expected revision and rationale.', properties: {pipelineId: stringProperty, expectedRevision: {type: 'integer'}, definition: pipelineProperty, rationale: stringProperty}, required: ['pipelineId', 'expectedRevision', 'definition', 'rationale']},
  'pipeline.write': {description: 'Update an authorized current-project pipeline using its expected revision.', properties: {pipelineId: stringProperty, expectedRevision: {type: 'integer'}, definition: pipelineProperty}, required: ['pipelineId', 'expectedRevision', 'definition']},
  'run.read': {description: 'Read a run in the current project; defaults to the originating run.', properties: {runId: stringProperty}, required: []},
  'run.start': {description: 'Start an authorized pipeline in the current project with an idempotency key.', properties: {pipelineId: stringProperty, goal: stringProperty, baseline: stringProperty, mode: {type: 'string', enum: ['once', 'loop']}, dependsOnRunIds: stringArray, idempotencyKey: stringProperty}, required: ['pipelineId', 'goal', 'baseline', 'idempotencyKey']},
};
const toolName = (tool: ControlTool): string => `gwi_${tool.replaceAll('.', '_')}`;
const toolByName = new Map(Object.keys(TOOL_DEFINITIONS).map(tool => [toolName(tool as ControlTool), tool as ControlTool]));

const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    outcome: {type: 'string', enum: ['done', 'revise', 'blocked', 'no_change']},
    summary: {type: 'string'},
    artifacts: {type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: {label: stringProperty, path: {type: ['string', 'null']}, url: {type: ['string', 'null']}},
      required: ['label', 'path', 'url'],
    }},
    observations: stringArray,
  },
  required: ['outcome', 'summary', 'artifacts', 'observations'],
};

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function accountFingerprint(value:unknown):string|undefined{
  if(!object(value)||!object(value.account))return;
  const account=value.account,identity:Record<string,string>={};
  if(typeof account.type!=='string'||!account.type.toLowerCase().includes('chatgpt'))return;
  for(const key of ['id','accountId','email','workspaceId'])if(typeof account[key]==='string'&&account[key].trim()&&account[key].length<=1024)identity[key]=key==='email'?account[key].trim().toLowerCase():account[key];
  if(!Object.keys(identity).length)return;
  return createHash('sha256').update(JSON.stringify({type:account.type,...identity})).digest('hex');
}

/** Decode only metered windows; account/contact details and credit records never leave this boundary. */
export function parseCodexAccountAllowance(account:unknown,value:unknown,now=Date.now()):AccountAllowanceObservation{
  const accountKey=accountFingerprint(account),windows:unknown[]=[],buckets:{id?:string;value:unknown}[]=[];
  let invalid=false,exhausted=false;
  if(!object(value))return unavailableAccountObservation('ACCOUNT_ALLOWANCE_MALFORMED',now);
  if(Object.hasOwn(value,'rateLimitsByLimitId')){
    if(!object(value.rateLimitsByLimitId))invalid=true;
    else for(const [id,bucket]of Object.entries(value.rateLimitsByLimitId))buckets.push({id,value:bucket});
  }else if(object(value.rateLimits))buckets.push({value:value.rateLimits});else invalid=true;
  for(const bucket of buckets){
    if(!object(bucket.value)){invalid=true;continue;}
    const data=bucket.value,id=typeof data.limitId==='string'?data.limitId:bucket.id;
    if(typeof data.rateLimitReachedType==='string'&&data.rateLimitReachedType.trim())exhausted=true;
    if(!id||(bucket.id&&data.limitId!==undefined&&data.limitId!==bucket.id)){invalid=true;continue;}
    for(const slot of ['primary','secondary']as const){const window=data[slot];if(window==null)continue;if(!object(window)){invalid=true;continue;}
      windows.push({bucketId:id,...(typeof data.limitName==='string'?{bucketName:data.limitName}:{}),slot,usedPercent:window.usedPercent,windowDurationMins:window.windowDurationMins,resetsAt:window.resetsAt});
    }
  }
  return normalizeAccountObservation({status:invalid?'unavailable':'available',source:'local-codex',windows,exhausted,...(accountKey?{accountKey}:{}),...(exhausted?{reason:'ACCOUNT_LIMIT_REACHED'}:invalid?{reason:'ACCOUNT_ALLOWANCE_MALFORMED'}:{}),observedAt:new Date(now).toISOString(),expiresAt:new Date(now+ACCOUNT_ALLOWANCE_TTL_MS).toISOString()},now);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown Codex error.';
  return message.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+)\b/gi, '[redacted credential]')
    .replace(/((?:access|refresh|id)[_-]?token["'\s:=]+)[^\s,"'}]+/gi, '$1[redacted]')
    .slice(0, 4096);
}

function interrupted(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function taskOutput(value: unknown): TaskOutput {
  const invalid = (): never => {throw new Error('Codex final output does not match the required TaskOutput schema.');};
  const boundedString = (value: unknown, limit: number, nonempty = false): value is string =>
    typeof value === 'string' && value.length <= limit && (!nonempty || value.trim().length > 0);
  if (!object(value) || Object.keys(value).some(key => !['outcome', 'summary', 'artifacts', 'observations'].includes(key))
    || !['done', 'revise', 'blocked', 'no_change'].includes(String(value.outcome))
    || !boundedString(value.summary, 32768, true) || !Array.isArray(value.artifacts) || value.artifacts.length > 128
    || !Array.isArray(value.observations) || value.observations.length > 128
    || !value.observations.every(item => boundedString(item, 32768))) return invalid();
  const artifacts = value.artifacts.map(item => {
    if (!object(item) || Object.keys(item).some(key => !['label', 'path', 'url'].includes(key)) || !boundedString(item.label, 2048, true)) return invalid();
    if (item.path != null && !boundedString(item.path, 8192, true)) return invalid();
    if (item.url != null) {
      if (!boundedString(item.url, 8192, true)) return invalid();
      try {if (!['https:', 'http:'].includes(new URL(item.url).protocol)) return invalid();} catch {return invalid();}
    }
    return {label: item.label, ...(item.path != null ? {path: item.path as string} : {}), ...(item.url != null ? {url: item.url as string} : {})};
  });
  return {outcome: value.outcome as TaskOutput['outcome'], summary: value.summary, artifacts, observations: value.observations as string[]};
}

function readVersion(binary: string): Promise<string | undefined> {
  return new Promise(resolveVersion => {
    execFile(binary, ['--version'], {encoding: 'utf8', timeout: 5000, windowsHide: true}, (error, stdout) => {
      resolveVersion(error ? undefined : stdout.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\b/)?.[1]);
    });
  });
}

async function beforeStart<T>(promise: Promise<T>, deadline: number, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw interrupted('Codex task was cancelled before it started.');
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Codex task reached its time limit before starting.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Codex task reached its time limit before starting.')), remaining);
      abort = () => reject(interrupted('Codex task was cancelled before it started.'));
      signal.addEventListener('abort', abort, {once: true});
    })]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal.removeEventListener('abort', abort);
  }
}

class LocalCodexAdapter implements CodexAdapter {
  private readonly options: CodexAdapterOptions;
  private readonly binary: string;
  private child?: CodexProcess;
  private initializing?: Promise<void>;
  private version?: Promise<string | undefined>;
  private available = false;
  private closed = false;
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  private executions = new Map<string, ExecutionState>();
  private uncertainExecutions = new Map<string, ExecutionState>();
  private goals = new Map<string, GoalState>();
  private terminations = new Set<Promise<void>>();

  constructor(options: CodexAdapterOptions) {
    this.options = options;
    this.binary = options.binary ?? (process.env.GWI_CODEX_BIN?.trim() || 'codex');
    if (!this.binary.trim() || this.binary.includes('\0')) throw new Error('Choose a Codex executable path or command name.');
    if (options.defaultModel !== undefined && !options.defaultModel.trim()) throw new Error('Choose a nonempty local default model.');
  }

  async readAccountAllowance():Promise<AccountAllowanceObservation>{
    try{
      await this.ready();
      const before=await this.request('account/read',{refreshToken:false});
      const limits=await this.request('account/rateLimits/read',undefined);
      const after=await this.request('account/read',{refreshToken:false});
      const observed=parseCodexAccountAllowance(after,limits);
      if(accountFingerprint(before)!==accountFingerprint(after))return normalizeAccountObservation({...observed,status:'unavailable',reason:'ACCOUNT_CHANGED'},Date.now());
      return observed;
    }catch(error){return unavailableAccountObservation(object(error)&&error.rpcCode===-32601?'ACCOUNT_ALLOWANCE_UNSUPPORTED':'ACCOUNT_ALLOWANCE_READ_FAILED');}
  }

  private async connect(): Promise<void> {
    const child = this.options.launch?.(this.binary) ?? spawn(this.binary, ['app-server', '--listen', 'stdio://'], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return;
      buffer += chunk;
      if (buffer.length > MAX_LINE_LENGTH) {this.disconnect(child, new Error('Codex protocol message exceeded the local size limit.')); return;}
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {this.message(JSON.parse(line));} catch {this.disconnect(child, new Error('Codex returned an invalid JSON-RPC message.')); return;}
        if (this.child !== child) return;
      }
    });
    // Drain native logs without copying account details, credentials, or config into GWI.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => this.disconnect(child, new Error('Codex stdio connection failed.')));
    child.stdout.on('error', () => this.disconnect(child, new Error('Codex stdio connection failed.')));
    child.once('error', () => {
      if (this.child === child) this.available = false;
      this.disconnect(child, new Error('The installed Codex executable could not be started.'));
    });
    child.once('exit', () => this.disconnect(child, new Error('Codex app-server exited before the connection closed.'), false));
    try {await this.request('initialize', {clientInfo: {name: 'gw_iterator', title: 'GW-Iterator', version: '0.1.0'}, capabilities: {experimentalApi: true}});}
    catch (error) {this.disconnect(child, new Error('Codex initialization failed.')); throw error;}
    if (this.child !== child) throw new Error('Codex disconnected during initialization.');
    this.write({method: 'initialized'});
    this.available = true;
  }

  private async ready(): Promise<void> {
    if (this.closed) throw new Error('Codex adapter is closed.');
    if (!this.initializing) {
      const initialization = this.connect();
      this.initializing = initialization;
      initialization.catch(() => {
        if (this.initializing === initialization) this.initializing = undefined;
      });
    }
    await this.initializing;
  }

  private write(message: unknown): void {
    if (!this.child || this.closed) throw new Error('Codex app-server is not connected.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: unknown, timeoutMs = this.options.requestTimeoutMs ?? 20000): Promise<unknown> {
    if (!this.child || this.closed) return Promise.reject(new Error('Codex app-server is not connected.'));
    const id = ++this.nextId;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}.`));
      }, Math.max(1, timeoutMs));
      this.pending.set(id, {resolve: resolveRequest, reject, timer});
      try {this.write({method, id, params});} catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`Codex request could not be sent: ${method}.`));
      }
    });
  }

  private message(value: unknown): void {
    if (!object(value)) throw new Error('Invalid JSON-RPC object.');
    if (typeof value.method === 'string') {
      if (typeof value.id === 'number' || typeof value.id === 'string') {
        const child = this.child!;
        void this.serverRequest(value.id, value.method, object(value.params) ? value.params : {}, child).catch(() => {
          if (this.child === child) this.disconnect(child, new Error('Codex server request could not be answered.'));
        });
      } else this.notification(value.method, object(value.params) ? value.params : {});
      return;
    }
    if (typeof value.id !== 'number') throw new Error('Invalid JSON-RPC response id.');
    const pending = this.pending.get(value.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(value.id);
    if (object(value.error)) {
      const code = typeof value.error.code === 'number' ? ` (${value.error.code})` : '';
      pending.reject(Object.assign(new Error(`Codex request failed${code}.`),{rpcCode:typeof value.error.code==='number'?value.error.code:undefined}));
    } else if ('result' in value) pending.resolve(value.result);
    else pending.reject(new Error('Codex returned an invalid JSON-RPC response.'));
  }

  private emit(state: OwnedState, event: AdapterEvent): void {
    try {state.input.onEvent({...event, ref: {...state.ref}});} catch {
      // A failed observer must not crash the shared stdio protocol or approve work.
      if (state.kind === 'goal') void this.endGoal(state, 'cleared', 'Codex progress could not be delivered to the supervisor.');
      else this.stop(state, new Error('Codex progress could not be delivered to the supervisor.'), 'codex.observer_failed', false);
    }
  }

  private executionBoundary(state: OwnedState, boundary: ExecutionBoundary, dispatched: boolean, cleanupConfirmed: boolean): void {
    state.boundary = boundary;
    this.emit(state, {type: 'codex.execution_boundary', message: 'Native execution boundary was observed.', data: {state: boundary, dispatched, cleanupConfirmed}});
  }
  private preparationBoundary(input: CodexExecutionInput, ref?: ExecutionRef): void {
    try {input.onEvent({type: 'codex.execution_boundary', message: 'Native preparation ended before model dispatch.', ...(ref ? {ref: {...ref}} : {}), data: {state: 'not_dispatched', dispatched: false, cleanupConfirmed: true}});} catch {}
  }
  private definitelyRefused(error: unknown): boolean {return object(error) && (error.rpcCode === -32601 || error.rpcCode === -32602);}

  private recordMessage(state: ExecutionState, item: JsonObject, complete: boolean): void {
    if (item.type !== 'agentMessage' || typeof item.id !== 'string' || typeof item.text !== 'string') return;
    if (item.text.length > MAX_OUTPUT_LENGTH) {this.stop(state, new Error('Codex final output exceeded the local size limit.'), 'codex.output_limit'); return;}
    state.messages.set(item.id, {text: item.text, phase: text(item.phase), complete});
  }

  private acceptTurn(state: ExecutionState, turnId: string): boolean {
    if (state.ref.turnId && state.ref.turnId !== turnId) return false;
    if (!state.ref.turnId) {
      state.ref.turnId = turnId;
      this.emit(state, {type: 'codex.started', message: 'Codex turn started.'});
      if (state.stopError) void this.sendInterrupt(state);
    }
    return true;
  }

  private threadConfiguration(state: OwnedState, response: JsonObject): void {
    const data: JsonObject = {};
    for (const key of ['model', 'modelProvider', 'reasoningEffort', 'serviceTier']) {
      if (typeof response[key] === 'string' || response[key] === null) data[key] = response[key];
    }
    this.emit(state, {type: 'codex.thread_configuration', message: 'Codex returned the effective thread configuration.', data});
  }

  private runtimeNotification(state: OwnedState, method: string, params: JsonObject): boolean {
    if (method === 'thread/status/changed' && object(params.status)) {
      const status = text(params.status.type);
      if (!status) return true;
      const activeFlags = Array.isArray(params.status.activeFlags) ? params.status.activeFlags.filter(flag => typeof flag === 'string').slice(0, 10) : undefined;
      this.emit(state, {type: method, message: `Codex thread status: ${status}.`, data: {status, ...(activeFlags ? {activeFlags} : {})}});
    } else if (method === 'mcpServer/startupStatus/updated') {
      const name = text(params.name)?.slice(0, 160), status = text(params.status);
      this.emit(state, {type: method, message: `Codex MCP startup status: ${status ?? 'unavailable'}.`, data: {name, status, scope: params.threadId == null ? 'connection' : 'thread', ...(typeof params.error === 'string' ? {error: safeError(new Error(params.error))} : {})}});
    } else if (method === 'model/verification') {
      this.emit(state, {type: method, message: 'Codex reported a model verification requirement.', data: {count: Array.isArray(params.verifications) ? params.verifications.length : undefined}});
    } else if (method === 'model/safetyBuffering/updated') {
      this.emit(state, {type: method, message: 'Codex reported model safety buffering.', data: {model: text(params.model), fasterModel: text(params.fasterModel), showBufferingUi: params.showBufferingUi === true}});
    } else if (method === 'model/rerouted') {
      this.emit(state, {type: method, message: 'Codex reported a model routing change.', data: {fromModel: text(params.fromModel), toModel: text(params.toModel), ...(typeof params.reason === 'string' ? {reason: safeError(new Error(params.reason))} : {})}});
    } else if (method === 'hook/started' || method === 'hook/completed') {
      this.emit(state, {type: method, message: `Codex lifecycle hook ${method === 'hook/started' ? 'started' : 'completed'}.`});
    } else return false;
    return true;
  }

  private notification(method: string, params: JsonObject): void {
    const owned = typeof params.threadId === 'string' ? this.executions.get(params.threadId) ?? this.goals.get(params.threadId) : undefined;
    if (owned && !owned.settled && this.runtimeNotification(owned, method, params)) return;
    if (method === 'mcpServer/startupStatus/updated' && params.threadId == null) {
      for (const state of [...this.executions.values(), ...this.goals.values()]) if (!state.settled) this.runtimeNotification(state, method, params);
      return;
    }
    const goal = typeof params.threadId === 'string' ? this.goals.get(params.threadId) : undefined;
    if (goal) {this.goalNotification(goal, method, params); return;}
    const state = typeof params.threadId === 'string' ? this.executions.get(params.threadId) ?? this.uncertainExecutions.get(params.threadId) : undefined;
    if (!state) return;
    if (method.startsWith('item/') || method.startsWith('turn/') || method === 'thread/tokenUsage/updated') state.dispatchObserved = true;
    const turn = object(params.turn) ? params.turn : undefined;
    const turnId = text(params.turnId) ?? text(turn?.id);
    if (turnId && !this.acceptTurn(state, turnId)) return;
    if (state.settled) {
      if (method === 'turn/completed' && turnId && ['completed', 'failed', 'interrupted'].includes(String(turn?.status))) {
        this.executionBoundary(state, 'terminal', true, true);
        this.uncertainExecutions.delete(state.ref.threadId!);
      }
      return;
    }
    if (method === 'thread/tokenUsage/updated') {
      const usage = object(params.tokenUsage) && object(params.tokenUsage.total) ? params.tokenUsage.total : undefined;
      if (!usage || ![usage.inputTokens, usage.outputTokens, usage.totalTokens].every(number => typeof number === 'number' && Number.isSafeInteger(number) && number >= 0)) return;
      state.usage = {input: usage.inputTokens as number, output: usage.outputTokens as number, total: usage.totalTokens as number,
        ...(typeof usage.cachedInputTokens === 'number' && Number.isSafeInteger(usage.cachedInputTokens) && usage.cachedInputTokens >= 0 ? {cachedInput: usage.cachedInputTokens} : {})};
      this.emit(state, {type: method, message: 'Codex reported token usage.', usage: {...state.usage}});
      if (budgetTokens(state.usage) >= state.input.tokenBudget) this.stop(state, new Error('Codex reached the configured token budget.'), 'codex.token_limit');
    } else if (method === 'item/agentMessage/delta' && typeof params.itemId === 'string' && typeof params.delta === 'string') {
      const previous = state.messages.get(params.itemId) ?? {text: '', complete: false};
      if (previous.text.length + params.delta.length > MAX_OUTPUT_LENGTH) {this.stop(state, new Error('Codex final output exceeded the local size limit.'), 'codex.output_limit'); return;}
      state.messages.set(params.itemId, {...previous, text: previous.text + params.delta});
      this.emit(state, {type: method, message: params.delta.slice(0, 16000), data: {itemId: params.itemId}});
    } else if ((method === 'item/started' || method === 'item/completed') && object(params.item)) {
      const item = params.item;
      this.recordMessage(state, item, method === 'item/completed');
      const message = item.type === 'commandExecution' ? text(item.command) ?? 'Codex command execution.'
        : item.type === 'agentMessage' ? text(item.text) ?? 'Codex message.'
        : `Codex ${text(item.type) ?? 'item'} ${method === 'item/started' ? 'started' : 'completed'}.`;
      this.emit(state, {type: method, message: message.slice(0, 16000), data: {itemId: item.id, itemType: item.type, status: item.status, exitCode: item.exitCode, ...(item.type==='agentMessage'?{phase:item.phase}:{})}});
    } else if (method === 'turn/completed' && turn) {
      if (turnId && ['completed', 'failed', 'interrupted'].includes(String(turn.status))) this.executionBoundary(state, 'terminal', true, true);
      if (Array.isArray(turn.items)) for (const item of turn.items) if (object(item)) this.recordMessage(state, item, true);
      this.emit(state, {type: method, message: `Codex turn ${text(turn.status) ?? 'ended'}.`});
      if (state.stopError) {this.finish(state, state.stopError); return;}
      if (turn.status === 'interrupted') {this.finish(state, interrupted('Codex turn was interrupted.')); return;}
      if (turn.status !== 'completed') {
        const error = object(turn.error) && typeof turn.error.message === 'string' ? safeError(new Error(turn.error.message)) : 'Codex turn failed.';
        this.finish(state, new Error(error)); return;
      }
      const messages = [...state.messages.values()];
      const final = messages.filter(message => message.phase === 'final_answer').at(-1)
        ?? messages.filter(message => message.phase !== 'commentary' && message.complete).at(-1);
      try {
        if (!final) throw new Error('Codex completed without a final TaskOutput message.');
        let value: unknown;
        try {value = JSON.parse(final.text);} catch {throw new Error('Codex final output is not valid JSON.');}
        this.finish(state, undefined, taskOutput(value));
      } catch (error) {this.finish(state, new Error(safeError(error)));}
    } else if (method === 'error') {
      const error = object(params.error) && typeof params.error.message === 'string' ? safeError(new Error(params.error.message)) : 'Codex reported an execution error.';
      this.emit(state, {type: method, message: error, data: {willRetry: params.willRetry === true}});
      if (params.willRetry === false) this.finish(state, new Error(error));
    } else if (method === 'turn/plan/updated') {
      this.emit(state, {type: method, message: text(params.explanation)?.slice(0, 16000) ?? 'Codex updated its plan.', data: {plan: params.plan}});
    } else if (method === 'turn/diff/updated') {
      this.emit(state, {type: method, message: 'Codex updated file changes.', data: {diff: text(params.diff)?.slice(0, 65536)}});
    } else if (['item/commandExecution/outputDelta', 'item/fileChange/outputDelta', 'item/reasoning/summaryTextDelta'].includes(method) && typeof params.delta === 'string') {
      this.emit(state, {type: method, message: params.delta.slice(0, 16000), data: {itemId: params.itemId}});
    } else if (method === 'model/rerouted') {
      this.emit(state, {type: method, message: `Codex routed from ${text(params.fromModel) ?? 'the selected model'} to ${text(params.toModel) ?? 'another model'}.`, data: {reason: params.reason}});
    }
  }

  private async serverRequest(id: RpcId, method: string, params: JsonObject, child: CodexProcess): Promise<void> {
    if (method === 'item/tool/call') {
      await this.toolRequest(id, params, child);
      return;
    }
    const state = typeof params.threadId === 'string' ? this.executions.get(params.threadId) ?? this.goals.get(params.threadId) : undefined;
    const states = state ? [state] : [...this.executions.values(), ...[...this.goals.values()].filter(goal => !goal.settled)];
    const reason = 'GWI cannot authorize native approval, permission expansion, or human input on behalf of this role.';
    for (const target of states) this.emit(target, {type: 'codex.request_denied', message: `${method} denied. ${reason}`, data: {method}});
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') this.write({id, result: {decision: 'decline'}});
    else if (method === 'execCommandApproval' || method === 'applyPatchApproval') this.write({id, result: {decision: 'denied'}});
    else if (method === 'item/permissions/requestApproval') this.write({id, result: {permissions: {}, scope: 'turn'}});
    else if (method === 'mcpServer/elicitation/request') this.write({id, result: {action: 'decline'}});
    else if (method === 'item/tool/requestUserInput') this.write({id, result: {answers: {}}});
    else this.write({id, error: {code: -32601, message: 'This server request is not supported by GWI. Authentication remains managed by native Codex.'}});
  }

  private async toolRequest(id: RpcId, params: JsonObject, child: CodexProcess): Promise<void> {
    const state = typeof params.threadId === 'string' ? this.executions.get(params.threadId) ?? this.goals.get(params.threadId) : undefined;
    const tool = typeof params.tool === 'string' ? toolByName.get(params.tool) : undefined;
    let failure: string | undefined;
    if (!state || state.settled || state.stopError || (state.kind === 'goal' && state.ending)) failure = 'The originating GWI execution is not active.';
    else if (typeof params.turnId !== 'string' || !(state.kind === 'goal' ? state.activeTurns.has(params.turnId) : this.acceptTurn(state, params.turnId))) failure = 'The dynamic tool does not belong to the active Codex turn.';
    else if (params.namespace != null || !tool || !state.tools.has(tool)) failure = 'This GWI control tool is not allowed by the frozen role profile.';
    else if (!object(params.arguments)) failure = 'GWI tool arguments must be a JSON object.';
    let result: unknown;
    if (!failure && state && tool) {
      this.emit(state, {type: 'gwi.tool.started', message: `GWI tool ${tool} started.`, data: {tool}});
      try {
        result = await Promise.race([
          state.input.onTool(tool, params.arguments as JsonObject),
          state.toolEnd,
        ]);
        if (state.settled || state.stopError) throw new Error('The GWI execution has ended.');
      } catch (error) {failure = safeError(error);}
    }
    let encoded = '';
    if (!failure) {
      try {encoded = JSON.stringify(result ?? null); if (encoded.length > 1024 * 1024) failure = 'The GWI tool response exceeded the local size limit.';}
      catch {failure = 'The GWI tool returned a value that cannot be represented as JSON.';}
    }
    if (state) this.emit(state, {type: failure ? 'gwi.tool.denied' : 'gwi.tool.completed', message: failure ?? `GWI tool ${tool} completed.`, data: {tool: tool ?? 'unknown'}});
    // A late tool callback must not send a response into a replacement connection.
    if (this.child !== child) return;
    this.write({id, result: {success: !failure, contentItems: [{type: 'inputText', text: failure ?? encoded}]}});
  }

  private finish(state: ExecutionState, error?: Error, output?: TaskOutput): void {
    if (state.settled) return;
    state.settled = true;
    state.endTools(error ?? new Error('The GWI execution has ended.'));
    if (state.timer) clearTimeout(state.timer);
    if (state.stopTimer) clearTimeout(state.stopTimer);
    state.input.signal.removeEventListener('abort', state.abort);
    if (this.executions.get(state.ref.threadId!) === state) this.executions.delete(state.ref.threadId!);
    if (state.boundary !== 'terminal' && state.boundary !== 'not_dispatched') this.uncertainExecutions.set(state.ref.threadId!, state);
    if (error) state.reject(error);
    else if (output) state.resolve({output, ...(state.usage ? {usage: {...state.usage}} : {})});
    else state.reject(new Error('Codex execution ended without an output.'));
  }

  private stop(state: ExecutionState, error: Error, type: string, notify = true): void {
    if (state.settled || state.stopError) return;
    state.stopError = error;
    state.endTools(error);
    if (notify) this.emit(state, {type, message: error.message});
    state.stopTimer = setTimeout(() => {
      if (state.settled) return;
      const child = this.child;
      if (child) this.disconnect(child, new Error('Codex did not confirm interruption; its local server was stopped.'));
      else this.finish(state, error);
    }, this.options.interruptGraceMs ?? 3000);
    void this.sendInterrupt(state);
  }

  private async sendInterrupt(state: ExecutionState): Promise<void> {
    if (!state.ref.turnId || state.settled) return;
    if (!state.interrupting) {
      state.interrupting = this.request('turn/interrupt', {threadId: state.ref.threadId, turnId: state.ref.turnId}).then(() => {}, () => {
        if (!state.settled && this.child) this.disconnect(this.child, new Error('Codex interruption failed; its local server was stopped.'));
      });
    }
    await state.interrupting;
  }

  private terminate(child: CodexProcess): void {
    const termination = new Promise<void>(resolveTermination => {
      const timer = setTimeout(() => {child.kill('SIGKILL'); resolveTermination();}, 500);
      child.once('exit', () => {clearTimeout(timer); resolveTermination();});
      child.kill('SIGTERM');
    });
    this.terminations.add(termination);
    void termination.finally(() => this.terminations.delete(termination));
  }

  private disconnect(child: CodexProcess, error: Error, terminate = true): void {
    if (this.child !== child) return;
    this.child = undefined;
    this.initializing = undefined;
    for (const pending of this.pending.values()) {clearTimeout(pending.timer); pending.reject(error);}
    this.pending.clear();
    for (const state of [...this.executions.values()]) {
      this.emit(state, {type: 'codex.disconnected', message: error.message});
      this.finish(state, state.stopError ?? error);
    }
    for (const state of this.goals.values()) if (!state.settled) {
      this.emit(state, {type: 'codex.disconnected', message: error.message});
      this.finishGoal(state, error);
    }
    if (terminate) this.terminate(child);
  }

  private async models(): Promise<ModelInfo[]> {
    const result: ModelInfo[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const response = await this.request('model/list', {limit: 100, includeHidden: false, ...(cursor ? {cursor} : {})});
      if (!object(response) || !Array.isArray(response.data)) throw new Error('Codex model discovery returned an invalid response.');
      for (const model of response.data) if (object(model) && typeof model.model === 'string' && typeof model.displayName === 'string') {
        const efforts = Array.isArray(model.supportedReasoningEfforts)
          ? model.supportedReasoningEfforts.flatMap(option => object(option) && typeof option.reasoningEffort === 'string' ? [option.reasoningEffort] : []) : [];
        result.push({id: model.model, name: model.displayName, efforts, isDefault: model.isDefault === true});
      }
      cursor = text(response.nextCursor);
      if (!cursor) return result;
      if (cursors.has(cursor)) throw new Error('Codex model discovery repeated its pagination cursor.');
      cursors.add(cursor);
    }
    throw new Error('Codex model discovery exceeded the local pagination limit.');
  }

  private recordGoal(state: GoalState, value: unknown): void {
    if (!object(value) || value.threadId !== state.ref.threadId || typeof value.objective !== 'string'
      || !['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'].includes(String(value.status))
      || ![value.tokensUsed, value.timeUsedSeconds, value.createdAt, value.updatedAt].every(number => typeof number === 'number' && Number.isSafeInteger(number) && number >= 0)
      || (value.tokenBudget != null && (typeof value.tokenBudget !== 'number' || !Number.isSafeInteger(value.tokenBudget) || value.tokenBudget < 0))) {
      throw new Error('Codex returned an invalid native goal state for the owned thread.');
    }
    const goal: CodexNativeGoal = {threadId: value.threadId as string, objective: value.objective, status: value.status as CodexNativeGoal['status'], tokensUsed: value.tokensUsed as number, timeUsedSeconds: value.timeUsedSeconds as number, createdAt: value.createdAt as number, updatedAt: value.updatedAt as number, ...(value.tokenBudget !== undefined ? {tokenBudget: value.tokenBudget as number | null} : {})};
    state.activationConfirmed = true;
    if (JSON.stringify(state.goal) !== JSON.stringify(goal)) {
      state.goal = goal;
      this.emit(state, {type: 'thread/goal/updated', message: `Native Codex goal reported ${goal.status}.`, data: {goal}});
    }
  }

  private goalNotification(state: GoalState, method: string, params: JsonObject): void {
    if (method.startsWith('item/') || method.startsWith('turn/') || method === 'thread/tokenUsage/updated') state.dispatchObserved = true;
    const turn = object(params.turn) ? params.turn : undefined;
    const turnId = text(params.turnId) ?? text(turn?.id);
    if (method === 'turn/started' && turnId) {
      state.ref.turnId = turnId;
      state.activationConfirmed = true;
      if (state.boundary !== 'dispatching') this.executionBoundary(state, 'dispatching', true, false);
      state.activeTurns.add(turnId);
      this.emit(state, {type: method, message: 'Native Codex goal started a turn.', data: {turnId}});
      if (state.ending || state.settled) {
        void this.interruptGoalTurns(state);
        if (state.settled && !state.stopTimer) state.stopTimer = setTimeout(() => {
          if (state.activeTurns.size && this.child) this.disconnect(this.child, new Error('A late owned native goal turn did not stop; its local server was stopped.'));
        }, this.options.interruptGraceMs ?? 3000);
      }
      return;
    }
    if (method === 'turn/completed' && turnId) {
      if (!['completed', 'failed', 'interrupted'].includes(String(turn?.status))) return;
      state.ref.turnId = turnId;
      state.activationConfirmed = true;
      state.activeTurns.delete(turnId);
      if (state.settled && state.activeTurns.size === 0 && state.stopTimer) {clearTimeout(state.stopTimer); state.stopTimer = undefined;}
      if (!state.settled && !state.ending && !state.completedTurns.has(turnId)) {
        state.completedTurns.add(turnId);
        if (turn?.status === 'failed') {
          state.consecutiveFailedTurns++;
          state.lastTurnError = object(turn.error) && typeof turn.error.message === 'string' ? safeError(new Error(turn.error.message)) : state.lastTurnError ?? 'Native goal turn failed without an error summary.';
        } else if (turn?.status === 'completed') {
          state.consecutiveFailedTurns = 0;
          state.lastTurnError = undefined;
        }
      }
      this.emit(state, {type: method, message: `Native goal turn ${text(turn?.status) ?? 'ended'}.`, data: {turnId, status: turn?.status, ...(turn?.status === 'failed' ? {error: state.lastTurnError, consecutiveFailedTurns: state.consecutiveFailedTurns} : {})}});
      if (!state.settled && !state.ending && state.consecutiveFailedTurns >= 3) {
        const summary = `Native Codex goal stopped after 3 consecutive failed turns. Latest error: ${state.lastTurnError}`;
        this.emit(state, {type: 'codex.goal_circuit_open', message: summary, data: {limit: 3, consecutiveFailedTurns: state.consecutiveFailedTurns, lastError: state.lastTurnError}});
        void this.endGoal(state, 'cleared', summary);
      }
      this.maybeFinishGoal(state);
      return;
    }
    if (state.settled) return;
    if (method === 'thread/goal/updated') {
      try {
        this.recordGoal(state, params.goal);
        if (state.goal && ['complete', 'blocked', 'budgetLimited', 'usageLimited'].includes(state.goal.status)) {
          void this.endGoal(state, state.goal.status as CodexGoalResult['status'], state.summary || `Native Codex goal reported ${state.goal.status}.`);
        } else if (state.goal?.status === 'paused') {
          void this.endGoal(state, 'cleared', 'Native Codex goal was paused; GWI did not resume it.', new Error('Native Codex goal is paused; an explicit human decision is required.'));
        }
      } catch (error) {void this.endGoal(state, 'cleared', safeError(error), new Error(safeError(error)));}
    } else if (method === 'thread/goal/cleared') {
      state.clearConfirmed = true;
      this.emit(state, {type: method, message: 'The owned native Codex goal was cleared.'});
      if (!state.ending) void this.endGoal(state, 'cleared', 'Native Codex goal was cleared.');
    } else if (method === 'thread/tokenUsage/updated') {
      const usage = object(params.tokenUsage) && object(params.tokenUsage.total) ? params.tokenUsage.total : undefined;
      if (!usage || ![usage.inputTokens, usage.outputTokens, usage.totalTokens].every(number => typeof number === 'number' && Number.isSafeInteger(number) && number >= 0)) return;
      state.usage = {input: usage.inputTokens as number, output: usage.outputTokens as number, total: usage.totalTokens as number,
        ...(typeof usage.cachedInputTokens === 'number' && Number.isSafeInteger(usage.cachedInputTokens) && usage.cachedInputTokens >= 0 ? {cachedInput: usage.cachedInputTokens} : {})};
      this.emit(state, {type: method, message: 'Codex reported native goal thread usage.', usage: {...state.usage}});
      if (budgetTokens(state.usage) >= state.input.tokenBudget) void this.endGoal(state, 'cleared', 'Codex goal reached the configured GWI token budget.');
    } else if ((method === 'item/started' || method === 'item/completed') && object(params.item)) {
      const item = params.item;
      const message = item.type === 'agentMessage' ? text(item.text) : item.type === 'commandExecution' ? text(item.command) : undefined;
      if (method === 'item/completed' && item.type === 'agentMessage' && typeof item.text === 'string' && item.phase !== 'commentary') state.summary = item.text.slice(0, 32768);
      this.emit(state, {type: method, message: message?.slice(0, 16000) || `Native goal ${text(item.type) ?? 'item'} ${method === 'item/started' ? 'started' : 'completed'}.`, data: {itemId: item.id, itemType: item.type, status: item.status, ...(item.type==='agentMessage'?{phase:item.phase}:{})}});
    } else if (['item/agentMessage/delta', 'item/commandExecution/outputDelta', 'item/fileChange/outputDelta', 'item/reasoning/summaryTextDelta'].includes(method) && typeof params.delta === 'string') {
      this.emit(state, {type: method, message: params.delta.slice(0, 16000), data: {itemId: params.itemId}});
    } else if (method === 'error') {
      const error = object(params.error) && typeof params.error.message === 'string' ? safeError(new Error(params.error.message)) : 'Native Codex goal turn reported an error.';
      state.lastTurnError = error;
      this.emit(state, {type: method, message: error, data: {willRetry: params.willRetry === true}});
    }
  }

  private async clearGoal(state: GoalState): Promise<void> {
    const response = await this.request('thread/goal/get', {threadId: state.ref.threadId});
    if (!object(response) || (response.goal != null && !object(response.goal))) throw new Error('Native goal inspection could not be confirmed.');
    if (response.goal != null) this.recordGoal(state, response.goal);
    const cleared = await this.request('thread/goal/clear', {threadId: state.ref.threadId});
    if (!object(cleared) || typeof cleared.cleared !== 'boolean') throw new Error('Native goal clearing could not be confirmed.');
    if (!cleared.cleared) {
      const after = await this.request('thread/goal/get', {threadId: state.ref.threadId});
      if (!object(after) || after.goal != null) throw new Error('The owned native goal is still present after clearing.');
    }
    state.clearConfirmed = true;
    this.emit(state, {type: 'codex.goal_cleanup', message: 'Owned native goal cleanup was confirmed.', data: {cleared: cleared.cleared, goal: state.goal}});
    await this.interruptGoalTurns(state);
    this.maybeFinishGoal(state);
  }

  private async interruptGoalTurns(state: GoalState): Promise<void> {
    if (!state.clearConfirmed) return;
    await Promise.all([...state.activeTurns].filter(turnId => !state.interrupting.has(turnId)).map(async turnId => {
      state.interrupting.add(turnId);
      try {await this.request('turn/interrupt', {threadId: state.ref.threadId, turnId});}
      catch {
        if (this.child) this.disconnect(this.child, new Error('Owned native goal interruption could not be confirmed; its local server was stopped.'));
      }
    }));
  }

  private endGoal(state: GoalState, status: CodexGoalResult['status'], summary: string, error?: Error): Promise<void> {
    if (state.ending || state.settled) return state.cleanup ?? Promise.resolve();
    state.ending = true;
    state.terminalStatus = status;
    state.terminalSummary = summary;
    state.finalError = error;
    state.stopError = new Error(summary);
    state.endTools(state.stopError);
    this.emit(state, {type: 'codex.goal_stopping', message: summary, data: {status}});
    state.stopTimer = setTimeout(() => {
      if (state.settled) return;
      if (this.child) this.disconnect(this.child, new Error('Owned native goal cleanup did not finish; its local server was stopped. Inspect the recorded native thread.'));
      else this.finishGoal(state, new Error('Owned native goal cleanup was not confirmed.'));
    }, this.options.interruptGraceMs ?? 3000);
    state.cleanup = this.clearGoal(state).catch(failure => {
      const cleanupError = new Error(`Owned native goal cleanup failed: ${safeError(failure)}`);
      this.emit(state, {type: 'codex.goal_cleanup_failed', message: cleanupError.message});
      if (this.child) this.disconnect(this.child, cleanupError);
      else this.finishGoal(state, cleanupError);
    });
    return state.cleanup;
  }

  private maybeFinishGoal(state: GoalState): void {
    if (state.ending && !state.setting && state.clearConfirmed && state.activeTurns.size === 0) {
      if (state.activationConfirmed && state.boundary !== 'not_dispatched' && state.boundary !== 'terminal') this.executionBoundary(state, 'terminal', true, true);
      this.finishGoal(state, state.finalError);
    }
  }

  private finishGoal(state: GoalState, error?: Error): void {
    if (state.settled) return;
    state.settled = true;
    state.endTools(error ?? new Error('The owned native Codex goal has ended.'));
    if (state.timer) clearTimeout(state.timer);
    if (state.stopTimer) clearTimeout(state.stopTimer);
    state.input.signal.removeEventListener('abort', state.abort);
    if (error) state.reject(error);
    else state.resolve({status: state.terminalStatus ?? 'cleared', summary: state.terminalSummary ?? state.summary, ...(state.usage ? {usage: {...state.usage}} : {}), ...(state.goal ? {nativeGoal: {...state.goal}} : {})});
    // Keep this owned thread registered until close so a delayed native turn is interrupted.
  }

  async startGoal(input: CodexGoalInput): Promise<CodexGoalExecution> {
    const boundary: StartupBoundary = {paidRequestSent: false};
    try {return await this.startNativeGoal(input, boundary);} catch (error) {
      if (!boundary.paidRequestSent) this.preparationBoundary(input, boundary.ref);
      throw error;
    }
  }
  private async startNativeGoal(input: CodexGoalInput, boundary: StartupBoundary): Promise<CodexGoalExecution> {
    if (!isAbsolute(input.workspace) || !input.objective?.trim() || input.objective.length > 4000) throw new Error('A native Codex goal requires an absolute workspace and an objective of at most 4,000 characters.');
    if (!Number.isFinite(input.timeoutSeconds) || input.timeoutSeconds <= 0 || !Number.isSafeInteger(input.tokenBudget) || input.tokenBudget <= 0) throw new Error('A native Codex goal requires finite positive time and token limits.');
    if (!['read-only', 'workspace-write'].includes(input.role.sandbox)) throw new Error('The native Codex goal role sandbox is unsupported.');
    const deadline = Date.now() + input.timeoutSeconds * 1000;
    await beforeStart(this.ready(), deadline, input.signal);
    const tools = new Set(input.role.tools);
    if ([...tools].some(tool => !Object.hasOwn(TOOL_DEFINITIONS, tool))) throw new Error('The role includes an unsupported GWI control tool.');
    const skillSources: string[] = [];
    if (input.role.skills.length) {
      const installed = await beforeStart(this.skills(input.workspace), deadline, input.signal);
      for (const selected of input.role.skills) {
        if (!isAbsolute(selected.path) || !installed.some(skill => skill.name === selected.name && resolve(skill.path) === resolve(selected.path))) throw new Error('A selected Codex skill is not installed and enabled for this workspace.');
        const source = await beforeStart(readFile(selected.path, 'utf8'), deadline, input.signal);
        if (source.length > 131072) throw new Error('A selected skill exceeds the native goal context size limit.');
        skillSources.push(`Selected installed skill $${selected.name} (${selected.path}):\n${source}`);
      }
    }
    const instructions = `${input.role.instructions}\n\nNative goal: ${input.objective}\nTask context:\n${input.prompt}\n\nThis is a bounded, native Codex goal. Its native goal state governs continuation across turns; a single completed turn does not complete the goal. Use the authorized GWI control tools only within the current project. Await actual child outcomes before claiming success, and use native update_goal only when the corresponding native status is supported by observed evidence. Never pause a goal automatically or request expanded permissions. Native tools remain governed by this role's sandbox.\n\n${skillSources.join('\n\n')}`;
    const model = input.role.model ?? this.options.defaultModel;
    const response = await beforeStart(this.request('thread/start', {
      cwd: input.workspace, runtimeWorkspaceRoots: [input.workspace], sandbox: input.role.sandbox, approvalPolicy: 'never',
      config: {model_reasoning_effort: input.role.effort, sandbox_workspace_write: {writable_roots: [input.workspace], network_access: false, exclude_tmpdir_env_var: true, exclude_slash_tmp: true}},
      ...(model ? {model} : {}), serviceTier: 'default', developerInstructions: instructions, serviceName: 'gw_iterator_native_goal',
      dynamicTools: [...tools].map(tool => ({name: toolName(tool), description: TOOL_DEFINITIONS[tool].description, inputSchema: {type: 'object', properties: TOOL_DEFINITIONS[tool].properties, required: TOOL_DEFINITIONS[tool].required, additionalProperties: false}})),
    }), deadline, input.signal);
    if (!object(response) || !object(response.thread) || typeof response.thread.id !== 'string' || !response.thread.id) throw new Error('Native Codex goal setup did not return an owned thread identifier.');
    boundary.ref = {threadId: response.thread.id};
    const sandbox = object(response.sandbox) ? response.sandbox : undefined;
    if (response.approvalPolicy !== 'never' || !sandbox || sandbox.type !== (input.role.sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite') || sandbox.networkAccess === true
      || (sandbox.type === 'workspaceWrite' && (!Array.isArray(sandbox.writableRoots) || sandbox.writableRoots.some(root => typeof root !== 'string' || resolve(root) !== resolve(input.workspace))))) throw new Error('Native Codex goal setup did not confirm the requested sandbox and approval policy.');
    if (input.signal.aborted) throw interrupted('Native Codex goal was cancelled before activation.');
    let resolveGoal!: GoalState['resolve']; let rejectGoal!: GoalState['reject']; let endTools!: GoalState['endTools'];
    const completion = new Promise<CodexGoalResult>((resolveValue, rejectValue) => {resolveGoal = resolveValue; rejectGoal = rejectValue;});
    const toolEnd = new Promise<never>((_, rejectTools) => {endTools = rejectTools;});
    void completion.catch(() => {}); void toolEnd.catch(() => {});
    const state: GoalState = {kind: 'goal', input, tools, ref: {threadId: response.thread.id}, completion, resolve: resolveGoal, reject: rejectGoal, toolEnd, endTools, settled: false, ending: false, setting: true, clearConfirmed: false, activeTurns: new Set(), interrupting: new Set(), consecutiveFailedTurns: 0, completedTurns: new Set(), summary: '', abort: () => {void this.endGoal(state, 'cleared', 'Native Codex goal was cancelled by the supervisor.');}};
    this.goals.set(state.ref.threadId!, state);
    this.threadConfiguration(state, response);
    input.signal.addEventListener('abort', state.abort, {once: true});
    state.timer = setTimeout(() => {void this.endGoal(state, 'cleared', 'Native Codex goal reached the configured time limit.');}, Math.max(1, deadline - Date.now()));
    try {
      this.executionBoundary(state, 'dispatching', true, false);
      if (state.stopError || state.settled || input.signal.aborted) throw state.stopError ?? interrupted('Native Codex goal was cancelled before activation.');
      boundary.paidRequestSent = true;
      const set = await this.request('thread/goal/set', {threadId: state.ref.threadId, objective: input.objective, status: 'active', tokenBudget: input.tokenBudget}, Math.min(this.options.requestTimeoutMs ?? 20000, Math.max(1, deadline - Date.now())));
      if (!object(set) || !object(set.goal)) throw new Error('Native Codex goal API did not return an actual goal.');
      if (!state.goal) this.recordGoal(state, set.goal);
      if (state.ending) {await state.cleanup; if (!state.settled) await this.clearGoal(state);}
      state.setting = false;
      this.maybeFinishGoal(state);
      return {ref: {...state.ref}, completion};
    } catch (error) {
      if (this.definitelyRefused(error) && !state.activationConfirmed && !state.dispatchObserved) this.executionBoundary(state, 'not_dispatched', false, true);
      const failure = new Error(`Native Codex goal setup is unsupported or failed: ${safeError(error)}`);
      state.setting = false;
      state.finalError = failure;
      await this.endGoal(state, 'cleared', failure.message, failure);
      this.maybeFinishGoal(state);
      await completion.catch(() => {});
      throw failure;
    }
  }

  async info(): Promise<CodexInfo> {
    this.version ??= (this.options.getVersion ?? readVersion)(this.binary).catch(() => undefined);
    const version = await this.version;
    try {
      await this.ready();
      const [account, models] = await Promise.allSettled([this.request('account/read', {refreshToken: false}), this.models()]);
      const auth = account.status === 'fulfilled' && object(account.value) ? account.value : undefined;
      const authenticated = auth ? object(auth.account) || auth.requiresOpenaiAuth === false : undefined;
      const errors = [account.status === 'rejected' ? 'Codex authentication discovery failed.' : undefined, models.status === 'rejected' ? 'Codex model discovery failed.' : undefined].filter(Boolean);
      return {available: this.available, connected: !!this.child, ...(version ? {version} : {}), ...(authenticated !== undefined ? {authenticated} : {}), models: models.status === 'fulfilled' ? models.value : [], dynamicTools: true, ...(errors.length ? {error: errors.join(' ')} : {})};
    } catch (error) {
      return {available: this.available || !!version, connected: false, ...(version ? {version} : {}), models: [], error: safeError(error)};
    }
  }

  async skills(workspace: string): Promise<{name: string; path: string; description: string}[]> {
    if (!isAbsolute(workspace)) throw new Error('Codex workspace must be an absolute path.');
    await this.ready();
    const response = await this.request('skills/list', {cwds: [workspace], forceReload: true});
    if (!object(response) || !Array.isArray(response.data)) throw new Error('Codex skill discovery returned an invalid response.');
    const result: {name: string; path: string; description: string}[] = [];
    for (const group of response.data) {
      if (!object(group) || group.cwd !== workspace || !Array.isArray(group.skills)) continue;
      for (const skill of group.skills) if (object(skill) && skill.enabled === true && typeof skill.name === 'string' && typeof skill.path === 'string' && typeof skill.description === 'string' && isAbsolute(skill.path)) {
        result.push({name: skill.name, path: skill.path, description: skill.description});
      }
    }
    return result;
  }

  async start(input: CodexExecutionInput): Promise<CodexExecution> {
    const boundary: StartupBoundary = {paidRequestSent: false};
    try {return await this.startNativeTask(input, boundary);} catch (error) {
      if (!boundary.paidRequestSent) this.preparationBoundary(input, boundary.ref);
      throw error;
    }
  }
  private async startNativeTask(input: CodexExecutionInput, boundary: StartupBoundary): Promise<CodexExecution> {
    if (!isAbsolute(input.workspace)) throw new Error('Codex workspace must be an absolute path.');
    if (!Number.isFinite(input.timeoutSeconds) || input.timeoutSeconds <= 0 || !Number.isSafeInteger(input.tokenBudget) || input.tokenBudget <= 0) throw new Error('Codex execution requires finite positive time and token limits.');
    if (!['read-only', 'workspace-write'].includes(input.role.sandbox)) throw new Error('The Codex role sandbox is unsupported.');
    if (input.signal.aborted) throw interrupted('Codex task was cancelled before it started.');
    const deadline = Date.now() + input.timeoutSeconds * 1000;
    await beforeStart(this.ready(), deadline, input.signal);
    const selectedSkills = input.role.skills.map(skill => ({...skill}));
    if (selectedSkills.length) {
      if (selectedSkills.some(skill => !isAbsolute(skill.path))) throw new Error('Selected Codex skill paths must be absolute.');
      const installed = await beforeStart(this.skills(input.workspace), deadline, input.signal);
      if (selectedSkills.some(selected => !installed.some(skill => skill.name === selected.name && resolve(skill.path) === resolve(selected.path)))) throw new Error('A selected Codex skill is not installed and enabled for this workspace.');
    }
    const tools = new Set(input.role.tools);
    if ([...tools].some(tool => !Object.hasOwn(TOOL_DEFINITIONS, tool))) throw new Error('The role includes an unsupported GWI control tool.');
    const instructions = `${input.role.instructions}\n\nComplete only the supplied task within its execution limits. Use the selected GWI tools only for the current project; they do not grant additional native filesystem or network permissions. Native Codex tools remain governed by the configured sandbox. Report a blocker instead of requesting permission expansion. Return a final JSON object matching the supplied TaskOutput schema; use null for an artifact path or URL that is absent.`;
    const model = input.role.model ?? this.options.defaultModel;
    const response = await beforeStart(this.request('thread/start', {
      cwd: input.workspace, runtimeWorkspaceRoots: [input.workspace], sandbox: input.role.sandbox, approvalPolicy: 'never',
      config: {model_reasoning_effort: input.role.effort},
      ...(model ? {model} : {}), serviceTier: 'default',
      developerInstructions: instructions, serviceName: 'gw_iterator',
      dynamicTools: [...tools].map(tool => ({name: toolName(tool), description: TOOL_DEFINITIONS[tool].description, inputSchema: {type: 'object', properties: TOOL_DEFINITIONS[tool].properties, required: TOOL_DEFINITIONS[tool].required, additionalProperties: false}})),
    }), deadline, input.signal);
    if (!object(response) || !object(response.thread) || typeof response.thread.id !== 'string' || !response.thread.id) throw new Error('Codex did not return an actual thread identifier.');
    boundary.ref = {threadId: response.thread.id};
    if (input.signal.aborted) throw interrupted('Codex task was cancelled before it started.');
    const ref: ExecutionRef = {threadId: response.thread.id};
    let resolveCompletion!: ExecutionState['resolve'];
    let rejectCompletion!: ExecutionState['reject'];
    const completion: CodexExecution['completion'] = new Promise((resolveExecution, rejectExecution) => {resolveCompletion = resolveExecution; rejectCompletion = rejectExecution;});
    // A native completion can arrive before turn/start returns to its caller.
    void completion.catch(() => {});
    let endTools!: ExecutionState['endTools'];
    const toolEnd = new Promise<never>((_, rejectTools) => {endTools = rejectTools;});
    void toolEnd.catch(() => {});
    const state: ExecutionState = {kind: 'task', input, tools, ref, completion, resolve: resolveCompletion, reject: rejectCompletion, toolEnd, endTools, messages: new Map(), settled: false, abort: () => this.stop(state, interrupted('Codex turn was cancelled.'), 'codex.cancelled')};
    this.executions.set(ref.threadId!, state);
    this.threadConfiguration(state, response);
    input.signal.addEventListener('abort', state.abort, {once: true});
    state.timer = setTimeout(() => this.stop(state, new Error('Codex reached the configured time limit.'), 'codex.time_limit'), Math.max(1, deadline - Date.now()));
    try {
      this.executionBoundary(state, 'dispatching', true, false);
      if (state.stopError || state.settled || input.signal.aborted) throw state.stopError ?? interrupted('Codex task was cancelled before dispatch.');
      boundary.paidRequestSent = true;
      const result = await this.request('turn/start', {
        threadId: ref.threadId, cwd: input.workspace, runtimeWorkspaceRoots: [input.workspace], approvalPolicy: 'never',
        sandboxPolicy: input.role.sandbox === 'read-only' ? {type: 'readOnly', networkAccess: false}
          : {type: 'workspaceWrite', writableRoots: [input.workspace], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true},
        ...(model ? {model} : {}), effort: input.role.effort, serviceTier: 'default',
        input: [{type: 'text', text: `${selectedSkills.map(skill => `$${skill.name}`).join(' ')}${selectedSkills.length ? '\n\n' : ''}${input.prompt}`}, ...selectedSkills.map(skill => ({type: 'skill', name: skill.name, path: skill.path}))],
        outputSchema: OUTPUT_SCHEMA,
      }, Math.min(this.options.requestTimeoutMs ?? 20000, Math.max(1, deadline - Date.now()) + (this.options.interruptGraceMs ?? 3000)));
      if (!object(result) || !object(result.turn) || typeof result.turn.id !== 'string' || !result.turn.id || !this.acceptTurn(state, result.turn.id)) throw new Error('Codex did not return the expected active turn identifier.');
      if (['completed', 'interrupted', 'failed'].includes(String(result.turn.status))) this.notification('turn/completed', {threadId: ref.threadId, turn: result.turn});
      if (state.stopError) {await this.sendInterrupt(state); throw state.stopError;}
      if (input.signal.aborted) {state.abort(); await this.sendInterrupt(state); throw state.stopError;}
      return {ref: {...ref}, completion};
    } catch (error) {
      if (this.definitelyRefused(error) && !state.ref.turnId && !state.dispatchObserved && state.boundary !== 'terminal') this.executionBoundary(state, 'not_dispatched', false, true);
      if (!state.settled) {
        // A failed turn/start may have reached the server without returning a handle.
        // Closing this connection prevents an untracked native task from continuing.
        const child = this.child;
        if (child) this.disconnect(child, new Error('Codex turn startup could not be confirmed; its local server was stopped.'));
        this.finish(state, new Error(safeError(error)));
      }
      throw error;
    }
  }

  private active(ref: ExecutionRef, allowStopping = false): OwnedState {
    const state = ref.threadId ? this.executions.get(ref.threadId) ?? this.goals.get(ref.threadId) : undefined;
    if (!state || !ref.turnId || state.ref.turnId !== ref.turnId || state.settled || (state.stopError && !allowStopping)
      || (state.kind === 'goal' && !state.activeTurns.has(ref.turnId))) throw new Error('This Codex turn is not active in the current adapter.');
    return state;
  }

  async steer(ref: ExecutionRef, message: string): Promise<void> {
    const state = this.active(ref);
    if (!message.trim() || message.length > 131072) throw new Error('Codex steering text must be nonempty and within the local size limit.');
    await this.request('turn/steer', {threadId: ref.threadId, expectedTurnId: ref.turnId, input: [{type: 'text', text: message}]});
    this.emit(state, {type: 'codex.steered', message: 'Steering was sent to the active Codex turn.'});
  }

  async interrupt(ref: ExecutionRef): Promise<void> {
    const goal = ref.threadId ? this.goals.get(ref.threadId) : undefined;
    if (goal && !goal.settled) {await this.endGoal(goal, 'cleared', 'Native Codex goal was interrupted by the supervisor.'); return;}
    const state = this.active(ref, true);
    if (state.kind === 'goal') throw new Error('This owned native Codex goal has already ended.');
    this.stop(state, interrupted('Codex turn was interrupted by the supervisor.'), 'codex.interrupted');
    await this.sendInterrupt(state);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    const activeGoals = [...this.goals.values()].filter(state => !state.settled);
    await Promise.allSettled(activeGoals.map(state => this.endGoal(state, 'cleared', 'Codex adapter was closed.')));
    await Promise.allSettled(activeGoals.map(state => state.completion));
    const child = this.child;
    if (child) this.disconnect(child, interrupted('Codex adapter was closed.'));
    this.closed = true;
    await Promise.allSettled([...this.terminations]);
    for (const state of this.goals.values()) if (state.stopTimer) clearTimeout(state.stopTimer);
    this.goals.clear();
    this.uncertainExecutions.clear();
  }
}

export function createCodexAdapter(options: CodexAdapterOptions = {}): CodexAdapter {
  return new LocalCodexAdapter(options);
}
