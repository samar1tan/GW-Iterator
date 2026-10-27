/** Resolve user source input without relying on the browser host platform. */
export function knowledgePath(workspace:string,input:string):string {
  const value=input.trim();
  if(!value)return '';
  const windows=/^[a-z]:[\\/]/i.test(workspace)||workspace.startsWith('\\\\');
  if(value.startsWith('/')||/^[a-z]:[\\/]/i.test(value)||(windows&&value.startsWith('\\')))return value;
  const separator=windows?'\\':'/';
  return workspace.replace(/[\\/]+$/,'')+separator+value;
}
