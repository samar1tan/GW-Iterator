/** Creation is authoritative; an observation failure cannot turn it into a failed start. */
export async function recordWorkStart<T>(write:()=>Promise<T>,record:(receipt:T)=>void,observe:()=>Promise<void>,onObservationError:(error:unknown)=>void):Promise<T> {
  const receipt=await write();
  record(receipt);
  try{await observe();}catch(error){onObservationError(error);}
  return receipt;
}

/** Retry an uncertain submission unchanged; explicitly edited text starts a new request. */
export function submittedDraftKey(request:string,stored:string,createKey:()=>string):{request:string;key:string} {
  try {
    const value:unknown=JSON.parse(stored);
    if(value&&typeof value==='object'&&'request' in value&&'key' in value&&value.request===request&&typeof value.key==='string'&&value.key.length>0&&value.key.length<=200)return {request,key:value.key};
  }catch{}
  return {request,key:createKey()};
}
