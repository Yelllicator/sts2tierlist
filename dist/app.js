'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const {createModel,DEFAULT_TIERS,TEMPLATES,clone,matches,compareCards,sortPool}=window.SpireBoardModel;
  const versions=window.SpireCardVersions.create(window.CARD_DATA||[],window.CARD_VERSIONS||[]);
  const templates=new Map(TEMPLATES.map(t=>[t.id,t]));
  const model=createModel(versions.getAllCards(),undefined,versions);
  let cards=[],byId=new Map(),catalogCards=[],renderedVersion=null;
  const LEGACY_KEY='spire-tier-list-silent-v1',KEY='spire-tier-workspace-v3';
  const imageSource=(card,language)=>card[language==='zh'?'imageZh':'imageEn']||'images/'+language+'/'+(card.baseId||card.id)+'.webp';
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
  const queueSkips=new Map();
  const catalogRetained=new Set();
  let queueCollapsed=false;
  let cardFocusOrigin=null;
  let dragScrollPoint=null,dragScrollFrame=0,dragScrollTime=null;
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
  function move(id,tier,before=null,manualPool=false){
    if(!byId.has(id)||!model.locate(state,id)||!Object.hasOwn(state.rows,tier)||id===before)return;
    const sortedPool=tier==='pool'&&state.poolSort?.some(sort=>sort.direction!=='none');
    if(sortedPool&&model.locate(state,id)==='pool'&&!manualPool){notify('待排区正在自动排序；设为全部不排后可手动调序');return;}
    const motion=captureCardMotion();
    let next=state;
    // An explicit queue position takes precedence over automatic sorting. Keep
    // the complete displayed order, including filtered/skipped cards, as its base.
    if(manualPool&&sortedPool)next={...state,rows:{...state.rows,pool:sortPool(state.rows.pool,byId,state.poolSort)},poolSort:state.poolSort.map(sort=>({...sort,direction:'none'}))};
    if(tier==='pool')queueSkips.set(queueKey(),(queueSkips.get(queueKey())||[]).filter(skipped=>skipped!==id));
    selected=id;commit(model.move(next,id,tier,before));finishCardMotion(motion,id,tier);
    notify(byId.get(id).name+' → '+(state.tiers.find(t=>t.id===tier)?.name||'待排区')+(manualPool&&sortedPool?'，已按拖放位置切换为手动排序':''));
  }
  function captureCardMotion(){
    const frames=new Map();
    for(const area of ['tier-board','pool','queue-cards']){
      const container=$(area),bounds=container.getBoundingClientRect();
      if(!bounds.height||bounds.bottom<0||bounds.top>window.innerHeight)continue;
      for(const card of container.querySelectorAll('.card')){
        const node=card.closest('.queue-card,.pool-card')||card,rect=node.getBoundingClientRect();
        if(rect.bottom<Math.max(0,bounds.top)-rect.height||rect.top>Math.min(window.innerHeight,bounds.bottom)+rect.height)continue;
        frames.set(area+':'+card.dataset.card,{node,rect,id:card.dataset.card});
      }
    }
    return frames;
  }
  function finishCardMotion(previous,id=null,tier=null){
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const queue=$('queue-cards'),queued=id&&tier==='pool'&&!queueCollapsed?queue.querySelector('[data-card="'+id+'"]'):null;
    const target=id&&!document.querySelector('dialog[open]')?(queued||document.querySelector((tier==='pool'?'#pool':'#tier-board')+' [data-card="'+id+'"]')):null;
    // Measure the destination before translate animations change its visual position.
    const rect=target?.getBoundingClientRect(),queueBounds=queued?queue.getBoundingClientRect():null;
    const bounds=queueBounds?{top:Math.max(12,queueBounds.top),bottom:Math.min(window.innerHeight-12,queueBounds.bottom)}:{top:12,bottom:window.innerHeight-12};
    const queueVisible=queued&&bounds.bottom>bounds.top;
    if(queued&&!queueVisible){bounds.top=12;bounds.bottom=window.innerHeight-12;}
    const delta=rect?(rect.top<bounds.top?rect.top-bounds.top-4:rect.bottom>bounds.bottom?rect.bottom-bounds.bottom+4:0):0;
    if(!reduced){
      // Read all positions before animating; only nearby visible cards participate.
      const current=captureCardMotion();
      for(const [key,{node,rect,id:cardId}] of current){
        const from=previous.get(key)?.rect,dx=from?from.left-rect.left:0,dy=from?from.top-rect.top:12;
        if((!from&&cardId!==id)||(from&&Math.abs(dx)+Math.abs(dy)<1))continue;
        node.getAnimations().forEach(animation=>animation.cancel());
        node.animate([{translate:dx+'px '+dy+'px',opacity:from?1:.4},{translate:'0 0',opacity:1}],{duration:240,easing:'cubic-bezier(.2,.7,.2,1)'});
      }
    }
    if(delta){
      const behavior=reduced?'instant':'smooth';let remaining=delta;
      if(queueVisible){
        const top=Math.max(0,Math.min(queue.scrollHeight-queue.clientHeight,queue.scrollTop+delta));
        remaining-=top-queue.scrollTop;if(top!==queue.scrollTop)queue.scrollTo({top,behavior});
      }
      if(remaining)window.scrollBy({top:remaining,behavior});
    }
  }
  function setQueueDropReady(){
    const zone=$('queue-skip-zone'),tier=model.locate(state,dragging),returning=Boolean(tier&&tier!=='pool');
    zone.classList.toggle('drop-ready',returning);
    zone.title=returning?'拖入以从当前排表移除，可用顶部撤销':'待排牌拖入以暂时跳过；已评级牌拖入以从当前排表移除';
  }
  function clearCardDrag(){
    stopCardAutoScroll();
    lastDragAt=Date.now();dragging=null;
    document.querySelectorAll('.dragging,.drag-over,.drop-before,.queue-drop-before,.queue-drop-after').forEach(el=>el.classList.remove('dragging','drag-over','drop-before','queue-drop-before','queue-drop-after'));
    setQueueDropReady();
  }
  function stopCardAutoScroll(){
    if(dragScrollFrame)cancelAnimationFrame(dragScrollFrame);
    dragScrollPoint=null;dragScrollFrame=0;dragScrollTime=null;
  }
  function cardAutoScrollSpeed(){
    if(!dragging||!dragScrollPoint||document.hidden)return 0;
    const {x,y}=dragScrollPoint,board=$('board-with-queue').getBoundingClientRect(),pool=$('pool').getBoundingClientRect();
    const top=Math.max(0,board.top),bottom=Math.min(window.innerHeight,pool.bottom);
    if(x<board.left||x>board.right||y<top||y>bottom||bottom<=top)return 0;
    // Let the queue retain its native inner scrolling instead of moving both surfaces.
    const queue=$('queue-cards').getBoundingClientRect();
    if(!queueCollapsed&&x>=queue.left&&x<=queue.right&&y>=queue.top&&y<=queue.bottom)return 0;
    const edge=Math.min(80,(bottom-top)/3);
    const proximity=y<top+edge?-(top+edge-y)/edge:y>bottom-edge?(y-bottom+edge)/edge:0;
    return Math.sign(proximity)*720*Math.abs(proximity)**2;
  }
  function stepCardAutoScroll(time){
    dragScrollFrame=0;
    const speed=cardAutoScrollSpeed();
    if(!speed){dragScrollTime=null;return;}
    const elapsed=dragScrollTime===null?16:Math.min(32,time-dragScrollTime);
    dragScrollTime=time;
    const previous=window.scrollY;
    window.scrollBy({top:speed*elapsed/1000,behavior:'instant'});
    if(window.scrollY!==previous)dragScrollFrame=requestAnimationFrame(stepCardAutoScroll);
    else dragScrollTime=null;
  }
  function watchCardAutoScroll(){
    document.addEventListener('dragover',event=>{
      if(!dragging)return;
      dragScrollPoint={x:event.clientX,y:event.clientY};
      if(!dragScrollFrame)dragScrollFrame=requestAnimationFrame(stepCardAutoScroll);
    },true);
    // Capture stops the loop even when dropping outside a valid card zone.
    document.addEventListener('drop',stopCardAutoScroll,true);
    document.addEventListener('dragend',()=>{if(dragging)clearCardDrag();});
    document.addEventListener('dragleave',event=>{if(!event.relatedTarget)stopCardAutoScroll();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&dragging)clearCardDrag();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&dragging)clearCardDrag();});
    window.addEventListener('blur',()=>{if(dragging)clearCardDrag();});
  }
  function cardButton(id){
    const c=byId.get(id),button=document.createElement('button');button.className='card';button.draggable=true;button.dataset.card=id;
    button.setAttribute('aria-label',c.name+'，'+(c.english||'')+(c.unavailableInVersion?'，版本外 '+c.gameVersion:'')+'，点击查看，按 Alt 加方向键移动');button.title=c.name+(c.english?' / '+c.english:'');
    const img=document.createElement('img');img.src=thumbnailSource(c,state.language);img.alt=c.name+(state.language==='zh'?'中文':'英文')+'完整卡面';img.loading='lazy';img.decoding='async';img.draggable=false;
    const label=document.createElement('span');label.textContent=c.name;button.append(img,label);
    if(c.unavailableInVersion){button.classList.add('version-unavailable');const badge=document.createElement('small');badge.className='version-badge';badge.textContent='版本外';button.append(badge);button.title+=' · 版本外，卡面与规则来自 '+c.gameVersion;}
    button.onclick=()=>{if(Date.now()-lastDragAt>250){cardFocusOrigin=button;select(id);}};
    button.addEventListener('dragstart',e=>{dragging=id;e.dataTransfer.setData('text/plain',id);e.dataTransfer.effectAllowed='move';button.classList.add('dragging');setQueueDropReady();});
    button.addEventListener('dragend',clearCardDrag);
    button.addEventListener('keydown',e=>{
      if(!e.altKey||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();
      const tiers=[...state.tiers.map(t=>t.id),'pool'],tier=model.locate(state,id),ti=tiers.indexOf(tier),ci=state.rows[tier].indexOf(id);
      if(e.key==='ArrowUp'&&ti>0)move(id,tiers[ti-1]);if(e.key==='ArrowDown'&&ti<tiers.length-1)move(id,tiers[ti+1]);
      if(e.key==='ArrowLeft'&&ci>0)move(id,tier,state.rows[tier][ci-1]);if(e.key==='ArrowRight'&&ci<state.rows[tier].length-1)move(id,tier,state.rows[tier][ci+2]||null);
      document.querySelector('[data-card="'+id+'"]')?.focus({preventScroll:true});
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
    zone.addEventListener('drop',e=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain')||dragging,target=e.target.closest('.card');try{move(id,zone.dataset.tier,target?.dataset.card);}finally{clearCardDrag();}});
  }
  function fillZone(zone,ids){
    zone.replaceChildren(...ids.map(zone.dataset.tier==='pool'?poolCard:cardButton));
    if(!ids.length){const hint=document.createElement('span');hint.className='zone-hint';hint.textContent=zone.dataset.tier==='pool'?(state.rows.pool.length?'无匹配卡牌':'暂无卡牌'):'';zone.append(hint);}
  }
  function renderPool(){
    const visible=sortPool(state.rows.pool.filter(id=>matches(byId.get(id),poolFilters)),byId,state.poolSort);fillZone($('pool'),visible);
    $('pool-count').textContent=visible.length+' / '+state.rows.pool.length;
    poolSortControl?.render();
    renderQueue(visible);
  }
  function queueKey(){return state.templateId+':'+state.gameVersion;}
  function watchQueueViewport(){
    const panel=$('pending-queue'),content=$('queue-content'),desktop=window.matchMedia('(min-width:761px)');
    let frame=0;
    const resize=()=>{
      frame=0;
      if(!desktop.matches){content.style.removeProperty('--queue-viewport-height');return;}
      const rect=panel.getBoundingClientRect(),top=Math.max(12,rect.top+panel.clientTop);
      // Shrink at the board's lower edge so its last rows can still use the queue head.
      const height=Math.max(0,Math.min(window.innerHeight-12,rect.bottom-panel.clientTop)-top);
      content.style.setProperty('--queue-viewport-height',height+'px');
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(resize);};
    window.addEventListener('scroll',schedule,{passive:true});
    window.addEventListener('resize',schedule);
    const observer=new ResizeObserver(schedule);
    observer.observe($('board-with-queue'));
    observer.observe(document.querySelector('main'));
    resize();
  }
  function toggleQueue(){
    queueCollapsed=!queueCollapsed;
    const toggle=$('queue-toggle'),label=(queueCollapsed?'展开':'折叠')+'待排队列';
    toggle.title=label;toggle.setAttribute('aria-label',label);toggle.setAttribute('aria-expanded',String(!queueCollapsed));
    $('queue-content').hidden=queueCollapsed;$('board-with-queue').classList.toggle('queue-collapsed',queueCollapsed);
  }
  function resetQueue(){for(const key of queueSkips.keys())if(key.startsWith(state.templateId+':'))queueSkips.delete(key);}
  function skipQueueCard(id){
    if(model.locate(state,id)!=='pool')return;
    const skipped=queueSkips.get(queueKey())||[];
    if(skipped.includes(id))return;
    const motion=captureCardMotion();
    queueSkips.set(queueKey(),[...skipped,id]);renderPool();finishCardMotion(motion);notify('已暂时跳过'+byId.get(id).name+'，仍保留在待排区');
  }
  function undoQueueSkip(){
    const skipped=queueSkips.get(queueKey());if(!skipped?.length)return;
    const motion=captureCardMotion(),id=skipped.pop();renderPool();finishCardMotion(motion,id,'pool');notify('已撤回上一次跳过');
  }
  function renderQueue(visible){
    const skipped=new Set(queueSkips.get(queueKey())||[]),ids=visible.filter(id=>!skipped.has(id)),queue=$('queue-cards'),scrollTop=queue.scrollTop;
    $('queue-undo').disabled=!skipped.size;
    queue.replaceChildren(...ids.map((id,index)=>{
      const wrap=document.createElement('div');wrap.className='queue-card';wrap.append(cardButton(id));
      const skip=document.createElement('button');skip.className='queue-skip';skip.textContent='×';skip.title='暂时跳过，仍保留在待排区';skip.setAttribute('aria-label','暂时跳过'+byId.get(id).name);
      skip.onclick=()=>{skipQueueCard(id);const next=queue.querySelector('[data-card="'+(ids[index+1]||ids[index-1])+'"]');(next?.parentElement.querySelector('.queue-skip')||$('queue-undo')).focus({preventScroll:true});};wrap.append(skip);return wrap;
    }));
    if(!ids.length){const hint=document.createElement('p');hint.className='queue-empty';hint.textContent=visible.length?'当前匹配的卡牌已全部跳过，可撤回跳过。':state.rows.pool.length?'暂无匹配卡牌，试试调整下方筛选。':'待排卡牌已排完，可从下方选择卡牌。';$('queue-cards').append(hint);}
    queue.scrollTop=scrollTop;
  }
  function removeRankedCard(id){
    const tier=model.locate(state,id);if(!tier||tier==='pool')return;
    const motion=captureCardMotion();
    queueSkips.set(queueKey(),(queueSkips.get(queueKey())||[]).filter(skipped=>skipped!==id));
    commit(model.removeFromPool(model.move(state,id,'pool'),[id]));finishCardMotion(motion);
    notify('已从当前排表移除'+byId.get(id).name+'，可用顶部撤销');
  }
  function queueDropTarget(event){
    const queue=$('queue-cards'),wrap=event.target.closest('.queue-card'),card=wrap?.querySelector('.card');
    const cards=[...queue.querySelectorAll('.card')].filter(node=>node.dataset.card!==dragging);
    const horizontal=window.matchMedia('(max-width: 760px)').matches;
    const slot=(index,after=false)=>({before:after?cards[index+1]?.dataset.card||null:cards[index].dataset.card,node:cards[index].closest('.queue-card'),after});
    if(card&&queue.contains(wrap)){
      if(card.dataset.card===dragging)return {before:dragging,node:null,after:false};
      const rect=wrap.getBoundingClientRect();
      const after=horizontal?event.clientX>rect.left+rect.width/2:event.clientY>rect.top+rect.height/2;
      return slot(cards.indexOf(card),after);
    }
    // Card gaps and side padding are useful drop targets too; resolve their
    // geometric slot instead of sending every empty-space drop to the end.
    const rects=cards.map(node=>node.closest('.queue-card').getBoundingClientRect());
    if(!horizontal){
      const index=rects.findIndex(rect=>event.clientY<=rect.top+rect.height/2);
      if(index>=0)return slot(index);
    }else{
      const start=rects.findIndex(rect=>event.clientY<=rect.bottom);
      if(start>=0){
        if(event.clientY<rects[start].top)return slot(start);
        let end=start;
        while(end+1<rects.length&&Math.abs(rects[end+1].top-rects[start].top)<1)end++;
        for(let index=start;index<=end;index++)if(event.clientX<=rects[index].left+rects[index].width/2)return slot(index);
        return slot(end,true);
      }
    }
    return {before:null,node:cards.at(-1)?.closest('.queue-card'),after:true};
  }
  function enableQueueDrop(){
    const zone=$('queue-skip-zone');
    const accept=e=>{if(!model.locate(state,dragging))return;e.preventDefault();e.dataTransfer.dropEffect='move';zone.classList.add('drag-over');};
    zone.addEventListener('dragenter',accept);zone.addEventListener('dragover',accept);
    zone.addEventListener('dragleave',e=>{if(!zone.contains(e.relatedTarget))zone.classList.remove('drag-over');});
    zone.addEventListener('drop',e=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain')||dragging;try{if(model.locate(state,id)==='pool')skipQueueCard(id);else removeRankedCard(id);}finally{clearCardDrag();}});
    const queue=$('queue-cards');
    const clearQueueTarget=()=>queue.querySelectorAll('.queue-drop-before,.queue-drop-after').forEach(node=>node.classList.remove('queue-drop-before','queue-drop-after'));
    const acceptQueue=e=>{
      if(!model.locate(state,dragging))return;
      e.preventDefault();e.dataTransfer.dropEffect='move';queue.classList.add('drag-over');clearQueueTarget();
      const target=queueDropTarget(e);target.node?.classList.add(target.after?'queue-drop-after':'queue-drop-before');
    };
    queue.addEventListener('dragenter',acceptQueue);queue.addEventListener('dragover',acceptQueue);
    queue.addEventListener('dragleave',e=>{if(!queue.contains(e.relatedTarget)){queue.classList.remove('drag-over');clearQueueTarget();}});
    queue.addEventListener('drop',e=>{
      e.preventDefault();const id=e.dataTransfer.getData('text/plain')||dragging,target=queueDropTarget(e);
      try{move(id,'pool',target.before,true);}finally{clearCardDrag();}
    });
    $('queue-undo').onclick=undoQueueSkip;
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
    selected=id;detail();
    if(!$('card-dialog').open)$('card-dialog').showModal();
  }
  function restoreCardFocus(){
    if(selected&&!document.querySelector('dialog[open]'))(cardFocusOrigin?.isConnected&&cardFocusOrigin.dataset.card===selected?cardFocusOrigin:document.querySelector('[data-card="'+selected+'"]')||$('manage-pool')).focus({preventScroll:true});
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
    $('detail-meta').textContent=[templates.get(c.color)?.name,c.type,c.rarity,c.unavailableInVersion?'版本外 · 卡面与规则 '+c.gameVersion:state.gameVersion].filter(Boolean).join(' / ');
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
  function setCatalogVersion(id){catalogCards=[...versions.getCards(id)].sort(compareCards);$('catalog-version').value=id;}
  function catalogChoices(){
    const current=new Map(versions.getCards(state.gameVersion).map(c=>[c.id,c]));
    for(const id of [...state.tiers.flatMap(t=>state.rows[t.id]),...draftPool])catalogRetained.add(id);
    const chosen=[...catalogRetained].map(id=>versions.resolve(id,state.gameVersion));
    const existing=new Map(chosen.map(c=>[versions.cardRef(c.baseId,c.gameVersion),c.id]));
    const choices=catalogCards.map(c=>versions.resolve(existing.get(versions.cardRef(c.id,c.gameVersion))||(c.gameVersion===state.gameVersion?c.id:versions.cardRef(c.id,c.gameVersion)),state.gameVersion));
    // Keep already selected foreign versions visible in the current catalog so
    // removing all visible results also removes old fallback cards such as Follow Through.
    if($('catalog-version').value===state.gameVersion){
      const shown=new Set(choices.map(c=>c.id));
      for(const c of chosen)if(!shown.has(c.id)){choices.push(c);shown.add(c.id);}
    }
    return choices.map(c=>{
      const outside=c.gameVersion!==state.gameVersion,same=versions.sameDefinition(c,current.get(c.baseId));
      return {...c,catalogDifferent:outside&&!same,catalogSame:outside&&same};
    }).sort((a,b)=>Number(b.catalogDifferent)-Number(a.catalogDifferent)||compareCards(a,b));
  }
  function catalogMatches(){return catalogChoices().filter(c=>matches(c,catalogFilters));}
  function updateCatalogCount(){$('catalog-selection').textContent='已选待排 '+draftPool.size+' 张';}
  function renderCatalog(){
    const visible=catalogMatches(),ranked=new Set(state.tiers.flatMap(t=>state.rows[t.id]));
    $('catalog-results').textContent='找到 '+visible.length+' 张卡牌';
    $('catalog-grid').replaceChildren(...visible.map(c=>{
      const label=document.createElement('label');label.className='catalog-card'+(ranked.has(c.id)?' locked':'')+(c.catalogSame?' catalog-same':'');
      const input=document.createElement('input');input.type='checkbox';input.value=c.id;input.checked=ranked.has(c.id)||draftPool.has(c.id);input.disabled=ranked.has(c.id);input.setAttribute('aria-label','选择 '+c.name+' · '+templates.get(c.color).name+' · '+c.gameVersion+(c.unavailableInVersion?' · 版本外':'')+(c.catalogSame?' · 与当前版本相同':''));
      const img=document.createElement('img');img.src=thumbnailSource(c,state.language);img.loading='lazy';img.decoding='async';img.alt=c.name+'完整卡面';
      const name=document.createElement('strong');name.textContent=c.name;
      label.append(input,img,name);
      if(c.unavailableInVersion||ranked.has(c.id)){const note=document.createElement('small');note.textContent=[c.unavailableInVersion?'版本外 '+c.gameVersion+(c.catalogSame?' · 相同':' · 有差异'):'',ranked.has(c.id)?'已评级':''].filter(Boolean).join(' · ');label.append(note);}
      input.onchange=()=>{if(input.checked)draftPool.add(c.id);else draftPool.delete(c.id);updateCatalogCount();};return label;
    }));
    if(!visible.length){const empty=document.createElement('p');empty.className='zone-hint';empty.textContent='无匹配卡牌';$('catalog-grid').append(empty);}
    updateCatalogCount();
  }
  $('manage-pool').onclick=()=>{
    catalogRetained.clear();setCatalogVersion(state.gameVersion);draftPool=new Set(state.rows.pool);catalogFilters={...poolFilters};$('catalog-search').value=catalogFilters.query;syncFilterButtons('catalog');renderCatalog();$('catalog-grid').scrollTop=0;$('catalog-dialog').showModal();
  };
  $('catalog-version').onchange=e=>{setCatalogVersion(e.target.value);renderCatalog();$('catalog-grid').scrollTop=0;};
  $('close-catalog').onclick=$('cancel-catalog').onclick=()=>$('catalog-dialog').close();
  $('apply-catalog').onclick=()=>{
    const oldOrder=state.rows.pool.filter(id=>draftPool.has(id)),added=[...draftPool].filter(id=>!state.rows.pool.includes(id));
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
  function clearBoardRanks(){
    if(state.tiers.every(t=>state.rows[t.id].length===0)){notify('当前排表已经是空白');return;}
    closeDrafts();selected=null;resetQueue();commit(model.clearRanks(state));notify('当前模板评级已清空，卡牌已移回待排区，可撤销');
  }
  $('clear-ranks').onclick=clearBoardRanks;
  $('edit-title').onclick=()=>{$('title-input').value=state.title;$('title-error').textContent='';$('title-dialog').showModal();$('title-input').focus();$('title-input').select();};
  $('title-form').onsubmit=e=>{e.preventDefault();try{commit({...state,title:$('title-input').value});$('title-dialog').close();notify('标题已更新');}catch(err){$('title-error').textContent=err.message;}};
  $('cancel-title').onclick=()=>$('title-dialog').close();
  $('card-language').onchange=e=>{commit({...state,language:e.target.value});notify(state.language==='zh'?'已切换为中文完整卡面':'已切换为英文完整卡面');};
  for(const id of ['game-version','catalog-version'])for(const version of versions.versions){const option=document.createElement('option');option.value=version.id;option.textContent=version.label;$(id).append(option);}
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
    resetQueue();commit(incoming);resetFilterControls();selected=null;render();notify('方案已载入，可撤销',true);
  }
  const schemeStore=window.SpireSchemeStore.create({validate:model.validate});
  schemeLibrary=window.SpireSchemeLibrary.create({
    store:schemeStore,getBoard:()=>clone(state),validateBoard:model.validate,cardsForBoard:versions.cardsForBoard,versionLabel:versions.label,templates:TEMPLATES,thumbnailSource,
    notify:message=>notify(message,true),download:(blob,name)=>download(blob,filename(name,'')),
    loadBoard:loadScheme
  });
  $('export-json').onclick=()=>schemeLibrary.openSave();
  $('import-json').onclick=()=>schemeLibrary.openLoad();
  screenshotImporter=window.SpireScreenshotImporter.create({cards:versions.getAllCards(),getCards:()=>versions.getCards(state.gameVersion),getLanguage:()=>state.language,onApply:draft=>{
    const target=model.setGameVersion(state.templateId==='custom'?state:(workspace.boards.custom||model.createTemplate('custom',state.language,state.gameVersion)),state.gameVersion);
    const incoming=model.fromScreenshot(target,draft);
    if(state.templateId!=='custom')switchTemplate('custom');
    resetQueue();commit(incoming);selected=null;resetFilterControls();render();notify('截图排表已生成，可撤销');
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
      if(JSON.stringify(next)!==JSON.stringify(workspace)){closeDrafts();workspace=next;state=clone(next.boards[next.activeTemplate]);histories.clear();queueSkips.clear();undo=[];redo=[];selected=null;resetFilterControls();$('catalog-dialog').close();render();notify('已同步另一页面保存的模板');}
    }catch{notify('另一页面的模板格式不兼容，保留本页排表');}}
  });
  for(const template of TEMPLATES){
    const button=document.createElement('button');button.dataset.template=template.id;button.style.setProperty('--template-color',template.color);button.setAttribute('aria-pressed','false');
    const dot=document.createElement('span');dot.className='template-swatch';const name=document.createElement('strong');name.textContent=template.name;const count=document.createElement('small');
    button.append(dot,name,count);button.onclick=()=>switchTemplate(template.id);$('template-tabs').append(button);
  }
  createFilterButtons('pool');createFilterButtons('catalog');
  poolSortControl=window.SpirePoolSort.create({container:$('pool-sort'),getSettings:()=>state.poolSort,onChange:settings=>commit(model.setPoolSort(state,settings),true)});
  $('queue-toggle').onclick=toggleQueue;
  resetFilterControls();enableDrop($('pool'));enableQueueDrop();render();
  watchQueueViewport();
  watchCardAutoScroll();
})();
