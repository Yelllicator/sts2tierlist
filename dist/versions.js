'use strict';
((root)=>{
  function create(legacyCards,versions){
    const legacyVersion='0.103.3',defaultVersion='0.111.0';
    const entries=[...versions,{id:legacyVersion,label:'旧版 0.103.3',channel:'legacy',cards:legacyCards}];
    const catalogs=new Map(),all=new Map();
    for(const entry of entries){
      if(catalogs.has(entry.id)||!Array.isArray(entry.cards))throw Error('卡牌版本目录无效');
      const byId=new Map();
      for(const card of entry.cards){
        if(byId.has(card.id))throw Error('版本目录含重复卡牌');
        const value=Object.freeze({...card,gameVersion:entry.id});byId.set(card.id,value);
        // Keep the newest available definition as the explicit fallback for cross-version boards.
        if(!all.has(card.id)||entry.id===defaultVersion)all.set(card.id,value);
      }
      catalogs.set(entry.id,{...entry,cards:Object.freeze([...byId.values()]),byId});
    }
    if(!catalogs.has(defaultVersion))throw Error('缺少默认卡牌版本');
    const get=id=>{const result=catalogs.get(id);if(!result)throw Error('不支持的游戏版本');return result;};
    function cardsForBoard(board){
      const entry=get(board.gameVersion||legacyVersion),result=[...entry.cards];
      const used=new Set(Object.values(board.rows||{}).flat());
      for(const id of used)if(!entry.byId.has(id)){
        const fallback=all.get(id);if(!fallback)throw Error('方案含未知卡牌');
        result.push(Object.freeze({...fallback,unavailableInVersion:true}));
      }
      return result;
    }
    return Object.freeze({legacyVersion,defaultVersion,
      versions:Object.freeze([...entries].sort((a,b)=>b.id.localeCompare(a.id,'en',{numeric:true})).map(({cards,...info})=>Object.freeze(info))),
      hasVersion:id=>catalogs.has(id),getCards:id=>get(id).cards,
      getAllCards:()=>Object.freeze([...all.values()]),cardsForBoard,
      label:id=>get(id||legacyVersion).label
    });
  }
  const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SpireCardVersions=api;
})(typeof globalThis!=='undefined'?globalThis:this);
