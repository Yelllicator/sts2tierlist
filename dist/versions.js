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
        const value=Object.freeze({...card,baseId:card.id,gameVersion:entry.id});byId.set(card.id,value);
        // Keep the newest available definition as the explicit fallback for cross-version boards.
        if(!all.has(card.id)||entry.id===defaultVersion)all.set(card.id,value);
      }
      catalogs.set(entry.id,{...entry,cards:Object.freeze([...byId.values()]),byId});
    }
    if(!catalogs.has(defaultVersion))throw Error('缺少默认卡牌版本');
    const get=id=>{const result=catalogs.get(id);if(!result)throw Error('不支持的游戏版本');return result;};
    function cardRef(baseId,version){
      const entry=get(version);
      if(typeof baseId!=='string'||baseId.includes('@')||!entry.byId.has(baseId))throw Error('版本目录含未知卡牌');
      return baseId+'@'+version;
    }
    function hasCardRef(ref){
      if(typeof ref!=='string')return false;
      const parts=ref.split('@');
      return parts.length===2&&!!catalogs.get(parts[1])?.byId.has(parts[0]);
    }
    function resolve(ref,gameVersion=legacyVersion){
      const entry=get(gameVersion);
      if(typeof ref!=='string')throw Error('方案含未知卡牌');
      let card;
      if(ref.includes('@')){
        if(!hasCardRef(ref))throw Error('方案含未知卡牌或版本');
        const [baseId,version]=ref.split('@');card=get(version).byId.get(baseId);
      }else card=entry.byId.get(ref)||all.get(ref);
      if(!card)throw Error('方案含未知卡牌');
      return Object.freeze({...card,id:ref,baseId:card.baseId,unavailableInVersion:card.gameVersion!==entry.id});
    }
    function sameDefinition(a,b){
      if(!a||!b)return false;
      const scalar=['name','english','description','descriptionEn','color','type','rarity','cost','costKind','starCost'];
      if(scalar.some(field=>String(a[field]??'')!==String(b[field]??'')))return false;
      for(const field of ['multiplayerOnly','soloOnly'])if((a[field]===true)!==(b[field]===true))return false;
      const keywords=card=>[...(card.keywords||[])].sort();
      if(JSON.stringify(keywords(a))!==JSON.stringify(keywords(b)))return false;
      // Older snapshots lack these extra fields; absence is not a rule change.
      for(const field of ['descriptionUpgraded','descriptionUpgradedEn'])if(a[field]!=null&&b[field]!=null&&a[field]!==b[field])return false;
      return true;
    }
    function cardsForBoard(board){
      const version=board.gameVersion||legacyVersion,entry=get(version),result=entry.cards.map(card=>resolve(card.id,version));
      const used=new Set(Object.values(board.rows||{}).flat());
      for(const id of used)if(!entry.byId.has(id))result.push(resolve(id,version));
      return result;
    }
    return Object.freeze({legacyVersion,defaultVersion,
      versions:Object.freeze([...entries].sort((a,b)=>b.id.localeCompare(a.id,'en',{numeric:true})).map(({cards,...info})=>Object.freeze(info))),
      hasVersion:id=>catalogs.has(id),getCards:id=>get(id).cards,
      getAllCards:()=>Object.freeze([...all.values()]),cardsForBoard,cardRef,hasCardRef,resolve,sameDefinition,
      label:id=>get(id||legacyVersion).label
    });
  }
  const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SpireCardVersions=api;
})(typeof globalThis!=='undefined'?globalThis:this);
