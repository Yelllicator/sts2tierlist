'use strict';
((root)=>{
  const LABELS={rarity:'稀有度',cost:'费用',type:'卡牌类型'};
  const STATES={none:['—','不排'],asc:['↑','正序'],desc:['↓','逆序']};
  const NEXT={none:'asc',asc:'desc',desc:'none'};
  function create({container,getSettings,onChange}){
    const {normalizePoolSort}=root.SpireBoardModel;
    let pointer=null,dragged=null,suppressClickUntil=0;
    const buttons=new Map();
    const settings=()=>normalizePoolSort(getSettings());
    function clearDrag(){
      const current=pointer;pointer=null;
      if(current?.active)suppressClickUntil=Date.now()+250;
      dragged=null;
      for(const button of buttons.values())button.classList.remove('sort-dragging','sort-drop-before','sort-drop-after');
      if(current?.button.hasPointerCapture(current.id))current.button.releasePointerCapture(current.id);
    }
    function change(next,focusKey){
      onChange(next);render();if(focusKey)buttons.get(focusKey)?.focus({preventScroll:true});
    }
    function insertion(clientX){
      return [...container.children].find(button=>{
        if(button.dataset.sort===dragged)return false;
        const rect=button.getBoundingClientRect();return clientX<rect.left+rect.width/2;
      })?.dataset.sort||null;
    }
    function insideRow(event){
      const rect=container.getBoundingClientRect();
      return event.clientX>=rect.left-12&&event.clientX<=rect.right+12&&event.clientY>=rect.top-12&&event.clientY<=rect.bottom+12;
    }
    function markInsertion(event){
      for(const button of buttons.values())button.classList.remove('sort-drop-before','sort-drop-after');
      if(!insideRow(event))return;
      const before=insertion(event.clientX);
      if(before)buttons.get(before).classList.add('sort-drop-before');
      else [...container.children].filter(button=>button.dataset.sort!==dragged).at(-1)?.classList.add('sort-drop-after');
    }
    function render(){
      const list=settings();
      list.forEach((item,index)=>{
        let button=buttons.get(item.key);
        if(!button){
          button=document.createElement('button');button.type='button';button.className='pool-sort-chip';button.draggable=false;button.dataset.sort=item.key;
          const grip=document.createElement('span');grip.className='sort-grip';grip.textContent='⠿';grip.setAttribute('aria-hidden','true');
          const name=document.createElement('span');name.className='sort-name';name.textContent=LABELS[item.key];
          const state=document.createElement('span');state.className='sort-state';button.append(grip,name,state);
          button.onclick=()=>{
            if(Date.now()<suppressClickUntil)return;
            change(settings().map(sort=>sort.key===item.key?{...sort,direction:NEXT[sort.direction]}:sort));
          };
          button.onpointerdown=event=>{
            if(event.button!==0||event.isPrimary===false||pointer)return;
            pointer={id:event.pointerId,key:item.key,button,x:event.clientX,y:event.clientY,active:false};
            button.setPointerCapture(event.pointerId);
          };
          button.onpointermove=event=>{
            if(!pointer||event.pointerId!==pointer.id)return;
            if(!pointer.active){
              const dx=Math.abs(event.clientX-pointer.x),dy=Math.abs(event.clientY-pointer.y);
              if(dy>6&&dy>dx){suppressClickUntil=Date.now()+250;clearDrag();return;}
              if(dx<6)return;
              pointer.active=true;dragged=pointer.key;button.classList.add('sort-dragging');
            }
            event.preventDefault();markInsertion(event);
          };
          button.onpointerup=event=>{
            if(!pointer||event.pointerId!==pointer.id)return;
            if(!pointer.active||!insideRow(event)){clearDrag();return;}
            const key=pointer.key,before=insertion(event.clientX),list=settings(),moved=list.find(sort=>sort.key===key),next=list.filter(sort=>sort.key!==key);
            const at=before?next.findIndex(sort=>sort.key===before):next.length;next.splice(at<0?next.length:at,0,moved);
            clearDrag();
            if(next.some((sort,index)=>sort.key!==list[index].key))change(next,key);
          };
          button.onpointercancel=button.onlostpointercapture=event=>{
            if(pointer&&event.pointerId===pointer.id){suppressClickUntil=Date.now()+250;clearDrag();}
          };
          button.onkeydown=event=>{
            if(!event.altKey||!['ArrowLeft','ArrowRight'].includes(event.key))return;
            event.preventDefault();event.stopPropagation();const next=settings(),at=next.findIndex(sort=>sort.key===item.key),target=at+(event.key==='ArrowLeft'?-1:1);
            if(target<0||target>=next.length)return;[next[at],next[target]]=[next[target],next[at]];change(next,item.key);
          };
          buttons.set(item.key,button);
        }
        button.dataset.direction=item.direction;button.dataset.priority=String(index+1);
        button.setAttribute('aria-pressed',String(item.direction!=='none'));
        button.setAttribute('aria-label',LABELS[item.key]+'：'+STATES[item.direction][1]);
        button.title='第 '+(index+1)+' 优先级 · 点击切换正序／逆序／不排；拖动或 Alt + 左右键调整优先级';
        button.querySelector('.sort-state').textContent=STATES[item.direction].join(' ');
        if(container.children[index]!==button)container.insertBefore(button,container.children[index]||null);
      });
    }
    render();return {render};
  }
  root.SpirePoolSort={create};
})(typeof window==='undefined'?globalThis:window);
