// ════════════════════════════════════════════════════════════════
// cf.js：自訂欄位的共用函式（admin.html、member.html、staff.html 共用這一份）
//   顯示條件與區塊、多人報名的共用欄位、欄位驗證規則、複選欄位、欄位畫面、確認畫面、讀取與驗證、esc
// 一般 <script> 載入（不是 module），函式是全域的，頁面的 module 程式可以直接呼叫。
// 顯示條件的判斷（cfCondMatch、cfGroupOk、cfVisibility、cfSharedIds、cfVisibilityMulti、cfFixedFromStored）
// 以及欄位驗證規則 cfRuleError，在 functions/index.js 另有一份，兩邊必須一致：改了這裡要一起改後端，並執行 node tools/check-cf-sync.js 檢查。
// 改了這個檔案，三個頁面引用的 cf.js?v=… 版本號也要改，避免瀏覽器用到舊的快取。
// ════════════════════════════════════════════════════════════════
'use strict';

// ── HTML escape（防止使用者輸入被當作HTML/JS執行）──
function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── 自訂欄位的顯示條件與區塊（後端 functions/index.js 有同一套判斷，必須一致）──
// 欄位可設 cond：{ src, op, val }
//   src：排在上面的某個自訂欄位 id，或 '__gender'（性別）、'__age'（年齡，以活動日期計算）
//   op：in（等於其中任一項：下拉、性別）、has（有勾其中任一項：複選）、checked／unchecked（勾選框）、
//       filled／empty（有填／沒填）、between（數字介於 val.min～val.max）、age（年齡介於 val.min～val.max，留空不限）
// 區塊標題（type:'section'）：到下一個區塊標題前的欄位都屬於它；區塊隱藏時，裡面的欄位全部隱藏。
// 隱藏的欄位不顯示、不驗證、不送出（跟「適用組別」一樣）；條件來源被隱藏時，依賴它的欄位也隱藏。
// ctx：{ groupId, gender, age }；values：{ 欄位id: 目前的值 }
// 單一條件是否成立。srcVisible：來源欄位是否顯示中；v：來源欄位的值
function cfCondMatch(c, ctx, srcVisible, v){
  if(!c||!c.src) return true;
  if(c.src==='__gender') return (c.val||[]).includes(ctx.gender||'');
  if(c.src==='__age'){
    const a=ctx.age; if(a===null||a===undefined||isNaN(a)) return false;
    const mn=c.val&&c.val.min, mx=c.val&&c.val.max;
    return (!(mn>0)||a>=mn)&&(!(mx>0)||a<=mx);
  }
  if(!srcVisible) return false; // 來源被隱藏、排在下面或已刪除
  switch(c.op){
    case 'in': return typeof v==='string'&&(c.val||[]).includes(v);
    case 'has': return Array.isArray(v)&&v.some(x=>(c.val||[]).includes(x));
    case 'checked': return v===true;
    case 'unchecked': return v!==true;
    case 'filled': return Array.isArray(v)?v.length>0:(typeof v==='string'?!!v.trim():(typeof v==='number'?isFinite(v):!!v));
    case 'empty': return !(Array.isArray(v)?v.length>0:(typeof v==='string'?!!v.trim():(typeof v==='number'?isFinite(v):!!v)));
    case 'between': { // 數字欄位：介於 val.min～val.max（留空不限，包含兩端）
      if(typeof v!=='number'||!isFinite(v)) return false;
      const mn=c.val&&c.val.min, mx=c.val&&c.val.max;
      return (typeof mn!=='number'||v>=mn)&&(typeof mx!=='number'||v<=mx);
    }
    default: return true;
  }
}

function cfGroupOk(f, ctx){ return !f.groups||!f.groups.length||f.groups.includes(ctx.groupId||''); }

// fixed：直接指定某些欄位顯示與否（多人報名的個人修改：共用欄位的顯示狀態以整批為準）
function cfVisibility(fields, values, ctx, fixed){
  const vis={}; let sec=true;
  for(const f of fields){
    if(fixed&&Object.prototype.hasOwnProperty.call(fixed,f.id)){ vis[f.id]=!!fixed[f.id]; if(f.type==='section') sec=vis[f.id]; continue; }
    const ok=cfGroupOk(f,ctx)&&cfCondMatch(f.cond,ctx,f.cond&&vis[f.cond.src],f.cond&&values[f.cond.src]);
    if(f.type==='section'){ sec=ok; vis[f.id]=sec; continue; }
    vis[f.id]=sec&&ok;
  }
  return vis;
}

// ── 多人報名 ──
// 區塊標題可設 scope:'shared'（共同填寫一次）：從它到下一個區塊標題之間都是共用欄位；
// 第一個區塊標題之前，或區塊沒設 shared＝每人各填。
function cfSharedIds(fields){
  const s=new Set(); let sh=false;
  for(const f of fields||[]){ if(f.type==='section') sh=f.scope==='shared'; if(sh) s.add(f.id); }
  return s;
}

// persons：[{ values, ctx }]（每人的欄位值與性別／年齡／組別）；shared：共用欄位的值
// 共用欄位：任一人符合就顯示；每人欄位：依各自資料判斷，條件來源是共用欄位時用共用的值。
// 回傳 { shared:{id:bool}, persons:[{id:bool}] }
function cfVisibilityMulti(fields, shared, persons){
  const sids=cfSharedIds(fields); const visS={}; let secS=true;
  const P=persons.map(()=>({vis:{}, sec:true}));
  const ok=(f,i)=>{
    const p=persons[i], c=f.cond, src=c&&c.src, isS=src&&sids.has(src);
    return cfGroupOk(f,p.ctx)&&cfCondMatch(c,p.ctx,src&&(isS?visS[src]:P[i].vis[src]),src&&(isS?shared[src]:p.values[src]));
  };
  for(const f of fields||[]){
    if(sids.has(f.id)){
      const any=persons.some((p,i)=>ok(f,i));
      if(f.type==='section'){ secS=any; visS[f.id]=any; } else visS[f.id]=secS&&any;
    } else {
      persons.forEach((p,i)=>{ const r=ok(f,i); if(f.type==='section'){ P[i].sec=r; P[i].vis[f.id]=r; } else P[i].vis[f.id]=P[i].sec&&r; });
    }
  }
  return {shared:visS, persons:P.map(x=>x.vis)};
}

// 多人報名的個人修改：共用欄位的顯示狀態以「整批存下來的資料」為準（有存值＝顯示中）
function cfFixedFromStored(fields, stored){
  const sids=cfSharedIds(fields), fixed={}; let secId=null;
  for(const f of fields||[]){
    if(!sids.has(f.id)){ secId=null; continue; }
    if(f.type==='section'){ secId=f.id; fixed[f.id]=false; continue; }
    fixed[f.id]=Object.prototype.hasOwnProperty.call(stored||{},f.id);
    if(fixed[f.id]&&secId) fixed[secId]=true;
  }
  return fixed;
}

// 表單、列表、匯出用的「有資料的欄位」（排除區塊標題）
function cfDataFields(fields){ return (fields||[]).filter(f=>f.type!=='section'); }

// 讀出表單上某個自訂欄位目前的值（判斷顯示條件、送出用）
// 數字：沒填＝''，有填＝number；日期存 YYYY/MM/DD（日期框給的是 YYYY-MM-DD）；時間 HH:MM
function cfReadRaw(id, f){
  const el=document.getElementById(id); if(!el) return undefined;
  if(f.type==='multi'){
    const vals=[...el.querySelectorAll('input[type=checkbox]:not([data-other]):checked')].map(x=>x.value);
    const oc=el.querySelector('input[data-other]');
    if(oc&&oc.checked){ const t=(document.getElementById(id+'_other')?.value||'').trim(); if(t) vals.push(t); }
    return vals;
  }
  if(f.type==='checkbox') return el.checked;
  let v=(el.value||'').trim();
  if(f.type==='number') return v===''?'':Number(v);
  if(f.type==='date') return v.replace(/-/g,'/');
  if(f.type==='select'&&f.allowOther&&v==='__other__') v=(document.getElementById(id+'_other')?.value||'').trim();
  return v;
}

// 依目前填寫內容切換欄位的顯示；回傳 vis（欄位id → 是否顯示）
function cfApplyVisibility(fields, idPrefix, rowPrefix, ctx, fixed){
  const values={};
  (fields||[]).forEach(f=>{ if(f.type!=='section') values[f.id]=cfReadRaw(idPrefix+f.id,f); });
  const vis=cfVisibility(fields||[], values, ctx, fixed);
  (fields||[]).forEach(f=>{ const row=document.getElementById(rowPrefix+f.id); if(row) row.style.display=vis[f.id]?'':'none'; });
  return vis;
}

// 表單上的年齡（以活動日期計算；生日沒填或格式不對＝null）
function cfAgeFrom(birthday, evDate){
  if(!birthday||!/^\d{4}\/\d{2}\/\d{2}$/.test(birthday)) return null;
  const [by,bm,bd]=birthday.split('/').map(Number);
  const base=evDate?new Date(String(evDate).replace(/\//g,'-')+'T00:00:00'):new Date();
  if(isNaN(base)) return null;
  let age=base.getFullYear()-by;
  if(base.getMonth()+1<bm||(base.getMonth()+1===bm&&base.getDate()<bd)) age--;
  return age>=0?age:null;
}

function cfSectionHtml(f){
  return '<div class="cf-section" style="margin:18px 0 12px;padding-top:12px;border-top:1px solid var(--border)">'
    +'<div style="font-weight:800;font-size:.95rem">'+esc(f.label)+'</div>'
    +(f.description?'<div style="font-size:.78rem;color:var(--muted);margin-top:2px">'+esc(f.description)+'</div>':'')+'</div>';
}

// ── 複選欄位（自訂欄位 type:'multi'）──
// 值存成字串陣列；勾「其他」時把輸入的文字也放進陣列。
// 必填＝至少選一項；最少（minSel）、最多（maxSel）留空＝不限。選填時可以都不選，有選就要符合最少／最多。
function multiRangeText(f){
  const mn=f.minSel||0, mx=f.maxSel||0;
  if(mn&&mx) return mn===mx?'請選 '+mn+' 項':'請選 '+mn+'～'+mx+' 項';
  if(mn) return '至少選 '+mn+' 項';
  if(mx) return '最多選 '+mx+' 項';
  return '可複選';
}

function multiFieldHtml(id, f, cur, reqMark, descHtml){
  cur=Array.isArray(cur)?cur:(cur?[String(cur)]:[]);
  const opts=f.options||[];
  const others=cur.filter(v=>!opts.includes(v));
  let h='<div class="input-group"><label>'+esc(f.label)+reqMark+' <span style="font-weight:400;color:var(--muted);font-size:.75rem">（'+multiRangeText(f)+'）</span></label>'
    +'<div id="'+id+'" class="cf-multi" style="display:flex;flex-wrap:wrap;gap:6px 16px;padding:4px 0">';
  opts.forEach(o=>{ h+='<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:.88rem"><input type="checkbox" value="'+esc(o)+'"'+(cur.includes(o)?' checked':'')+'> '+esc(o)+'</label>'; });
  if(f.allowOther) h+='<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:.88rem"><input type="checkbox" data-other="1"'+(others.length?' checked':'')
    +' onchange="document.getElementById(\''+id+'_other\').style.display=this.checked?\'block\':\'none\'"> 其他（請輸入）</label>';
  h+='</div>';
  if(f.allowOther) h+='<input type="text" id="'+id+'_other" class="input" style="margin-top:6px;display:'+(others.length?'block':'none')+'" placeholder="請輸入..." value="'+esc(others.join('、'))+'">';
  return h+descHtml+'</div>';
}

function multiCheck(f, vals){
  const n=vals.length;
  if(f.required&&!n) return '「'+f.label+'」為必填，請至少選一項';
  if(n){
    if(f.minSel&&n<f.minSel) return '「'+f.label+'」至少要選 '+f.minSel+' 項';
    if(f.maxSel&&n>f.maxSel) return '「'+f.label+'」最多只能選 '+f.maxSel+' 項';
  }
  return '';
}

// 讀出複選欄位的值：回傳 {value:[...]} 或 {error:'訊息'}
function readMultiField(id, f){
  const box=document.getElementById(id); if(!box) return {value:[]};
  const vals=[...box.querySelectorAll('input[type=checkbox]:not([data-other]):checked')].map(el=>el.value);
  const oc=box.querySelector('input[data-other]');
  if(oc&&oc.checked){
    const t=(document.getElementById(id+'_other')?.value||'').trim();
    if(!t) return {error:'「'+f.label+'」勾選了「其他」，請輸入內容'};
    vals.push(t);
  }
  const err=multiCheck(f, vals);
  return err?{error:err}:{value:vals};
}

// 自訂欄位的顯示文字（列表、匯出用）
function cfDisplayValue(f, v){
  if(f.type==='checkbox') return v?'是':'否';
  if(Array.isArray(v)) return v.join('、');
  return v===undefined||v===null?'':String(v);
}

// 自訂欄位顯示成確認畫面的列
function cfConfirmRows(fields, data){
  const rows=[];
  (fields||[]).forEach(f=>{
    if(f.type==='section'||!(f.id in (data||{}))) return;
    let v=data[f.id];
    if(Array.isArray(v)) v=v.join('、'); else if(v===true) v='是'; else if(v===false) v='否';
    rows.push([f.label,v]);
  });
  return rows;
}

// ── 欄位驗證規則（f.rules，留空＝不限）──
//   number：min、max、integer（只能整數）
//   text／textarea：minLen、maxLen；text 另有 format：phone、email、idno、digits、alnum
//   date：minDate、maxDate（YYYY/MM/DD）；或 birthday:true＋ageMin、ageMax（以 ctx.onDate 計算年齡）
//   time：minTime、maxTime（HH:MM）
//   message：不符合規則時顯示的訊息（不設＝預設訊息）
// v 是有填的值（沒填由呼叫端處理必填）；回傳錯誤訊息，符合＝''。
// 後端 functions/index.js 有同一份，必須一致（node tools/check-cf-sync.js）
function cfRuleError(f, v, ctx){
  const r=f.rules||{}, L='「'+(f.label||'欄位')+'」';
  const num=x=>typeof x==='number'&&isFinite(x);
  const bad=d=>r.message||(L+d);
  const range=(lo,hi,unit)=>num(lo)&&num(hi)?'需介於 '+lo+'～'+hi+unit:num(lo)?'不能小於 '+lo+unit:'不能大於 '+hi+unit;
  if(f.type==='number'){
    if(!num(v)) return L+'請填數字';
    if(r.integer&&!Number.isInteger(v)) return bad('請填整數');
    if((num(r.min)&&v<r.min)||(num(r.max)&&v>r.max)) return bad(range(r.min,r.max,''));
    return '';
  }
  if(typeof v!=='string') return L+'格式錯誤';
  if(f.type==='text'||f.type==='textarea'||!f.type){
    const n=[...v].length, cap=f.type==='textarea'?2000:500;
    if(n>cap) return L+'最多 '+cap+' 字';
    if((num(r.minLen)&&n<r.minLen)||(num(r.maxLen)&&n>r.maxLen)) return bad(num(r.minLen)&&num(r.maxLen)?'需要 '+r.minLen+'～'+r.maxLen+' 字':num(r.minLen)?'至少要 '+r.minLen+' 字':'最多 '+r.maxLen+' 字');
    if(f.type!=='textarea'&&r.format){
      const re={phone:/^09\d{8}$/,email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/,idno:/^[A-Za-z]\d{9}$/,digits:/^\d+$/,alnum:/^[A-Za-z0-9]+$/}[r.format];
      const nm={phone:'手機號碼（09 開頭共 10 碼）',email:'Email',idno:'身分證字號',digits:'數字',alnum:'英文或數字'}[r.format];
      if(re&&!re.test(v)) return bad('格式不正確，請填'+nm);
    }
    return '';
  }
  if(f.type==='date'){
    const m=/^(\d{4})\/(\d{2})\/(\d{2})$/.exec(v);
    if(!m||+m[2]<1||+m[2]>12||+m[3]<1||+m[3]>new Date(Date.UTC(+m[1],+m[2],0)).getUTCDate()) return L+'日期格式不正確';
    if(r.birthday){
      const o=/^(\d{4})[\/-](\d{2})[\/-](\d{2})$/.exec(String((ctx&&ctx.onDate)||''));
      if(!o) return '';
      let age=+o[1]-+m[1]; if(+o[2]<+m[2]||(+o[2]===+m[2]&&+o[3]<+m[3])) age--;
      if((num(r.ageMin)&&age<r.ageMin)||(num(r.ageMax)&&age>r.ageMax)) return bad('年齡'+range(r.ageMin,r.ageMax,' 歲'));
      return '';
    }
    if((r.minDate&&v<r.minDate)||(r.maxDate&&v>r.maxDate)) return bad(r.minDate&&r.maxDate?'需介於 '+r.minDate+'～'+r.maxDate:r.minDate?'不能早於 '+r.minDate:'不能晚於 '+r.maxDate);
    return '';
  }
  if(f.type==='time'){
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return L+'時間格式不正確';
    if((r.minTime&&v<r.minTime)||(r.maxTime&&v>r.maxTime)) return bad(r.minTime&&r.maxTime?'需介於 '+r.minTime+'～'+r.maxTime:r.minTime?'不能早於 '+r.minTime:'不能晚於 '+r.maxTime);
    return '';
  }
  return '';
}

// 規則的簡短說明（顯示在欄位名稱旁）；沒有規則＝''
function cfRuleHint(f){
  const r=f.rules||{}, num=x=>typeof x==='number'&&isFinite(x);
  const rg=(lo,hi,u)=>num(lo)&&num(hi)?lo+'～'+hi+u:num(lo)?lo+(u||' ')+'以上':num(hi)?hi+(u||' ')+'以下':'';
  if(f.type==='number') return [rg(r.min,r.max,''),r.integer?'整數':''].filter(Boolean).join('，');
  if(f.type==='text'||f.type==='textarea') return [rg(r.minLen,r.maxLen,' 字'),{phone:'手機',email:'Email',idno:'身分證字號',digits:'數字',alnum:'英文或數字'}[r.format]||''].filter(Boolean).join('，');
  if(f.type==='date') return r.birthday?(rg(r.ageMin,r.ageMax,' 歲')?'年齡 '+rg(r.ageMin,r.ageMax,' 歲'):''):(r.minDate&&r.maxDate?r.minDate+'～'+r.maxDate:r.minDate?r.minDate+' 以後':r.maxDate?r.maxDate+' 以前':'');
  if(f.type==='time') return r.minTime&&r.maxTime?r.minTime+'～'+r.maxTime:r.minTime?r.minTime+' 以後':r.maxTime?r.maxTime+' 以前':'';
  return '';
}

// 今天（本機時間）YYYY/MM/DD：沒有活動日期時，生日規則以今天計算年齡
function cfToday(){
  const d=new Date(); return d.getFullYear()+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0');
}

// 單一自訂欄位的輸入框（區塊標題以外）：文字、長文字、數字、日期、時間、下拉、複選、勾選框
function cfFieldHtml(f, id, val){
  const reqMark=f.required?' <span class="required-star">*</span>':'';
  const descHtml=f.description?'<div style="font-size:.75rem;color:var(--text);margin-top:2px">'+esc(f.description)+'</div>':'';
  if(f.type==='multi') return multiFieldHtml(id, f, val, reqMark, descHtml);
  if(f.type==='checkbox') return '<div class="input-group"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="'+id+'"'+(val?' checked':'')+'> '+esc(f.label)+reqMark+'</label>'+descHtml+'</div>';
  if(f.type==='select'){
    const v=typeof val==='string'?val:'';
    const isOther=f.allowOther&&v!==''&&!(f.options||[]).includes(v);
    return '<div class="input-group"><label>'+esc(f.label)+reqMark+'</label><select id="'+id+'" class="input"'
      +(f.allowOther?' onchange="document.getElementById(\''+id+'_other\').style.display=this.value===\'__other__\'?\'block\':\'none\'"':'')+'>'
      +'<option value="">請選擇...</option>'
      +(f.options||[]).map(o=>'<option value="'+esc(o)+'"'+(o===v?' selected':'')+'>'+esc(o)+'</option>').join('')
      +(f.allowOther?'<option value="__other__"'+(isOther?' selected':'')+'>其他（請輸入）</option>':'')
      +'</select>'
      +(f.allowOther?'<input type="text" id="'+id+'_other" class="input" style="margin-top:6px;display:'+(isOther?'block':'none')+'" placeholder="請輸入..." value="'+esc(isOther?v:'')+'">':'')
      +descHtml+'</div>';
  }
  const r=f.rules||{}, hint=cfRuleHint(f), num=x=>typeof x==='number'&&isFinite(x);
  const label='<label>'+esc(f.label)+reqMark+(hint?' <span style="font-weight:400;color:var(--muted);font-size:.75rem">（'+esc(hint)+'）</span>':'')+'</label>';
  const sv=val===undefined||val===null?'':String(val);
  let input;
  if(f.type==='textarea'){
    input='<textarea id="'+id+'" class="input" rows="3" maxlength="'+(num(r.maxLen)?r.maxLen:2000)+'">'+esc(sv)+'</textarea>';
  } else if(f.type==='number'){
    input='<input id="'+id+'" type="number" class="input" inputmode="'+(r.integer?'numeric':'decimal')+'" step="'+(r.integer?'1':'any')+'"'
      +(num(r.min)?' min="'+r.min+'"':'')+(num(r.max)?' max="'+r.max+'"':'')+' value="'+esc(typeof val==='number'?String(val):'')+'">';
  } else if(f.type==='date'){
    const iso=x=>String(x||'').replace(/\//g,'-');
    input='<input id="'+id+'" type="date" class="input"'+(!r.birthday&&r.minDate?' min="'+iso(r.minDate)+'"':'')+(!r.birthday&&r.maxDate?' max="'+iso(r.maxDate)+'"':'')+' value="'+esc(iso(sv))+'">';
  } else if(f.type==='time'){
    input='<input id="'+id+'" type="time" class="input"'+(r.minTime?' min="'+r.minTime+'"':'')+(r.maxTime?' max="'+r.maxTime+'"':'')+' value="'+esc(sv)+'">';
  } else {
    const im={phone:'tel',email:'email',digits:'numeric'}[r.format];
    input='<input id="'+id+'" type="text" class="input"'+(im?' inputmode="'+im+'"':'')+' maxlength="'+(num(r.maxLen)?r.maxLen:500)+'" value="'+esc(sv)+'">';
  }
  return '<div class="input-group">'+label+input+descHtml+'</div>';
}
// 舊名稱（多人報名用），等同 cfFieldHtml
function mfCfHtml(f, id, val){ return cfFieldHtml(f, id, val); }

function mfFieldsHtml(fields, idPrefix, rowPrefix, values){
  return fields.map(f=>'<div id="'+rowPrefix+f.id+'">'+(f.type==='section'?cfSectionHtml(f):cfFieldHtml(f,idPrefix+f.id,(values||{})[f.id]))+'</div>').join('');
}

// 讀取並驗證單一欄位：回傳 {value}、{error} 或 {skip}（表單上沒有這個欄位）
// ctx：{ onDate }（生日規則計算年齡的日期，通常是活動日期；沒給＝今天）
function cfReadField(id, f, ctx){
  const el=document.getElementById(id); if(!el) return {skip:true};
  if(f.type==='multi') return readMultiField(id, f);
  if(f.type==='checkbox'){ if(f.required&&!el.checked) return {error:'「'+f.label+'」為必填，請勾選'}; return {value:el.checked}; }
  const v=cfReadRaw(id, f);
  if(v===''||v===undefined){ if(f.required) return {error:'「'+f.label+'」為必填'}; return {value:''}; }
  if(f.type==='number'&&!isFinite(v)) return {error:'「'+f.label+'」請填數字'};
  const err=cfRuleError(f, v, {onDate:(ctx&&ctx.onDate)||cfToday()});
  return err?{error:err}:{value:v};
}

// 讀取並驗證自訂欄位（只處理顯示中的欄位）；回傳 {data} 或 {error}
function cfCollect(fields, idPrefix, vis, ctx){
  const data={};
  for(const f of fields||[]){
    if(f.type==='section'||!vis[f.id]) continue;
    const r=cfReadField(idPrefix+f.id, f, ctx);
    if(r.skip) continue;
    if(r.error) return {error:r.error};
    data[f.id]=r.value;
  }
  return {data};
}
// 舊名稱（多人報名用），等同 cfCollect
function mfCollectCf(fields, idPrefix, vis, ctx){ return cfCollect(fields, idPrefix, vis, ctx); }
