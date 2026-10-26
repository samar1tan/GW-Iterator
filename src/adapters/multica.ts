export type MulticaConnection = {baseUrl: string; token: string; workspaceId: string; workspaceSlug?: string};
export type MulticaRequestOptions = {signal?: AbortSignal};
export type MulticaClientOptions = {fetch?: typeof fetch; timeoutMs?: number; maxResponseBytes?: number};
type ObjectValue = Record<string, unknown>;
export type MulticaProject = {
  id: string; workspace_id: string; title: string; description?: string | null;
  status: string; priority?: string; updated_at?: string; workflow_id?: string | null;
};
export type MulticaProjectInput = {
  title: string; description?: string | null; status?: string; priority?: string; workflow_id?: string | null;
  resources?: {resource_type: string; resource_ref: ObjectValue; label?: string}[];
};
export type MulticaAgent = {
  id: string; workspace_id: string; name: string; runtime_id: string; status: string;
  description?: string; instructions?: string; model?: string; thinking_level?: string; service_tier?: string;
  runtime_bound?: boolean; runtime_availability?: string; max_concurrent_tasks?: number;
  custom_args?: string[]; runtime_config?: unknown; mcp_config?: unknown; skills?: MulticaSkill[];
  visibility?: string; permission_mode?: string; updated_at?: string;
};
export type MulticaAgentInput = {
  name: string; runtime_id: string; description?: string; instructions?: string; model?: string;
  thinking_level?: string; service_tier?: string; max_concurrent_tasks?: number; custom_args?: string[];
  runtime_config?: ObjectValue; mcp_config?: ObjectValue; skill_ids?: string[];
  visibility?: 'private' | 'workspace'; permission_mode?: 'private' | 'public_to';
  invocation_targets?: {target_type: string; target_id?: string}[];
};
export type MulticaSkill = {
  id: string; name: string; workspace_id?: string; description?: string; content?: string;
  config?: unknown; enabled?: boolean; updated_at?: string;
};
export type MulticaSkillInput = {
  name: string; description: string; content: string; config?: ObjectValue;
  files?: {path: string; content: string}[];
};
export type MulticaRuntime = {
  id: string; daemon_id: string; workspace_id: string; name: string; provider: string; status: string;
  runtime_mode?: string; profile_id?: string | null; last_seen_at?: string | null; metadata?: ObjectValue;
};
export type MulticaModel = {
  id: string; label?: string; provider?: string; default?: boolean; thinking?: unknown;
  service_tiers?: unknown; supports_explicit_standard_service_tier?: boolean;
};
export type MulticaModelRequest = {
  id: string; runtime_id: string; status: string; models?: MulticaModel[]; supported?: boolean; error?: string;
};
export type MulticaIssue = {
  id: string; workspace_id: string; title: string; status: string; description?: string | null;
  identifier?: string; project_id?: string | null; assignee_type?: string | null; assignee_id?: string | null;
  updated_at?: string;
};
export type MulticaIssueInput = {
  title: string; description?: string | null; status?: string; priority?: string; project_id?: string | null;
  assignee_type?: 'agent' | 'member' | 'squad' | null; assignee_id?: string | null; parent_issue_id?: string | null;
  label_ids?: string[]; allow_duplicate?: boolean;
};
// These are mutually exclusive upstream buckets. input_tokens is already uncached.
export type MulticaUsage = {
  model: string; provider?: string; input_tokens: number; output_tokens: number;
  cache_read_tokens?: number; cache_write_tokens?: number; cost_usd_ticks?: number;
};
export type MulticaTask = {
  id: string; workspace_id: string; issue_id: string; agent_id: string; runtime_id: string; status: string;
  attempt?: number; max_attempts?: number; started_at?: string | null; completed_at?: string | null;
  kind?: string; result?: unknown; error?: string | null; failure_reason?: string; usage?: MulticaUsage[];
  can_supplement?: boolean; supplement_capability?: string; supplement_comment_ids?: string[];
};
export type MulticaTaskSupplement = {
  id: string; content: string; issue_id?: string;
  supplements: {task_id: string; agent_id?: string; status: string; failure_reason?: string | null; delivered_at?: string | null}[];
};
export type MulticaTaskMessage = {
  task_id: string; seq: number; type: string; issue_id?: string; call_id?: string; tool?: string;
  content?: string; input?: ObjectValue; output?: string; output_truncated?: boolean | null; created_at?: string;
};
export type MulticaMcpServer = {
  id: string; workspace_id: string; name: string; transport: string; enabled?: boolean; agent_count?: number;
};
export type MulticaRuntimeProfile = {
  id: string; workspace_id: string; display_name: string; protocol_family: string;
  runtime_type?: string; command_name: string; fixed_args?: string[]; enabled: boolean; description?: string | null;
};
export type MulticaRuntimeProfileInput = {
  display_name: string; protocol_family: string; runtime_type?: string; command_name: string;
  fixed_args?: string[]; enabled?: boolean; description?: string;
};
export type MulticaInfo = {
  available: boolean; authenticated: boolean; workspaceId: string; serverVersion?: string;
  checks?: Record<string, string>; error?: {code: string; message: string; status?: number};
};

export class MulticaApiError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly method?: string;
  readonly path?: string;
  constructor(code: string, message: string, detail: {status?: number; method?: string; path?: string} = {}) {
    super(message); this.name = 'MulticaApiError'; this.code = code;
    this.status = detail.status; this.method = detail.method; this.path = detail.path;
  }
}
const invalid = (name: string): never => {throw new MulticaApiError('INVALID_RESPONSE', 'Invalid Multica response: ' + name);};
const object = (value: unknown, name: string): ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : invalid(name);
const string = (value: unknown, name: string): string => typeof value === 'string' ? value : invalid(name);
const required = (row: ObjectValue, key: string): string => {
  const value = string(row[key], key); return value.length ? value : invalid(key);
};
const number = (value: unknown, name: string): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid(name);
const bool = (value: unknown, name: string): boolean => typeof value === 'boolean' ? value : invalid(name);
const array = <T>(value: unknown, parse: (value: unknown) => T): T[] =>
  Array.isArray(value) ? value.map(parse) : invalid('array');
function strings(row: ObjectValue, keys: string[], nullable: string[] = []): ObjectValue {
  return Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key =>
    [key, row[key] === null && nullable.includes(key) ? null : string(row[key], key)]));
}
function numbers(row: ObjectValue, keys: string[]): ObjectValue {
  return Object.fromEntries(keys.filter(key => row[key] !== undefined && row[key] !== null).map(key =>
    [key, number(row[key], key)]));
}
function booleans(row: ObjectValue, keys: string[]): ObjectValue {
  return Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, bool(row[key], key)]));
}
function optional(row: ObjectValue, keys: string[]): ObjectValue {
  return Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
}
function id(value: string): string {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f]/.test(value))
    throw new MulticaApiError('INVALID_REQUEST', 'A nonempty Multica resource ID is required.');
  return encodeURIComponent(value);
}
export function isMulticaTaskTerminal(task: Pick<MulticaTask, 'status'>): boolean {
  return ['completed', 'failed', 'cancelled', 'aborted', 'timeout'].includes(task.status);
}

export class MulticaClient {
  #connection: MulticaConnection;
  #fetch: typeof fetch;
  #timeout: number;
  #maxBytes: number;
  constructor(connection: MulticaConnection, options: MulticaClientOptions = {}) {
    let url: URL;
    try {url = new URL(connection.baseUrl);} catch {throw new MulticaApiError('INVALID_CONNECTION', 'Invalid Multica URL.');}
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
        !connection.token?.trim() || !connection.workspaceId?.trim() || /[\r\n]/.test(connection.token + connection.workspaceId))
      throw new MulticaApiError('INVALID_CONNECTION', 'Multica requires an HTTP URL, a private token and a workspace ID.');
    this.#connection = {...connection, baseUrl: url.href.replace(/\/+$/, '')};
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeout = options.timeoutMs ?? 15_000; this.#maxBytes = options.maxResponseBytes ?? 8 * 1024 * 1024;
    if (!Number.isSafeInteger(this.#timeout) || this.#timeout <= 0 || !Number.isSafeInteger(this.#maxBytes) || this.#maxBytes <= 0)
      throw new MulticaApiError('INVALID_CONNECTION', 'Multica request limits must be positive integers.');
  }
  #redact(text: string): string {return text.replaceAll(this.#connection.token, '[redacted]').slice(0, 500);}
  #scope(row: ObjectValue, requiredWorkspace = true): void {
    if (requiredWorkspace) required(row, 'workspace_id');
    if (row.workspace_id !== undefined && row.workspace_id !== this.#connection.workspaceId)
      throw new MulticaApiError('WORKSPACE_MISMATCH', 'Multica returned a resource from another workspace.');
  }
  async #request(method: string, path: string, body?: unknown, options: MulticaRequestOptions = {}, authenticated = true): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.#timeout);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const headers: Record<string, string> = {Accept: 'application/json'};
    if (authenticated) {headers.Authorization = 'Bearer ' + this.#connection.token; headers['X-Workspace-ID'] = this.#connection.workspaceId;}
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await this.#fetch(this.#connection.baseUrl + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal,
      });
      let text = ''; const reader = response.body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          for (;;) {
            const part = await reader.read(); if (part.done) break;
            size += part.value.byteLength;
            if (size > this.#maxBytes) {await reader.cancel(); throw new MulticaApiError('RESPONSE_TOO_LARGE', 'Multica response exceeded the configured limit.');}
            chunks.push(part.value);
          }
        } finally {reader.releaseLock();}
        const joined = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) {joined.set(chunk, offset); offset += chunk.byteLength;}
        text = new TextDecoder().decode(joined);
      }
      let data: unknown;
      if (text) {try {data = JSON.parse(text);} catch {
        if (response.ok) throw new MulticaApiError('INVALID_RESPONSE', 'Multica returned invalid JSON.');
      }}
      if (!response.ok) {
        const row = data !== null && typeof data === 'object' && !Array.isArray(data) ? data as ObjectValue : {};
        const code = typeof row.code === 'string' ? this.#redact(row.code) : 'HTTP_' + response.status;
        const message = typeof row.error === 'string' ? this.#redact(row.error) : 'Multica request failed.';
        throw new MulticaApiError(code, message, {status: response.status, method, path});
      }
      return data;
    } catch (error) {
      if (error instanceof MulticaApiError) throw error;
      if (options.signal?.aborted) throw new MulticaApiError('ABORTED', 'Multica request was aborted.', {method, path});
      if (timeout.aborted) throw new MulticaApiError('TIMEOUT', 'Multica request timed out.', {method, path});
      throw new MulticaApiError('TRANSPORT_ERROR', 'Could not reach Multica.', {method, path});
    }
  }
  #project = (value: unknown): MulticaProject => {
    const row = object(value, 'project'); this.#scope(row);
    return {id: required(row, 'id'), workspace_id: required(row, 'workspace_id'), title: required(row, 'title'),
      status: required(row, 'status'), ...strings(row, ['description', 'priority', 'updated_at', 'workflow_id'], ['description', 'workflow_id'])};
  };
  #skill = (value: unknown): MulticaSkill => {
    const row = object(value, 'skill'); this.#scope(row, false);
    return {id: required(row, 'id'), name: required(row, 'name'), ...strings(row, ['workspace_id', 'description', 'content', 'updated_at']),
      ...optional(row, ['config']), ...booleans(row, ['enabled'])};
  };
  #agent = (value: unknown): MulticaAgent => {
    const row = object(value, 'agent'); this.#scope(row);
    return {id: required(row, 'id'), workspace_id: required(row, 'workspace_id'), name: required(row, 'name'),
      runtime_id: string(row.runtime_id, 'runtime_id'), status: required(row, 'status'),
      ...strings(row, ['description', 'instructions', 'model', 'thinking_level', 'service_tier', 'runtime_availability', 'visibility', 'permission_mode', 'updated_at']),
      ...booleans(row, ['runtime_bound']), ...numbers(row, ['max_concurrent_tasks']),
      ...optional(row, ['runtime_config', 'mcp_config']),
      ...(row.custom_args === undefined ? {} : {custom_args: array(row.custom_args, v => string(v, 'custom_args'))}),
      ...(row.skills === undefined ? {} : {skills: array(row.skills, this.#skill)})};
  };
  #runtime = (value: unknown): MulticaRuntime => {
    const row = object(value, 'runtime'); this.#scope(row);
    return {id: required(row, 'id'), daemon_id: required(row, 'daemon_id'), workspace_id: required(row, 'workspace_id'), name: required(row, 'name'),
      provider: required(row, 'provider'), status: required(row, 'status'),
      ...strings(row, ['runtime_mode', 'profile_id', 'last_seen_at'], ['profile_id', 'last_seen_at']),
      ...(row.metadata === undefined || row.metadata === null ? {} : {metadata: object(row.metadata, 'metadata')})};
  };
  #issue = (value: unknown): MulticaIssue => {
    const row = object(value, 'issue'); this.#scope(row);
    return {id: required(row, 'id'), workspace_id: required(row, 'workspace_id'), title: required(row, 'title'),
      status: required(row, 'status'), ...strings(row, ['description', 'identifier', 'project_id', 'assignee_type', 'assignee_id', 'updated_at'], ['description', 'project_id', 'assignee_type', 'assignee_id'])};
  };
  #usage = (value: unknown): MulticaUsage => {
    const row = object(value, 'usage');
    return {model: required(row, 'model'), input_tokens: number(row.input_tokens, 'input_tokens'),
      output_tokens: number(row.output_tokens, 'output_tokens'), ...strings(row, ['provider']),
      ...numbers(row, ['cache_read_tokens', 'cache_write_tokens', 'cost_usd_ticks'])};
  };
  #task = (value: unknown): MulticaTask => {
    const row = object(value, 'task'); this.#scope(row);
    return {id: required(row, 'id'), workspace_id: required(row, 'workspace_id'), issue_id: string(row.issue_id, 'issue_id'),
      agent_id: required(row, 'agent_id'), runtime_id: string(row.runtime_id, 'runtime_id'), status: required(row, 'status'),
      ...numbers(row, ['attempt', 'max_attempts']), ...strings(row, ['kind', 'started_at', 'completed_at', 'error', 'failure_reason'], ['started_at', 'completed_at', 'error']),
      ...optional(row, ['result']), ...booleans(row, ['can_supplement']), ...strings(row, ['supplement_capability']),
      ...(row.supplement_comment_ids === undefined ? {} : {supplement_comment_ids: array(row.supplement_comment_ids, v => string(v, 'supplement comment ID'))}),
      ...(row.usage == null ? {} : {usage: array(row.usage, this.#usage)})};
  };
  #message = (value: unknown): MulticaTaskMessage => {
    const row = object(value, 'task message');
    return {task_id: required(row, 'task_id'), seq: number(row.seq, 'seq'), type: required(row, 'type'),
      ...strings(row, ['issue_id', 'call_id', 'tool', 'content', 'output', 'created_at']),
      ...(row.input === undefined ? {} : {input: object(row.input, 'message input')}),
      ...(row.output_truncated === undefined ? {} : {output_truncated: row.output_truncated === null ? null : bool(row.output_truncated, 'output_truncated')})};
  };
  #modelRequest = (value: unknown): MulticaModelRequest => {
    const row = object(value, 'model request');
    return {id: required(row, 'id'), runtime_id: required(row, 'runtime_id'), status: required(row, 'status'),
      ...strings(row, ['error']), ...booleans(row, ['supported']),
      ...(row.models == null ? {} : {models: array(row.models, value => {
        const model = object(value, 'model');
        return {id: required(model, 'id'), ...strings(model, ['label', 'provider']),
          ...booleans(model, ['default', 'supports_explicit_standard_service_tier']), ...optional(model, ['thinking', 'service_tiers'])};
      })})};
  };
  #mcp = (value: unknown): MulticaMcpServer => {
    const row = object(value, 'MCP server'); this.#scope(row);
    return {id: required(row, 'id'), workspace_id: required(row, 'workspace_id'),
      name: required(row, 'name'), transport: required(row, 'transport'),
      ...booleans(row, ['enabled']), ...numbers(row, ['agent_count'])};
  };
  #profile = (value: unknown): MulticaRuntimeProfile => {
    const row = object(value, 'runtime profile'); this.#scope(row);
    return {id: required(row, 'id'), workspace_id: required(row, 'workspace_id'), display_name: required(row, 'display_name'),
      protocol_family: required(row, 'protocol_family'), command_name: required(row, 'command_name'), enabled: bool(row.enabled, 'enabled'),
      ...strings(row, ['runtime_type', 'description'], ['description']),
      ...(row.fixed_args === undefined ? {} : {fixed_args: array(row.fixed_args, v => string(v, 'fixed_args'))})};
  };
  async info(options?: MulticaRequestOptions): Promise<MulticaInfo> {
    const info: MulticaInfo = {available: false, authenticated: false, workspaceId: this.#connection.workspaceId};
    try {
      const health = object(await this.#request('GET', '/healthz', undefined, options, false), 'health');
      info.available = required(health, 'status') === 'ok';
      if (health.checks !== undefined) {
        const checks = object(health.checks, 'health checks');
        info.checks = Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, string(value, 'health check')]));
      }
      const config = object(await this.#request('GET', '/api/config', undefined, options, false), 'config');
      if (config.server_version !== undefined) info.serverVersion = string(config.server_version, 'server_version');
      const me = object(await this.#request('GET', '/api/me', undefined, options), 'authenticated account');
      required(me, 'id'); info.authenticated = true;
    } catch (error) {
      if (!(error instanceof MulticaApiError)) throw error;
      info.error = {code: error.code, message: error.message, ...(error.status === undefined ? {} : {status: error.status})};
    }
    return info;
  }
  async listProjects(o?: MulticaRequestOptions) {
    const row = object(await this.#request('GET', '/api/projects', undefined, o), 'projects');
    const projects = array(row.projects, this.#project);
    if (number(row.total, 'project total') !== projects.length)
      throw new MulticaApiError('INCOMPLETE_RESPONSE', 'Multica returned an incomplete project collection.');
    return projects;
  }
  async getProject(projectId: string, o?: MulticaRequestOptions) {return this.#project(await this.#request('GET', '/api/projects/' + id(projectId), undefined, o));}
  async createProject(input: MulticaProjectInput, o?: MulticaRequestOptions) {return this.#project(await this.#request('POST', '/api/projects', input, o));}
  async updateProject(projectId: string, input: Partial<MulticaProjectInput>, o?: MulticaRequestOptions) {return this.#project(await this.#request('PUT', '/api/projects/' + id(projectId), input, o));}
  async deleteProject(projectId: string, o?: MulticaRequestOptions): Promise<void> {await this.#request('DELETE', '/api/projects/' + id(projectId), undefined, o);}
  async listAgents(o?: MulticaRequestOptions) {return array(await this.#request('GET', '/api/agents', undefined, o), this.#agent);}
  async getAgent(agentId: string, o?: MulticaRequestOptions) {return this.#agent(await this.#request('GET', '/api/agents/' + id(agentId), undefined, o));}
  async createAgent(input: MulticaAgentInput, o?: MulticaRequestOptions) {return this.#agent(await this.#request('POST', '/api/agents', input, o));}
  async updateAgent(agentId: string, input: Partial<MulticaAgentInput>, o?: MulticaRequestOptions) {return this.#agent(await this.#request('PUT', '/api/agents/' + id(agentId), input, o));}
  async archiveAgent(agentId: string, o?: MulticaRequestOptions) {return this.#agent(await this.#request('POST', '/api/agents/' + id(agentId) + '/archive', {}, o));}
  async restoreAgent(agentId: string, o?: MulticaRequestOptions) {return this.#agent(await this.#request('POST', '/api/agents/' + id(agentId) + '/restore', {}, o));}
  async listSkills(o?: MulticaRequestOptions) {return array(await this.#request('GET', '/api/skills', undefined, o), this.#skill);}
  async getSkill(skillId: string, o?: MulticaRequestOptions) {return this.#skill(await this.#request('GET', '/api/skills/' + id(skillId), undefined, o));}
  async createSkill(input: MulticaSkillInput, o?: MulticaRequestOptions) {return this.#skill(await this.#request('POST', '/api/skills', input, o));}
  async updateSkill(skillId: string, input: Partial<MulticaSkillInput>, o?: MulticaRequestOptions) {return this.#skill(await this.#request('PUT', '/api/skills/' + id(skillId), input, o));}
  async listAgentSkills(agentId: string, o?: MulticaRequestOptions) {return array(await this.#request('GET', '/api/agents/' + id(agentId) + '/skills', undefined, o), this.#skill);}
  async setAgentSkills(agentId: string, skillIds: string[], o?: MulticaRequestOptions) {return array(await this.#request('PUT', '/api/agents/' + id(agentId) + '/skills', {skill_ids: skillIds}, o), this.#skill);}
  async listRuntimes(o?: MulticaRequestOptions) {return array(await this.#request('GET', '/api/runtimes', undefined, o), this.#runtime);}
  async requestModels(runtimeId: string, force = false, o?: MulticaRequestOptions) {return this.#modelRequest(await this.#request('POST', '/api/runtimes/' + id(runtimeId) + '/models' + (force ? '?force=true' : ''), {}, o));}
  async getModelRequest(runtimeId: string, requestId: string, o?: MulticaRequestOptions) {return this.#modelRequest(await this.#request('GET', '/api/runtimes/' + id(runtimeId) + '/models/' + id(requestId), undefined, o));}
  async createIssue(input: MulticaIssueInput, o?: MulticaRequestOptions) {return this.#issue(await this.#request('POST', '/api/issues', input, o));}
  async getIssue(issueId: string, o?: MulticaRequestOptions) {return this.#issue(await this.#request('GET', '/api/issues/' + id(issueId), undefined, o));}
  async updateIssue(issueId: string, input: Partial<MulticaIssueInput>, o?: MulticaRequestOptions) {return this.#issue(await this.#request('PUT', '/api/issues/' + id(issueId), input, o));}
  async listTaskRuns(issueId: string, o?: MulticaRequestOptions) {return array(await this.#request('GET', '/api/issues/' + id(issueId) + '/task-runs', undefined, o), this.#task);}
  async getTask(issueId: string, taskId: string, o?: MulticaRequestOptions): Promise<MulticaTask> {
    id(taskId);
    const task = (await this.listTaskRuns(issueId, o)).find(task => task.id === taskId && task.issue_id === issueId);
    if (!task) throw new MulticaApiError('TASK_NOT_FOUND', 'The Multica task is not present in this issue history.', {status: 404});
    return task;
  }
  async listAgentTasks(agentId: string, o?: MulticaRequestOptions) {return array(await this.#request('GET', '/api/agents/' + id(agentId) + '/tasks', undefined, o), this.#task);}
  async rerunIssue(issueId: string, taskId?: string, o?: MulticaRequestOptions) {return this.#task(await this.#request('POST', '/api/issues/' + id(issueId) + '/rerun', taskId ? {task_id: taskId} : {}, o));}
  async cancelTask(issueId: string, taskId: string, o?: MulticaRequestOptions) {return this.#task(await this.#request('POST', '/api/issues/' + id(issueId) + '/tasks/' + id(taskId) + '/cancel', {}, o));}
  async appendTaskInstruction(issueId: string, taskId: string, content: string, clientRequestId: string, o?: MulticaRequestOptions): Promise<MulticaTaskSupplement> {
    if (!content.trim() || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientRequestId))
      throw new MulticaApiError('INVALID_REQUEST', 'An instruction and a stable UUID client request ID are required.');
    const row = object(await this.#request('POST', '/api/issues/' + id(issueId) + '/tasks/' + id(taskId) + '/supplements',
      {content, client_request_id: clientRequestId}, o), 'task supplement');
    return {id: required(row, 'id'), content: required(row, 'content'), ...strings(row, ['issue_id']),
      supplements: array(row.supplements, value => {
        const receipt = object(value, 'supplement receipt');
        const target = required(receipt, 'task_id');
        if (target !== taskId) invalid('supplement task ID');
        return {task_id: target, status: required(receipt, 'status'), ...strings(receipt, ['agent_id', 'failure_reason', 'delivered_at'], ['failure_reason', 'delivered_at'])};
      })};
  }
  async listTaskMessages(taskId: string, since?: number, o?: MulticaRequestOptions) {
    if (since !== undefined) number(since, 'since');
    return array(await this.#request('GET', '/api/tasks/' + id(taskId) + '/messages' + (since === undefined ? '' : '?since=' + since), undefined, o), this.#message);
  }
  async getTimeline(issueId: string, o?: MulticaRequestOptions) {return array(await this.#request('GET', '/api/issues/' + id(issueId) + '/timeline', undefined, o), value => object(value, 'timeline entry'));}
  async listMcpServers(o?: MulticaRequestOptions) {return array(await this.#request('GET', '/api/workspaces/' + id(this.#connection.workspaceId) + '/mcp-servers', undefined, o), this.#mcp);}
  async createMcpServer(input: {name: string; config: ObjectValue}, o?: MulticaRequestOptions) {return this.#mcp(await this.#request('POST', '/api/workspaces/' + id(this.#connection.workspaceId) + '/mcp-servers', input, o));}
  async updateMcpServer(serverId: string, input: {name: string; config: ObjectValue}, o?: MulticaRequestOptions) {return this.#mcp(await this.#request('PUT', '/api/workspaces/' + id(this.#connection.workspaceId) + '/mcp-servers/' + id(serverId), input, o));}
  async deleteMcpServer(serverId: string, o?: MulticaRequestOptions): Promise<void> {await this.#request('DELETE', '/api/workspaces/' + id(this.#connection.workspaceId) + '/mcp-servers/' + id(serverId), undefined, o);}
  async listAgentMcpServers(agentId: string, o?: MulticaRequestOptions) {return array(await this.#request('GET', '/api/agents/' + id(agentId) + '/mcp-servers', undefined, o), this.#mcp);}
  async addAgentMcpServer(agentId: string, serverId: string, o?: MulticaRequestOptions) {return array(await this.#request('POST', '/api/agents/' + id(agentId) + '/mcp-servers', {server_id: serverId}, o), this.#mcp);}
  async setAgentMcpServerEnabled(agentId: string, serverId: string, enabled: boolean, o?: MulticaRequestOptions) {return array(await this.#request('PUT', '/api/agents/' + id(agentId) + '/mcp-servers/' + id(serverId) + '/enabled', {enabled}, o), this.#mcp);}
  async removeAgentMcpServer(agentId: string, serverId: string, o?: MulticaRequestOptions) {return array(await this.#request('DELETE', '/api/agents/' + id(agentId) + '/mcp-servers/' + id(serverId), undefined, o), this.#mcp);}
  async listRuntimeProfiles(o?: MulticaRequestOptions) {
    const row = object(await this.#request('GET', '/api/workspaces/' + id(this.#connection.workspaceId) + '/runtime-profiles', undefined, o), 'runtime profiles');
    return array(row.runtime_profiles, this.#profile);
  }
  async getRuntimeProfile(profileId: string, o?: MulticaRequestOptions) {return this.#profile(await this.#request('GET', '/api/workspaces/' + id(this.#connection.workspaceId) + '/runtime-profiles/' + id(profileId), undefined, o));}
  async createRuntimeProfile(input: MulticaRuntimeProfileInput, o?: MulticaRequestOptions) {return this.#profile(await this.#request('POST', '/api/workspaces/' + id(this.#connection.workspaceId) + '/runtime-profiles', input, o));}
  async updateRuntimeProfile(profileId: string, input: Partial<MulticaRuntimeProfileInput>, o?: MulticaRequestOptions) {return this.#profile(await this.#request('PUT', '/api/workspaces/' + id(this.#connection.workspaceId) + '/runtime-profiles/' + id(profileId), input, o));}
  async deleteRuntimeProfile(profileId: string, o?: MulticaRequestOptions): Promise<void> {await this.#request('DELETE', '/api/workspaces/' + id(this.#connection.workspaceId) + '/runtime-profiles/' + id(profileId), undefined, o);}
}

export function createMulticaClient(connection: MulticaConnection, options?: MulticaClientOptions): MulticaClient {
  return new MulticaClient(connection, options);
}
