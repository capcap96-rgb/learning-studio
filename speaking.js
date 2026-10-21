/* Course checklist adaptation. Contains practice labels, not course media or poem texts. */
(function(root){
  'use strict';
  const poems=[
    ['Step and Play · /ɛ/、/eɪ/','Set the Task · /ɛ/、/æ/','Make a Plan · /eɪ/、/æ/'],
    ['Sing and Feel the Beat · /i/、/ɪ/','Prep and Mix · /ɛ/、/ɪ/'],
    ['Caught a Boat · /ɔ/、/oʊ/','Cruise and Book · /u/、/ʊ/'],
    ['Far Away · linking /r/','We Achieve · linking /j/','So Amazing a Way · linking /w/'],
    ['A Family’s Path · /p/ /t/ /k/ /b/ /d/ /g/','Cooking with Care · /m/ /n/ /ŋ/ /l/'],
    ['Better Path · /ɾ/']
  ];
  const codes=Array.from({length:24},(_,i)=>`${Math.floor(i/6)+1}-${i%6+1}`).concat(['5-1','5-2','5-3','5-4','6-1','6-2']);
  const chapters=['口耳連結與發音','生活情境對話','興趣與共鳴表達','觀點與深度對話','句型轉換','邏輯框架與延伸應用'];
  const tips=['先聽再跟說，依自己的節奏練習；課程要求錄音時留下紀錄。','先聽，等課程顯示文字後再看對話；可以多次角色對練。','想像對話情境，模仿語氣與表達方式。','開口重複練習，留意說話的自信與流暢度。','比較改寫前後的表達效果，重複口說轉換句。','以框架練習即席表達，之後也可重新挑戰。'];
  const lessons=codes.map((video,i)=>{
    const chapter=Number(video[0]),number=i+1;
    const items=[];
    if(i>0)items.push({id:'listening',label:`零碎時間聆聽 ${codes[i-1]}${i>1?'、'+codes[i-2]:''}，嘴巴可跟著動`,hint:'原清單建議以先前影片作背景音訊。'});
    items.push({id:'video',label:`完成課程影片 ${video}`,hint:'耳朵聽、嘴巴說；依課程方式練習。'});
    if(i<6)items.push({id:'poems',label:`詩組跟練（${poems[i].length} 首，至少 1 遍）`,details:poems[i],count:'詩組遍數',hint:'原清單建議睡前進行；可依作息安排。'});
    else if(i<24){
      const turns=[0,0,2,3,4][chapter]*(i%2?2:1);
      items.push({id:'phrases',label:'高能句跟練，至少 1 遍',count:'高能句遍數'});
      items.push({id:'dialog',label:`${turns}-Turn Dialog 對練，至少 1 遍`,count:'對話遍數'});
    }else{
      items.push({id:'phrases',label:chapter===5?'轉換句跟練，至少 1 遍':'邏輯框架句跟練，至少 1 遍',count:'句型遍數'});
      items.push({id:'homework',label:'完成指定口說作業',hint:'以口說完成，依課程指示練習。'});
    }
    return {id:number,video,chapter,title:number<=24?`第 ${number} 天`:`延伸練習 ${number-24}`,stage:chapters[chapter-1],tip:tips[chapter-1],items};
  });
  const empty=()=>({version:1,courses:[],logs:[]});
  const state=db=>db.speaking||empty();
  const lesson=id=>lessons.find(x=>x.id===Number(id));
  const validDate=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s};
  const validStamp=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
  const safeURL=s=>{if(!s)return true;try{return ['http:','https:'].includes(new URL(s).protocol)}catch{return false}};
  function validate(s,db){
    if(!s||s.version!==1||!Array.isArray(s.courses)||!Array.isArray(s.logs))throw Error('口說紀錄版本不相容');
    const ids=new Set(),planIds=new Set(db.plans.map(x=>x.id));
    for(const c of s.courses){
      if(!c||typeof c.id!=='string'||!c.id||ids.has(c.id)||typeof c.plan!=='string'||!planIds.has(c.plan)||typeof c.title!=='string'||!c.title.trim()||!validStamp(c.createdAt))throw Error('口說課程格式不符');
      ids.add(c.id);
    }
    const logIds=new Set();
    for(const l of s.logs){
      const def=lesson(l?.lesson),allowed=def?.items.map(x=>x.id)||[];
      if(!l||typeof l.id!=='string'||!l.id||logIds.has(l.id)||!ids.has(l.course)||!Number.isInteger(l.lesson)||!def||!validDate(l.date)||typeof l.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(l.time)||!Number.isFinite(l.minutes)||l.minutes<=0||l.minutes>1440||typeof l.note!=='string'||typeof l.recordingUrl!=='string'||!safeURL(l.recordingUrl)||!validStamp(l.createdAt)||!validStamp(l.updatedAt)||typeof l.deletedAt!=='string'||(l.deletedAt&&!validStamp(l.deletedAt))||!Array.isArray(l.checks)||new Set(l.checks).size!==l.checks.length||l.checks.some(k=>!allowed.includes(k))||!l.counts||typeof l.counts!=='object'||Array.isArray(l.counts))throw Error('口說打卡格式不符');
      for(const [k,v] of Object.entries(l.counts))if(!def.items.some(x=>x.id===k&&x.count)||!Number.isInteger(v)||v<0||v>9999)throw Error('口說遍數格式不符');
      for(const item of def.items)if(item.count&&l.checks.includes(item.id)&&!(l.counts[item.id]>=1))throw Error('已完成的口說項目需要至少一遍');
      logIds.add(l.id);
    }
    return s;
  }
  const logsFor=(db,course)=>state(db).logs.filter(l=>l.course===course&&!l.deletedAt);
  function completion(db,course,lessonId){
    const checks=new Set(logsFor(db,course).filter(l=>l.lesson===lessonId).flatMap(l=>l.checks));
    const def=lesson(lessonId),done=def.items.filter(i=>checks.has(i.id)).length;
    return {checks,done,total:def.items.length,complete:done===def.items.length};
  }
  function progress(db,course){
    const logs=logsFor(db,course),complete=lessons.filter(l=>completion(db,course,l.id).complete);
    return {main:complete.filter(l=>l.id<=24).length,extra:complete.filter(l=>l.id>24).length,count:logs.length,minutes:Math.round(logs.reduce((n,l)=>n+l.minutes,0)*10)/10,days:new Set(logs.map(l=>l.date)).size,next:lessons.find(l=>!completion(db,course,l.id).complete)?.id||1};
  }
  function recent(db,plan,start,end){
    const courses=new Set(state(db).courses.filter(c=>c.plan===plan).map(c=>c.id));
    const logs=state(db).logs.filter(l=>!l.deletedAt&&courses.has(l.course)&&l.date>=start&&l.date<=end);
    return {count:logs.length,minutes:Math.round(logs.reduce((n,l)=>n+l.minutes,0)*10)/10,days:new Set(logs.map(l=>l.date)).size};
  }
  const exports={lessons,lesson,empty,state,validate,completion,progress,recent,logsFor,safeURL,validDate};
  if(typeof module!=='undefined'&&module.exports)module.exports=exports;else root.Speaking=exports;
})(typeof window==='undefined'?globalThis:window);

if(typeof window!=='undefined')window.createSpeakingUI=function(bridge){
  'use strict';
  const C=window.Speaking,E=bridge.escape,$=s=>document.querySelector(s);
  let courseId='',lessonId=1,view='log',editId='',filterDate='',filterLesson='',showDeleted=false;
  const uid=()=>crypto.randomUUID(),stamp=()=>new Date().toISOString();
  const nowTime=()=>new Date().toTimeString().slice(0,5);
  function selected(db){
    const all=C.state(db).courses;
    let c=all.find(c=>c.id===courseId&&c.plan===db.active)||all.filter(c=>c.plan===db.active).at(-1);
    if(!c)c=all.at(-1);
    if(c&&courseId!==c.id){courseId=c.id;lessonId=C.progress(db,c.id).next;editId=''}
    return c;
  }
  function formField(name,label,value='',type='text',extra=''){
    return `<label class="field"><span>${label}</span>${type==='textarea'?`<textarea name="${name}" ${extra}>${E(value)}</textarea>`:`<input type="${type}" name="${name}" value="${E(value)}" ${extra}>`}</label>`;
  }
  const lessonOptions=chosen=>`<optgroup label="主課程：24 天">${C.lessons.slice(0,24).map(l=>`<option value="${l.id}" ${l.id===chosen?'selected':''}>${l.title} · 影片 ${l.video}</option>`).join('')}</optgroup><optgroup label="延伸：6 次練習">${C.lessons.slice(24).map(l=>`<option value="${l.id}" ${l.id===chosen?'selected':''}>${l.title} · 影片 ${l.video}</option>`).join('')}</optgroup>`;
  function courseForm(db){return `<form id="speaking-course-form"><div class="form-grid">${formField('title','這一輪的課程名稱','24 天英語口說練習','text','required maxlength="100"')}<label class="field"><span>歸屬的學習計畫</span><select name="plan"><option value="new">建立新的口說學習計畫</option>${db.plans.map(p=>`<option value="${E(p.id)}" ${p.id===db.active?'selected':''}>${E(p.title)}</option>`).join('')}</select></label></div><p class="caption">可以分幾天完成一課，也能重練。同一輪累積進度；想從頭挑戰時，另建一輪，原紀錄會保留。</p><button class="primary">建立這一輪課程 ＋</button></form>`}
  function page(){
    const db=bridge.get(),c=selected(db);
    const heading=bridge.heading('SPEAK A LITTLE, EVERY DAY','口說訓練打卡','照自己的步調，讓每一次開口都有跡可循。');
    if(!c)return heading+`<section class="panel"><span class="badge">24 天主課程 ＋ 6 次延伸</span><h2 style="margin-top:16px">開始你的第一輪口說練習</h2><p class="caption">清單整理自你提供的每日打卡單。課程影片仍在原課程平台觀看，此處記錄完成事項、遍數與心得。</p>${courseForm(db)}</section>`;
    const p=C.progress(db,c.id);
    return heading+`<label class="field"><span>目前口說課程</span><select id="speaking-course">${C.state(db).courses.map(x=>`<option value="${E(x.id)}" ${x.id===c.id?'selected':''}>${E(x.title)} · ${E(db.plans.find(p=>p.id===x.plan)?.title||'')}</option>`).join('')}</select></label><div class="stats speaking-stats"><div class="stat"><span>主課程累積完成</span><strong>${p.main}<small>/ 24 天</small></strong></div><div class="stat"><span>延伸練習完成</span><strong>${p.extra}<small>/ 6 次</small></strong></div><div class="stat"><span>實際訓練累積</span><strong>${p.count}<small>次 · ${p.minutes} 分鐘</small></strong></div></div><div class="tabs" role="group" aria-label="口說打卡檢視">${[['log','本次打卡'],['history','訓練歷史'],['overview','課程總覽']].map(([v,t])=>`<button data-speaking-tab="${v}" aria-pressed="${view===v}" class="${view===v?'active':''}">${t}</button>`).join('')}</div>${view==='log'?logForm(db,c):view==='history'?history(db,c):overview(db,c)}<details class="panel" style="margin-top:22px"><summary>新增課程／重新挑戰</summary><div style="margin-top:20px">${courseForm(db)}</div></details>`;
  }
  function logForm(db,c){
    const editing=C.state(db).logs.find(l=>l.id===editId&&!l.deletedAt&&l.course===c.id);
    if(editing)lessonId=editing.lesson;
    const l=C.lesson(lessonId),p=C.completion(db,c.id,l.id);
    return `<section class="panel"><div class="row"><h2>${editing?'編輯訓練紀錄':'記錄這一次訓練'}</h2><span class="badge">CH${l.chapter} · ${E(l.stage)}</span></div><p class="caption">每次打卡獨立保存。下方勾選代表「這一次」完成事項，不會自動帶入上次勾選。</p><label class="field"><span>這次練習的課程</span><select id="speaking-lesson" ${editing?'disabled':''}>${lessonOptions(l.id)}</select></label><div class="hint">${E(l.tip)}<br>本課累積完成 ${p.done} / ${p.total} 項。完成狀態由本輪所有未刪除的紀錄加總勾選。</div><form id="speaking-log-form"><input type="hidden" name="editId" value="${E(editing?.id||'')}"><div class="form-grid">${formField('date','實際練習日期',editing?.date||bridge.today(),'date',`required max="${bridge.today()}"`)}${formField('time','開始練習時間',editing?.time||nowTime(),'time','required')}${formField('minutes','本次練習分鐘數',editing?.minutes||'','number','required min="0.1" max="1440" step="0.1"')}</div><fieldset class="speaking-checklist"><legend>本次完成事項</legend>${l.items.map(item=>`<div class="speaking-item"><label class="speaking-check"><input type="checkbox" name="checks" value="${item.id}" ${editing?.checks.includes(item.id)?'checked':''}><span>${E(item.label)}${p.checks.has(item.id)?'<small class="caption">本輪已有完成紀錄</small>':''}</span></label>${item.hint?`<p class="caption">${E(item.hint)}</p>`:''}${item.details?`<ul class="caption">${item.details.map(d=>`<li>${E(d)}</li>`).join('')}</ul>`:''}${item.count?formField('count_'+item.id,item.count,editing?.counts[item.id]??0,'number','min="0" max="9999" step="1"'):''}</div>`).join('')}</fieldset><p class="caption">可以只記錄部分練習，未勾選項目不會算完成。遍數代表這一次的實際練習；勾選跟練項目時至少填 1 遍。</p>${formField('note','心得／卡住的地方（選填）',editing?.note||'','textarea','maxlength="10000"')}${formField('recordingUrl','自己的錄音連結（選填）',editing?.recordingUrl||'','url','placeholder="https://…" maxlength="2000"')}<p class="caption">只保存你貼上的連結，不會上傳錄音，也不會自動變更錄音檔的分享權限。</p><div class="toolbar"><button class="primary">${editing?'儲存紀錄修改':'儲存本次訓練 ✓'}</button>${editing?'<button type="button" id="speaking-cancel-edit">取消編輯</button>':''}</div></form></section>`;
  }
  function history(db,c){
    const all=C.state(db).logs.filter(l=>l.course===c.id&&(!l.deletedAt||showDeleted)&&(!filterDate||l.date===filterDate)&&(!filterLesson||l.lesson===Number(filterLesson))).sort((a,b)=>(b.date+'T'+b.time).localeCompare(a.date+'T'+a.time)||b.createdAt.localeCompare(a.createdAt));
    return `<section class="panel"><h2>每一次開口的紀錄</h2><div class="form-grid" style="margin-top:20px"><label class="field"><span>篩選日期</span><input id="speaking-filter-date" type="date" value="${E(filterDate)}"></label><label class="field"><span>篩選課程</span><select id="speaking-filter-lesson"><option value="">所有課程</option>${lessonOptions(Number(filterLesson))}</select></label></div><div class="toolbar"><button id="speaking-clear-filter">清除篩選</button><label class="sync-auto"><input id="speaking-show-deleted" type="checkbox" ${showDeleted?'checked':''}>顯示已刪除紀錄</label></div><p class="caption">共 ${all.length} 筆。補登請切到「本次打卡」並選擇實際日期；編輯或刪除後會重新計算進度。</p>${all.map(l=>{const def=C.lesson(l.lesson);return `<article class="record ${l.deletedAt?'speaking-deleted':''}"><div class="row"><h3>${E(l.date)} ${E(l.time)} · ${def.title}／影片 ${def.video}</h3><span class="badge">${l.minutes} 分鐘${l.deletedAt?' · 已刪除':''}</span></div><ul class="caption">${def.items.filter(i=>l.checks.includes(i.id)).map(i=>`<li>${E(i.label)}${i.count?' · 本次 '+l.counts[i.id]+' 遍':''}</li>`).join('')||'<li>部分練習，尚未勾選完成項目</li>'}</ul>${l.note?`<p>${E(l.note)}</p>`:''}${l.recordingUrl?`<p><a class="speaking-link" href="${E(l.recordingUrl)}" target="_blank" rel="noopener noreferrer">開啟自己的錄音 ↗</a></p>`:''}<div class="toolbar">${l.deletedAt?`<button data-speaking-restore="${E(l.id)}">還原紀錄</button>`:`<button data-speaking-edit="${E(l.id)}">編輯</button><button data-speaking-delete="${E(l.id)}">刪除</button><button data-speaking-repeat="${l.lesson}">再練這一課</button>`}</div></article>`}).join('')||'<div class="empty">這個範圍還沒有訓練紀錄。</div>'}</section>`;
  }
  function overview(db,c){
    return `<section class="panel"><h2>24 天主課程與 6 次延伸</h2><p class="caption">課程天數與實際日期分開計算，不用連續 24 天完成。每課清單的項目可分次累積，也可以隨時重練。</p>${[1,2,3,4,5,6].map(ch=>`<h3 style="margin-top:24px">CH${ch} · ${E(C.lessons.find(l=>l.chapter===ch).stage)}</h3><div class="speaking-lessons">${C.lessons.filter(l=>l.chapter===ch).map(l=>{const p=C.completion(db,c.id,l.id);return `<button class="speaking-lesson ${p.complete?'complete':''}" data-speaking-repeat="${l.id}"><strong>${l.title}</strong><span>影片 ${l.video}</span><small>${p.complete?'✓ 累積完成':p.done?`已完成 ${p.done} / ${p.total} 項`:'尚未完成'}</small></button>`}).join('')}</div>`).join('')}</section>`;
  }
  function rerender(){bridge.render()}
  function leave(){return !bridge.hasDraft()||confirm('目前有尚未儲存的表單。確定放棄這份草稿並切換？')}
  function bind(){
    document.querySelectorAll('[data-speaking-start]').forEach(b=>b.onclick=()=>{courseId=b.dataset.speakingStart;lessonId=Number(b.dataset.lesson);view='log';editId='';location.hash='speaking'});
    if(!$('#speaking-log-form')&&!$('#speaking-course-form'))return;
    $('#speaking-course')?.addEventListener('change',e=>{
      if(!leave()){e.target.value=courseId;return}
      const db=bridge.get(),c=C.state(db).courses.find(x=>x.id===e.target.value);if(!c)return;
      courseId=c.id;lessonId=C.progress(db,c.id).next;editId='';bridge.clearDraft();
      try{db.active=c.plan;bridge.commit(db);rerender()}catch(err){bridge.toast(err.message)}
    });
    document.querySelectorAll('[data-speaking-tab]').forEach(b=>b.onclick=()=>{if(!leave())return;bridge.clearDraft();view=b.dataset.speakingTab;editId='';rerender()});
    $('#speaking-lesson')?.addEventListener('change',e=>{if(!leave()){e.target.value=String(lessonId);return}bridge.clearDraft();lessonId=Number(e.target.value);rerender()});
    $('#speaking-course-form')?.addEventListener('submit',e=>{
      e.preventDefault();try{
        const values=Object.fromEntries(new FormData(e.currentTarget)),title=values.title.trim();if(!title)throw Error('請填入這一輪課程名稱。');
        const db=bridge.get();let planId=values.plan;
        if(planId==='new'){
          planId=uid();db.plans.push({id:planId,title,goal:'完成 24 天口說訓練及延伸練習，持續記錄每次開口的成果。',end:'',hours:'',motivation:'練習英語口說，累積流暢度與自信。',resources:'24 天英語口說奇蹟課程與每日打卡清單',milestones:'依自己的節奏完成主課程 24 天，再練習 6 次延伸內容。'});
        }
        if(!db.plans.some(p=>p.id===planId))throw Error('找不到所選學習計畫。');
        db.speaking||=C.empty();const c={id:uid(),plan:planId,title,createdAt:stamp()};db.speaking.courses.push(c);db.active=planId;
        bridge.commit(db);courseId=c.id;lessonId=1;view='log';editId='';bridge.clearDraft();rerender();bridge.toast('已建立新一輪口說課程。');
      }catch(err){bridge.toast(err.message)}
    });
    $('#speaking-log-form')?.addEventListener('submit',e=>{
      e.preventDefault();try{
        const form=new FormData(e.currentTarget),db=bridge.get(),c=selected(db),def=C.lesson(lessonId),date=String(form.get('date')),minutes=Number(form.get('minutes'));
        if(!C.validDate(date)||date>bridge.today())throw Error('請選擇今天或之前的實際練習日期。');
        if(!Number.isFinite(minutes)||minutes<=0||minutes>1440)throw Error('請填入大於 0、最多 1440 的練習分鐘數。');
        const recordingUrl=String(form.get('recordingUrl')).trim();if(!C.safeURL(recordingUrl))throw Error('錄音連結請使用 https:// 或 http://。');
        const old=C.state(db).logs.find(l=>l.id===String(form.get('editId'))&&!l.deletedAt&&l.course===c.id);
        if(form.get('editId')&&!old)throw Error('找不到要編輯的紀錄，請重新開啟。');
        const checks=form.getAll('checks'),counts={};for(const item of def.items.filter(i=>i.count)){
          const n=Number(form.get('count_'+item.id));if(!Number.isInteger(n)||n<0||n>9999)throw Error('遍數請填 0 到 9999 的整數。');
          if(checks.includes(item.id)&&n<1)throw Error('勾選已完成的跟練項目時，請至少填 1 遍。');counts[item.id]=n;
        }
        const now=stamp(),log={id:old?.id||uid(),course:c.id,lesson:def.id,date,time:String(form.get('time')),minutes,checks,counts,note:String(form.get('note')).trim(),recordingUrl,createdAt:old?.createdAt||now,updatedAt:now,deletedAt:''};
        if(old)db.speaking.logs[db.speaking.logs.findIndex(l=>l.id===old.id)]=log;else db.speaking.logs.push(log);
        bridge.commit(db);editId='';view='history';filterDate='';filterLesson='';bridge.clearDraft();rerender();bridge.toast(old?'已更新這次訓練紀錄。':'已儲存本次訓練；可接著同步到 Google Drive。');
      }catch(err){bridge.toast(err.message)}
    });
    document.querySelectorAll('#speaking-log-form input[name="checks"]').forEach(b=>b.addEventListener('change',()=>{const input=$(`#speaking-log-form input[name="count_${b.value}"]`);if(b.checked&&input&&Number(input.value)<1)input.value='1'}));
    $('#speaking-cancel-edit')?.addEventListener('click',()=>{if(!leave())return;editId='';view='history';bridge.clearDraft();rerender()});
    $('#speaking-filter-date')?.addEventListener('change',e=>{filterDate=e.target.value;rerender()});
    $('#speaking-filter-lesson')?.addEventListener('change',e=>{filterLesson=e.target.value;rerender()});
    $('#speaking-show-deleted')?.addEventListener('change',e=>{showDeleted=e.target.checked;rerender()});
    $('#speaking-clear-filter')?.addEventListener('click',()=>{filterDate='';filterLesson='';rerender()});
    document.querySelectorAll('[data-speaking-edit]').forEach(b=>b.onclick=()=>{if(!leave())return;bridge.clearDraft();editId=b.dataset.speakingEdit;view='log';rerender()});
    document.querySelectorAll('[data-speaking-repeat]').forEach(b=>b.onclick=()=>{if(!leave())return;bridge.clearDraft();lessonId=Number(b.dataset.speakingRepeat);editId='';view='log';rerender()});
    document.querySelectorAll('[data-speaking-delete],[data-speaking-restore]').forEach(b=>b.onclick=()=>{
      if(bridge.hasDraft())return bridge.toast('請先儲存或取消目前表單，再刪除或還原紀錄。');
      const restore=!!b.dataset.speakingRestore;
      if(!restore&&!confirm('刪除這次訓練紀錄？課程進度會重新計算，之後可在「顯示已刪除紀錄」還原。'))return;
      try{const db=bridge.get(),l=C.state(db).logs.find(l=>l.id===(b.dataset.speakingRestore||b.dataset.speakingDelete));if(!l)throw Error('找不到紀錄。');l.deletedAt=restore?'':stamp();l.updatedAt=stamp();bridge.commit(db);rerender();bridge.toast(restore?'已還原訓練紀錄。':'紀錄已移至已刪除，可隨時還原。')}catch(err){bridge.toast(err.message)}
    });
  }
  function dashboard(){
    const db=bridge.get(),c=C.state(db).courses.filter(c=>c.plan===db.active).at(-1);
    if(!c)return `<section class="panel speaking-today"><span class="badge">新的練習方式</span><h2>把每一次口說練習記下來</h2><p class="caption">24 天主課程＋6 次延伸，可分次完成，也能重練。</p><button data-go="speaking">建立口說打卡課程 →</button></section>`;
    const p=C.progress(db,c.id),l=C.lesson(p.next),today=C.logsFor(db,c.id).filter(x=>x.date===bridge.today());
    return `<section class="panel speaking-today"><div class="row"><div><span class="badge">口說練習 · ${E(c.title)}</span><h2 style="margin-top:12px">${p.main===24&&p.extra===6?'這一輪已完成，繼續重練':`接著練：${l.title} · 影片 ${l.video}`}</h2><p class="caption">主課 ${p.main}/24 · 延伸 ${p.extra}/6；今天 ${today.length} 次、${today.reduce((n,x)=>n+x.minutes,0)} 分鐘。</p></div><button class="primary" data-speaking-start="${E(c.id)}" data-lesson="${l.id}">開始打卡 →</button></div></section>`;
  }
  function weekly(start,end){const r=C.recent(bridge.get(),bridge.get().active,start,end);return r.count?`<div class="hint">近七天口說：${r.days} 天 · ${r.count} 次 · ${r.minutes} 分鐘。已計入上方練習次數與時間。</div>`:''}
  return {page,bind,dashboard,weekly,stats(start='0000-01-01',end='9999-12-31'){const db=bridge.get();return C.recent(db,db.active,start,end)}};
};
