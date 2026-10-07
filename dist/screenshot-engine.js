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
    // Same-color rows can share one color run; recover their rules below.
    if(!best&&single)best=single;
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
    return merged.flatMap(r=>splitLabelDividers(im,r));
  }
  function splitLabelDividers(im,r) {
    const width=r.x1-r.x0,minHeight=16,lines=[];
    // A rule crosses almost the entire label in one contrasting color.
    // Text and card-row gaps are not tier boundaries. Scan only the label,
    // so tightly packed cards or an empty tier do not hide a genuine rule.
    for(let y=r.y0;y<r.y1;y++) {
      const colors=Array.from({length:40},(_,i)=>pixel(im,r.x0+width*(.06+.88*(i+.5)/40),y));
      const tone=[0,1,2].map(z=>median(colors.map(c=>c[z])));
      lines.push(distance(tone,r.color)>60&&colors.filter(c=>distance(c,tone)<32).length>=38?1:0);
    }
    const cuts=[];let previous=r.y0;
    for(const [a,b] of spans(lines,1)) {
      const edge=r.y0+Math.floor((a+b)/2);
      if(b-a>Math.max(4,width*.06)||edge-previous<minHeight||r.y1-edge<minHeight)continue;
      cuts.push(edge);previous=edge;
    }
    const edges=[r.y0,...cuts,r.y1];
    return edges.slice(1).map((end,i)=>({...r,y0:edges[i],y1:end}));
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
      const result=matchLegacyBox(image,box,index);
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
  function matchLegacyBox(im,box,index,options={}) {
    const clipped=box.y+box.height>=im.height-3;
    const restoreHeight=!options.skipRefine&&clipped&&options.cardAspect&&box.height<box.width/options.cardAspect*.95;
    const nominal=restoreHeight?{...box,height:box.width/options.cardAspect}:box;
    const artSamples=[resizeCrop(im,box,32,24,0),resizeCrop(im,box,32,24,.02)];
    const face=resizeCrop(im,nominal,24,32);
    const ratio=nominal.width/nominal.height,visible=clamp((im.height-nominal.y)/nominal.height,0,1);
    let candidates=index.cards.map(card=>{
      let error=Infinity,mode='art';
      const versionErrors=new Map();
      if(ratio>.90)for(const sample of artSamples)for(const ref of card.art)error=Math.min(error,artError(sample,ref));
      if(ratio<1.05)for(const f of card.faces){
        const e=faceError(face,f.rgba,visible);
        for(const version of f.versions||[])versionErrors.set(version,Math.min(versionErrors.get(version)??Infinity,e));
        if(e<error){error=e;mode='card';}
      }
      return {id:card.id,error,mode,card,versionErrors};
    }).sort((a,b)=>a.error-b.error);
    // Card frames vary in padding and low-resolution alpha thresholds can clip
    // a few header pixels. Refine only a short geometric shortlist; never use
    // the tier, neighboring IDs or a reference ranking to choose a candidate.
    if(ratio<1.05&&candidates[0].error>.012&&!options.skipRefine) {
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
        for(const version of f.versions||[])candidate.versionErrors.set(version,Math.min(candidate.versionErrors.get(version)??Infinity,e));
        if(e<candidate.error){candidate.error=e;candidate.mode='card';}
      }
      candidates.sort((a,b)=>a.error-b.error);
    }
    candidates=candidates.slice(0,options.candidateLimit||4);
    const first=candidates[0],second=candidates[1],margin=(second.error-first.error)/Math.max(.01,second.error);
    const quality=clamp(1-first.error/.12,0,1);
    const confidence=clamp(quality*(.55+.45*clamp(margin/.45,0,1)),0,1);
    const versionMatch=c=>{
      if(c.mode==='art')return {sourceVersions:c.card.versions||[],possibleVersions:c.card.versions||[]};
      const ranked=[...c.versionErrors].sort((a,b)=>a[1]-b[1]);
      // Keep exact ties, and expose close version alternatives instead of claiming certainty.
      return {sourceVersions:ranked.filter(v=>v[1]-ranked[0][1]<1e-9).map(v=>v[0]),
        possibleVersions:ranked.filter(v=>v[1]-ranked[0][1]<.003).map(v=>v[0])};
    };
    const match={box,id:first.error<.10?first.id:null,confidence,...versionMatch(first),
      candidates:candidates.map(c=>({id:c.id,score:clamp(1-c.error/.18,0,1),...versionMatch(c)})),mode:first.mode,error:first.error};
    return {...match,...classifyReview(match)};
  }

  // Search visible parts of several geometries before narrowing identities.
  // All samples are confined to this card's observed box, even when a virtual
  // full-card rectangle extends into a neighboring row or outside the image.
  const shapeCache=new WeakMap();
  function descriptorCrop(data,sw,sh,channels,w,h,rect={x:0,y:0,width:1,height:1}) {
    const out=new Float32Array(w*h*channels);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const u=clamp((rect.x+(x+.5)*rect.width/w)*sw-.5,0,sw-1),v=clamp((rect.y+(y+.5)*rect.height/h)*sh-.5,0,sh-1);
      const x0=Math.floor(u),y0=Math.floor(v),x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1),a=u-x0,b=v-y0;
      for(let z=0;z<channels;z++)out[(y*w+x)*channels+z]=
        data[(y0*sw+x0)*channels+z]*(1-a)*(1-b)+data[(y0*sw+x1)*channels+z]*a*(1-b)+
        data[(y1*sw+x0)*channels+z]*(1-a)*b+data[(y1*sw+x1)*channels+z]*a*b;
    }
    return out;
  }
  function shapeIndex(index) {
    if(shapeCache.has(index))return shapeCache.get(index);
    const tiles=[{x:0,y:0,width:1,height:1}];
    for(const size of [.85,.7])for(const position of [0,.5,1]) {
      tiles.push({x:(1-size)*position,y:0,width:size,height:1});
      tiles.push({x:0,y:(1-size)*position,width:1,height:size});
    }
    for(const x of [0,.5,1])for(const y of [0,.5,1])tiles.push({x:x*.3,y:y*.3,width:.7,height:.7});
    const prepared=index.cards.map(card=>({card,
      faces:card.faces.map((face,i)=>({face,coarse:descriptorCrop(face.rgba,24,32,4,8,12),labels:card.faceLabels?.[i]||[]})),
      art:card.art.flatMap(ref=>tiles.map(tile=>({tile,coarse:descriptorCrop(ref,32,24,3,12,9,tile),full:descriptorCrop(ref,32,24,3,32,24,tile)})))
    }));
    shapeCache.set(index,prepared);return prepared;
  }
  function visibleSample(im,box,rect,w,h) {
    const pixels=new Float32Array(w*h*3),mask=new Uint8Array(w*h);
    const left=Math.max(0,box.x),right=Math.min(im.width,box.x+box.width),top=Math.max(0,box.y),bottom=Math.min(im.height,box.y+box.height);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const xx=rect.x+(x+.5)*rect.width/w,yy=rect.y+(y+.5)*rect.height/h,p=y*w+x;
      if(xx<left||xx>=right||yy<top||yy>=bottom)continue;
      mask[p]=1;
      for(const dy of [-.22,.22])for(const dx of [-.22,.22]) {
        const ix=clamp(Math.round(xx+dx*rect.width/w),Math.ceil(left),Math.ceil(right)-1),iy=clamp(Math.round(yy+dy*rect.height/h),Math.ceil(top),Math.ceil(bottom)-1),j=(iy*im.width+ix)*4;
        for(let z=0;z<3;z++)pixels[p*3+z]+=im.data[j+z]/4;
      }
    }
    return {pixels,mask,w,h};
  }
  const weightCache=new WeakMap();
  function maskedFaceError(sample,ref) {
    const {pixels,mask,w,h}=sample;let weights=weightCache.get(ref);
    if(!weights) {
      const values=new Float32Array(w*h),art=new Uint8Array(w*h);let available=0,portrait=0;
      for(let p=0;p<w*h;p++) {
        const x=(p%w+.5)/w,y=(Math.floor(p/w)+.5)/h;
        art[p]=x>=.125&&x<=.875&&y>=.125&&y<=.594?1:0;
        values[p]=ref[p*4+3]/255*(art[p]?1:.12);available+=values[p];if(art[p])portrait+=values[p];
      }
      weights={values,art,available,portrait};weightCache.set(ref,weights);
    }
    let sum=0,weight=0,visiblePortrait=0;
    for(let p=0;p<w*h;p++) {
      if(!mask[p])continue;
      const wt=weights.values[p];weight+=wt;if(weights.art[p])visiblePortrait+=wt;
      const a=p*3,b=p*4,dr=pixels[a]-ref[b],dg=pixels[a+1]-ref[b+1],db=pixels[a+2]-ref[b+2];
      sum+=(dr*dr+dg*dg+db*db)*wt;
    }
    const coverage=weight/Math.max(.001,weights.available),artCoverage=visiblePortrait/Math.max(.001,weights.portrait);
    if(coverage<.4||artCoverage<.45)return {error:Infinity,coverage};
    return {error:sum/Math.max(.001,weight)/3/65025+.008*(1-coverage),coverage};
  }
  function faceGeometries(box) {
    const rects=[],add=(sx,sy,ax,ay)=>rects.push({x:box.x-box.width*(sx-1)*ax,y:box.y-box.height*(sy-1)*ay,width:box.width*sx,height:box.height*sy});
    add(1,1,0,0);
    for(const sy of [1.15,1.3,1.5,1.8,2.2,2.7])for(const ay of [0,.25,.5,.75,1])add(1,sy,0,ay);
    for(const sx of [1.18,1.4])for(const ax of [0,.5,1])for(const sy of [1,1.3,1.7])for(const ay of (sy===1?[0]:[0,.5,1]))add(sx,sy,ax,ay);
    return rects;
  }
  function chromaError(a,b) {
    const sa=Math.max(90,a[0]+a[1]+a[2]),sb=Math.max(90,b[0]+b[1]+b[2]);
    return a.reduce((sum,v,i)=>sum+(v/sa-b[i]/sb)**2,0);
  }
  function frameEvidence(sample,entry,record) {
    // Use known UI regions, not the artwork's dominant color. Basic/Common
    // share one visual family. Ancient frames opt out of these ordinary masks.
    if(!entry.card.color||!record.labels.length||record.labels.some(l=>l.rarity==='古老'))return {penalty:0};
    const ref=record.face.rgba,groups=record.framePositions||{color:[],rarity:[]};
    const rarity=record.labels[0].rarity,family=['普通','基础'].includes(rarity)?'普通/基础':rarity;
    const target=family==='稀有'?[240,185,55]:family==='罕见'?[100,210,210]:[160,160,160];
    if(!record.framePositions) {
      for(let y=21;y<=28;y+=2)for(const x of [2,21])groups.color.push(y*24+x);
      for(let y=2;y<=16;y++)for(let x=2;x<=21;x++) {
        if(!(y<=3&&x>=6&&x<=17)&&!([3,20].includes(x)&&y>=7&&y<=13))continue;
        const rgb=Array.from(ref.slice((y*24+x)*4,(y*24+x)*4+3));
        if(chromaError(rgb,target)<.012&&Math.max(...rgb)>90)groups.rarity.push(y*24+x);
      }
      record.framePositions=groups;
    }
    const result={penalty:0};
    for(const [key,positions] of Object.entries(groups)) {
      const errors=positions.filter(p=>sample.mask[p]&&ref[p*4+3]>220).map(p=>chromaError(Array.from(sample.pixels.slice(p*3,p*3+3)),Array.from(ref.slice(p*4,p*4+3)))).sort((a,b)=>a-b);
      if(errors.length<4)continue;
      const error=errors[Math.floor(errors.length*.6)];
      result[key]={label:key==='color'?entry.card.color:family,support:errors.length,error};
      // Bounded soft penalty: even an incorrect color estimate cannot remove
      // an identity from the unrestricted geometry/artwork candidate paths.
      result.penalty+=.004*Math.min(1,error/.055);
    }
    return result;
  }
  function matchBox(im,box,index,options={}) {
    const legacy=matchLegacyBox(im,box,index,{...options,skipRefine:true,candidateLimit:16});
    // Strong, well-separated standard faces/art keep the inexpensive path.
    if(legacy.error<.025&&legacy.confidence>.8)return {...legacy,candidates:legacy.candidates.slice(0,4),recognitionPath:'standard'};
    const entries=shapeIndex(index),standardIds=new Set(legacy.candidates.map(c=>c.id));
    const rankFaces=rects=>{
      const samples=rects.map(rect=>visibleSample(im,box,rect,8,12));
      return entries.map(entry=>{
        let best={error:Infinity};
        for(const record of entry.faces)for(let i=0;i<samples.length;i++) {
          const score=maskedFaceError(samples[i],record.coarse);
          if(score.error<best.error)best={...score,rect:rects[i]};
        }
        return {...best,entry};
      }).sort((a,b)=>a.error-b.error);
    };
    const candidates=new Map(),add=c=>{const previous=candidates.get(c.id);if(!previous||c.error<previous.error)candidates.set(c.id,c);};
    legacy.candidates.forEach((c,i)=>add({...c,error:i===0?legacy.error:(1-c.score)*.18,mode:legacy.mode,path:'standard',coverage:1}));
    let intactEvidence=false,expanded=false,faceRefinements=0;
    // A whole-frame interpretation supported by both frame regions can softly
    // disfavor extreme partial fits. Aspect ratio alone is never evidence.
    const partialPenalty=coverage=>partialFitPenalty(coverage,intactEvidence);
    const refineFace=candidate=>{
      const {entry}=candidate;if(!Number.isFinite(candidate.error))return;
      faceRefinements++;
      let best={error:Infinity};
      const evaluate=r=>{
        const sample=visibleSample(im,box,r,24,32);
        for(const record of entry.faces) {
          const score=maskedFaceError(sample,record.face.rgba);
          if(score.error+.002>=best.error)continue;
          const frame=frameEvidence(sample,entry,record);
          const error=score.error+frame.penalty+.002+partialPenalty(score.coverage);
          if(error<best.error)best={error,coverage:score.coverage,record,rect:r,frame};
        }
      };
      evaluate(candidate.rect);
      if(!best.rect)return;
      // Coordinate descent refines position AND scale after broad retrieval.
      for(const axis of ['y','x','y']) {
        const origin={...best.rect},size=axis==='x'?'width':'height';
        for(const shift of [-.045,-.0225,0,.0225,.045])for(const scale of [.95,1,1.05])evaluate({...origin,[axis]:origin[axis]+origin[size]*shift,[size]:origin[size]*scale});
      }
      const versionErrors=new Map();
      const sample=visibleSample(im,box,best.rect,24,32);
      for(const record of entry.faces) {
        const score=maskedFaceError(sample,record.face.rgba),error=score.error+frameEvidence(sample,entry,record).penalty+.002+partialPenalty(score.coverage);
        for(const v of record.face.versions||[])versionErrors.set(v,Math.min(versionErrors.get(v)??Infinity,error));
      }
      const versions=[...versionErrors].sort((a,b)=>a[1]-b[1]);
      add({id:entry.card.id,error:best.error,mode:'card',path:'visible-card',coverage:best.coverage,frame:best.frame,geometry:best.rect,
        sourceVersions:versions.filter(v=>v[1]-versions[0][1]<1e-9).map(v=>v[0]),possibleVersions:versions.filter(v=>v[1]-versions[0][1]<.003).map(v=>v[0])});
    };
    const result=()=>{
      const ranked=[...candidates.values()].sort((a,b)=>a.error-b.error).slice(0,4),first=ranked[0],second=ranked[1];
      const margin=second?(second.error-first.error)/Math.max(.01,second.error):0;
      const confidence=clamp((1-first.error/.12)*(.55+.45*clamp(margin/.45,0,1))*Math.min(1,.75+first.coverage*.3),0,1);
      const match={box,id:first.error<.10?first.id:null,error:first.error,confidence,mode:first.mode,recognitionPath:first.path,
        visibleCoverage:first.coverage,frameEvidence:first.frame,geometry:first.geometry,
        searchExpanded:expanded,faceRefinements,intactEvidence,
        sourceVersions:first.sourceVersions,possibleVersions:first.possibleVersions,
        candidates:ranked.map(c=>({id:c.id,score:clamp(1-c.error/.18,0,1),sourceVersions:c.sourceVersions,possibleVersions:c.possibleVersions}))};
      return {...match,...classifyReview(match)};
    };
    // Give ordinary screenshots small alignment corrections BEFORE pruning.
    // Keep independent standard candidates even if partial fits crowd them out.
    const alignedRanks=rankFaces(alignedGeometries(box));
    for(const candidate of selectFaceCandidates(alignedRanks,standardIds))refineFace(candidate);
    const aligned=result();
    intactEvidence=!!(aligned.error<.03&&aligned.visibleCoverage>.94&&
      aligned.frameEvidence?.color?.support>=4&&aligned.frameEvidence?.rarity?.support>=4);
    if(aligned.error<.025&&aligned.confidence>.8&&aligned.visibleCoverage>.94)return {...aligned,intactEvidence};
    const faceRanks=rankFaces(faceGeometries(box)),artSample=resizeCrop(im,box,12,9);
    const artRanks=entries.map(entry=>({entry,error:Math.min(...entry.art.map(patch=>artError(artSample,patch.coarse)+.006*(1-patch.tile.width*patch.tile.height)))})).sort((a,b)=>a.error-b.error);
    const initialFaces=selectFaceCandidates(faceRanks,standardIds),refinedIds=new Set(initialFaces.map(c=>c.entry.card.id));
    for(const candidate of initialFaces)refineFace(candidate);
    const artFull=resizeCrop(im,box,32,24);
    const refineArt=({entry})=>{
      let error=Infinity,bestPatch;
      for(const patch of entry.art) {
        const e=artError(artFull,patch.full)+.006*(1-patch.tile.width*patch.tile.height)+.004;
        if(e<error){error=e;bestPatch=patch;}
      }
      add({id:entry.card.id,error,mode:'art',path:'artwork',coverage:bestPatch.tile.width*bestPatch.tile.height,sourceVersions:entry.card.versions||[],possibleVersions:entry.card.versions||[]});
    };
    artRanks.slice(0,24).forEach(refineArt);
    if(needsExpandedSearch(result())) {
      expanded=true;
      // Include both whole-card and partial rankings; never constrain the
      // identity by neighboring cards or force duplicate IDs to be different.
      const alignedInitial=new Set(selectFaceCandidates(alignedRanks,standardIds).map(c=>c.entry.card.id));
      for(const candidate of alignedRanks.slice(0,96))if(!alignedInitial.has(candidate.entry.card.id))refineFace(candidate);
      for(const candidate of faceRanks.slice(0,96))if(!refinedIds.has(candidate.entry.card.id))refineFace(candidate);
      artRanks.slice(24,96).forEach(refineArt);
    }
    return result();
  }
  function alignedGeometries(box) {
    const rects=[];
    for(const sy of [.9,.95,1,1.05])for(const dx of [-.04,0,.04])for(const dy of [-.04,0,.04])
      rects.push({x:box.x+dx*box.width,y:box.y+dy*box.height,width:box.width,height:box.height*sy});
    return rects;
  }
  function selectFaceCandidates(ranks,standardIds) {
    return ranks.filter((c,i)=>i<24||standardIds.has(c.entry.card.id));
  }
  function needsExpandedSearch(match) {
    return !match.id||match.confidence<.65||
      (match.candidates.length>1&&match.candidates[0].score-match.candidates[1].score<.03)||
      (match.intactEvidence&&match.visibleCoverage<.65);
  }
  function partialFitPenalty(coverage,intactEvidence) {
    return intactEvidence ? .012*Math.max(0,.9-coverage) : 0;
  }
  function validateImage(image) {
    if(!Number.isInteger(image?.width)||!Number.isInteger(image?.height)||image.width<1||image.height<1||image.width*image.height>32000000||image.data?.length!==image.width*image.height*4)throw new Error('图片尺寸无效或过大，请先缩小截图。');
  }
  function checkAbort(signal) {if(signal?.aborted)throw new DOMException('识别已取消','AbortError');}
  function manualLabels(image,layout) {
    const {boundaries,left,right,baseHeight}=layout||{};
    if(!Array.isArray(boundaries)||boundaries.length<2||boundaries.length>25||
      !boundaries.every((y,i)=>Number.isFinite(y)&&y>=0&&y<=image.height&&(!i||y-boundaries[i-1]>=16))||
      !Number.isFinite(left)||!Number.isFinite(right)||left<0||right-left<16||right>=image.width||
      !Number.isFinite(baseHeight)||baseHeight<12||baseHeight>image.height)throw new Error('评级分隔线无效，请保留至少16像素的档高和有效标签栏。');
    return boundaries.slice(1).map((y1,i)=>({y0:boundaries[i],y1,x0:left,x1:right,
      color:background(image,left+3,boundaries[i]+3,right-3,y1-3)}));
  }
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
    const found=options.tierLayout?manualLabels(image,options.tierLayout):labels(image);
    if(!found.length)return {width:image.width,height:image.height,tiers:[],warnings:['未能区分评级栏。请保留完整的左侧评级栏和分隔线；同色且无清晰分隔线的截图可能需要手动分档。']};
    let heightRows=found;
    const allHeights=found.map(r=>r.y1-r.y0),typicalHeight=median(allHeights);
    heightRows=found.filter(r=>!(r.y1>=image.height-2&&r.y1-r.y0<typicalHeight*.75));
    const heights=(heightRows.length?heightRows:found).map(r=>r.y1-r.y0).sort((a,b)=>a-b),baseHeight=options.tierLayout?.baseHeight||median(heights.filter(h=>h<heights[0]*1.3));
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
    while(!options.tierLayout&&tiers.length&&tiers[0].cards.length===0){tiers.shift();ignoredEmpty++;}
    while(!options.tierLayout&&tiers.length&&tiers.at(-1).cards.length===0){tiers.pop();ignoredEmpty++;}
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
        // A flexible partial match must not turn a tiny decorative fragment
        // into a new slot. Keep the established strict test for these boxes.
        const smallNonCard=box.height<medianH*.65&&matchLegacyBox(image,box,index,{cardAspect}).error>.12;
        if(!smallDecoration&&!smallNonCard)matches.push(match);done++;
        if(done%3===0){progress({phase:'matching',progress:.15+.8*done/Math.max(1,total),message:`匹配卡牌 ${done} / ${total}`});await new Promise(resolve=>setTimeout(resolve,0));}
      }
      tier.cards=matches;
    }
    progress({phase:'done',progress:1,message:'识别完成'});
    if(tiers.some(t=>t.cards.some(c=>c.cropped)))warnings.push('截图底部有卡面被截断，已保留并标记为待确认。');
    const tierLayout=tiers.length?{boundaries:[...tiers.map(t=>t.y0),tiers.at(-1).y1],left:median(tiers.map(t=>t.labelBox.x)),right:median(tiers.map(t=>t.labelBox.x+t.labelBox.width)),baseHeight}:null;
    return {width:image.width,height:image.height,tiers,warnings,tierLayout};
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
      try {const data=new Uint8ClampedArray(imageData.data);worker.postMessage({type,image:{width:imageData.width,height:imageData.height,data},box,indexUrl,tierLayout:options.tierLayout},[data.buffer]);}
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
  const api={analyze,analyzeBox,analyzeCore,analyzeBoxCore,prepareIndex,classifyReview,releaseWorker,_test:{labels,boxesForTier,contentFrame,matchBox,visibleSample,frameEvidence,selectFaceCandidates,needsExpandedSearch,partialFitPenalty}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  global.SpireScreenshotEngine=api;
  if(typeof WorkerGlobalScope!=='undefined'&&global instanceof WorkerGlobalScope)global.onmessage=async event=>{
    if(!['analyze','analyze-box'].includes(event.data.type))return;
    try {const index=await loadIndex(event.data.indexUrl),options={tierLayout:event.data.tierLayout,onProgress:value=>global.postMessage({type:'progress',value})};const value=event.data.type==='analyze-box'?await analyzeBoxCore(event.data.image,event.data.box,index,options):await analyzeCore(event.data.image,index,options);global.postMessage({type:'result',value});}
    catch(error){global.postMessage({type:'error',message:error.message});}
  };
})(typeof self!=='undefined'?self:globalThis);
