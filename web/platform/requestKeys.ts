type RequestKey = {key:string;shiftKey?:boolean;altKey?:boolean;ctrlKey?:boolean;metaKey?:boolean;repeat?:boolean;isComposing?:boolean;keyCode?:number};

export function requestEnterAction(event:RequestKey,composing=false):'native'|'submit'|'suppress'{
  if(event.key!=='Enter'||event.shiftKey||event.altKey||composing||event.isComposing||event.keyCode===229)return'native';
  return event.repeat?'suppress':'submit';
}
