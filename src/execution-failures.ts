export function isNativeCapacityFailure(message:unknown,code?:unknown):boolean {
  const nativeCodes=new Set(['model_at_capacity','model_capacity_exceeded','modelatcapacity','modelcapacityexceeded']);
  if(typeof code==='string'&&nativeCodes.has(code.trim().toLowerCase()))return true;
  return typeof message==='string'&&message.replace(/\s+/g,' ').toLowerCase().includes('selected model is at capacity. please try a different model.');
}
