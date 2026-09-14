
/* ---------- Supabase shared cloud connection ---------- */
const CLOUD_KEY="kapnanda_supabase_config_v1";
// Default Supabase connection. The publishable/anon key is safe for browser use
// when Row Level Security (RLS) is correctly configured. NEVER put a service-role key here.
const DEFAULT_SUPABASE_CONFIG={
  url:"https://ekpgmcyfwibgvpqccsfy.supabase.co",
  anonKey:"sb_publishable_-gWNnPJDlA8TrAJmQo6h5g_KPbjIiep"
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
    document.getElementById("loginUserLabel").textContent="Supabase Email";
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
  const arrayKeys=["learners","teachers","teacherLoads","payments","marks","attendance","timetable","exams","audit","academicPeriods"];
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
    db=sanitizeCloudDb(data.data);
    if(!db.settings) db.settings={school:"Kapnanda Primary and Junior School",motto:"Learn • Grow • Excel",term:"Term 3",year:"2026"};
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
    cloudLastUpdatedAt=new Date(data.updated_at||0).getTime()||0;
    localStorage.setItem(KEY,JSON.stringify(db));
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

async function cloudSave(force=false){
  if(!cloud||!cloudUser){return}
  if(cloudSyncBusy){cloudSavePending=true;return}
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
  }catch(e){
    console.error(e);
    if(force)toast("Cloud save failed: "+(e.message||e));
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
    if(!db.settings) db.settings={school:"Kapnanda Primary and Junior School",motto:"Learn • Grow • Excel",term:"Term 3",year:"2026"};
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
if(!db) db={settings:{school:"Kapnanda Primary and Junior School",motto:"Learn • Grow • Excel",term:"Term 3",year:"2026",phone:"",email:"",initialPasswordChanged:false},learners:[],teachers:[],teacherLoads:[],payments:[],marks:[],exams:[{id:"EX1",name:"Term 3 Assessment 2026",term:"Term 3",year:"2026"}],attendance:[],timetable:[],subjects:JSON.parse(JSON.stringify(defaultSubjects)),subjectConfigs:{},fees:{byPeriod:{},legacy:{ECDE:{PP1:0,PP2:0},Primary:{},Junior:{}}},audit:[],academicPeriods:[{year:"2026",term:"Term 3",status:"Open"}]};
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
function audit(action){db.audit.unshift({id:uid("AU"),user:currentUser?.username||"system",action,date:new Date().toISOString()});db.audit=db.audit.slice(0,500);save()}
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

let currentPage="Dashboard"; function show(page){currentPage=page;document.getElementById("pageTitle").textContent=page;document.querySelectorAll(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));document.getElementById("period").textContent=`${db.settings.term}, ${db.settings.year} • ${db.settings.school}`;window.scrollTo(0,0);({Dashboard:dashboard,Learners,Teachers,Marks,Rankings,Attendance,Reports,Performance,Fees,Timetable,Subjects,Settings}[page]||dashboard)()}
function stat(a,b,c){return `<div class="card stat"><h3>${c} ${a}</h3><div class="num">${b}</div></div>`}
function dashboard(){let paid=db.payments.filter(p=>p.term===db.settings.term&&String(p.year)===String(db.settings.year)).reduce((a,b)=>a+Number(b.amount||0),0),expected=db.learners.reduce((a,l)=>a+feeFor(l.class),0);document.getElementById("content").innerHTML=`<div class="grid">${stat("Learners",db.learners.length,"👨‍🎓")}${stat("ECDE",db.learners.filter(l=>ecde.includes(l.class)).length,"🌱")}${stat("Primary",db.learners.filter(l=>!ecde.includes(l.class)&&!junior.includes(l.class)).length,"📚")}${stat("Junior",db.learners.filter(l=>junior.includes(l.class)).length,"🎓")}</div><div class="grid">${stat("Teachers",db.teachers.length,"👩‍🏫")}${stat("Fees Collected","KSh "+paid.toLocaleString(),"💰")}${stat("Outstanding","KSh "+Math.max(expected-paid,0).toLocaleString(),"📌")}${stat("Current Term",db.settings.term,"🗓️")}</div><div class="two"><div class="card"><h2>Learners by Class</h2><div class="chartbox"><canvas id="classChart"></canvas></div></div><div class="card"><h2>Fee Status</h2><div class="chartbox"><canvas id="feeChart"></canvas></div></div></div><div class="card"><h2>Quick Actions</h2><div class="toolbar"><button onclick="show('Learners')">Add Learner</button><button onclick="show('Marks')">Enter Marks</button><button onclick="show('Fees')">Record Fees</button><button onclick="show('Timetable')">Generate Timetable</button><button onclick="show('Reports')">Generate Report</button><button onclick="show('Settings')">Security</button></div></div>`;new Chart(classChart,{type:"bar",data:{labels:classes,datasets:[{label:"Learners",data:classes.map(c=>db.learners.filter(l=>l.class===c).length)}]},options:{responsive:true,maintainAspectRatio:false}});new Chart(feeChart,{type:"doughnut",data:{labels:["Collected","Outstanding"],datasets:[{data:[paid,Math.max(expected-paid,0)]}]},options:{responsive:true,maintainAspectRatio:false}})}
function Learners(){let q=document.getElementById("lq")?.value||"";let rows=db.learners.filter(l=>(l.name+" "+l.adm+" "+l.class).toLowerCase().includes(q.toLowerCase())).map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td>${esc(l.gender)}</td><td><span class="badge">${esc(l.class)}</span></td><td>${esc(l.parent)}</td><td><button class="light" onclick="learnerForm('${l.id}')">Edit</button> <button class="danger" onclick="archiveLearner('${l.id}')">Archive</button></td></tr>`).join("");document.getElementById("content").innerHTML=`<div class="card"><div class="section-title"><h2>Learner Register</h2><div class="toolbar"><input id="lq" placeholder="Search name/admission/class" value="${esc(q)}" oninput="Learners()"><button onclick="learnerForm()">+ Add Learner</button><button class="light" onclick="printClassList()">Print Class List</button></div></div><div class="tablewrap"><table class="table"><thead><tr><th>#</th><th>Admission</th><th>Name</th><th>Gender</th><th>Class</th><th>Parent/Guardian</th><th>Actions</th></tr></thead><tbody>${rows||'<tr><td colspan=7>No learners found.</td></tr>'}</tbody></table></div></div>`}
function learnerForm(id=""){let x=db.learners.find(a=>a.id===id)||{adm:"",name:"",gender:"Male",class:"Grade 1",dob:"",parent:"",phone:"",address:""};openModal(`<h2>${id?"Edit":"Add"} Learner</h2><div class="formgrid">${field("Admission Number","adm",x.adm)}${field("Full Name","name",x.name)}${field("Gender","gender",x.gender,"select",["Male","Female"])}${field("Class","class",x.class,"select",classes)}${field("Date of Birth","dob",x.dob,"date")}${field("Parent/Guardian","parent",x.parent)}${field("Phone","phone",x.phone)}${field("Address","address",x.address)}</div><div class="toolbar"><button onclick="saveLearner('${id}')">Save</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`)}
function saveLearner(id){let adm=v("adm"),name=v("name"),c=v("class");if(!adm||!name){toast("Admission number and name are required");return}if(db.learners.some(l=>l.adm===adm&&l.id!==id)){toast("Admission number already exists");return}let x={id:id||uid("L"),adm,name,gender:v("gender"),class:c,dob:v("dob"),parent:v("parent"),phone:v("phone"),address:v("address"),status:"Active"};let i=db.learners.findIndex(l=>l.id===id);if(i>=0)db.learners[i]=x;else db.learners.push(x);save();audit(id?"Learner edited":"Learner added");closeModal();Learners();toast("Learner saved")}
function archiveLearner(id){if(confirm("Archive this learner?")){let l=db.learners.find(x=>x.id===id);if(l)l.status="Archived";save();audit("Learner archived");Learners()}}
function printClassList(){openModal(`<h2>Print Class List</h2>${field("Class","pc","Grade 1","select",classes)}<div class="toolbar"><button onclick="renderClassList()">Generate</button></div><div id="classListOut"></div>`)}
function renderClassList(){let c=v("pc"),ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived");document.getElementById("classListOut").innerHTML=`<div class="report" style="margin-top:15px"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>CLASS LIST — ${esc(c)}</p><p>${esc(db.settings.term)}, ${db.settings.year}</p></div><table><tr><th>No.</th><th>Admission</th><th>Learner Name</th><th>Gender</th><th>Parent/Guardian</th><th>Phone</th></tr>${ls.map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td>${esc(l.gender)}</td><td>${esc(l.parent)}</td><td>${esc(l.phone)}</td></tr>`).join("")}</table></div><button class="no-print" onclick="window.print()">Print A4</button>`}
function Teachers(){let rows=db.teachers.map((t,i)=>`<tr><td>${i+1}</td><td>${esc(t.name)}</td><td>${esc(t.staff)}</td><td>${esc(t.role)}</td><td>${esc(t.subjects)}</td><td>${esc(t.classes)}</td><td>${esc(t.phone)}</td></tr>`).join("");document.getElementById("content").innerHTML=`<div class="card"><div class="section-title"><h2>Teacher Register</h2><button onclick="teacherForm()">+ Add Teacher</button></div><div class="tablewrap"><table class="table"><tr><th>#</th><th>Name</th><th>Staff No.</th><th>Role</th><th>Subjects</th><th>Classes</th><th>Phone</th></tr>${rows||"<tr><td colspan=7>No teachers yet.</td></tr>"}</table></div></div>`}
function teacherForm(){openModal(`<h2>Add Teacher</h2><div class="formgrid">${field("Full Name","name")}${field("Staff Number","staff")}${field("Role","role","Teacher","select",["Teacher","Class Teacher","Headteacher","Deputy Headteacher","ECDE Teacher","Accountant/Bursar"])}${field("Subjects","subjects")}${field("Classes","classes")}${field("Phone","phone")}</div><div class="toolbar"><button onclick="saveTeacher()">Save</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`)}
function saveTeacher(){db.teachers.push({id:uid("T"),no:Math.max(0,...(db.teachers||[]).map(t=>Number(t.no)||0))+1,name:v("name"),staff:v("staff"),role:v("role"),subjects:v("subjects"),classes:v("classes"),phone:v("phone")});save();audit("Teacher added");closeModal();Teachers();toast("Teacher saved")}
function removeTeacherForm(){const opts=(db.teachers||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.no?String(t.no)+" — ":"")}${esc(t.name)}${t.staff?" — "+esc(t.staff):""}</option>`).join("");if(!opts){toast("No teachers to remove");return}openModal(`<h2>Remove Teacher</h2><p class="small">Removing a teacher also removes their teaching assignments and timetable lessons. This cannot be undone.</p><div class="formgrid">${field("Teacher to remove","removeTeacherId","","select",[])}</div><div class="toolbar"><button class="danger" onclick="removeSelectedTeacher()">Remove Teacher</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`);const s=document.getElementById("removeTeacherId");if(s)s.innerHTML=opts}
function removeSelectedTeacher(){const id=v("removeTeacherId");removeTeacher(id)}
function removeTeacher(id){const t=teacherById(id);if(!t){toast("Teacher not found");return}if(!confirm(`Remove ${t.name}? Their teaching assignments and timetable lessons will also be removed.`))return;db.teachers=(db.teachers||[]).filter(x=>x.id!==id);db.teacherLoads=(db.teacherLoads||[]).filter(x=>x.teacherId!==id);db.timetable=(db.timetable||[]).filter(x=>x.teacherId!==id && x.teacher!==t.name);save();audit("Teacher removed: "+t.name);closeModal();Teachers();toast("Teacher removed")}

function Exams(){let rows=db.exams.map(e=>`<tr><td>${esc(e.name)}</td><td>${esc(e.term)}</td><td>${e.year}</td></tr>`).join("");document.getElementById("content").innerHTML=`<div class="card"><h2>Assessments</h2><div class="formgrid">${field("Assessment name","en","Term Assessment")}${field("Term","et",db.settings.term)}${field("Year","ey",db.settings.year,"number")}</div><button onclick="addExam()">Create Assessment</button><div class="tablewrap" style="margin-top:15px"><table class="table"><tr><th>Name</th><th>Term</th><th>Year</th></tr>${rows}</table></div></div>`}
function addExam(){db.exams.push({id:uid("EX"),name:v("en"),term:v("et"),year:v("ey")});save();toast("Assessment created")}
function Marks(){let e=db.exams[0]?.id||"",c="Grade 1",s=subjectsFor(c)[0]||"";document.getElementById("content").innerHTML=`<div class="card"><h2>Marks Entry</h2><div class="formgrid">${field("Assessment","mex",e,"select",db.exams.map(x=>x.id))}${field("Class","mclass",c,"select",classes)}${field("Subject","msub",s,"select",subjectsFor(c))}</div><div class="toolbar"><button onclick="loadMarks()">Load Learners</button><button class="success" onclick="saveMarks()">Save Marks</button></div><div id="marktable" class="tablewrap" style="margin-top:15px"></div></div>`}
function loadMarks(){let c=v("mclass"),s=v("msub"),e=v("mex"),ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived");document.getElementById("marktable").innerHTML=`<table class="table"><tr><th>Admission</th><th>Learner</th><th>Marks / 50</th><th>Grade</th></tr>${ls.map(l=>{let m=db.marks.find(x=>x.learner===l.id&&x.exam===e&&x.subject===s);return `<tr><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td><input class="markinput" data-id="${l.id}" value="${m?.mark??""}" type="number" min="0" max="50" oninput="this.parentElement.nextElementSibling.textContent=this.value===''?'':grade(this.value)"></td><td>${m?grade(m.mark):""}</td></tr>`}).join("")||"<tr><td colspan=4>No learners.</td></tr>"}</table>`}
function saveMarks(){let e=v("mex"),c=v("mclass"),s=v("msub");document.querySelectorAll(".markinput").forEach(inp=>{let i=db.marks.findIndex(m=>m.learner===inp.dataset.id&&m.exam===e&&m.subject===s),val=inp.value;if(val===""){if(i>=0)db.marks.splice(i,1);return}let o={id:i>=0?db.marks[i].id:uid("M"),learner:inp.dataset.id,class:c,subject:s,exam:e,mark:Number(val)};if(i>=0)db.marks[i]=o;else db.marks.push(o)});save();audit("Marks saved");toast("Marks saved")}
function calcLearner(lid,exam){let l=db.learners.find(x=>x.id===lid),e=db.exams.find(x=>x.id===exam)||{},ss=subjectsForPeriod(l.class,e.year,e.term),vals=db.marks.filter(m=>m.learner===lid&&m.exam===exam&&ss.includes(m.subject)).map(m=>Number(m.mark));let total=vals.reduce((a,b)=>a+b,0),avg=vals.length?total/vals.length:0;return {total,avg,n:vals.length}}
function Rankings(){document.getElementById("content").innerHTML=`<div class="card"><h2>Class Ranking — Overall Average</h2><div class="formgrid">${field("Assessment","rex",db.exams[0]?.id||"","select",db.exams.map(x=>x.id))}${field("Class","rc","Grade 1","select",classes)}</div><div class="toolbar"><button onclick="renderOverallRanking()">Show Ranking</button><button class="light" onclick="window.print()">Print</button></div><div id="rankout"></div></div>`}
function renderOverallRanking(){let c=v("rc"),e=v("rex"),ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived").map(l=>({l,...calcLearner(l.id,e)})).filter(x=>x.n>0).sort((a,b)=>b.avg-a.avg);let rows=ls.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.l.adm)}</td><td>${esc(x.l.name)}</td><td>${x.n}</td><td>${x.total}</td><td>${x.avg.toFixed(2)}</td><td>${grade(x.avg)}</td></tr>`).join("");document.getElementById("rankout").innerHTML=`<div class="report" style="margin-top:15px"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>${esc(c)} — OVERALL RANKING</p><p>Ranking is based on average of applicable subjects</p></div><table><tr><th>Position</th><th>Admission</th><th>Learner</th><th>Subjects</th><th>Total</th><th>Average</th><th>Grade</th></tr>${rows||"<tr><td colspan=7>No valid marks.</td></tr>"}</table></div>`}
function Attendance(){document.getElementById("content").innerHTML=`<div class="card"><h2>Attendance</h2><div class="formgrid">${field("Class","ac","Grade 1","select",classes)}${field("Date","ad",new Date().toISOString().slice(0,10),"date")}</div><button onclick="loadAttendance()">Load Learners</button><div id="attout" class="tablewrap" style="margin-top:15px"></div></div>`}
function loadAttendance(){let c=v("ac"),d=v("ad"),ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived");document.getElementById("attout").innerHTML=`<table class="table"><tr><th>Admission</th><th>Learner</th><th>Status</th></tr>${ls.map(l=>{let a=db.attendance.find(x=>x.learner===l.id&&x.date===d);return `<tr><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td><select onchange="setAtt('${l.id}','${c}','${d}',this.value)">${["Present","Absent","Late","Excused"].map(s=>`<option ${a?.status===s?"selected":""}>${s}</option>`).join("")}</select></td></tr>`}).join("")}</table>`}
function setAtt(learner,c,date,status){let i=db.attendance.findIndex(a=>a.learner===learner&&a.date===date);let o={id:i>=0?db.attendance[i].id:uid("A"),learner,class:c,date,status};if(i>=0)db.attendance[i]=o;else db.attendance.push(o);save()}
function reportLearners(){
 let c=v("rc"),q=(document.getElementById("reportSearch")?.value||"").trim().toLowerCase();
 return db.learners.filter(l=>l.status!=="Archived"&&(!c||l.class===c)&&((l.name+" "+l.adm+" "+l.class).toLowerCase().includes(q))).sort((a,b)=>a.name.localeCompare(b.name));
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
 document.getElementById("content").innerHTML=`<div class="card"><h2>Individual Learner Reports</h2>
 <p class="small">Search by class/grade first, then choose a learner from the complete list. You can also search by learner name or admission number.</p>
 <div class="formgrid">
  ${field("Grade / Class","rc","","select",[""].concat(classes))}
  <div class="field"><label>Search Learner</label><input id="reportSearch" placeholder="Type learner name or admission no." oninput="loadReportLearners()"></div>
  <div class="field"><label>Assessment</label><select id="f_re">${db.exams.map(x=>`<option value="${esc(x.id)}">${esc(x.name||x.id)} — ${esc(x.term||"")} ${esc(String(x.year||""))}</option>`).join("")}</select></div>
 </div>
 <div class="toolbar" style="margin-top:12px">
  <button onclick="loadReportLearners()">🔎 Search / Load Learners</button>
  <button class="light" onclick="clearReportSearch()">Clear</button>
  <span id="reportCount" class="small" style="padding:10px 0"></span>
 </div>
 <div class="field" style="margin-top:12px"><label>Select Learner</label><select id="f_rl"><option value="">— Select learner —</option></select></div>
 <div class="toolbar" style="margin-top:12px"><button onclick="showReport()">Generate Report</button></div>
 <div id="reportout" style="margin-top:15px"></div></div>`;
 document.getElementById("f_rc").onchange=loadReportLearners;
 loadReportLearners();
}
function clearReportSearch(){let q=document.getElementById("reportSearch");if(q)q.value="";let c=document.getElementById("f_rc");if(c)c.value="";loadReportLearners()}
function downloadReportPDF(){
 const target=document.getElementById("reportPdfTarget");
 if(!target){toast("Generate the report first");return}
 if(typeof html2pdf!=="function"){toast("PDF downloader is not available. Use Print A4 and choose Save as PDF.");return}
 const name=(document.getElementById("reportPdfName")?.textContent||"learner-report").trim().replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase()||"learner-report";
 html2pdf().set({margin:7,filename:name+".pdf",image:{type:"jpeg",quality:0.98},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"},pagebreak:{mode:["css","legacy"]}}).from(target).save();
}
function showReport(){
 let l=db.learners.find(x=>x.id===v("rl")),e=v("re");
 if(!l){toast("Select a learner");return}
 let ex=db.exams.find(x=>x.id===e)||{},ss=subjectsForPeriod(l.class,ex.year,ex.term);
 let ms=ss.map(s=>({s,m:db.marks.find(x=>x.learner===l.id&&x.exam===e&&x.subject===s)?.mark}));
 let vals=ms.filter(x=>x.m!==undefined).map(x=>Number(x.m)),total=vals.reduce((a,b)=>a+b,0),avg=vals.length?total/vals.length:0;
 let cls=db.learners.filter(x=>x.class===l.class&&x.status!=="Archived").map(x=>({id:x.id,...calcLearner(x.id,e)})).filter(x=>x.n>0).sort((a,b)=>b.avg-a.avg);
 let idx=cls.findIndex(x=>x.id===l.id),pos=idx>=0?`${idx+1}/${db.learners.filter(x=>x.class===l.class&&x.status!=="Archived").length}`:"—";
 let sorted=ms.filter(x=>x.m!==undefined).sort((a,b)=>b.m-a.m),strengths=sorted.slice(0,2).map(x=>x.s),weak=sorted.slice(-2).map(x=>x.s);
 let rec=vals.length?`The learner has shown stronger performance in ${strengths.join(" and ")}. Continued practice and focused support are recommended in ${weak.join(" and ")}.`:`Marks have not yet been entered.`;
 let rows=ms.map(x=>`<tr><td>${esc(x.s)}</td><td>${x.m??"—"}</td><td>${x.m===undefined?"—":grade(x.m)}</td></tr>`).join("");
 let school=esc(db.settings.school||"Kapnanda Primary and Junior School"), term=esc(ex.term||db.settings.term), year=esc(String(ex.year||db.settings.year));
 document.getElementById("reportout").innerHTML=`<div id="reportPdfTarget" class="printreport"><div class="prhead"><div class="prschool">${school}</div><div class="prsubtitle">LEARNER PROGRESS REPORT</div><div class="prmeta">${term} • ${year}</div></div><div class="prstudent"><div><b>LEARNER</b><br><span id="reportPdfName">${esc(l.name)}</span></div><div><b>ADMISSION</b><br>${esc(l.adm)}</div><div><b>CLASS</b><br>${esc(l.class)}</div><div><b>GENDER</b><br>${esc(l.gender||"—")}</div></div><table class="prmarks"><tr><th>SUBJECT</th><th>MARK / 50</th><th>GRADE</th></tr>${rows}</table><div class="prstats"><div><b>TOTAL</b><strong>${total}</strong></div><div><b>SUBJECTS</b><strong>${vals.length}</strong></div><div><b>AVERAGE</b><strong>${avg.toFixed(2)}</strong></div><div><b>GRADE</b><strong>${vals.length?grade(avg):"—"}</strong></div><div><b>POSITION</b><strong>${pos}</strong></div></div><div class="prrec"><b>Teacher's Comment</b><br>${esc(rec)}</div><div class="prsign"><div>Class Teacher<br>____________________<br>Signature / Date</div><div>Headteacher<br>____________________<br>Signature / Date</div><div>Parent / Guardian<br>____________________<br>Signature / Date</div></div></div><div class="toolbar no-print" style="margin-top:10px"><button onclick="downloadReportPDF()">⬇️ Download Report PDF</button><button class="light" onclick="window.print()">🖨️ Print A4 Report</button></div>`;
}

function Performance(){let e=db.exams[0]?.id||"",data=classes.map(c=>{let a=db.learners.filter(l=>l.class===c).map(l=>calcLearner(l.id,e)).filter(x=>x.n);return a.length?a.reduce((s,x)=>s+x.avg,0)/a.length:0});document.getElementById("content").innerHTML=`<div class="card"><h2>School Performance</h2><div class="chartbox"><canvas id="perf"></canvas></div></div>`;new Chart(perf,{type:"bar",data:{labels:classes,datasets:[{label:"Average",data}]},options:{responsive:true,maintainAspectRatio:false,y:{beginAtZero:true,max:50}}})}
function Fees(){ensurePeriodConfig();let rows=db.learners.filter(l=>l.status!=="Archived").map(l=>{let paid=db.payments.filter(p=>p.learner===l.id&&p.term===db.settings.term&&String(p.year)===String(db.settings.year)).reduce((a,b)=>a+Number(b.amount||0),0),due=feeFor(l.class),bal=Math.max(due-paid,0);return `<tr><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td>${esc(l.class)}</td><td>KSh ${due.toLocaleString()}</td><td>KSh ${paid.toLocaleString()}</td><td>KSh ${bal.toLocaleString()}</td><td><button onclick="paymentForm('${l.id}')">Record</button> <button class="light" onclick="managePayments('${l.id}')">Edit/Remove Fees</button> <button class="light" onclick="learnerForm('${l.id}')">Edit Learner</button> <button class="danger" onclick="removeLearnerFromFees('${l.id}')">Remove Learner</button></td></tr>`}).join("");document.getElementById("content").innerHTML=`<div class="card"><h2>Fees — ${esc(db.settings.term)}, ${esc(db.settings.year)}</h2><p class="small">Fees are stored separately for every academic year and term. You can now edit/remove payments and edit/remove learners directly from this section.</p><div class="grid"><div class="kpi"><b>ECDE</b><br>PP1 & PP2</div><div class="kpi"><b>Primary</b><br>Grades 1–6</div><div class="kpi"><b>Junior</b><br>Grades 7–9</div><div class="kpi"><b>Current Period</b><br>${esc(db.settings.term)} ${esc(db.settings.year)}</div></div><div class="toolbar" style="margin:15px 0"><button onclick="feeSettings()">Configure Current Term Fees</button><button class="light" onclick="window.print()">Print</button></div><div class="tablewrap"><table class="table"><tr><th>Admission</th><th>Learner</th><th>Class</th><th>Due</th><th>Paid</th><th>Balance</th><th>Actions</th></tr>${rows||"<tr><td colspan=7>No learners.</td></tr>"}</table></div></div>`}
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
function Timetable(){document.getElementById("content").innerHTML=`<div class="card"><h2>Smart Timetable Generator</h2><p>Separate engines for ECDE, Lower Primary, Upper Primary and Junior. The generator prevents class/teacher double-booking and respects section-specific lesson duration/breaks.</p><div class="formgrid">${field("Section","ts","Junior","select",["ECDE","Lower Primary","Upper Primary","Junior"])}${field("Class","tc","Grade 7","select",classes)}${field("Teacher","tt","", "select",[""].concat(db.teachers.map(t=>t.name)))}</div><div class="toolbar"><button onclick="generateTimetable()">Generate Class Timetable</button><button class="light" onclick="teacherTimetable()">Teacher Timetable</button><button class="light" onclick="window.print()">Print</button></div><div id="tout" style="margin-top:15px"></div></div>`}
function timing(c){if(ecde.includes(c))return {dur:30,start:"08:30",end:"12:40",breaks:[["10:00","10:20"]],lunch:null};if(junior.includes(c))return {dur:40,start:"08:00",end:"15:30",breaks:[["10:00","10:30"],["11:50","12:00"]],lunch:["12:00","13:00"]};return {dur:35,start:"08:00",end:"15:30",breaks:[["09:30","09:50"],["11:00","11:30"]],lunch:["12:40","13:40"]}}
function mins(s){let [h,m]=s.split(":").map(Number);return h*60+m} function hh(n){let h=Math.floor(n/60),m=n%60;return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")}
function makeSlots(c){let t=timing(c),out=[];for(let d of days){let cur=mins(t.start);while(cur+ t.dur<=mins(t.end)){let end=cur+t.dur, blocked=false;for(let b of t.breaks){let bs=mins(b[0]),be=mins(b[1]);if(cur<be&&end>bs)blocked=true}if(t.lunch&&cur<mins(t.lunch[1])&&end>mins(t.lunch[0]))blocked=true;if(!blocked)out.push({day:d,time:`${hh(cur)}–${hh(end)}`});cur=end}}return out}
function generateTimetable(){let c=v("tc"),teacher=v("tt"),ss=subjectsFor(c);if(!ss.length){toast("No active subjects for this class");return}let slots=makeSlots(c),freq={};ss.forEach(s=>freq[s]=defaultFreq[s]||4);let assignments=[],used=new Set(),ti=0;for(const s of ss){for(let n=0;n<freq[s];n++){let placed=false;for(let k=0;k<slots.length;k++){let sl=slots[(ti+k)%slots.length],key=sl.day+"|"+sl.time;if(!used.has(key)){assignments.push({id:uid("TT"),class:c,subject:s,teacher:teacher||"Class Teacher",day:sl.day,time:sl.time});used.add(key);ti=(ti+k+1)%slots.length;placed=true;break}}if(!placed)break}}db.timetable=db.timetable.filter(x=>x.class!==c).concat(assignments);save();audit("Timetable generated for "+c);renderTimetable(c);toast("Timetable generated")}
function renderTimetable(c){let rows=days.map(d=>{let a=db.timetable.filter(x=>x.class===c&&x.day===d);return `<tr><th>${d}</th><td>${a.map(x=>`<span class="badge" style="margin:3px">${esc(x.time)} • ${esc(x.subject)} • ${esc(x.teacher)}</span>`).join(" ")||"FREE"}</td></tr>`}).join("");document.getElementById("tout").innerHTML=`<div class="report"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>${esc(c)} TIMETABLE</p><p>${esc(db.settings.term)}, ${db.settings.year}</p></div><table><tr><th>Day</th><th>Lessons</th></tr>${rows}</table></div>`}
function teacherTimetable(){let n=v("tt");if(!n){toast("Select a teacher");return}let a=db.timetable.filter(x=>x.teacher===n),rows=days.map(d=>`<tr><th>${d}</th><td>${a.filter(x=>x.day===d).map(x=>`${esc(x.time)} — ${esc(x.class)} — ${esc(x.subject)}`).join("<br>")||"FREE"}</td></tr>`).join("");document.getElementById("tout").innerHTML=`<div class="report"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>TEACHER TIMETABLE</p><p>${esc(n)}</p></div><table><tr><th>Day</th><th>Schedule</th></tr>${rows}</table></div>`}
function Settings(){document.getElementById("content").innerHTML=`<div class="card"><h2>School Settings</h2><div class="formgrid">${field("School name","school",db.settings.school)}${field("Motto","motto",db.settings.motto)}${field("Current term","term",db.settings.term,"select",["Term 1","Term 2","Term 3"])}${field("Academic year","year",db.settings.year,"number")}${field("Phone","phone",db.settings.phone)}${field("Email","email",db.settings.email)}</div><button onclick="saveSchoolSettings()">Save School Settings</button></div><div class="card"><h2>Academic Periods</h2><p class="small">Each year/term has its own fee structure and subject combination.</p><div class="formgrid">${field("New year","py",db.settings.year,"number")}${field("New term","pt","Term 1","select",["Term 1","Term 2","Term 3"])}${field("Status","ps","Open","select",["Open","Closed"])}</div><button onclick="addAcademicPeriod()">Add / Open Period</button><div class="tablewrap" style="margin-top:15px"><table class="table"><tr><th>Year</th><th>Term</th><th>Status</th><th>Action</th></tr>${db.academicPeriods.map(p=>`<tr><td>${esc(p.year)}</td><td>${esc(p.term)}</td><td>${esc(p.status||"Open")}</td><td><button class="light" onclick="usePeriod('${esc(p.year)}','${esc(p.term)}')">Use</button></td></tr>`).join("")}</table></div></div><div class="card"><h2>☁️ Supabase Cloud Database</h2><p>Connection status: <b>${cloudConfigured()?"Configured":"Not configured"}</b></p><p class="small">Cloud mode synchronizes the school's working data to a protected Supabase record. Supabase Auth controls access. The public browser key is safe to expose only when RLS is correctly configured.</p><div class="toolbar"><button onclick="cloudSetup()">Configure / Change Connection</button>${cloudReady?'<button class="light" onclick="cloudSave(true);toast("Cloud sync requested")">Sync Now</button>':''}</div></div><div class="card"><h2>Security</h2><p>Supabase Auth account: <b>${esc(cloudUser?.email||"Not signed in")}</b></p><p>Recovery phone: <b>${esc(db.settings.phone)}</b></p><div class="toolbar"><button onclick="securitySetup(false)">Change Password / Security</button><button class="light" onclick="forgot()">Test Password Recovery</button></div></div><div class="card"><h2>Grading Scale</h2><table class="table"><tr><th>Average</th><th>Grade</th></tr>${[["41–50","EE1"],["36–40","EE2"],["31–35","ME1"],["25–30","ME2"],["21–24.9","AE1"],["15–20","AE2"],["6–14","BE1"],["0–5","BE2"]].map(x=>`<tr><td>${x[0]}</td><td>${x[1]}</td></tr>`).join("")}</table><p class="small">Overall reports and rankings use the active subjects configured for the selected assessment period.</p></div><div class="card"><h2>Backup & Audit</h2><div class="toolbar"><button onclick="backup()">Download Backup</button><button class="light" onclick="showAudit()">View Audit Log</button></div></div>`}
function addAcademicPeriod(){let y=String(v("py")||db.settings.year),t=v("pt"),status=v("ps")||"Open";ensurePeriodConfig(y,t);let p=db.academicPeriods.find(x=>String(x.year)===y&&x.term===t);if(p)p.status=status;else db.academicPeriods.push({year:y,term:t,status});save();audit(`Academic period ${t}, ${y} created/updated`);Settings();toast(`Period ${t}, ${y} is ready`)}
function usePeriod(y,t){db.settings.year=String(y);db.settings.term=t;ensurePeriodConfig();save();audit(`Current period changed to ${t}, ${y}`);Settings();toast(`Current period: ${t}, ${y}`)}
function saveSchoolSettings(){db.settings.school=v("school");db.settings.motto=v("motto");db.settings.term=v("term");db.settings.year=v("year");db.settings.phone=v("phone");db.settings.email=v("email");ensurePeriodConfig();save();audit("School settings changed");show("Settings");toast("Settings saved")}
function showAudit(){openModal(`<h2>Audit Log</h2><div class="tablewrap"><table class="table"><tr><th>Date</th><th>User</th><th>Action</th></tr>${db.audit.slice(0,100).map(a=>`<tr><td>${esc(a.date)}</td><td>${esc(a.user)}</td><td>${esc(a.action)}</td></tr>`).join("")}</table></div>`)}
async function backup(){if(cloudReady)await cloudSave(true);let blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="kapnanda-primary-junior-school-backup.json";a.click();audit("Backup created")}
if(cloudConfigured()){
  if(!localStorage.getItem(CLOUD_KEY)) localStorage.setItem(CLOUD_KEY,JSON.stringify(DEFAULT_SUPABASE_CONFIG));
  initCloud();
  document.getElementById("loginMode").textContent="Supabase mode — sign in with your Supabase Auth email.";
  document.getElementById("loginUserLabel").textContent="Supabase Email";
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
  if(!db.settings.school || /kapnanda/i.test(db.settings.school)) db.settings.school="Kapnanda Primary and Junior School";
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
function schoolTitleForClass(c){return ecde.includes(c)?"KAPNANDA ECDE SCHOOL":junior.includes(c)?"KAPNANDA JUNIOR SCHOOL":"KAPNANDA PRIMARY SCHOOL"}
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
  if(ecde.includes(c))return{slots:["08:30–09:00","09:00–09:30","09:30–10:00","10:20–10:50","10:50–11:20","11:20–11:50","12:00–12:30"],label:"30-MINUTE LESSONS • START 8:30 AM",breaks:[],lunch:null,prep:null,activity:null};
  // Lower and Upper Primary use 35-minute lessons. Junior uses 40-minute
  // lessons. Fixed break/lunch times are respected; gaps caused by those
  // fixed times are not treated as shortened lessons.
  if(junior.includes(c)) return{
    slots:["08:00–08:40","08:40–09:20","09:50–10:30","10:30–11:10","11:30–12:10","14:00–14:40","14:40–15:20"],
    label:"40-MINUTE LESSONS • START 8:00 AM",
    breaks:[["09:30","09:50"],["11:00","11:30"]],
    lunch:["12:40","13:40"],
    prep:["13:40","14:00"],
    activity:"15:30+"
  };
  const slots=[
    "08:00–08:35","08:35–09:10",
    "09:50–10:25","10:25–11:00",
    "11:30–12:05","12:05–12:40"
  ];
  if(upper.includes(c)) slots.push("14:00–14:35","14:35–15:10");
  return{
    slots,
    label:"35-MINUTE LESSONS • START 8:00 AM",
    breaks:[["09:30","09:50"],["11:00","11:30"]],
    lunch:["12:40","13:40"],
    prep:["13:40","14:00"],
    activity:upper.includes(c)?"15:30+":null
  };
}
function scheduleAssignments(targetClasses){
  const keep=(db.timetable||[]).filter(x=>!targetClasses.includes(x.class)||!periodMatchV3(x));
  const teacherBusy=new Set(keep.filter(x=>x.teacherId).map(x=>slotKey(x.day,x.time)+"|"+x.teacherId));
  const classBusy=new Set(keep.map(x=>slotKey(x.day,x.time)+"|"+x.class));
  const result=[],failures=[],units={};targetClasses.forEach(c=>{units[c]=[];subjectRecordsFor(c).filter(a=>a.active!==false).forEach(x=>{const n=Math.max(1,Math.min(20,Number(x.weeklyLessons||defaultFreq[x.name]||4)));for(let i=0;i<n;i++)units[c].push({class:c,subject:x.name,teacherIds:availableTeachers(c,x.name),doubleLesson:!!x.doubleLesson,uid:uid("U")})});units[c].sort((a,b)=>a.teacherIds.length-b.teacherIds.length)});
  const baseCfg=timetableConfig(targetClasses[0]);const slots=days.flatMap(day=>baseCfg.slots.map(time=>({day,time})));
  const subjectDay={};
  for(const sl of slots){
    const active=targetClasses.filter(c=>units[c].length&&!classBusy.has(slotKey(sl.day,sl.time)+"|"+c));
    const candidates=c=>{const out=[];for(const u of units[c]){const tids=u.teacherIds.length?u.teacherIds:[""];for(const tid of tids){if(tid&&teacherBusy.has(slotKey(sl.day,sl.time)+"|"+tid))continue;const dc=subjectDay[c+"|"+u.subject+"|"+sl.day]||0;out.push({u,tid,score:dc*100+u.teacherIds.length*5-(u.doubleLesson?3:0)})}}return out.sort((a,b)=>a.score-b.score).slice(0,60)};
    function match(left,chosen=[],used=new Set()){if(!left.length)return chosen;let bc=null,bo=null;for(const c of left){const opts=candidates(c).filter(o=>!o.tid||!used.has(o.tid));if(!bo||opts.length<bo.length){bc=c;bo=opts}if(!opts.length)return null}for(const o of bo){if(o.tid)used.add(o.tid);chosen.push(o);const r=match(left.filter(c=>c!==bc),chosen,used);if(r)return r;chosen.pop();if(o.tid)used.delete(o.tid)}return null}
    let chosen=match(active);if(!chosen&&active.length>1){const ordered=active.slice().sort((a,b)=>candidates(a).length-candidates(b).length);for(let n=ordered.length-1;n>=1&&!chosen;n--)chosen=match(ordered.slice(0,n))}
    for(const o of(chosen||[])){const idx=units[o.u.class].findIndex(u=>u.uid===o.u.uid);if(idx<0)continue;units[o.u.class].splice(idx,1);const rec={id:uid("TT"),class:o.u.class,subject:o.u.subject,teacherId:o.tid,teacher:teacherNameById(o.tid)||"Unassigned",day:sl.day,time:sl.time,year:String(db.settings.year),term:db.settings.term};result.push(rec);classBusy.add(slotKey(rec.day,rec.time)+"|"+rec.class);if(o.tid)teacherBusy.add(slotKey(rec.day,rec.time)+"|"+o.tid);subjectDay[rec.class+"|"+rec.subject+"|"+rec.day]=(subjectDay[rec.class+"|"+rec.subject+"|"+rec.day]||0)+1}
  }
  for(const c of targetClasses)for(const u of units[c])failures.push(`${c}: ${u.subject}`);
  db.timetable=keep.concat(result);return{result,failures};
}
function timetableGrid(c){
  const cfg=timetableConfig(c),title=schoolTitleForClass(c),periodTT=(db.timetable||[]).filter(x=>x.class===c&&periodMatchV3(x));
  const cell=(day,time)=>{const x=periodTT.find(a=>a.day===day&&a.time===time);return x?`<div class="ttcell"><b>${esc(timetableSubjectLabel(x))}</b><span>${esc(x.teacher||"Unassigned")}</span></div>`:`<div class="ttfree">—</div>`};
  const rows=[`<tr><th class="timecol">TIME</th>${days.map(d=>`<th>${d.toUpperCase()}</th>`).join("")}</tr>`];
  const special=(label,cls)=>`<tr class="ttspecial ${cls||""}"><td colspan="6">${label}</td></tr>`;
  cfg.slots.forEach(time=>{
    rows.push(`<tr><th class="timecol">${time}</th>${days.map(d=>`<td>${cell(d,time)}</td>`).join("")}</tr>`);
    if(!ecde.includes(c)&&time===(junior.includes(c)?"08:40–09:20":"08:35–09:10")){
      rows.push(special(junior.includes(c)?"CLASS ACTIVITY / READING • 9:20–9:30 AM":"CLASS ACTIVITY / READING • 9:10–9:30 AM","routine"));
      rows.push(special("SHORT BREAK • 9:30–9:50 AM","break"));
    }
    if(!ecde.includes(c)&&time===(junior.includes(c)?"10:30–11:10":"10:25–11:00")) rows.push(special("SECOND BREAK • 11:00–11:30 AM","break"));
    if(!ecde.includes(c)&&time===(junior.includes(c)?"11:30–12:10":"12:05–12:40")){
      if(junior.includes(c)) rows.push(special("CLASS ACTIVITY / READING • 12:10–12:40 PM","routine"));
      rows.push(special("LUNCH • 12:40–1:40 PM","lunch"));
      rows.push(special("PERSONAL STUDIES (PREP) • 1:40–2:00 PM","prep"));
    }
    if((upper.includes(c)||junior.includes(c))&&time===(junior.includes(c)?"14:40–15:20":"14:35–15:10")) rows.push(special("3:30 PM+ • AFTERNOON ACTIVITIES","activity"));
  });
  return `<div class="ttprint"><div class="tthead"><div class="ttbrand">${title}</div><div class="ttsub">${esc(c)} — CBC CLASS TIMETABLE • ${esc(db.settings.year)}</div><div class="ttmeta">${cfg.label} • FIXED BREAKS 9:30–9:50 & 11:00–11:30 • LUNCH 12:40–1:40 • PREP 1:40–2:00 • AFTERNOON ACTIVITIES FROM 3:30 PM</div></div><table class="ttable"><tbody>${rows.join("")}</tbody></table><div class="ttfooter"><b>TEACHER KEY</b><div>${(db.teachers||[]).map((t,i)=>`<span><strong>${i+1}</strong> — ${esc(t.name)}</span>`).join(" • ")||"No teachers configured"}</div><div class="ttlegend"><b>SUBJECT KEY:</b> ENG = English • KISW = Kiswahili • MATH = Mathematics • IS = Integrated Science • SST = Social Studies/Science & Technology • AGR = Agriculture • CAS = Creative Arts & Sports • PT = Pre-Technical Studies • CRE = Religious Education</div><div class="ttlegend">MON/TUE/THU: GAMES • WED: DEBATE • FRI: GENERAL CLEANING</div></div></div>`;
}
function printElement(id){const el=document.getElementById(id);if(!el)return;el.classList.add("print-target");window.print();setTimeout(()=>el.classList.remove("print-target"),600)}
function refreshMarkSubjectsV3(){const c=document.getElementById("f_mclass")?.value,e=db.exams.find(x=>x.id===document.getElementById("f_mex")?.value),s=document.getElementById("f_msub");if(!c||!s)return;const old=s.value,opts=subjectsForPeriod(c,e?.year,e?.term);s.innerHTML=opts.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");if(opts.includes(old))s.value=old}
function Marks(){const e=db.exams.find(x=>String(x.term)===String(db.settings.term)&&String(x.year)===String(db.settings.year))?.id||db.exams[0]?.id||"",c="Grade 1",ex=db.exams.find(x=>x.id===e),s=subjectsForPeriod(c,ex?.year,ex?.term)[0]||"";document.getElementById("content").innerHTML=`<div class="card"><div class="pagehero"><div><h2>Marks Entry</h2><p>All active subjects for the selected class and assessment period are available. Changing class or assessment refreshes the subject list.</p></div><span class="badge">CBC • ${esc(db.settings.term)} ${esc(db.settings.year)}</span></div><div class="formgrid">${field("Assessment","mex",e,"select",db.exams.map(x=>x.id))}${field("Class","mclass",c,"select",classes)}${field("Subject","msub",s,"select",subjectsForPeriod(c,ex?.year,ex?.term))}</div><div class="toolbar"><button onclick="loadMarks()">Load Learners</button><button class="success" onclick="saveMarks()">Save Marks</button><button class="light" onclick="show('Subjects')">Manage Class Subjects</button></div><div id="marktable" class="tablewrap" style="margin-top:15px"></div></div>`;document.getElementById("f_mclass")?.addEventListener("change",()=>{refreshMarkSubjectsV3();document.getElementById("marktable").innerHTML=""});document.getElementById("f_mex")?.addEventListener("change",()=>{refreshMarkSubjectsV3();document.getElementById("marktable").innerHTML=""})}
function loadMarks(){const c=v("mclass"),e=v("mex"),s=v("msub"),ex=db.exams.find(x=>x.id===e),valid=subjectsForPeriod(c,ex?.year,ex?.term);if(!valid.includes(s)){toast("That subject is not active for this class in the selected assessment period");return}const ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived");document.getElementById("marktable").innerHTML=`<div class="small" style="margin-bottom:8px">${esc(c)} • ${esc(s)} • ${esc(ex?.name||"")} — enter marks out of 50.</div><table class="table marktable"><thead><tr><th>#</th><th>Admission</th><th>Learner</th><th>Marks / 50</th><th>Grade</th></tr></thead><tbody>${ls.map((l,i)=>{const m=db.marks.find(x=>x.learner===l.id&&x.exam===e&&x.subject===s);return `<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td><input class="markinput" data-id="${l.id}" value="${m?.mark??""}" type="number" min="0" max="50" step="0.01" oninput="this.closest('tr').querySelector('.gradecell').textContent=this.value===''?'':grade(this.value)"></td><td class="gradecell">${m?grade(m.mark):""}</td></tr>`}).join("")||`<tr><td colspan="5"><div class="empty">No active learners in ${esc(c)}.</div></td></tr>`}</tbody></table>`}
function saveMarks(){const e=v("mex"),c=v("mclass"),s=v("msub"),ex=db.exams.find(x=>x.id===e);if(!e||!c||!s||!subjectsForPeriod(c,ex?.year,ex?.term).includes(s)){toast("Select a valid assessment, class and subject");return}let bad=false;document.querySelectorAll(".markinput").forEach(inp=>{const val=inp.value;if(val!==""&&(Number(val)<0||Number(val)>50)){bad=true;return}const i=db.marks.findIndex(m=>m.learner===inp.dataset.id&&m.exam===e&&m.subject===s);if(val===""){if(i>=0)db.marks.splice(i,1);return}const o={id:i>=0?db.marks[i].id:uid("M"),learner:inp.dataset.id,class:c,subject:s,exam:e,mark:Number(val),year:ex?.year,term:ex?.term};if(i>=0)db.marks[i]=o;else db.marks.push(o)});if(bad){toast("Marks must be between 0 and 50");return}save();audit(`Marks saved: ${c} — ${s}`);toast(`${s} marks saved for ${c}`)}
function teacherLoadForm(id=""){const x=db.teacherLoads.find(a=>a.id===id)||{teacherId:db.teachers[0]?.id||"",class:"Grade 4",subject:"",weeklyLessons:4};const os=subjectsForPeriod(x.class),teachers=(db.teachers||[]).map(t=>`<option value="${esc(t.id)}" ${t.id===x.teacherId?"selected":""}>${esc(t.name)}${t.staff?" — "+esc(t.staff):""}</option>`).join("");openModal(`<h2>${id?"Edit":"Add"} Teaching Assignment</h2><p class="small">A teacher may teach different subjects in different classes. These assignments are used by the timetable engine.</p><div class="formgrid"><div class="field"><label>Teacher</label><select id="f_tlteacher">${teachers}</select></div>${field("Class","tlclass",x.class,"select",classes)}${field("Subject","tlsub",x.subject||os[0]||"","select",os)}${field("Lessons / week","tlfreq",x.weeklyLessons||4,"number")}</div><div class="toolbar"><button onclick="saveTeacherLoad('${id}')">Save Assignment</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`);document.getElementById("f_tlclass")?.addEventListener("change",()=>{const c=v("tlclass"),s=document.getElementById("f_tlsub"),a=subjectsForPeriod(c);s.innerHTML=a.map(q=>`<option value="${esc(q)}">${esc(q)}</option>`).join("")})}
function saveTeacherLoad(id=""){const teacherId=v("tlteacher"),c=v("tlclass"),s=v("tlsub"),weekly=Math.max(1,Math.min(20,Number(v("tlfreq")||4)));if(!teacherId||!c||!s){toast("Teacher, class and subject are required");return}if(db.teacherLoads.some(x=>x.teacherId===teacherId&&x.class===c&&x.subject.toLowerCase()===s.toLowerCase()&&x.id!==id)){toast("That teacher assignment already exists");return}const o={id:id||uid("TL"),teacherId,class:c,subject:s,weeklyLessons:weekly,active:true};const i=db.teacherLoads.findIndex(x=>x.id===id);if(i>=0)db.teacherLoads[i]=o;else db.teacherLoads.push(o);save();audit(`Teaching assignment saved: ${teacherNameById(teacherId)} — ${c} — ${s}`);closeModal();Teachers();toast("Teaching assignment saved")}
function deleteTeacherLoad(id){if(!confirm("Remove this teaching assignment?"))return;db.teacherLoads=db.teacherLoads.filter(x=>x.id!==id);save();audit("Teaching assignment removed");Teachers()}
function Teachers(){const rows=db.teachers.map((t,i)=>`<tr><td>${i+1}</td><td><b>${esc(t.name)}</b><br><span class="small">${esc(t.staff||"")}</span></td><td>${esc(t.role)}</td><td>${getTeachingLoads().filter(x=>x.teacherId===t.id).length}</td><td>${esc(t.phone||"")}</td><td><button class="light" onclick="teacherLoadForm()">+ Assignment</button> <button class="danger" onclick="removeTeacher('${t.id}')">Remove</button></td></tr>`).join("");const loads=getTeachingLoads().map(x=>`<tr><td>${esc(teacherNameById(x.teacherId))}</td><td>${esc(x.class)}</td><td>${esc(x.subject)}</td><td>${x.weeklyLessons||4}</td><td><button class="light" onclick="teacherLoadForm('${x.id}')">Edit</button> <button class="danger" onclick="deleteTeacherLoad('${x.id}')">Remove</button></td></tr>`).join("");document.getElementById("content").innerHTML=`<div class="card"><div class="pagehero"><div><h2>Teacher Register</h2><p>Explicit teacher-to-class-to-subject assignments power the multi-teacher timetable and make clashes detectable before printing.</p></div><div class="toolbar"><button onclick="teacherForm()">+ Add Teacher</button><button class="danger" onclick="removeTeacherForm()">− Remove Teacher</button><button class="success" onclick="teacherLoadForm()">+ Teaching Assignment</button></div></div><div class="tablewrap"><table class="table"><tr><th>#</th><th>Teacher</th><th>Role</th><th>Assignments</th><th>Phone</th><th>Action</th></tr>${rows||"<tr><td colspan=6>No teachers yet.</td></tr>"}</table></div></div><div class="card"><h2>Teaching Assignments</h2><div class="tablewrap"><table class="table"><tr><th>Teacher</th><th>Class</th><th>Subject</th><th>Lessons / Week</th><th>Actions</th></tr>${loads||"<tr><td colspan=5>No teaching assignments. Add them before generating a multi-teacher timetable.</td></tr>"}</table></div></div>`}
function Timetable(){const sec="Junior",cs=sectionClasses(sec),selected=cs[0]||"Grade 7",teachers=(db.teachers||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.name)}${t.staff?" — "+esc(t.staff):""}</option>`).join("");document.getElementById("content").innerHTML=`<div class="card"><div class="pagehero"><div><h2>Smart CBC Timetable</h2><p>For Upper Primary and Junior where many teachers teach different subjects. Generate one class or the whole section. The scheduler prevents a teacher from being booked in two classes at the same time.</p></div><span class="badge">Constraint-aware • Multi-teacher</span></div><div class="formgrid">${field("Section","ts",sec,"select",["ECDE","Lower Primary","Upper Primary","Junior"])}${field("Class","tc",selected,"select",cs)}<div class="field"><label>Teacher view</label><select id="f_tt"><option value="">Select teacher…</option>${teachers}</select></div></div><div class="toolbar"><button onclick="generateTimetable()">Generate Class</button><button class="success" onclick="generateSectionTimetable()">Generate Whole Section</button><button class="light" onclick="teacherTimetable()">Teacher Timetable</button><button class="light" onclick="printElement('tout')">Print</button></div><div id="ttstatus" class="small" style="margin-top:10px"></div><div id="tout" style="margin-top:15px"></div></div>`;document.getElementById("f_ts")?.addEventListener("change",()=>{const s=v("ts"),sel=document.getElementById("f_tc"),a=sectionClasses(s);sel.innerHTML=a.map(c=>`<option>${esc(c)}</option>`).join("")})}
function generateTimetable(){const c=v("tc");if(!c){toast("Select a class");return}const r=scheduleAssignments([c]);save();audit("Timetable generated for "+c);renderTimetableV3(c);document.getElementById("ttstatus").innerHTML=r.failures.length?`<span class="dangertext">${r.failures.length} lesson(s) could not be placed. Add teacher assignments or adjust weekly lesson counts.</span>`:`<span class="oktext">${r.result.filter(x=>x.class===c).length} lessons scheduled successfully.</span>`;toast(r.failures.length?"Timetable generated with warnings":"Timetable generated successfully")}
function generateSectionTimetable(){const sec=v("ts"),cs=sectionClasses(sec),r=scheduleAssignments(cs);save();audit("Timetable generated for section "+sec);renderTimetableV3(v("tc"));document.getElementById("ttstatus").innerHTML=r.failures.length?`<span class="dangertext">${r.failures.length} lesson(s) could not be placed. Review Teaching Assignments and weekly lesson counts.</span>`:`<span class="oktext">Whole ${esc(sec)} section generated: ${r.result.filter(x=>cs.includes(x.class)).length} lessons.</span>`;toast(r.failures.length?"Section generated with warnings":"Whole section timetable generated")}
function renderTimetableV3(c){const out=document.getElementById("tout");if(out)out.innerHTML=timetableGrid(c)+`<div class="toolbar no-print" style="margin-top:12px"><button onclick="printElement('tout')">Print A4</button></div>`}
function teacherTimetable(){const tid=v("tt");if(!tid){toast("Select a teacher");return}const t=teacherById(tid),a=(db.timetable||[]).filter(x=>periodMatchV3(x)&&(x.teacherId===tid||x.teacher===t?.name)),sec=a[0]?.class?schoolTitleForClass(a[0].class):schoolTitleForSection("Junior"),rows=days.map(d=>`<tr><th>${d}</th><td>${a.filter(x=>x.day===d).map(x=>`<b>${esc(x.time)}</b> — ${esc(x.class)} — ${esc(x.subject)}`).join("<br>")||"FREE"}</td></tr>`).join("");document.getElementById("tout").innerHTML=`<div class="report"><div class="schoolhead"><h1>${esc(sec)}</h1><p>TEACHER TIMETABLE</p><p>${esc(t?.name||"")} • ${esc(db.settings.term)}, ${esc(db.settings.year)}</p></div><table><tr><th>Day</th><th>Schedule</th></tr>${rows}</table></div><div class="toolbar no-print" style="margin-top:10px"><button onclick="printElement('tout')">Print A4</button></div>`}
