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
    function screenshotMatch(match,currentVersion){
      const current=get(currentVersion);
      const available=id=>[...catalogs.keys()].filter(version=>catalogs.get(version).byId.has(id));
      const valid=(id,list)=>[...new Set(list||[])].filter(version=>catalogs.get(version)?.byId.has(id));
      const ordered=list=>list.slice().sort((a,b)=>(b===currentVersion)-(a===currentVersion)||b.localeCompare(a,'en',{numeric:true}));
      const sources=candidate=>ordered(valid(candidate.id,candidate.sourceVersions?.length?candidate.sourceVersions:available(candidate.id)));
      const sourceVersions=sources(match),sourceVersion=sourceVersions[0];
      if(!sourceVersion)return {...match,id:null,candidates:(match.candidates||[]).flatMap(candidate=>sources(candidate).slice(0,1).map(version=>({id:cardRef(candidate.id,version),score:candidate.score})))};
      const source=get(sourceVersion).byId.get(match.id),currentCard=current.byId.get(match.id);
      const possibleVersions=valid(match.id,match.possibleVersions?.length?match.possibleVersions:sourceVersions);
      const versionConflict=!sameDefinition(source,currentCard);
      const versionAmbiguous=possibleVersions.some(version=>!sameDefinition(source,get(version).byId.get(match.id)));
      const id=cardRef(match.id,sourceVersion),candidates=[],seen=new Set();
      const add=(baseId,version,score)=>{
        const ref=cardRef(baseId,version);if(seen.has(ref))return;
        seen.add(ref);candidates.push({id:ref,score});
      };
      add(match.id,sourceVersion,match.candidates?.[0]?.score);
      // Always reserve a recommendation for the selected page version, even when
      // its face was not among the image matcher's top four identities.
      if(currentCard)add(match.id,currentVersion,match.candidates?.find(c=>c.id===match.id)?.score);
      for(const version of ordered(possibleVersions))add(match.id,version,match.candidates?.find(c=>c.id===match.id)?.score);
      for(const candidate of match.candidates||[])for(const version of sources(candidate).slice(0,1))add(candidate.id,version,candidate.score);
      const reviewReason=versionConflict
        ? (currentCard ? `原图匹配 ${sourceVersion}，与当前 ${currentVersion} 的卡牌不同` : `原图匹配 ${sourceVersion}，当前 ${currentVersion} 未收录此卡`)
        : versionAmbiguous ? '卡面无法可靠区分存在差异的版本，请选择卡牌版本' : match.reviewReason;
      return {...match,id,candidates:candidates.slice(0,8),sourceVersion,sourceVersions,possibleVersions,versionConflict,versionAmbiguous,
        ...(versionConflict||versionAmbiguous?{reviewLevel:'critical',reviewReason,needsReview:true}: {})};
    }
    function screenshotCards(currentVersion){
      get(currentVersion);
      return [...catalogs.values()].flatMap(entry=>entry.cards.map(card=>resolve(cardRef(card.id,entry.id),currentVersion)));
    }
    return Object.freeze({legacyVersion,defaultVersion,
      versions:Object.freeze([...entries].sort((a,b)=>b.id.localeCompare(a.id,'en',{numeric:true})).map(({cards,...info})=>Object.freeze(info))),
      hasVersion:id=>catalogs.has(id),getCards:id=>get(id).cards,
      getAllCards:()=>Object.freeze([...all.values()]),cardsForBoard,cardRef,hasCardRef,resolve,sameDefinition,screenshotMatch,screenshotCards,
      label:id=>get(id||legacyVersion).label
    });
  }
  const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SpireCardVersions=api;
})(typeof globalThis!=='undefined'?globalThis:this);
