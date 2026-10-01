'use strict';
((root) => {
  const clone=value=>JSON.parse(JSON.stringify(value));
  const DEFAULT_TITLE='静默猎手 · 卡牌排行';
  const MAX_TIER_NAME_LENGTH=300;
  const DEFAULT_TIERS=[{id:'foundation',name:'底层逻辑',color:'#ee9691'},{id:'s',name:'S',color:'#efbd87'},{id:'a',name:'A',color:'#efda88'},{id:'b',name:'B',color:'#e6e995'},{id:'c',name:'C',color:'#b9db9d'},{id:'d',name:'D',color:'#8acf9b'}];
  const TEMPLATES=[
    {id:'ironclad',name:'铁甲战士',english:'THE IRONCLAD',color:'#dc766b',theme:{bg:'#1b1011',panel:'#2a191a',row:'#1c1213',alternate:'#241719',line:'#533236',accent:'#f0ad8b',muted:'#b69a97',glow:'#743b3866'}},
    {id:'silent',name:'静默猎手',english:'THE SILENT',color:'#86bc76',theme:{bg:'#101612',panel:'#19201b',row:'#121811',alternate:'#161c15',line:'#333b31',accent:'#dfc58b',muted:'#929e93',glow:'#23322566'}},
    {id:'defect',name:'故障机器人',english:'THE DEFECT',color:'#70b9e3',theme:{bg:'#101720',panel:'#182635',row:'#111d29',alternate:'#172535',line:'#304b62',accent:'#95cee9',muted:'#94aabb',glow:'#315f8066'}},
    {id:'necrobinder',name:'亡灵契约师',english:'THE NECROBINDER',color:'#b493df',theme:{bg:'#18111f',panel:'#261d32',row:'#1b1424',alternate:'#231b2e',line:'#4b3a60',accent:'#d0b6ec',muted:'#ab9cba',glow:'#57387866'}},
    {id:'regent',name:'储君',english:'THE REGENT',color:'#ecc25d',theme:{bg:'#1c1710',panel:'#2c2418',row:'#211a10',alternate:'#2a2115',line:'#51422b',accent:'#efc96f',muted:'#b8ab8a',glow:'#775d2766'}},
    {id:'colorless',name:'无色牌',english:'COLORLESS',color:'#c6d4da',theme:{bg:'#15191d',panel:'#232a30',row:'#191f24',alternate:'#20272d',line:'#424d55',accent:'#d0dde3',muted:'#a6b3bb',glow:'#59687355'}},
    {id:'custom',name:'无预设',english:'YOUR COLLECTION',color:'#baa999',theme:{bg:'#191714',panel:'#28241f',row:'#1e1b17',alternate:'#26211c',line:'#4d443b',accent:'#d8bfa3',muted:'#afa497',glow:'#66534755'}}
  ];
  const RESERVED=new Set(['pool','__proto__','constructor','prototype']);
  const templateById=new Map(TEMPLATES.map(t=>[t.id,t]));
  const colorOf=card=>card.color||'silent';
  function matches(card,filters={}){
    if(filters.color&&filters.color!=='all'&&colorOf(card)!==filters.color)return false;
    if(filters.type&&filters.type!=='all'&&card.type!==filters.type)return false;
    if(filters.multiplayer==='only'&&card.multiplayerOnly!==true)return false;
    if(filters.multiplayer==='exclude'&&card.multiplayerOnly===true)return false;
    const cost=String(card.cost),wanted=filters.cost||'all';
    if(wanted!=='all'&&(wanted==='4+'?!(Number(cost)>=4):wanted!==cost))return false;
    const query=(filters.query||'').trim().toLowerCase();
    return !query||[card.name,card.english,card.id].join(' ').toLowerCase().includes(query);
  }
  const SORT_COLORS=['ironclad','silent','regent','necrobinder','defect','colorless'];
  const SORT_RARITIES=['基础','普通','罕见','稀有','古老'];
  const SORT_TYPES=['攻击','技能','能力'];
  const DEFAULT_POOL_SORT=Object.freeze(['rarity','cost','type'].map(key=>Object.freeze({key,direction:'none'})));
  function normalizePoolSort(input){
    if(input===undefined)return DEFAULT_POOL_SORT.map(item=>({...item}));
    if(!Array.isArray(input)||input.length!==3)throw Error('待排排序需包含稀有度、费用和类型三个条件');
    const keys=new Set(),result=[];
    for(const item of input){
      if(!item||typeof item!=='object'||Array.isArray(item)||!['rarity','cost','type'].includes(item.key)||keys.has(item.key)||!['none','asc','desc'].includes(item.direction))throw Error('待排排序条件无效或重复');
      keys.add(item.key);result.push({key:item.key,direction:item.direction});
    }
    return result;
  }
  const sortIndex=(order,value)=>{const index=order.indexOf(value);return index<0?order.length:index;};
  function comparePoolCost(a,b){
    const value=card=>{const text=String(card.cost),number=Number(text);return text.trim()!==''&&Number.isFinite(number)&&number>=0?[0,number]:text==='X'?[1,0]:[2,0];};
    const left=value(a),right=value(b);return left[0]-right[0]||left[1]-right[1];
  }
  function sortPool(ids,byId,settings){
    if(!Array.isArray(ids))throw Error('待排卡牌列表无效');
    const active=normalizePoolSort(settings).filter(item=>item.direction!=='none');
    if(!active.length)return [...ids];
    const entries=ids.map((id,index)=>{const card=byId?.get(id);if(!card)throw Error('缺少待排卡牌资料：'+id);return {id,index,card};});
    entries.sort((a,b)=>{
      for(const item of active){
        const compared=item.key==='cost'?comparePoolCost(a.card,b.card):item.key==='rarity'?sortIndex(SORT_RARITIES,a.card.rarity)-sortIndex(SORT_RARITIES,b.card.rarity):sortIndex(SORT_TYPES,a.card.type)-sortIndex(SORT_TYPES,b.card.type);
        if(compared)return item.direction==='desc'?-compared:compared;
      }
      return a.index-b.index;
    });
    return entries.map(entry=>entry.id);
  }
  function costOrder(card){
    const value=String(card.cost);if(value==='X')return 100;
    const number=Number(value);return value.trim()!==''&&Number.isFinite(number)&&number>=0?number:101;
  }
  function compareCards(a,b){
    return sortIndex(SORT_COLORS,colorOf(a))-sortIndex(SORT_COLORS,colorOf(b))
      ||sortIndex(SORT_RARITIES,a.rarity)-sortIndex(SORT_RARITIES,b.rarity)
      ||sortIndex(SORT_TYPES,a.type)-sortIndex(SORT_TYPES,b.type)
      ||costOrder(a)-costOrder(b)
      ||String(a.english||a.id).localeCompare(String(b.english||b.id),'en')
      ||a.id.localeCompare(b.id,'en');
  }
  function createModel(cards,reference,versionCatalog=null){
    const known=new Set(cards.map(c=>c.id));
    function versionFields(id){
      if(!versionCatalog)return {};
      if(typeof id!=='string'||!versionCatalog.hasVersion(id))throw Error('游戏版本无效');
      return {gameVersion:id};
    }
    const versionCards=id=>versionCatalog?versionCatalog.getCards(id):cards;
    function createTemplate(templateId,language='zh',gameVersion=versionCatalog?.defaultVersion){
      const template=templateById.get(templateId);if(!template)throw Error('模板不存在');
      const version=versionFields(gameVersion);
      const tiers=clone(DEFAULT_TIERS),rows=Object.fromEntries(tiers.map(t=>[t.id,[]]));
      rows.pool=templateId==='custom'?[]:versionCards(gameVersion).filter(c=>colorOf(c)===templateId).map(c=>c.id);
      return {version:3,...version,templateId,title:templateId==='custom'?'我的卡牌排行':template.name+' · 卡牌排行',language,tiers,rows};
    }
    function original(language='en',gameVersion=versionCatalog?.legacyVersion){
      const doc=createTemplate('silent',language,gameVersion);
      if(reference==null)return doc;
      const rows=clone(reference),used=new Set(Object.values(rows).flat());
      rows.pool=versionCards(gameVersion).filter(c=>colorOf(c)==='silent'&&!used.has(c.id)).map(c=>c.id);
      return {...doc,title:DEFAULT_TITLE,rows};
    }
    function validate(input){
      if(!input||typeof input!=='object'||Array.isArray(input))throw Error('方案格式不正确');
      const poolSort=Object.hasOwn(input,'poolSort')?{poolSort:normalizePoolSort(input.poolSort)}:{};
      let value=input;
      if(value.version===1)value={...createTemplate('silent','en',versionCatalog?.legacyVersion),title:DEFAULT_TITLE,rows:value.rows};
      else if(value.version===2)value={...value,version:3,...(versionCatalog?{gameVersion:versionCatalog.legacyVersion}:{}),templateId:'silent'};
      else if(value.version!==3)throw Error('不支持的方案版本');
      const version=versionFields(Object.hasOwn(value,'gameVersion')?value.gameVersion:versionCatalog?.legacyVersion);
      if(!templateById.has(value.templateId))throw Error('方案模板无效');
      if(typeof value.title!=='string'||!value.title.trim()||value.title.trim().length>80)throw Error('标题需为 1–80 个字符');
      if(!['en','zh'].includes(value.language))throw Error('不支持的卡面语言');
      if(!Array.isArray(value.tiers)||!value.tiers.length||value.tiers.length>24)throw Error('请保留 1–24 个评级档次');
      const tierIds=new Set();
      const tiers=value.tiers.map(t=>{
        if(!t||typeof t.id!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(t.id)||RESERVED.has(t.id)||tierIds.has(t.id))throw Error('评级 ID 无效或重复');
        if(typeof t.name!=='string'||!t.name.trim()||t.name.trim().length>MAX_TIER_NAME_LENGTH)throw Error('评级名称需为 1–300 个字符');
        if(typeof t.color!=='string'||!/^#[0-9a-f]{6}$/i.test(t.color))throw Error('评级颜色无效');
        tierIds.add(t.id);return {id:t.id,name:t.name.trim(),color:t.color.toLowerCase()};
      });
      if(!value.rows||typeof value.rows!=='object'||Array.isArray(value.rows))throw Error('方案缺少卡牌分档');
      const required=[...tierIds,'pool'];
      if(Object.keys(value.rows).some(id=>!required.includes(id)))throw Error('方案含未定义的评级');
      const seen=new Set(),rows={};
      for(const id of required){
        if(!Object.hasOwn(value.rows,id)||!Array.isArray(value.rows[id]))throw Error('方案缺少评级中的卡牌列表');
        rows[id]=value.rows[id].map(card=>{
          if(!known.has(card)||seen.has(card))throw Error('方案含未知或重复卡牌');
          seen.add(card);return card;
        });
      }
      // Membership is intentional: omitted cards stay excluded, including after reload.
      return {version:3,...version,templateId:value.templateId,title:value.title.trim(),language:value.language,tiers,rows,...poolSort};
    }
    function setPoolSort(doc,settings){return {...validate(doc),poolSort:normalizePoolSort(settings)};}
    function setGameVersion(doc,id){
      if(!versionCatalog)throw Error('未配置游戏版本目录');
      const next=validate(doc);return {...next,...versionFields(id)};
    }
    function locate(doc,id){return Object.keys(doc.rows).find(t=>doc.rows[t].includes(id));}
    function move(doc,id,tier,before=null){
      if(!known.has(id)||!locate(doc,id)||!Object.hasOwn(doc.rows,tier)||id===before)return clone(doc);
      const next=clone(doc);for(const row of Object.values(next.rows)){const at=row.indexOf(id);if(at>=0)row.splice(at,1);}
      const at=before?next.rows[tier].indexOf(before):-1;next.rows[tier].splice(at<0?next.rows[tier].length:at,0,id);return validate(next);
    }
    function removeTier(doc,id){
      if(doc.tiers.length<=1)throw Error('至少保留一个评级档次');
      if(!doc.tiers.some(t=>t.id===id))throw Error('评级不存在');
      const next=clone(doc);next.rows.pool.push(...next.rows[id]);delete next.rows[id];next.tiers=next.tiers.filter(t=>t.id!==id);return validate(next);
    }
    function setPool(doc,ids){
      if(!Array.isArray(ids)||ids.some(id=>!known.has(id)))throw Error('待排卡牌列表无效');
      const next=clone(doc),ranked=new Set(doc.tiers.flatMap(t=>doc.rows[t.id]));
      next.rows.pool=[...new Set(ids)].filter(id=>!ranked.has(id));return validate(next);
    }
    const addToPool=(doc,ids)=>setPool(doc,[...doc.rows.pool,...ids]);
    const removeFromPool=(doc,ids)=>{const remove=new Set(ids);return setPool(doc,doc.rows.pool.filter(id=>!remove.has(id)));};
    function clearRanks(doc){const next=clone(doc);next.rows.pool=[...doc.rows.pool,...doc.tiers.flatMap(t=>doc.rows[t.id])];for(const t of next.tiers)next.rows[t.id]=[];return validate(next);}
    function autoColorTiers(doc){
      const next=validate(doc),count=next.tiers.length;
      next.tiers.forEach((tier,i)=>{
        const hue=count===1?0:120*i/(count-1),s=.68,l=.73;
        const a=s*Math.min(l,1-l);
        const channel=n=>{const k=(n+hue/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');};
        tier.color='#'+channel(0)+channel(8)+channel(4);
      });
      return next;
    }
    function fromScreenshot(doc,draft){
      const base=validate(doc);
      if(!draft||!Array.isArray(draft.tiers)||!draft.tiers.length||draft.tiers.length>24)throw Error('截图需包含 1–24 个评级档次');
      const tiers=[],rows={},ranked=new Set();
      draft.tiers.forEach((tier,index)=>{
        if(!tier||!Array.isArray(tier.cards))throw Error('截图卡牌列表无效');
        const id='screenshot_'+index;
        tiers.push({id,name:tier.name,color:tier.color});
        rows[id]=tier.cards.map(card=>{
          if(typeof card!=='string'||!known.has(card))throw Error('请先确认所有卡牌，或移除无法识别的图片');
          if(ranked.has(card))throw Error('截图中存在重复卡牌，请先校对');
          ranked.add(card);return card;
        });
      });
      if(!ranked.size)throw Error('请至少选择一张卡牌');
      rows.pool=Object.values(base.rows).flat().filter(id=>!ranked.has(id));
      return validate({...base,title:draft.title,tiers,rows});
    }
    function validateWorkspace(input){
      if(!input||input.format!=='spire-tier-workspace'||input.version!==3||!templateById.has(input.activeTemplate)||!input.boards||typeof input.boards!=='object'||Array.isArray(input.boards))throw Error('本地模板存档格式无效');
      const boards={};for(const [key,value] of Object.entries(input.boards)){
        if(!templateById.has(key))throw Error('本地存档含未知模板');const board=validate(value);if(board.templateId!==key)throw Error('模板与排表不匹配');boards[key]=board;
      }
      if(!Object.hasOwn(boards,input.activeTemplate))throw Error('本地存档缺少当前模板');
      return {format:'spire-tier-workspace',version:3,activeTemplate:input.activeTemplate,boards};
    }
    return {original,createTemplate,validate,setGameVersion,setPoolSort,locate,move,removeTier,setPool,addToPool,removeFromPool,clearRanks,autoColorTiers,fromScreenshot,validateWorkspace,matches};
  }
  const api={createModel,DEFAULT_TITLE,DEFAULT_TIERS,TEMPLATES,MAX_TIER_NAME_LENGTH,DEFAULT_POOL_SORT,normalizePoolSort,sortPool,clone,matches,compareCards};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SpireBoardModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
