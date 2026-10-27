import type {Stage} from '../../src/contracts';

/** Keep existing positions; appended and duplicated nodes need a genuinely free slot. */
export function freeStagePosition(stages:Stage[],preferred:{x:number;y:number}):{x:number;y:number} {
  const position={...preferred};
  const occupied=()=>stages.some(stage=>stage.position&&Math.abs(stage.position.x-position.x)<284&&Math.abs(stage.position.y-position.y)<290);
  while(occupied())position.y+=322;
  return position;
}

export function appendedStageContext(stages:Stage[],selectedId?:string):{dependsOn:string[];position:{x:number;y:number}} {
  const selected=stages.find(stage=>stage.id===selectedId)??stages.at(-1);
  return {dependsOn:selected?[selected.id]:[],position:freeStagePosition(stages,{x:(selected?.position?.x??-299)+334,y:selected?.position?.y??35})};
}
