/* Local screenshot recognition. No uploads, rankings or reference layouts are used. */
(function (global) {
  'use strict';
  const engineUrl = typeof document !== 'undefined' ? document.currentScript?.src : '';
  const median = list => { const s=[...list].sort((a,b)=>a-b); return s[Math.floor(s.length/2)] || 0; };
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  function pixel(im,x,y) { const i=(clamp(Math.round(y),0,im.height-1)*im.width+clamp(Math.round(x),0,im.width-1))*4;return [im.data[i],im.data[i+1],im.data[i+2]]; }
  const distance=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);
  const colorful=c=>Math.max(...c)-Math.min(...c)>28 && Math.max(...c)>70;
  const labelTone=c=>colorful(c)||(Math.max(...c)-Math.min(...c)<24&&Math.max(...c)>65);
  function labelPixel(im,x,y) {const a=[0,0,0];for(const dx of [-2,0,2]){const c=pixel(im,x+dx,y);c.forEach((v,i)=>a[i]+=v);}return a.map(v=>Math.round(v/3));}
  function spans(values,threshold,minLength=1,gap=0) {
    const out=[]; let first=-1,last=-1;
    for(let i=0;i<=values.length+gap;i++) {
      if(i<values.length&&values[i]>=threshold) { if(first<0)first=i; last=i; }
      else if(first>=0&&i-last>gap) {if(last-first+1>=minLength)out.push([first,last+1]);first=-1;}
    }return out;
  }
  function labels(im) {
    const {width:w,height:h}=im, step=Math.max(1,Math.round(w/1000));
    const extentCache=new Map();
    let best=null,single=null;
    for(let x=step*3;x<Math.min(w*.34,450);x+=step*3) {
      const runs=[]; let start=0,ref=labelPixel(im,x,0);
      for(let y=1;y<=h;y++) {
        const c=y<h?labelPixel(im,x,y):[-999,-999,-999];
        if(distance(c,ref)>22) {
          if(y-start>=Math.max(16,Math.min(24,h*.012))&&labelTone(ref))runs.push({y0:start,y1:y,color:ref});
          start=y;ref=c;
        }
      }
      const joined=[];
      for(const r of runs) {const p=joined.at(-1);if(p&&r.y0-p.y1<20&&distance(p.color,r.color)<14)p.y1=r.y1;else joined.push({...r});}
      if(!joined.length)continue;
      let valid=joined.map(r=>({...r,extent:labelExtent(im,r,x,extentCache)})).filter(r=>r.extent&&r.extent[1]-r.extent[0]>Math.max(16,w*.025)&&r.extent[1]<w*.42);
      if(!valid.length)continue;
      const commonEnd=median(valid.map(r=>r.extent[1]));valid=valid.filter(r=>Math.abs(r.extent[1]-commonEnd)<Math.max(12,w*.025));
      const multiple=valid.length>=2&&valid.some(r=>distance(r.color,valid[0].color)>30);
      const total=valid.reduce((s,r)=>s+(r.y1-r.y0)*(colorful(r.color)?1:.6),0);
      const score=total-valid.length*2;
      if(multiple) {if(!best||score>best.score)best={x,runs:valid,score};}
      else if(valid.length===1&&valid[0].y1-valid[0].y0>=Math.max(24,h*.2)&&(!single||score>single.score))single={x,runs:valid,score};
    }
    // A single tier has no color transitions. Accept a bounded label rectangle
    // only when it contains no full-width internal dividers; otherwise a same-
    // color multi-tier table would be silently collapsed into one rank.
    if(!best&&single&&!hasInternalDivider(im,single.runs[0]))best=single;
    if(!best)return [];
    const out=[];
    for(const r of best.runs) {
      const [x0,x1]=r.extent;
      if(x1-x0<Math.max(16,w*.025)||x1>w*.42)continue;
      out.push({...r,x0,x1});
    }
    if(!out.length)return [];
    const xEnd=median(out.map(r=>r.x1));
    const aligned=out.filter(r=>Math.abs(r.x1-xEnd)<Math.max(12,w*.025));
    // Borders and antialiasing interrupt the sampled column by a few pixels.
    // Put shared tier boundaries in those gaps, so grid pitch does not shrink.
    for(let i=1;i<aligned.length;i++) {
      const edge=Math.round((aligned[i-1].y1+aligned[i].y0)/2);
      aligned[i-1].y1=edge;aligned[i].y0=edge;
    }
    for(const r of aligned) {
      r.color=background(im,r.x0+3,r.y0+3,r.x1-3,r.y1-3);
    }
    const merged=[];
    for(const r of aligned) {
      const previous=merged.at(-1);
      if(previous&&distance(previous.color,r.color)<18&&r.y0-previous.y1<Math.max(5,h*.012))previous.y1=r.y1;
      else merged.push(r);
    }
    return merged;
  }
  function hasInternalDivider(im,r) {
    const [left,right]=r.extent,margin=Math.max(4,(r.y1-r.y0)*.035);
    for(let y=Math.ceil(r.y0+margin);y<r.y1-margin;y++) {
      let different=0;
      for(let i=0;i<20;i++)if(distance(pixel(im,left+(right-left)*(.08+.84*(i+.5)/20),y),r.color)>60)different++;
      if(different>=19)return true;
    }
    return false;
  }
  function labelExtent(im,r,seedX,cache) {
    const key=[r.y0,r.y1,...r.color].join(',');
    if(cache.has(key))return cache.get(key).find(([a,b])=>seedX>=a&&seedX<b);
    const counts=[];
    for(let x=0;x<im.width*.45;x++) {
      let matches=0;
      for(let k=0;k<14;k++)if(distance(pixel(im,x,r.y0+(r.y1-r.y0)*(k+.5)/14),r.color)<52)matches++;
      counts.push(matches);
    }
    const groups=spans(counts,7,Math.max(16,im.width*.02),Math.max(2,im.width*.004));cache.set(key,groups);
    return groups.find(([a,b])=>seedX>=a&&seedX<b);
  }
  function background(im,x0,y0,x1,y1) {
    const bins=new Map();
    for(let y=Math.ceil(y0);y<y1;y+=3)for(let x=Math.ceil(x0);x<x1;x+=4) {
      const c=pixel(im,x,y),key=c.map(v=>Math.round(v/16)).join(',');
      const bin=bins.get(key)||{n:0,sum:[0,0,0]};bin.n++;c.forEach((v,i)=>bin.sum[i]+=v);bins.set(key,bin);
    }
    const b=[...bins.values()].sort((a,b)=>b.n-a.n)[0];return b?b.sum.map(v=>Math.round(v/b.n)):[20,20,20];
  }
  function contentFrame(im,tiers,baseHeight) {
    const left=median(tiers.map(t=>t.x1))+2;
    // The outer image edge may be a page margin or a tool rail, not the table
    // background. Pool all rows so a densely filled row cannot choose a card's
    // repeated text-box color as its background.
    const bg=background(im,left,tiers[0].y0+2,im.width-2,tiers.at(-1).y1-2);
    const positions=tiers.flatMap(t=>Array.from({length:18},(_,i)=>t.y0+(t.y1-t.y0)*(i+.5)/18));
    const columns=[];
    for(let x=Math.floor(left);x<im.width-1;x++) {
      const bins=new Map();let matching=0;
      for(const y of positions) {
        const c=pixel(im,x,y);if(distance(c,bg)<32)matching++;
        const key=c.map(v=>Math.round(v/16)).join(',');
        const bin=bins.get(key)||{count:0,color:c};bin.count++;bins.set(key,bin);
      }
      const dominant=[...bins.values()].sort((a,b)=>b.count-a.count)[0];
      columns.push({matching:matching/positions.length,flat:dominant.count/positions.length,color:dominant.color});
    }
    const strip=Math.max(12,Math.round(baseHeight*.22));
    let right=im.width-2;
    // A right-side rail has a flat background running across tiers, separated
    // from the cards by a strip of empty table. Card edges alone do not qualify.
    for(let i=Math.max(strip,Math.floor((im.width*.5-left)));i<columns.length-strip;i++) {
      if(columns[i].flat<.8||distance(columns[i].color,bg)<=32)continue;
      const before=columns.slice(i-strip,i),after=columns.slice(i,i+strip);
      if(before.filter(c=>c.matching>.82).length<strip*.9)continue;
      if(after.filter(c=>c.flat>.6&&distance(c.color,columns[i].color)<24).length<strip*.8)continue;
      let edges=0;
      for(const tier of tiers)for(const y of [tier.y0+1,tier.y1-2])if(distance(pixel(im,left+i+3,y),columns[i].color)<24)edges++;
      if(edges<tiers.length*1.7)continue;
      right=Math.floor(left)+i;break;
    }
    return {bg,right};
  }
  function boxesForTier(im,tier,baseHeight,frame) {
    const w=im.width,x0=Math.min(w-1,tier.x1+2),x1=frame?.right??w-2;
    const bg=frame?.bg||background(im,x0,tier.y0+5,x1,tier.y1-5);
    const active=[];
    for(let y=tier.y0+2;y<tier.y1-2;y++) {
      let count=0;for(let x=x0;x<x1;x+=3)if(distance(pixel(im,x,y),bg)>32)count++;
      const line=pixel(im,(x0+x1)/2,y);let same=0;
      for(let k=0;k<12;k++)if(distance(pixel(im,x0+(x1-x0)*(k+.5)/12,y),line)<28)same++;
      if(same>=10&&distance(line,bg)>32)count=0;
      active.push(count);
    }
    const peak=Math.max(0,...active);
    let bands=spans(active,Math.max(3,peak*.055),Math.max(12,baseHeight*.12),Math.max(1,baseHeight*.02)).map(([a,b])=>[tier.y0+2+a,tier.y0+2+b]);
    const allColumns=[];
    for(let x=x0;x<x1;x++) {let n=0;for(let y=tier.y0+2;y<tier.y1-2;y+=3)if(distance(pixel(im,x,y),bg)>32)n++;allColumns.push(n);}
    const touching=spans(allColumns,Math.max(4,(tier.y1-tier.y0)*.045),15,Math.max(1,baseHeight*.02)).some(([a,b])=>b-a>baseHeight*2);
    if(touching)bands=[[tier.y0,tier.y1]];
    const boxes=[];
    for(const band of bands) {
    const nRows=Math.max(1,Math.round((band[1]-band[0])/baseHeight));
    for(let row=0;row<nRows;row++) {
      const ya=Math.round(band[0]+(band[1]-band[0])*row/nRows)+(touching?2:0);
      const yb=Math.round(band[0]+(band[1]-band[0])*(row+1)/nRows)-(touching?2:0);
      const col=[];
      for(let x=x0;x<x1;x++) {let n=0;for(let y=ya;y<yb;y+=2)if(distance(pixel(im,x,y),bg)>32)n++;col.push(n);}
      const groups=spans(col,Math.max(5,(yb-ya)*.075),Math.max(15,(yb-ya)*.11),Math.max(2,(yb-ya)*.02));
      for(const [a,b] of groups) {
        const xa=x0+a,xb=x0+b,cw=xb-xa;
        const rowCounts=[];
        for(let y=ya;y<yb;y++){
          let n=0;for(let x=xa;x<xb;x+=2)if(distance(pixel(im,x,y),bg)>32)n++;
          const line=pixel(im,(x0+x1)/2,y);let same=0;
          for(let k=0;k<12;k++)if(distance(pixel(im,x0+(x1-x0)*(k+.5)/12,y),line)<28)same++;
          if(same>=10&&distance(line,bg)>32)n=0;
          rowCounts.push(n);
        }
        const vertical=spans(rowCounts,Math.max(3,cw*.025),Math.max(12,(yb-ya)*.12),Math.max(3,(yb-ya)*.05));
        if(!vertical.length)continue;
        const v=vertical.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))[0];
        let top=ya+v[0],bottom=ya+v[1],bh=bottom-top;
        // Touching pure-art grids have no column gaps; derive their cell width
        // from portrait aspect. Separate card components retain their own box.
        const count=cw/bh>1.95?Math.max(1,Math.round(cw/(((band[1]-band[0])/nRows)*1000/760))):1;
        const group={x:xa,y:top,width:cw,height:bh};
        for(let k=0;k<count;k++) {
          const left=xa+cw*k/count,right=xa+cw*(k+1)/count;
          boxes.push({x:left,y:top,width:right-left,height:bottom-top,_group:group});
        }
      }
    }
    }
    return boxes;
  }
  function splitDenseCards(image,tiers,index) {
    const boxes=tiers.flatMap(t=>t.cards);
    const narrow=boxes.filter(b=>b.width/b.height>.5&&b.width/b.height<.90);
    if(narrow.length<3)return null;
    const typicalH=median(narrow.map(b=>b.height)),typicalW=median(narrow.map(b=>b.width));
    const wide=boxes.some(b=>b._group.width>typicalW*1.65&&Math.abs(b._group.height/typicalH-1)<.22);
    if(!wide)return null;
    // Decorative ribbons can bridge adjacent small full cards. Confirm that
    // the compact components really are cards before using their common pitch.
    // Pure-art grids keep their original aspect-based segmentation.
    const verified=[];
    for(const box of narrow.slice(0,18)) {
      if(Math.abs(box.height/typicalH-1)>.2)continue;
      const result=matchBox(image,box,index);
      if(result.mode==='card'&&result.confidence>=.75)verified.push(box);
      if(verified.length>=6)break;
    }
    if(verified.length<3)return null;
    const cardW=median(verified.map(b=>b.width)),cardH=median(verified.map(b=>b.height));
    for(const tier of tiers) {
      const seen=new Set(),out=[];
      for(const box of tier.cards) {
        const group=box._group;
        if(group.width>cardW*1.65&&Math.abs(group.height/cardH-1)<.22) {
          const key=[group.x,group.y,group.width,group.height].join(',');
          if(seen.has(key))continue;seen.add(key);
          const count=Math.max(2,Math.round(group.width/cardW));
          for(let i=0;i<count;i++)out.push({x:group.x+group.width*i/count,y:group.y,width:group.width/count,height:group.height});
        } else out.push(box);
      }
      tier.cards=out;
    }
    return {width:cardW,height:cardH};
  }
  function resizeCrop(im,b,w,h,inset=0) {
    const out=new Uint8Array(w*h*3),xx=b.x+b.width*inset,yy=b.y+b.height*inset,bw=b.width*(1-inset*2),bh=b.height*(1-inset*2);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      // Four taps suppress screenshot JPEG noise and approximate area resampling.
      const c=[0,0,0];
      for(const dy of [-.22,.22])for(const dx of [-.22,.22]) {
        const p=pixel(im,xx+(x+.5+dx)*bw/w,yy+(y+.5+dy)*bh/h);for(let z=0;z<3;z++)c[z]+=p[z];
      }
      for(let z=0;z<3;z++)out[(y*w+x)*3+z]=Math.round(c[z]/4);
    }return out;
  }
  function decode(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
  function prepareIndex(index) {
    if(index.prepared)return index;
    return {...index,prepared:true,cards:index.cards.map(c=>({...c,art:(Array.isArray(c.art)?c.art:[c.art]).map(decode),faces:c.faces.map(f=>({...f,rgba:decode(f.rgba)}))}))};
  }
  function artError(sample,ref) {let sum=0;for(let i=0;i<ref.length;i++){const d=sample[i]-ref[i];sum+=d*d;}return sum/ref.length/65025;}
  function faceError(sample,ref,visible=1) {
    let sum=0,weight=0;
    for(let p=0;p<24*32;p++) {
      const y=Math.floor(p/24),x=p%24,alpha=ref[p*4+3]/255;
      if((y+.5)/32>visible)continue;
      const importance=(y>=4&&y<=18&&x>=3&&x<=20)?1:.12;
      const wt=alpha*importance;if(wt<.01)continue;
      for(let z=0;z<3;z++){const d=sample[p*3+z]-ref[p*4+z];sum+=d*d*wt;weight+=wt;}
    }return sum/Math.max(1,weight)/65025;
  }
  function classifyReview(match={}) {
    let reviewLevel='none',reviewReason='';
    const hasConfidence=Number.isFinite(match.confidence),confidence=hasConfidence?match.confidence:0;
    const candidates=Array.isArray(match.candidates)?match.candidates:[];
    const closeCandidates=candidates.length>1&&Number.isFinite(candidates[0].score)&&Number.isFinite(candidates[1].score)&&candidates[0].score-candidates[1].score<.03;
    // Matching confidence is a heuristic, not a calibrated probability. Keep
    // review policy shared by Worker results and the importer, independent of
    // the descriptor ranking and any legacy needsReview value on the input.
    // Reserve the highest level for missing results or exceptionally weak
    // matches. A close runner-up or a cropped edge alone is only advisory.
    if(!match.id) {reviewLevel='critical';reviewReason='未能识别卡牌，请选择对应卡牌';}
    else if(!hasConfidence) {reviewLevel='critical';reviewReason='识别结果缺少有效分数，请核对';}
    else if(confidence<.28) {reviewLevel='critical';reviewReason='匹配分数极低，当前卡牌可能不正确，请核对';}
    else if(match.clipped||match.cropped) {reviewLevel='severe';reviewReason='卡面被截图边缘截断，请核对';}
    else if(confidence<.48) {reviewLevel='severe';reviewReason='匹配分数较低，请优先核对';}
    else if(confidence<.65||closeCandidates) {
      reviewLevel='moderate';reviewReason=closeCandidates?'前两项候选接近，建议核对':'匹配分数偏低，建议核对';
    }
    return {reviewLevel,reviewReason,needsReview:reviewLevel!=='none'};
  }
  function matchBox(im,box,index,options={}) {
    const clipped=box.y+box.height>=im.height-3;
    const restoreHeight=clipped&&options.cardAspect&&box.height<box.width/options.cardAspect*.95;
    const nominal=restoreHeight?{...box,height:box.width/options.cardAspect}:box;
    const artSamples=[resizeCrop(im,box,32,24,0),resizeCrop(im,box,32,24,.02)];
    const face=resizeCrop(im,nominal,24,32);
    const ratio=nominal.width/nominal.height,visible=clamp((im.height-nominal.y)/nominal.height,0,1);
    let candidates=index.cards.map(card=>{
      let error=Infinity,mode='art';
      if(ratio>.90)for(const sample of artSamples)for(const ref of card.art)error=Math.min(error,artError(sample,ref));
      if(ratio<1.05)for(const f of card.faces){const e=faceError(face,f.rgba,visible);if(e<error){error=e;mode='card';}}
      return {id:card.id,error,mode,card};
    }).sort((a,b)=>a.error-b.error);
    // Card frames vary in padding and low-resolution alpha thresholds can clip
    // a few header pixels. Refine only a short geometric shortlist; never use
    // the tier, neighboring IDs or a reference ranking to choose a candidate.
    if(ratio<1.05&&candidates[0].error>.012) {
      const samples=[];
      for(const offset of [-.05,-.025,0,.025])for(const scale of [.95,1,1.05]) {
        if(offset===0&&scale===1)continue;
        const rect={...nominal,y:nominal.y+offset*nominal.height,height:nominal.height*scale};
        samples.push({pixels:resizeCrop(im,rect,24,32),visible:clamp((im.height-rect.y)/rect.height,0,1),penalty:.0015*(Math.abs(offset)/.025+Math.abs(scale-1)/.05)});
      }
      for(const offset of [-.05,-.025,.025,.05])for(const scale of [.95,1,1.05]) {
        const rect={...nominal,x:nominal.x+offset*nominal.width,width:nominal.width*scale};
        samples.push({pixels:resizeCrop(im,rect,24,32),visible,penalty:.0015*(Math.abs(offset)/.025+Math.abs(scale-1)/.05)});
      }
      for(const candidate of candidates.slice(0,16))for(const sample of samples)for(const f of candidate.card.faces) {
        const e=faceError(sample.pixels,f.rgba,sample.visible)+sample.penalty;
        if(e<candidate.error){candidate.error=e;candidate.mode='card';}
      }
      candidates.sort((a,b)=>a.error-b.error);
    }
    candidates=candidates.slice(0,4);
    const first=candidates[0],second=candidates[1],margin=(second.error-first.error)/Math.max(.01,second.error);
    const quality=clamp(1-first.error/.12,0,1);
    const confidence=clamp(quality*(.55+.45*clamp(margin/.45,0,1)),0,1);
    const match={box,id:first.error<.10?first.id:null,confidence,
      candidates:candidates.map(c=>({id:c.id,score:clamp(1-c.error/.18,0,1)})),mode:first.mode,error:first.error};
    return {...match,...classifyReview(match)};
  }
  function validateImage(image) {
    if(!Number.isInteger(image?.width)||!Number.isInteger(image?.height)||image.width<1||image.height<1||image.width*image.height>32000000||image.data?.length!==image.width*image.height*4)throw new Error('图片尺寸无效或过大，请先缩小截图。');
  }
  function checkAbort(signal) {if(signal?.aborted)throw new DOMException('识别已取消','AbortError');}
  async function analyzeBoxCore(image,box,index,options={}) {
    validateImage(image);checkAbort(options.signal);
    if(!box||!['x','y','width','height'].every(k=>Number.isFinite(box[k]))||box.width<=0||box.height<=0)throw new Error('卡牌框范围无效，请重新框选。');
    const x=clamp(box.x,0,image.width),y=clamp(box.y,0,image.height);
    const clipped={x,y,width:Math.min(image.width,box.x+box.width)-x,height:Math.min(image.height,box.y+box.height)-y};
    if(clipped.width<2||clipped.height<2)throw new Error('卡牌框过小或超出图片，请重新框选。');
    if(!Array.isArray(index?.cards)||!index.cards.length)throw new Error('本地卡牌识别图库不完整。');
    options.onProgress?.({phase:'matching',progress:.2,message:'识别框选卡牌'});
    checkAbort(options.signal);
    const result=matchBox(image,clipped,prepareIndex(index));
    checkAbort(options.signal);
    options.onProgress?.({phase:'done',progress:1,message:'卡牌识别完成'});
    return result;
  }
  async function analyzeCore(image,index,options={}) {
    const progress=options.onProgress||(()=>{}); const check=()=>checkAbort(options.signal);
    validateImage(image);
    if(!Array.isArray(index?.cards)||!index.cards.length)throw new Error('本地卡牌识别图库不完整。');
    check();progress({phase:'layout',progress:.08,message:'定位评级与卡牌'});
    index=prepareIndex(index);
    const found=labels(image);
    if(!found.length)return {width:image.width,height:image.height,tiers:[],warnings:['未能区分评级栏。请保留完整的左侧评级栏；各档全部同色的截图暂需手动分档。']};
    let heightRows=found;
    const allHeights=found.map(r=>r.y1-r.y0),typicalHeight=median(allHeights);
    heightRows=found.filter(r=>!(r.y1>=image.height-2&&r.y1-r.y0<typicalHeight*.75));
    const heights=(heightRows.length?heightRows:found).map(r=>r.y1-r.y0).sort((a,b)=>a-b),baseHeight=median(heights.filter(h=>h<heights[0]*1.3));
    const frame=contentFrame(image,found,baseHeight);
    const tiers=found.map((t,i)=>({name:'评级 '+(i+1),color:'#'+t.color.map(v=>v.toString(16).padStart(2,'0')).join(''),y0:t.y0,y1:t.y1,cards:boxesForTier(image,t,baseHeight,frame),labelBox:{x:t.x0,y:t.y0,width:t.x1-t.x0,height:t.y1-t.y0}}));
    const denseCards=splitDenseCards(image,tiers,index);
    for(const tier of tiers)for(const box of tier.cards)delete box._group;
    const allBoxes=tiers.flatMap(t=>t.cards),medianW=median(allBoxes.map(b=>b.width)),medianH=median(allBoxes.map(b=>b.height));
    const wholeCardRatios=allBoxes.filter(b=>b.y+b.height<image.height-3&&b.width/b.height>.45&&b.width/b.height<.95).map(b=>b.width/b.height);
    const cardAspect=wholeCardRatios.length>=3?median(wholeCardRatios):null;
    for(const t of tiers)t.cards=t.cards.filter(b=>!(b.width<medianW*.66&&b.height<medianH*.8));
    const warnings=['评级名称需要手动填写；请核对标记为待确认的卡牌。'];
    let ignoredEmpty=0;
    while(tiers.length&&tiers[0].cards.length===0){tiers.shift();ignoredEmpty++;}
    while(tiers.length&&tiers.at(-1).cards.length===0){tiers.pop();ignoredEmpty++;}
    if(ignoredEmpty)warnings.push('已忽略首尾没有卡牌的色块；如果它们是空评级，请手动补回。');
    tiers.forEach((t,i)=>t.name='评级 '+(i+1));
    const total=tiers.reduce((n,t)=>n+t.cards.length,0);let done=0;
    for(const tier of tiers) {
      const matches=[];
      for(const box of tier.cards) {
        check();const match=matchBox(image,box,index,{cardAspect});
        if(box.y+box.height>=image.height-3&&cardAspect){match.cropped=true;match.clipped=true;Object.assign(match,classifyReview(match));}
        // Small text/logos outside the regular card grid are not card slots.
        const smallDecoration=denseCards&&box.height<denseCards.height*.75&&match.confidence<.5&&!match.clipped;
        if(!smallDecoration&&!(box.height<medianH*.65&&match.error>.12))matches.push(match);done++;
        if(done%3===0){progress({phase:'matching',progress:.15+.8*done/Math.max(1,total),message:`匹配卡牌 ${done} / ${total}`});await new Promise(resolve=>setTimeout(resolve,0));}
      }
      tier.cards=matches;
    }
    progress({phase:'done',progress:1,message:'识别完成'});
    if(tiers.some(t=>t.cards.some(c=>c.cropped)))warnings.push('截图底部有卡面被截断，已保留并标记为待确认。');
    return {width:image.width,height:image.height,tiers,warnings};
  }
  const indexCache=new Map();
  async function loadIndex(url) {
    if(!indexCache.has(url))indexCache.set(url,(async()=>{
      const response=await fetch(url);if(!response.ok)throw new Error('本地卡牌识别图库加载失败。');
      return prepareIndex(await response.json());
    })().catch(error=>{indexCache.delete(url);throw error;}));
    return indexCache.get(url);
  }
  let idleWorker=null,idleWorkerTimer=null;
  function releaseWorker() {
    clearTimeout(idleWorkerTimer);idleWorkerTimer=null;
    idleWorker?.terminate();idleWorker=null;
  }
  function runWorker(type,imageData,box,options) {
    checkAbort(options.signal);validateImage(imageData);
    const worker=idleWorker||new Worker(engineUrl);idleWorker=null;
    clearTimeout(idleWorkerTimer);idleWorkerTimer=null;
    const indexUrl=new URL('recognition/index.json',engineUrl).href;
    return new Promise((resolve,reject)=>{
      let finished=false;
      const cleanup=reuse=>{
        if(finished)return false;finished=true;
        worker.onmessage=null;worker.onerror=null;options.signal?.removeEventListener('abort',abort);
        if(reuse&&!idleWorker){idleWorker=worker;idleWorkerTimer=setTimeout(releaseWorker,30000);}
        else worker.terminate();return true;
      };
      const abort=()=>{if(cleanup(false))reject(new DOMException('识别已取消','AbortError'));};
      options.signal?.addEventListener('abort',abort,{once:true});
      worker.onmessage=event=>{const d=event.data;if(d.type==='progress')options.onProgress?.(d.value);else if(cleanup(d.type==='result')){d.type==='result'?resolve(d.value):reject(new Error(d.message));}};
      worker.onerror=e=>{if(cleanup(false))reject(new Error(e.message||'本地识别器启动失败'));};
      try {const data=new Uint8ClampedArray(imageData.data);worker.postMessage({type,image:{width:imageData.width,height:imageData.height,data},box,indexUrl},[data.buffer]);}
      catch(error){if(cleanup(false))reject(error);}
    });
  }
  async function runAnalysis(type,imageData,box,options={}) {
    checkAbort(options.signal);
    if(typeof Worker!=='undefined'&&!options.index)return runWorker(type,imageData,box,options);
    const index=options.index||await loadIndex(new URL('recognition/index.json',engineUrl||location.href).href);
    return type==='analyze-box'?analyzeBoxCore(imageData,box,index,options):analyzeCore(imageData,index,options);
  }
  const analyze=(imageData,options={})=>runAnalysis('analyze',imageData,null,options);
  const analyzeBox=(imageData,box,options={})=>runAnalysis('analyze-box',imageData,box,options);
  const api={analyze,analyzeBox,analyzeCore,analyzeBoxCore,prepareIndex,classifyReview,releaseWorker,_test:{labels,boxesForTier,contentFrame,matchBox}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  global.SpireScreenshotEngine=api;
  if(typeof WorkerGlobalScope!=='undefined'&&global instanceof WorkerGlobalScope)global.onmessage=async event=>{
    if(!['analyze','analyze-box'].includes(event.data.type))return;
    try {const index=await loadIndex(event.data.indexUrl),options={onProgress:value=>global.postMessage({type:'progress',value})};const value=event.data.type==='analyze-box'?await analyzeBoxCore(event.data.image,event.data.box,index,options):await analyzeCore(event.data.image,index,options);global.postMessage({type:'result',value});}
    catch(error){global.postMessage({type:'error',message:error.message});}
  };
})(typeof self!=='undefined'?self:globalThis);
