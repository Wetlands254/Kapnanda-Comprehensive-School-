
/* ---------- Supabase shared cloud connection ---------- */
const CLOUD_KEY="kapnanda_supabase_config_v1";
// Default Supabase connection. The publishable/anon key is safe for browser use
// when Row Level Security (RLS) is correctly configured. NEVER put a service-role key here.
const DEFAULT_SUPABASE_CONFIG={
  url:"https://nrxstipepaevthkeuxoh.supabase.co",
  anonKey:"sb_publishable_nk1h83XRYa-NdZKhgZfsig__0xG8CdM"
};
const SHARED_STATE_ID="KAPNANDA";
let cloud=null, cloudReady=false, cloudUser=null, cloudSyncBusy=false, cloudSavePending=false;
let cloudBaseDb=null, cloudLastUpdatedAt=0, cloudRefreshTimer=null;

function cloneDb(x){try{return JSON.parse(JSON.stringify(x))}catch(e){return x}}
function sameJson(a,b){try{return JSON.stringify(a)===JSON.stringify(b)}catch(e){return a===b}}
function getCloudConfig(){
  try{
    const saved=JSON.parse(localStorage.getItem(CLOUD_KEY)||"null");
    if(saved?.url&&saved?.anonKey)return saved;
  }catch(e){}
  return DEFAULT_SUPABASE_CONFIG;
}
function cloudConfigured(){const c=getCloudConfig();return !!(c?.url&&c?.anonKey&&c.url.startsWith("http"))}
function initCloud(){if(!cloudConfigured()||!window.supabase)return false;const c=getCloudConfig();try{cloud=window.supabase.createClient(c.url,c.anonKey);return true}catch(e){console.error(e);return false}}

function cloudSetup(){
  const c=getCloudConfig()||{url:"",anonKey:""};
  openModal(`<h2>Supabase Cloud Setup</h2><p>Paste your Supabase <b>Project URL</b> and <b>Publishable/anon key</b>. Never paste the service-role key into this website.</p>${field("Project URL","surl",c.url)}${field("Publishable / anon key","skey",c.anonKey)}<div class="toolbar"><button onclick="saveCloudSetup()">Save & Connect</button><button class="secondary" onclick="closeModal()">Cancel</button></div><p class="small">All authenticated Kapnanda teachers can use the same shared school database. Create one Supabase Auth account for each teacher.</p>`);
}
function saveCloudSetup(){
  const url=v("surl").trim().replace(/\/$/,""),anonKey=v("skey").trim();
  if(!url||!anonKey||!url.startsWith("http")){toast("Enter a valid Supabase URL and anon key");return}
  localStorage.setItem(CLOUD_KEY,JSON.stringify({url,anonKey}));
  if(initCloud()){
    document.getElementById("loginMode").textContent="Supabase mode — shared school database enabled.";
      toast("Supabase configured");closeModal();
  }else toast("Could not initialize Supabase");
}
async function cloudLogin(email,password){
  if(!initCloud())return{error:"Supabase connection could not be initialized. Check the Project URL and publishable/anon key."};
  const {data,error}=await cloud.auth.signInWithPassword({email,password});
  if(error){
    console.error("Supabase login error:",error);
    const msg=String(error.message||"");
    if(/invalid login credentials/i.test(msg)){
      return{error:"Invalid email or password. Make sure this email exists in Supabase Authentication → Users and use that user's password."};
    }
    if(/email not confirmed/i.test(msg)){
      return{error:"Email not confirmed. Confirm the user in Supabase Authentication → Users, then try again."};
    }
    return{error:msg||"Supabase login failed"};
  }
  cloudUser=data.user;return{data};
}

/* Merge local changes with the latest shared copy so one teacher does not
   accidentally overwrite another teacher's recent learner/mark/fee changes. */
function mergeSharedData(server,local,base){
  if(!server)return cloneDb(local);
  if(!base)return cloneDb(local);
  const result=cloneDb(server);
  const arrayKeys=["learners","teachers","teacherLoads","payments","marks","attendance","timetable","exams","audit","academicPeriods","questionPapers","capitationTransactions","bomBudgets"];
  for(const key of arrayKeys){
    const l=Array.isArray(local?.[key])?local[key]:[];
    const b=Array.isArray(base?.[key])?base[key]:[];
    const s=Array.isArray(server?.[key])?server[key]:[];
    const lm=new Map(l.filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
    const bm=new Map(b.filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
    const sm=new Map(s.filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
    const order=s.map(x=>String(x.id));
    for(const item of l){
      if(!item||item.id==null)continue;
      const id=String(item.id);
      const baseItem=bm.get(id);
      if(!baseItem || !sameJson(item,baseItem)){
        sm.set(id,cloneDb(item));
        if(!order.includes(id))order.push(id);
      }
    }
    for(const id of bm.keys()){
      if(!lm.has(id) && sm.has(id) && sameJson(sm.get(id),bm.get(id)))sm.delete(id);
    }
    result[key]=order.filter(id=>sm.has(id)).map(id=>sm.get(id));
  }
  const objectKeys=["settings","fees","subjectConfigs","timetableMeta"];
  for(const key of objectKeys){
    const l=local?.[key], b=base?.[key], s=server?.[key];
    if(sameJson(l,b)) continue;
    if(l && b && typeof l==="object" && typeof b==="object" && !Array.isArray(l) && !Array.isArray(b)){
      const out=cloneDb(s&&typeof s==="object"&&!Array.isArray(s)?s:{});
      const keys=new Set([...Object.keys(b||{}),...Object.keys(l||{})]);
      for(const k of keys){
        if(sameJson(l?.[k],b?.[k])) continue;
        if(l?.[k]===undefined){delete out[k];continue}
        out[k]=cloneDb(l[k]);
      }
      result[key]=out;
    }else result[key]=cloneDb(l);
  }
  return result;
}

async function cloudLoad(){
  if(!cloud||!cloudUser)return false;
  const {data,error}=await cloud.from("school_state_shared").select("id,data,updated_at").eq("id",SHARED_STATE_ID).maybeSingle();
  if(error){console.error(error);toast("Cloud read failed: "+error.message);return false}
  if(data?.data && data.data.settings && Array.isArray(data.data.learners)){
    const hadNoAssessments=!Array.isArray(data.data.exams)||data.data.exams.length===0;
    db=sanitizeCloudDb(data.data);
    normalizeDbShape();
    if(!Array.isArray(db.learners)) db.learners=[];
    if(!Array.isArray(db.teachers)) db.teachers=[];
    if(!Array.isArray(db.teacherLoads)) db.teacherLoads=[];
    if(!Array.isArray(db.payments)) db.payments=[];
    if(!Array.isArray(db.marks)) db.marks=[];
    if(!Array.isArray(db.attendance)) db.attendance=[];
    if(!Array.isArray(db.timetable)) db.timetable=[];
    if(!Array.isArray(db.exams)) db.exams=[];
db.exams=db.exams.map(e=>({...e,name:e.name||e.type||"Assessment",type:e.type||"Other"}));
    if(!Array.isArray(db.audit)) db.audit=[];
if(!Array.isArray(db.questionPapers)) db.questionPapers=[];
    cloudBaseDb=cloneDb(db);
    cloudLastUpdatedAt=new Date(data.updated_at||0).getTime()||0;
    localStorage.setItem(KEY,JSON.stringify(db));
    if(hadNoAssessments) await cloudSave(true);
  }else{
    await cloudSave(true);
  }
  return true;
}

function sanitizeCloudDb(value){
  const out=cloneDb(value)||{};
  // Never store browser login credentials in the shared database.
  delete out.users;
  if(out.settings){
    delete out.settings.password;
    delete out.settings.pass;
  }
  return out;
}

// Normalize older/partial cloud records before any page is rendered.
// This prevents the post-login Dashboard from going blank when an older
// school_state_shared record does not yet contain the newer V2/V3 fields.
function normalizeDbShape(){
  if(!db || typeof db!=="object") db={};
  db.settings={school:"Kapnanda Comprehensive School",motto:"Hardwork Pays",term:"Term 3",year:"2026",phone:"",email:"",...(db.settings||{})};
  const arrays=["learners","teachers","teacherLoads","payments","marks","attendance","timetable","exams","audit","academicPeriods","questionPapers"];
  for(const k of arrays) if(!Array.isArray(db[k])) db[k]=[];
  if(!Array.isArray(db.capitationTransactions)) db.capitationTransactions=[];
  if(!Array.isArray(db.bomBudgets)) db.bomBudgets=[];
  // Repair older shared databases that have no assessment records. Do not
  // replace or modify existing exams; only seed choices when the list is empty.
  if(db.exams.length===0){
    const term=String(db.settings.term||"Term 3"), year=String(db.settings.year||new Date().getFullYear());
    db.exams=[
      {id:`EX_DEFAULT_MID_${year}_${term.replace(/\W/g,"")}`,name:"Mid term exam",type:"Mid term exam",term,year},
      {id:`EX_DEFAULT_END_${year}_${term.replace(/\W/g,"")}`,name:"End term exam",type:"End term exam",term,year},
      {id:`EX_DEFAULT_KJSEA_${year}_${term.replace(/\W/g,"")}`,name:"KJSEA analysis",type:"KJSEA analysis",term,year},
      {id:`EX_DEFAULT_KPSEA_${year}_${term.replace(/\W/g,"")}`,name:"KPSEA analysis",type:"KPSEA analysis",term,year}
    ];
  }
  if(!db.subjectConfigs || typeof db.subjectConfigs!=="object" || Array.isArray(db.subjectConfigs)) db.subjectConfigs={};
  if(!db.fees || typeof db.fees!=="object" || Array.isArray(db.fees)) db.fees={};
  if(!db.fees.byPeriod || typeof db.fees.byPeriod!=="object" || Array.isArray(db.fees.byPeriod)) db.fees.byPeriod={};
  if(!db.fees.legacy || typeof db.fees.legacy!=="object" || Array.isArray(db.fees.legacy)) db.fees.legacy={ECDE:{},Primary:{},Junior:{}};
  if(!db.timetableMeta || typeof db.timetableMeta!=="object") db.timetableMeta={version:3};
  if(!db.academicPeriods.length) db.academicPeriods.push({year:String(db.settings.year),term:db.settings.term,status:"Open"});
  return db;
}

async function cloudSave(force=false){
  if(!cloud||!cloudUser){return false}
  if(cloudSyncBusy){cloudSavePending=true;return false}
  cloudSyncBusy=true;
  try{
    const {data:remote,error:readError}=await cloud.from("school_state_shared").select("id,data,updated_at").eq("id",SHARED_STATE_ID).maybeSingle();
    if(readError)throw readError;
    const server=remote?.data;
    const merged=sanitizeCloudDb(server ? mergeSharedData(server,db,cloudBaseDb) : db);
    const stamp=new Date().toISOString();
    const {error}=await cloud.from("school_state_shared").upsert({id:SHARED_STATE_ID,data:merged,updated_at:stamp},{onConflict:"id"});
    if(error)throw error;
    db=merged;
    cloudBaseDb=cloneDb(merged);
    cloudLastUpdatedAt=new Date(stamp).getTime();
    localStorage.setItem(KEY,JSON.stringify(db));
    return true;
  }catch(e){
    console.error(e);
    if(force)toast("Cloud save failed: "+(e.message||e));
    return false;
  }finally{
    cloudSyncBusy=false;
    if(cloudSavePending){cloudSavePending=false;cloudSave(false)}
  }
}

async function cloudRefresh(){
  if(!cloud||!cloudUser||cloudSyncBusy)return;
  const {data,error}=await cloud.from("school_state_shared").select("data,updated_at").eq("id",SHARED_STATE_ID).maybeSingle();
  if(error){console.error(error);return}
  const remoteTime=new Date(data?.updated_at||0).getTime()||0;
  if(data?.data && remoteTime>cloudLastUpdatedAt){
    db=sanitizeCloudDb(data.data);
    normalizeDbShape();
    if(!Array.isArray(db.learners)) db.learners=[];
    if(!Array.isArray(db.teachers)) db.teachers=[];
    if(!Array.isArray(db.teacherLoads)) db.teacherLoads=[];
    if(!Array.isArray(db.payments)) db.payments=[];
    if(!Array.isArray(db.marks)) db.marks=[];
    if(!Array.isArray(db.attendance)) db.attendance=[];
    if(!Array.isArray(db.timetable)) db.timetable=[];
    if(!Array.isArray(db.exams)) db.exams=[];
    if(!Array.isArray(db.audit)) db.audit=[];
    cloudBaseDb=cloneDb(db);
    cloudLastUpdatedAt=remoteTime;
    localStorage.setItem(KEY,JSON.stringify(db));
    if(typeof currentPage!=="undefined" && currentPage)show(currentPage);
    toast("Updated data received from another teacher");
  }
}
function startCloudRefresh(){
  stopCloudRefresh();
  cloudRefreshTimer=setInterval(cloudRefresh,5000);
}
function stopCloudRefresh(){
  if(cloudRefreshTimer){clearInterval(cloudRefreshTimer);cloudRefreshTimer=null}
}
function save(){
  localStorage.setItem(KEY,JSON.stringify(db));
  if(cloudReady)cloudSave(false);
}
function cloudStatusText(){
  if(!cloudConfigured()) return "Local browser storage — Supabase is not configured.";
  if(cloudReady) return "☁️ Connected — shared Kapnanda database is active.";
  return "☁️ Supabase configured — sign in to use the shared database.";
}
async function cloudLogout(){
  stopCloudRefresh();
  if(cloud)await cloud.auth.signOut();
  cloudReady=false;cloudUser=null;cloudBaseDb=null;cloudLastUpdatedAt=0;
}
/* ---------- End Supabase shared cloud connection ---------- */

const KEY="kapnanda_sms_v1";
const classes=["PP1","PP2","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6","Grade 7","Grade 8","Grade 9"];
const ecde=["PP1","PP2"], lower=["Grade 1","Grade 2","Grade 3"], upper=["Grade 4","Grade 5","Grade 6"], junior=["Grade 7","Grade 8","Grade 9"];
const days=["Monday","Tuesday","Wednesday","Thursday","Friday"];
const defaultSubjects={
PP1:["Language Activities","Mathematical Activities","Environmental Activities","Creative Activities"],
PP2:["Language Activities","Mathematical Activities","Environmental Activities","Creative Activities"],
"Grade 1":["English","Kiswahili","Mathematics","Environmental Activities","Creative Arts","Religious Education"],
"Grade 2":["English","Kiswahili","Mathematics","Environmental Activities","Creative Arts","Religious Education"],
"Grade 3":["English","Kiswahili","Mathematics","Environmental Activities","Creative Arts","Religious Education"],
"Grade 4":["English","Kiswahili","Mathematics","Science & Technology","Agriculture","Social Studies","Creative Arts & Sports","Religious Education"],
"Grade 5":["English","Kiswahili","Mathematics","Science & Technology","Agriculture","Social Studies","Creative Arts & Sports","Religious Education"],
"Grade 6":["English","Kiswahili","Mathematics","Science & Technology","Agriculture","Social Studies","Creative Arts & Sports","Religious Education"],
"Grade 7":["English","Kiswahili","Mathematics","Integrated Science","Agriculture","Social Studies","Creative Arts & Sports","Pre-Technical Studies","Religious Education"],
"Grade 8":["English","Kiswahili","Mathematics","Integrated Science","Agriculture","Social Studies","Creative Arts & Sports","Pre-Technical Studies","Religious Education"],
"Grade 9":["English","Kiswahili","Mathematics","Integrated Science","Agriculture","Social Studies","Creative Arts & Sports","Pre-Technical Studies","Religious Education"]
};
const defaultFreq={Mathematics:5,English:5,"Integrated Science":5,Kiswahili:4,Agriculture:4,"Social Studies":4,"Creative Arts & Sports":4,"Pre-Technical Studies":4,"Religious Education":4,"Science & Technology":5};
let db=JSON.parse(localStorage.getItem(KEY)||"null");
if(!db) db={settings:{school:"Kapnanda Comprehensive School",motto:"Hardwork Pays",term:"Term 3",year:"2026",phone:"",email:"",initialPasswordChanged:false},learners:[],teachers:[],teacherLoads:[],payments:[],marks:[],exams:[{id:"EX1",name:"Term 3 Assessment 2026",type:"End Term",term:"Term 3",year:"2026"}],attendance:[],timetable:[],subjects:JSON.parse(JSON.stringify(defaultSubjects)),subjectConfigs:{},fees:{byPeriod:{},legacy:{ECDE:{PP1:0,PP2:0},Primary:{},Junior:{}}},audit:[],academicPeriods:[{year:"2026",term:"Term 3",status:"Open"}],questionPapers:[]};
if(!db.subjectConfigs) db.subjectConfigs={};
if(!db.fees) db.fees={};
if(!Array.isArray(db.teacherLoads)) db.teacherLoads=[];
if(!Array.isArray(db.learners)) db.learners=[];
if(!Array.isArray(db.teachers)) db.teachers=[];
if(!Array.isArray(db.payments)) db.payments=[];
if(!Array.isArray(db.marks)) db.marks=[];
if(!Array.isArray(db.attendance)) db.attendance=[];
if(!Array.isArray(db.timetable)) db.timetable=[];
if(!Array.isArray(db.exams)) db.exams=[];
if(!Array.isArray(db.audit)) db.audit=[];
// Preserve V1 fee values before introducing the new by-period structure.
if(!db.fees.byPeriod && (db.fees.ECDE||db.fees.Primary||db.fees.Junior)) db.fees.legacy={ECDE:{...(db.fees.ECDE||{})},Primary:{...(db.fees.Primary||{})},Junior:{...(db.fees.Junior||{})}};
if(!db.fees.byPeriod) db.fees.byPeriod={};
if(!db.fees.legacy) db.fees.legacy={ECDE:{},Primary:{},Junior:{}};
if(!db.academicPeriods) db.academicPeriods=[];
const legacySubjects=db.subjects||{};
function periodKey(year=db.settings.year,term=db.settings.term){return `${year}|${term}`}
function ensurePeriodConfig(year=db.settings.year,term=db.settings.term){
 const k=periodKey(year,term); if(!db.subjectConfigs[k]) db.subjectConfigs[k]={};
 for(const c of classes) if(!db.subjectConfigs[k][c]) db.subjectConfigs[k][c]=(legacySubjects[c]||defaultSubjects[c]||[]).map(name=>({name,active:true,weeklyLessons:defaultFreq[name]||4,doubleLesson:["Mathematics","English","Kiswahili","Integrated Science","Creative Arts & Sports"].includes(name)}));
 if(!db.fees.byPeriod[k]){db.fees.byPeriod[k]={};for(const c of classes){const sec=ecde.includes(c)?"ECDE":junior.includes(c)?"Junior":"Primary";db.fees.byPeriod[k][c]=Number(db.fees.legacy?.[sec]?.[c]||0)}}
 return k;
}
if(!db.academicPeriods.some(x=>String(x.year)===String(db.settings.year)&&x.term===db.settings.term)) db.academicPeriods.push({year:String(db.settings.year),term:db.settings.term,status:"Open"});
normalizeDbShape();
ensurePeriodConfig();
function subjectsForPeriod(c,year=db.settings.year,term=db.settings.term){const k=ensurePeriodConfig(year,term);return (db.subjectConfigs[k]?.[c]||[]).filter(x=>x.active).map(x=>x.name)}
function subjectRecordsFor(c,year=db.settings.year,term=db.settings.term){const k=ensurePeriodConfig(year,term);return db.subjectConfigs[k]?.[c]||[]}
localStorage.setItem(KEY,JSON.stringify(db));
let currentUser=null;

function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function toast(x){const t=document.getElementById("toast");t.textContent=x;t.style.display="block";setTimeout(()=>t.style.display="none",2300)}
function field(label,name,value="",type="text",opts=[]){return `<div class="field"><label>${label}</label>${type==="select"?`<select id="f_${name}">${opts.map(o=>`<option value="${esc(o)}" ${String(o)===String(value)?"selected":""}>${esc(o)}</option>`).join("")}</select>`:`<input id="f_${name}" type="${type}" value="${esc(value)}">`}</div>`}
function v(n){return document.getElementById("f_"+n)?.value||""}
function openModal(h){document.getElementById("modalBody").innerHTML=h;document.getElementById("modal").classList.remove("hidden")}
function closeModal(){document.getElementById("modal").classList.add("hidden")}
function audit(action){
  // Ask for the staff member responsible for each audited change.
  // Keep the authenticated account separately so entries remain traceable.
  let teacherName=window.prompt("Enter the full name of the teacher/staff member responsible for this action:");
  teacherName=(teacherName||"").trim();
  db.audit.unshift({
    id:uid("AU"),
    user:currentUser?.username||cloudUser?.email||"system",
    teacherName:teacherName||"NAME NOT PROVIDED",
    action:String(action||"System action"),
    date:new Date().toISOString()
  });
  db.audit=db.audit.slice(0,1000);
  save();
}
function grade(m){m=Number(m);if(m>=41)return"EE1";if(m>=36)return"EE2";if(m>=31)return"ME1";if(m>=25)return"ME2";if(m>=21)return"AE1";if(m>=15)return"AE2";if(m>=6)return"BE1";return"BE2"}
function subjectsFor(c){return subjectsForPeriod(c,db.settings.year,db.settings.term)}
function section(c){return ecde.includes(c)?"ECDE":junior.includes(c)?"Junior":"Primary"}
function feeFor(c,year=db.settings.year,term=db.settings.term){let k=ensurePeriodConfig(year,term);return Number(db.fees.byPeriod[k]?.[c]||0)}
async function login(){
 const email=document.getElementById("loginUser").value.trim(),password=document.getElementById("loginPass").value;
 if(!cloudConfigured()){toast("Supabase is not configured. Use Configure / Change Connection first.");return}
 if(!email||!password){toast("Enter your Supabase email and password");return}
 const r=await cloudLogin(email,password);
 if(r.error){toast(r.error);return}
 cloudReady=true;
 await cloudLoad();
 startCloudRefresh();
 currentUser={username:cloudUser.email||email,role:"Authenticated User",id:cloudUser.id};
 document.getElementById("login").classList.add("hidden");
 document.getElementById("app").classList.remove("hidden");
 audit("Logged in via Supabase");
 show("Dashboard");
}

async function logout(){audit("Logged out");await cloudLogout();currentUser=null;document.getElementById("app").classList.add("hidden");document.getElementById("login").classList.remove("hidden");document.getElementById("loginPass").value=""}
function forgot(){
  if(!cloudConfigured()){toast("Configure Supabase first");return}
  openModal(`<h2>Password Recovery</h2><p>Enter your Supabase Auth email. Supabase will send a secure password-reset link.</p>${field("Supabase email","recoveryEmail",cloudUser?.email||"")}<div class="toolbar"><button onclick="sendPasswordReset()">Send Reset Email</button><button class="secondary" onclick="closeModal()">Cancel</button></div><p class="small">No password or OTP is stored in this website.</p>`);
}
async function sendPasswordReset(){
  const email=v("recoveryEmail").trim();
  if(!email){toast("Enter your email");return}
  if(!cloud||!initCloud()){toast("Supabase is not configured");return}
  const {error}=await cloud.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname});
  if(error){toast("Reset email failed: "+error.message);return}
  closeModal();toast("Password reset email sent");
}
async function openRecoveryPassword(){
  openModal(`<h2>Set New Password</h2><p>Choose a new Supabase Auth password.</p>${field("New password","np","","password")}${field("Confirm password","cp","","password")}<div class="toolbar"><button onclick="saveRecoveryPassword()">Update Password</button></div>`);
}
async function saveRecoveryPassword(){
  const a=v("np"),b=v("cp");
  if(a.length<8||a!==b){toast("Password must be 8+ characters and match");return}
  const {error}=await cloud.auth.updateUser({password:a});
  if(error){toast("Password update failed: "+error.message);return}
  closeModal();toast("Password updated successfully");
}
function securitySetup(first=false){
  const email=cloudUser?.email||document.getElementById("loginUser")?.value||"";
  openModal(`<h2>${first?"First Login Security Setup":"Security Settings"}</h2><p>Your login is managed securely by Supabase Authentication. Passwords are never stored in the school database.</p>${field("Supabase Auth email","un",email)}${field("New password","np","","password")}${field("Confirm password","cp","","password")}${field("Recovery phone (optional)","phone",db.settings.phone||"")}<div class="toolbar"><button onclick="saveSecurity(${first})">Save Security Settings</button>${!first?'<button class="secondary" onclick="closeModal()">Cancel</button>':""}</div>`);
}
async function saveSecurity(first){
  const email=v("un").trim(),a=v("np"),b=v("cp"),ph=v("phone");
  if(!email||a.length<8||a!==b){toast("Enter a valid email and an 8+ character matching password");return}
  if(!cloud||!cloudUser){toast("You must be signed in to Supabase");return}
  const changes={password:a};
  if(email!==cloudUser.email)changes.email=email;
  const {data,error}=await cloud.auth.updateUser(changes);
  if(error){toast("Security update failed: "+error.message);return}
  db.settings.phone=ph;
  db.settings.initialPasswordChanged=true;
  save();
  audit("Security settings changed");
  closeModal();
  toast(email!==cloudUser.email?"Security saved. Check your new email to confirm the address.":"Security settings saved");
  if(first)show("Dashboard");
}

let currentPage="Dashboard";
function show(page){
  currentPage=page;
  try{
    normalizeDbShape();
    document.getElementById("pageTitle").textContent=page;
    document.querySelectorAll(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
    document.getElementById("period").textContent=`${db.settings.term}, ${db.settings.year} • ${db.settings.school}`;
    window.scrollTo(0,0);
    const pages={Dashboard:dashboard,Learners,Teachers,Marks,Exams,QuestionPapers,Rankings,Attendance,Reports,Performance,Fees,Capitation,Timetable,Subjects,Settings};
    (pages[page]||dashboard)();
  }catch(err){
    console.error("Kapnanda page error:",err);
    const content=document.getElementById("content");
    if(content)content.innerHTML=`<div class="card error-card"><h2>Page could not load</h2><p>The website is signed in, but an application error stopped this page from rendering.</p><p class="small">${esc(err?.message||String(err))}</p><button onclick="location.reload()">Reload Website</button></div>`;
  }
}
function stat(a,b,c){return `<div class="card stat"><h3>${c} ${a}</h3><div class="num">${b}</div></div>`}
function dashboard(){
  normalizeDbShape();
  let paid=db.payments.filter(p=>p.term===db.settings.term&&String(p.year)===String(db.settings.year)).reduce((a,b)=>a+Number(b.amount||0),0),expected=db.learners.reduce((a,l)=>a+feeFor(l.class),0);
  document.getElementById("content").innerHTML=`<div class="grid">${stat("Learners",db.learners.length,"👨‍🎓")}${stat("ECDE",db.learners.filter(l=>ecde.includes(l.class)).length,"🌱")}${stat("Primary",db.learners.filter(l=>!ecde.includes(l.class)&&!junior.includes(l.class)).length,"📚")}${stat("Junior",db.learners.filter(l=>junior.includes(l.class)).length,"🎓")}</div><div class="grid">${stat("Teachers",db.teachers.length,"👩‍🏫")}${stat("Fees Collected","KSh "+paid.toLocaleString(),"💰")}${stat("Outstanding","KSh "+Math.max(expected-paid,0).toLocaleString(),"📌")}${stat("Current Term",db.settings.term,"🗓️")}</div><div class="two"><div class="card"><h2>Learners by Class</h2><div class="chartbox"><canvas id="classChart"></canvas></div></div><div class="card"><h2>Fee Status</h2><div class="chartbox"><canvas id="feeChart"></canvas></div></div></div><div class="card"><h2>Quick Actions</h2><div class="toolbar"><button onclick="show('Learners')">Add Learner</button><button onclick="show('Marks')">Enter Marks</button><button onclick="show('Fees')">Record Fees</button><button onclick="show('Timetable')">Generate Timetable</button><button onclick="show('Reports')">Generate Report</button><button onclick="show('Settings')">Security</button></div></div>`;
  // Chart.js is optional. If its CDN is blocked, the Dashboard still renders.
  if(typeof Chart!=="undefined"){
    const classCanvas=document.getElementById("classChart"),feeCanvas=document.getElementById("feeChart");
    if(classCanvas)new Chart(classCanvas,{type:"bar",data:{labels:classes,datasets:[{label:"Learners",data:classes.map(c=>db.learners.filter(l=>l.class===c).length)}]},options:{responsive:true,maintainAspectRatio:false}});
    if(feeCanvas)new Chart(feeCanvas,{type:"doughnut",data:{labels:["Collected","Outstanding"],datasets:[{data:[paid,Math.max(expected-paid,0)]}]},options:{responsive:true,maintainAspectRatio:false}});
  }
}

function admissionPrefixForClass(className){return junior.includes(className)?"KJ":"KP"}
function nextAdmissionNumber(className){
  const prefix=admissionPrefixForClass(className);
  const max=db.learners.reduce((n,l)=>{const m=String(l.adm||"").trim().match(new RegExp("^"+prefix+"(\\d+)$","i"));return m?Math.max(n,Number(m[1])||0):n},0);
  return prefix+String(max+1).padStart(3,"0");
}
function normalizeLearnerName(name){return String(name||"").trim().replace(/\s+/g," ").toLocaleUpperCase()}
function normalizeCsvHeader(value){return String(value||"").replace(/^\uFEFF/,"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"")}
function parseLearnerCsv(text){
  const rows=[];let row=[],cell="",quoted=false; text=String(text||"").replace(/^\uFEFF/,"");
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"'){quoted=false}else{cell+=ch}}
    else if(ch==='"'){quoted=true}
    else if(ch===","){row.push(cell);cell=""}
    else if(ch==="\n"){row.push(cell);rows.push(row);row=[];cell=""}
    else if(ch!=="\r"){cell+=ch}
  }
  if(cell.length||row.length){row.push(cell);rows.push(row)}
  const useful=rows.filter(r=>r.some(c=>String(c||"").trim()!==""));
  if(useful.length<2)throw new Error("The CSV does not contain any learner rows.");
  const headers=useful[0].map(normalizeCsvHeader);
  const indexFor=(aliases)=>headers.findIndex(h=>aliases.includes(h));
  const ai=indexFor(["admission_number","admission_no","admission","adm"]);
  const ni=indexFor(["learner_name","full_name","name","learner"]);
  const ci=indexFor(["grade","class","class_name"]);
  const si=indexFor(["assessment_number","assessment_no","assessmentno","knec_assessment_number","knec_number"]);
  if(ai<0||ni<0||ci<0)throw new Error("Required CSV columns: admission_number, learner_name, grade. The assessment_number column is optional.");
  return useful.slice(1).map((r,i)=>{
    const val=n=>String(r[n]??"").trim();
    const rawClass=val(ci); let className=classes.find(c=>c.toLowerCase()===rawClass.toLowerCase());
    if(!className&&/^grade\s*\d+$/i.test(rawClass)){const n=rawClass.match(/\d+/)[0];className=classes.find(c=>c.toLowerCase()===("grade "+n))}
    if(!className&&/^\d+$/.test(rawClass))className=classes.find(c=>c==="Grade "+rawClass);
    return {rowNumber:i+2,adm:val(ai),name:val(ni),class:className||rawClass,assessmentNo:si>=0?val(si):""};
  }).filter(r=>r.adm||r.name||r.class);
}
let pendingLearnerImport=null;
async function importLearnersCsv(){
  if(!cloudReady||!cloudUser){toast("Sign in to the shared Supabase school database before importing learners");return}
  const picker=document.createElement("input");picker.type="file";picker.accept=".csv,text/csv";
  picker.onchange=async()=>{
    const file=picker.files&&picker.files[0];if(!file)return;
    try{
      const rows=parseLearnerCsv(await file.text());
      const errors=[],seenAdm=new Set(),seenAssessment=new Set(),newRecords=[],existingMatches=[],existingUpdates=[];
      rows.forEach(r=>{
        if(!r.adm||!r.name||!r.class){errors.push(`Row ${r.rowNumber}: admission number, learner name and grade are required.`);return}
        if(!classes.includes(r.class)){errors.push(`Row ${r.rowNumber}: unknown class “${r.class}”.`);return}
        const prefix=admissionPrefixForClass(r.class);
        if(!(new RegExp("^"+prefix+"\\d{3,}$","i")).test(r.adm)){errors.push(`Row ${r.rowNumber}: ${r.class} admission number must use ${prefix} followed by at least three digits (for example ${prefix}001).`);return}
        const admKey=r.adm.toUpperCase(),assessKey=r.assessmentNo.toUpperCase();
        if(seenAdm.has(admKey)){errors.push(`Row ${r.rowNumber}: duplicate admission number ${r.adm} in this file.`);return}
        if(assessKey&&seenAssessment.has(assessKey)){errors.push(`Row ${r.rowNumber}: duplicate assessment number ${r.assessmentNo} in this file.`);return}
        seenAdm.add(admKey);if(assessKey)seenAssessment.add(assessKey);
        const normName=normalizeLearnerName(r.name);
        const sameAdm=db.learners.find(l=>String(l.adm||"").toUpperCase()===admKey);
        const sameAssessment=assessKey?db.learners.find(l=>String(l.assessmentNo||l.assessment_number||l.assessmentNumber||"").toUpperCase()===assessKey):null;
        const sameNameClass=db.learners.find(l=>normalizeLearnerName(l.name)===normName&&l.class===r.class&&l.status!=="Archived");
        if(sameAdm){
          if(normalizeLearnerName(sameAdm.name)!==normName||sameAdm.class!==r.class){errors.push(`Row ${r.rowNumber}: ${r.adm} already belongs to a different learner or grade.`);return}
          if(assessKey&&sameAdm.assessmentNo&&String(sameAdm.assessmentNo).toUpperCase()!==assessKey){errors.push(`Row ${r.rowNumber}: ${r.adm} has a conflicting assessment number in the system.`);return}
          existingMatches.push({learnerId:sameAdm.id,row:r});
          if(assessKey&&!sameAdm.assessmentNo)existingUpdates.push({learnerId:sameAdm.id,assessmentNo:r.assessmentNo});
          return;
        }
        if(sameAssessment||sameNameClass){
          const existing=sameAssessment||sameNameClass;
          errors.push(`Row ${r.rowNumber}: ${r.name} may already exist as ${existing.adm} in ${existing.class}; no records have been imported.`);return;
        }
        newRecords.push({...r,gender:"Not recorded",dob:"",parent:"",phone:"",address:"",status:"Active"});
      });
      if(errors.length){
        pendingLearnerImport=null;
        openModal(`<h2>Import validation failed</h2><p>No learners have been imported. Correct the CSV or resolve these conflicts, then try again.</p><div class="tablewrap" style="max-height:50vh;overflow:auto"><ul>${errors.map(e=>`<li>${esc(e)}</li>`).join("")}</ul></div><div class="toolbar"><button class="secondary" onclick="closeModal()">Close</button></div>`);
        return;
      }
      const counts={};newRecords.forEach(r=>counts[r.class]=(counts[r.class]||0)+1);
      pendingLearnerImport={newRecords,existingMatches,existingUpdates,fileName:file.name};
      const countRows=classes.filter(c=>counts[c]).map(c=>`<tr><td>${esc(c)}</td><td>${counts[c]}</td></tr>`).join("");
      openModal(`<h2>Review Learner Import</h2><p>File: <b>${esc(file.name)}</b></p><p><b>${newRecords.length}</b> new learners will be added. <b>${existingMatches.length}</b> matching records already exist and will not be duplicated.</p>${existingUpdates.length?`<p>${existingUpdates.length} existing records will receive their missing KNEC assessment number.</p>`:""}<div class="tablewrap"><table class="table"><thead><tr><th>Grade</th><th>New learners</th></tr></thead><tbody>${countRows||'<tr><td colspan="2">No new learners to add.</td></tr>'}</tbody></table></div><p class="small">Primary/ECDE learners must use KP numbers; Grades 7–9 must use KJ numbers. The file is processed in this browser and learner records are sent to the authenticated shared database only when you confirm.</p><div class="toolbar"><button class="success" onclick="commitLearnerCsvImport()" ${(!newRecords.length&&!existingUpdates.length)?"disabled":""}>Confirm Import</button><button class="secondary" onclick="pendingLearnerImport=null;closeModal()">Cancel</button></div>`);
    }catch(e){openModal(`<h2>Cannot read CSV</h2><p>${esc(e.message||String(e))}</p><div class="toolbar"><button class="secondary" onclick="closeModal()">Close</button></div>`)}
  };
  picker.click();
}
async function commitLearnerCsvImport(){
  if(!pendingLearnerImport)return;
  if(!cloudReady||!cloudUser){toast("Your Supabase session has expired. Sign in again before importing.");return}
  if(cloudSyncBusy){toast("A cloud sync is already running. Wait a moment and try again.");return}
  const backup=cloneDb(db),batch=pendingLearnerImport;
  try{
    for(const u of batch.existingUpdates){const l=db.learners.find(x=>x.id===u.learnerId);if(l&&!l.assessmentNo)l.assessmentNo=u.assessmentNo}
    for(const r of batch.newRecords){db.learners.push({id:uid("L"),adm:r.adm.trim(),name:r.name.trim(),assessmentNo:r.assessmentNo||"",gender:r.gender,class:r.class,dob:r.dob,parent:r.parent,phone:r.phone,address:r.address,status:"Active"})}
    db.audit.unshift({id:uid("AU"),user:cloudUser.email||"authenticated staff",action:`CSV learner import: ${batch.newRecords.length} added; ${batch.existingMatches.length} already existed`,date:new Date().toISOString()});
    db.audit=db.audit.slice(0,500);
    localStorage.setItem(KEY,JSON.stringify(db));
    const saved=await cloudSave(true);
    if(!saved){db=backup;localStorage.setItem(KEY,JSON.stringify(db));toast("Cloud save failed. No import was kept; check the connection and try again.");return}
    pendingLearnerImport=null;closeModal();show("Learners");
    toast(`Import complete: ${batch.newRecords.length} added; ${batch.existingMatches.length} already existed`);
  }catch(e){db=backup;localStorage.setItem(KEY,JSON.stringify(db));toast("Import failed: "+(e.message||e))}
}
function Learners(){let q=document.getElementById("lq")?.value||"";let rows=db.learners.filter(l=>(l.name+" "+l.adm+" "+l.assessmentNo+" "+l.class).toLowerCase().includes(q.toLowerCase())).map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td>${esc(l.assessmentNo||"")}</td><td>${esc(l.gender||"")}</td><td><span class="badge">${esc(l.class)}</span></td><td>${esc(l.parent||"")}</td><td><button class="light" onclick="learnerForm('${l.id}')">Edit</button> <button class="danger" onclick="archiveLearner('${l.id}')">Archive</button></td></tr>`).join("");document.getElementById("content").innerHTML=`<div class="card"><div class="section-title"><h2>Learner Register</h2><div class="toolbar"><input id="lq" placeholder="Search name/admission/assessment/class" value="${esc(q)}" oninput="Learners()"><button onclick="learnerForm()">+ Add Learner</button><button class="success" onclick="importLearnersCsv()">Import Learners CSV</button><button class="light" onclick="printClassList()">Print Class List</button><button class="success" onclick="marksRegisterForm()">📝 Marks Register</button><button class="warning" onclick="mealRegisterForm()">🍽️ Meals Register</button></div></div><p class="small">New ECDE/primary admissions use KP numbers; Grade 7–9 admissions use KJ numbers. Use the CSV import to add several learners at once.</p><div class="tablewrap"><table class="table"><thead><tr><th>#</th><th>Admission</th><th>Name</th><th>KNEC Assessment No.</th><th>Gender</th><th>Class</th><th>Parent/Guardian</th><th>Actions</th></tr></thead><tbody>${rows||'<tr><td colspan="8">No learners found.</td></tr>'}</tbody></table></div></div>`}
function learnerForm(id=""){
  let x=db.learners.find(a=>a.id===id)||{adm:nextAdmissionNumber("Grade 1"),name:"",assessmentNo:"",gender:"Male",class:"Grade 1",dob:"",parent:"",phone:"",address:""};
  openModal(`<h2>${id?"Edit":"Add"} Learner</h2><div class="formgrid">${field("Admission Number","adm",x.adm)}${field("Full Name","name",x.name)}${field("KNEC Assessment No. (optional)","assessmentNo",x.assessmentNo||"")}${field("Gender","gender",x.gender||"Not recorded","select",["Male","Female","Not recorded"])}${field("Class","class",x.class,"select",classes)}${field("Date of Birth","dob",x.dob,"date")}${field("Parent/Guardian","parent",x.parent)}${field("Phone","phone",x.phone)}${field("Address","address",x.address)}</div><div class="toolbar"><button onclick="saveLearner('${id}')">Save</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`);
  if(!id){const cls=document.getElementById("f_class"),adm=document.getElementById("f_adm");if(cls&&adm)cls.addEventListener("change",()=>{adm.value=nextAdmissionNumber(cls.value)})}
}
function saveLearner(id){
  let adm=v("adm").trim(),name=v("name").trim(),c=v("class"),prefix=admissionPrefixForClass(c);
  if(!adm||!name){toast("Admission number and name are required");return}
  if(db.learners.some(l=>String(l.adm||"").toUpperCase()===adm.toUpperCase()&&l.id!==id)){toast("Admission number already exists");return}
  if(!id&&!(new RegExp("^"+prefix+"\\d{3,}$","i")).test(adm)){toast(`New ${c} admission numbers must begin with ${prefix}, for example ${prefix}001`);return}
  let x={id:id||uid("L"),adm,name,assessmentNo:v("assessmentNo").trim(),gender:v("gender"),class:c,dob:v("dob"),parent:v("parent"),phone:v("phone"),address:v("address"),status:"Active"};
  let i=db.learners.findIndex(l=>l.id===id);if(i>=0)db.learners[i]={...db.learners[i],...x};else db.learners.push(x);
  save();audit(id?"Learner edited":"Learner added");closeModal();Learners();toast("Learner saved")
}
function archiveLearner(id){if(confirm("Archive this learner?")){let l=db.learners.find(x=>x.id===id);if(l)l.status="Archived";save();audit("Learner archived");Learners()}}
function printClassList(){openModal(`<h2>Print Class List</h2>${field("Class","pc","Grade 1","select",classes)}<div class="toolbar"><button onclick="renderClassList()">Generate</button><button class="success" onclick="downloadClassListPDF()">Download A4 PDF</button><button class="light" onclick="printClassListA4()">Print A4</button></div><div id="classListOut"></div>`)}
function classListHTML(c){const ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived");return `<div class="report class-list-print"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>CLASS LIST — ${esc(c)}</p><p>${esc(db.settings.term)}, ${esc(db.settings.year)}</p></div><table class="register-table"><thead><tr><th>No.</th><th>Admission</th><th>Learner Name</th><th>KNEC Assessment No.</th><th>Gender</th><th>Parent/Guardian</th><th>Phone</th></tr></thead><tbody>${ls.map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td>${esc(l.assessmentNo||"")}</td><td>${esc(l.gender||"")}</td><td>${esc(l.parent||"")}</td><td>${esc(l.phone||"")}</td></tr>`).join("")}</tbody></table></div>`}
function renderClassList(){const c=v("pc");document.getElementById("classListOut").innerHTML=classListHTML(c)}
async function downloadClassListPDF(){const c=v("pc");const ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived");if(!ls.length){toast("No learners found in this class");return}await downloadPrintableDocument(classListHTML(c),`${c.replace(/[^a-z0-9]+/gi,"-")}-Class-List-${db.settings.term}-${db.settings.year}.pdf`,"landscape")}
function printClassListA4(){const c=v("pc");const ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived");if(!ls.length){toast("No learners found in this class");return}openPrintableWindow(classListHTML(c),`${c} Class List`,"landscape")}
function Teachers(){let rows=db.teachers.map((t,i)=>`<tr><td>${i+1}</td><td>${esc(t.name)}</td><td>${esc(t.staff)}</td><td>${esc(t.role)}</td><td>${esc(t.subjects)}</td><td>${esc(t.classes)}</td><td>${esc(t.phone)}</td></tr>`).join("");document.getElementById("content").innerHTML=`<div class="card"><div class="section-title"><h2>Teacher Register</h2><button onclick="teacherForm()">+ Add Teacher</button></div><div class="tablewrap"><table class="table"><tr><th>#</th><th>Name</th><th>Staff No.</th><th>Role</th><th>Subjects</th><th>Classes</th><th>Phone</th></tr>${rows||"<tr><td colspan=7>No teachers yet.</td></tr>"}</table></div></div>`}
function teacherForm(){openModal(`<h2>Add Teacher</h2><div class="formgrid">${field("Full Name","name")}${field("Staff Number","staff")}${field("Role","role","Teacher","select",["Teacher","Class Teacher","Headteacher","Deputy Headteacher","ECDE Teacher","Accountant/Bursar"])}${field("Subjects","subjects")}${field("Classes","classes")}${field("Phone","phone")}</div><div class="toolbar"><button onclick="saveTeacher()">Save</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`)}
function saveTeacher(){db.teachers.push({id:uid("T"),no:Math.max(0,...(db.teachers||[]).map(t=>Number(t.no)||0))+1,name:v("name"),staff:v("staff"),role:v("role"),subjects:v("subjects"),classes:v("classes"),phone:v("phone")});save();audit("Teacher added");closeModal();Teachers();toast("Teacher saved")}
function removeTeacherForm(){const opts=(db.teachers||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.no?String(t.no)+" — ":"")}${esc(t.name)}${t.staff?" — "+esc(t.staff):""}</option>`).join("");if(!opts){toast("No teachers to remove");return}openModal(`<h2>Remove Teacher</h2><p class="small">Removing a teacher also removes their teaching assignments and timetable lessons. This cannot be undone.</p><div class="formgrid">${field("Teacher to remove","removeTeacherId","","select",[])}</div><div class="toolbar"><button class="danger" onclick="removeSelectedTeacher()">Remove Teacher</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`);const s=document.getElementById("removeTeacherId");if(s)s.innerHTML=opts}
function removeSelectedTeacher(){const id=v("removeTeacherId");removeTeacher(id)}
function removeTeacher(id){const t=teacherById(id);if(!t){toast("Teacher not found");return}if(!confirm(`Remove ${t.name}? Their teaching assignments and timetable lessons will also be removed.`))return;db.teachers=(db.teachers||[]).filter(x=>x.id!==id);db.teacherLoads=(db.teacherLoads||[]).filter(x=>x.teacherId!==id);db.timetable=(db.timetable||[]).filter(x=>x.teacherId!==id && x.teacher!==t.name);save();audit("Teacher removed: "+t.name);closeModal();Teachers();toast("Teacher removed")}

function Exams(){
  const rows=db.exams.map(e=>`<tr>
    <td><b>${esc(e.name||"")}</b></td>
    <td><span class="badge bright">${esc(e.type||"Other")}</span></td>
    <td>${esc(e.term||"")}</td><td>${esc(String(e.year||""))}</td>
  </tr>`).join("");
  document.getElementById("content").innerHTML=`<div class="card">
    <div class="pagehero">
      <div><h2>Exams & Assessments</h2><p>Create an exam by entering its name and selecting its type. The selected exam name and type are shown throughout Marks, Reports and Rankings.</p></div>
      <span class="badge bright">Assessment Manager</span>
    </div>
    <div class="formgrid">
      ${field("Exam name","en","Mid Term Examination")}
      ${field("Assessment type","etype","Mid term exam","select",["Mid term exam","End term exam","KJSEA analysis","KPSEA analysis","Opener exam","Other"])}
      ${field("Term","et",db.settings.term)}
      ${field("Year","ey",db.settings.year,"number")}
    </div>
    <div class="toolbar" style="margin-top:12px"><button onclick="addExam()">Create Exam</button></div>
    <div class="tablewrap" style="margin-top:15px"><table class="table">
      <tr><th>Exam Name</th><th>Type</th><th>Term</th><th>Year</th></tr>
      ${rows||`<tr><td colspan="4"><div class="empty">No exams created yet.</div></td></tr>`}
    </table></div>
  </div>`;
}
function addExam(){
  const name=v("en").trim(),type=v("etype"),term=v("et"),year=v("ey");
  if(!name){toast("Enter the exam name");return}
  if(!["Mid term exam","End term exam","KJSEA analysis","KPSEA analysis","Opener exam","Other"].includes(type)){toast("Select a valid assessment type");return}
  db.exams.push({id:uid("EX"),name,type,term,year});
  save();audit(`Exam created: ${name} (${type})`);Exams();toast(`${name} created`);
}
function Marks(){let e=db.exams[0]?.id||"",c="Grade 1",s=subjectsFor(c)[0]||"";document.getElementById("content").innerHTML=`<div class="card"><h2>Marks Entry</h2><div class="formgrid">${`<div class="field"><label>Assessment</label><select id="f_mex">${db.exams.map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(e)?"selected":""}>${esc(x.name||x.type||"Assessment")} • ${esc(x.term||"")} ${esc(String(x.year||""))}</option>`).join("")}</select></div>`}${field("Class","mclass",c,"select",classes)}${field("Subject","msub",s,"select",subjectsFor(c))}</div><div class="toolbar"><button onclick="loadMarks()">Load Learners</button><button class="success" onclick="saveMarks()">Save Marks</button><button class="light" onclick="document.getElementById('marksCsvFile').click()">⬆ Upload Marks CSV</button><button class="light" onclick="downloadDedicatedCsvTemplate('marks')">Download Marks CSV Template</button><input id="marksCsvFile" type="file" accept=".csv,text/csv" style="display:none" onchange="uploadMarksCsv(this)"></div><div id="marktable" class="tablewrap" style="margin-top:15px"></div></div>`}
function loadMarks(){let c=v("mclass"),s=v("msub"),e=v("mex"),ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived");document.getElementById("marktable").innerHTML=`<table class="table"><tr><th>Admission</th><th>Learner</th><th>Marks / 50</th><th>Grade</th></tr>${ls.map(l=>{let m=db.marks.find(x=>x.learner===l.id&&x.exam===e&&x.subject===s);return `<tr><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td><input class="markinput" data-id="${l.id}" value="${m?.mark??""}" type="number" min="0" max="50" oninput="this.parentElement.nextElementSibling.textContent=this.value===''?'':grade(this.value)"></td><td>${m?grade(m.mark):""}</td></tr>`}).join("")||"<tr><td colspan=4>No learners.</td></tr>"}</table>`}
function saveMarks(){let e=v("mex"),c=v("mclass"),s=v("msub");document.querySelectorAll(".markinput").forEach(inp=>{let i=db.marks.findIndex(m=>m.learner===inp.dataset.id&&m.exam===e&&m.subject===s),val=inp.value;if(val===""){if(i>=0)db.marks.splice(i,1);return}let o={id:i>=0?db.marks[i].id:uid("M"),learner:inp.dataset.id,class:c,subject:s,exam:e,mark:Number(val)};if(i>=0)db.marks[i]=o;else db.marks.push(o)});save();audit("Marks saved");toast("Marks saved")}
function calcLearner(lid,exam){let l=db.learners.find(x=>x.id===lid),e=db.exams.find(x=>x.id===exam)||{},ss=subjectsForPeriod(l.class,e.year,e.term),vals=db.marks.filter(m=>m.learner===lid&&m.exam===exam&&ss.includes(m.subject)).map(m=>Number(m.mark));let total=vals.reduce((a,b)=>a+b,0),avg=vals.length?total/vals.length:0;return {total,avg,n:vals.length}}
function Rankings(){
  const exam=db.exams.find(x=>String(x.term)===String(db.settings.term)&&String(x.year)===String(db.settings.year))||db.exams[0]||{};
  const c=classes.includes("Grade 7")?"Grade 7":classes[0]||"";
  document.getElementById("content").innerHTML=`<div class="card ranking-page">
    <div class="pagehero"><div><h2>Class Ranking & Exam Analysis</h2><p>One-page A4 class performance summary, grade distribution, subject results and intervention priorities.</p></div><span class="badge">A4 Summary</span></div>
    <div class="formgrid no-print">${field("Assessment","rex",exam.id||"","select",db.exams.map(x=>x.id))}${field("Class","rc",c,"select",classes)}</div>
    <div class="toolbar no-print"><button onclick="renderOverallRanking()">Show Analysis</button><button class="light" onclick="printClassRankingA4()">🖨️ Print Full A4 Ranking</button><button class="success" onclick="downloadRankingPDF()">⬇️ Download Class Ranking (A4 PDF)</button><button class="success" onclick="downloadAllClassRankingsPDF()">⬇️ Download All Class Rankings</button></div>
    <div id="rankout" style="margin-top:15px"></div>
  </div>`;
  renderOverallRanking();
}
function renderOverallRanking(){
  const c=v("rc"),e=v("rex"),ex=db.exams.find(x=>x.id===e)||{};
  const ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived");
  const subjects=subjectsForPeriod(c,ex.year||db.settings.year,ex.term||db.settings.term).slice(0,9);
  const gradeInfo=[
    {code:"EE1",label:"Exceeding Expectations 1",min:41,max:50,color:"#16834a",points:8},
    {code:"EE2",label:"Exceeding Expectations 2",min:36,max:40.999,color:"#3b9b62",points:7},
    {code:"ME1",label:"Meeting Expectations 1",min:31,max:35.999,color:"#9aa91e",points:6},
    {code:"ME2",label:"Meeting Expectations 2",min:25,max:30.999,color:"#d6c51b",points:5},
    {code:"AE1",label:"Approaching Expectations 1",min:21,max:24.999,color:"#d8a52e",points:4},
    {code:"AE2",label:"Approaching Expectations 2",min:15,max:20.999,color:"#d68c3a",points:3},
    {code:"BE1",label:"Below Expectations 1",min:6,max:14.999,color:"#bd8530",points:2},
    {code:"BE2",label:"Below Expectations 2",min:0,max:5.999,color:"#2563eb",points:1}
  ];
  const gradeFor=n=>gradeInfo.find(g=>n>=g.min&&n<=g.max)?.code||"BE2";
  const gradeMeta=code=>gradeInfo.find(g=>g.code===code)||gradeInfo[7];
  const learners=ls.map(l=>{
    const performance=subjects.map(subject=>{const m=db.marks.find(x=>x.learner===l.id&&x.exam===e&&x.subject===subject);const n=m==null||m.mark===""||m.mark==null?null:Number(m.mark);return {subject,mark:Number.isFinite(n)?n:null}});
    const vals=performance.map(x=>x.mark).filter(Number.isFinite),total=vals.reduce((a,b)=>a+b,0),avg=vals.length?total/vals.length:0;
    const points=vals.reduce((sum,n)=>sum+gradeMeta(gradeFor(n)).points,0);
    return {l,performance,total,avg,n:vals.length,points};
  }).filter(x=>x.n>0).sort((a,b)=>b.avg-a.avg||b.total-a.total||String(a.l.name).localeCompare(String(b.l.name)));
  let lastAvg=null,lastRank=0;learners.forEach((x,i)=>{if(lastAvg===null||Math.abs(x.avg-lastAvg)>0.000001){lastRank=i+1;lastAvg=x.avg}x.rank=lastRank;x.grade=gradeFor(x.avg);x.intervention=x.grade==="BE2"?"Intensive support":(["BE1","AE2"].includes(x.grade)?"Priority support":"Maintain progress")});
  const classAvg=learners.length?learners.reduce((a,x)=>a+x.avg,0)/learners.length:0;
  const maxTotal=subjects.length*50,totals=learners.map(x=>x.total),high=totals.length?Math.max(...totals):0,low=totals.length?Math.min(...totals):0;
  const counts=Object.fromEntries(gradeInfo.map(g=>[g.code,learners.filter(x=>x.grade===g.code).length]));
  const gradable=learners.length||0;
  let cursor=0;const colors=gradeInfo.map(g=>{const pct=gradable?counts[g.code]/gradable*100:0;const part=`${g.color} ${cursor}% ${cursor+pct}%`;cursor+=pct;return part}).join(",");
  const distribution=gradeInfo.map(g=>`<tr><td><span class="grade-dot" style="background:${g.color}"></span>${g.code}</td><td>${counts[g.code]}</td><td>${gradable?(counts[g.code]/gradable*100).toFixed(2):"0.00"}%</td><td>${g.label}</td></tr>`).join("");
  const subjectStats=subjects.map(subject=>{const vals=learners.map(l=>l.performance.find(x=>x.subject===subject)?.mark).filter(Number.isFinite);return {subject,avg:vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0,n:vals.length}});
  const shortNames=subjects.map(subject=>subjectCode(subject));
  const rows=learners.map(x=>`<tr><td class="rk-pos">${x.rank}</td><td class="rk-learner">${esc(x.l.name||"")}</td>${x.performance.map(y=>`<td>${y.mark===null?"—":Number(y.mark).toFixed(0)}</td>`).join("")}${Array.from({length:Math.max(0,9-x.performance.length)},()=>"<td>—</td>").join("")}<td class="rk-total">${x.total.toFixed(0)}</td><td>${x.avg.toFixed(2)}</td><td class="rk-grade" style="background:${gradeMeta(x.grade).color};color:${x.grade==="ME1"||x.grade==="ME2"||x.grade==="AE1"?"#172033":"#fff"}">${x.grade}</td><td class="rk-intervention">${x.intervention}</td></tr>`).join("");
  const top=learners[0],subjectBars=subjectStats.map(x=>`<div class="rk-bar-row"><span>${esc(subjectCode(x.subject))}</span><div><i style="width:${Math.max(0,Math.min(100,x.avg/50*100))}%"></i></div><b>${x.avg.toFixed(1)}</b></div>`).join("");
  const interventionGroups=[{code:"AE2",label:"AE2 — Approaching Expectations 2",action:"Targeted remediation, regular progress checks, peer support and focused practice."},{code:"BE1",label:"BE1 — Below Expectations 1",action:"Targeted remediation, regular progress checks, peer support and close monitoring."},{code:"BE2",label:"BE2 — Below Expectations 2",action:"Individual learning plans, focused teacher support, frequent assessment and parent/guardian follow-up."}];
  const interventions=interventionGroups.map(g=>{const n=learners.filter(x=>x.grade===g.code).length;return n?`<tr><td><b>${g.label}</b></td><td>${n}</td><td>${g.action}</td></tr>`:""}).join("");
  const summaryText=gradable?`The class performance is concentrated in ${gradeInfo.filter(g=>counts[g.code]).map(g=>`${g.code} (${counts[g.code]})`).join(", ")}. ${counts.BE2} learner(s) require intensive support; ${counts.BE1+counts.AE2} learner(s) need priority support and follow-up.`:"No learner has marks recorded for this assessment.";
  const scale=gradeInfo.map(g=>`<tr><td><span class="grade-chip" style="background:${g.color}">${g.code}</span></td><td>${g.min===41?"41–50":g.min===36?"36–40":g.min===31?"31–35":g.min===25?"25–30":g.min===21?"21–24.9":g.min===15?"15–20":g.min===6?"6–14":"0–5"}</td><td>${g.label}</td></tr>`).join("");
  document.getElementById("rankout").innerHTML=`<div class="ranking-report ranking-analysis" id="rankingAnalysis">
    <header class="rk-banner"><div class="rk-crest">⚓<small>HARDWORK PAYS</small></div><div class="rk-banner-title"><h1>${esc(schoolTitleForClass(c))}</h1><h2>${esc(c.toUpperCase())} ${esc((ex.term||db.settings.term).toUpperCase())} EXAM ANALYSIS</h2><p>PERFORMANCE SUMMARY • ${learners.length} LEARNERS • ${subjects.length} LEARNING AREAS • MAXIMUM TOTAL ${maxTotal} MARKS</p></div><div class="rk-trophy">🏆</div></header>
    <div class="rk-kpis"><div><span>👥</span><small>LEARNERS</small><b>${learners.length}</b></div><div><span>📚</span><small>SUBJECTS</small><b>${subjects.length}</b></div><div><span>📈</span><small>HIGHEST TOTAL</small><b>${high} / ${maxTotal}</b></div><div><span>📉</span><small>LOWEST TOTAL</small><b>${low} / ${maxTotal}</b></div><div><span>⭐</span><small>HIGHEST SCORE/50</small><b>${top?top.avg.toFixed(2):"0.00"}</b></div><div><span>▦</span><small>CLASS AVG TOTAL</small><b>${classAvg.toFixed(1)}</b></div></div>
    <div class="rk-top-grid"><section class="rk-panel"><h3>GRADE DISTRIBUTION</h3><div class="rk-distribution"><div class="rk-donut" style="background:conic-gradient(${colors||"#e5e7eb 0 100%"})"><div><b>${learners.length}</b><span>LEARNERS</span></div></div><table><thead><tr><th>Grade</th><th>Learners</th><th>%</th><th>Interpretation</th></tr></thead><tbody>${distribution}<tr class="rk-total-row"><td>TOTAL</td><td>${learners.length}</td><td>100%</td><td>Assessed learners</td></tr></tbody></table></div></section><section class="rk-panel rk-scale"><h3>GRADING SCALE (OUT OF 50 MARKS)</h3><table><thead><tr><th>Grade</th><th>Marks</th><th>Interpretation</th></tr></thead><tbody>${scale}</tbody></table></section></div>
    <section class="rk-summary"><b>OVERALL CLASS PERFORMANCE:</b> ${esc(summaryText)}</section>
    <section class="rk-panel rk-learner-panel"><h3>RANKED LEARNER PERFORMANCE TABLE</h3><table class="rk-learner-table"><thead><tr><th>Rank</th><th>Learner</th>${shortNames.map(n=>`<th>${esc(n)}</th>`).join("")}${Array.from({length:Math.max(0,9-shortNames.length)},()=>"<th>—</th>").join("")}<th>Total<br>/${maxTotal}</th><th>Score/50</th><th>Grade</th><th>Intervention</th></tr></thead><tbody>${rows||`<tr><td colspan="15">No marks entered for this class and assessment.</td></tr>`}</tbody></table><p class="rk-footnote">Ranking uses average mark per learning area. Equal averages receive the same rank and the next rank is skipped. Subject abbreviations are shown in the header.</p></section>
    <div class="rk-bottom-grid"><section class="rk-panel"><h3>INTERVENTION PRIORITIES</h3><table><thead><tr><th>Priority group</th><th>Learners</th><th>Recommended action</th></tr></thead><tbody>${interventions||`<tr><td colspan="3">No learners currently fall in the intensive/priority support groups.</td></tr>`}</tbody></table></section><section class="rk-panel rk-notice"><h3>NOTICE BOARD SUMMARY</h3><p>${learners.length} learner(s) were assessed in ${subjects.length} learning areas, with a maximum possible total of ${maxTotal} marks.</p><ul>${gradeInfo.map(g=>`<li><span style="color:${g.color}">●</span> ${counts[g.code]} learner(s) (${gradable?(counts[g.code]/gradable*100).toFixed(2):"0.00"}%) — ${g.code} (${g.label})</li>`).join("")}</ul><b class="rk-message">✓ Key message: Every learner can improve. Use the grade distribution and intervention priorities to plan focused support.</b></section></div>
    <footer class="rk-footer">TOGETHER WE CAN ACHIEVE EXCELLENCE! ★ <span>${esc(db.settings.motto||"Hardwork Pays")}</span> • Generated ${new Date().toLocaleDateString()}</footer>
  </div>`;
}
function rankingA4FitScale(el){
  // Kept for backwards compatibility. Printing/export now uses one physical A4
  // layout with NO zoom or transform, so the browser cannot shrink the report.
  return 1;
}
function rankingPrintStyles(){
  return `
    @page{size:A4 portrait;margin:0}
    *{box-sizing:border-box}
    html,body{margin:0!important;padding:0!important;background:#fff!important}
    body{font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    .print-sheet{width:210mm;height:297mm;margin:0;background:#fff;overflow:hidden;page-break-after:always;break-after:page}
    .print-sheet:last-child{page-break-after:auto;break-after:auto}
    .ranking-analysis{width:210mm!important;height:297mm!important;margin:0!important;padding:3mm!important;box-sizing:border-box!important;overflow:hidden!important;border:1px solid #cbd5e1!important;border-radius:0!important;background:#fff!important;color:#18223c!important;font-size:8px!important;line-height:1.12!important;zoom:1!important;transform:none!important}
    .rk-banner{padding:5px!important;grid-template-columns:15mm 1fr 11mm!important;gap:2mm!important}
    .rk-banner-title h1{font-size:16px!important}.rk-banner-title h2{font-size:13px!important}.rk-banner-title p{font-size:6px!important}
    .rk-crest{font-size:20px!important}.rk-crest small{font-size:4.5px!important}.rk-trophy{font-size:22px!important}
    .rk-kpis{gap:2px!important;margin:3px 0!important}.rk-kpis>div{padding:2px!important}.rk-kpis span{font-size:12px!important}.rk-kpis small{font-size:4.5px!important}.rk-kpis b{font-size:8px!important}
    .rk-panel{margin-bottom:3px!important}.rk-panel h3{font-size:7px!important;padding:2.5px!important}.rk-panel th,.rk-panel td{font-size:5.2px!important;padding:1.4px 2px!important;line-height:1.05!important}
    .rk-distribution{grid-template-columns:24mm minmax(0,1fr)!important;padding:2px!important}.rk-donut{width:18mm!important;height:18mm!important}.rk-donut:before{width:11mm!important;height:11mm!important}.rk-donut b{font-size:13px!important}.rk-donut span{font-size:4.5px!important}
    .rk-summary{font-size:5.6px!important;padding:3px 4px!important;margin:2px 0 3px!important}.rk-learner-table th,.rk-learner-table td{font-size:5px!important;padding:1.2px!important;line-height:1!important}.rk-learner-table td.rk-intervention{font-size:4.4px!important}.rk-footnote{font-size:4.5px!important}.rk-bottom-grid .rk-panel table td{font-size:5px!important}.rk-notice>p{font-size:5px!important}.rk-notice li{font-size:4.4px!important}.rk-message{font-size:4.7px!important;padding:2px!important}.rk-footer{font-size:6.5px!important;padding:3px!important;margin-top:2px!important}
  `;
}

function openRankingPrintWindow(reports,title){
  const w=window.open('','_blank','width=900,height=1200');
  if(!w){toast('Allow pop-ups for printing the class ranking');return false}
  const pages=reports.map((html,i)=>`<section class="print-sheet">${html}</section>`).join('');
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title||'Class Ranking')}</title><style>${rankingPrintStyles()}</style></head><body>${pages}</body></html>`);
  w.document.close();
  const doPrint=()=>{w.focus();w.print();};
  setTimeout(doPrint,500);
  return true;
}

function printClassRankingA4(){
  const report=document.querySelector('#rankout .ranking-analysis');
  if(!report){toast('Generate the class ranking first');return}
  openRankingPrintWindow([report.outerHTML],`Class Ranking - ${v('rc')||'Class'}`);
}

async function renderRankingToPdfPage(report,pdf,firstPage){
  const stage=document.createElement('div');
  stage.className='pdf-export-stage ranking-pdf-stage';
  stage.style.cssText='position:fixed;left:0;top:0;width:794px;height:1123px;overflow:hidden;background:#fff;z-index:2147483000;';
  const clone=report.cloneNode(true);
  clone.removeAttribute('id');
  clone.style.cssText='box-sizing:border-box;width:741px;height:1070px;max-width:none;margin:0 auto;padding:10px;overflow:hidden;zoom:1;transform:none;border:1px solid #cbd5e1;border-radius:4px;font-size:8px;line-height:1.12;background:#fff;color:#18223c;';
  stage.appendChild(clone);
  document.body.appendChild(stage);
  try{
    const canvas=await html2canvas(stage,{scale:2,useCORS:true,backgroundColor:'#ffffff',scrollX:0,scrollY:0,width:794,height:1123,windowWidth:794,windowHeight:1123});
    if(!canvas.width||!canvas.height)throw new Error('Empty ranking canvas');
    if(!firstPage)pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg',.98),'JPEG',0,0,210,297,'FAST');
  }finally{stage.remove()}
}

async function downloadRankingPDF(){
  const report=document.querySelector('#rankout .ranking-analysis');
  if(!report){toast('Generate the class ranking first');return}
  if(typeof html2canvas!=='function'||!window.jspdf?.jsPDF){toast('PDF tools are unavailable. Use Print Full A4 Ranking.');return}
  const exam=db.exams.find(x=>x.id===v('rex'))||{};
  const className=(v('rc')||'class').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase();
  const term=(exam.term||db.settings.term||'term').replace(/[^a-z0-9]+/gi,'-').toLowerCase();
  const {jsPDF}=window.jspdf;const pdf=new jsPDF({unit:'mm',format:'a4',orientation:'portrait',compress:true});
  try{await renderRankingToPdfPage(report,pdf,true);pdf.save(`class-ranking-${className}-${term}-${exam.year||db.settings.year||new Date().getFullYear()}.pdf`);audit('Class ranking A4 PDF downloaded for '+(v('rc')||'class'));toast('Downloaded one-page A4 class ranking');}
  catch(err){console.error(err);toast('PDF generation failed. Use Print Full A4 Ranking.');}
}

async function downloadAllClassRankingsPDF(){
  const examId=v('rex');
  const exam=db.exams.find(x=>x.id===examId)||{};
  const currentClass=v('rc');
  const targetClasses=classes.filter(c=>db.learners.some(l=>l.class===c&&l.status!=='Archived'&&db.marks.some(m=>m.learner===l.id&&m.exam===examId&&subjectsForPeriod(c,exam.year||db.settings.year,exam.term||db.settings.term).includes(m.subject))));
  if(!targetClasses.length){toast('No class has marks for this assessment');return}
  if(typeof html2canvas!=='function'||!window.jspdf?.jsPDF){toast('PDF tools are unavailable');return}
  const {jsPDF}=window.jspdf;const pdf=new jsPDF({unit:'mm',format:'a4',orientation:'portrait',compress:true});
  let first=true,count=0;
  try{
    for(const c of targetClasses){
      const sel=document.getElementById('rc');if(sel)sel.value=c;
      renderOverallRanking();
      const r=document.querySelector('#rankout .ranking-analysis');
      if(!r)continue;
      await renderRankingToPdfPage(r,pdf,first);first=false;count++;
    }
    if(count){
      const term=(exam.term||db.settings.term||'term').replace(/[^a-z0-9]+/gi,'-').toLowerCase();
      pdf.save(`all-class-rankings-${term}-${exam.year||db.settings.year||new Date().getFullYear()}.pdf`);
      audit(`All class rankings A4 PDF downloaded (${count} classes)`);toast(`Downloaded ${count} class ranking list${count===1?'':'s'}`);
    }
  }catch(err){console.error(err);toast('Could not create all-class ranking PDF. Try again or print each class.');}
  finally{const sel=document.getElementById('rc');if(sel&&currentClass)sel.value=currentClass;renderOverallRanking();}
}

function Attendance(){
  const today=new Date().toISOString().slice(0,10);
  const c=document.getElementById("attclass")?.value||"Grade 1";
  const date=document.getElementById("attdate")?.value||today;
  const learners=db.learners.filter(l=>l.class===c&&l.status!=="Archived");
  const statuses={};
  learners.forEach(l=>{const r=db.attendance.find(x=>x.learner===l.id&&x.class===c&&x.date===date);statuses[l.id]=r?.status||"Present"});
  document.getElementById("content").innerHTML=`<div class="card attendance-page">
    <div class="pagehero"><div><h2>Attendance</h2><p>Record daily learner attendance and keep the register synchronized across devices.</p></div><span class="badge bright">Daily Register</span></div>
    <div class="formgrid no-print"><div class="field"><label>Class</label><select id="attclass" onchange="Attendance()">${classes.map(x=>`<option ${x===c?"selected":""}>${esc(x)}</option>`).join("")}</select></div><div class="field"><label>Date</label><input id="attdate" type="date" value="${esc(date)}" onchange="Attendance()"></div></div>
    <div class="attendance-summary no-print"><span class="att-pill present">Present: <b id="attPresent">0</b></span><span class="att-pill absent">Absent: <b id="attAbsent">0</b></span><span class="att-pill late">Late: <b id="attLate">0</b></span></div>
    <div class="toolbar no-print"><button class="success" onclick="saveAttendance()">Save Attendance</button><button class="light" onclick="markAllAttendance('Present')">✓ All Present</button><button class="warning" onclick="markAllAttendance('Late')">◷ All Late</button><button class="danger" onclick="markAllAttendance('Absent')">✕ All Absent</button><button class="light" onclick="window.print()">🖨️ Print Register</button></div>
    <div id="attendanceTable" class="tablewrap" style="margin-top:15px"><table class="table attendance-table"><thead><tr><th>#</th><th>Admission</th><th>Learner</th><th>Class</th><th>Present</th><th>Late</th><th>Absent</th></tr></thead><tbody>${learners.map((l,i)=>{const st=statuses[l.id];return `<tr data-learner="${esc(l.id)}"><td>${i+1}</td><td>${esc(l.adm)}</td><td><b>${esc(l.name)}</b></td><td><span class="badge">${esc(l.class)}</span></td><td><label class="radio-pill"><input type="radio" name="att_${esc(l.id)}" value="Present" ${st==="Present"?"checked":""} onchange="updateAttendanceSummary()"><span>Present</span></label></td><td><label class="radio-pill"><input type="radio" name="att_${esc(l.id)}" value="Late" ${st==="Late"?"checked":""} onchange="updateAttendanceSummary()"><span>Late</span></label></td><td><label class="radio-pill"><input type="radio" name="att_${esc(l.id)}" value="Absent" ${st==="Absent"?"checked":""} onchange="updateAttendanceSummary()"><span>Absent</span></label></td></tr>`}).join("")||`<tr><td colspan="7"><div class="empty">No active learners in ${esc(c)}.</div></td></tr>`}</tbody></table></div>
  </div>`;
  updateAttendanceSummary();
}
function updateAttendanceSummary(){
  let p=0,a=0,l=0;document.querySelectorAll('.attendance-table tbody tr[data-learner]').forEach(row=>{const v=row.querySelector('input[type=radio]:checked')?.value||'Present';if(v==='Present')p++;else if(v==='Absent')a++;else l++;});
  const set=(id,n)=>{const e=document.getElementById(id);if(e)e.textContent=n};set('attPresent',p);set('attAbsent',a);set('attLate',l);
}
function markAllAttendance(status){document.querySelectorAll('.attendance-table tbody tr[data-learner]').forEach(row=>{const id=row.dataset.learner;const input=row.querySelector(`input[value="${status}"]`);if(input)input.checked=true});updateAttendanceSummary()}
function saveAttendance(){
  const c=document.getElementById('attclass')?.value||'Grade 1',date=document.getElementById('attdate')?.value||new Date().toISOString().slice(0,10);
  document.querySelectorAll('.attendance-table tbody tr[data-learner]').forEach(row=>{const id=row.dataset.learner,status=row.querySelector('input[type=radio]:checked')?.value||'Present';const i=db.attendance.findIndex(x=>x.learner===id&&x.class===c&&x.date===date);const rec={id:i>=0?db.attendance[i].id:uid('AT'),learner:id,class:c,date,status};if(i>=0)db.attendance[i]=rec;else db.attendance.push(rec)});
  save();audit(`Attendance saved: ${c} — ${date}`);toast(`Attendance saved for ${c}`);
}
function reportLearners(){
  const classEl=document.getElementById("f_rc");
  const searchEl=document.getElementById("reportSearch");
  const selectedClass=classEl?.value||"";
  const query=(searchEl?.value||"").trim().toLowerCase();
  return (db.learners||[])
    .filter(l=>l && l.status!=="Archived")
    .filter(l=>!selectedClass || l.class===selectedClass)
    .filter(l=>{
      if(!query)return true;
      return String(l.name||"").toLowerCase().includes(query) ||
             String(l.adm||"").toLowerCase().includes(query) ||
             String(l.class||"").toLowerCase().includes(query);
    })
    .sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")));
}
function loadReportLearners(){
 let ls=reportLearners(),sel=document.getElementById("f_rl");
 if(!sel)return;
 let current=sel.value;
 sel.innerHTML='<option value="">— Select learner —</option>'+ls.map(l=>`<option value="${esc(l.id)}">${esc(l.name)} — ${esc(l.adm)} — ${esc(l.class)}</option>`).join("");
 if(ls.some(l=>l.id===current))sel.value=current;
 document.getElementById("reportCount").textContent=ls.length+" learner"+(ls.length===1?"":"s")+" found";
}
function Reports(){
 document.getElementById("content").innerHTML=`<div class="card report-page"><h2>Individual Learner Reports</h2>
 <p class="small">Search by class/grade first, then choose a learner from the complete list. You can also search by learner name or admission number.</p>
 <div class="formgrid">
  ${field("Grade / Class","rc","","select",[""].concat(classes))}
  <div class="field"><label>Search Learner</label><input id="reportSearch" placeholder="Type learner name or admission no." oninput="loadReportLearners()"></div>
  <div class="field"><label>Assessment</label><select id="f_re">${db.exams.map(x=>`<option value="${esc(x.id)}">${esc(x.name||x.id)} • ${esc(x.type||"Other")} — ${esc(x.term||"")} ${esc(String(x.year||""))}</option>`).join("")}</select></div>
 </div>
 <div class="toolbar" style="margin-top:12px">
  <button onclick="loadReportLearners()">🔎 Search / Load Learners</button>
  <button class="light" onclick="clearReportSearch()">Clear</button>
  <span id="reportCount" class="small" style="padding:10px 0"></span>
 </div>
 <div class="field" style="margin-top:12px"><label>Select Learner</label><select id="f_rl"><option value="">— Select learner —</option></select></div>
 <div class="toolbar no-print" style="margin-top:12px"><button onclick="showReport()">Generate Report</button><button class="success" onclick="printAllClassReports()">🖨️ Print All Reports for Class</button><button class="light" onclick="downloadAllClassReportsPDF()">⬇️ Download All Class Reports (PDF)</button></div>
 <p class="small no-print">Bulk print creates one report per learner. Bulk PDF combines the class reports into one PDF file.</p>
 <div id="reportout" style="margin-top:15px"></div><div id="bulkReportStage" class="bulk-report-stage"></div></div>`;
 document.getElementById("f_rc").onchange=loadReportLearners;
 loadReportLearners();
}
function clearReportSearch(){let q=document.getElementById("reportSearch");if(q)q.value="";let c=document.getElementById("f_rc");if(c)c.value="";loadReportLearners()}
async function downloadReportPDF(){
 const target=document.getElementById("reportPdfTarget");
 if(!target){toast("Generate the report first");return}
 const learner=target.querySelector('.prstudent div');
 const name=(learner?.textContent||"learner-report").replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase()||"learner-report";
 const stage=document.createElement("div");
 stage.className="pdf-export-stage pdf-single-report";
 stage.style.cssText="position:fixed!important;left:0!important;top:0!important;width:794px!important;height:1123px!important;overflow:hidden!important;background:#fff!important;z-index:2147483647!important;display:block!important;visibility:visible!important;opacity:1!important;pointer-events:none!important;";
 const clone=target.cloneNode(true);
 clone.removeAttribute("id");
 clone.querySelectorAll(".no-print,.toolbar").forEach(x=>x.remove());
 clone.style.cssText="box-sizing:border-box!important;width:794px!important;min-height:1123px!important;height:1123px!important;max-width:none!important;margin:0!important;padding:28px!important;background:#fff!important;display:block!important;visibility:visible!important;opacity:1!important;color:#172033!important;overflow:hidden!important;";
 stage.appendChild(clone); document.body.appendChild(stage);
 try{
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   if(typeof html2canvas!=="function") throw new Error("html2canvas unavailable");
   const canvas=await html2canvas(clone,{scale:2,useCORS:true,allowTaint:false,backgroundColor:"#ffffff",logging:false,scrollX:0,scrollY:0,width:794,height:1123,windowWidth:794,windowHeight:1123});
   if(!canvas.width||!canvas.height) throw new Error("Empty canvas");
   const PDF=window.jspdf?.jsPDF;
   if(!PDF) throw new Error("jsPDF unavailable");
   const pdf=new PDF({unit:"mm",format:"a4",orientation:"portrait",compress:true});
   pdf.addImage(canvas.toDataURL("image/jpeg",0.98),"JPEG",0,0,210,297,undefined,"FAST");
   pdf.save(name+"-report.pdf");
   toast("Downloaded A4 learner report PDF");
 }catch(err){
   console.error("Learner report PDF error:",err);
   try{ if(typeof html2pdf==="function"){ await html2pdf().set({margin:0,filename:name+"-report.pdf",image:{type:"jpeg",quality:.98},html2canvas:{scale:2,useCORS:true,backgroundColor:"#fff",width:794,height:1123},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"},pagebreak:{mode:["avoid-all"]}}).from(clone).save(); toast("Downloaded A4 learner report PDF"); } else throw err; }
   catch(fallback){toast("PDF generation failed. Use Print A4 and choose Save as PDF.");console.error(fallback)}
 }finally{stage.remove()}
}
function pathwayForSubject(subject){
 const s=String(subject||'').toLowerCase();
 if(/mathematics|integrated science|science|agriculture|pre-technical|technology/.test(s))return 'STEM';
 if(/creative arts|sports|physical|music|art/.test(s))return 'Arts & Sports';
 return 'Social Sciences';
}
function reportPathways(ms){
 const groups={'STEM':[],'Arts & Sports':[],'Social Sciences':[]};
 ms.filter(x=>x.m!==undefined&&x.m!==null&&x.m!=='').forEach(x=>groups[pathwayForSubject(x.s)].push(Number(x.m)));
 const vals=Object.entries(groups).map(([name,a])=>({name,total:a.reduce((s,n)=>s+n,0),max:a.length*50,count:a.length,score:a.length?a.reduce((s,n)=>s+n,0)/(a.length*50)*100:0}));
 const active=vals.filter(x=>x.count).sort((a,b)=>b.score-a.score);
 return {vals, strongest:active[0]||null};
}
function buildLearnerReportHTML(l,e,options={}){
 const ex=db.exams.find(x=>String(x.id)===String(e))||{},ss=subjectsForPeriod(l.class,ex.year,ex.term);
 const ms=ss.map(s=>({s,m:db.marks.find(x=>x.learner===l.id&&String(x.exam)===String(e)&&x.subject===s)?.mark}));
 const vals=ms.filter(x=>x.m!==undefined&&x.m!==null&&x.m!=='').map(x=>Number(x.m)).filter(Number.isFinite),total=vals.reduce((a,b)=>a+b,0),avg=vals.length?total/vals.length:0;
 const classLs=db.learners.filter(x=>x.class===l.class&&x.status!=='Archived');
 const ranked=classLs.map(x=>({id:x.id,...calcLearner(x.id,e)})).filter(x=>x.n>0).sort((a,b)=>b.avg-a.avg||b.total-a.total);
 const idx=ranked.findIndex(x=>x.id===l.id),pos=idx>=0?`${idx+1}/${classLs.length}`:'—';
 const sorted=ms.filter(x=>x.m!==undefined&&x.m!==null&&x.m!=='').sort((a,b)=>Number(b.m)-Number(a.m));
 const strengths=sorted.slice(0,2).map(x=>x.s),weak=sorted.slice(-2).map(x=>x.s);
 const rec=vals.length?`Strongest areas: ${strengths.join(' and ')||'—'}. Areas for continued support: ${weak.join(' and ')||'—'}. ${avg>=35?'Excellent effort; maintain this standard.':avg>=25?'Good progress; keep practising consistently.':'With regular practice and support, improvement is achievable.'}`:'Marks have not yet been entered.';
 const rows=ms.map(x=>`<tr><td>${esc(x.s)}</td><td>${x.m===undefined||x.m===null||x.m===''?'—':Number(x.m).toFixed(1)}</td><td>${x.m===undefined||x.m===null||x.m===''?'—':grade(x.m)}</td></tr>`).join('');
 const paths=reportPathways(ms),pathRows=paths.vals.map(x=>`<div class="pathway-item"><div class="pathway-label"><b>${esc(x.name)}</b><span>${x.count?`${x.total.toFixed(1)}/${x.max} • ${x.score.toFixed(1)}%`:'No marks'}</span></div><div class="pathway-track"><span style="width:${Math.max(0,Math.min(100,x.score))}%"></span></div></div>`).join('');
 const school=esc(db.settings.school||'Kapnanda Comprehensive School'),term=esc(ex.term||db.settings.term),year=esc(String(ex.year||db.settings.year));
 return `<div class="printreport class-bulk-report"><div class="prhead"><div class="prschool">${school}</div><div class="prsubtitle">SCHOOL REPORT</div><div class="prmeta">${term} • ${year} • ${esc(ex.name||ex.type||'Assessment')}</div></div>
 <div class="prstudent"><div><b>LEARNER'S NAME</b><br>${esc(l.name)}</div><div><b>ADMISSION NO.</b><br>${esc(l.adm||'—')}</div><div><b>CLASS</b><br>${esc(l.class)}</div><div><b>ASSESSMENT NO.</b><br>${esc(l.assessmentNo||l.assessment||'—')}</div></div>
 <div class="report-kpis"><div><b>Total Marks</b><strong>${total.toFixed(1)} / ${vals.length*50}</strong></div><div><b>Average</b><strong>${avg.toFixed(1)}%</strong></div><div><b>Total Points</b><strong>${vals.length}</strong></div><div><b>Class Position</b><strong>${pos}</strong></div></div>
 <h3 class="report-section-title">Learning Area Performance</h3><table class="prmarks"><thead><tr><th>Learning Area</th><th>Mark / 50</th><th>Grade</th></tr></thead><tbody>${rows||'<tr><td colspan="3">No subjects configured.</td></tr>'}</tbody></table>
 <h3 class="report-section-title">Pathway Performance Profile</h3><div class="pathway-profile">${pathRows}</div><p class="strong-pathway"><b>Strongest Pathway:</b> ${paths.strongest?`${esc(paths.strongest.name)} (${paths.strongest.score.toFixed(1)}%)`:'Not available — enter marks to calculate.'}</p>
 <div class="prrec"><b>Class Teacher's Comment</b><br>${esc(rec)}</div><div class="prsign"><div>Class Teacher<br>____________________<br>Signature / Date</div><div>Headteacher<br>____________________<br>Signature / Date</div><div>Parent / Guardian<br>____________________<br>Signature / Date</div></div></div>`;
}
function showReport(){
 const l=db.learners.find(x=>x.id===v('rl')),e=v('re');
 if(!l){toast('Select a learner');return}
 document.getElementById('reportout').innerHTML=buildLearnerReportHTML(l,e)+`<div class="toolbar no-print" style="margin-top:10px"><button onclick="downloadReportPDF()">⬇️ Download Report PDF</button><button class="light" onclick="window.print()">🖨️ Print A4 Report</button></div>`;
 const stage=document.getElementById('reportout').querySelector('.printreport');if(stage)stage.id='reportPdfTarget';
}
function selectedClassReportData(){const c=document.getElementById('f_rc')?.value||'',e=document.getElementById('f_re')?.value||'';if(!c){toast('Select a class first');return null}const learners=db.learners.filter(l=>l.class===c&&l.status!=='Archived').sort((a,b)=>String(a.adm||'').localeCompare(String(b.adm||''),undefined,{numeric:true})||String(a.name).localeCompare(String(b.name)));if(!learners.length){toast('No active learners found in this class');return null}return {c,e,learners}}
function makeBulkReportDocument(data){return `<div class="bulk-print-document">${data.learners.map((l,i)=>`<section class="bulk-report-page ${i?'bulk-page-break':''}">${buildLearnerReportHTML(l,data.e)}</section>`).join('')}</div>`}
function printAllClassReports(){const data=selectedClassReportData();if(!data)return;const stage=document.getElementById('bulkReportStage'),home=stage.parentElement;stage.innerHTML=makeBulkReportDocument(data);stage.style.display='block';document.body.appendChild(stage);document.body.classList.add('printing-bulk-reports');audit(`Bulk report print prepared for ${data.c} (${data.learners.length} learners)`);window.print();setTimeout(()=>{document.body.classList.remove('printing-bulk-reports');stage.innerHTML='';stage.style.display='none';home.appendChild(stage)},1000)}
async function downloadAllClassReportsPDF(){
 const data=selectedClassReportData(); if(!data)return;
 const stage=document.getElementById("bulkReportStage"); if(!stage){toast("Report export area is unavailable");return}
 stage.innerHTML=makeBulkReportDocument(data);
 stage.className="bulk-report-stage pdf-export-stage pdf-bulk-reports";
 stage.style.cssText="position:fixed!important;left:0!important;top:0!important;width:794px!important;height:auto!important;min-height:1123px!important;overflow:visible!important;background:#fff!important;z-index:2147483647!important;display:block!important;visibility:visible!important;opacity:1!important;pointer-events:none!important;";
 const pages=Array.from(stage.querySelectorAll(".class-bulk-report"));
 const filename=`${data.c}-${db.settings.term}-${db.settings.year}-all-report-forms.pdf`.replace(/[^a-z0-9._-]+/gi,"-");
 try{
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   if(typeof html2canvas!=="function"||!window.jspdf?.jsPDF)throw new Error("PDF libraries unavailable");
   const PDF=window.jspdf.jsPDF, pdf=new PDF({unit:"mm",format:"a4",orientation:"portrait",compress:true});
   for(let i=0;i<pages.length;i++){
     const page=pages[i];
     page.style.cssText="box-sizing:border-box!important;width:794px!important;height:1123px!important;min-height:1123px!important;max-height:1123px!important;max-width:none!important;margin:0!important;padding:28px!important;background:#fff!important;display:block!important;visibility:visible!important;opacity:1!important;overflow:hidden!important;";
     const canvas=await html2canvas(page,{scale:1.6,useCORS:true,allowTaint:false,backgroundColor:"#fff",logging:false,scrollX:0,scrollY:0,width:794,height:1123,windowWidth:794,windowHeight:1123});
     if(!canvas.width||!canvas.height)throw new Error("Blank report canvas on page "+(i+1));
     if(i)pdf.addPage("a4","portrait");
     pdf.addImage(canvas.toDataURL("image/jpeg",.97),"JPEG",0,0,210,297,undefined,"FAST");
   }
   pdf.save(filename); audit(`Bulk report PDF downloaded for ${data.c} (${data.learners.length} learners)`); toast(`Downloaded ${data.learners.length} A4 report forms`);
 }catch(err){
   console.error("Bulk report PDF error:",err);
   toast("PDF generation failed. Use Print All Reports and choose Save as PDF.");
 }finally{stage.innerHTML="";stage.className="bulk-report-stage";stage.style.cssText="display:none";}
}
function Performance(){
  let e=db.exams.find(x=>String(x.term)===String(db.settings.term)&&String(x.year)===String(db.settings.year))?.id||db.exams[0]?.id||"";
  let data=classes.map(c=>{let a=db.learners.filter(l=>l.class===c&&l.status!=="Archived").map(l=>calcLearner(l.id,e)).filter(x=>x.n);return a.length?a.reduce((sum,x)=>sum+x.avg,0)/a.length:0});
  document.getElementById("content").innerHTML=`<div class="card"><div class="pagehero"><div><h2>School Performance</h2><p>Compare class averages for the selected assessment.</p></div><span class="badge bright">Live Analytics</span></div><div class="chartbox"><canvas id="perf"></canvas></div><div id="perfFallback" class="empty" style="display:none"></div></div>`;
  const canvas=document.getElementById("perf");
  if(typeof Chart!=="undefined"&&canvas){new Chart(canvas,{type:"bar",data:{labels:classes,datasets:[{label:"Average / 50",data}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,max:50}}}})}else{canvas?.remove();const f=document.getElementById("perfFallback");if(f){f.style.display="block";f.textContent="Charts are unavailable right now. Your performance data is still saved and can be viewed in Rankings and Reports."}}
}
function feePeriodPaymentsForLearner(learnerId){
  return db.payments.filter(p=>p.learner===learnerId&&p.term===db.settings.term&&String(p.year)===String(db.settings.year));
}
function feeSectionClasses(sec){return sectionClasses(sec);}
function feeLearnersFor(scope){
  const secFilter=scope.section||"All", cls=scope.className||"All";
  return db.learners.filter(l=>l.status!=="Archived" && (secFilter==="All" || section(l.class)===secFilter) && (cls==="All" || l.class===cls));
}
function feeSummaryForLearners(ls){
  return ls.reduce((a,l)=>{
    const due=feeFor(l.class),paid=feePeriodPaymentsForLearner(l.id).reduce((s,p)=>s+Number(p.amount||0),0);
    a.due+=due;a.paid+=paid;a.balance+=Math.max(due-paid,0);return a;
  },{due:0,paid:0,balance:0});
}
function feeStatus(due,paid){if(paid<=0)return "Not Paid";if(paid<due)return "Partly Paid";if(paid===due)return "Paid";return "Overpaid";}
function sectionTotalsCard(sec){
  const ls=db.learners.filter(l=>l.status!=="Archived"&&section(l.class)===sec),x=feeSummaryForLearners(ls);
  return `<div class="kpi fee-kpi"><b>${esc(sec)}</b><br><span>${ls.length} learners</span><div>Payable: <b>KSh ${x.due.toLocaleString()}</b></div><div>Paid: <b>KSh ${x.paid.toLocaleString()}</b></div><div>Balance: <b>KSh ${x.balance.toLocaleString()}</b></div><button class="light no-print" onclick="downloadFeeRegisterForSection('${sec}')">⬇ ${esc(sec)} Fee List</button></div>`;
}
function Fees(){
  ensurePeriodConfig();
  const sec=document.getElementById("feeSection")?.value||"All", cls=document.getElementById("feeClass")?.value||"All";
  const ls=feeLearnersFor({section:sec,className:cls});
  const rows=ls.map((l,i)=>{
    const ps=feePeriodPaymentsForLearner(l.id),paid=ps.reduce((a,b)=>a+Number(b.amount||0),0),due=feeFor(l.class),bal=Math.max(due-paid,0),last=ps.slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
    return `<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td><b>${esc(l.name)}</b></td><td>${esc(l.class)}</td><td>KSh ${due.toLocaleString()}</td><td>KSh ${paid.toLocaleString()}</td><td>KSh ${bal.toLocaleString()}</td><td><span class="fee-status ${feeStatus(due,paid).toLowerCase().replace(/ /g,'-')}">${feeStatus(due,paid)}</span></td><td>${last?new Date(last.date).toLocaleDateString():"—"}</td><td>${last?esc(last.receipt||last.method||"—"):"—"}</td><td class="no-print"><button onclick="paymentForm('${l.id}')">Record</button> <button class="light" onclick="managePayments('${l.id}')">History</button></td></tr>`;
  }).join("");
  const filterOptions=`<option value="All">All sections</option><option value="ECDE">ECDE</option><option value="Primary">Primary</option><option value="Junior">Junior</option>`;
  const classOptions=`<option value="All">All classes</option>${classes.map(c=>`<option value="${esc(c)}" ${c===cls?"selected":""}>${esc(c)}</option>`).join("")}`;
  document.getElementById("content").innerHTML=`<div class="card fees-page">
    <div class="pagehero"><div><h2>💰 Fees Management</h2><p>Record payments quickly and keep ECDE, Primary and Junior totals separate for ${esc(db.settings.term)}, ${esc(db.settings.year)}.</p></div><span class="badge bright">Term-aware • Shared records</span></div>
    <div class="grid fee-summary-grid">${sectionTotalsCard("ECDE")}${sectionTotalsCard("Primary")}${sectionTotalsCard("Junior")}<div class="kpi fee-kpi"><b>All School</b><br><span>${db.learners.filter(l=>l.status!=="Archived").length} active learners</span><div>Payable: <b>KSh ${feeSummaryForLearners(db.learners.filter(l=>l.status!=="Archived")).due.toLocaleString()}</b></div><div>Paid: <b>KSh ${feeSummaryForLearners(db.learners.filter(l=>l.status!=="Archived")).paid.toLocaleString()}</b></div><div>Balance: <b>KSh ${feeSummaryForLearners(db.learners.filter(l=>l.status!=="Archived")).balance.toLocaleString()}</b></div></div></div>
    <div class="formgrid no-print" style="margin-top:15px"><div class="field"><label>Section</label><select id="feeSection" onchange="Fees()">${filterOptions}</select></div><div class="field"><label>Class</label><select id="feeClass" onchange="Fees()">${classOptions}</select></div><div class="field"><label>Quick search</label><input id="feeSearch" placeholder="Search learner or admission" oninput="filterFeeTable()"></div></div>
    <div class="toolbar no-print" style="margin:15px 0"><button onclick="feeSettings()">Configure Term Fees</button><button class="success" onclick="feeRegisterForm()">⬇ Download Fee List</button><button class="success" onclick="downloadManualFeeRegister()">⬇ Download Blank Manual Fee Register</button><button class="light" onclick="feeCsvForm()">⬇ Download Fee CSV</button><button class="light" onclick="document.getElementById('feesCsvFile').click()">⬆ Upload Fees CSV</button><button class="light" onclick="downloadDedicatedCsvTemplate('fees')">Download Fees CSV Template</button><input id="feesCsvFile" type="file" accept=".csv,text/csv" style="display:none" onchange="uploadFeesCsv(this)"><button class="warning" onclick="printCurrentFeeList()">🖨️ Print Current Fee List</button></div>
    <div class="tablewrap"><table class="table fee-table" id="feeTable"><thead><tr><th>#</th><th>Admission</th><th>Learner</th><th>Class</th><th>Amount Payable</th><th>Amount Paid</th><th>Balance</th><th>Status</th><th>Last Payment</th><th>Receipt/Method</th><th class="no-print">Actions</th></tr></thead><tbody>${rows||'<tr><td colspan="11">No active learners match the selected section/class.</td></tr>'}</tbody></table></div>
    <div class="card fee-register-tools no-print"><h3>📑 Printable Registers</h3><p class="small">Generate clean A4 registers for fee collection, marks recording and meals. Choose the class before generating.</p><div class="toolbar"><button onclick="feeRegisterForm()">Fee Register by Class/Section</button><button onclick="marksRegisterForm()">📝 Marks Recording Class List</button><button onclick="mealRegisterForm()">🍽️ Meals Recording Class List</button></div></div>
  </div>`;
  document.getElementById("feeSection").value=sec;
  document.getElementById("feeClass").value=cls;
}
function filterFeeTable(){const q=(document.getElementById("feeSearch")?.value||"").toLowerCase();document.querySelectorAll("#feeTable tbody tr").forEach(tr=>{tr.style.display=tr.textContent.toLowerCase().includes(q)?"":"none"})}
function feeRegisterForm(){
  openModal(`<h2>Download Fee List</h2><p class="small">Select a whole section or a single class. The printable list includes learner names, amount payable, amount paid, balance, payment status and last payment details.</p><div class="formgrid">${field("Section","frsec","All","select",["All","ECDE","Primary","Junior"])}${field("Class","frclass","All","select",["All"].concat(classes))}</div><div class="toolbar"><button class="success" onclick="downloadFeeRegister()">Download A4 PDF</button><button class="light" onclick="printFeeRegister()">Print A4</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`);
}
function feeRegisterData(sec,cls){return feeLearnersFor({section:sec,className:cls});}
function feeRegisterHTML(sec,cls){
 const ls=feeRegisterData(sec,cls),sum=feeSummaryForLearners(ls),label=cls!=="All"?cls:sec==="All"?"ALL SECTIONS":sec;
 const rows=ls.map((l,i)=>{const ps=feePeriodPaymentsForLearner(l.id),paid=ps.reduce((a,b)=>a+Number(b.amount||0),0),due=feeFor(l.class),bal=Math.max(due-paid,0),last=ps.slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0];return `<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td>${esc(l.class)}</td><td>KSh ${due.toLocaleString()}</td><td>KSh ${paid.toLocaleString()}</td><td>KSh ${bal.toLocaleString()}</td><td>${feeStatus(due,paid)}</td><td>${last?new Date(last.date).toLocaleDateString():"—"}</td><td>${last?esc(last.receipt||last.method||"—"):"—"}</td></tr>`}).join("");
 return `<div class="fee-print-sheet"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>FEE COLLECTION REGISTER — ${esc(label)}</p><p>${esc(db.settings.term)}, ${esc(String(db.settings.year))}</p></div><div class="register-meta"><span>Section/Class: <b>${esc(label)}</b></span><span>Learners: <b>${ls.length}</b></span><span>Payable: <b>KSh ${sum.due.toLocaleString()}</b></span><span>Paid: <b>KSh ${sum.paid.toLocaleString()}</b></span><span>Balance: <b>KSh ${sum.balance.toLocaleString()}</b></span></div><table class="register-table"><thead><tr><th>#</th><th>Admission</th><th>Learner Name</th><th>Class</th><th>Payable</th><th>Paid</th><th>Balance</th><th>Status</th><th>Last Payment</th><th>Receipt / Method</th></tr></thead><tbody>${rows||'<tr><td colspan="10">No learners found.</td></tr>'}</tbody></table><div class="register-sign"><span>Prepared by: __________________</span><span>Signature: __________________</span><span>Date: ____________</span></div></div>`;
}
function downloadFeeRegisterForSection(sec){const html=feeRegisterHTML(sec,"All");downloadPrintableDocument(html,`${sec}-Fee-Register-${db.settings.term}-${db.settings.year}.pdf`,"landscape")}
async function downloadFeeRegister(){const sec=v("frsec")||"All",cls=v("frclass")||"All",ls=feeRegisterData(sec,cls);if(!ls.length){toast("No active learners found for that selection. Choose All sections and All classes, or check Learner Management.");return}const html=feeRegisterHTML(sec,cls);closeModal();await downloadPrintableDocument(html,`${(cls!=="All"?cls:sec)}-Fee-Register-${db.settings.term}-${db.settings.year}.pdf`,"landscape");}
function printFeeRegister(){const sec=v("frsec")||"All",cls=v("frclass")||"All";if(!feeRegisterData(sec,cls).length){toast("No active learners found. Choose All sections and All classes, or check Learner Management.");return}const html=feeRegisterHTML(sec,cls);closeModal();openPrintableWindow(html,`${cls!=="All"?cls:sec} Fee Register`,"landscape")}
function printCurrentFeeList(){const sec=document.getElementById("feeSection")?.value||"All",cls=document.getElementById("feeClass")?.value||"All";if(!feeRegisterData(sec,cls).length){toast("No active learners found. Choose All sections and All classes, or check Learner Management.");return}const html=feeRegisterHTML(sec,cls);openPrintableWindow(html,`${cls!=="All"?cls:sec} Fee List • ${db.settings.term} ${db.settings.year}`,"landscape")}

async function downloadManualFeeRegister(){
  const sec=document.getElementById("feeSection")?.value||"All";
  const cls=document.getElementById("feeClass")?.value||"All";
  const learners=feeRegisterData(sec,cls);
  const dueFor=l=>Number(feeFor(l.class)||0);
  const label=cls!=="All"?cls:(sec==="All"?"All-Sections":sec);
  const rows=learners.map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.adm||"")}</td><td>${esc(l.name||"")}</td><td>${esc(l.class||"")}</td><td>${dueFor(l)||""}</td><td></td><td></td><td></td><td></td></tr>`).join("")||Array.from({length:20},(_,i)=>`<tr><td>${i+1}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join("");
  const html=`<div class="manual-fee-sheet"><header><h1>${esc(db.settings.school||"KAPNANDA COMPREHENSIVE SCHOOL")}</h1><h2>${esc(label)} — ${esc(db.settings.term)} ${esc(String(db.settings.year))} FEE COLLECTION REGISTER</h2><p>Class Teacher: __________________________ &nbsp; Date: __________________</p></header><table><thead><tr><th>No.</th><th>Admission No.</th><th>Learner Name</th><th>Class</th><th>Fee Amount Due (KSh)</th><th>Amount Paid — Month 1</th><th>Amount Paid — Month 2</th><th>Amount Paid — Month 3</th><th>Total Fees Paid (CSV Import)</th></tr></thead><tbody>${rows}</tbody></table><p class="signature">Class Teacher: ____________________ &nbsp; Headteacher: ____________________</p></div>`;
  await downloadPrintableDocument(html,`${label.replace(/[^a-z0-9]+/gi,"-")}-Manual-Fee-Register-${db.settings.term}-${db.settings.year}.pdf`,"landscape");
}

function feeCsvForm(){openModal(`<h2>Download Fee CSV</h2>${field("Section","fcsvsec","All","select",["All","ECDE","Primary","Junior"])}${field("Class","fcsvclass","All","select",["All"].concat(classes))}<div class="toolbar"><button onclick="downloadFeeCsv()">Download CSV</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`)}
function downloadFeeCsv(){const sec=v("fcsvsec")||"All",cls=v("fcsvclass")||"All",ls=feeRegisterData(sec,cls),head=["No","Admission","Learner Name","Class","Amount Payable","Amount Paid","Balance","Status","Last Payment","Receipt/Method"],rows=ls.map((l,i)=>{const ps=feePeriodPaymentsForLearner(l.id),paid=ps.reduce((a,b)=>a+Number(b.amount||0),0),due=feeFor(l.class),last=ps.slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0];return [i+1,l.adm,l.name,l.class,due,paid,Math.max(due-paid,0),feeStatus(due,paid),last?new Date(last.date).toLocaleDateString():"",last?.receipt||last?.method||""]});const csv=[head,...rows].map(r=>r.map(x=>`"${String(x??"").replace(/"/g,'""')}"`).join(",")).join("\n"),a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download=`${cls!=="All"?cls:sec}-Fee-List-${db.settings.term}-${db.settings.year}.csv`;a.click();closeModal();toast("Fee CSV downloaded")}
function registerClassForm(kind){const title=kind==="marks"?"Marks Recording Class List":"Meals Recording Class List";openModal(`<h2>${title}</h2><p class="small">Choose a class to generate a blank A4 register with the learners already enrolled in that class.</p>${field("Class","regclass",classes[0]||"Grade 1","select",classes)}<div class="toolbar"><button class="success" onclick="generateRegister('${kind}')">Generate</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`)}
function marksRegisterForm(){registerClassForm("marks")}
function mealRegisterForm(){registerClassForm("meals")}
function marksRegisterHTML(c){const ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived"),subs=subjectsForPeriod(c,db.settings.year,db.settings.term);return `<div class="marks-register-print"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>CLASS MARKS RECORDING REGISTER</p><p>${esc(c)} • ${esc(db.settings.term)}, ${esc(String(db.settings.year))}</p></div><div class="register-meta"><span>Learners: <b>${ls.length}</b></span><span>Teacher: __________________</span><span>Assessment: __________________</span></div><table class="register-table marks-register-table"><thead><tr><th>No.</th><th>Adm.</th><th>Learner Name</th>${subs.map(s=>`<th>${esc(s)}</th>`).join("")}<th>Total</th><th>Average</th><th>Grade</th></tr></thead><tbody>${ls.map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td>${esc(l.name)}</td>${subs.map(()=>'<td class="blank-cell"></td>').join("")}<td></td><td></td><td></td></tr>`).join("")||`<tr><td colspan="${6+subs.length}">No learners found.</td></tr>`}</tbody></table><div class="register-sign"><span>Teacher: __________________</span><span>Signature: __________________</span><span>Date: ____________</span></div></div>`}
function mealRegisterHTML(c){const ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived");return `<div class="meal-register-print"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>MEALS & TEACHERS WELFARE RECORDING REGISTER</p><p>${esc(c)} • ${esc(db.settings.term)}, ${esc(String(db.settings.year))}</p></div><div class="register-meta"><span>Learners: <b>${ls.length}</b></span><span>Maize: __________________</span><span>Beans: __________________</span><span>Teachers Welfare: __________________</span></div><table class="register-table meal-register-table"><thead><tr><th>No.</th><th>Adm.</th><th>Learner Name</th><th>Maize</th><th>Beans</th><th>Teachers Welfare Meals</th><th>Total / Days</th><th>Remarks</th></tr></thead><tbody>${ls.map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td></td><td></td><td></td><td></td><td></td></tr>`).join("")||'<tr><td colspan="8">No learners found.</td></tr>'}</tbody></table><div class="register-sign"><span>Recorded by: __________________</span><span>Checked by: __________________</span><span>Date: ____________</span></div></div>`}
function generateRegister(kind){const c=v("regclass"),html=kind==="marks"?marksRegisterHTML(c):mealRegisterHTML(c);closeModal();const title=kind==="marks"?`${c} Marks Register`:`${c} Meals Register`;openPrintableWindow(html,title,kind==="marks"?"landscape":"portrait")}
async function downloadPrintableDocument(html,filename,orientation="landscape"){
  // Export content must stay in the normal paint tree and must not inherit the
  // fixed A4-height/overflow-hidden rules used by single-page ranking exports.
  const markup=String(html||"").trim();
  if(!markup || !markup.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim()){
    toast("Nothing to export: the selected document has no content.");return false;
  }
  const stage=document.createElement("div");
  stage.className="pdf-export-content-stage";
  const width=orientation==="landscape"?1120:794;
  stage.style.cssText=`position:absolute!important;left:0!important;top:0!important;width:${width}px!important;height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;max-width:none!important;box-sizing:border-box!important;padding:12px!important;margin:0!important;background:#fff!important;color:#172033!important;z-index:2147483000!important;opacity:1!important;visibility:visible!important;display:block!important;pointer-events:none!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;`;
  stage.innerHTML=markup;
  document.body.appendChild(stage);
  try{
    // Wait for layout, web fonts, and any embedded images before capturing.
    if(document.fonts?.ready) await document.fonts.ready;
    const images=Array.from(stage.querySelectorAll("img"));
    await Promise.all(images.map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=resolve;img.onerror=resolve;setTimeout(resolve,5000)})));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const textContent=(stage.innerText||stage.textContent||"").replace(/\s+/g," ").trim();
    const hasRows=!!stage.querySelector("table tr, .ttable tr, .register-table tr");
    if(!textContent || (!hasRows && stage.children.length===0)) throw new Error("The export area rendered no usable content");
    if(typeof html2pdf!=="function") throw new Error("PDF export library is unavailable");
    const actualWidth=Math.max(width,stage.scrollWidth,stage.getBoundingClientRect().width);
    const actualHeight=Math.max(300,stage.scrollHeight,stage.getBoundingClientRect().height);
    const opts={
      margin:orientation==="landscape"?5:7,
      filename:String(filename||"school-document.pdf"),
      image:{type:"jpeg",quality:.95},
      // A moderate scale avoids Android mobile browsers exhausting canvas memory
      // on long fee registers and multi-class timetable exports.
      html2canvas:{scale:1.15,useCORS:true,allowTaint:false,backgroundColor:"#ffffff",logging:false,scrollX:0,scrollY:0,width:actualWidth,height:actualHeight,windowWidth:actualWidth,windowHeight:actualHeight,foreignObjectRendering:false,onclone:(clonedDoc)=>{const clonedStage=clonedDoc.querySelector(".pdf-export-content-stage");if(clonedStage){clonedStage.style.position="absolute";clonedStage.style.left="0";clonedStage.style.top="0";clonedStage.style.opacity="1";clonedStage.style.visibility="visible";clonedStage.style.display="block";clonedStage.style.overflow="visible";}}},
      jsPDF:{unit:"mm",format:"a4",orientation,compress:true},
      pagebreak:{mode:["css","legacy"],avoid:["tr"]}
    };
    await html2pdf().set(opts).from(stage).save();
    toast("PDF downloaded. Open the file and verify its contents.");
    return true;
  }catch(e){
    console.error("PDF export failed:",e);
    toast("PDF export failed. Opening a print-ready document instead.");
    openPrintableWindow(markup,filename,orientation);
    return false;
  }finally{stage.remove()}
}
function openPrintableWindow(html,title,orientation="portrait"){
 const w=window.open("","_blank");if(!w){toast("Allow pop-ups to print this document");return}
 const styles=Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(x=>`<link rel="stylesheet" href="${x.href}">`).join("");
 w.document.write(`<!doctype html><html><head><title>${esc(title)}</title>${styles}<style>@page{size:A4 ${orientation};margin:${orientation==="landscape"?"5mm":"7mm"}}body{background:#fff!important;margin:0;color:#172033;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.fee-print-sheet,.marks-register-print,.meal-register-print{width:100%;box-sizing:border-box}.register-table{width:100%;border-collapse:collapse}.register-table th,.register-table td{border:1px solid #94a3b8;padding:4px;font-size:9px}.register-table th{background:#2563eb;color:#fff}.marks-register-table th,.marks-register-table td{font-size:7px;padding:3px}.blank-cell{height:25px}.register-meta{display:flex;flex-wrap:wrap;gap:14px;padding:7px 0;font-size:10px}.register-sign{display:flex;justify-content:space-between;gap:15px;margin-top:10px;font-size:9px}.schoolhead{text-align:center}.schoolhead h1{margin:0}.schoolhead p{margin:2px 0}.no-print{display:none!important}</style></head><body>${html}<script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);w.document.close();
}

function paymentForm(id){let l=db.learners.find(x=>x.id===id);openModal(`<h2>Record Fee Payment</h2><p><b>${esc(l.name)}</b> — ${esc(l.class)}</p><p>Period: <b>${esc(db.settings.term)}, ${esc(db.settings.year)}</b> • Due: <b>KSh ${feeFor(l.class).toLocaleString()}</b></p><div class="formgrid">${field("Amount","amount","","number")}${field("Method","method","M-Pesa","select",["M-Pesa","Cash","Bank","Other"])}${field("Receipt Number","receipt",uid("R").toUpperCase())}</div><div class="toolbar"><button onclick="savePayment('${id}')">Save & Receipt</button><button class="secondary" onclick="closeModal()">Cancel</button></div></div>`)}
function savePayment(id){let l=db.learners.find(x=>x.id===id),amount=Number(v("amount"));if(!amount||amount<0){toast("Enter a valid amount");return}db.payments.push({id:uid("P"),learner:id,class:l.class,amount,method:v("method"),receipt:v("receipt"),date:new Date().toISOString(),term:db.settings.term,year:db.settings.year});save();audit("Fee payment recorded");closeModal();Fees();toast("Payment recorded")}
function managePayments(learnerId){let l=db.learners.find(x=>x.id===learnerId),ps=db.payments.filter(p=>p.learner===learnerId&&p.term===db.settings.term&&String(p.year)===String(db.settings.year));let rows=ps.map(p=>`<tr><td>${new Date(p.date).toLocaleDateString()}</td><td>KSh ${Number(p.amount||0).toLocaleString()}</td><td>${esc(p.method||"")}</td><td>${esc(p.receipt||"")}</td><td><button class="light" onclick="editPayment('${p.id}')">Edit</button> <button class="danger" onclick="deletePayment('${p.id}')">Remove</button></td></tr>`).join("");openModal(`<h2>Manage Fees</h2><p><b>${esc(l.name)}</b> — ${esc(l.class)}</p><div class="tablewrap"><table class="table"><tr><th>Date</th><th>Amount</th><th>Method</th><th>Receipt</th><th>Actions</th></tr>${rows||"<tr><td colspan=5>No payments recorded for this period.</td></tr>"}</table></div><div class="toolbar"><button onclick="paymentForm('${learnerId}')">+ Record Payment</button><button class="secondary" onclick="closeModal()">Close</button></div>`)}
function editPayment(id){let p=db.payments.find(x=>x.id===id);if(!p)return;openModal(`<h2>Edit Fee Payment</h2><div class="formgrid">${field("Amount","amount",p.amount,"number")}${field("Method","method",p.method||"M-Pesa","select",["M-Pesa","Cash","Bank","Other"])}${field("Receipt Number","receipt",p.receipt||"")}</div><div class="toolbar"><button onclick="saveEditedPayment('${id}')">Save Changes</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`)}
function saveEditedPayment(id){let p=db.payments.find(x=>x.id===id),amount=Number(v("amount"));if(!p||!amount||amount<0){toast("Enter a valid amount");return}p.amount=amount;p.method=v("method");p.receipt=v("receipt");save();audit("Fee payment edited");closeModal();Fees();toast("Payment updated")}
function deletePayment(id){let p=db.payments.find(x=>x.id===id);if(!p)return;if(confirm(`Remove fee payment of KSh ${Number(p.amount||0).toLocaleString()}? This cannot be undone.`)){let learner=p.learner;db.payments=db.payments.filter(x=>x.id!==id);save();audit("Fee payment removed");Fees();toast("Payment removed")}}
function removeLearnerFromFees(id){let l=db.learners.find(x=>x.id===id);if(!l)return;if(confirm(`Remove ${l.name} from the fee section? The learner will be archived and hidden from active fee records.`)){l.status="Archived";save();audit("Learner removed from fee section");Fees();toast("Learner removed from fee section")}}
function feeSettings(){let inputs=classes.map(c=>field(`${c} fee (KSh)`,`fee_${c}`,feeFor(c),"number")).join("");openModal(`<h2>Fees — ${esc(db.settings.term)}, ${esc(db.settings.year)}</h2><p>Set each class fee for this academic period. Previous periods remain unchanged.</p><div class="formgrid">${inputs}</div><div class="toolbar"><button onclick="saveFees()">Save Current Term Fees</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`)}
function saveFees(){let k=ensurePeriodConfig();for(const c of classes){let el=document.getElementById("f_fee_"+c);if(el)db.fees.byPeriod[k][c]=Math.max(0,Number(el.value||0))}save();audit(`Fee structure changed for ${db.settings.term}, ${db.settings.year}`);closeModal();Fees();toast("Current-term fees saved")}
function Subjects(){ensurePeriodConfig();document.getElementById("content").innerHTML=`<div class="card"><h2>Subject Management</h2><p class="small">Subjects are configurable by academic year and term. Add a subject to one class, a whole section, or all classes. Deactivation hides it from current marks while historical marks remain intact.</p><div class="formgrid">${field("Academic Year","sy",db.settings.year,"number")}${field("Term","st",db.settings.term,"select",["Term 1","Term 2","Term 3"])}${field("Class","sc","Grade 7","select",classes)}</div><div class="toolbar"><button onclick="renderSubjects()">Open Class Subjects</button><button onclick="addSubject()">+ Add Subject</button><button class="light" onclick="subjectCatalog()">Subject Catalog</button></div><div id="subout" style="margin-top:15px"></div></div>`}
function subjectPeriod(){return {year:String(v("sy")||db.settings.year),term:v("st")||db.settings.term}}
function renderSubjects(){let {year,term}=subjectPeriod(),c=v("sc"),arr=subjectRecordsFor(c,year,term);document.getElementById("subout").innerHTML=`<h3>${esc(c)} — ${esc(term)}, ${esc(year)}</h3><table class="table"><tr><th>Subject</th><th>Status</th><th>Weekly Lessons</th><th>Double Lesson</th><th>Action</th></tr>${arr.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.active?'<span class="oktext">Active</span>':'<span class="dangertext">Inactive</span>'}</td><td><input type="number" min="1" max="10" value="${Number(x.weeklyLessons||4)}" style="width:80px" onchange="updateSubjectFreq('${esc(c)}','${esc(x.name)}',this.value,'${esc(year)}','${esc(term)}')"></td><td><input type="checkbox" ${x.doubleLesson?'checked':''} onchange="updateSubjectDouble('${esc(c)}','${esc(x.name)}',this.checked,'${esc(year)}','${esc(term)}')"></td><td>${x.active?`<button class="danger" onclick="toggleSubject('${esc(c)}','${esc(x.name)}',false,'${esc(year)}','${esc(term)}')">Deactivate</button>`:`<button class="success" onclick="toggleSubject('${esc(c)}','${esc(x.name)}',true,'${esc(year)}','${esc(term)}')">Reactivate</button>`}</td></tr>`).join("")||"<tr><td colspan=5>No subjects configured.</td></tr>"}</table>`}
function addSubject(){let {year,term}=subjectPeriod(),c=v("sc");openModal(`<h2>Add Subject</h2><p>Target: <b>${esc(term)}, ${esc(year)}</b></p>${field("Subject name","sn")}${field("Apply to","scope","Selected class","select",["Selected class","All classes","All ECDE classes","All Primary classes","All Junior classes"])}${field("Weekly lessons","sw","4","number")}${field("Double lesson","sd","Yes","select",["Yes","No"])}<div class="toolbar"><button onclick="saveSubject('${esc(c)}','${esc(year)}','${esc(term)}')">Add Subject</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`)}
function applyClasses(scope,c){if(scope==="All classes")return classes;if(scope==="All ECDE classes")return ecde;if(scope==="All Primary classes")return [...lower,...upper];if(scope==="All Junior classes")return junior;return [c]}
function saveSubject(c,year,term){let s=v("sn").trim(),scope=v("scope"),weekly=Math.max(1,Math.min(10,Number(v("sw")||4))),dbl=v("sd")==="Yes";if(!s){toast("Enter a subject name");return}let targets=applyClasses(scope,c),k=ensurePeriodConfig(year,term);for(const cls of targets){let arr=db.subjectConfigs[k][cls],x=arr.find(a=>a.name.toLowerCase()===s.toLowerCase());if(x){x.active=true;x.weeklyLessons=weekly;x.doubleLesson=dbl}else arr.push({name:s,active:true,weeklyLessons:weekly,doubleLesson:dbl})}save();audit(`Subject ${s} configured for ${targets.length} class(es)`);closeModal();renderSubjects();toast(`${s} configured for ${targets.length} class(es)`) }
function toggleSubject(c,s,active,year,term){let x=subjectRecordsFor(c,year,term).find(a=>a.name===s);if(x){x.active=active;save();audit(`Subject ${s} ${active?'reactivated':'deactivated'} for ${c}`);renderSubjects();toast(active?'Subject reactivated':'Subject deactivated')}}
function updateSubjectFreq(c,s,val,year,term){let x=subjectRecordsFor(c,year,term).find(a=>a.name===s);if(x){x.weeklyLessons=Math.max(1,Math.min(10,Number(val||4)));save();audit(`Weekly lessons updated for ${s} in ${c}`)}}
function updateSubjectDouble(c,s,val,year,term){let x=subjectRecordsFor(c,year,term).find(a=>a.name===s);if(x){x.doubleLesson=!!val;save();audit(`Double lesson setting updated for ${s} in ${c}`)}}
function subjectCatalog(){let all=[...new Set(classes.flatMap(c=>subjectRecordsFor(c).map(x=>x.name)))].sort();openModal(`<h2>Subject Catalog</h2><p class="small">Subjects configured in the current academic period.</p><div class="tablewrap"><table class="table"><tr><th>Subject</th><th>ECDE</th><th>Primary</th><th>Junior</th></tr>${all.map(s=>`<tr><td>${esc(s)}</td><td>${ecde.some(c=>subjectsFor(c).includes(s))?'✓':'—'}</td><td>${[...lower,...upper].some(c=>subjectsFor(c).includes(s))?'✓':'—'}</td><td>${junior.some(c=>subjectsFor(c).includes(s))?'✓':'—'}</td></tr>`).join('')}</table></div><button class="secondary" onclick="closeModal()">Close</button>`) }

function Capitation(){
  normalizeDbShape();
  const tx=db.capitationTransactions.filter(x=>String(x.year||db.settings.year)===String(db.settings.year)&&String(x.term||db.settings.term)===String(db.settings.term));
  const received=section=>tx.filter(x=>x.kind==="receipt"&&x.section===section).reduce((s,x)=>s+Number(x.amount||0),0);
  const spent=section=>tx.filter(x=>x.kind==="expense"&&(x.section===section||x.section==="Shared")).reduce((s,x)=>s+Number(x.amount||0),0);
  const total=received("Junior")+received("Primary"),used=spent("Junior")+spent("Primary");
  const budgets=db.bomBudgets.filter(x=>String(x.year||db.settings.year)===String(db.settings.year)&&String(x.term||db.settings.term)===String(db.settings.term));
  const budgetTotal=budgets.reduce((s,x)=>s+Number(x.amount||0),0);
  const budgetRows=budgets.map((b,i)=>`<tr><td>${i+1}</td><td>${esc(b.section)}</td><td>${esc(b.category)}</td><td>${esc(b.description||"")}</td><td>KSh ${Number(b.amount||0).toLocaleString()}</td><td>${esc(b.priority||"Normal")}</td><td class="no-print"><button class="danger" onclick="deleteBomBudget('${b.id}')">Delete</button></td></tr>`).join("");
  const txRows=tx.slice().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))).map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.date||"")}</td><td>${esc(x.kind==="receipt"?"Funds received":"Expenditure")}</td><td>${esc(x.section||"")}</td><td>${esc(x.category||"")}</td><td>${esc(x.description||"")}</td><td>KSh ${Number(x.amount||0).toLocaleString()}</td><td>${esc(x.reference||"")}</td><td class="no-print"><button class="danger" onclick="deleteCapitationTransaction('${x.id}')">Delete</button></td></tr>`).join("");
  document.getElementById("content").innerHTML=`<div class="card"><div class="pagehero"><div><h2>🏦 Capitation & BOM Funds Management</h2><p>Track primary and junior capitation, record expenditure, plan budgets and prepare printable BOM meeting documents.</p></div><span class="badge">A4-ready</span></div>
  <div class="grid"><div class="kpi"><b>Primary funds received</b><h2>KSh ${received("Primary").toLocaleString()}</h2></div><div class="kpi"><b>Junior funds received</b><h2>KSh ${received("Junior").toLocaleString()}</h2></div><div class="kpi"><b>Total received</b><h2>KSh ${total.toLocaleString()}</h2></div><div class="kpi"><b>Budget planned</b><h2>KSh ${budgetTotal.toLocaleString()}</h2></div></div>
  <div class="two"><div class="card"><h3>Record Capitation / Other Funds Received</h3><div class="formgrid"><div class="field"><label>Date received</label><input id="capDate" type="date" value="${new Date().toISOString().slice(0,10)}"></div><div class="field"><label>School section</label><select id="capSection"><option>Primary</option><option>Junior</option><option>Shared</option></select></div><div class="field"><label>Amount received (KSh)</label><input id="capAmount" type="number" min="0.01" step="0.01"></div><div class="field"><label>Reference / bank details</label><input id="capRef"></div></div><div class="field"><label>Description / source</label><input id="capDesc" placeholder="e.g. Term 3 capitation"></div><button onclick="saveCapitationReceipt()">Save Funds Received</button></div>
  <div class="card"><h3>Record Expenditure</h3><div class="formgrid"><div class="field"><label>Date</label><input id="expDate" type="date" value="${new Date().toISOString().slice(0,10)}"></div><div class="field"><label>Section</label><select id="expSection"><option>Primary</option><option>Junior</option><option>Shared</option></select></div><div class="field"><label>Amount (KSh)</label><input id="expAmount" type="number" min="0.01" step="0.01"></div><div class="field"><label>Category</label><select id="expCategory"><option>Teaching and learning</option><option>Repairs and maintenance</option><option>Utilities</option><option>Administration</option><option>Learning materials</option><option>Other</option></select></div></div><div class="field"><label>Description / voucher</label><input id="expDesc"></div><button onclick="saveCapitationExpense()">Save Expenditure</button></div></div>
  <div class="card"><h3>BOM Budget Planner</h3><p class="small">Enter proposed spending lines. The system compares the planned budget with funds received and estimates the remaining amount; it does not authorise expenditure.</p><div class="formgrid"><div class="field"><label>Section</label><select id="budSection"><option>Primary</option><option>Junior</option><option>Shared</option></select></div><div class="field"><label>Budget category</label><select id="budCategory"><option>Teaching and learning</option><option>Repairs and maintenance</option><option>Utilities</option><option>Administration</option><option>Infrastructure</option><option>Other</option></select></div><div class="field"><label>Planned amount (KSh)</label><input id="budAmount" type="number" min="0.01" step="0.01"></div><div class="field"><label>Priority</label><select id="budPriority"><option>High</option><option selected>Normal</option><option>Low</option></select></div></div><div class="field"><label>Purpose / notes</label><input id="budDesc"></div><div class="toolbar"><button onclick="saveBomBudget()">Add Budget Line</button><button class="light" onclick="downloadBomBudgetCSV()">Download Budget CSV</button><button class="light" onclick="printBomMeetingPack()">Print BOM Meeting Pack (A4)</button></div><div class="tablewrap"><table><thead><tr><th>#</th><th>Section</th><th>Category</th><th>Description</th><th>Budget</th><th>Priority</th><th class="no-print">Action</th></tr></thead><tbody>${budgetRows||'<tr><td colspan="7">No budget lines entered yet.</td></tr>'}</tbody></table></div><p><b>Budget planned:</b> KSh ${budgetTotal.toLocaleString()} &nbsp; <b>Funds received:</b> KSh ${total.toLocaleString()} &nbsp; <b>Budget less received:</b> KSh ${(total-budgetTotal).toLocaleString()}</p></div>
  <div class="card"><h3>Funds Ledger</h3><div class="toolbar no-print"><button class="light" onclick="downloadCapitationCSV()">Download Ledger CSV</button><button class="light" onclick="window.print()">Print Page</button></div><div class="tablewrap"><table><thead><tr><th>#</th><th>Date</th><th>Type</th><th>Section</th><th>Category</th><th>Description</th><th>Amount</th><th>Reference</th><th class="no-print">Action</th></tr></thead><tbody>${txRows||'<tr><td colspan="9">No capitation transactions recorded for this period.</td></tr>'}</tbody></table></div></div></div>`;
}
function saveCapitationReceipt(){const amount=Number(v("capAmount"));if(!(amount>0)){toast("Enter a valid amount received");return}db.capitationTransactions.push({id:uid("CAP"),kind:"receipt",date:v("capDate"),section:v("capSection"),amount,category:"Capitation / funds received",description:v("capDesc").trim(),reference:v("capRef").trim(),year:String(db.settings.year),term:db.settings.term,createdAt:new Date().toISOString()});save();audit("Capitation receipt recorded");Capitation();toast("Funds receipt saved")}
function saveCapitationExpense(){const amount=Number(v("expAmount"));if(!(amount>0)){toast("Enter a valid expenditure amount");return}const section=v("expSection");const received=db.capitationTransactions.filter(x=>x.kind==="receipt"&&(x.section===section||x.section==="Shared")&&String(x.year||db.settings.year)===String(db.settings.year)&&String(x.term||db.settings.term)===String(db.settings.term)).reduce((s,x)=>s+Number(x.amount||0),0);const spent=db.capitationTransactions.filter(x=>x.kind==="expense"&&(x.section===section||x.section==="Shared")&&String(x.year||db.settings.year)===String(db.settings.year)&&String(x.term||db.settings.term)===String(db.settings.term)).reduce((s,x)=>s+Number(x.amount||0),0);if(amount>Math.max(0,received-spent)){if(!confirm("This expenditure is greater than the funds currently recorded for this section. Record it anyway?"))return}db.capitationTransactions.push({id:uid("CAP"),kind:"expense",date:v("expDate"),section,amount,category:v("expCategory"),description:v("expDesc").trim(),reference:"",year:String(db.settings.year),term:db.settings.term,createdAt:new Date().toISOString()});save();audit("Capitation expenditure recorded");Capitation();toast("Expenditure saved")}
function saveBomBudget(){const amount=Number(v("budAmount"));if(!(amount>0)){toast("Enter a valid budget amount");return}db.bomBudgets.push({id:uid("BUD"),section:v("budSection"),category:v("budCategory"),amount,priority:v("budPriority"),description:v("budDesc").trim(),year:String(db.settings.year),term:db.settings.term,createdAt:new Date().toISOString()});save();audit("BOM budget line added");Capitation();toast("Budget line added")}
function deleteBomBudget(id){if(!confirm("Delete this budget line?"))return;db.bomBudgets=db.bomBudgets.filter(x=>x.id!==id);save();Capitation()}
function deleteCapitationTransaction(id){if(!confirm("Delete this transaction? Keep the signed voucher / bank record for audit."))return;db.capitationTransactions=db.capitationTransactions.filter(x=>x.id!==id);save();Capitation()}
function downloadCapitationCSV(){const rows=[["Date","Type","Section","Category","Description","Amount","Reference","Term","Year"],...db.capitationTransactions.filter(x=>String(x.year||db.settings.year)===String(db.settings.year)&&String(x.term||db.settings.term)===String(db.settings.term)).map(x=>[x.date,x.kind,x.section,x.category,x.description,x.amount,x.reference,x.term,x.year])];downloadRowsCSV(rows,`capitation-ledger-${db.settings.term}-${db.settings.year}.csv`)}
function downloadBomBudgetCSV(){const rows=[["Section","Category","Description","Amount","Priority","Term","Year"],...db.bomBudgets.filter(x=>String(x.year||db.settings.year)===String(db.settings.year)&&String(x.term||db.settings.term)===String(db.settings.term)).map(x=>[x.section,x.category,x.description,x.amount,x.priority,x.term,x.year])];downloadRowsCSV(rows,`bom-budget-${db.settings.term}-${db.settings.year}.csv`)}
function downloadRowsCSV(rows,name){const csv=rows.map(r=>r.map(x=>`"${String(x??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");const blob=new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
function printBomMeetingPack(){const budgets=db.bomBudgets.filter(x=>String(x.year||db.settings.year)===String(db.settings.year)&&String(x.term||db.settings.term)===String(db.settings.term));const tx=db.capitationTransactions.filter(x=>String(x.year||db.settings.year)===String(db.settings.year)&&String(x.term||db.settings.term)===String(db.settings.term));const agenda=["Opening prayer and welcome","Confirmation of previous minutes","Matters arising","Review of capitation received (Primary and Junior)","Review of expenditure and supporting vouchers","Discussion and approval of proposed budget","Prioritisation of teaching and learning resources","Any other business","Date of next meeting","Adjournment"];const money=n=>"KSh "+Number(n||0).toLocaleString();const budgetRows=budgets.map((b,i)=>`<tr><td>${i+1}</td><td>${esc(b.section)}</td><td>${esc(b.category)}</td><td>${esc(b.description||"")}</td><td>${money(b.amount)}</td></tr>`).join("");const txRows=tx.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.date||"")}</td><td>${esc(x.kind==="receipt"?"Funds received":"Expenditure")}</td><td>${esc(x.section||"")}</td><td>${esc(x.description||x.category||"")}</td><td>${money(x.amount)}</td></tr>`).join("");const html=`<article class="bom-meeting-pack"><header><h1>${esc(db.settings.school)}</h1><h2>BOARD OF MANAGEMENT MEETING</h2><h3>AGENDA, CAPITATION REPORT & PROPOSED BUDGET</h3><p>${esc(db.settings.term)}, ${esc(String(db.settings.year))}</p><p>Date: __________________ &nbsp; Venue: __________________</p></header><h3>Proposed Agenda</h3><ol>${agenda.map(x=>`<li>${esc(x)}</li>`).join("")}</ol><h3>Capitation / Funds Ledger</h3><table><thead><tr><th>#</th><th>Date</th><th>Type</th><th>Section</th><th>Description</th><th>Amount</th></tr></thead><tbody>${txRows||'<tr><td colspan="6">No entries recorded</td></tr>'}</tbody></table><h3>Proposed Budget</h3><table><thead><tr><th>#</th><th>Section</th><th>Category</th><th>Purpose</th><th>Amount</th></tr></thead><tbody>${budgetRows||'<tr><td colspan="5">No budget lines entered</td></tr>'}</tbody></table><h3>Minutes / Resolutions</h3><p>1. _____________________________________________________________________</p><p>2. _____________________________________________________________________</p><p>3. _____________________________________________________________________</p><h3>Signatures</h3><p>Chairperson: __________________________ &nbsp; Secretary: __________________________</p><p>Headteacher: _________________________ &nbsp; Date: __________________</p></article>`;openPrintableWindow(html,"BOM Meeting Pack","portrait")}

function Timetable(){document.getElementById("content").innerHTML=`<div class="card timetable-page"><div class="pagehero no-print"><div><h2>Smart Timetable Generator</h2><p>Separate engines for ECDE, Lower Primary, Upper Primary and Junior. The generator prevents class/teacher double-booking and respects section-specific lesson duration/breaks.</p></div></div><div class="formgrid no-print">${field("Section","ts","Junior","select",["ECDE","Lower Primary","Upper Primary","Junior"])}${field("Class","tc","Grade 7","select",classes)}${field("Teacher","tt","", "select",[""].concat(db.teachers.map(t=>t.name)))}</div><div class="toolbar no-print"><button onclick="generateTimetable()">Generate Class Timetable</button><button class="light" onclick="teacherTimetable()">Teacher Timetable</button><button class="light" onclick="printElement('tout')">Print A4</button></div><div id="tout" style="margin-top:15px"></div></div>`}
function timing(c){if(ecde.includes(c))return {dur:30,start:"08:30",end:"12:40",breaks:[["10:00","10:20"]],lunch:null};if(junior.includes(c))return {dur:40,start:"08:00",end:"15:30",breaks:[["10:00","10:30"],["11:50","12:00"]],lunch:["12:00","13:00"]};return {dur:35,start:"08:00",end:"15:30",breaks:[["09:30","09:50"],["11:00","11:30"]],lunch:["12:40","13:40"]}}
function mins(s){let [h,m]=s.split(":").map(Number);return h*60+m} function hh(n){let h=Math.floor(n/60),m=n%60;return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")}
function makeSlots(c){let t=timing(c),out=[];for(let d of days){let cur=mins(t.start);while(cur+ t.dur<=mins(t.end)){let end=cur+t.dur, blocked=false;for(let b of t.breaks){let bs=mins(b[0]),be=mins(b[1]);if(cur<be&&end>bs)blocked=true}if(t.lunch&&cur<mins(t.lunch[1])&&end>mins(t.lunch[0]))blocked=true;if(!blocked)out.push({day:d,time:`${hh(cur)}–${hh(end)}`});cur=end}}return out}
function generateTimetable(){let c=v("tc"),teacher=v("tt"),ss=subjectsFor(c);if(!ss.length){toast("No active subjects for this class");return}let slots=makeSlots(c),freq={};ss.forEach(s=>freq[s]=defaultFreq[s]||4);let assignments=[],used=new Set(),ti=0;for(const s of ss){for(let n=0;n<freq[s];n++){let placed=false;for(let k=0;k<slots.length;k++){let sl=slots[(ti+k)%slots.length],key=sl.day+"|"+sl.time;if(!used.has(key)){assignments.push({id:uid("TT"),class:c,subject:s,teacher:teacher||"Class Teacher",day:sl.day,time:sl.time});used.add(key);ti=(ti+k+1)%slots.length;placed=true;break}}if(!placed)break}}db.timetable=db.timetable.filter(x=>x.class!==c).concat(assignments);save();audit("Timetable generated for "+c);renderTimetable(c);toast("Timetable generated")}
function renderTimetable(c){let rows=days.map(d=>{let a=db.timetable.filter(x=>x.class===c&&x.day===d);return `<tr><th>${d}</th><td>${a.map(x=>`<span class="badge" style="margin:3px">${esc(x.time)} • ${esc(x.subject)} • ${esc(x.teacher)}</span>`).join(" ")||"FREE"}</td></tr>`}).join("");document.getElementById("tout").innerHTML=`<div class="report"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>${esc(c)} TIMETABLE</p><p>${esc(db.settings.term)}, ${db.settings.year}</p></div><table><tr><th>Day</th><th>Lessons</th></tr>${rows}</table></div>`}
function teacherTimetable(){let n=v("tt");if(!n){toast("Select a teacher");return}let a=db.timetable.filter(x=>x.teacher===n),rows=days.map(d=>`<tr><th>${d}</th><td>${a.filter(x=>x.day===d).map(x=>`${esc(x.time)} — ${esc(x.class)} — ${esc(x.subject)}`).join("<br>")||"FREE"}</td></tr>`).join("");document.getElementById("tout").innerHTML=`<div class="report"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>TEACHER TIMETABLE</p><p>${esc(n)}</p></div><table><tr><th>Day</th><th>Schedule</th></tr>${rows}</table></div>`}
function Settings(){document.getElementById("content").innerHTML=`<div class="card"><h2>School Settings</h2><div class="formgrid">${field("School name","school",db.settings.school)}${field("Motto","motto",db.settings.motto)}${field("Current term","term",db.settings.term,"select",["Term 1","Term 2","Term 3"])}${field("Academic year","year",db.settings.year,"number")}${field("Phone","phone",db.settings.phone)}${field("Email","email",db.settings.email)}</div><button onclick="saveSchoolSettings()">Save School Settings</button></div><div class="card"><h2>Academic Periods</h2><p class="small">Each year/term has its own fee structure and subject combination.</p><div class="formgrid">${field("New year","py",db.settings.year,"number")}${field("New term","pt","Term 1","select",["Term 1","Term 2","Term 3"])}${field("Status","ps","Open","select",["Open","Closed"])}</div><button onclick="addAcademicPeriod()">Add / Open Period</button><div class="tablewrap" style="margin-top:15px"><table class="table"><tr><th>Year</th><th>Term</th><th>Status</th><th>Action</th></tr>${db.academicPeriods.map(p=>`<tr><td>${esc(p.year)}</td><td>${esc(p.term)}</td><td>${esc(p.status||"Open")}</td><td><button class="light" onclick="usePeriod('${esc(p.year)}','${esc(p.term)}')">Use</button></td></tr>`).join("")}</table></div></div><div class="card"><h2>☁️ Supabase Cloud Database</h2><p>Connection status: <b>${cloudConfigured()?"Configured":"Not configured"}</b></p><p class="small">Cloud mode synchronizes the school's working data to a protected Supabase record. Supabase Auth controls access. The public browser key is safe to expose only when RLS is correctly configured.</p><div class="toolbar"><button onclick="cloudSetup()">Configure / Change Connection</button>${cloudReady?'<button class="light" onclick="cloudSave(true);toast("Cloud sync requested")">Sync Now</button>':''}</div></div><div class="card"><h2>Security</h2><p>Supabase Auth account: <b>${esc(cloudUser?.email||"Not signed in")}</b></p><p>Recovery phone: <b>${esc(db.settings.phone)}</b></p><div class="toolbar"><button onclick="securitySetup(false)">Change Password / Security</button><button class="light" onclick="forgot()">Test Password Recovery</button></div></div><div class="card"><h2>Grading Scale</h2><table class="table"><tr><th>Average</th><th>Grade</th></tr>${[["41–50","EE1 — Exceeding Expectations 1"],["36–40","EE2 — Exceeding Expectations 2"],["31–35","ME1 — Meeting Expectations 1"],["25–30","ME2 — Meeting Expectations 2"],["21–24.9","AE1 — Approaching Expectations 1"],["15–20","AE2 — Approaching Expectations 2"],["6–14","BE1 — Below Expectations 1"],["0–5","BE2 — Below Expectations 2"]].map(x=>`<tr><td>${x[0]}</td><td>${x[1]}</td></tr>`).join("")}</table><p class="small">Overall reports and rankings use the active subjects configured for the selected assessment period.</p></div><div class="card"><h2>Backup & Audit</h2><div class="toolbar"><button onclick="backup()">Download Backup</button><button class="light" onclick="showAudit()">View Audit Log</button></div></div>`}
function addAcademicPeriod(){let y=String(v("py")||db.settings.year),t=v("pt"),status=v("ps")||"Open";ensurePeriodConfig(y,t);let p=db.academicPeriods.find(x=>String(x.year)===y&&x.term===t);if(p)p.status=status;else db.academicPeriods.push({year:y,term:t,status});save();audit(`Academic period ${t}, ${y} created/updated`);Settings();toast(`Period ${t}, ${y} is ready`)}
function usePeriod(y,t){db.settings.year=String(y);db.settings.term=t;ensurePeriodConfig();save();audit(`Current period changed to ${t}, ${y}`);Settings();toast(`Current period: ${t}, ${y}`)}
function saveSchoolSettings(){db.settings.school=v("school");db.settings.motto=v("motto");db.settings.term=v("term");db.settings.year=v("year");db.settings.phone=v("phone");db.settings.email=v("email");ensurePeriodConfig();save();audit("School settings changed");show("Settings");toast("Settings saved")}
function showAudit(){
  const rows=db.audit.slice(0,500).map(a=>`<tr><td>${esc(a.date?new Date(a.date).toLocaleString():"")}</td><td>${esc(a.teacherName||"Not recorded (older entry)")}</td><td>${esc(a.user||"")}</td><td>${esc(a.action||"")}</td></tr>`).join("");
  openModal(`<h2>Audit Log</h2><p class="small">Tracks recorded changes and activities. New entries ask for the responsible teacher's name and retain the signed-in account where available.</p><div class="tablewrap"><table class="table"><thead><tr><th>Date &amp; time</th><th>Teacher / staff name</th><th>Account</th><th>Action</th></tr></thead><tbody>${rows||'<tr><td colspan="4">No audit entries yet.</td></tr>'}</tbody></table></div>`)
}
async function backup(){if(cloudReady)await cloudSave(true);let blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="kapnanda-primary-junior-school-backup.json";a.click();audit("Backup created")}
if(cloudConfigured()){
  const savedConfig={url:DEFAULT_SUPABASE_CONFIG.url,anonKey:DEFAULT_SUPABASE_CONFIG.anonKey};
  localStorage.setItem(CLOUD_KEY,JSON.stringify(savedConfig));
  initCloud();
  document.getElementById("loginMode").textContent="Supabase mode — sign in with your Supabase Auth email.";
  cloud.auth.onAuthStateChange((event,session)=>{
    if(event==="PASSWORD_RECOVERY") setTimeout(()=>openRecoveryPassword(),0);
  });
}



/* ========================= KAPNANDA V3 =========================
   Built after inspecting the V2 logic. V2 kept the subject selector from its
   initial class and its timetable assigned one selected teacher to every lesson.
   V3 adds period-complete subjects, explicit teaching loads and a section-wide
   teacher-aware scheduler without inventing teacher allocations.
*/
(function migrateV3(){
  if(!db.teacherLoads) db.teacherLoads=[];
  if(!db.timetableMeta) db.timetableMeta={version:3};
  if(!db.settings.school) db.settings.school="Kapnanda Comprehensive School";
  db.teachers=(db.teachers||[]).map((t,i)=>({...t,active:t.active!==false,no:Number(t.no)||i+1}));
  const periods=(db.academicPeriods&&db.academicPeriods.length)?db.academicPeriods:[{year:db.settings.year,term:db.settings.term}];
  for(const p of periods) ensurePeriodConfigV3(String(p.year),p.term);
  // Convert legacy free-text teacher allocations once. Do not overwrite explicit V3 loads.
  if(!db.teacherLoads.length){
    (db.teachers||[]).forEach(t=>{
      const ss=parseTeacherTextV3(t.subjects), cs=parseTeacherTextV3(t.classes).filter(c=>classes.includes(c));
      cs.forEach(c=>ss.forEach(subject=>{const x=subjectRecordsFor(c).find(q=>q.name.toLowerCase()===subject.toLowerCase());db.teacherLoads.push({id:uid("TL"),teacherId:t.id,class:c,subject:x?.name||subject,weeklyLessons:x?.weeklyLessons||defaultFreq[subject]||4,active:true})}));
    });
  }
  save();
})();
function periodMatchV3(x,year=db.settings.year,term=db.settings.term){return String(x.year||year)===String(year)&&String(x.term||term)===String(term)}
function schoolTitleForClass(c){return String(db.settings.school||"KAPNANDA COMPREHENSIVE SCHOOL").toUpperCase()}
function schoolTitleForSection(sec){return sec==="ECDE"?"KAPNANDA ECDE SCHOOL":sec==="Junior"?"KAPNANDA JUNIOR SCHOOL":"KAPNANDA PRIMARY SCHOOL"}
function sectionClasses(sec){return sec==="ECDE"?ecde:sec==="Lower Primary"?lower:sec==="Upper Primary"?upper:sec==="Junior"?junior:classes}
function parseTeacherTextV3(s){return String(s||"").split(/[,;|]+/).map(x=>x.trim()).filter(Boolean)}
function ensurePeriodConfigV3(year=db.settings.year,term=db.settings.term){
  const k=periodKey(year,term);db.subjectConfigs[k]=db.subjectConfigs[k]||{};
  for(const c of classes){const arr=db.subjectConfigs[k][c]=db.subjectConfigs[k][c]||[];const names=new Set(arr.map(x=>String(x.name).toLowerCase()));for(const name of(defaultSubjects[c]||[]))if(!names.has(name.toLowerCase()))arr.push({name,active:true,weeklyLessons:defaultFreq[name]||4,doubleLesson:["Mathematics","English","Kiswahili","Integrated Science","Creative Arts & Sports"].includes(name)})}
  if(!db.fees.byPeriod[k]){db.fees.byPeriod[k]={};for(const c of classes){const sec=ecde.includes(c)?"ECDE":junior.includes(c)?"Junior":"Primary";db.fees.byPeriod[k][c]=Number(db.fees.legacy?.[sec]?.[c]||0)}}return k;
}
// Replace V2 period configuration with the complete, non-destructive version for future calls.
function ensurePeriodConfig(year=db.settings.year,term=db.settings.term){return ensurePeriodConfigV3(year,term)}
function subjectsForPeriod(c,year=db.settings.year,term=db.settings.term){const k=ensurePeriodConfigV3(year,term);return(db.subjectConfigs[k]?.[c]||[]).filter(x=>x.active!==false).map(x=>x.name)}
function subjectRecordsFor(c,year=db.settings.year,term=db.settings.term){const k=ensurePeriodConfigV3(year,term);return db.subjectConfigs[k]?.[c]||[]}
function getTeachingLoads(){
  return(db.teacherLoads||[]).filter(x=>x.active!==false);
}
function teacherById(id){return(db.teachers||[]).find(t=>t.id===id)}
function teacherIndexById(id){const t=teacherById(id);return t?(Number(t.no)||((db.teachers||[]).indexOf(t)+1)):0}
function teacherNumberLabel(id){const n=teacherIndexById(id);return n?String(n):""}
function teacherNameById(id){return teacherById(id)?.name||"Unassigned"}
const subjectCodes={English:"ENG",Kiswahili:"KISW",Mathematics:"MATH","Science & Technology":"SST","Integrated Science":"IS",Agriculture:"AGR","Social Studies":"SST","Creative Arts & Sports":"CAS","Pre-Technical Studies":"PT","Religious Education":"CRE","Environmental Activities":"ENV","Creative Arts":"CA","Language Activities":"LANG","Mathematical Activities":"MATH","Environmental Activities":"ENV"};
function subjectCode(name){return subjectCodes[name]||String(name||"").split(/\s+/).map(x=>x[0]).join("").slice(0,5).toUpperCase()}
function subscriptNumber(n){return String(n||"").replace(/[0-9]/g,d=>"₀₁₂₃₄₅₆₇₈₉"[Number(d)])}
function timetableSubjectLabel(x){const code=subjectCode(x.subject),n=teacherIndexById(x.teacherId);return code+(n?subscriptNumber(n):"")}
function availableTeachers(c,s){return getTeachingLoads().filter(x=>x.class===c&&String(x.subject).toLowerCase()===String(s).toLowerCase()).map(x=>x.teacherId).filter(Boolean)}
function slotKey(day,time){return day+"|"+time}
function timetableConfig(c){
  if(ecde.includes(c))return{
    slots:["08:30–09:00","09:00–09:30","09:30–10:00","10:20–10:50","10:50–11:20","11:20–11:50","12:00–12:30"],
    label:"30-MINUTE LESSONS • START 8:30 AM",
    breaks:[],lunch:null,prep:null,activity:null
  };
  // All Primary and Junior classes use a common 40-minute lesson structure.
  // This gives exactly three lessons before the first break, two after it,
  // and then the remaining lessons after the second break.
  return{
    slots:[
      "08:00–08:40","08:40–09:20","09:20–10:00",
      "10:30–11:10","11:10–11:50",
      "12:00–12:40",
      "14:00–14:40","14:40–15:20"
    ],
    label:"40-MINUTE LESSONS • START 8:00 AM",
    breaks:[["10:00","10:30"],["11:50","12:00"]],
    lunch:["12:40","13:40"],
    prep:["13:40","14:00"],
    activity:"15:30+"
  };
}
function scheduleAssignments(targetClasses){
  const keep=(db.timetable||[]).filter(x=>!targetClasses.includes(x.class)||!periodMatchV3(x));
  const teacherBusy=new Set(keep.filter(x=>x.teacherId).map(x=>slotKey(x.day,x.time)+"|"+x.teacherId));
  const classBusy=new Set(keep.map(x=>slotKey(x.day,x.time)+"|"+x.class));
  const result=[],failures=[],units={};

  // Build one schedulable unit per weekly lesson. The scheduler deliberately
  // spreads subjects across different days before repeating a subject on the
  // same day, while avoiding consecutive repetitions unless doubleLesson is set.
  targetClasses.forEach(c=>{
    units[c]=[];
    subjectRecordsFor(c).filter(a=>a.active!==false).forEach(x=>{
      const n=Math.max(1,Math.min(20,Number(x.weeklyLessons||defaultFreq[x.name]||4)));
      for(let i=0;i<n;i++)units[c].push({
        class:c,subject:x.name,
        teacherIds:availableTeachers(c,x.name),
        doubleLesson:!!x.doubleLesson,
        uid:uid("U")
      });
    });
    units[c].sort((a,b)=>a.teacherIds.length-b.teacherIds.length);
  });

  const baseCfg=timetableConfig(targetClasses[0]);
  const slots=days.flatMap(day=>baseCfg.slots.map(time=>({day,time})));
  const subjectDay={};
  const placedByClass={};
  targetClasses.forEach(c=>placedByClass[c]=[]);

  function lastForClass(c){
    return placedByClass[c]?.[placedByClass[c].length-1]||null;
  }
  function dayCount(c,s,d){
    return subjectDay[c+"|"+s+"|"+d]||0;
  }
  function totalSubjectCount(c,s){
    return days.reduce((n,d)=>n+dayCount(c,s,d),0);
  }

  for(const sl of slots){
    const active=targetClasses.filter(c=>units[c].length&&!classBusy.has(slotKey(sl.day,sl.time)+"|"+c));

    const candidates=c=>{
      const out=[];
      for(const u of units[c]){
        const tids=u.teacherIds.length?u.teacherIds:[""];
        for(const tid of tids){
          if(tid&&teacherBusy.has(slotKey(sl.day,sl.time)+"|"+tid))continue;

          const prev=lastForClass(c);
          const sameSubjectAsPrevious=!!(prev&&prev.subject===u.subject);
          // Same subject in consecutive lesson slots is forbidden unless
          // this subject is explicitly configured as a double lesson.
          if(sameSubjectAsPrevious&&!u.doubleLesson)continue;

          const dc=dayCount(c,u.subject,sl.day);
          const tc=totalSubjectCount(c,u.subject);
          const dayPenalty=dc*10000;
          const repeatPenalty=tc*10;
          const doubleBonus=(sameSubjectAsPrevious&&u.doubleLesson)?-9000:0;
          const teacherPenalty=u.teacherIds.length*2;

          out.push({
            u,tid,
            score:dayPenalty+repeatPenalty+teacherPenalty+doubleBonus+
                  (u.doubleLesson?0:0)
          });
        }
      }
      return out.sort((a,b)=>a.score-b.score).slice(0,80);
    };

    function match(left,chosen=[],used=new Set()){
      if(!left.length)return chosen;
      let bestClass=null,bestOptions=null;
      for(const c of left){
        const opts=candidates(c).filter(o=>!o.tid||!used.has(o.tid));
        if(!bestOptions||opts.length<bestOptions.length){
          bestClass=c;bestOptions=opts;
        }
        if(!opts.length)return null;
      }
      for(const o of bestOptions){
        if(o.tid)used.add(o.tid);
        chosen.push(o);
        const r=match(left.filter(c=>c!==bestClass),chosen,used);
        if(r)return r;
        chosen.pop();
        if(o.tid)used.delete(o.tid);
      }
      return null;
    }

    let chosen=match(active);
    if(!chosen&&active.length>1){
      const ordered=active.slice().sort((a,b)=>candidates(a).length-candidates(b).length);
      for(let n=ordered.length-1;n>=1&&!chosen;n--)chosen=match(ordered.slice(0,n));
    }

    for(const o of(chosen||[])){
      const idx=units[o.u.class].findIndex(u=>u.uid===o.u.uid);
      if(idx<0)continue;
      units[o.u.class].splice(idx,1);

      const rec={
        id:uid("TT"),class:o.u.class,subject:o.u.subject,
        teacherId:o.tid,teacher:teacherNameById(o.tid)||"Unassigned",
        day:sl.day,time:sl.time,year:String(db.settings.year),term:db.settings.term
      };
      result.push(rec);
      placedByClass[rec.class].push(rec);
      classBusy.add(slotKey(rec.day,rec.time)+"|"+rec.class);
      if(o.tid)teacherBusy.add(slotKey(rec.day,rec.time)+"|"+o.tid);
      const key=rec.class+"|"+rec.subject+"|"+rec.day;
      subjectDay[key]=(subjectDay[key]||0)+1;
    }
  }

  for(const c of targetClasses)for(const u of units[c])failures.push(`${c}: ${u.subject}`);
  db.timetable=keep.concat(result);
  return{result,failures};
}
function timetableGrid(c){
  const cfg=timetableConfig(c),title=schoolTitleForClass(c),
        periodTT=(db.timetable||[]).filter(x=>x.class===c&&periodMatchV3(x));
  const cell=(day,time)=>{
    const x=periodTT.find(a=>a.day===day&&a.time===time);
    if(!x)return`<div class="ttfree">—</div>`;
    const code=subjectCode(x.subject);
    return`<div class="ttcell subject-${esc(code.toLowerCase())}">
      <b>${esc(timetableSubjectLabel(x))}</b>
    </div>`;
  };
  const rows=[`<tr><th class="timecol">TIME</th>${days.map(d=>`<th>${d.toUpperCase()}</th>`).join("")}</tr>`];
  const special=(label,cls)=>`<tr class="ttspecial ${cls||""}"><td colspan="6">${label}</td></tr>`;

  cfg.slots.forEach(time=>{
    rows.push(`<tr><th class="timecol">${time}</th>${days.map(d=>`<td>${cell(d,time)}</td>`).join("")}</tr>`);

    if(!ecde.includes(c)&&time==="09:20–10:00"){
      rows.push(special("FIRST BREAK • 10:00–10:30 AM","break"));
    }
    if(!ecde.includes(c)&&time==="11:10–11:50"){
      rows.push(special("SECOND BREAK • 11:50 AM–12:00 PM","break"));
    }
    if(!ecde.includes(c)&&time==="12:00–12:40"){
      rows.push(special("LUNCH • 12:40–1:40 PM","lunch"));
      rows.push(special("PERSONAL STUDIES (PREP) • 1:40–2:00 PM","prep"));
    }
    if((upper.includes(c)||junior.includes(c))&&time==="14:40–15:20"){
      rows.push(special("3:30 PM+ • AFTERNOON ACTIVITIES","activity"));
    }
  });

  return `<div class="ttprint">
    <div class="tthead">
      <div class="ttbrand">${title}</div>
      <div class="ttsub">${esc(c)} — CLASS TIMETABLE</div>
      <div class="ttmeta">${esc(db.settings.term)}, ${esc(String(db.settings.year))} • ${esc(cfg.label)}</div>
    </div>
    <table class="ttable"><tbody>${rows.join("")}</tbody></table>
  </div>`;
}
function printElement(id){const el=document.getElementById(id);if(!el)return;el.classList.add("print-target");window.print();setTimeout(()=>el.classList.remove("print-target"),600)}
function refreshMarkSubjectsV3(){const c=document.getElementById("f_mclass")?.value,e=db.exams.find(x=>x.id===document.getElementById("f_mex")?.value),s=document.getElementById("f_msub");if(!c||!s)return;const old=s.value,opts=subjectsForPeriod(c,e?.year,e?.term);s.innerHTML=opts.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");if(opts.includes(old))s.value=old}
function Marks(){const e=db.exams.find(x=>String(x.term)===String(db.settings.term)&&String(x.year)===String(db.settings.year))?.id||db.exams[0]?.id||"",c="Grade 1",ex=db.exams.find(x=>x.id===e),s=subjectsForPeriod(c,ex?.year,ex?.term)[0]||"";document.getElementById("content").innerHTML=`<div class="card"><div class="pagehero"><div><h2>Marks Entry</h2><p>All active subjects for the selected class and assessment period are available. Changing class or assessment refreshes the subject list.</p></div><span class="badge">CBC • ${esc(db.settings.term)} ${esc(db.settings.year)}</span></div><div class="formgrid">${`<div class="field"><label>Assessment</label><select id="f_mex">${db.exams.map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(e)?"selected":""}>${esc(x.name||x.type||"Assessment")} • ${esc(x.term||"")} ${esc(String(x.year||""))}</option>`).join("")}</select></div>`}${field("Class","mclass",c,"select",classes)}${field("Subject","msub",s,"select",subjectsForPeriod(c,ex?.year,ex?.term))}</div><div class="toolbar"><button onclick="loadMarks()">Load Learners</button><button class="success" onclick="saveMarks()">Save Marks</button><button class="light" onclick="document.getElementById('marksCsvFile').click()">⬆ Upload Marks CSV</button><button class="light" onclick="downloadDedicatedCsvTemplate('marks')">Download Marks CSV Template</button><input id="marksCsvFile" type="file" accept=".csv,text/csv" style="display:none" onchange="uploadMarksCsv(this)"><button class="light" onclick="show('Subjects')">Manage Class Subjects</button></div><div id="marktable" class="tablewrap" style="margin-top:15px"></div></div>`;document.getElementById("f_mclass")?.addEventListener("change",()=>{refreshMarkSubjectsV3();document.getElementById("marktable").innerHTML=""});document.getElementById("f_mex")?.addEventListener("change",()=>{refreshMarkSubjectsV3();document.getElementById("marktable").innerHTML=""})}
function loadMarks(){const c=v("mclass"),e=v("mex"),s=v("msub"),ex=db.exams.find(x=>x.id===e),valid=subjectsForPeriod(c,ex?.year,ex?.term);if(!valid.includes(s)){toast("That subject is not active for this class in the selected assessment period");return}const ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived");document.getElementById("marktable").innerHTML=`<div class="small" style="margin-bottom:8px">${esc(c)} • ${esc(s)} • ${esc(ex?.name||"")} (${esc(ex?.type||"Other")}) — enter marks out of 50.</div><table class="table marktable"><thead><tr><th>#</th><th>Admission</th><th>Learner</th><th>Marks / 50</th><th>Grade</th></tr></thead><tbody>${ls.map((l,i)=>{const m=db.marks.find(x=>x.learner===l.id&&x.exam===e&&x.subject===s);return `<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td><input class="markinput" data-id="${l.id}" value="${m?.mark??""}" type="number" min="0" max="50" step="0.01" oninput="this.closest('tr').querySelector('.gradecell').textContent=this.value===''?'':grade(this.value)"></td><td class="gradecell">${m?grade(m.mark):""}</td></tr>`}).join("")||`<tr><td colspan="5"><div class="empty">No active learners in ${esc(c)}.</div></td></tr>`}</tbody></table>`}
function saveMarks(){const e=v("mex"),c=v("mclass"),s=v("msub"),ex=db.exams.find(x=>x.id===e);if(!e||!c||!s||!subjectsForPeriod(c,ex?.year,ex?.term).includes(s)){toast("Select a valid assessment, class and subject");return}let bad=false;document.querySelectorAll(".markinput").forEach(inp=>{const val=inp.value;if(val!==""&&(Number(val)<0||Number(val)>50)){bad=true;return}const i=db.marks.findIndex(m=>m.learner===inp.dataset.id&&m.exam===e&&m.subject===s);if(val===""){if(i>=0)db.marks.splice(i,1);return}const o={id:i>=0?db.marks[i].id:uid("M"),learner:inp.dataset.id,class:c,subject:s,exam:e,mark:Number(val),year:ex?.year,term:ex?.term};if(i>=0)db.marks[i]=o;else db.marks.push(o)});if(bad){toast("Marks must be between 0 and 50");return}save();audit(`Marks saved: ${c} — ${s}`);toast(`${s} marks saved for ${c}`)}
function teacherLoadForm(id=""){const x=db.teacherLoads.find(a=>a.id===id)||{teacherId:db.teachers[0]?.id||"",class:"Grade 4",subject:"",weeklyLessons:4};const os=subjectsForPeriod(x.class),teachers=(db.teachers||[]).map(t=>`<option value="${esc(t.id)}" ${t.id===x.teacherId?"selected":""}>${esc(t.name)}${t.staff?" — "+esc(t.staff):""}</option>`).join("");openModal(`<h2>${id?"Edit":"Add"} Teaching Assignment</h2><p class="small">A teacher may teach different subjects in different classes. These assignments are used by the timetable engine.</p><div class="formgrid"><div class="field"><label>Teacher</label><select id="f_tlteacher">${teachers}</select></div>${field("Class","tlclass",x.class,"select",classes)}${field("Subject","tlsub",x.subject||os[0]||"","select",os)}${field("Lessons / week","tlfreq",x.weeklyLessons||4,"number")}</div><div class="toolbar"><button onclick="saveTeacherLoad('${id}')">Save Assignment</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`);document.getElementById("f_tlclass")?.addEventListener("change",()=>{const c=v("tlclass"),s=document.getElementById("f_tlsub"),a=subjectsForPeriod(c);s.innerHTML=a.map(q=>`<option value="${esc(q)}">${esc(q)}</option>`).join("")})}
function saveTeacherLoad(id=""){const teacherId=v("tlteacher"),c=v("tlclass"),s=v("tlsub"),weekly=Math.max(1,Math.min(20,Number(v("tlfreq")||4)));if(!teacherId||!c||!s){toast("Teacher, class and subject are required");return}if(db.teacherLoads.some(x=>x.teacherId===teacherId&&x.class===c&&x.subject.toLowerCase()===s.toLowerCase()&&x.id!==id)){toast("That teacher assignment already exists");return}const o={id:id||uid("TL"),teacherId,class:c,subject:s,weeklyLessons:weekly,active:true};const i=db.teacherLoads.findIndex(x=>x.id===id);if(i>=0)db.teacherLoads[i]=o;else db.teacherLoads.push(o);save();audit(`Teaching assignment saved: ${teacherNameById(teacherId)} — ${c} — ${s}`);closeModal();Teachers();toast("Teaching assignment saved")}
function deleteTeacherLoad(id){if(!confirm("Remove this teaching assignment?"))return;db.teacherLoads=db.teacherLoads.filter(x=>x.id!==id);save();audit("Teaching assignment removed");Teachers()}
function Teachers(){const rows=db.teachers.map((t,i)=>`<tr><td>${i+1}</td><td><b>${esc(t.name)}</b><br><span class="small">${esc(t.staff||"")}</span></td><td>${esc(t.role)}</td><td>${getTeachingLoads().filter(x=>x.teacherId===t.id).length}</td><td>${esc(t.phone||"")}</td><td><button class="light" onclick="teacherLoadForm()">+ Assignment</button> <button class="danger" onclick="removeTeacher('${t.id}')">Remove</button></td></tr>`).join("");const loads=getTeachingLoads().map(x=>`<tr><td>${esc(teacherNameById(x.teacherId))}</td><td>${esc(x.class)}</td><td>${esc(x.subject)}</td><td>${x.weeklyLessons||4}</td><td><button class="light" onclick="teacherLoadForm('${x.id}')">Edit</button> <button class="danger" onclick="deleteTeacherLoad('${x.id}')">Remove</button></td></tr>`).join("");document.getElementById("content").innerHTML=`<div class="card"><div class="pagehero"><div><h2>Teacher Register</h2><p>Explicit teacher-to-class-to-subject assignments power the multi-teacher timetable and make clashes detectable before printing.</p></div><div class="toolbar"><button onclick="teacherForm()">+ Add Teacher</button><button class="danger" onclick="removeTeacherForm()">− Remove Teacher</button><button class="success" onclick="teacherLoadForm()">+ Teaching Assignment</button></div></div><div class="tablewrap"><table class="table"><tr><th>#</th><th>Teacher</th><th>Role</th><th>Assignments</th><th>Phone</th><th>Action</th></tr>${rows||"<tr><td colspan=6>No teachers yet.</td></tr>"}</table></div></div><div class="card"><h2>Teaching Assignments</h2><div class="tablewrap"><table class="table"><tr><th>Teacher</th><th>Class</th><th>Subject</th><th>Lessons / Week</th><th>Actions</th></tr>${loads||"<tr><td colspan=5>No teaching assignments. Add them before generating a multi-teacher timetable.</td></tr>"}</table></div></div>`}
function Timetable(){const sec="Junior",cs=sectionClasses(sec),selected=cs[0]||"Grade 7",teachers=(db.teachers||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.name)}${t.staff?" — "+esc(t.staff):""}</option>`).join("");document.getElementById("content").innerHTML=`<div class="card timetable-page"><div class="pagehero"><div><h2>Smart CBC Timetable</h2><p>Generate class, section, individual teacher, or whole-school timetables. Downloads are saved as PDF on A4 paper.</p></div><span class="badge">Constraint-aware • Multi-teacher</span></div><div class="formgrid">${field("Section","ts",sec,"select",["ECDE","Lower Primary","Upper Primary","Junior"])}${field("Class","tc",selected,"select",cs)}<div class="field"><label>Individual teacher</label><select id="f_tt"><option value="">Select teacher…</option>${teachers}</select></div></div><div class="toolbar no-print"><button onclick="generateTimetable()">Generate Class</button><button class="success" onclick="generateSectionTimetable()">Generate Whole Section</button><button class="light" onclick="teacherTimetable()">View Teacher Timetable</button><button class="light" onclick="printElement('tout')">Print Timetable</button></div><div class="toolbar no-print"><button onclick="downloadClassTimetable()">⬇ Download Class Timetable (PDF)</button><button class="light" onclick="downloadTeacherTimetable()">⬇ Download Individual Teacher (PDF)</button><button class="success" onclick="downloadAllSchoolTimetables()">⬇ Download All School Timetables (PDF)</button></div><div id="ttstatus" class="small" style="margin-top:10px"></div><div id="tout" style="margin-top:15px"></div></div>`;document.getElementById("f_ts")?.addEventListener("change",()=>{const s=v("ts"),sel=document.getElementById("f_tc"),a=sectionClasses(s);sel.innerHTML=a.map(c=>`<option>${esc(c)}</option>`).join("")})}
function generateTimetable(){const c=v("tc");if(!c){toast("Select a class");return}const r=scheduleAssignments([c]);save();audit("Timetable generated for "+c);renderTimetableV3(c);document.getElementById("ttstatus").innerHTML=r.failures.length?`<span class="dangertext">${r.failures.length} lesson(s) could not be placed. Add teacher assignments or adjust weekly lesson counts.</span>`:`<span class="oktext">${r.result.filter(x=>x.class===c).length} lessons scheduled successfully.</span>`;toast(r.failures.length?"Timetable generated with warnings":"Timetable generated successfully")}
function generateSectionTimetable(){const sec=v("ts"),cs=sectionClasses(sec),r=scheduleAssignments(cs);save();audit("Timetable generated for section "+sec);renderTimetableV3(v("tc"));document.getElementById("ttstatus").innerHTML=r.failures.length?`<span class="dangertext">${r.failures.length} lesson(s) could not be placed. Review Teaching Assignments and weekly lesson counts.</span>`:`<span class="oktext">Whole ${esc(sec)} section generated: ${r.result.filter(x=>cs.includes(x.class)).length} lessons.</span>`;toast(r.failures.length?"Section generated with warnings":"Whole section timetable generated")}
function renderTimetableV3(c){const out=document.getElementById("tout");if(out)out.innerHTML=timetableGrid(c)+`<div class="toolbar no-print" style="margin-top:12px"><button onclick="printElement('tout')">Print A4</button><button onclick="downloadClassTimetable()">Download Class Timetable (PDF)</button></div>`}
function teacherTimetableMarkup(tid){const t=teacherById(tid),a=(db.timetable||[]).filter(x=>periodMatchV3(x)&&(x.teacherId===tid||x.teacher===t?.name)),first=a[0],school=first?.class?schoolTitleForClass(first.class):schoolTitleForSection("Junior"),rows=days.map(d=>`<tr><th>${esc(d)}</th><td>${a.filter(x=>x.day===d).sort((x,y)=>String(x.time).localeCompare(String(y.time))).map(x=>`<b>${esc(x.time)}</b> — ${esc(x.class)} — ${esc(x.subject)}`).join("<br>")||"FREE"}</td></tr>`).join("");return `<div class="ttprint"><div class="tthead"><div class="ttbrand">${esc(school)}</div><div class="ttsub">INDIVIDUAL TEACHER TIMETABLE</div><div class="ttmeta">${esc(t?.name||"")} • ${esc(db.settings.term)}, ${esc(db.settings.year)}</div></div><table class="ttable"><tbody><tr><th>DAY</th><th>TEACHING SCHEDULE</th></tr>${rows}</tbody></table></div>`}
function teacherTimetable(){const tid=v("tt");if(!tid){toast("Select a teacher");return}const out=document.getElementById("tout");if(out)out.innerHTML=teacherTimetableMarkup(tid)+`<div class="toolbar no-print" style="margin-top:10px"><button onclick="printElement('tout')">Print A4</button><button onclick="downloadTeacherTimetable()">Download Individual Teacher (PDF)</button></div>`}
async function downloadTimetablePdf(filename,title,html,multiPage=false){
  if(!html||!String(html).trim()||!String(html).includes("ttable")){toast("No timetable content to download. Generate the timetable first.");return}
  const content=`<div class="ttprint"><div class="tthead"><div class="ttbrand">${esc(db.settings.school||"KAPNANDA COMPREHENSIVE SCHOOL")}</div><div class="ttsub">${esc(title)}</div><div class="ttmeta">${esc(db.settings.term)} ${esc(String(db.settings.year))}</div></div>${html}</div>`;
  const probe=document.createElement("div");probe.innerHTML=content;
  if(!probe.querySelector(".ttable")||!probe.querySelector(".ttable tr")){toast("Timetable has no rows to export. Generate it first.");return}
  await downloadPrintableDocument(content,filename,"landscape");
}
function openTimetablePrint(wrap,filename){const w=window.open("","_blank");if(!w){toast("Pop-up blocked. Allow pop-ups, then tap Print Timetable again.");return}const styles=Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(x=>`<link rel="stylesheet" href="${x.href}">`).join("");w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(filename)}</title>${styles}<style>@page{size:A4 landscape;margin:5mm}*{box-sizing:border-box}body{background:#fff!important;color:#111!important;margin:0;padding:5mm;font-family:Arial,sans-serif}.ttprint{break-inside:avoid;width:100%;border:1px solid #94a3b8;padding:4mm;background:#fff!important}.tthead{text-align:center;margin-bottom:4mm}.ttbrand{font-size:18pt;font-weight:bold}.ttsub{font-size:12pt;font-weight:bold;margin:3mm}.ttmeta{font-size:9pt;margin:2mm}.ttable{width:100%;border-collapse:collapse;table-layout:fixed}.ttable th,.ttable td{border:1px solid #333;padding:3px;text-align:center;font-size:8pt;color:#111!important}.ttable th{background:#e5edf7!important}.ttcell{min-height:12px}.pagebreak{break-before:page;page-break-before:always}.no-print{display:none!important}</style></head><body>${wrap.innerHTML}<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);w.document.close()}
function downloadClassTimetable(){const c=v("tc");if(!c){toast("Select a class first");return}const html=timetableGrid(c);if(!(db.timetable||[]).some(x=>x.class===c&&periodMatchV3(x))){toast("No saved timetable for "+c+". Generate it first.");return}downloadTimetablePdf(`${c.replace(/[^a-z0-9]+/gi,"-")}-Timetable-${db.settings.term}-${db.settings.year}.pdf`,`${c} Timetable`,html)}
function downloadTeacherTimetable(){const tid=v("tt");if(!tid){toast("Select an individual teacher first");return}const t=teacherById(tid),a=(db.timetable||[]).filter(x=>periodMatchV3(x)&&(x.teacherId===tid||x.teacher===t?.name));if(!a.length){toast("No timetable lessons found for this teacher in the selected term");return}downloadTimetablePdf(`${(t?.name||"Teacher").replace(/[^a-z0-9]+/gi,"-")}-Timetable-${db.settings.term}-${db.settings.year}.pdf`,`${t?.name||"Teacher"} Timetable`,teacherTimetableMarkup(tid))}
function downloadAllSchoolTimetables(){const active=classes.filter(c=>(db.timetable||[]).some(x=>x.class===c&&periodMatchV3(x)));if(!active.length){toast("No saved class timetables found. Generate timetables first.");return}const html=active.map((c,i)=>`${i?'<div class="pagebreak"></div>':''}${timetableGrid(c)}`).join("");downloadTimetablePdf(`All-School-Timetables-${db.settings.term}-${db.settings.year}.pdf`,`All School Timetables • ${db.settings.term} ${db.settings.year}`,html,true)}

/* ---------- Session restore safety net ---------- */
async function restoreSupabaseSession(){
  if(!cloud||!cloudConfigured())return;
  try{
    const {data,error}=await cloud.auth.getSession();
    if(error||!data?.session?.user)return;
    cloudUser=data.session.user;
    cloudReady=true;
    await cloudLoad();
    startCloudRefresh();
    currentUser={username:cloudUser.email||"Authenticated User",role:"Authenticated User",id:cloudUser.id};
    document.getElementById("login")?.classList.add("hidden");
    document.getElementById("app")?.classList.remove("hidden");
    show("Dashboard");
  }catch(e){console.error("Session restore failed:",e)}
}
if(typeof cloud!="undefined"&&cloud) setTimeout(restoreSupabaseSession,150);


/* ---------- Exams manager and Marks integration repair ---------- */
let selectedExamForMarks = "";
const EXAM_CHOICES = ["Mid term exam", "End term exam", "KJSEA analysis", "KPSEA analysis"];
function ensureExamChoices(){
  if(!Array.isArray(db.exams)) db.exams=[];
  // Seed the four requested choices only when the exam list is empty; never overwrite existing exams or marks.
  if(db.exams.length===0){
    const term=String(db.settings?.term||"Term 3"), year=String(db.settings?.year||new Date().getFullYear());
    db.exams=EXAM_CHOICES.map((name,i)=>({id:uid("EX"),name,type:name,term,year}));
    save();
  }
}
function Exams(){
  ensureExamChoices();
  const rows=db.exams.map(e=>`<tr><td><b>${esc(e.name||e.id)}</b></td><td>${esc(e.type||"Other")}</td><td>${esc(e.term||"")}</td><td>${esc(String(e.year||""))}</td><td><div class="toolbar"><button onclick="enterExamMarks('${esc(e.id)}')">Enter Marks</button><button class="danger" onclick="deleteExam('${esc(e.id)}')">Delete</button></div></td></tr>`).join("");
  document.getElementById("content").innerHTML=`<div class="card"><div class="pagehero"><div><h2>Exams</h2><p>Add an exam, open it directly in Marks Entry, or delete an exam when it is no longer needed. Each exam is linked to its own marks, reports and rankings.</p></div><span class="badge bright">Exam Manager</span></div>
  <div class="formgrid"><div class="field"><label>Exam option</label><select id="f_examchoice" onchange="applyExamChoice()"><option value="Mid term exam">Mid term exam</option><option value="End term exam">End term exam</option><option value="KJSEA analysis">KJSEA analysis</option><option value="KPSEA analysis">KPSEA analysis</option><option value="Other">Other / custom</option></select></div>${field("Exam name (editable)","en","Mid term exam")}${field("Term","et",db.settings.term)}${field("Academic year","ey",db.settings.year,"number")}</div>
  <div class="toolbar" style="margin-top:12px"><button onclick="addExam()">+ Add Exam</button><button class="light" onclick="show('Marks')">Open Marks Entry</button></div>
  <div class="tablewrap" style="margin-top:15px"><table class="table"><thead><tr><th>Exam name</th><th>Type</th><th>Term</th><th>Year</th><th>Actions</th></tr></thead><tbody>${rows||'<tr><td colspan="5">No exams yet. Add an exam above.</td></tr>'}</tbody></table></div></div>`;
}
function applyExamChoice(){const choice=v("examchoice");const name=document.getElementById("f_en");if(name&&choice!=="Other")name.value=choice;else if(name&&choice==="Other")name.value="";}
function addExam(){
  const name=v("en").trim(),term=v("et").trim()||db.settings.term,year=String(v("ey")||db.settings.year),type=EXAM_CHOICES.includes(name)?name:(v("examchoice")==="Other"?"Other":name);
  if(!name){toast("Enter an exam name");return}
  if(db.exams.some(e=>String(e.name).trim().toLowerCase()===name.toLowerCase()&&String(e.term)===term&&String(e.year)===year)){toast("That exam already exists for this term and year");return}
  const exam={id:uid("EX"),name,type,term,year};db.exams.push(exam);selectedExamForMarks=exam.id;save();audit(`Exam created: ${name}`);Exams();toast(`${name} added. Use Enter Marks to record scores.`);
}
function enterExamMarks(id){selectedExamForMarks=id;show("Marks");}
function deleteExam(id){
  const exam=db.exams.find(e=>e.id===id);if(!exam){toast("Exam not found");return}
  const linked=db.marks.filter(m=>m.exam===id).length;
  const warning=linked?` This will also delete ${linked} mark record(s) linked to this exam.`:" No marks are currently linked to it.";
  if(!confirm(`Delete “${exam.name}” (${exam.term} ${exam.year})?${warning} This cannot be undone.`))return;
  db.exams=db.exams.filter(e=>e.id!==id);db.marks=db.marks.filter(m=>m.exam!==id);if(selectedExamForMarks===id)selectedExamForMarks="";
  save();audit(`Exam deleted: ${exam.name}; linked marks removed: ${linked}`);Exams();toast("Exam deleted");
}
function Marks(){
  ensureExamChoices();
  const preferred=db.exams.find(x=>x.id===selectedExamForMarks)||db.exams.find(x=>String(x.term)===String(db.settings.term)&&String(x.year)===String(db.settings.year))||db.exams[0];
  const e=preferred?.id||"",c="Grade 7",ex=preferred,s=subjectsForPeriod(c,ex?.year,ex?.term)[0]||"";
  const examOptions=db.exams.map(x=>`<option value="${esc(x.id)}" ${x.id===e?"selected":""}>${esc(x.name)} — ${esc(x.term)} ${esc(String(x.year))}</option>`).join("");
  document.getElementById("content").innerHTML=`<div class="card"><div class="pagehero"><div><h2>Marks Entry</h2><p>Select an exam, class and subject. Marks entered here are saved against the selected exam and used in reports and rankings.</p></div><span class="badge">${esc(db.settings.term)} • ${esc(String(db.settings.year))}</span></div>
  <div class="formgrid"><div class="field"><label>Exam</label><select id="f_mex">${examOptions}</select></div>${field("Class","mclass",c,"select",classes)}${field("Subject","msub",s,"select",subjectsForPeriod(c,ex?.year,ex?.term))}</div>
  <div class="toolbar"><button onclick="loadMarks()">Load Learners</button><button class="success" onclick="saveMarks()">Save Marks</button><button class="light" onclick="document.getElementById('marksCsvFile').click()">⬆ Upload Marks CSV</button><button class="light" onclick="downloadDedicatedCsvTemplate('marks')">Download Marks CSV Template</button><input id="marksCsvFile" type="file" accept=".csv,text/csv" style="display:none" onchange="uploadMarksCsv(this)"><button class="light" onclick="show('Exams')">Manage Exams</button><button class="light" onclick="show('Subjects')">Manage Class Subjects</button></div><div id="marktable" class="tablewrap" style="margin-top:15px"></div></div>`;
  document.getElementById("f_mclass")?.addEventListener("change",()=>{refreshMarkSubjectsV3();document.getElementById("marktable").innerHTML=""});
  document.getElementById("f_mex")?.addEventListener("change",()=>{selectedExamForMarks=v("mex");refreshMarkSubjectsV3();document.getElementById("marktable").innerHTML=""});
}
function refreshMarkSubjectsV3(){const c=document.getElementById("f_mclass")?.value,e=db.exams.find(x=>x.id===document.getElementById("f_mex")?.value),s=document.getElementById("f_msub");if(!c||!s)return;const old=s.value,opts=subjectsForPeriod(c,e?.year,e?.term);s.innerHTML=opts.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");if(opts.includes(old))s.value=old;}
function loadMarks(){
  const c=v("mclass"),e=v("mex"),s=v("msub"),ex=db.exams.find(x=>x.id===e),valid=subjectsForPeriod(c,ex?.year,ex?.term);
  if(!e||!ex){toast("Please add or select an exam first");return}if(!valid.includes(s)){toast("That subject is not active for this class in the selected exam period");return}
  selectedExamForMarks=e;const ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived");
  document.getElementById("marktable").innerHTML=`<div class="small" style="margin-bottom:8px">${esc(c)} • ${esc(s)} • ${esc(ex.name)} — enter marks out of 50.</div><table class="table marktable"><thead><tr><th>#</th><th>Admission</th><th>Learner</th><th>Marks / 50</th><th>Grade</th></tr></thead><tbody>${ls.map((l,i)=>{const m=db.marks.find(x=>x.learner===l.id&&x.exam===e&&x.subject===s);return `<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td><input class="markinput" data-id="${esc(l.id)}" value="${m?.mark??""}" type="number" min="0" max="50" step="0.01" oninput="this.closest('tr').querySelector('.gradecell').textContent=this.value===''?'':grade(this.value)"></td><td class="gradecell">${m?grade(m.mark):""}</td></tr>`}).join("")||`<tr><td colspan="5">No active learners in ${esc(c)}.</td></tr>`}</tbody></table>`;
}
function saveMarks(){
  const e=v("mex"),c=v("mclass"),s=v("msub"),ex=db.exams.find(x=>x.id===e);if(!e||!c||!s||!ex||!subjectsForPeriod(c,ex.year,ex.term).includes(s)){toast("Select a valid exam, class and subject");return}
  const inputs=[...document.querySelectorAll(".markinput")];let bad=false;for(const inp of inputs){if(inp.value!==""&&(Number(inp.value)<0||Number(inp.value)>50||!Number.isFinite(Number(inp.value))))bad=true}if(bad){toast("Marks must be between 0 and 50");return}
  inputs.forEach(inp=>{const i=db.marks.findIndex(m=>m.learner===inp.dataset.id&&m.exam===e&&m.subject===s),val=inp.value;if(val===""){if(i>=0)db.marks.splice(i,1);return}const o={id:i>=0?db.marks[i].id:uid("M"),learner:inp.dataset.id,class:c,subject:s,exam:e,mark:Number(val),year:ex.year,term:ex.term};if(i>=0)db.marks[i]=o;else db.marks.push(o)});
  selectedExamForMarks=e;save();audit(`Marks saved: ${c} — ${s} — ${ex.name}`);toast(`${s} marks saved for ${c} (${ex.name})`);
}


/* ================================================================
   KAPNANDA AI-ASSISTED QUESTION PAPER GENERATOR
   - Application-focused question design
   - Exact A4 page control
   - Teacher name/signature area
   - Optional OpenAI-compatible AI endpoint
   - Offline smart question engine works without an API key
   ================================================================ */

const KAPNANDA_AI_CONFIG_KEY="kapnanda_ai_question_config_v1";

function getAIConfig(){
  try{
    const x=JSON.parse(localStorage.getItem(KAPNANDA_AI_CONFIG_KEY)||"null");
    return x&&typeof x==="object"?x:{endpoint:"",apiKey:"",model:""};
  }catch(e){return {endpoint:"",apiKey:"",model:""}}
}
function saveAIConfig(){
  const endpoint=(document.getElementById("ai_endpoint")?.value||"").trim();
  const apiKey=(document.getElementById("ai_apikey")?.value||"").trim();
  const model=(document.getElementById("ai_model")?.value||"").trim();
  localStorage.setItem(KAPNANDA_AI_CONFIG_KEY,JSON.stringify({endpoint,apiKey,model}));
  toast(endpoint&&apiKey?"AI connection saved on this device":"AI connection cleared");
}
function openAISettings(){
  const c=getAIConfig();
  openModal(`<h2>AI Question Generator Connection</h2>
    <p>For a secure production deployment, route the AI request through a server/Supabase Edge Function. A browser-side API key can be exposed to a user who has access to the device.</p>
    ${field("OpenAI-compatible endpoint (optional)","ai_endpoint",c.endpoint)}
    ${field("API key (stored only on this device)","ai_apikey",c.apiKey,"password")}
    ${field("Model","ai_model",c.model)}
    <p class="small">If these fields are empty, Kapnanda uses its built-in application-question engine. If configured, the endpoint is asked to return JSON questions.</p>
    <div class="toolbar"><button onclick="saveAIConfig();closeModal()">Save</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`);
}

const KP_APP_PATTERNS={
  "Mathematics":[
    "A school is planning to buy {topic} using a fixed budget. Work out the figures needed and explain the decision you would make.",
    "A learner is helping at home with a {topic} problem. Use the information given in the situation to calculate the answer and show how your result can be checked.",
    "A small business uses {topic} when serving customers. Apply the correct method to solve the problem and state one practical conclusion from your answer.",
    "A farmer records data involving {topic}. Use the data to determine the missing value and explain how the result can guide the farmer."
  ],
  "English":[
    "You are a learner responsible for dealing with a school situation involving {topic}. Write a suitable response and show how your choice would solve the problem.",
    "A class is preparing an activity connected with {topic}. Apply appropriate language to write the requested message, instructions or short composition.",
    "Read the situation about {topic}. Identify the communication problem and write what you would say or write to handle it effectively.",
    "Your school wants learners to improve an aspect of {topic}. Prepare a practical response that could be used by the school."
  ],
  "Kiswahili":[
    "Katika mazingira ya shule, umetakiwa kutumia {topic} kutatua tatizo fulani. Andika jibu lako kwa usahihi na ueleze kwa nini umechagua njia hiyo.",
    "Mwalimu amekupa hali inayohusu {topic}. Tumia maarifa yako kuandika jibu linalofaa katika mazingira hayo.",
    "Jumuiya ya shule inakabiliwa na changamoto inayohusiana na {topic}. Eleza hatua ambazo ungechukua na uonyeshe matumizi sahihi ya lugha.",
    "Tumia {topic} katika hali halisi ya maisha. Toa jibu linaloonyesha matumizi na uelewa, si kukariri maana pekee."
  ],
  "Integrated Science":[
    "A school wants to solve a practical problem involving {topic}. Explain the procedure you would use, the expected observation and the conclusion you would make.",
    "During an investigation about {topic}, a learner obtains unexpected results. Apply scientific knowledge to explain what should be checked and how the investigation can be improved.",
    "A community is experiencing a problem related to {topic}. Propose a practical solution and explain the scientific principle behind it.",
    "You are asked to advise a learner on {topic}. Use evidence from a real-life situation to justify the advice you would give."
  ],
  "Agriculture":[
    "A farmer notices a problem connected with {topic}. As an agricultural adviser, recommend the practical steps the farmer should take and give reasons.",
    "A school farm is planning an activity involving {topic}. Prepare a workable plan showing the resources, procedure and expected result.",
    "A farmer has limited resources while dealing with {topic}. Apply agricultural knowledge to decide which action should be given priority and explain why.",
    "A crop or livestock enterprise is affected by a challenge involving {topic}. Suggest a management response and explain how it would improve production."
  ],
  "Social Studies":[
    "Your community is facing a challenge involving {topic}. As a learner representative, propose practical actions and explain how they could improve the situation.",
    "A local leader asks your class for advice about {topic}. Use what you have learnt to prepare a realistic recommendation.",
    "A family or community must make a decision related to {topic}. Compare the possible choices and recommend the most suitable one with reasons.",
    "You are planning a school/community project involving {topic}. Describe the steps you would take and explain how the project could benefit people."
  ],
  "Pre-Technical Studies":[
    "A school needs a practical solution involving {topic}. Design or describe a suitable solution, list the main materials/tools and explain how it would be used.",
    "A learner is making an item related to {topic}. Apply safe working practices to explain the procedure and how you would check the finished work.",
    "A workshop problem involving {topic} has occurred. Diagnose the likely cause, propose a remedy and explain the safety precautions required.",
    "Your community wants a low-cost solution related to {topic}. Develop a simple design and justify the choice of materials, tools and method."
  ],
  "Religious Education":[
    "A learner faces a real-life dilemma involving {topic}. Use religious values to advise the learner and explain how the advice could be put into practice.",
    "Your school is dealing with a challenge connected to {topic}. Propose a response based on the values learnt and explain the expected effect.",
    "A community disagreement has arisen around {topic}. Apply the values from the topic to suggest a peaceful and responsible solution.",
    "A young person must make a difficult decision related to {topic}. Explain the practical steps you would recommend and give reasons."
  ],
  "Creative Arts & Sports":[
    "Your school is organising an activity involving {topic}. Prepare a practical plan showing what you would do, the resources needed and how success would be judged.",
    "A learner must improve performance in {topic}. Design a simple practice or production plan and explain why each step is important.",
    "A community event requires a creative solution involving {topic}. Develop your idea and explain how you would organise and present it.",
    "You are supervising learners during an activity involving {topic}. Identify the practical decisions you would make to achieve a safe and successful outcome."
  ],
  "Science & Technology":[
    "A school is experiencing a practical challenge involving {topic}. Explain how you would investigate it and propose a suitable solution.",
    "A learner must use knowledge of {topic} to improve a household or school task. Describe the method and justify your choice.",
    "A community problem is connected to {topic}. Apply scientific and technological knowledge to recommend an appropriate response.",
    "You have been asked to test a solution related to {topic}. State the procedure, expected observations and how you would decide whether it works."
  ],
  "Generic":[
    "A real-life situation at school or in the community involves {topic}. Apply what you have learnt to propose a practical solution and justify your decision.",
    "You have been given responsibility for a task involving {topic}. Explain the steps you would take, the resources needed and how you would evaluate the result.",
    "A learner makes a mistake while dealing with {topic}. Diagnose the problem and explain the better approach you would use.",
    "Your community wants to improve an area connected with {topic}. Develop an actionable plan and explain why your plan would work."
  ]
};

function normalizeQuestionSubject(subject){
  const s=String(subject||"").toLowerCase();
  if(s.includes("math"))return"Mathematics";
  if(s.includes("english"))return"English";
  if(s.includes("kiswahili"))return"Kiswahili";
  if(s.includes("integrated science"))return"Integrated Science";
  if(s.includes("science"))return"Science & Technology";
  if(s.includes("agric"))return"Agriculture";
  if(s.includes("social"))return"Social Studies";
  if(s.includes("pre-technical")||s.includes("technical"))return"Pre-Technical Studies";
  if(s.includes("relig")||s.includes("cre")||s.includes("christ"))return"Religious Education";
  if(s.includes("creative")||s.includes("sport"))return"Creative Arts & Sports";
  return"Generic";
}
function topicList(raw){
  return String(raw||"").split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);
}
function localApplicationQuestion(subject,topic,index,marks){
  const bank=KP_APP_PATTERNS[normalizeQuestionSubject(subject)]||KP_APP_PATTERNS.Generic;
  const t=topic||"the selected topic";
  let q=bank[index%bank.length].replace(/\{topic\}/g,t);
  if(!/[?.]$/.test(q))q+=".";
  return {number:index+1,text:q,marks:Number(marks)||5,level:"Application"};
}
function buildQuestionPrompt(opts){
  return `Create a Kenyan competency-based school examination paper for Kapnanda Comprehensive School.
Class: ${opts.className}
Subject: ${opts.subject}
Assessment: ${opts.assessmentType}
Term: ${opts.term}
Year: ${opts.year}
Topics: ${opts.topics.join(", ")}
Number of questions: ${opts.count}
Marks per question: ${opts.marks}
Required pages: ${opts.pages}

STRICT REQUIREMENTS:
- Every question must be an APPLICATION question requiring learners to use knowledge in a real-life, school, home, community, experiment, farm, business, design or problem-solving situation.
- Do not write definition-only, recall-only or "state five..." questions unless the recall is embedded in a meaningful application task.
- Match the class level and subject.
- Use clear Kenyan/British English unless the subject is Kiswahili.
- Avoid ambiguous questions.
- Return ONLY valid JSON in this shape: {"questions":[{"text":"...","marks":5,"level":"Application"}]}
- Exactly ${opts.count} questions.`;
}
async function callConfiguredQuestionAI(opts){
  const c=getAIConfig();
  if(!c.endpoint||!c.apiKey)return null;
  const payload={
    model:c.model||"gpt-5-mini",
    messages:[
      {role:"system",content:"You are a Kenyan competency-based school assessment question writer. Produce application-focused questions only."},
      {role:"user",content:buildQuestionPrompt(opts)}
    ],
    temperature:.7
  };
  const r=await fetch(c.endpoint,{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+c.apiKey},
    body:JSON.stringify(payload)
  });
  if(!r.ok)throw new Error("AI service returned HTTP "+r.status);
  const data=await r.json();
  let content=data?.choices?.[0]?.message?.content||data?.output_text||"";
  if(Array.isArray(content))content=content.map(x=>x?.text||x?.content||"").join("");
  content=String(content).replace(/^```json\s*/i,"").replace(/```\s*$/,"").trim();
  const parsed=JSON.parse(content);
  if(!Array.isArray(parsed.questions))throw new Error("AI did not return a questions array.");
  return parsed.questions.map((q,i)=>({number:i+1,text:String(q.text||"").trim(),marks:Number(q.marks)||opts.marks,level:"Application"})).filter(q=>q.text);
}

function paperTeacherName(){
  const names=(db.teachers||[]).map(t=>t.name).filter(Boolean);
  return names[0]||currentUser?.username||"";
}
function questionPaperHeader(opts,page,totalPages){
  return `<div class="qp-schoolhead">
    <div class="qp-school-name">${esc(db.settings.school||"Kapnanda Comprehensive School")}</div>
    <div class="qp-motto">${esc(db.settings.motto||"Hardwork Pays")}</div>
    <div class="qp-title">${esc(opts.assessmentType.toUpperCase())} • ${esc(opts.subject.toUpperCase())}</div>
    <div class="qp-meta">
      <span><b>Class:</b> ${esc(opts.className)}</span>
      <span><b>Term:</b> ${esc(opts.term)}</span>
      <span><b>Year:</b> ${esc(opts.year)}</span>
      <span><b>Time:</b> ${esc(opts.duration)}</span>
      <span><b>Total Marks:</b> ${esc(String(opts.totalMarks))}</span>
    </div>
    <div class="qp-learner-line"><span>Learner Name: __________________________________________</span><span>Admission No: ____________________</span></div>
    <div class="qp-instructions"><b>Instructions:</b> Answer all questions. Read each situation carefully and apply what you have learnt. Show working where necessary.</div>
    <div class="qp-page">Page ${page} of ${totalPages}</div>
  </div>`;
}
function questionPaperPage(opts,questions,page,totalPages){
  return `<section class="question-paper-page">
    ${questionPaperHeader(opts,page,totalPages)}
    <div class="qp-questions">${questions.map((q,i)=>`<div class="qp-question">
      <div class="qp-qhead"><b>${q.number}.</b><span class="qp-level">APPLICATION</span><span class="qp-marks">${q.marks} marks</span></div>
      <div class="qp-text">${esc(q.text)}</div>
      <div class="qp-answer-lines"></div>
    </div>`).join("")}</div>
    ${page===totalPages?`<div class="qp-teacher-sign"><div><b>Prepared by:</b> ${esc(opts.teacherName||"____________________________")}</div><div><b>Teacher's Signature:</b> __________________________</div><div><b>Date:</b> __________________</div></div>`:""}
    <div class="qp-footer">KAPNANDA COMPREHENSIVE SCHOOL • ${esc(opts.className)} • ${esc(opts.subject)} • ${esc(opts.assessmentType)} • ${esc(opts.term)} ${esc(opts.year)}</div>
  </section>`;
}

function questionPaperForm(){
  const c=getAIConfig();
  const currentClass=document.getElementById("qclass")?.value||"Grade 9";
  const currentSubject=document.getElementById("qsubject")?.value||subjectsForPeriod(currentClass,db.settings.year,db.settings.term)[0]||"Mathematics";
  const teachers=(db.teachers||[]).map(t=>t.name).filter(Boolean);
  document.getElementById("content").innerHTML=`<div class="card question-generator-page">
    <div class="pagehero"><div><h2>🤖 AI-Assisted Question Paper Generator</h2><p>Create topical tests, Mid Term Exams and End Term Exams with application-focused questions. Set the exact number of pages and teacher name. The generated paper is formatted for A4 printing and PDF.</p></div><span class="badge bright">CBC • Application Focus</span></div>
    <div class="card qp-builder">
      <h3>1. Paper Details</h3>
      <div class="formgrid">
        ${field("Assessment Type","qtype","Topical Test","select",["Topical Test","Mid Term Exam","End Term Exam","Revision Paper"])}
        ${field("Class","qclass",currentClass,"select",classes)}
        ${field("Subject","qsubject",currentSubject,"select",subjectsForPeriod(currentClass,db.settings.year,db.settings.term))}
        ${field("Term","qterm",db.settings.term)}
        ${field("Academic Year","qyear",db.settings.year,"number")}
        ${field("Duration","qduration","1 Hour")}
        ${field("Pages Required","qpages","2","number")}
        ${field("Questions Per Page","qqpp","4","number")}
        ${field("Marks Per Question","qmarks","5","number")}
        <div class="field"><label>Teacher / Prepared By</label><select id="f_qteacher"><option value="">Select teacher</option>${teachers.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}<option value="${esc(paperTeacherName())}">${esc(paperTeacherName())}</option></select></div>
      </div>
      <div class="field" style="margin-top:12px"><label>Topics / Learning Areas (separate with commas)</label><textarea id="f_qtopics" rows="3" placeholder="e.g. Fractions, ratio and proportion, percentages">${esc("")}</textarea></div>
      <div class="field" style="margin-top:12px"><label>Teacher's special instructions / context</label><textarea id="f_qnotes" rows="2" placeholder="Optional: use local farming examples, school situations, practical problems..."></textarea></div>
      <div class="toolbar" style="margin-top:14px">
        <button class="success" onclick="generateQuestionPaper()">✨ Generate Application Paper</button>
        <button class="light" onclick="openAISettings()">⚙️ AI Connection</button>
        <button class="secondary" onclick="clearQuestionPaperPreview()">Clear Preview</button>
      </div>
      <p class="small" style="margin-top:10px">Built-in question engine works without an API key. If an AI connection is configured, the system asks the AI to create the questions and validates the response before printing.</p>
    </div>
    <div id="questionPaperPreview"></div>
  </div>`;
  document.getElementById("f_qclass")?.addEventListener("change",()=>{
    const c=v("qclass"),subs=subjectsForPeriod(c,v("qyear")||db.settings.year,v("qterm")||db.settings.term),s=document.getElementById("f_qsubject");
    if(s)s.innerHTML=subs.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
  });
}
function clearQuestionPaperPreview(){const x=document.getElementById("questionPaperPreview");if(x)x.innerHTML="";}
async function generateQuestionPaper(){
  const opts={
    assessmentType:v("qtype")||"Topical Test",
    className:v("qclass")||"Grade 9",
    subject:v("qsubject")||"Mathematics",
    term:v("qterm")||db.settings.term,
    year:v("qyear")||db.settings.year,
    duration:v("qduration")||"1 Hour",
    pages:Math.max(1,Math.min(12,Number(v("qpages")||2))),
    qpp:Math.max(1,Math.min(8,Number(v("qqpp")||4))),
    marks:Math.max(1,Math.min(50,Number(v("qmarks")||5))),
    topics:topicList(v("qtopics")),
    teacherName:v("qteacher").trim()||paperTeacherName(),
    notes:v("qnotes").trim()
  };
  if(!opts.topics.length)opts.topics=[opts.subject];
  opts.count=opts.pages*opts.qpp;
  opts.totalMarks=opts.count*opts.marks;
  const preview=document.getElementById("questionPaperPreview");
  if(!preview)return;
  preview.innerHTML=`<div class="card"><div class="empty">Generating application-focused questions…</div></div>`;
  let questions=null,source="Built-in application engine";
  try{
    if(getAIConfig().endpoint&&getAIConfig().apiKey){
      questions=await callConfiguredQuestionAI(opts);
      if(questions?.length>=opts.count){questions=questions.slice(0,opts.count);source="Connected AI";}
    }
  }catch(e){console.warn("AI generation failed; using local engine",e);toast("AI connection failed; generated with the built-in application engine.");}
  if(!questions||questions.length<opts.count){
    questions=Array.from({length:opts.count},(_,i)=>localApplicationQuestion(opts.subject,opts.topics[i%opts.topics.length],i,opts.marks));
    source="Built-in application engine";
  }else{
    questions=questions.map((q,i)=>({...q,number:i+1,marks:q.marks||opts.marks,level:"Application"}));
  }
  if(opts.notes){
    questions=questions.map((q,i)=>i===0?{...q,text:q.text+" "+opts.notes}:q);
  }
  const pages=[];
  for(let p=0;p<opts.pages;p++)pages.push(questions.slice(p*opts.qpp,(p+1)*opts.qpp));
  const paper={id:uid("QP"),createdAt:new Date().toISOString(),createdBy:currentUser?.username||"teacher",source,options:opts,questions};
  db.questionPapers.unshift(paper);db.questionPapers=db.questionPapers.slice(0,100);save();
  audit(`Question paper generated: ${opts.assessmentType} — ${opts.className} — ${opts.subject}`);
  preview.innerHTML=`<div class="card no-print"><div class="toolbar"><button class="success" onclick="printQuestionPaper('${paper.id}')">🖨️ Print A4 Paper</button><button onclick="downloadQuestionPaperPDF('${paper.id}')">⬇️ Download PDF</button><button class="light" onclick="show('QuestionPapers')">New Paper</button></div><p class="small">Generated using: ${esc(source)} • ${opts.pages} A4 page(s) • ${opts.count} application questions • ${opts.totalMarks} marks.</p></div>
    <div id="qp-print-target" class="question-paper-document">${pages.map((pg,i)=>questionPaperPage(opts,pg,i+1,opts.pages)).join("")}</div>`;
}
function getQuestionPaper(id){return (db.questionPapers||[]).find(x=>x.id===id)}
function printQuestionPaper(id){
  const paper=getQuestionPaper(id);if(!paper){toast("Question paper not found");return}
  const target=document.getElementById("qp-print-target");
  if(!target){toast("Generate the paper preview first");return}
  document.body.classList.add("printing-question-paper");
  setTimeout(()=>window.print(),50);
  setTimeout(()=>document.body.classList.remove("printing-question-paper"),1200);
}
async function downloadQuestionPaperPDF(id){
  const paper=getQuestionPaper(id);if(!paper){toast("Question paper not found");return}
  const target=document.getElementById("qp-print-target");if(!target){toast("Generate the paper preview first");return}
  if(typeof html2pdf!=="function"){printQuestionPaper(id);toast("PDF library unavailable; choose Save as PDF in the print dialog.");return}
  const opt=paper.options;
  try{
    await html2pdf().set({
      margin:0,
      filename:`${String(opt.className).replace(/[^a-z0-9]+/gi,"-")}-${String(opt.subject).replace(/[^a-z0-9]+/gi,"-")}-${String(opt.assessmentType).replace(/[^a-z0-9]+/gi,"-")}-${opt.year}.pdf`,
      image:{type:"jpeg",quality:.98},
      html2canvas:{scale:2,useCORS:true,backgroundColor:"#ffffff",scrollX:0,scrollY:0},
      jsPDF:{unit:"mm",format:"a4",orientation:"portrait",compress:true},
      pagebreak:{mode:["css","legacy"]}
    }).from(target).save();
    toast("Question paper PDF downloaded");
  }catch(e){console.error(e);toast("PDF download failed. Use Print A4 Paper and choose Save as PDF.")}
}
function QuestionPapers(){
  questionPaperForm();
  const history=(db.questionPapers||[]).slice(0,10);
  const form=document.querySelector(".question-generator-page");
  if(!form)return;
  const h=`<div class="card no-print"><h3>Recent Generated Papers</h3><div class="tablewrap"><table class="table"><thead><tr><th>Date</th><th>Assessment</th><th>Class</th><th>Subject</th><th>Pages</th><th>Teacher</th><th>Source</th><th>Action</th></tr></thead><tbody>${history.map(p=>`<tr><td>${new Date(p.createdAt).toLocaleString()}</td><td>${esc(p.options?.assessmentType||"")}</td><td>${esc(p.options?.className||"")}</td><td>${esc(p.options?.subject||"")}</td><td>${esc(p.options?.pages||"")}</td><td>${esc(p.options?.teacherName||"")}</td><td>${esc(p.source||"")}</td><td><button class="light" onclick="loadQuestionPaper('${p.id}')">Open</button></td></tr>`).join("")||'<tr><td colspan="8">No papers generated yet.</td></tr>'}</tbody></table></div></div>`;
  form.insertAdjacentHTML("beforeend",h);
}
function loadQuestionPaper(id){
  const p=getQuestionPaper(id);if(!p)return;
  const opts=p.options,pages=[];
  for(let i=0;i<opts.pages;i++)pages.push(p.questions.slice(i*opts.qpp,(i+1)*opts.qpp));
  const holder=document.querySelector(".question-generator-page #questionPaperPreview");
  if(holder)holder.innerHTML=`<div class="card no-print"><div class="toolbar"><button class="success" onclick="printQuestionPaper('${p.id}')">🖨️ Print A4 Paper</button><button onclick="downloadQuestionPaperPDF('${p.id}')">⬇️ Download PDF</button></div><p class="small">Loaded saved paper • ${esc(p.source||"")}</p></div><div id="qp-print-target" class="question-paper-document">${pages.map((pg,i)=>questionPaperPage(opts,pg,i+1,opts.pages)).join("")}</div>`;
}


/* ---------- CSV imports for marks and fee payments ---------- */
function readCsvFileInput(input, callback){
  const file=input?.files?.[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{try{callback(String(reader.result||""))}catch(err){console.error(err);toast("CSV import failed: "+(err.message||"check the file"))}finally{input.value=""}};
  reader.onerror=()=>{toast("Could not read the CSV file");input.value=""};
  reader.readAsText(file);
}
function parseDedicatedCsv(text){
  const rows=[];let row=[],cell="",quoted=false;
  text=String(text||"").replace(/^\uFEFF/,"");
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"'){quoted=false}else cell+=ch}
    else if(ch==='"')quoted=true;
    else if(ch===","){row.push(cell);cell=""}
    else if(ch==="\n"){row.push(cell);rows.push(row);row=[];cell=""}
    else if(ch!=="\r")cell+=ch;
  }
  if(cell.length||row.length){row.push(cell);rows.push(row)}
  const useful=rows.filter(r=>r.some(c=>String(c||"").trim()!==""));
  if(useful.length<2)throw new Error("CSV needs a header row and at least one data row.");
  const headers=useful[0].map(normalizeCsvHeader);
  return useful.slice(1).map(r=>{const o={};headers.forEach((h,i)=>o[h]=String(r[i]??"").trim());return o});
}
function downloadDedicatedCsvTemplate(kind){
  const content=kind==="marks"
    ?"admission_number,mark\nADM001,42\n"
    :"admission_number,amount_paid,date,term,year,method,receipt_number\nADM001,1500,2026-10-15,Term 3,2026,MPesa,RCPT001\n";
  const blob=new Blob([content],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);const a=document.createElement("a");
  a.href=url;a.download=kind==="marks"?"marks_upload_template.csv":"fees_paid_upload_template.csv";
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
function csvGet(row, names){
  for(const name of names){const key=normalizeCsvHeader(name);if(row[key]!==undefined&&row[key]!=="")return row[key]}
  return "";
}
function uploadMarksCsv(input){
  readCsvFileInput(input,text=>{
    const rows=parseDedicatedCsv(text);
    if(!rows.length){toast("CSV is empty or missing a header row");return}
    const exam=v("mex"),className=v("mclass"),subject=v("msub");
    if(!exam||!className||!subject){toast("Select assessment, class and subject before uploading");return}
    let added=0,updated=0,skipped=0;
    rows.forEach(r=>{
      const adm=csvGet(r,["admission","adm","admission_number","adm_no","learner_admission"]);
      const raw=csvGet(r,["mark","marks","score","score_out_of_50","marks_out_of_50"]);
      const learner=db.learners.find(l=>String(l.adm||"").trim().toLowerCase()===adm.trim().toLowerCase()&&l.status!=="Archived"&&l.class===className);
      const mark=Number(raw);
      if(!learner||!adm||raw===""||!Number.isFinite(mark)||mark<0||mark>50){skipped++;return}
      const existing=db.marks.find(m=>String(m.learner)===String(learner.id)&&String(m.exam)===String(exam)&&String(m.subject)===String(subject));
      if(existing){existing.mark=mark;updated++}
      else{db.marks.push({id:uid("M"),learner:learner.id,exam,subject,mark});added++}
    });
    if(added+updated){save();audit(`Marks CSV import: ${added} added, ${updated} updated, ${skipped} skipped; class ${className}, subject ${subject}`);loadMarks()}
    toast(`Marks CSV: ${added} added, ${updated} updated, ${skipped} skipped.`);
  });
}
function uploadFeesCsv(input){
  readCsvFileInput(input,text=>{
    const rows=parseDedicatedCsv(text);
    if(!rows.length){toast("CSV is empty or missing a header row");return}
    let added=0,skipped=0;
    rows.forEach(r=>{
      const adm=csvGet(r,["admission","adm","admission_number","adm_no","learner_admission"]);
      const rawAmount=csvGet(r,["amount","amount_paid","payment","paid"]);
      const amount=Number(String(rawAmount).replace(/[, KSh]/gi,""));
      const learner=db.learners.find(l=>String(l.adm||"").trim().toLowerCase()===adm.trim().toLowerCase()&&l.status!=="Archived");
      if(!learner||!adm||rawAmount===""||!Number.isFinite(amount)||amount<=0){skipped++;return}
      const dateRaw=csvGet(r,["date","payment_date"])||new Date().toISOString().slice(0,10);
      const parsedDate=new Date(dateRaw);
      if(Number.isNaN(parsedDate.getTime())){skipped++;return}
      const term=csvGet(r,["term"])||db.settings.term;
      const year=String(csvGet(r,["year","academic_year"])||db.settings.year);
      const method=csvGet(r,["method","payment_method"])||"CSV Import";
      const receipt=csvGet(r,["receipt","receipt_number","receipt_no"]);
      const paymentDate=parsedDate.toISOString();
      // Merge with existing records: do not duplicate a payment already imported.
      const duplicate=db.payments.find(p=>String(p.learner)===String(learner.id)&&String(p.amount)===String(amount)&&String(p.term||"")===String(term||"")&&String(p.year||"")===String(year||"")&&(
        receipt ? String(p.receipt||"").trim().toLowerCase()===receipt.trim().toLowerCase()
                : String(p.date||"").slice(0,10)===paymentDate.slice(0,10)&&String(p.method||"").trim().toLowerCase()===method.trim().toLowerCase()
      ));
      if(duplicate){skipped++;return}
      db.payments.push({
        id:uid("P"),learner:learner.id,class:learner.class,amount,
        method,receipt,date:paymentDate,term,year
      });
      added++;
    });
    if(added){save();audit(`Fees CSV import: ${added} payment(s) added, ${skipped} skipped`);Fees()}
    toast(`Fees CSV: ${added} payments added, ${skipped} rows skipped.`);
  });
}
