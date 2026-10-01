'use strict';
((root) => {
  const copy=value=>JSON.parse(JSON.stringify(value));
  const abortError=()=>new DOMException('已取消','AbortError');
  const assertActive=signal=>{if(signal?.aborted)throw abortError();};
  const readableError=error=>error?.message||'操作失败，请重试';
  const safeFilename=name=>String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,80)+'-排表.json';
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const button=(text,className)=>{const node=el('button',className,text);node.type='button';return node;};
  const cardCount=board=>Object.values(board?.rows||{}).reduce((sum,row)=>sum+(Array.isArray(row)?row.length:0),0);
  const rankedCount=board=>(board?.tiers||[]).reduce((sum,tier)=>sum+(board.rows?.[tier.id]?.length||0),0);
  function clipped(ctx,text,width){
    const value=String(text).replace(/\s+/gu,' ');if(ctx.measureText(value).width<=width)return value;
    let line='';for(const character of value){if(ctx.measureText(line+character+'…').width>width)break;line+=character;}return line+'…';
  }
  function loadThumb(source,signal){
    assertActive(signal);
    return new Promise((resolve,reject)=>{
      const image=new Image();let settled=false;
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);image.onload=null;image.onerror=null;};
      const finish=(error)=>{if(settled)return;settled=true;cleanup();if(error){image.src='';reject(error);}else resolve(image);};
      const cancel=()=>finish(abortError());
      const timer=setTimeout(()=>finish(Error('缩略图加载超时')),7000);
      signal?.addEventListener('abort',cancel,{once:true});image.decoding='async';
      image.onload=()=>finish();image.onerror=()=>finish(Error('缩略图加载失败'));image.src=source;
    });
  }
  async function makePreview(board,cards,thumbnailSource,signal){
    assertActive(signal);
    const byId=new Map(cards.map(card=>[card.id,card]));
    const theme=root.SpireBoardModel?.TEMPLATES?.find(template=>template.id===board.templateId)?.theme||{};
    const width=600,labelW=72,gap=4,pad=6,columns=10,cardW=(width-labelW-pad*2-gap*(columns-1))/columns,cardH=cardW*1.3;
    const tiers=board.tiers||[];
    const heights=tiers.map(tier=>Math.max(1,Math.ceil((board.rows[tier.id]||[]).length/columns))*(cardH+gap)+pad*2-gap);
    const height=Math.ceil(54+heights.reduce((sum,h)=>sum+h,0)),scale=Math.min(1,1800/height);
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    try{
      const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法生成缩略图');
      ctx.scale(scale,scale);ctx.fillStyle=theme.bg||'#101612';ctx.fillRect(0,0,width,height);ctx.fillStyle='#e8e6d7';ctx.font='600 18px "Microsoft YaHei",sans-serif';ctx.fillText(clipped(ctx,board.title,width-28),14,25);
      const unavailable=cards.filter(card=>card.unavailableInVersion).length;
      ctx.font='10px "Microsoft YaHei",sans-serif';ctx.fillStyle='#a1ad9c';ctx.fillText((board.gameVersion?'v'+board.gameVersion+' · ':'')+tiers.length+' 档 · 已排 '+rankedCount(board)+' 张 · 待排 '+(board.rows.pool?.length||0)+' 张'+(unavailable?' · † 版本外 '+unavailable+' 张':''),14,43);
      let y=54;
      for(let row=0;row<tiers.length;row++){
        assertActive(signal);const tier=tiers[row],rowHeight=heights[row],ids=board.rows[tier.id]||[];
        ctx.fillStyle=tier.color;ctx.fillRect(0,y,labelW,rowHeight);ctx.fillStyle=row%2?(theme.alternate||'#19221b'):(theme.row||'#141b15');ctx.fillRect(labelW,y,width-labelW,rowHeight);
        const n=parseInt(tier.color.slice(1),16);ctx.fillStyle=(.299*(n>>16)+.587*((n>>8)&255)+.114*(n&255))>145?'#202719':'#fffaf0';
        ctx.font=(tier.name.length<5?'600 17px':'600 11px')+' "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.fillText(clipped(ctx,tier.name,labelW-12),labelW/2,y+rowHeight/2+4);ctx.textAlign='left';
        for(let i=0;i<ids.length;i++){
          assertActive(signal);const card=byId.get(ids[i]);if(!card)continue;
          const x=labelW+pad+i%columns*(cardW+gap),cy=y+pad+Math.floor(i/columns)*(cardH+gap);
          try{
            const source=thumbnailSource(card,board.language);if(!source)throw Error('无卡面');
            const face=await loadThumb(source,signal);assertActive(signal);
            const ratio=Math.min(cardW/face.naturalWidth,cardH/face.naturalHeight);ctx.drawImage(face,x+(cardW-face.naturalWidth*ratio)/2,cy+(cardH-face.naturalHeight*ratio)/2,face.naturalWidth*ratio,face.naturalHeight*ratio);face.src='';
            if(card.unavailableInVersion){ctx.fillStyle='#ffe0ac';ctx.font='bold 14px sans-serif';ctx.fillText('†',x+cardW-7,cy+12);}
          }catch(error){if(error.name==='AbortError')throw error;ctx.fillStyle='#364334';ctx.fillRect(x+3,cy+3,cardW-6,cardH-6);}
        }
        y+=rowHeight;ctx.strokeStyle='#3a4637';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();
      }
      assertActive(signal);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.8));assertActive(signal);if(!blob)throw Error('缩略图生成失败');return blob;
    }finally{canvas.width=1;canvas.height=1;}
  }
  function create({store,getBoard,loadBoard,validateBoard,cards=[],cardsForBoard=()=>cards,versionLabel=null,templates=[],thumbnailSource,notify=()=>{},download}){
    if(!store||typeof getBoard!=='function'||typeof loadBoard!=='function'||typeof thumbnailSource!=='function')throw Error('方案库配置不完整');
    const templateMap=templates instanceof Map?templates:new Map(templates.map(template=>[template.id,template]));
    const templateName=board=>templateMap.get(board?.templateId)?.name||'方案';
    const summary=board=>templateName(board)+' · '+cardCount(board)+' 张 · '+(board?.tiers?.length||0)+' 档'+(versionLabel?' · '+versionLabel(board.gameVersion):'');
    let generation=0,controller=null,mode=null,busy=false,records=[],selectedId=null,deleted=false,snapshot=null,savePreview=null,savePreviewTask=null,listRequest=0;
    const objectUrls=new Map(),previewCache=new Map(),previewJobs=new Map();
    const dialog=el('dialog','sl-dialog');dialog.setAttribute('aria-label','本地方案库');
    const header=el('div','sl-header'),heading=el('h2','', '本地方案库'),closeButton=button('×','sl-close');closeButton.setAttribute('aria-label','关闭方案库');header.append(heading,closeButton);
    const errorBox=el('p','sl-error');errorBox.setAttribute('role','alert');errorBox.hidden=true;
    const saveForm=el('form','sl-save'),nameLabel=el('label','sl-name-label'),nameText=el('span','','方案名称'),nameInput=el('input');nameInput.type='text';nameInput.maxLength=80;nameInput.required=true;nameInput.autocomplete='off';nameLabel.append(nameText,nameInput);
    const saveSummary=el('p','sl-summary'),saveImageWrap=el('div','sl-save-preview'),saveImage=el('img'),saveImageState=el('span','','正在生成预览…');saveImage.alt='当前方案预览';saveImage.hidden=true;saveImageWrap.append(saveImage,saveImageState);
    const saveActions=el('div','sl-save-actions'),saveExport=button('导出 JSON','sl-save-export'),cancelSave=button('取消'),saveButton=button('保存方案','primary');saveButton.type='submit';saveActions.append(saveExport,cancelSave,saveButton);saveForm.append(nameLabel,saveSummary,saveImageWrap,saveActions);
    const library=el('div','sl-library'),tools=el('div','sl-tools'),search=el('input','sl-search');search.type='search';search.placeholder='搜索方案';search.setAttribute('aria-label','搜索方案');
    const importButton=button('从文件导入'),trashButton=button('回收站','quiet'),fileInput=el('input');fileInput.type='file';fileInput.accept='.json,application/json';fileInput.hidden=true;tools.append(search,importButton,trashButton,fileInput);
    const workspace=el('div','sl-workspace'),grid=el('div','sl-grid');grid.setAttribute('role','group');grid.setAttribute('aria-label','已保存方案');
    const detail=el('section','sl-detail'),detailEmpty=el('p','sl-detail-empty','选择一个方案查看预览'),detailBody=el('div','sl-detail-body'),detailTitle=el('h3'),detailMeta=el('p','sl-meta'),detailPreview=el('div','sl-detail-preview'),detailImage=el('img'),detailPreviewState=el('span'),detailActions=el('div','sl-detail-actions');
    detailImage.alt='所选方案预览';detailPreview.append(detailImage,detailPreviewState);
    const loadButton=button('载入方案','primary'),exportButton=button('导出 JSON'),deleteButton=button('移到回收站','sl-delete'),restoreButton=button('恢复方案','primary');detailActions.append(loadButton,restoreButton,exportButton,deleteButton);detailBody.append(detailTitle,detailMeta,detailPreview,detailActions);detail.append(detailEmpty,detailBody);workspace.append(grid,detail);library.append(tools,workspace);
    const status=el('div','sl-status');status.setAttribute('role','status');dialog.append(header,errorBox,saveForm,library,status);document.body.append(dialog);
    const alive=token=>mode!==null&&generation===token&&!controller?.signal.aborted;
    const fail=error=>{errorBox.textContent=readableError(error);errorBox.hidden=false;};
    const clearError=()=>{errorBox.hidden=true;errorBox.textContent='';};
    const dateText=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});};
    const getUrl=(key,blob)=>{if(!objectUrls.has(key))objectUrls.set(key,URL.createObjectURL(blob));return objectUrls.get(key);};
    function preview(record){
      if(record.preview instanceof Blob)return Promise.resolve(record.preview);
      if(previewCache.has(record.id))return Promise.resolve(previewCache.get(record.id));
      if(previewJobs.has(record.id))return previewJobs.get(record.id);
      const token=generation,signal=controller.signal;
      const task=makePreview(record.board,cardsForBoard(record.board),thumbnailSource,signal).then(blob=>{
        if(alive(token)){previewCache.set(record.id,blob);if(previewCache.size>24)previewCache.delete(previewCache.keys().next().value);}return blob;
      }).finally(()=>{if(previewJobs.get(record.id)===task)previewJobs.delete(record.id);});
      previewJobs.set(record.id,task);return task;
    }
    function setBusy(value,message=''){
      busy=value;dialog.setAttribute('aria-busy',String(value));
      for(const item of [saveButton,nameInput,importButton,trashButton,loadButton,restoreButton,exportButton,deleteButton])item.disabled=value;
      status.textContent=message;saveButton.textContent=mode==='save'&&value?'正在保存…':'保存方案';
    }
    function close(){
      generation++;controller?.abort();controller=null;mode=null;busy=false;listRequest++;previewJobs.clear();
      if(dialog.open)dialog.close();
      for(const url of objectUrls.values())URL.revokeObjectURL(url);objectUrls.clear();
      saveImage.removeAttribute('src');detailImage.removeAttribute('src');grid.replaceChildren();records=[];snapshot=null;savePreview=null;savePreviewTask=null;fileInput.value='';
    }
    function begin(next){
      close();mode=next;controller=new AbortController();setBusy(false);clearError();saveForm.hidden=next!=='save';library.hidden=next!=='load';heading.textContent=next==='save'?'保存方案':'本地方案库';
      dialog.showModal();return generation;
    }
    function showDetail(){
      const record=records.find(item=>item.id===selectedId);detailBody.hidden=!record;detailEmpty.hidden=Boolean(record);detailImage.removeAttribute('src');detailImage.hidden=true;
      if(!record)return;
      detailTitle.textContent=record.name;detailMeta.textContent=summary(record.board)+'\n'+(record.deletedAt?'删除于 '+dateText(record.deletedAt):dateText(record.createdAt));detailPreviewState.textContent='正在生成预览…';detailPreviewState.hidden=false;
      loadButton.hidden=deleted;deleteButton.hidden=deleted;restoreButton.hidden=!deleted;
      const token=generation,id=record.id;
      preview(record).then(blob=>{if(!alive(token)||selectedId!==id)return;const url=getUrl(id,blob);detailImage.src=url;detailImage.hidden=false;detailPreviewState.hidden=true;const tile=Array.from(grid.children).find(item=>item.dataset.schemeId===id);if(tile){const image=tile.querySelector('img'),placeholder=tile.querySelector('.sl-tile-preview span');image.src=url;image.hidden=false;placeholder.hidden=true;}}).catch(error=>{if(alive(token)&&selectedId===id&&error.name!=='AbortError')detailPreviewState.textContent='暂无预览';});
    }
    function renderGrid(){
      const query=search.value.trim().toLocaleLowerCase();const filtered=records.filter(record=>[record.name,record.board?.title,templateName(record.board)].join(' ').toLocaleLowerCase().includes(query));
      if(selectedId&&!filtered.some(record=>record.id===selectedId))selectedId=null;
      const nodes=filtered.map(record=>{
        const tile=button('','sl-tile');tile.setAttribute('aria-pressed',String(selectedId===record.id));tile.dataset.schemeId=record.id;
        const thumb=el('div','sl-tile-preview'),image=el('img'),placeholder=el('span','','排表预览');image.alt='';image.loading='lazy';image.decoding='async';image.hidden=true;thumb.append(image,placeholder);
        const title=el('strong','',record.name),meta=el('small','',summary(record.board)),time=el('small','sl-time',dateText(deleted?record.deletedAt:record.createdAt));tile.append(thumb,title,meta,time);
        const blob=record.preview instanceof Blob?record.preview:previewCache.get(record.id);if(blob){image.src=getUrl(record.id,blob);image.hidden=false;placeholder.hidden=true;}
        // Old JSON files have no thumbnail. Only render the selected one on demand.
        tile.onclick=()=>{selectedId=record.id;for(const sibling of grid.children)sibling.setAttribute('aria-pressed',String(sibling===tile));showDetail();const token=generation;preview(record).then(result=>{if(alive(token)&&tile.isConnected){image.src=getUrl(record.id,result);image.hidden=false;placeholder.hidden=true;}}).catch(()=>{});};
        return tile;
      });
      if(!nodes.length){const empty=el('div','sl-empty');empty.append(el('strong','',query?'没有匹配的方案':deleted?'回收站为空':'还没有保存的方案'));if(!query&&!deleted){const firstImport=button('从文件导入');firstImport.onclick=()=>{if(!busy)fileInput.click();};empty.append(firstImport);}nodes.push(empty);}
      grid.replaceChildren(...nodes);status.textContent=(deleted?'回收站':'方案库')+' · '+filtered.length+' 个';showDetail();
    }
    async function refresh(preferId=null){
      const token=generation,request=++listRequest,wantedId=preferId||selectedId;records=[];selectedId=null;grid.replaceChildren(el('div','sl-empty','正在读取方案…'));showDetail();status.textContent='正在读取方案…';
      try{const list=await store.list({deleted});if(!alive(token)||request!==listRequest)return;records=list;selectedId=wantedId;if(!records.some(record=>record.id===selectedId))selectedId=null;renderGrid();}
      catch(error){if(alive(token)&&request===listRequest){fail(error);status.textContent='读取失败';const retry=button('重试');retry.onclick=()=>{clearError();refresh();};grid.replaceChildren(retry);}}
    }
    async function openSave(){
      let board;try{board=copy(getBoard());}catch(error){notify(readableError(error));return;}
      const token=begin('save');snapshot=board;nameInput.value=board.title||'';saveSummary.textContent=summary(board);saveImage.hidden=true;saveImageState.hidden=false;saveImageState.textContent='正在生成预览…';nameInput.focus();nameInput.select();
      const task=makePreview(board,cardsForBoard(board),thumbnailSource,controller.signal);savePreviewTask=task;
      try{const blob=await task;if(!alive(token))return;savePreview=blob;saveImage.src=getUrl('save',blob);saveImage.hidden=false;saveImageState.hidden=true;}
      catch(error){if(alive(token)&&error.name!=='AbortError')saveImageState.textContent='暂无预览，仍可保存';}
    }
    function openLoad(){begin('load');deleted=false;selectedId=null;search.value='';trashButton.textContent='回收站';trashButton.setAttribute('aria-pressed','false');detailBody.hidden=true;detailEmpty.hidden=false;refresh();search.focus();}
    closeButton.onclick=close;cancelSave.onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{if(mode!==null&&!dialog.open)close();});
    saveExport.onclick=async()=>{
      if(mode!=='save'||!snapshot)return;const token=generation;clearError();
      try{if(typeof download!=='function')throw Error('下载功能不可用');const blob=new Blob([JSON.stringify({...copy(snapshot),game:'Slay the Spire 2'},null,2)],{type:'application/json'});await download(blob,safeFilename(nameInput.value.trim()||snapshot.title));if(alive(token))notify('方案 JSON 已导出');}
      catch(error){if(alive(token))fail(error);}
    };
    saveForm.onsubmit=async event=>{
      event.preventDefault();if(busy||mode!=='save')return;clearError();const name=nameInput.value.trim();if(!name||name.length>80){fail(Error('方案名称需为 1–80 个字符'));nameInput.focus();return;}
      const token=generation,board=copy(snapshot);setBusy(true,'正在保存…');
      try{let blob=savePreview;if(!blob&&savePreviewTask)try{blob=await savePreviewTask;}catch(error){if(error.name==='AbortError')throw error;}if(!alive(token))return;await store.save({name,board,preview:blob||null});if(!alive(token))return;close();notify('方案已保存到本地方案库');}
      catch(error){if(alive(token)&&error.name!=='AbortError')fail(error);}
      finally{if(alive(token))setBusy(false);}
    };
    search.oninput=()=>renderGrid();importButton.onclick=()=>fileInput.click();
    trashButton.onclick=()=>{if(busy)return;clearError();deleted=!deleted;selectedId=null;trashButton.textContent=deleted?'返回方案库':'回收站';trashButton.setAttribute('aria-pressed',String(deleted));refresh();};
    fileInput.onchange=async()=>{
      const file=fileInput.files[0];fileInput.value='';if(!file||busy)return;
      const token=generation;clearError();setBusy(true,'正在导入…');
      try{
        if(file.size>1024*1024)throw Error('方案文件不能超过 1 MB');
        let parsed;try{parsed=JSON.parse(await file.text());}catch{throw Error('无法读取 JSON 方案文件');}
        if(!alive(token))return;
        const board=copy(typeof validateBoard==='function'?await validateBoard(parsed):parsed);if(!alive(token))return;
        const name=typeof board?.title==='string'&&board.title.trim()?board.title.trim():file.name.replace(/\.json$/i,'');
        let blob=null,previewFailed=false;status.textContent='正在生成预览…';
        try{blob=await makePreview(board,cardsForBoard(board),thumbnailSource,controller.signal);}catch(error){if(error.name==='AbortError')throw error;previewFailed=true;}
        if(!alive(token))return;
        status.textContent='正在保存…';const record=await store.save({name,board,preview:blob});if(!alive(token))return;
        deleted=false;trashButton.textContent='回收站';trashButton.setAttribute('aria-pressed','false');search.value='';await refresh(record.id);if(alive(token))notify(previewFailed?'已导入方案库，缩略图未能生成':'已导入方案库');
      }catch(error){if(alive(token))fail(error);}finally{if(alive(token))setBusy(false);}
    };
    loadButton.onclick=async()=>{
      if(busy||!selectedId)return;const token=generation,id=selectedId;clearError();setBusy(true,'正在载入…');
      try{const record=await store.get(id);if(!alive(token))return;if(!record||record.deletedAt)throw Error('方案已被移除，请刷新方案库');await loadBoard(copy(record.board));if(alive(token))close();}
      catch(error){if(alive(token))fail(error);}finally{if(alive(token))setBusy(false);}
    };
    exportButton.onclick=async()=>{
      if(busy||!selectedId)return;const token=generation,id=selectedId;clearError();setBusy(true,'正在导出…');
      try{const record=await store.get(id);if(!alive(token))return;if(!record)throw Error('方案不存在');const blob=new Blob([JSON.stringify({...record.board,game:'Slay the Spire 2'},null,2)],{type:'application/json'});if(typeof download!=='function')throw Error('下载功能不可用');await download(blob,safeFilename(record.name));}
      catch(error){if(alive(token))fail(error);}finally{if(alive(token))setBusy(false);}
    };
    async function changeDeleted(restore){
      if(busy||!selectedId)return;const token=generation,id=selectedId;clearError();setBusy(true,restore?'正在恢复…':'正在移入回收站…');
      try{const record=await (restore?store.restore(id):store.remove(id));if(!alive(token))return;if(!record)throw Error('方案已不存在，请刷新方案库');selectedId=null;await refresh();if(alive(token))notify(restore?'方案已恢复':'已移到回收站，可恢复');}
      catch(error){if(alive(token))fail(error);}finally{if(alive(token))setBusy(false);}
    }
    deleteButton.onclick=()=>changeDeleted(false);restoreButton.onclick=()=>changeDeleted(true);
    return {openSave,openLoad,close};
  }
  root.SpireSchemeLibrary={create};
})(typeof window==='undefined'?globalThis:window);
