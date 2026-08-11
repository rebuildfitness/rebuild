
let APPDATA=null;
let selectedDay=null;
let timerInterval=null;

const STORE_KEY="rebuild_app_v1";
function store(){ return JSON.parse(localStorage.getItem(STORE_KEY)||'{"phase":"weeks12","readiness":{},"daily":{},"sets":{},"history":[]}');}
function save(s){ localStorage.setItem(STORE_KEY,JSON.stringify(s)); }

function todayName(){return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][new Date().getDay()];}
function dateKey(){return new Date().toISOString().slice(0,10);}
function plan(){ const s=store(); return APPDATA[s.phase] || APPDATA.weeks12; }

async function init(){
  APPDATA=await fetch("data.json").then(r=>r.json());
  let s=store();
  document.getElementById("phaseSelect").value=s.phase;
  selectedDay=todayName();
  loadReadiness();
  loadDaily();
  renderHome();
  renderDayNav();
  renderWorkout();
  renderLibrary();
  renderHistory();
  if("serviceWorker" in navigator){navigator.serviceWorker.register("sw.js").catch(()=>{});}
}
function changePhase(){
  let s=store(); s.phase=document.getElementById("phaseSelect").value; save(s);
  document.getElementById("phaseBadge").textContent=s.phase==="weeks12"?"Weeks 1–2":"Weeks 3–4";
  renderHome(); renderWorkout();
}
function showView(v){
  ["home","workout","library","history"].forEach(x=>{
    document.getElementById(x+"View").classList.toggle("hidden",x!==v);
    const n=document.getElementById("nav"+x.charAt(0).toUpperCase()+x.slice(1));
    if(n)n.classList.toggle("active",x===v);
  });
  if(v==="history")renderHistory();
}
function renderHome(){
  let s=store();
  document.getElementById("phaseBadge").textContent=s.phase==="weeks12"?"Weeks 1–2":"Weeks 3–4";
  const d=plan()[todayName()];
  document.getElementById("todayTitle").textContent=todayName()+" · "+d.title;
  document.getElementById("todayNotes").textContent=d.notes||"";
  const items=d.items||[];
  const key=dateKey()+"|"+todayName();
  const done=(s.sets[key]||{}).doneExercises||[];
  const pct=items.length?Math.round(done.length/items.length*100):0;
  document.getElementById("todayProgress").style.width=pct+"%";
  document.getElementById("progressText").textContent=pct+"% complete";
}
function saveReadiness(){
  const a=+document.getElementById("achillesPain").value||0;
  const b=+document.getElementById("backPain").value||0;
  const st=+document.getElementById("stiffness").value||0;
  const sw=document.getElementById("swelling").value;
  let s=store(); s.readiness[dateKey()]={achilles:a,back:b,stiffness:st,swelling:sw}; save(s);
  showReadiness(a,b,st,sw);
}
function loadReadiness(){
  const r=store().readiness[dateKey()]||{};
  if(r.achilles!=null)document.getElementById("achillesPain").value=r.achilles;
  if(r.back!=null)document.getElementById("backPain").value=r.back;
  if(r.stiffness!=null)document.getElementById("stiffness").value=r.stiffness;
  if(r.swelling)document.getElementById("swelling").value=r.swelling;
  showReadiness(r.achilles||0,r.back||0,r.stiffness||0,r.swelling||"no");
}
function showReadiness(a,b,st,sw){
  const el=document.getElementById("readinessStatus");
  el.className="status ";
  if(a>=5||b>=5||sw==="yes"){el.classList.add("red");el.textContent="🔴 Do not progress loading today. Stop painful movements and seek evaluation for new neurologic symptoms, severe pain, or worsening function.";}
  else if(a>=3||b>=3||sw==="mild"||st>=20){el.classList.add("yellow");el.textContent="🟡 Hold progression. Reduce load, range, volume, or exercise difficulty and reassess tomorrow.";}
  else {el.classList.add("green");el.textContent="🟢 Ready for planned training if movement remains normal.";}
}
function saveDaily(){
  let s=store(); s.daily[dateKey()]={steps:+document.getElementById("steps").value||0,bodyweight:+document.getElementById("bodyweight").value||null}; save(s);
}
function loadDaily(){
  const d=store().daily[dateKey()]||{};
  if(d.steps)document.getElementById("steps").value=d.steps;
  if(d.bodyweight)document.getElementById("bodyweight").value=d.bodyweight;
}
function openWorkoutToday(){ selectedDay=todayName(); renderDayNav(); renderWorkout(); showView("workout");}
function renderDayNav(){
  const el=document.getElementById("dayNav"); if(!el)return;
  const days=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  el.innerHTML=days.map(d=>`<button class="daypill ${d===selectedDay?'active':''}" onclick="selectDay('${d}')">${d.slice(0,3)}</button>`).join("");
}
function selectDay(d){selectedDay=d;renderDayNav();renderWorkout();}
function demoLink(q){return "https://www.youtube.com/results?search_query="+encodeURIComponent(q);}
function setsCount(dose){
  const m=String(dose).match(/^(\d+)\s*[×x]/); return m?+m[1]:1;
}
function renderWorkout(){
  if(!APPDATA)return;
  const d=plan()[selectedDay];
  document.getElementById("workoutHeading").textContent=selectedDay+" · "+d.title;
  document.getElementById("cardioBlock").innerHTML=d.cardio?`<div class="metric" style="margin-bottom:10px"><strong>Cardio:</strong> ${d.cardio}</div>`:"";
  const key=dateKey()+"|"+selectedDay;
  let s=store(); const st=s.sets[key]||{doneExercises:[],setChecks:{}};
  document.getElementById("exerciseList").innerHTML=(d.items||[]).map(id=>{
    const ex=APPDATA.exerciseLibrary[id]; const n=setsCount(ex.dose);
    const checks=Array.from({length:n},(_,i)=>`<label class="setcheck"><input type="checkbox" ${((st.setChecks[id]||[])[i])?'checked':''} onchange="toggleSet('${id}',${i},this.checked)">Set ${i+1}</label>`).join("");
    return `<div class="ex">
      <div class="exhead"><h3>${ex.name}</h3><span class="dose">${ex.dose}</span></div>
      <div class="cue">${ex.how}</div><div class="avoid"><strong>Avoid:</strong> ${ex.avoid}</div>
      <div class="sets">${checks}</div>
      <div class="actions"><a class="btn secondary" href="${demoLink(ex.query)}" target="_blank">Watch Demo</a><button class="primary" onclick="markExercise('${id}')">${st.doneExercises.includes(id)?'Completed ✓':'Mark Complete'}</button></div>
    </div>`;
  }).join("") + `<div class="cue" style="margin-top:12px"><strong>Coach note:</strong> ${d.notes||""}</div>`;
}
function toggleSet(id,i,val){
  let s=store(); const key=dateKey()+"|"+selectedDay; s.sets[key]=s.sets[key]||{doneExercises:[],setChecks:{}};
  s.sets[key].setChecks[id]=s.sets[key].setChecks[id]||[]; s.sets[key].setChecks[id][i]=val; save(s);
}
function markExercise(id){
  let s=store(); const key=dateKey()+"|"+selectedDay; s.sets[key]=s.sets[key]||{doneExercises:[],setChecks:{}};
  let arr=s.sets[key].doneExercises;
  if(arr.includes(id))arr=arr.filter(x=>x!==id); else arr.push(id);
  s.sets[key].doneExercises=arr; save(s); renderWorkout(); renderHome();
}
function completeWorkout(){
  let s=store(); const key=dateKey()+"|"+selectedDay;
  const d=plan()[selectedDay]; const done=(s.sets[key]||{}).doneExercises||[];
  s.history.unshift({date:dateKey(),day:selectedDay,title:d.title,completed:done.length,total:(d.items||[]).length,phase:s.phase});
  save(s); renderHistory(); alert("Workout saved to history.");
}
function renderLibrary(){
  if(!APPDATA)return;
  const q=(document.getElementById("search")?.value||"").toLowerCase();
  const items=Object.values(APPDATA.exerciseLibrary).filter(ex=>ex.name.toLowerCase().includes(q));
  document.getElementById("libraryList").innerHTML=items.map(ex=>`<div class="card">
    <div class="exhead"><h3>${ex.name}</h3><span class="dose">${ex.dose}</span></div>
    <div class="cue">${ex.how}</div><div class="avoid"><strong>Avoid:</strong> ${ex.avoid}</div>
    <div class="actions"><a class="btn primary" href="${demoLink(ex.query)}" target="_blank">Watch Demo</a></div>
  </div>`).join("");
}
function renderHistory(){
  const h=store().history||[];
  document.getElementById("historyList").innerHTML=h.length?h.map(x=>`<div class="historyItem"><strong>${x.date} · ${x.day}</strong><div>${x.title}</div><div class="tiny">${x.completed}/${x.total} exercises completed · ${x.phase==="weeks12"?"Weeks 1–2":"Weeks 3–4"}</div></div>`).join(""):`<div class="cue">No completed workouts yet.</div>`;
}
function exportData(){
  const blob=new Blob([JSON.stringify(store(),null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="rebuild-backup-"+dateKey()+".json";a.click();URL.revokeObjectURL(a.href);
}
function startTimer(sec){
  if(timerInterval)clearInterval(timerInterval);
  let t=sec; const disp=document.getElementById("timerDisplay");
  const draw=()=>{const m=String(Math.floor(t/60)).padStart(2,"0"),s=String(t%60).padStart(2,"0");disp.textContent=m+":"+s;};
  draw(); timerInterval=setInterval(()=>{t--;draw();if(t<=0){clearInterval(timerInterval);navigator.vibrate&&navigator.vibrate([200,100,200]);}},1000);
}
init();
