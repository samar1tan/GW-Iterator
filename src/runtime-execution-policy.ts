export const MULTICA_SOURCE_REVISION = 'a097f592be73067d56908ca50ece557fa2af1293';
export const SUPERVISED_EXECUTION_POLICY = 'supervised-no-quotas-v1';
export const MULTICA_EXECUTION_PATCH_SHA256 = 'b91cf7c5c57ed163db40b00bc09d8a13b655cb0e555213d4f72805b9dabd80d5';

export type RuntimeExecutionIdentity = {pid:number;profile:string;daemonId:string;cliCommit:string};

/** Verify the currently serving process; active work does not invalidate its policy. */
export function hasSupervisedExecutionHealth(value:unknown,identity:RuntimeExecutionIdentity):boolean {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const health=value as Record<string,unknown>;
  return health.status==='running'&&health.pid===identity.pid&&health.profile===identity.profile&&health.daemon_id===identity.daemonId
    &&identity.cliCommit===MULTICA_SOURCE_REVISION&&health.cli_commit===identity.cliCommit&&health.gwi_supervised_execution===true
    &&health.gwi_execution_patch_sha===MULTICA_EXECUTION_PATCH_SHA256&&health.gwi_agent_timeout_disabled===true
    &&health.gwi_idle_watchdog_disabled===true&&health.gwi_tool_watchdog_disabled===true;
}
