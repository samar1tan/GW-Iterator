/** A saved write releases its mutex before observation; later controls own later errors. */
export function createStageControl(){
  let version=0,writing=false,stopped=false;
  return{
    get version(){return version;},
    get blocked(){return writing||stopped;},
    begin(){if(writing||stopped)return;writing=true;return ++version;},
    current(id:number){return version===id;},
    release(id:number,confirmedStop=false){if(version!==id)return false;writing=false;stopped||=confirmedStop;return true;},
  };
}
