/* =====================================================================
   REBUILD 2.2 — application logic
   ---------------------------------------------------------------------
   DATA SCHEMA (persisted to localStorage under KEY, one JSON object):
     {
       schemaVersion: 2,               // bumped when the shape below changes
       phase: 'restore'|'rebuild'|...  // current periodization block id
       phaseStart: 'YYYY-MM-DD',       // local date the current block began
       readiness: { 'YYYY-MM-DD': {achilles,back,wrist,stiffness,swelling,
                                    sleep,sleepQuality,fatigue,soreness} },
       daily: { 'YYYY-MM-DD': {steps,bodyweight} },
       logs: [ {date,day,title,phase,notes,exercises,readiness,
                postWorkout:{achilles,back}, substitutions:{progId:realId}} ],
       drafts: { 'YYYY-MM-DD|Day|phase': { [exerciseId]: {sets:[...],complete},
                                            notes, postAchilles, postBack,
                                            _swaps:{progId:realId} } }
     }
   Exercises inside `logs[].exercises` and `drafts[key]` are always keyed
   by the ACTUAL exercise id that was performed (post-substitution), never
   by the originally-prescribed slot id. This is what lets previous-
   performance memory and progression stay attached to the real movement.
   ===================================================================== */
let DATA=null,selectedDay=null,timerInterval=null;
const KEY='rebuild_app_v2';
const SCHEMA_VERSION=2;

/* ---------------------------------------------------------------------
   THEME
   Purely a display preference, stored under its own localStorage key
   (not inside the app's main data object / schema) so switching themes
   never touches readiness/logs/drafts or bumps SCHEMA_VERSION. 'default'
   is the original navy/blue palette; 'mono' is a black/gray/white
   variant defined in index.html's <style> under [data-theme="mono"].
   Functional status colors (readiness/deload red-yellow-green, and the
   "Avoid" caution callout) intentionally stay the same in both themes.
   ------------------------------------------------------------------- */
const THEME_KEY='rebuild_theme';
function applyTheme(t){
  document.documentElement.setAttribute('data-theme',t==='mono'?'mono':'default');
  if(themeToggle)themeToggle.textContent=t==='mono'?'⚪ Mono theme':'🔵 Classic theme';
}
function initTheme(){applyTheme(localStorage.getItem(THEME_KEY)||'default')}
function toggleTheme(){
  let next=(localStorage.getItem(THEME_KEY)||'default')==='mono'?'default':'mono';
  localStorage.setItem(THEME_KEY,next);
  applyTheme(next);
}

function blank(){return{schemaVersion:SCHEMA_VERSION,phase:'restore',phaseStart:dateKey(),readiness:{},daily:{},logs:[],drafts:{}}}

// Loads persisted state, migrating from the older v1 key if present and
// stamping a schemaVersion onto state that predates the field.
function store(){
  let s=JSON.parse(localStorage.getItem(KEY)||'null');
  if(!s){
    let old=JSON.parse(localStorage.getItem('rebuild_app_v1')||'null');
    s=blank();
    if(old){s.daily=old.daily||{};s.readiness=old.readiness||{}}
  }
  if(!s.schemaVersion) s.schemaVersion=1; // pre-existing data predates versioning
  if(!s.drafts) s.drafts={};
  if(!s.logs) s.logs=[];
  return s;
}
function save(s){s.schemaVersion=SCHEMA_VERSION;localStorage.setItem(KEY,JSON.stringify(s))}

/* ---------------------------------------------------------------------
   Date/time helpers.
   IMPORTANT: dateKey() must use the LOCAL calendar date, not UTC. The
   previous implementation used Date#toISOString(), which reports the
   UTC date — for users west of UTC (e.g. US Eastern) an evening entry
   can roll over to "tomorrow" while it is still locally today, silently
   misfiling readiness/steps/bodyweight/log data under the wrong date.
   ------------------------------------------------------------------- */
function dateKey(d=new Date()){
  let y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function todayName(){return['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()]}

function phase(){let id=store().phase;return DATA.phases.find(x=>x.id===id)||DATA.phases[0]}
function plan(){return DATA.plans[store().phase]||DATA.plans.restore}
function demo(q){return'https://www.youtube.com/results?search_query='+encodeURIComponent(q)}
function workoutKey(){return dateKey()+'|'+selectedDay+'|'+store().phase}
function parseSets(x){return Math.max(1,parseInt(x)||1)}
function prescribed(ex){return`${ex.sets} × ${ex.reps}`}

async function init(){
  DATA=await fetch('data.json').then(r=>r.json());
  selectedDay=todayName();
  buildPhaseSelect();
  loadReadiness();
  loadDaily();
  renderAll();
  if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
}
function buildPhaseSelect(){let s=store(),sel=document.getElementById('phaseSelect');sel.innerHTML=DATA.phases.map(p=>`<option value="${p.id}">${p.name} · Weeks ${p.weeks}</option>`).join('');sel.value=s.phase}
function renderAll(){renderHome();renderDayNav();renderWorkout();renderLibrary();renderHistory();renderProgress()}
function showView(v){['home','workout','progress','library','history'].forEach(x=>{document.getElementById(x+'View').classList.toggle('hidden',x!==v);let n=document.getElementById('nav'+x[0].toUpperCase()+x.slice(1));if(n)n.classList.toggle('active',x===v)});if(v==='progress')renderProgress();if(v==='history')renderHistory()}

function renderHome(){
  let s=store(),p=phase(),d=plan()[todayName()];
  phaseBadge.textContent=p.name;
  phaseGoal.textContent=p.goal+' · Target RPE '+p.rpe;
  phaseGate.textContent='Progression gate: '+p.gate;
  todayTitle.textContent=todayName()+' · '+d.title;
  todayNotes.textContent=d.notes||'';
  let draft=s.drafts[dateKey()+'|'+todayName()+'|'+s.phase]||{};
  // Only count prescribed exercise entries toward completion — metadata
  // keys such as notes/_swaps/postAchilles/postBack never carry .complete.
  let total=(d.items||[]).length,done=Object.values(draft).filter(x=>x&&typeof x==='object'&&x.complete).length;
  let pct=total?Math.round(done/total*100):0;
  todayProgress.style.width=pct+'%';
  progressText.textContent=pct+'% complete';
}

/* ---------------------------------------------------------------------
   READINESS LOGIC
   Daily readiness is a training decision-support signal, not a medical
   diagnosis. GREEN/YELLOW/RED reflects today's values plus short-term
   trend (last 3 entries) so that a single rough night of sleep does not
   by itself cancel training — only repeated poor sleep/fatigue does.
   ------------------------------------------------------------------- */
function saveReadiness(){
  let vals={achilles:+achillesPain.value||0,back:+backPain.value||0,wrist:+wristPain.value||0,stiffness:+stiffness.value||0,swelling:swelling.value,sleep:+sleep.value||0,sleepQuality:+sleepQuality.value||0,fatigue:+fatigue.value||0,soreness:+soreness.value||0};
  let s=store();s.readiness[dateKey()]=vals;save(s);showReadiness(vals);renderProgress();
}
function loadReadiness(){
  let r=store().readiness[dateKey()]||{};
  achillesPain.value=r.achilles??0;
  backPain.value=r.back??0;
  wristPain.value=r.wrist??0;
  stiffness.value=r.stiffness??0;
  swelling.value=r.swelling||'no';
  sleep.value=r.sleep??'';
  sleepQuality.value=r.sleepQuality??'';
  fatigue.value=r.fatigue??'';      // previously not restored after reload
  soreness.value=r.soreness??'';    // previously not restored after reload
  showReadiness(r);
}
function showReadiness(r={}){
  let a=r.achilles||0,b=r.back||0,w=r.wrist||0,st=r.stiffness||0,sw=r.swelling||"no",fq=r.fatigue||0,so=r.soreness||0,el=document.getElementById("readinessStatus");
  let s=store(),recent=Object.entries(s.readiness).sort((x,y)=>y[0].localeCompare(x[0])).slice(0,3).map(x=>x[1]);
  let repeatedPoor=recent.filter(x=>(x.sleepQuality||0)>0&&(x.sleepQuality||0)<=2).length>=2;
  let repeatedFatigue=recent.filter(x=>(x.fatigue||0)>=4).length>=2;
  el.className="status ";
  if(a>=5||b>=5||w>=5||sw==="yes"){
    el.classList.add("red");
    el.textContent="🔴 Do not progress loading today. Stop movements causing sharp or worsening symptoms. This is a training-decision tool, not a medical diagnosis — seek clinical evaluation for concerning or persistent symptoms.";
  }else if(a>=3||b>=3||w>=3||sw==="mild"||st>=20||repeatedPoor||repeatedFatigue||fq>=4||so>=5){
    el.classList.add("yellow");
    el.textContent="🟡 Hold progression. Reduce load, range, volume or difficulty as needed. Recovery markers argue against adding training stress today.";
  }else{
    el.classList.add("green");
    el.textContent="🟢 Proceed with planned training if movement remains normal. Progress only when performance and next-day response also support it.";
  }
}

function saveDaily(){let s=store();s.daily[dateKey()]={steps:+steps.value||0,bodyweight:+bodyweight.value||null};save(s);renderProgress()}
function loadDaily(){let d=store().daily[dateKey()]||{};steps.value=d.steps||'';bodyweight.value=d.bodyweight||''}
function changePhase(){let s=store();s.phase=phaseSelect.value;s.phaseStart=dateKey();save(s);renderAll()}
function openWorkoutToday(){selectedDay=todayName();renderDayNav();renderWorkout();showView('workout')}
function renderDayNav(){let days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];dayNav.innerHTML=days.map(d=>`<button class="daypill ${d===selectedDay?'active':''}" onclick="selectDay('${d}')">${d.slice(0,3)}</button>`).join('')}
function selectDay(d){selectedDay=d;renderDayNav();renderWorkout()}

// Finds the most recent COMPLETED performance for a given exercise id.
// `id` here is always the actual/real exercise id (post-substitution),
// never the originally-prescribed slot id, and only sets marked done are
// ever treated as completed performance by callers of this function.
function latestExerciseLog(id){let logs=store().logs.filter(l=>l.exercises&&l.exercises[id]&&l.exercises[id].sets?.some(s=>s.done));return logs.length?logs[0].exercises[id]:null}

/* ---------------------------------------------------------------------
   PROGRESSION LOGIC (double progression)
   - Mobility drills, timed isometric holds ("30–45s" style prescriptions)
     and breath/hold-count work never receive a load-progression call —
     they don't have a meaningful hypertrophy/strength rep range.
   - All sets at the top of the rep range with ~2+ RIR -> small load add.
   - Within range with adequate RIR -> keep load, chase more reps.
   - ~0 RIR / grinding -> hold or reduce load.
   - Otherwise -> repeat load, prioritize control/consistency.
   Symptom/readiness logic (see showReadiness) always overrides this.
   ------------------------------------------------------------------- */
function isTimedOrHoldExercise(ex){
  // Matches prescriptions like "30–45s", "20–30s/side" (timed holds) or
  // "6 holds" / "5 slow breaths" (count-based, not a load rep range).
  return /\ds(\/|\s|$)/i.test(ex.reps) || /holds?|breaths?/i.test(ex.reps);
}
function recommendation(id,ex){
  if(isTimedOrHoldExercise(ex)){
    return 'Timed/hold or breath-count exercise — progress duration, control or reduced assistance rather than external load. No automatic load-progression recommendation applies.';
  }
  let last=latestExerciseLog(id);
  if(!last)return'Start conservatively and establish a clean baseline.';
  let sets=last.sets.filter(x=>x.done&&x.reps);
  if(!sets.length)return'Repeat current prescribed range and establish completed-set data.';
  let reps=sets.map(x=>+x.reps),rir=sets.map(x=>+x.rir||0),weights=sets.map(x=>+x.weight||0);
  let range=ex.reps.match(/(\d+)[^\d]+(\d+)/);
  if(!range)return'Repeat and progress only if technique and symptoms remain stable.';
  let lo=+range[1],hi=+range[2],allTop=reps.every(x=>x>=hi),minRir=Math.min(...rir),sameWt=weights.every(x=>x===weights[0]);
  if(allTop&&minRir>=2&&sameWt)return`Progress: add the smallest practical load next time, then return toward ${lo} reps.`;
  if(reps.every(x=>x>=lo)&&minRir>=2)return`Maintain load and add reps toward ${hi} across all sets.`;
  if(minRir<=0)return'Hold or reduce load next time; avoid grinding and restore 1–3 RIR.';
  return'Repeat the load and improve consistency, control, or reps before adding weight.';
}

/* ---------------------------------------------------------------------
   SUBSTITUTION HANDLING
   swapExercise() records progId -> realId in the current day's draft.
   actualId() resolves which exercise id is actually being performed for
   a given programmed slot. Everywhere a workout renders/logs/recommends
   against an exercise, it must resolve through actualId() first so that
   name, prescription, cues, caution, demo, set logging and previous-
   performance memory all follow the SUBSTITUTED movement, never the
   originally-prescribed one. Superset slot labels stay anchored to the
   prescribed slot id, since pairing is a program-position concept.
   ------------------------------------------------------------------- */
function swapHtml(progId,draft){
  let choices=DATA.substitutions?.[progId]||[];
  if(!choices.length)return "";
  let current=draft?._swaps?.[progId]||"";
  return `<div class="swap"><label>Approved substitution</label><select onchange="swapExercise('${progId}',this.value)"><option value="" ${current===""?"selected":""}>Keep ${DATA.exerciseLibrary[progId].name}</option>${choices.map(x=>`<option value="${x}" ${current===x?"selected":""}>${DATA.exerciseLibrary[x]?.name||x}</option>`).join("")}</select></div>`;
}
function swapExercise(progId,newId){
  let s=store(),key=workoutKey();
  s.drafts[key]=s.drafts[key]||{};
  s.drafts[key]._swaps=s.drafts[key]._swaps||{};
  if(newId){s.drafts[key]._swaps[progId]=newId;}else{delete s.drafts[key]._swaps[progId];}
  save(s);renderWorkout();
}
function actualId(progId,draft){return draft?._swaps?.[progId]||progId}
function superPairLabel(progId){let pairs=DATA.supersets?.[store().phase]?.[selectedDay]||[];for(let i=0;i<pairs.length;i++){let j=pairs[i].indexOf(progId);if(j>=0)return `${String.fromCharCode(65+i)}${j+1}`;}return "";}

function renderWorkout(){
  if(!DATA)return;
  let d=plan()[selectedDay],s=store(),key=workoutKey(),draft=s.drafts[key]||{};
  workoutHeading.textContent=selectedDay+' · '+d.title;
  cardioBlock.innerHTML=d.cardio?`<div class="metric" style="margin-bottom:9px"><strong>Cardio:</strong> ${d.cardio}</div>`:'';
  exerciseList.innerHTML=(d.items||[]).map(progId=>{
    let realId=actualId(progId,draft);
    let ex=DATA.exerciseLibrary[realId]; // substituted exercise's own data: name/sets/reps/cues/caution/demo
    let n=parseSets(ex.sets),cur=draft[realId]||{sets:[]};
    let prev=latestExerciseLog(realId); // previous-performance memory follows the ACTUAL exercise
    let prevtxt=prev?prev.sets.filter(x=>x.done).map(x=>`${x.weight||0} lb × ${x.reps||0} @ RIR ${x.rir??'—'}`).join(' · '):'No previous logged performance.';
    let rows=Array.from({length:n},(_,i)=>{
      let x=cur.sets[i]||{};
      return`<div class="setrow"><div class="setnum">${i+1}</div><div><label>lb</label><input type="number" step="2.5" value="${x.weight??''}" onchange="setField('${realId}',${i},'weight',this.value)"></div><div><label>reps</label><input type="number" value="${x.reps??''}" onchange="setField('${realId}',${i},'reps',this.value)"></div><div><label>RIR</label><input type="number" min="0" max="6" value="${x.rir??''}" onchange="setField('${realId}',${i},'rir',this.value)"></div><input class="check" type="checkbox" ${x.done?'checked':''} onchange="setField('${realId}',${i},'done',this.checked)"></div>`;
    }).join('');
    return`<div class="ex"><div class="exhead"><h3>${superPairLabel(progId)?`<span style="color:#2F75B5">${superPairLabel(progId)} · </span>`:""}${ex.name}</h3><span class="dose">${prescribed(ex)}</span></div><div class="prev"><strong>Last:</strong> ${prevtxt}</div><div class="recommend">${recommendation(realId,ex)}</div>${swapHtml(progId,draft)}<div class="cue">${ex.how}</div><div class="avoid"><strong>Avoid:</strong> ${ex.avoid}</div>${rows}<div class="actions"><a class="btn secondary" href="${demo(ex.query)}" target="_blank">Watch Demo</a><button class="primary" onclick="toggleComplete('${realId}')">${cur.complete?'Completed ✓':'Mark Complete'}</button></div></div>`;
  }).join('')+`<div class="cue"><strong>Coach note:</strong> ${d.notes||''}</div>`;
  workoutNotes.value=(s.drafts[key]?.notes)||'';
  workoutNotes.onchange=()=>{let ss=store();ss.drafts[key]=ss.drafts[key]||{};ss.drafts[key].notes=workoutNotes.value;save(ss)};
  // Post-workout symptom capture (draft-persisted so it survives navigation).
  postAchilles.value=(s.drafts[key]?.postAchilles)??'';
  postBack.value=(s.drafts[key]?.postBack)??'';
  postAchilles.onchange=()=>{let ss=store();ss.drafts[key]=ss.drafts[key]||{};ss.drafts[key].postAchilles=+postAchilles.value||0;save(ss)};
  postBack.onchange=()=>{let ss=store();ss.drafts[key]=ss.drafts[key]||{};ss.drafts[key].postBack=+postBack.value||0;save(ss)};
}
function setField(id,i,field,val){let s=store(),key=workoutKey();s.drafts[key]=s.drafts[key]||{};s.drafts[key][id]=s.drafts[key][id]||{sets:[]};s.drafts[key][id].sets=s.drafts[key][id].sets||[];s.drafts[key][id].sets[i]=s.drafts[key][id].sets[i]||{};s.drafts[key][id].sets[i][field]=field==='done'?val:(val===''?'':+val);save(s)}
function toggleComplete(id){let s=store(),key=workoutKey();s.drafts[key]=s.drafts[key]||{};s.drafts[key][id]=s.drafts[key][id]||{sets:[]};s.drafts[key][id].complete=!s.drafts[key][id].complete;save(s);renderWorkout();renderHome()}

function completeWorkout(){
  let s=store(),key=workoutKey(),d=plan()[selectedDay],draft=s.drafts[key]||{},exercises={};
  for(let progId of d.items||[]){
    let realId=actualId(progId,draft);
    if(draft[realId])exercises[realId]=draft[realId];
  }
  let entry={
    date:dateKey(),day:selectedDay,title:d.title,phase:s.phase,notes:draft.notes||'',
    exercises,
    readiness:s.readiness[dateKey()]||{},
    postWorkout:{achilles:+postAchilles.value||0,back:+postBack.value||0},
    substitutions:draft._swaps||{}
  };
  // Data integrity: replace an existing entry for the same date/day/phase
  // instead of appending a duplicate if "Complete workout" is pressed twice.
  let existingIdx=s.logs.findIndex(l=>l.date===entry.date&&l.day===entry.day&&l.phase===entry.phase);
  if(existingIdx>=0){s.logs[existingIdx]=entry;}else{s.logs.unshift(entry);}
  delete s.drafts[key];
  save(s);
  renderAll();
  alert('Workout saved. Previous-performance memory is now updated.');
}

function renderLibrary(){
  if(!DATA)return;
  let q=(search.value||'').toLowerCase();
  let arr=Object.entries(DATA.exerciseLibrary).filter(([id,x])=>x.name.toLowerCase().includes(q));
  // Library is a general reference (searchable, not day-specific), so it
  // intentionally does not show workout-day superset pairing labels.
  libraryList.innerHTML=arr.map(([id,ex])=>`<div class="card"><div class="exhead"><h3>${ex.name}</h3><span class="dose">${prescribed(ex)}</span></div><div class="cue">${ex.how}</div><div class="avoid"><strong>Avoid:</strong> ${ex.avoid}</div><div class="actions"><a class="btn primary" href="${demo(ex.query)}" target="_blank">Watch Demo</a></div></div>`).join('');
}

function renderHistory(){
  let h=store().logs;
  historyList.innerHTML=h.length?h.map(x=>{
    let completed=Object.values(x.exercises||{}).filter(e=>e.complete).length,total=(DATA.plans[x.phase]?.[x.day]?.items||[]).length;
    return`<div class="historyItem"><strong>${x.date} · ${x.day}</strong><div>${x.title}</div><div class="tiny">${completed}/${total} exercises marked complete · ${DATA.phases.find(p=>p.id===x.phase)?.name||x.phase}</div>${(x.postWorkout&&(x.postWorkout.achilles||x.postWorkout.back))?`<div class="tiny">Post-workout: Achilles ${x.postWorkout.achilles||0}/10 · Back ${x.postWorkout.back||0}/10</div>`:''}${x.notes?`<div class="cue">${x.notes}</div>`:''}</div>`;
  }).join(''):'<div class="cue">No completed workouts yet.</div>';
}

function renderProgress(){
  if(!DATA)return;
  let s=store();
  kpiWorkouts.textContent=s.logs.length;
  let cutoff=new Date();cutoff.setDate(cutoff.getDate()-30);
  let recent=s.logs.filter(x=>new Date(x.date)>=cutoff).length;
  kpiAdherence.textContent=Math.min(100,Math.round(recent/20*100))+'%';
  let weights=Object.entries(s.daily).filter(([d,v])=>v.bodyweight).sort((a,b)=>a[0].localeCompare(b[0]));
  kpiWeight.textContent=weights.length?weights.at(-1)[1].bodyweight+' lb':'—';
  drawBars(weightChart,weights.slice(-14).map(([d,v])=>({d:d.slice(5),v:v.bodyweight})));
  let stiff=Object.entries(s.readiness).filter(([d,v])=>v.stiffness!=null).sort((a,b)=>a[0].localeCompare(b[0]));
  drawBars(stiffnessChart,stiff.slice(-14).map(([d,v])=>({d:d.slice(5),v:+v.stiffness||0})));
  let sleepData=Object.entries(s.readiness).filter(([d,v])=>v.sleepQuality).sort((a,b)=>a[0].localeCompare(b[0])).slice(-14);
  drawBars(sleepChart,sleepData.map(([d,v])=>({d:d.slice(5),v:+v.sleepQuality||0})));
  let hrs=sleepData.map(x=>+x[1].sleep||0).filter(Boolean),qs=sleepData.map(x=>+x[1].sleepQuality||0).filter(Boolean);
  sleepSummary.textContent=qs.length?`Average quality: ${(qs.reduce((a,b)=>a+b,0)/qs.length).toFixed(1)}/5 · Average duration: ${hrs.length?(hrs.reduce((a,b)=>a+b,0)/hrs.length).toFixed(1):'—'} hr · Nights under 7 hr: ${hrs.filter(x=>x<7).length}`:'No sleep-quality data yet.';
  capacityDashboard.innerHTML=Object.entries(DATA.bodyCapacity||{}).map(([name,x])=>`<div class="phaseRow"><strong>${name}</strong><div>${x.current}</div><div class="gate">Track: ${x.metrics.join(" · ")}</div></div>`).join("");
  movementBalance.innerHTML=Object.entries(DATA.weeklyTargets||{}).map(([k,v])=>`<div class="phaseRow"><strong>${k.replace(/([A-Z])/g," $1")}</strong><div class="gate">${v}</div></div>`).join("");
  phaseTimeline.innerHTML=DATA.phases.map(p=>`<div class="phaseRow ${p.id===s.phase?'current':''}"><strong>${p.name}</strong> <span class="tiny">Weeks ${p.weeks} · RPE ${p.rpe}</span><div>${p.goal}</div><div class="gate">${p.gate}</div></div>`).join('');
  renderDeload();
}

function drawBars(el,arr){if(!arr.length){el.innerHTML='<div class="cue">No data yet.</div>';return}let max=Math.max(...arr.map(x=>x.v),1),min=Math.min(...arr.map(x=>x.v));if(max-min<1)min=0;el.innerHTML=arr.map(x=>`<div class="bar" style="height:${Math.max(8,(x.v-min)/(max-min||max)*100)}%" title="${x.d}: ${x.v}"><span>${x.d}</span></div>`).join('')}

function evaluateGate(){
  let s=store(),p=phase(),logs=s.logs.filter(x=>x.phase===p.id),days=(new Date()-new Date(s.phaseStart))/86400000;
  let r=Object.entries(s.readiness).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,7).map(x=>x[1]);
  let red=r.some(x=>(x.achilles||0)>=5||(x.back||0)>=5||(x.wrist||0)>=5||x.swelling==='yes');
  let yellow=r.some(x=>(x.achilles||0)>=3||(x.back||0)>=3||(x.wrist||0)>=3||x.swelling==='mild'||(x.stiffness||0)>=20);
  let enough=days>=p.minWeeks*7-1,workouts=logs.length>=Math.max(3,p.minWeeks*3),html='';
  if(red)html='<div class="status red">🔴 Do not advance. Recent symptoms indicate loading should be reduced and clinically reassessed if concerning or persistent.</div>';
  else if(!enough||!workouts||yellow)html=`<div class="status yellow">🟡 Extend the current block. ${!enough?'Minimum block duration not yet completed. ':''}${!workouts?'More successful training exposures are needed. ':''}${yellow?'Recent symptom data suggests holding progression.':''}</div>`;
  else html='<div class="status green">🟢 Calendar, adherence and symptom checks support considering the next block. Movement-quality criteria and clinician restrictions still override the app.</div>';
  gateResult.innerHTML=html;
}

/* ---------------------------------------------------------------------
   DELOAD LOGIC
   Independent of phase-gate advancement: a deload signal can fire mid-
   phase and only recommends a temporary volume/load reduction. Requires
   at least two co-occurring signals (repeated high fatigue, repeated
   poor sleep, accumulating soreness, worsening joint/tendon symptoms, or
   declining performance/frequent 0-RIR sets) before recommending a
   deload — a single rough day is never enough on its own.
   ------------------------------------------------------------------- */
function evaluateDeload(){
  let s=store();
  let recent=Object.entries(s.readiness).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,7).map(x=>x[1]);
  if(recent.length<3)return{trigger:false,message:'Not enough recent readiness data to evaluate deload need.'};
  let highFatigueCount=recent.filter(x=>(x.fatigue||0)>=4).length;
  let poorSleepCount=recent.filter(x=>(x.sleepQuality||0)>0&&(x.sleepQuality||0)<=2).length;
  let sorenessCount=recent.filter(x=>(x.soreness||0)>=4).length;
  let worseningSymptoms=recent.filter(x=>(x.achilles||0)>=3||(x.back||0)>=3||(x.wrist||0)>=3||(x.stiffness||0)>=20).length;
  let recentLogs=s.logs.slice(0,4),grindingSets=0,totalLoggedSets=0;
  recentLogs.forEach(l=>Object.values(l.exercises||{}).forEach(e=>(e.sets||[]).forEach(set=>{if(set.done){totalLoggedSets++;if((+set.rir||0)<=0)grindingSets++;}})));
  let grindingRate=totalLoggedSets?grindingSets/totalLoggedSets:0;
  let signals=[];
  if(highFatigueCount>=3)signals.push('repeated high fatigue');
  if(poorSleepCount>=3)signals.push('repeated poor sleep');
  if(sorenessCount>=3)signals.push('accumulating soreness');
  if(worseningSymptoms>=3)signals.push('worsening joint/tendon symptoms');
  if(grindingRate>=0.35&&totalLoggedSets>=6)signals.push('declining performance (frequent 0 RIR sets)');
  if(signals.length>=2)return{trigger:true,message:`🟠 Consider a deload: ${signals.join(', ')} over the recent window. Typical adjustment: reduce volume ~30–50% and load ~10–15% while maintaining movement practice and appropriate rehab work.`};
  if(signals.length===1)return{trigger:false,message:`Monitor closely: ${signals[0]} noted, but not yet enough combined signals to recommend a full deload.`};
  return{trigger:false,message:'No deload indicated. Recovery markers and recent performance look stable.'};
}
function renderDeload(){
  let d=evaluateDeload(),el=document.getElementById('deloadStatus');
  if(!el)return;
  el.className='status '+(d.trigger?'yellow':'green');
  el.textContent=d.message;
}

function exportData(){
  // schemaVersion travels with the export so future versions can detect
  // and safely migrate or reject incompatible backups on import.
  let blob=new Blob([JSON.stringify(store(),null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='rebuild-v2-backup-'+dateKey()+'.json';a.click();URL.revokeObjectURL(a.href);
}
function importData(inp){
  let f=inp.files[0];if(!f)return;
  let r=new FileReader();
  r.onload=()=>{
    try{
      let x=JSON.parse(r.result);
      let requiredKeys=['phase','readiness','daily','logs','drafts'];
      let valid=x&&typeof x==='object'&&requiredKeys.every(k=>k in x);
      if(!valid){alert('That file does not look like a valid REBUILD backup and was not imported.');inp.value='';return;}
      if(x.schemaVersion&&x.schemaVersion>SCHEMA_VERSION){alert('This backup was created by a newer app version and cannot be safely imported here.');inp.value='';return;}
      if(!confirm('Import this backup and replace all current data on this device? This cannot be undone.')){inp.value='';return;}
      x.schemaVersion=x.schemaVersion||1;
      localStorage.setItem(KEY,JSON.stringify(x));
      location.reload();
    }catch(e){alert('That file could not be imported. It may not be valid JSON.');}
  };
  r.readAsText(f);
}

function openMorningReset(){
  showView("library");search.value="";
  let ms=DATA.microSessions?.morningReset;if(!ms)return;
  libraryList.innerHTML=`<div class="card"><h2>${ms.name}</h2><div class="cue">${ms.description}</div></div>`+ms.items.map(id=>{let ex=DATA.exerciseLibrary[id];return `<div class="card"><div class="exhead"><h3>${ex.name}</h3><span class="dose">${prescribed(ex)}</span></div><div class="cue">${ex.how}</div><div class="avoid"><strong>Avoid:</strong> ${ex.avoid}</div><div class="actions"><a class="btn primary" href="${demo(ex.query)}" target="_blank">Watch Demo</a></div></div>`;}).join("");
}
function openUndoChair(){
  showView('library');
  let ids=DATA.microSessions?.undoChair?.items||[];
  libraryList.innerHTML=`<div class="card"><h2>${DATA.microSessions.undoChair.name}</h2><div class="cue">${DATA.microSessions.undoChair.description}</div></div>`+ids.map(id=>{let ex=DATA.exerciseLibrary[id];return `<div class="card"><div class="exhead"><h3>${ex.name}</h3><span class="dose">${prescribed(ex)}</span></div><div class="cue">${ex.how}</div><div class="avoid"><strong>Avoid:</strong> ${ex.avoid}</div><div class="actions"><a class="btn primary" href="${demo(ex.query)}" target="_blank">Watch Demo</a></div></div>`;}).join('');
}

function startTimer(sec){clearInterval(timerInterval);let t=sec,draw=()=>timerDisplay.textContent=String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');draw();timerInterval=setInterval(()=>{t--;draw();if(t<=0){clearInterval(timerInterval);navigator.vibrate&&navigator.vibrate([200,100,200])}},1000)}

initTheme();
init();
