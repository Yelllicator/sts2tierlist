'use strict';
window.SpirePng = (() => {
  function lines(ctx,text,width){
    const result=[];
    for(const paragraph of String(text).replace(/\r\n?/g,'\n').split('\n')){
      let line='';
      for(const token of paragraph.split(/(\s+)/u)){
        if(!token)continue;
        if(/^\s+$/u.test(token)){if(line)line+=' ';continue;}
        if(line&&ctx.measureText(line+token).width>width){result.push(line.trimEnd());line='';}
        for(const character of Array.from(token)){
          if(line&&ctx.measureText(line+character).width>width){result.push(line);line='';}
          line+=character;
        }
      }
      result.push(line.trimEnd());
    }
    return result;
  }
  function labelLayout(ctx,name,width,cardHeight){
    const paragraph=name.length>24||name.includes('\n');
    let fontSize=paragraph?20:name.length<=2?40:25;
    let wrapped,lineHeight,height;
    do{
      ctx.font='600 '+fontSize+'px "Microsoft YaHei",sans-serif';
      wrapped=lines(ctx,name,width-22);lineHeight=fontSize*1.3;height=Math.ceil(wrapped.length*lineHeight+32);
      if(!paragraph||height<=cardHeight||fontSize<=14)break;
      fontSize--;
    }while(true);
    return {fontSize,lines:wrapped,lineHeight,height:Math.max(cardHeight,height)};
  }
  function contrast(hex){const n=parseInt(hex.slice(1),16);return .299*(n>>16)+.587*((n>>8)&255)+.114*(n&255)>145?'#202719':'#fffaf0';}
  function loadFace(source,name){
    return new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>{image.onload=null;image.onerror=null;resolve(image);};
      image.onerror=()=>{image.onload=null;image.onerror=null;reject(Error('卡面加载失败：'+name));};
      image.src=source;
    });
  }
  async function render(documentSnapshot,cards,imageSource,scale=4){
    if(typeof scale!=='number'||!Number.isFinite(scale)||scale<=0)throw Error('无效的导出清晰度');
    const doc=JSON.parse(JSON.stringify(documentSnapshot));
    const byId=new Map(cards.map(c=>[c.id,{...c}]));
    const template=window.SpireBoardModel?.TEMPLATES.find(t=>t.id===doc.templateId);
    const theme={...(template?.theme||{bg:'#111811',row:'#131a12',alternate:'#182016',line:'#3d4836'})};
    const width=1500,labelW=doc.tiers.some(t=>t.name.length>24||t.name.includes('\n'))?224:130,pad=12,gap=8,columns=10;
    const cardW=(width-labelW-pad*2-gap*(columns-1))/columns;
    const hasForeign=doc.tiers.some(t=>doc.rows[t.id].some(id=>byId.get(id)?.unavailableInVersion));
    const faceH=cardW*1.3,cardH=faceH+(hasForeign?48:32);
    const canvas=document.createElement('canvas');
    try{
      const ctx=canvas.getContext('2d');
      if(!ctx)throw Error('浏览器无法创建图片画布');
      ctx.font='600 36px "Microsoft YaHei",sans-serif';
      const titleLines=lines(ctx,doc.title,width-70),head=48+titleLines.length*44+(doc.gameVersion?26:0);
      const labels=doc.tiers.map(t=>labelLayout(ctx,t.name,labelW,Math.max(1,Math.ceil(doc.rows[t.id].length/columns))*(cardH+gap)+pad*2-gap));
      const heights=labels.map(label=>label.height);
      const height=Math.ceil(head+heights.reduce((a,b)=>a+b,0));
      const outputWidth=Math.round(width*scale),outputHeight=Math.round(height*scale);
      if(outputWidth<1||outputHeight<1||outputWidth*outputHeight>96000000||outputWidth>30000||outputHeight>30000)throw Error('当前排表过大，请降低清晰度或减少空档后导出');
      // Capture source paths before awaiting, without retaining decoded card faces.
      const sources=new Map(doc.tiers.flatMap(t=>doc.rows[t.id]).map(id=>{
        const card=byId.get(id);if(!card)throw Error('找不到卡牌：'+id);
        return [id,imageSource(card,doc.language)];
      }));
      canvas.width=outputWidth;canvas.height=outputHeight;ctx.scale(scale,scale);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      ctx.fillStyle=theme.bg;ctx.fillRect(0,0,width,height);ctx.fillStyle='#e8dfc8';ctx.font='600 36px "Microsoft YaHei",sans-serif';ctx.textAlign='left';
      titleLines.forEach((line,i)=>ctx.fillText(line,35,46+i*44));
      if(doc.gameVersion){ctx.font='16px "Microsoft YaHei",sans-serif';ctx.fillStyle='#b9b5ab';ctx.fillText('v'+doc.gameVersion+(hasForeign?' · † 版本外卡牌，保留所选卡面与规则':''),35,head-20);}
      let y=head;
      for(let i=0;i<doc.tiers.length;i++){
        const tier=doc.tiers[i];
        ctx.fillStyle=tier.color;ctx.fillRect(0,y,labelW,heights[i]);ctx.fillStyle=contrast(tier.color);ctx.textAlign='center';
        const {fontSize,lines:labelLines,lineHeight}=labels[i];ctx.font='600 '+fontSize+'px "Microsoft YaHei",sans-serif';
        labelLines.forEach((line,n)=>ctx.fillText(line,labelW/2,y+heights[i]/2+(n-(labelLines.length-1)/2)*lineHeight+fontSize*.35));
        ctx.fillStyle=i%2?theme.alternate:theme.row;ctx.fillRect(labelW,y,width-labelW,heights[i]);
        for(let j=0;j<doc.rows[tier.id].length;j++){
          const id=doc.rows[tier.id][j],card=byId.get(id);
          const x=labelW+pad+(j%columns)*(cardW+gap),cy=y+pad+Math.floor(j/columns)*(cardH+gap);
          // Load one full-resolution face at a time to avoid a second large image heap.
          let image=await loadFace(sources.get(id),card.name);
          const ratio=Math.min(cardW/image.width,faceH/image.height);
          ctx.drawImage(image,x+(cardW-image.width*ratio)/2,cy+(faceH-image.height*ratio)/2,image.width*ratio,image.height*ratio);
          image=null;
          ctx.fillStyle='#e7e8db';ctx.font='15px "Microsoft YaHei",sans-serif';
          const nameLines=lines(ctx,card.name+(card.unavailableInVersion?' †':''),cardW);
          nameLines.forEach((line,n)=>ctx.fillText(line,x+cardW/2,cy+faceH+17+n*16));
          if(card.unavailableInVersion){ctx.font='12px "Microsoft YaHei",sans-serif';ctx.fillStyle='#b9b5ab';ctx.fillText('v'+card.gameVersion,x+cardW/2,cy+faceH+17+nameLines.length*16);}
        }
        y+=heights[i];ctx.strokeStyle=theme.line;ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();
      }
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob)throw Error('图片生成失败，请降低清晰度后重试');
      return {blob,width:outputWidth,height:outputHeight,title:doc.title,language:doc.language};
    }finally{
      canvas.width=1;canvas.height=1;
    }
  }
  return {render};
})();
