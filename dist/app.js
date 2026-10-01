'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const {createModel,DEFAULT_TIERS,TEMPLATES,clone,matches,compareCards,sortPool}=window.SpireBoardModel;
  const versions=window.SpireCardVersions.create(window.CARD_DATA||[],window.CARD_VERSIONS||[]);
  const templates=new Map(TEMPLATES.map(t=>[t.id,t]));
  const model=createModel(versions.getAllCards(),undefined,versions);
  let cards=[],byId=new Map(),catalogCards=[],renderedVersion=null;
  const LEGACY_KEY='spire-tier-list-silent-v1',KEY='spire-tier-workspace-v3';
  const imageSource=(card,language)=>card[language==='zh'?'imageZh':'imageEn']||'images/'+language+'/'+card.id+'.webp';
  const thumbnailSource=(card,language)=>card[language==='zh'?'thumbZh':'thumbEn']||imageSource(card,language);
  let workspace={format:'spire-tier-workspace',version:3,activeTemplate:'silent',boards:{silent:model.createTemplate('silent','zh',versions.defaultVersion)}};
  let unreadableWorkspace=null;
  try{
    const stored=localStorage.getItem(KEY);
    if(stored){unreadableWorkspace=stored;workspace=model.validateWorkspace(JSON.parse(stored));unreadableWorkspace=null;}
    else{const legacy=localStorage.getItem(LEGACY_KEY);if(legacy)workspace.boards.silent=model.validate(JSON.parse(legacy));}
    const size=Number(localStorage.getItem(LEGACY_KEY+'-size'));
    if(size>=68&&size<=132){$('card-size').value=size;document.documentElement.style.setProperty('--card-width',size+'px');}
  }catch{setTimeout(()=>notify('本地存档无法读取，原数据仍保留；已载入空白排表'),0);}
  let state=clone(workspace.boards[workspace.activeTemplate]),selected=null,dragging=null,lastDragAt=0,undo=[],redo=[],toastTimer,editingTier=null,previewUrl=null,previewKind='image',draftPool=new Set(),storageFailed=false;
  const histories=new Map();
  let screenshotImporter=null,schemeLibrary=null,poolSortControl=null;
  function defaultFilters(){return {color:state.templateId==='custom'?'all':state.templateId,type:'all',cost:'all',multiplayer:'all',query:''};}
  let poolFilters=defaultFilters(),catalogFilters=defaultFilters();
  function syncVersion(){
    cards=versions.cardsForBoard(state);byId=new Map(cards.map(c=>[c.id,c]));
    catalogCards=[...versions.getCards(state.gameVersion)].sort(compareCards);
    $('game-version').value=state.gameVersion;
    if(renderedVersion!==state.gameVersion){
      for(const button of $('template-tabs').querySelectorAll('button'))button.querySelector('small').textContent=button.dataset.template==='custom'?'自由选牌':catalogCards.filter(c=>c.color===button.dataset.template).length+' 张';
      renderedVersion=state.gameVersion;
    }
  }
  function notify(message,independent=false){if(storageFailed&&!independent)message='自动保存失败，请在保存方案中导出 JSON 备份';$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3800);}
  function save(){
    workspace.boards[state.templateId]=clone(state);workspace.activeTemplate=state.templateId;
    try{
      if(unreadableWorkspace){localStorage.setItem(KEY+'-recovery-'+Date.now(),unreadableWorkspace);unreadableWorkspace=null;}
      localStorage.setItem(KEY,JSON.stringify(workspace));storageFailed=false;
    }catch{storageFailed=true;notify('自动保存失败，请保存方案文件');}
  }
  function commit(next,onlyPool=false){
    const validated=model.validate(next);
    if(validated.templateId!==state.templateId)throw Error('请先切换到方案对应模板');
    if(JSON.stringify(validated)===JSON.stringify(state))return;
    undo.push(clone(state));if(undo.length>60)undo.shift();redo=[];state=validated;save();
    if(onlyPool){renderPool();$('undo').disabled=!undo.length;$('redo').disabled=!redo.length;}else render();
  }
  function resetFilterControls(){
    poolFilters=defaultFilters();$('search').value='';syncFilterButtons('pool');
  }
  function closeDrafts(){screenshotImporter?.close();schemeLibrary?.close();for(const id of ['title-dialog','tier-dialog','confirm-dialog','catalog-dialog','card-dialog','image-dialog'])$(id).close();editingTier=null;$('accept-confirm').onclick=null;}
  function switchTemplate(id){
    if(id===state.templateId)return;
    closeDrafts();workspace.boards[state.templateId]=clone(state);histories.set(state.templateId,{undo,redo});
    const history=histories.get(id);undo=history?.undo||[];redo=history?.redo||[];
    state=clone(workspace.boards[id]||model.createTemplate(id,state.language,state.gameVersion));selected=null;dragging=null;
    resetFilterControls();save();render();notify('已切换到'+templates.get(id).name);
  }
  function move(id,tier,before=null){
    if(!byId.has(id)||!model.locate(state,id)||!Object.hasOwn(state.rows,tier)||id===before)return;
    if(tier==='pool'&&model.locate(state,id)==='pool'&&state.poolSort?.some(sort=>sort.direction!=='none')){notify('待排区正在自动排序；设为全部不排后可手动调序');return;}
    selected=id;commit(model.move(state,id,tier,before));notify(byId.get(id).name+' → '+(state.tiers.find(t=>t.id===tier)?.name||'待排区'));
  }
  function cardButton(id){
    const c=byId.get(id),button=document.createElement('button');button.className='card'+(selected===id?' selected':'');button.draggable=true;button.dataset.card=id;
    button.setAttribute('aria-label',c.name+'，'+(c.english||'')+'，点击查看，按 Alt 加方向键移动');button.title=c.name+(c.english?' / '+c.english:'');
    const img=document.createElement('img');img.src=thumbnailSource(c,state.language);img.alt=c.name+(state.language==='zh'?'中文':'英文')+'完整卡面';img.loading='lazy';img.decoding='async';img.draggable=false;
    const label=document.createElement('span');label.textContent=c.name;button.append(img,label);
    if(c.unavailableInVersion){button.classList.add('version-unavailable');const badge=document.createElement('small');badge.className='version-badge';badge.textContent='版本外';button.append(badge);button.title+=' · 此版本未收录，卡面来自 '+c.gameVersion;}
    button.onclick=()=>{if(Date.now()-lastDragAt>250)select(id);};
    button.addEventListener('dragstart',e=>{dragging=id;e.dataTransfer.setData('text/plain',id);e.dataTransfer.effectAllowed='move';button.classList.add('dragging');});
    button.addEventListener('dragend',()=>{lastDragAt=Date.now();dragging=null;document.querySelectorAll('.dragging,.drag-over,.drop-before').forEach(el=>el.classList.remove('dragging','drag-over','drop-before'));});
    button.addEventListener('keydown',e=>{
      if(!e.altKey||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();
      const tiers=[...state.tiers.map(t=>t.id),'pool'],tier=model.locate(state,id),ti=tiers.indexOf(tier),ci=state.rows[tier].indexOf(id);
      if(e.key==='ArrowUp'&&ti>0)move(id,tiers[ti-1]);if(e.key==='ArrowDown'&&ti<tiers.length-1)move(id,tiers[ti+1]);
      if(e.key==='ArrowLeft'&&ci>0)move(id,tier,state.rows[tier][ci-1]);if(e.key==='ArrowRight'&&ci<state.rows[tier].length-1)move(id,tier,state.rows[tier][ci+2]||null);
      document.querySelector('[data-card="'+id+'"]')?.focus();
    });return button;
  }
  function poolCard(id){
    const wrap=document.createElement('div');wrap.className='pool-card';wrap.append(cardButton(id));
    const remove=document.createElement('button');remove.className='remove-card';remove.textContent='×';remove.title='从待排区移除，可撤销';remove.setAttribute('aria-label','从待排区移除'+byId.get(id).name);
    remove.onclick=()=>{commit(model.removeFromPool(state,[id]));notify('已移除'+byId.get(id).name);};wrap.append(remove);return wrap;
  }
  function enableDrop(zone){
    zone.addEventListener('dragover',e=>{if(zone.dataset.tier==='pool'&&model.locate(state,dragging)==='pool'&&state.poolSort?.some(sort=>sort.direction!=='none')){e.dataTransfer.dropEffect='none';return;}e.preventDefault();e.dataTransfer.dropEffect='move';zone.classList.add('drag-over');document.querySelectorAll('.drop-before').forEach(el=>el.classList.remove('drop-before'));const target=e.target.closest('.card');if(target&&target.dataset.card!==dragging)target.classList.add('drop-before');});
    zone.addEventListener('dragleave',e=>{if(!zone.contains(e.relatedTarget))zone.classList.remove('drag-over');});
    zone.addEventListener('drop',e=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain')||dragging,target=e.target.closest('.card');lastDragAt=Date.now();move(id,zone.dataset.tier,target?.dataset.card);dragging=null;zone.classList.remove('drag-over');});
  }
  function fillZone(zone,ids){
    zone.replaceChildren(...ids.map(zone.dataset.tier==='pool'?poolCard:cardButton));
    if(!ids.length){const hint=document.createElement('span');hint.className='zone-hint';hint.textContent=zone.dataset.tier==='pool'?(state.rows.pool.length?'无匹配卡牌':'暂无卡牌'):'';zone.append(hint);}
  }
  function renderPool(){
    const visible=sortPool(state.rows.pool.filter(id=>matches(byId.get(id),poolFilters)),byId,state.poolSort);fillZone($('pool'),visible);
    $('pool-count').textContent=visible.length+' / '+state.rows.pool.length;
    poolSortControl?.render();
  }
  function contrast(hex){const n=parseInt(hex.slice(1),16);return .299*(n>>16)+.587*((n>>8)&255)+.114*(n&255)>145?'#23271e':'#fffaf0';}
  function applyTheme(){
    const template=templates.get(state.templateId);
    for(const [name,value] of Object.entries(template.theme))document.documentElement.style.setProperty('--'+(name==='accent'?'gold':name),value);
    document.body.dataset.template=state.templateId;document.querySelector('meta[name="theme-color"]').content=template.theme.bg;
    $('template-tabs').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.template===state.templateId)));
  }
  function render(){
    syncVersion();applyTheme();$('board-title').textContent=state.title;document.title=state.title+' · 尖塔排表';$('card-language').value=state.language;
    if(selected&&!model.locate(state,selected))selected=null;
    const board=$('tier-board');board.replaceChildren();
    board.classList.toggle('has-paragraph-labels',state.tiers.some(tier=>tier.name.length>24||tier.name.includes('\n')));
    for(const tier of state.tiers){
      const row=document.createElement('div');row.className='tier-row';row.style.setProperty('--tier-color',tier.color);row.style.setProperty('--tier-ink',contrast(tier.color));
      const paragraph=tier.name.length>24||tier.name.includes('\n');
      const label=document.createElement('button');label.className='tier-label'+(tier.name.length>2?' long-label':'')+(paragraph?' paragraph-label':'');label.style.setProperty('--tier-label-font',tier.name.length>160?'12px':tier.name.length>72?'13px':'14px');label.dataset.editTier=tier.id;label.title='修改评级名称、颜色或位置';label.setAttribute('aria-label','编辑评级 '+tier.name);label.onclick=()=>openTier(tier.id);
      const name=document.createElement('strong');name.textContent=tier.name;const count=document.createElement('small');count.textContent=state.rows[tier.id].length+' 张';label.append(name,count);
      const zone=document.createElement('div');zone.className='card-zone';zone.dataset.tier=tier.id;zone.setAttribute('aria-label',tier.name+' 分档');fillZone(zone,state.rows[tier.id]);enableDrop(zone);row.append(label,zone);board.append(row);
    }
    const total=state.tiers.reduce((n,t)=>n+state.rows[t.id].length,0);
    const unavailable=cards.filter(c=>c.unavailableInVersion).length;
    $('board-count').textContent=total+' 张 · '+state.tiers.length+' 档'+(unavailable?' · '+unavailable+' 张版本外卡牌':'' );
    $('undo').disabled=!undo.length;$('redo').disabled=!redo.length;$('add-tier').disabled=state.tiers.length>=24;
    renderPool();if($('card-dialog').open)detail();
    if($('image-dialog').open&&previewKind==='card'){if(selected){$('dialog-image').src=imageSource(byId.get(selected),state.language);$('dialog-caption').textContent=byId.get(selected).name;}else $('image-dialog').close();}
  }
  function select(id){
    selected=id;document.querySelectorAll('.card.selected').forEach(el=>el.classList.remove('selected'));
    document.querySelector('[data-card="'+id+'"]')?.classList.add('selected');detail();
    if(!$('card-dialog').open)$('card-dialog').showModal();
  }
  function restoreCardFocus(){
    if(selected&&!document.querySelector('dialog[open]'))(document.querySelector('[data-card="'+selected+'"]')||$('manage-pool')).focus({preventScroll:true});
  }
  $('close-card').onclick=()=>$('card-dialog').close();
  $('card-dialog').addEventListener('close',restoreCardFocus);
  $('card-dialog').onclick=e=>{if(e.target===$('card-dialog')){
    const r=e.currentTarget.getBoundingClientRect();
    if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close();
  }};
  $('image-dialog').addEventListener('close',()=>{if(previewKind==='card')restoreCardFocus();});
  function detail(){
    const c=byId.get(selected),current=c&&model.locate(state,selected);
    if(!c||!current){$('card-dialog').close();return;}
    $('detail-image').src=imageSource(c,state.language);$('detail-image').alt=c.name+(state.language==='zh'?'中文':'英文')+'完整卡面';
    $('detail-name').textContent=c.name;$('detail-english').textContent=c.english||'';
    $('detail-meta').textContent=[templates.get(c.color)?.name,c.type,c.rarity,c.unavailableInVersion?'此版本未收录 · 卡面 '+c.gameVersion:state.gameVersion].filter(Boolean).join(' / ');
    $('detail-number').textContent=(state.tiers.find(t=>t.id===current)?.name||'待排')+' · '+(state.rows[current].indexOf(selected)+1);
    $('move-actions').replaceChildren(...state.tiers.map(t=>{const b=document.createElement('button');b.textContent=t.name;b.style.setProperty('--tier-color',t.color);b.style.color=contrast(t.color);b.disabled=current===t.id;b.onclick=()=>move(selected,t.id);return b;}));
    $('move-pool').disabled=current==='pool';
  }
  const filterGroups=[
    {key:'color',label:'颜色',options:[['all','全部'],...TEMPLATES.filter(t=>t.id!=='custom').map(t=>[t.id,t.name,t.color])]},
    {key:'type',label:'类型',options:[['all','全部'],['攻击','攻击'],['技能','技能'],['能力','能力']]},
    {key:'cost',label:'费用',options:[['all','全部'],['0','0'],['1','1'],['2','2'],['3','3'],['4+','4+'],['X','X'],['-1','无法打出']]},
    {key:'multiplayer',label:'多人牌',options:[['all','全部'],['exclude','隐藏多人牌'],['only','仅多人牌']]}
  ];
  function syncFilterButtons(scope){
    const filters=scope==='pool'?poolFilters:catalogFilters;
    $(scope+'-filters').querySelectorAll('button').forEach(button=>{
      button.setAttribute('aria-pressed',String(filters[button.dataset.filter]===button.dataset.value));
    });
  }
  function createFilterButtons(scope){
    const container=$(scope+'-filters');
    for(const group of filterGroups){
      const row=document.createElement('div');row.className='filter-row';
      const label=document.createElement('span');label.className='filter-label';label.id=scope+'-'+group.key+'-label';label.textContent=group.label;
      const options=document.createElement('div');options.className='filter-options';options.setAttribute('role','group');options.setAttribute('aria-labelledby',label.id);
      for(const [value,text,color] of group.options){
        const button=document.createElement('button');button.type='button';button.dataset.filter=group.key;button.dataset.value=value;button.textContent=text;
        if(color){button.style.setProperty('--chip-color',color);const dot=document.createElement('span');dot.className='filter-swatch';dot.setAttribute('aria-hidden','true');button.prepend(dot);}
        button.onclick=()=>{
          const filters=scope==='pool'?poolFilters:catalogFilters;
          filters[group.key]=value;syncFilterButtons(scope);
          if(scope==='pool')renderPool();else{renderCatalog();$('catalog-grid').scrollTop=0;}
        };options.append(button);
      }
      row.append(label,options);container.append(row);
    }
    syncFilterButtons(scope);
  }
  function catalogMatches(){return catalogCards.filter(c=>matches(c,catalogFilters));}
  function updateCatalogCount(){$('catalog-selection').textContent='已选待排 '+draftPool.size+' 张';}
  function renderCatalog(){
    const visible=catalogMatches(),ranked=new Set(state.tiers.flatMap(t=>state.rows[t.id]));
    $('catalog-results').textContent='找到 '+visible.length+' 张卡牌';
    $('catalog-grid').replaceChildren(...visible.map(c=>{
      const label=document.createElement('label');label.className='catalog-card'+(ranked.has(c.id)?' locked':'');
      const input=document.createElement('input');input.type='checkbox';input.value=c.id;input.checked=ranked.has(c.id)||draftPool.has(c.id);input.disabled=ranked.has(c.id);input.setAttribute('aria-label','选择 '+c.name+' · '+templates.get(c.color).name);
      const img=document.createElement('img');img.src=thumbnailSource(c,state.language);img.loading='lazy';img.decoding='async';img.alt=c.name+'完整卡面';
      const name=document.createElement('strong');name.textContent=c.name;
      label.append(input,img,name);input.onchange=()=>{if(input.checked)draftPool.add(c.id);else draftPool.delete(c.id);updateCatalogCount();};return label;
    }));
    if(!visible.length){const empty=document.createElement('p');empty.className='zone-hint';empty.textContent='无匹配卡牌';$('catalog-grid').append(empty);}
    updateCatalogCount();
  }
  $('manage-pool').onclick=()=>{
    draftPool=new Set(state.rows.pool);catalogFilters={...poolFilters};$('catalog-search').value=catalogFilters.query;syncFilterButtons('catalog');renderCatalog();$('catalog-grid').scrollTop=0;$('catalog-dialog').showModal();
  };
  $('close-catalog').onclick=$('cancel-catalog').onclick=()=>$('catalog-dialog').close();
  $('apply-catalog').onclick=()=>{
    const oldOrder=state.rows.pool.filter(id=>draftPool.has(id)),added=cards.filter(c=>draftPool.has(c.id)&&!state.rows.pool.includes(c.id)).map(c=>c.id);
    commit(model.setPool(state,[...oldOrder,...added]));$('catalog-dialog').close();notify('待排卡池已更新');
  };
  $('catalog-select').onclick=()=>{for(const c of catalogMatches())if(!model.locate(state,c.id)||model.locate(state,c.id)==='pool')draftPool.add(c.id);renderCatalog();};
  $('catalog-deselect').onclick=()=>{for(const c of catalogMatches())draftPool.delete(c.id);renderCatalog();};
  $('catalog-search').oninput=()=>{catalogFilters.query=$('catalog-search').value;renderCatalog();$('catalog-grid').scrollTop=0;};
  $('catalog-reset').onclick=()=>{catalogFilters=defaultFilters();$('catalog-search').value='';syncFilterButtons('catalog');renderCatalog();$('catalog-grid').scrollTop=0;};
  $('search').oninput=()=>{poolFilters.query=$('search').value;renderPool();};
  $('reset-filters').onclick=()=>{resetFilterControls();renderPool();};
  function showImage(src,caption,kind='image'){$('download-link').hidden=true;$('preview-zoom').hidden=kind!=='export';$('image-dialog').classList.remove('zoomed');$('preview-zoom').textContent='放大到原始尺寸';previewKind=kind;$('dialog-image').src=src;$('dialog-image').alt=caption;$('dialog-caption').textContent=caption;if(!$('image-dialog').open)$('image-dialog').showModal();}
  function confirmAction(title,message,action){$('confirm-title').textContent=title;$('confirm-message').textContent=message;$('confirm-dialog').showModal();$('accept-confirm').onclick=()=>{$('confirm-dialog').close();action();};}
  function filename(title,suffix){return title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,80)+suffix;}
  function downloadUrl(url,name){const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();}
  function download(blob,name){const url=URL.createObjectURL(blob);downloadUrl(url,name);setTimeout(()=>URL.revokeObjectURL(url),60000);}
  function openTier(id=null){
    editingTier=id;const tier=state.tiers.find(t=>t.id===id);$('tier-dialog-title').textContent=tier?'编辑评级':'新增评级';$('tier-name').value=tier?.name||'';$('tier-color').value=tier?.color||DEFAULT_TIERS[state.tiers.length%DEFAULT_TIERS.length].color;
    $('tier-position').replaceChildren(...Array.from({length:state.tiers.length+(tier?0:1)},(_,i)=>{const option=document.createElement('option');option.value=i;option.textContent='第 '+(i+1)+' 档'+(i===0?'（顶部）':'');return option;}));
    $('tier-position').value=tier?state.tiers.findIndex(t=>t.id===id):state.tiers.length;$('delete-tier').hidden=!tier;$('delete-tier').disabled=state.tiers.length===1;$('tier-error').textContent='';$('tier-dialog').showModal();$('tier-name').focus();$('tier-name').select();
  }
  $('tier-form').onsubmit=e=>{
    e.preventDefault();try{
      const next=clone(state),tier={id:editingTier||'tier_'+crypto.randomUUID().replaceAll('-',''),name:$('tier-name').value.trim(),color:$('tier-color').value};
      if(!tier.name)throw Error('请输入评级名称');next.tiers=next.tiers.filter(t=>t.id!==tier.id);next.tiers.splice(Number($('tier-position').value),0,tier);if(!editingTier)next.rows[tier.id]=[];
      commit(next);$('tier-dialog').close();notify(editingTier?'评级已更新':'评级已添加');
    }catch(err){$('tier-error').textContent=err.message;}
  };
  $('delete-tier').onclick=()=>{
    const id=editingTier,tier=state.tiers.find(t=>t.id===id);$('tier-dialog').close();confirmAction('删除评级“'+tier.name+'”？','其中 '+state.rows[id].length+' 张卡牌将按原顺序移回待排区，卡牌不会丢失。操作可以撤销。',()=>{commit(model.removeTier(state,id));notify('评级已删除，卡牌已移回待排区');});
  };
  $('cancel-tier').onclick=()=>$('tier-dialog').close();$('add-tier').onclick=()=>openTier();
  $('auto-colors').onclick=()=>{commit(model.autoColorTiers(state));notify('评级颜色已更新');};
  $('edit-title').onclick=()=>{$('title-input').value=state.title;$('title-error').textContent='';$('title-dialog').showModal();$('title-input').focus();$('title-input').select();};
  $('title-form').onsubmit=e=>{e.preventDefault();try{commit({...state,title:$('title-input').value});$('title-dialog').close();notify('标题已更新');}catch(err){$('title-error').textContent=err.message;}};
  $('cancel-title').onclick=()=>$('title-dialog').close();
  $('card-language').onchange=e=>{commit({...state,language:e.target.value});notify(state.language==='zh'?'已切换为中文完整卡面':'已切换为英文完整卡面');};
  for(const version of versions.versions){const option=document.createElement('option');option.value=version.id;option.textContent=version.label;$('game-version').append(option);}
  $('game-version').onchange=e=>{try{const next=model.setGameVersion(state,e.target.value);closeDrafts();selected=null;commit(next);notify('已切换至'+versions.label(state.gameVersion));}catch(error){$('game-version').value=state.gameVersion;notify(error.message);}};
  $('undo').onclick=()=>{if(!undo.length)return;redo.push(clone(state));state=undo.pop();save();render();};
  $('redo').onclick=()=>{if(!redo.length)return;undo.push(clone(state));state=redo.pop();save();render();};
  $('cancel-confirm').onclick=()=>$('confirm-dialog').close();$('move-pool').onclick=()=>move(selected,'pool');
  $('zoom-card').onclick=()=>{if(selected){$('card-dialog').close();showImage(imageSource(byId.get(selected),state.language),byId.get(selected).name+' · '+(state.language==='zh'?'中文卡面':'English card'),'card');}};
  document.querySelector('.close-dialog').onclick=()=>$('image-dialog').close();$('image-dialog').onclick=e=>{if(e.target===$('image-dialog'))$('image-dialog').close();};
  $('preview-zoom').onclick=()=>{const zoomed=$('image-dialog').classList.toggle('zoomed');$('preview-zoom').textContent=zoomed?'缩放以适应窗口':'放大到原始尺寸';$('image-dialog').scrollTop=0;$('image-dialog').scrollLeft=0;};
  $('card-size').oninput=e=>{document.documentElement.style.setProperty('--card-width',e.target.value+'px');try{localStorage.setItem(LEGACY_KEY+'-size',e.target.value);}catch{}};
  function loadScheme(board){
    const incoming=model.validate(board);closeDrafts();
    if(incoming.templateId!==state.templateId)switchTemplate(incoming.templateId);
    commit(incoming);resetFilterControls();selected=null;render();notify('方案已载入，可撤销',true);
  }
  const schemeStore=window.SpireSchemeStore.create({validate:model.validate});
  schemeLibrary=window.SpireSchemeLibrary.create({
    store:schemeStore,getBoard:()=>clone(state),validateBoard:model.validate,cardsForBoard:versions.cardsForBoard,versionLabel:versions.label,templates:TEMPLATES,thumbnailSource,
    notify:message=>notify(message,true),download:(blob,name)=>download(blob,filename(name,'')),
    loadBoard:loadScheme
  });
  $('export-json').onclick=()=>schemeLibrary.openSave();
  $('import-json').onclick=()=>schemeLibrary.openLoad();
  screenshotImporter=window.SpireScreenshotImporter.create({cards:versions.getAllCards(),getCards:()=>versions.cardsForBoard(state),onApply:draft=>{
    const target=model.setGameVersion(state.templateId==='custom'?state:(workspace.boards.custom||model.createTemplate('custom',state.language,state.gameVersion)),state.gameVersion);
    const incoming=model.fromScreenshot(target,draft);
    if(state.templateId!=='custom')switchTemplate('custom');
    commit(incoming);selected=null;resetFilterControls();render();notify('截图排表已生成，可撤销');
  }});
  $('import-screenshot').onclick=()=>screenshotImporter.open();
  $('export-png').onclick=async()=>{
    const button=$('export-png'),snapshot=clone(state),scale=Number($('export-resolution').value);button.disabled=true;button.textContent='正在生成…';
    try{
      const result=await window.SpirePng.render(snapshot,versions.cardsForBoard(snapshot),imageSource,scale);if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(result.blob);
      const name=filename(result.title,'-'+result.language+'-'+result.width+'px.png');downloadUrl(previewUrl,name);
      showImage(previewUrl,result.title+' · PNG '+result.width+' × '+result.height+' · '+(result.language==='zh'?'中文':'English'),'export');$('download-link').href=previewUrl;$('download-link').download=name;$('download-link').hidden=false;notify('高清图片已生成，可放大检查或保存');
    }catch(err){notify(window.location.protocol==='file:'?'请使用“启动网站.cmd”打开后导出图片':err.message);}finally{button.disabled=false;button.textContent='↓ 导出 PNG';}
  };
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();(e.shiftKey?$('redo'):$('undo')).click();}});
  window.addEventListener('storage',e=>{
    if(e.key===KEY&&e.newValue){try{
      const next=model.validateWorkspace(JSON.parse(e.newValue));
      if(JSON.stringify(next)!==JSON.stringify(workspace)){closeDrafts();workspace=next;state=clone(next.boards[next.activeTemplate]);histories.clear();undo=[];redo=[];selected=null;resetFilterControls();$('catalog-dialog').close();render();notify('已同步另一页面保存的模板');}
    }catch{notify('另一页面的模板格式不兼容，保留本页排表');}}
  });
  for(const template of TEMPLATES){
    const button=document.createElement('button');button.dataset.template=template.id;button.style.setProperty('--template-color',template.color);button.setAttribute('aria-pressed','false');
    const dot=document.createElement('span');dot.className='template-swatch';const name=document.createElement('strong');name.textContent=template.name;const count=document.createElement('small');
    button.append(dot,name,count);button.onclick=()=>switchTemplate(template.id);$('template-tabs').append(button);
  }
  createFilterButtons('pool');createFilterButtons('catalog');
  poolSortControl=window.SpirePoolSort.create({container:$('pool-sort'),getSettings:()=>state.poolSort,onChange:settings=>commit(model.setPoolSort(state,settings),true)});
  resetFilterControls();enableDrop($('pool'));render();
})();
