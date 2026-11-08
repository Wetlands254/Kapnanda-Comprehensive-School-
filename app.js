
/* ---------- Supabase shared cloud connection ---------- */
const CLOUD_KEY="kapnanda_supabase_config_v1";
// Default Supabase connection. The publishable/anon key is safe for browser use
// when Row Level Security (RLS) is correctly configured. NEVER put a service-role key here.
const DEFAULT_SUPABASE_CONFIG={
  url:"https://nrxstipepaevthkeuxoh.supabase.co",
  anonKey:"sb_publishable_nk1h83XRYa-NdZKhgZfsig__0xG8CdM"
};
const SHARED_STATE_ID="KAPNANDA";
let cloud=null, cloudReady=false, cloudUser=null, cloudStaffRole="", cloudSyncBusy=false, cloudSavePending=false;
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
  cloudUser=data.user;
  const roleResult=await cloud.from("school_staff_roles").select("role,active").eq("user_id",data.user.id).maybeSingle();
  if(!roleResult.error){if(!roleResult.data?.active||!roleResult.data?.role){await cloud.auth.signOut();cloudUser=null;return{error:"This Supabase account has not been assigned an active Kapnanda staff role. Ask the administrator to assign admin, headteacher, teacher or bursar access."};}cloudStaffRole=roleResult.data.role;}
  else {console.warn("Staff role lookup unavailable; apply the staff-role migration before enabling restricted access.",roleResult.error);cloudStaffRole="migration_pending";}
  return{data};
}

/* Merge local changes with the latest shared copy so one teacher does not
   accidentally overwrite another teacher's recent learner/mark/fee changes. */
function mergeSharedData(server,local,base){
  if(!server)return cloneDb(local);
  if(!base)return cloneDb(local);
  const result=cloneDb(server);
  const arrayKeys=["learners","teachers","teacherLoads","payments","marks","attendance","timetable","exams","audit","academicPeriods","questionPapers","questionBank","capitationTransactions","bomBudgets","mealRecords","alumni","certificates","notificationLog","bookCategories","bookCatalogue","bookPurchases","classBookInventory","bookIssues","inventoryTransactions","stationeryCategories","stationeryItems","stationeryPurchases","stationeryIssuance","suppliers","stockAdjustments","reorderLevels","schoolWorkers","schoolExpenses"];
  for(const key of arrayKeys){
    const l=Array.isArray(local?.[key])?local[key]:[], b=Array.isArray(base?.[key])?base[key]:[], remoteRows=Array.isArray(server?.[key])?server[key]:[];
    const sm=new Map(remoteRows.filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
    const bm=new Map(b.filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
    const lm=new Map(l.filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
    const order=remoteRows.filter(x=>x&&x.id!=null).map(x=>String(x.id));
    const markKey=x=>[x.learner,x.exam,x.subject].map(v=>String(v??"")).join("|");
    const remoteMarkByKey=new Map(key==="marks"?remoteRows.filter(x=>x&&x.id!=null).map(x=>[markKey(x),x]):[]);
    for(const item of l){
      if(!item||item.id==null)continue;
      const id=String(item.id),baseItem=bm.get(id);
      if(!baseItem||!sameJson(item,baseItem)){
        const remoteMatch=key==="marks"?remoteMarkByKey.get(markKey(item)):null;
        if(remoteMatch&&String(remoteMatch.id)!==id){
          const remoteId=String(remoteMatch.id),combined={...remoteMatch,...cloneDb(item),id:remoteMatch.id};
          sm.set(remoteId,combined);remoteMarkByKey.set(markKey(item),combined);
        }else{
          sm.set(id,cloneDb(item));if(!order.includes(id))order.push(id);
          if(key==="marks")remoteMarkByKey.set(markKey(item),item);
        }
      }
    }
    for(const [id,baseItem] of bm){if(!lm.has(id)&&sm.has(id)&&sameJson(sm.get(id),baseItem))sm.delete(id)}
    result[key]=order.filter(id=>sm.has(id)).map(id=>sm.get(id));
  }
  const objectKeys=["settings","fees","subjectConfigs","timetableMeta"];
  for(const key of objectKeys){
    const l=local?.[key],b=base?.[key],remoteValue=server?.[key];if(sameJson(l,b))continue;
    if(l&&b&&typeof l==="object"&&typeof b==="object"&&!Array.isArray(l)&&!Array.isArray(b)){
      const out=cloneDb(remoteValue&&typeof remoteValue==="object"&&!Array.isArray(remoteValue)?remoteValue:{});
      const keys=new Set([...Object.keys(b||{}),...Object.keys(l||{})]);
      for(const k of keys){if(sameJson(l?.[k],b?.[k]))continue;if(l?.[k]===undefined){delete out[k];continue}out[k]=cloneDb(l[k])}
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
if(!Array.isArray(db.mealRecords)) db.mealRecords=[];
if(!db.schoolCalendar) db.schoolCalendar={terms:{},holidays:[],saturdayLearners:false,saturdayTeachers:false};
if(!db.mealProgram) db.mealProgram={learners:0,maizePerDay:0,beansPerDay:0,oilLitres:0,oilPerDay:0,teacherBudget:0,teacherDailyCost:0,items:[]};
if(!Array.isArray(db.schoolWorkers)) db.schoolWorkers=[];
if(!Array.isArray(db.schoolExpenses)) db.schoolExpenses=[];
    if(!Array.isArray(db.exams)) db.exams=[];
db.exams=db.exams.map(e=>({...e,name:e.name||e.type||"Assessment",type:e.type||"Other"}));
    if(!Array.isArray(db.audit)) db.audit=[];
if(!Array.isArray(db.questionPapers)) db.questionPapers=[];
  if(!Array.isArray(db.questionBank)) db.questionBank=[];
  ["bookCategories","bookCatalogue","bookPurchases","classBookInventory","bookIssues","inventoryTransactions","stationeryCategories","stationeryItems","stationeryPurchases","stationeryIssuance","suppliers","stockAdjustments","reorderLevels","schoolWorkers","schoolExpenses"].forEach(k=>{if(!Array.isArray(db[k]))db[k]=[]});
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
  const arrays=["learners","teachers","teacherLoads","payments","marks","attendance","timetable","exams","audit","academicPeriods","questionPapers","certificates","notificationLog","bookCategories","bookCatalogue","bookPurchases","classBookInventory","bookIssues","inventoryTransactions","stationeryCategories","stationeryItems","stationeryPurchases","stationeryIssuance","suppliers","stockAdjustments","reorderLevels","schoolWorkers","schoolExpenses"];
  for(const k of arrays) if(!Array.isArray(db[k])) db[k]=[];
  if(!Array.isArray(db.capitationTransactions)) db.capitationTransactions=[];
  if(!Array.isArray(db.bomBudgets)) db.bomBudgets=[];
  if(!Array.isArray(db.alumni)) db.alumni=[];
  if(!Array.isArray(db.certificates)) db.certificates=[];
  if(!Array.isArray(db.notificationLog)) db.notificationLog=[];
  if(!db.schoolControls || typeof db.schoolControls!=="object") db.schoolControls={};
  if(!db.schoolControls.grading || typeof db.schoolControls.grading!=="object") db.schoolControls.grading={};
  if(!db.schoolControls.timetable || typeof db.schoolControls.timetable!=="object") db.schoolControls.timetable={};
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

const CLOUD_PATCH_ARRAY_KEYS=["learners","teachers","teacherLoads","payments","marks","attendance","timetable","exams","audit","academicPeriods","questionPapers","questionBank","capitationTransactions","bomBudgets","mealRecords","alumni","certificates","notificationLog","bookCategories","bookCatalogue","bookPurchases","classBookInventory","bookIssues","inventoryTransactions","stationeryCategories","stationeryItems","stationeryPurchases","stationeryIssuance","suppliers","stockAdjustments","reorderLevels","schoolWorkers","schoolExpenses"];
const CLOUD_PATCH_OBJECT_KEYS=["settings","fees","subjectConfigs","timetableMeta"];

function buildCloudPatch(local,base){
  const upserts={},deletes={};
  for(const key of CLOUD_PATCH_ARRAY_KEYS){
    const l=Array.isArray(local?.[key])?local[key]:[];
    const b=Array.isArray(base?.[key])?base[key]:[];
    const lm=new Map(l.filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
    const bm=new Map(b.filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
    const changed=[];
    for(const [id,item] of lm) if(!bm.has(id)||!sameJson(item,bm.get(id))) changed.push(cloneDb(item));
    const removed=[...bm.keys()].filter(id=>!lm.has(id));
    if(changed.length)upserts[key]=changed;
    if(removed.length)deletes[key]=removed;
  }
  const objects={};
  for(const key of CLOUD_PATCH_OBJECT_KEYS){
    const l=local?.[key],b=base?.[key];
    if(sameJson(l,b))continue;
    if(l&&b&&typeof l==="object"&&typeof b==="object"&&!Array.isArray(l)&&!Array.isArray(b)){
      const changed={},removed=[];
      for(const k of new Set([...Object.keys(l),...Object.keys(b)])){
        if(sameJson(l[k],b[k]))continue;
        if(l[k]===undefined)removed.push(k);else changed[k]=cloneDb(l[k]);
      }
      objects[key]={set:changed,remove:removed};
    }else objects[key]={replace:cloneDb(l)};
  }
  return {upserts,deletes,objects};
}
function applyCloudPatchLocally(base,patch){
  const out=cloneDb(base)||{};
  for(const [key,rows] of Object.entries(patch.upserts||{})){
    const map=new Map((Array.isArray(out[key])?out[key]:[]).filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
    for(const id of patch.deletes?.[key]||[])map.delete(String(id));
    for(const row of rows||[])map.set(String(row.id),cloneDb(row));
    out[key]=[...map.values()];
  }
  for(const [key,ids] of Object.entries(patch.deletes||{})){
    if(patch.upserts?.[key])continue;
    const removed=new Set(ids.map(String));out[key]=(Array.isArray(out[key])?out[key]:[]).filter(x=>!removed.has(String(x?.id)));
  }
  for(const [key,change] of Object.entries(patch.objects||{})){
    if(Object.prototype.hasOwnProperty.call(change,"replace")){out[key]=cloneDb(change.replace);continue}
    const target=out[key]&&typeof out[key]==="object"&&!Array.isArray(out[key])?cloneDb(out[key]):{};
    for(const k of change.remove||[])delete target[k];
    Object.assign(target,cloneDb(change.set||{}));out[key]=target;
  }
  return out;
}

async function cloudSave(force=false){
  if(!cloud||!cloudUser)return false;
  const localSnapshot=sanitizeCloudDb(cloneDb(db));
  const baseSnapshot=cloneDb(cloudBaseDb);
  if(!baseSnapshot){
    // First-time initialisation only: use the legacy CAS to create the shared row.
    try{
      const {data:remote,error:readError}=await cloud.from("school_state_shared").select("id,data,updated_at").eq("id",SHARED_STATE_ID).maybeSingle();
      if(readError)throw readError;
      if(remote?.data){cloudBaseDb=cloneDb(remote.data);return cloudSave(force)}
      const {data:ok,error}=await cloud.rpc("save_school_state_shared_cas",{p_id:SHARED_STATE_ID,p_data:localSnapshot,p_expected_updated_at:null});
      if(error)throw error;
      if(!ok)return false;
      cloudBaseDb=cloneDb(localSnapshot);cloudLastUpdatedAt=new Date(ok).getTime()||Date.now();return true;
    }catch(e){console.error("Kapnanda initial cloud save failed",e);if(force)toast("Cloud save failed: "+(e.message||e));return false}
  }
  const patch=buildCloudPatch(localSnapshot,baseSnapshot);
  if(!Object.keys(patch.upserts).length&&!Object.keys(patch.deletes).length&&!Object.keys(patch.objects).length)return true;
  try{
    // Each browser submits only its changed records. The database function merges
    // the patch atomically, so unrelated teachers do not compete to replace the
    // entire school JSON document or wait through compare-and-swap retry loops.
    const {data,error}=await cloud.rpc("apply_school_state_patch",{p_id:SHARED_STATE_ID,p_patch:patch});
    if(error)throw error;
    const saved=data?.data||data?.school_data;
    if(!saved)throw new Error("The database did not confirm the concurrent save.");
    const responseTime=new Date(data.updated_at||Date.now()).getTime()||Date.now();
    if(responseTime>=cloudLastUpdatedAt){
      cloudBaseDb=sanitizeCloudDb(saved);
      cloudLastUpdatedAt=responseTime;
    }
    // Keep any edits made while this request was in flight in the local working copy.
    const currentLocal=cloneDb(db);
    db=sameJson(currentLocal,localSnapshot)?sanitizeCloudDb(saved):sanitizeCloudDb(mergeSharedData(saved,currentLocal,localSnapshot));
    localStorage.setItem(KEY,JSON.stringify(db));
    return true;
  }catch(e){
    console.error("Kapnanda concurrent cloud save failed",e);
    // Older deployments can continue using CAS until the patch migration is applied.
    if(/apply_school_state_patch|function.*not found|schema cache/i.test(String(e.message||e))){
      try{
        const {data:remote,error:readError}=await cloud.from("school_state_shared").select("id,data,updated_at").eq("id",SHARED_STATE_ID).maybeSingle();
        if(readError)throw readError;
        const merged=sanitizeCloudDb(remote?.data?mergeSharedData(remote.data,localSnapshot,baseSnapshot):localSnapshot);
        const {data:ok,error}=await cloud.rpc("save_school_state_shared_cas",{p_id:SHARED_STATE_ID,p_data:merged,p_expected_updated_at:remote?.updated_at||null});
        if(error)throw error;
        if(ok){cloudBaseDb=cloneDb(merged);cloudLastUpdatedAt=new Date(ok).getTime()||Date.now();return true}
      }catch(fallbackError){console.error("CAS fallback failed",fallbackError)}
    }
    if(force)toast("Cloud save failed: "+(e.message||e));
    return false;
  }
}

async function cloudRefresh(){
  if(!cloud||!cloudUser||cloudSyncBusy)return;
  const {data,error}=await cloud.from("school_state_shared").select("data,updated_at").eq("id",SHARED_STATE_ID).maybeSingle();
  if(error){console.error(error);return}
  const remoteTime=new Date(data?.updated_at||0).getTime()||0;
  if(data?.data && remoteTime>cloudLastUpdatedAt){
    const remoteDb=sanitizeCloudDb(data.data);
    const hasLocalChanges=cloudBaseDb&&!sameJson(db,cloudBaseDb);
    if(hasLocalChanges){
      db=sanitizeCloudDb(mergeSharedData(remoteDb,db,cloudBaseDb));
      normalizeDbShape();
      cloudBaseDb=cloneDb(remoteDb);
      cloudLastUpdatedAt=remoteTime;
      localStorage.setItem(KEY,JSON.stringify(db));
      await cloudSave(false);
    }else{
      db=remoteDb;
      normalizeDbShape();
      cloudBaseDb=cloneDb(db);
      cloudLastUpdatedAt=remoteTime;
      localStorage.setItem(KEY,JSON.stringify(db));
      if(typeof currentPage!=="undefined"&&currentPage)show(currentPage);
      toast("Updated data received from another teacher");
    }
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
  if(cloudReady)return cloudSave(false);
  return Promise.resolve(true);
}
function cloudStatusText(){
  if(!cloudConfigured()) return "Local browser storage — Supabase is not configured.";
  if(cloudReady) return "☁️ Connected — shared Kapnanda database is active.";
  return "☁️ Supabase configured — sign in to use the shared database.";
}
async function cloudLogout(){
  stopCloudRefresh();
  if(cloud)await cloud.auth.signOut();
  cloudReady=false;cloudUser=null;cloudStaffRole="";cloudBaseDb=null;cloudLastUpdatedAt=0;
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
if(!db) db={settings:{school:"Kapnanda Comprehensive School",motto:"Hardwork Pays",term:"Term 3",year:"2026",phone:"",email:"",initialPasswordChanged:false},learners:[],teachers:[],teacherLoads:[],payments:[],marks:[],exams:[{id:"EX1",name:"Term 3 Assessment 2026",type:"End Term",term:"Term 3",year:"2026"}],attendance:[],timetable:[],subjects:JSON.parse(JSON.stringify(defaultSubjects)),subjectConfigs:{},fees:{byPeriod:{},legacy:{ECDE:{PP1:0,PP2:0},Primary:{},Junior:{}}},audit:[],academicPeriods:[{year:"2026",term:"Term 3",status:"Open"}],questionPapers:[],questionBank:[],bookCategories:[],bookCatalogue:[],bookPurchases:[],classBookInventory:[],bookIssues:[],inventoryTransactions:[],stationeryCategories:[],stationeryItems:[],stationeryPurchases:[],stationeryIssuance:[],suppliers:[],stockAdjustments:[],reorderLevels:[]};
if(!db.subjectConfigs) db.subjectConfigs={};
if(!db.fees) db.fees={};
if(!Array.isArray(db.teacherLoads)) db.teacherLoads=[];
if(!Array.isArray(db.learners)) db.learners=[];
if(!Array.isArray(db.teachers)) db.teachers=[];
if(!Array.isArray(db.payments)) db.payments=[];
if(!Array.isArray(db.marks)) db.marks=[];
if(!Array.isArray(db.attendance)) db.attendance=[];
if(!Array.isArray(db.timetable)) db.timetable=[];
if(!Array.isArray(db.mealRecords)) db.mealRecords=[];
if(!db.schoolCalendar) db.schoolCalendar={terms:{},holidays:[],saturdayLearners:false,saturdayTeachers:false};
if(!db.mealProgram) db.mealProgram={learners:0,maizePerDay:0,beansPerDay:0,oilLitres:0,oilPerDay:0,teacherBudget:0,teacherDailyCost:0,items:[]};
if(!Array.isArray(db.schoolWorkers)) db.schoolWorkers=[];
if(!Array.isArray(db.schoolExpenses)) db.schoolExpenses=[];
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
function field(label,name,value="",type="text",opts=[]){return `<div class="field"><label>${label}</label>${type==="select"?`<select id="f_${name}">${opts.map(o=>{const exam=name==="rex"?(db.exams||[]).find(x=>String(x.id)===String(o)):null;const label=exam?`${exam.name||exam.type||"Exam"}${exam.year?` ${exam.year}`:""}${exam.term?` ${exam.term}`:""}`:o;return `<option value="${esc(o)}" ${String(o)===String(value)?"selected":""}>${esc(label)}</option>`}).join("")}</select>`:`<input id="f_${name}" type="${type}" value="${esc(value)}">`}</div>`}
function v(n){return document.getElementById("f_"+n)?.value||""}
function openModal(h){document.getElementById("modalBody").innerHTML=h;document.getElementById("modal").classList.remove("hidden")}
function closeModal(){document.getElementById("modal").classList.add("hidden")}
function audit(action){
  // Ask for the staff member responsible for each audited change.
  // Keep the authenticated account separately so entries remain traceable.
  let teacherName=String(currentUser?.username||cloudUser?.user_metadata?.full_name||cloudUser?.email||"Authenticated staff").trim();
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
 currentUser={username:cloudUser.email||email,role:cloudStaffRole||"Authenticated User",id:cloudUser.id};
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
    const pages={Dashboard:dashboard,Learners,Alumni,SchoolControls,SchoolOperations,Teachers,Marks,Exams,QuestionPapers,LibraryInventory,Rankings,Attendance,Reports,Performance,Fees,Capitation,Timetable,Subjects,Settings,ParentContacts,BulkMessaging};
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
  // Primary/ECDE admission numbers are exactly KP plus three digits (KP001–KP999).
  // Never silently generate a four- or six-digit number when the sequence is exhausted.
  if(prefix==="KP"&&max>=999)return "";
  return prefix+String(max+1).padStart(3,"0");
}
function validNewAdmissionNumber(className, admissionNumber){
  const prefix=admissionPrefixForClass(className);
  return prefix==="KP" ? /^KP\d{3}$/i.test(String(admissionNumber||"")) : new RegExp("^"+prefix+"\\d{3,}$","i").test(String(admissionNumber||""));
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
  const sti=indexFor(["stream","class_stream","section"]);
  const si=indexFor(["assessment_number","assessment_no","assessmentno","knec_assessment_number","knec_number"]);
  const bi=indexFor(["birth_entry_number","birth_certificate_number","birth_certificate_no","birth_entry_no"]);
  const ei=indexFor(["entry_number","entry_no","learner_entry_number"]);
  if(ai<0||ni<0||ci<0)throw new Error("Required CSV columns: admission_number, learner_name, grade. The assessment_number column is optional.");
  return useful.slice(1).map((r,i)=>{
    const val=n=>String(r[n]??"").trim();
    const rawClass=val(ci); let className=classes.find(c=>c.toLowerCase()===rawClass.toLowerCase());
    if(!className&&/^grade\s*\d+$/i.test(rawClass)){const n=rawClass.match(/\d+/)[0];className=classes.find(c=>c.toLowerCase()===("grade "+n))}
    if(!className&&/^\d+$/.test(rawClass))className=classes.find(c=>c==="Grade "+rawClass);
    return {rowNumber:i+2,adm:val(ai),name:val(ni),class:className||rawClass,stream:sti>=0?val(sti):"",assessmentNo:si>=0?val(si):"",birthEntryNo:bi>=0?val(bi):"",entryNo:ei>=0?val(ei):""};
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
        const admKey=r.adm.toUpperCase(),assessKey=r.assessmentNo.toUpperCase();
        const existingByAdmission=db.learners.find(l=>String(l.adm||"").toUpperCase()===admKey);
        if(!existingByAdmission&&!validNewAdmissionNumber(r.class,r.adm)){errors.push(`Row ${r.rowNumber}: new ${r.class} admission numbers must use ${prefix} followed by ${prefix==="KP"?"exactly three digits":"at least three digits"} (for example ${prefix}001).`);return}
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
        newRecords.push({...r,stream:String(r.stream||"").trim(),gender:"Not recorded",dob:"",parent:"",phone:"",address:"",status:"Active"});
      });
      if(errors.length){
        pendingLearnerImport=null;
        openModal(`<h2>Import validation failed</h2><p>No learners have been imported. Correct the CSV or resolve these conflicts, then try again.</p><div class="tablewrap" style="max-height:50vh;overflow:auto"><ul>${errors.map(e=>`<li>${esc(e)}</li>`).join("")}</ul></div><div class="toolbar"><button class="secondary" onclick="closeModal()">Close</button></div>`);
        return;
      }
      const counts={};newRecords.forEach(r=>counts[r.class]=(counts[r.class]||0)+1);
      pendingLearnerImport={newRecords,existingMatches,existingUpdates,fileName:file.name};
      const countRows=classes.filter(c=>counts[c]).map(c=>`<tr><td>${esc(c)}</td><td>${counts[c]}</td></tr>`).join("");
      openModal(`<h2>Review Learner Import</h2><p>File: <b>${esc(file.name)}</b></p><p><b>${newRecords.length}</b> new learners will be added. <b>${existingMatches.length}</b> matching records already exist and will not be duplicated.</p>${existingUpdates.length?`<p>${existingUpdates.length} existing records will receive their missing KNEC assessment number.</p>`:""}<div class="tablewrap"><table class="table"><thead><tr><th>Grade</th><th>New learners</th></tr></thead><tbody>${countRows||'<tr><td colspan="2">No new learners to add.</td></tr>'}</tbody></table></div><p class="small">New Primary/ECDE learners must use KP plus exactly three digits (KP001–KP999); Grades 7–9 must use KJ numbers. The file is processed in this browser and learner records are sent to the authenticated shared database only when you confirm.</p><div class="toolbar"><button class="success" onclick="commitLearnerCsvImport()" ${(!newRecords.length&&!existingUpdates.length)?"disabled":""}>Confirm Import</button><button class="secondary" onclick="pendingLearnerImport=null;closeModal()">Cancel</button></div>`);
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
function Learners(){let q=document.getElementById("lq")?.value||"";let rows=db.learners.filter(l=>(l.name+" "+l.adm+" "+l.assessmentNo+" "+l.birthEntryNo+" "+l.entryNo+" "+l.class+" "+(l.stream||"")).toLowerCase().includes(q.toLowerCase())).map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td>${esc(l.birthEntryNo||"")}</td><td>${esc(l.entryNo||"")}</td><td>${esc(l.assessmentNo||"")}</td><td>${esc(l.gender||"")}</td><td><span class="badge">${esc(learnerClassLabel(l))}</span></td><td>${esc(l.parent||"")}</td><td><button class="light" onclick="learnerForm('${l.id}')">Edit</button> <button class="danger" onclick="deleteLearnerRecord('${l.id}')">Delete</button> <button class="danger" onclick="archiveLearner('${l.id}')">Archive</button></td></tr>`).join("");document.getElementById("content").innerHTML=`<div class="card"><div class="section-title"><h2>Learner Register</h2><div class="toolbar"><input id="lq" placeholder="Search name/admission/assessment/class" value="${esc(q)}" oninput="Learners()"><button onclick="learnerForm()">+ Add Learner</button><button class="success" onclick="importLearnersCsv()">Import Learners CSV</button><button class="light" onclick="printClassList()">Print Class List</button><button class="success" onclick="marksRegisterForm()">📝 Marks Register</button><button class="warning" onclick="mealRegisterForm()">🍽️ Meals Register</button></div></div><p class="small">New ECDE/primary admissions use KP001–KP999 (KP plus exactly three digits); Grade 7–9 admissions use KJ numbers. Use the CSV import to add several learners at once.</p><div class="tablewrap"><table class="table"><thead><tr><th>#</th><th>Admission</th><th>Name</th><th>Birth Certificate No.</th><th>Entry No.</th><th>KNEC Assessment No.</th><th>Gender</th><th>Class / Stream</th><th>Parent/Guardian</th><th>Actions</th></tr></thead><tbody>${rows||'<tr><td colspan="8">No learners found.</td></tr>'}</tbody></table></div></div>`}
function learnerForm(id=""){
  let x=db.learners.find(a=>a.id===id)||{adm:nextAdmissionNumber("Grade 1"),name:"",birthEntryNo:"",entryNo:"",assessmentNo:"",gender:"Male",class:"Grade 1",dob:"",admissionDate:new Date().toISOString().slice(0,10),parent:"",phone:"",address:""};
  openModal(`<h2>${id?"Edit":"Add"} Learner</h2><div class="formgrid">${field("Admission Number","adm",x.adm)}${field("Full Name","name",x.name)}${field("Birth Entry Number (Birth Certificate No.)","birthEntryNo",x.birthEntryNo||"")}${field("Entry Number","entryNo",x.entryNo||"")}${field("KNEC Assessment No. (optional)","assessmentNo",x.assessmentNo||"")}${field("Gender","gender",x.gender||"Not recorded","select",["Male","Female","Not recorded"])}${field("Class","class",x.class,"select",classes)}${field("Stream (optional)","stream",x.stream||"")}${field("Date of Birth","dob",x.dob,"date")}${field("Date of Admission","admissionDate",x.admissionDate||"","date")}${field("Parent/Guardian","parent",x.parent)}${field("Phone","phone",x.phone)}${field("Parent/Guardian Email","parentEmail",x.parentEmail||"")}${field("Address","address",x.address)}<label class="inline-check"><input id="parentEmailConsent" type="checkbox" ${x.parentEmailConsent===true?"checked":""}> Parent/guardian has consented to receive school emails and learner PDFs</label></div><div class="toolbar"><button onclick="saveLearner('${id}')">Save</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`);
  if(!id){const cls=document.getElementById("f_class"),adm=document.getElementById("f_adm");if(cls&&adm)cls.addEventListener("change",()=>{adm.value=nextAdmissionNumber(cls.value)})}
}
async function saveLearner(id){
  let adm=v("adm").trim(),name=v("name").trim(),c=v("class"),prefix=admissionPrefixForClass(c);
  if(!adm||!name){toast("Admission number and name are required");return}
  const parentEmail=String(v("parentEmail")||"").trim();if(parentEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)){toast("Enter a valid parent/guardian email address");return}
  if(db.learners.some(l=>String(l.adm||"").toUpperCase()===adm.toUpperCase()&&l.id!==id)){toast("Admission number already exists");return}
  if(!id&&!validNewAdmissionNumber(c,adm)){toast(`New ${c} admission numbers must use ${prefix} followed by ${prefix==="KP"?"exactly three digits":"at least three digits"}, for example ${prefix}001`);return}
  const before=cloneDb(db.learners);
  let x={id:id||uid("L"),adm,name,birthEntryNo:v("birthEntryNo").trim(),entryNo:v("entryNo").trim(),assessmentNo:v("assessmentNo").trim(),gender:v("gender"),class:c,stream:v("stream").trim(),dob:v("dob"),admissionDate:v("admissionDate"),admissionClass:(id?(db.learners.find(l=>l.id===id)?.admissionClass||db.learners.find(l=>l.id===id)?.class):c),parent:v("parent"),phone:v("phone"),parentEmail,parentEmailConsent:document.getElementById("parentEmailConsent")?.checked===true,address:v("address"),status:"Active",updatedAt:new Date().toISOString(),updatedBy:cloudUser?.id||currentUser?.username||"staff"};
  let i=db.learners.findIndex(l=>l.id===id);if(i>=0)db.learners[i]={...db.learners[i],...x};else db.learners.push(x);
  localStorage.setItem(KEY,JSON.stringify(db));
  const synced=await save();
  if(synced!==true){db.learners=before;localStorage.setItem(KEY,JSON.stringify(db));toast("Learner was not confirmed in the shared database. Please retry; no success was reported.");return}
  audit(id?"Learner edited":"Learner added");closeModal();Learners();toast("Learner saved successfully");
}
function archiveLearner(id){if(confirm("Archive this learner?")){let l=db.learners.find(x=>x.id===id);if(l)l.status="Archived";save();audit("Learner archived");Learners()}}
function printClassList(){openModal(`<h2>Print Class List</h2>${field("Class","pc","Grade 1","select",classes)}<div class="toolbar"><button onclick="renderClassList()">Generate</button><button class="success" onclick="downloadClassListPDF()">Download A4 PDF</button><button class="light" onclick="printClassListA4()">Print A4</button></div><div id="classListOut"></div>`)}
function classListHTML(c){const ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived");return `<div class="report class-list-print"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>CLASS LIST — ${esc(c)}</p><p>${esc(db.settings.term)}, ${esc(db.settings.year)}</p></div><table class="register-table"><thead><tr><th>No.</th><th>Admission</th><th>Learner Name</th><th>Birth Certificate No.</th><th>Entry No.</th><th>KNEC Assessment No.</th><th>Gender</th><th>Stream</th><th>Parent/Guardian</th><th>Phone</th></tr></thead><tbody>${ls.map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td>${esc(l.birthEntryNo||"")}</td><td>${esc(l.entryNo||"")}</td><td>${esc(l.assessmentNo||"")}</td><td>${esc(l.gender||"")}</td><td>${esc(l.stream||"")}</td><td>${esc(l.parent||"")}</td><td>${esc(l.phone||"")}</td></tr>`).join("")}</tbody></table></div>`}
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
async function saveMarks(){
  let e=v("mex"),c=v("mclass"),s=v("msub");
  if(!e||!c||!s){toast("Select an assessment, class and subject first");return}
  const inputs=Array.from(document.querySelectorAll(".markinput"));
  for(const inp of inputs){
    if(inp.value==="")continue;
    const n=Number(inp.value);
    if(!Number.isFinite(n)||n<0||n>50){toast(`Marks must be between 0 and 50. Check ${inp.dataset.id}.`);inp.focus();return}
  }
  inputs.forEach(inp=>{
    let i=db.marks.findIndex(m=>m.learner===inp.dataset.id&&m.exam===e&&m.subject===s),val=inp.value;
    if(val===""){if(i>=0)db.marks.splice(i,1);return}
    let o={id:i>=0?db.marks[i].id:uid("M"),learner:inp.dataset.id,class:c,subject:s,exam:e,mark:Number(val)};
    if(i>=0)db.marks[i]={...db.marks[i],...o};else db.marks.push(o);
  });
  audit("Marks saved");
  const synced=await save();
  if(synced===true)toast("Marks saved successfully");
  else toast("Marks could not be confirmed in the shared database. Keep this page open and retry.");
}
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
    <div class="toolbar no-print"><button class="success" onclick="saveAttendance()">Save Attendance</button><button class="light" onclick="markAllAttendance('Present')">✓ All Present</button><button class="warning" onclick="markAllAttendance('Late')">◷ All Late</button><button class="danger" onclick="markAllAttendance('Absent')">✕ All Absent</button><button class="light" onclick="window.print()">🖨️ Print Register</button><button class="success" onclick="attendanceRegisterDownloadForm('weekly')">⬇ Weekly Register</button><button class="success" onclick="attendanceRegisterDownloadForm('termly')">⬇ Termly Register</button></div>
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
function schoolHeadDesignation(){return String(db.settings.signatoryDesignation||"Headteacher").trim()||"Headteacher"}
function learnerClassLabel(l){return [l?.class||"",l?.stream||""].filter(Boolean).join(" ")}
function streamsForClass(className){
 return [...new Set((db.learners||[]).filter(l=>l&&l.status!=="Archived"&&l.class===className&&String(l.stream||"").trim()).map(l=>String(l.stream).trim()))].sort((a,b)=>a.localeCompare(b));
}
function refreshReportStreams(){
 const cls=document.getElementById("f_rc"),stream=document.getElementById("f_rs");
 if(!cls||!stream)return;
 const current=stream.value,opts=streamsForClass(cls.value);
 stream.innerHTML='<option value="">All streams</option>'+opts.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
 if(opts.includes(current))stream.value=current;
}
function reportLearners(){
  const classEl=document.getElementById("f_rc");
  const searchEl=document.getElementById("reportSearch");
  const selectedClass=classEl?.value||"";
  const selectedStream=document.getElementById("f_rs")?.value||"";
  const query=(searchEl?.value||"").trim().toLowerCase();
  return (db.learners||[])
    .filter(l=>l && l.status!=="Archived")
    .filter(l=>!selectedClass || l.class===selectedClass)
    .filter(l=>!selectedStream || String(l.stream||"").trim()===selectedStream)
    .filter(l=>{
      if(!query)return true;
      return String(l.name||"").toLowerCase().includes(query) ||
             String(l.adm||"").toLowerCase().includes(query) ||
             String(l.class||"").toLowerCase().includes(query) || String(l.stream||"").toLowerCase().includes(query);
    })
    .sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")));
}
function loadReportLearners(){
 let ls=reportLearners(),sel=document.getElementById("f_rl");
 if(!sel)return;
 let current=sel.value;
 sel.innerHTML='<option value="">— Select learner —</option>'+ls.map(l=>`<option value="${esc(l.id)}">${esc(l.name)} — ${esc(l.adm)} — ${esc(learnerClassLabel(l))}</option>`).join("");
 if(ls.some(l=>l.id===current))sel.value=current;
 document.getElementById("reportCount").textContent=ls.length+" learner"+(ls.length===1?"":"s")+" found";
}
function Reports(){
 document.getElementById("content").innerHTML=`<div class="card report-page"><h2>Individual Learner Reports</h2><div class="toolbar no-print"><button class="light" onclick="leavingCertificateForm()">📜 Create Leaving Certificate</button></div>
 <p class="small">Search by class/grade first, then choose a learner from the complete list. You can also search by learner name or admission number.</p>
 <div class="formgrid">
  ${field("Grade / Class","rc","","select",[""].concat(classes))}
  <div class="field"><label>Stream</label><select id="f_rs"><option value="">All streams</option></select></div>
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
 document.getElementById("f_rc").onchange=()=>{refreshReportStreams();loadReportLearners()};
 document.getElementById("f_rs").onchange=loadReportLearners;
 refreshReportStreams();loadReportLearners();
}
function clearReportSearch(){let q=document.getElementById("reportSearch");if(q)q.value="";let c=document.getElementById("f_rc");if(c)c.value="";let st=document.getElementById("f_rs");if(st)st.value="";refreshReportStreams();loadReportLearners()}
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
 const classLs=db.learners.filter(x=>x.class===l.class&&String(x.stream||"").trim()===String(l.stream||"").trim()&&x.status!=="Archived");
 const ranked=classLs.map(x=>({id:x.id,...calcLearner(x.id,e)})).filter(x=>x.n>0).sort((a,b)=>b.avg-a.avg||b.total-a.total);
 const idx=ranked.findIndex(x=>x.id===l.id),pos=idx>=0?`${idx+1}/${classLs.length}`:'—';
 const sorted=ms.filter(x=>x.m!==undefined&&x.m!==null&&x.m!=='').sort((a,b)=>Number(b.m)-Number(a.m));
 const strengths=sorted.slice(0,2).map(x=>x.s),weak=sorted.slice(-2).map(x=>x.s);
 const rec=vals.length?`Strongest areas: ${strengths.join(' and ')||'—'}. Areas for continued support: ${weak.join(' and ')||'—'}. ${avg>=35?'Excellent effort; maintain this standard.':avg>=25?'Good progress; keep practising consistently.':'With regular practice and support, improvement is achievable.'}`:'Marks have not yet been entered.';
 const rows=ms.map(x=>`<tr><td>${esc(x.s)}</td><td>${x.m===undefined||x.m===null||x.m===''?'—':Number(x.m).toFixed(1)}</td><td>${x.m===undefined||x.m===null||x.m===''?'—':grade(x.m)}</td></tr>`).join('');
 const paths=reportPathways(ms),pathRows=paths.vals.map(x=>`<div class="pathway-item"><div class="pathway-label"><b>${esc(x.name)}</b><span>${x.count?`${x.total.toFixed(1)}/${x.max} • ${x.score.toFixed(1)}%`:'No marks'}</span></div><div class="pathway-track"><span style="width:${Math.max(0,Math.min(100,x.score))}%"></span></div></div>`).join('');
 const school=esc(db.settings.school||'Kapnanda Comprehensive School'),term=esc(ex.term||db.settings.term),year=esc(String(ex.year||db.settings.year));
 return `<div class="printreport class-bulk-report"><div class="prhead"><div class="prschool">${school}</div><div class="prsubtitle">SCHOOL REPORT</div><div class="prmeta">${term} • ${year} • ${esc(ex.name||ex.type||'Assessment')}</div></div>
 <div class="prstudent"><div><b>LEARNER'S NAME</b><br>${esc(l.name)}</div><div><b>ADMISSION NO.</b><br>${esc(l.adm||'—')}</div><div><b>CLASS / STREAM</b><br>${esc(learnerClassLabel(l))}</div><div><b>ASSESSMENT NO.</b><br>${esc(l.assessmentNo||l.assessment||'—')}</div></div>
 <div class="report-kpis"><div><b>Total Marks</b><strong>${total.toFixed(1)} / ${vals.length*50}</strong></div><div><b>Average Marks</b><strong>${avg.toFixed(1)} / 50</strong></div><div><b>Average Grade</b><strong>${vals.length?grade(avg):"—"}</strong></div><div><b>Total Points</b><strong>${vals.length}</strong></div><div><b>Class Position</b><strong>${pos}</strong></div></div>
 <h3 class="report-section-title">Learning Area Performance</h3><table class="prmarks"><thead><tr><th>Learning Area</th><th>Mark / 50</th><th>Grade</th></tr></thead><tbody>${rows||'<tr><td colspan="3">No subjects configured.</td></tr>'}</tbody></table>
 <h3 class="report-section-title">Pathway Performance Profile</h3><div class="pathway-profile">${pathRows}</div><p class="strong-pathway"><b>Strongest Pathway:</b> ${paths.strongest?`${esc(paths.strongest.name)} (${paths.strongest.score.toFixed(1)}%)`:'Not available — enter marks to calculate.'}</p>
 <div class="prrec"><b>Class Teacher's Comment</b><br>${esc(rec)}</div><div class="prsign"><div>Class Teacher<br>____________________<br>Signature / Date</div><div>${esc(schoolHeadDesignation())}<br>____________________<br>Signature / Date</div><div>Parent / Guardian<br>____________________<br>Signature / Date</div></div></div>`;
}
function showReport(){
 const l=db.learners.find(x=>x.id===v('rl')),e=v('re');
 if(!l){toast('Select a learner');return}
 document.getElementById('reportout').innerHTML=buildLearnerReportHTML(l,e)+`<div class="toolbar no-print" style="margin-top:10px"><button onclick="downloadReportPDF()">⬇️ Download Report PDF</button><button class="success" onclick="emailSelectedReport()">✉ Email PDF to Parent</button><button class="light" onclick="window.print()">🖨️ Print A4 Report</button></div>`;
 const stage=document.getElementById('reportout').querySelector('.printreport');if(stage)stage.id='reportPdfTarget';
}
function selectedClassReportData(){const c=document.getElementById('f_rc')?.value||'',st=document.getElementById('f_rs')?.value||'',e=document.getElementById('f_re')?.value||'';if(!c){toast('Select a class first');return null}const learners=db.learners.filter(l=>l.class===c&&(!st||String(l.stream||'').trim()===st)&&l.status!=='Archived').sort((a,b)=>String(a.adm||'').localeCompare(String(b.adm||''),undefined,{numeric:true})||String(a.name).localeCompare(String(b.name)));if(!learners.length){toast('No active learners found in this class / stream');return null}return {c,stream:st,e,learners}}
function makeBulkReportDocument(data){return `<div class="bulk-print-document">${data.learners.map((l,i)=>`<section class="bulk-report-page ${i?'bulk-page-break':''}">${buildLearnerReportHTML(l,data.e)}</section>`).join('')}</div>`}
function printAllClassReports(){const data=selectedClassReportData();if(!data)return;const stage=document.getElementById('bulkReportStage'),home=stage.parentElement;stage.innerHTML=makeBulkReportDocument(data);stage.style.display='block';document.body.appendChild(stage);document.body.classList.add('printing-bulk-reports');audit(`Bulk report print prepared for ${data.c}${data.stream?" "+data.stream:""} (${data.learners.length} learners)`);window.print();setTimeout(()=>{document.body.classList.remove('printing-bulk-reports');stage.innerHTML='';stage.style.display='none';home.appendChild(stage)},1000)}
async function downloadAllClassReportsPDF(){
 const data=selectedClassReportData(); if(!data)return;
 const stage=document.getElementById("bulkReportStage"); if(!stage){toast("Report export area is unavailable");return}
 stage.innerHTML=makeBulkReportDocument(data);
 stage.className="bulk-report-stage pdf-export-stage pdf-bulk-reports";
 stage.style.cssText="position:fixed!important;left:0!important;top:0!important;width:794px!important;height:auto!important;min-height:1123px!important;overflow:visible!important;background:#fff!important;z-index:2147483647!important;display:block!important;visibility:visible!important;opacity:1!important;pointer-events:none!important;";
 const pages=Array.from(stage.querySelectorAll(".class-bulk-report"));
 const filename=`${data.c}${data.stream?"-"+data.stream:""}-${db.settings.term}-${db.settings.year}-all-report-forms.pdf`.replace(/[^a-z0-9._-]+/gi,"-");
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
    <div class="toolbar no-print" style="margin:15px 0"><button onclick="feeSettings()">Configure Term Fees</button><button class="success" onclick="feeRegisterForm()">⬇ Download Fee List</button><button class="success" onclick="downloadManualFeeRegister()">⬇ Download Blank Manual Fee Register</button><button class="light" onclick="feeCsvForm()">⬇ Download Fee CSV</button><button class="light" onclick="document.getElementById('feesCsvFile').click()">⬆ Upload Fees CSV</button><button class="light" onclick="downloadDedicatedCsvTemplate('fees')">Download Fees CSV Template</button><input id="feesCsvFile" type="file" accept=".csv,text/csv" style="display:none" onchange="uploadFeesCsv(this)"><button class="warning" onclick="printCurrentFeeList()">🖨️ Print Current Fee List</button><button class="success" onclick="feeStatementForm()">🧾 Learner Fee Statement</button><button class="light" onclick="downloadFeeStructure()">⬇ Fee Structure PDF</button><button class="light" onclick="printFeeStructure()">🖨 Fee Structure</button></div>
    <div class="tablewrap"><table class="table fee-table" id="feeTable"><thead><tr><th>#</th><th>Admission</th><th>Learner</th><th>Class</th><th>Amount Payable</th><th>Amount Paid</th><th>Balance</th><th>Status</th><th>Last Payment</th><th>Receipt/Method</th><th class="no-print">Actions</th></tr></thead><tbody>${rows||'<tr><td colspan="11">No active learners match the selected section/class.</td></tr>'}</tbody></table></div>
    <div class="card fee-register-tools no-print"><h3>📑 Printable Registers</h3><p class="small">Generate clean A4 registers for fee collection, marks recording and meals. Choose the class before generating.</p><div class="toolbar"><button onclick="feeRegisterForm()">Fee Register by Class/Section</button><button onclick="marksRegisterForm()">📝 Marks Recording Class List</button><button onclick="mealRegisterForm()">🍽️ Meals Register (PDF / Print / CSV)</button></div></div>
  </div>`;
  document.getElementById("feeSection").value=sec;
  document.getElementById("feeClass").value=cls;
}
function filterFeeTable(){const q=(document.getElementById("feeSearch")?.value||"").toLowerCase();document.querySelectorAll("#feeTable tbody tr").forEach(tr=>{tr.style.display=tr.textContent.toLowerCase().includes(q)?"":"none"})}
function feeRegisterForm(){
  openModal(`<h2>Download Fee List</h2><p class="small">Select a whole section or a single class. The printable list includes learner names, amount payable, amount paid, balance, payment status and last payment details.</p><div class="formgrid">${field("Section","frsec","All","select",["All","ECDE","Primary","Junior"])}${field("Class","frclass","All","select",["All"].concat(classes))}</div><div class="toolbar"><button class="success" onclick="downloadFeeRegister()">Download A4 PDF</button><button class="light" onclick="printFeeRegister()">Print A4</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`);
}

const KENYA_CREST="data:image/png;base64,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";

function schoolIdentityImage(className="fee-doc-crest"){
 const useNationalSymbol=db.settings.useKenyaCoatOfArms===true;
 const src=useNationalSymbol?(db.settings.kenyaCrestUrl||KENYA_CREST):(db.settings.logoUrl||"");
 if(!src)return "";
 return `<img class="${esc(className)}" src="${esc(src)}" alt="${useNationalSymbol?"Kenya coat of arms":"School logo"}">`;
}
function feeStatementForm(){let ls=db.learners.filter(x=>x.status!=="Archived");openModal(`<h2>Fee Statement / Invoice</h2><div class="field"><label>Learner</label><select id="feeStatementLearner">${ls.map(l=>`<option value="${esc(l.id)}">${esc(l.name)} — ${esc(l.adm)} (${esc(l.class)})</option>`).join("")}</select></div><div class="toolbar"><button onclick="downloadFeeStatement()">⬇ Download PDF</button><button class="success" onclick="emailFeeStatement()">✉ Email PDF to Parent</button><button class="light" onclick="printFeeStatement()">🖨 Print</button></div>`)}
function feeOpeningBalanceForLearner(learner){
 if(!learner)return 0;const currentRank=(Number(db.settings.year)||0)*3+(Number(String(db.settings.term||"").match(/(1|2|3)/)?.[1])||1);let priorDue=0,priorPaid=0;
 for(const [key,fees] of Object.entries(db.fees?.byPeriod||{})){const [year,term]=key.split("|");const rank=(Number(year)||0)*3+(Number(String(term||"").match(/(1|2|3)/)?.[1])||1);if(rank>=currentRank)continue;priorDue+=Number(fees?.[learner.class]||0);priorPaid+=(db.payments||[]).filter(p=>String(p.learner)===String(learner.id)&&String(p.year)===String(year)&&String(p.term)===String(term)).reduce((n,p)=>n+Number(p.amount||0),0)}
 return Math.max(0,priorDue-priorPaid);
}
function feeStatementHTML(id){
 let l=db.learners.find(x=>String(x.id)===String(id));if(!l)return "";
 let due=feeFor(l.class),opening=feeOpeningBalanceForLearner(l),ps=feePeriodPaymentsForLearner(l.id),paid=ps.reduce((s,p)=>s+Number(p.amount||0),0),totalDue=opening+due,bal=Math.max(0,totalDue-paid);
 const fmtDate=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?esc(value||"—"):d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})};
 let rows=ps.map((p,i)=>`<tr><td>${i+1}</td><td>${fmtDate(p.date)}</td><td>${esc(p.receipt||"—")}</td><td>${esc(p.method||"—")}</td><td>KSh ${Number(p.amount||0).toLocaleString()}</td></tr>`).join("");
 return `<article class="a4-document tinet-invoice">
 <header class="invoice-head">${schoolIdentityImage("fee-doc-crest")}<div class="invoice-brand"><h1>${esc(db.settings.school||"SCHOOL")}</h1><p>REPUBLIC OF KENYA · ${esc(db.settings.phone||"")} ${esc(db.settings.email||"")}</p></div><div class="invoice-title">OFFICIAL FEE STATEMENT</div></header>
 <div class="invoice-meta"><span><b>Invoice No:</b> INV-${esc(db.settings.year)}-${esc(l.adm||l.id)}</span><span><b>Date:</b> ${fmtDate(new Date())}</span><span><b>Term:</b> ${esc(db.settings.term)} ${esc(String(db.settings.year))}</span></div>
 <div class="invoice-learner"><span><b>Name:</b> ${esc(l.name)}</span><span><b>Class:</b> ${esc(l.class)}</span><span><b>Adm No:</b> ${esc(l.adm)}</span><span><b>Assessment No:</b> ${esc(l.assessmentNo||"—")}</span></div>
 <h3 class="invoice-section-title">SCHOOL FEES</h3><table class="invoice-fees-table"><colgroup><col style="width:12%"><col style="width:58%"><col style="width:30%"></colgroup><thead><tr><th>No.</th><th>Description</th><th>Amount</th></tr></thead><tbody><tr><td>1</td><td>Opening balance from previous academic periods</td><td>KSh ${opening.toLocaleString()}</td></tr><tr><td>2</td><td>${esc(db.settings.term)} ${esc(String(db.settings.year))} School Fees</td><td>KSh ${due.toLocaleString()}</td></tr><tr><td colspan="2"><b>Total amount due</b></td><td><b>KSh ${totalDue.toLocaleString()}</b></td></tr></tbody></table>
 <h3 class="invoice-section-title">PAYMENT HISTORY</h3><table class="invoice-history-table"><colgroup><col style="width:7%"><col style="width:23%"><col style="width:22%"><col style="width:23%"><col style="width:25%"></colgroup><thead><tr><th>No.</th><th>Date</th><th>Receipt</th><th>Method</th><th>Amount</th></tr></thead><tbody>${rows||'<tr><td colspan="5">No payments recorded</td></tr>'}</tbody></table>
 <div class="invoice-totals"><p>Opening Balance: <b>KSh ${opening.toLocaleString()}</b></p><p>Current Period Fees: <b>KSh ${due.toLocaleString()}</b></p><p>Total Paid This Period: <b>KSh ${paid.toLocaleString()}</b></p><h2>Balance Outstanding: KSh ${bal.toLocaleString()}</h2></div>
 <div class="invoice-signatures"><span>Prepared by: ____________________</span><span>Bursar: ____________________</span></div></article>`;
}
async function downloadFeeStatement(){let id=document.getElementById("feeStatementLearner")?.value;if(!id)return toast("Select a learner");let l=db.learners.find(x=>String(x.id)===String(id));closeModal();await downloadPrintableDocument(feeStatementHTML(id),`Fee-Statement-${l.adm}-${db.settings.term}-${db.settings.year}.pdf`,"portrait")}
function printFeeStatement(){let id=document.getElementById("feeStatementLearner")?.value;if(!id)return toast("Select a learner");let l=db.learners.find(x=>String(x.id)===String(id));const html=feeStatementHTML(id);closeModal();openReportStyleA4PrintWindow(html,`Fee Statement - ${l.name}`,"portrait")}
function feeStructureHTML(){return `<article class="a4-document fee-structure-sheet">
 <header class="prhead">${schoolIdentityImage("fee-doc-crest")}<div class="prschool">${esc(db.settings.school||"SCHOOL")}</div><div class="prmeta">REPUBLIC OF KENYA</div><div class="prsubtitle">OFFICIAL FEE STRUCTURE</div><div class="prmeta">${esc(db.settings.term)} ${esc(String(db.settings.year))}</div></header>
 <div class="fee-structure-intro"><b>Approved school fees by class</b><span>Academic period: ${esc(db.settings.term)} ${esc(String(db.settings.year))}</span></div>
 <table class="fee-structure-table"><colgroup><col style="width:14%"><col style="width:48%"><col style="width:38%"></colgroup><thead><tr><th>No.</th><th>Class / Grade</th><th>Fee Payable (KSh)</th></tr></thead><tbody>${classes.map((c,i)=>`<tr><td>${i+1}</td><td>${esc(c)}</td><td>KSh ${feeFor(c).toLocaleString()}</td></tr>`).join("")}</tbody></table>
 <p class="fee-structure-note">This fee structure is applicable to the stated academic period only. Please contact the school office for clarification.</p>
 <div class="fee-structure-sign"><span>Prepared by: __________________________</span><span>${esc(schoolHeadDesignation())} Approval: __________________________</span></div>
 </article>`}
async function downloadFeeStructure(){await downloadPrintableDocument(feeStructureHTML(),`Fee-Structure-${db.settings.term}-${db.settings.year}.pdf`,"portrait")}
function printFeeStructure(){openReportStyleA4PrintWindow(feeStructureHTML(),"Fee Structure","portrait")}
function localDateInputValue(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`}
function certificateDate(value){if(!value)return "—";const d=new Date(value+(/T/.test(value)?"":"T00:00:00"));return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"})}
function leavingCertificateForm(id=""){
 let l=db.learners.find(x=>String(x.id)===String(id))||db.learners.find(x=>x.status!=="Archived");
 if(!l)return toast("Register a learner first");
 const today=localDateInputValue(), learners=db.learners.filter(x=>x.status!=="Archived");
 openModal(`<h2>Online Leaving Certificate</h2><p class="small">Complete the certificate digitally. Only the headteacher's signature and official stamp remain manual. The school keeps an internal issue record; no serial number is printed on the certificate.</p>
 <div class="field"><label>Certificate level</label><select id="lcType" onchange="setLeavingCertificateDefaults()"><option value="ECDE">ECDE – Early Childhood Development Education</option><option value="Primary" selected>Primary School</option><option value="Junior">Junior School</option></select></div>
 <div class="field"><label>Learner</label><select id="lcLearner" onchange="setLeavingCertificateDefaults()">${learners.map(x=>`<option value="${esc(x.id)}" ${x.id===l.id?"selected":""}>${esc(x.name)} (${esc(x.adm)})</option>`).join("")}</select></div>
 <div class="formgrid"><div class="field"><label>Date admitted / entry date (editable)</label><input id="lcEntered" type="date" value="${esc(l.admissionDate||l.dateAdmitted||l.admittedOn||"")}"><small>You can type or select the correct admission date here, even if the learner record has no date.</small></div><div class="field"><label>Date left / leaving date (editable)</label><input id="lcLeft" type="date" value="${today}"></div>${field("Class / level admitted","lcEntry",l.admissionClass||l.class)}${field("Class / level completed","lcExit",l.class)}<div class="field"><label>Date of birth</label><input id="lcDob" type="date" readonly value="${esc(l.dob||"")}"></div><div class="field"><label>Certificate issue date (automatic)</label><input id="lcIssue" type="date" readonly value="${today}"></div></div>
 <div class="field"><label>Course / programme completed</label><input id="lcCourse" value="Approved learning programme for the selected level"></div>
 <div class="field"><label>${esc(schoolHeadDesignation())} report – ability, progress, industry and conduct</label><textarea id="lcConduct" rows="3" maxlength="420"></textarea></div>
 <div class="field"><label>Co-curricular activities / participation</label><textarea id="lcActivities" rows="2" maxlength="220"></textarea></div>
 <div class="field"><label>Achievements and additional remarks</label><textarea id="lcExtra" rows="2" maxlength="220" placeholder="Optional remarks"></textarea></div>
 <div class="field"><label>Authorised signatory's full name and designation</label><input id="lcHead" value="${esc(db.settings.headteacherName||"")}" placeholder="Full name and designation"></div>
 <div class="toolbar"><button class="success" onclick="issueLeavingCertificate()">Issue & Download Certificate</button><button class="light" onclick="downloadLeavingCertificate()">Download Draft PDF</button><button class="light" onclick="printLeavingCertificate()">Print / Preview</button><button class="secondary" onclick="verifyCertificateForm()">Certificate Register / Verify</button></div><p class="small">A draft download does not create an issued certificate record. Issue requires a successful save.</p>`);
 setLeavingCertificateDefaults();
}
function setLeavingCertificateDefaults(){
 const type=document.getElementById("lcType")?.value||"Primary",l=db.learners.find(x=>String(x.id)===String(document.getElementById("lcLearner")?.value))||{};
 const course=document.getElementById("lcCourse"),conduct=document.getElementById("lcConduct"),activities=document.getElementById("lcActivities"),entered=document.getElementById("lcEntered"),dob=document.getElementById("lcDob"),entry=document.getElementById("lcEntry"),exit=document.getElementById("lcExit");
 if(entered)entered.value=l.admissionDate||l.dateAdmitted||l.admittedOn||"";if(dob)dob.value=l.dob||"";if(entry)entry.value=l.admissionClass||l.class||"";if(exit)exit.value=l.class||"";
 if(course)course.value=type==="ECDE"?"Early Childhood Development and Education programme":type==="Junior"?"Junior School learning programme":"Primary School learning programme";
 if(conduct)conduct.value=type==="ECDE"?`${l.name||"The learner"} has participated in age-appropriate learning experiences and has made progress in communication, early literacy, early numeracy, creativity, motor skills, social interaction and self-care.`:type==="Junior"?`${l.name||"The learner"} has demonstrated commitment to learning and positive progress across the Junior School learning areas, showing responsibility, critical thinking, creativity, collaboration and respect for others.`:`${l.name||"The learner"} has demonstrated commendable progress in the Primary School learning areas, showing commitment, responsibility, good conduct and a positive attitude towards learning.`;
 if(activities)activities.value="Sports, games, athletics, music, drama, clubs, leadership, creative arts and community service.";
}
function leavingCertificateHTML(certificateNumber="DRAFT"){
 const l=db.learners.find(x=>String(x.id)===String(document.getElementById("lcLearner")?.value));if(!l)return "";
 const type=document.getElementById("lcType")?.value||"Primary",title=type==="ECDE"?"EARLY CHILDHOOD DEVELOPMENT AND EDUCATION CERTIFICATE OF LEAVING":type==="Junior"?"JUNIOR SCHOOL LEAVING CERTIFICATE":"PRIMARY SCHOOL LEAVING CERTIFICATE";
 const val=id=>document.getElementById(id)?.value||"—", fmt=id=>certificateDate(val(id));
 const logo=db.settings.logoUrl||"";
 const crest=db.settings.useKenyaCoatOfArms===true?`<img class="lc-crest" src="${esc(db.settings.kenyaCrestUrl||KENYA_CREST)}" alt="Kenya coat of arms">`:"";
 const academicExam=(db.exams||[]).filter(e=>String(e.year||"")&&String(e.term||"")).sort((a,b)=>(Number(b.year)||0)-(Number(a.year)||0)||Number(String(b.term||"").match(/(1|2|3)/)?.[1]||0)-Number(String(a.term||"").match(/(1|2|3)/)?.[1]||0)).find(e=>calcLearner(l.id,e.id).n>0);
 const academicResult=academicExam?calcLearner(l.id,academicExam.id):null;
 const academicHtml=academicExam&&academicResult?`<section class="lc-academic"><b>LATEST RECORDED ACADEMIC PERFORMANCE</b><p>${esc(academicExam.name||academicExam.type||"Assessment")} · ${esc(academicExam.term||"")} ${esc(String(academicExam.year||""))} — ${academicResult.n} learning areas assessed; total ${academicResult.total.toFixed(1)}; average ${academicResult.avg.toFixed(1)}%.</p></section>`:`<section class="lc-academic"><b>ACADEMIC PERFORMANCE</b><p>No examination results are currently recorded for this learner in the school database.</p></section>`;
 return `<article class="a4-document leaving-cert"><div class="lc-content"><header class="lc-report-head"><div class="lc-brand-row">${logo?`<img class="lc-school-logo" src="${esc(logo)}" alt="School logo">`:""}${crest}</div><div class="prschool">${esc(db.settings.school||"KAPNANDA SCHOOL")}</div><div class="lc-motto">${esc(db.settings.motto||"")}</div><div class="prmeta">REPUBLIC OF KENYA</div><div class="prsubtitle">${esc(title)}</div></header>
 <div class="lc-refbar"><span><b>Issue Date:</b> ${fmt("lcIssue")}</span></div>
 <div class="lc-details"><div><small>LEARNER'S FULL NAME</small><b>${esc(l.name||"")}</b></div><div><small>ADMISSION NUMBER</small><b>${esc(l.adm||"—")}</b></div><div><small>ASSESSMENT NUMBER</small><b>${esc(l.assessmentNo||"—")}</b></div><div><small>LEARNING PROGRAMME</small><b>${esc(val("lcCourse"))}</b></div></div>
 <p class="lc-award">This is to certify that</p><h2 class="lc-learner-name">${esc(l.name||"")}</h2><p class="lc-award">was duly admitted to <b>${esc(db.settings.school||"the school")}</b> on <b>${fmt("lcEntered")}</b> in <b>${esc(val("lcEntry"))}</b> and left on <b>${fmt("lcLeft")}</b> after successfully completing <b>${esc(val("lcExit"))}</b>.</p>
 <div class="lc-info-strip"><span><b>Date of birth:</b> ${fmt("lcDob")}</span><span><b>Programme:</b> ${esc(val("lcCourse"))}</span></div>
 ${academicHtml}<section><b>ACADEMIC PROGRESS, ABILITY AND CONDUCT</b><p>${esc(val("lcConduct"))}</p></section><section><b>CO-CURRICULAR ACTIVITIES AND PARTICIPATION</b><p>${esc(val("lcActivities"))}</p></section>${val("lcExtra")!=="—"?`<section><b>ACHIEVEMENTS AND ADDITIONAL REMARKS</b><p>${esc(val("lcExtra"))}</p></section>`:""}
 <p class="lc-closing">We thank the learner and family for being part of our school community and wish the learner every success in the next stage of learning.</p>
 <div class="lc-sign"><div><b>AUTHORISED SIGNATORY</b><div class="lc-sign-space"></div><strong>${esc(val("lcHead"))}</strong><small>${esc(schoolHeadDesignation())}</small><small>Signature: __________________________</small></div><div class="lc-stamp"><b>OFFICIAL SCHOOL STAMP</b><span>Affix stamp here</span></div></div><footer class="lc-footer">${esc(db.settings.school||"")} · ${esc(db.settings.phone||"")} · ${esc(db.settings.email||"")}</footer></div></article>`;
}
function leavingCertificatePayload(){const learnerId=document.getElementById("lcLearner")?.value,l=db.learners.find(x=>String(x.id)===String(learnerId));if(!l)return null;return {id:uid("CERT"),certificateNo:`KAP-${new Date().getFullYear()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`,learnerId:l.id,learnerName:l.name,admissionNumber:l.adm,level:document.getElementById("lcType")?.value||"Primary",admissionDate:document.getElementById("lcEntered")?.value||"",leavingDate:document.getElementById("lcLeft")?.value||"",issueDate:new Date().toISOString(),issuedBy:currentUser?.username||"Authenticated staff",createdAt:new Date().toISOString(),details:{entryClass:document.getElementById("lcEntry")?.value||"",completedClass:document.getElementById("lcExit")?.value||"",programme:document.getElementById("lcCourse")?.value||"",conduct:document.getElementById("lcConduct")?.value||"",activities:document.getElementById("lcActivities")?.value||"",remarks:document.getElementById("lcExtra")?.value||"",signatory:document.getElementById("lcHead")?.value||""}}}
async function issueLeavingCertificate(){const issueField=document.getElementById("lcIssue");if(issueField)issueField.value=localDateInputValue();const cert=leavingCertificatePayload();if(!cert)return toast("Select a learner");if(!cert.admissionDate||!cert.leavingDate||!cert.details.signatory){toast("Enter the admission date, leaving date and authorised signatory name");return}if(cert.leavingDate<cert.admissionDate){toast("The leaving date cannot be earlier than the admission date");return}if(db.certificates.some(x=>x.certificateNo===cert.certificateNo)){toast("Certificate number collision. Please try again.");return}db.certificates=db.certificates||[];
 if(cloudReady&&cloud){const {data,error}=await cloud.rpc("issue_leaving_certificate",{p_certificate:cert});if(error||!data?.certificate){console.error("Certificate issue RPC failed",error);toast("Certificate was not issued. Database rejected the issue operation: "+(error?.message||"No confirmation returned"));return}Object.assign(cert,data.certificate);}
 else {db.certificates.push(cert);const saved=await save();if(saved!==true){db.certificates=db.certificates.filter(x=>x.id!==cert.id);localStorage.setItem(KEY,JSON.stringify(db));toast("Certificate was not issued because the school database save failed.");return}}
 if(!db.certificates.some(x=>String(x.id)===String(cert.id)))db.certificates.push(cert);localStorage.setItem(KEY,JSON.stringify(db));audit(`Leaving certificate issued: ${cert.certificateNo}`);const html=leavingCertificateHTML(cert.certificateNo),l=db.learners.find(x=>String(x.id)===String(cert.learnerId));closeModal();await downloadPrintableDocument(html,`${cert.certificateNo}-${String(l?.adm||"learner")}.pdf`,"portrait");toast(`Certificate ${cert.certificateNo} issued and recorded.`)}
async function downloadLeavingCertificate(){const h=leavingCertificateHTML();if(!h)return toast("Select a learner");const l=db.learners.find(x=>String(x.id)===String(document.getElementById("lcLearner")?.value));closeModal();await downloadPrintableDocument(h,`Leaving-Certificate-DRAFT-${l.adm||"Learner"}.pdf`,"portrait")}
function printLeavingCertificate(){let h=leavingCertificateHTML();if(!h)return toast("Select a learner");let l=db.learners.find(x=>String(x.id)===String(document.getElementById("lcLearner")?.value));closeModal();openPrintableWindow(h,`Leaving Certificate - ${l.name}`,"portrait")}


function verifyCertificateForm(){const rows=(db.certificates||[]).slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(c=>`<tr><td>${esc(c.certificateNo)}</td><td>${esc(c.learnerName)}</td><td>${esc(c.admissionNumber)}</td><td>${esc(c.level)}</td><td>${certificateDate(String(c.issueDate||"").slice(0,10))}</td><td><span class="fee-status paid">ISSUED</span></td></tr>`).join("");openModal(`<h2>Certificate Register & Verification</h2><div class="field"><label>Verify certificate number</label><input id="verifyCertNo" placeholder="KAP-2026-XXXXXX"></div><div class="toolbar"><button onclick="verifyCertificateNumber()">Verify</button><button class="secondary" onclick="closeModal()">Close</button></div><div id="certificateVerifyResult" style="margin-top:12px"></div><h3>Issued certificates</h3><div class="tablewrap"><table class="table"><thead><tr><th>Certificate No.</th><th>Learner</th><th>Admission</th><th>Level</th><th>Issue Date</th><th>Status</th></tr></thead><tbody>${rows||'<tr><td colspan="6">No certificates have been issued.</td></tr>'}</tbody></table></div>`)}
function verifyCertificateNumber(){const no=String(document.getElementById("verifyCertNo")?.value||"").trim().toUpperCase(),c=(db.certificates||[]).find(x=>String(x.certificateNo||"").toUpperCase()===no),out=document.getElementById("certificateVerifyResult");if(!out)return;out.innerHTML=c?`<div class="kpi"><b>VERIFIED — ISSUED BY KAPNANDA</b><p>Certificate: ${esc(c.certificateNo)}</p><p>Learner: ${esc(c.learnerName)} (${esc(c.admissionNumber)})</p><p>Level: ${esc(c.level)} · Issue date: ${certificateDate(String(c.issueDate||"").slice(0,10))}</p></div>`:`<div class="error-card card">No matching issued certificate was found in the current school certificate register.</div>`}

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
  const rows=learners.map((l,i)=>`<tr>
    <td class="mf-no">${i+1}</td><td class="mf-adm">${esc(l.adm||"")}</td>
    <td class="mf-name">${esc(l.name||"")}</td><td class="mf-class">${esc(l.class||"")}</td>
    <td class="mf-money">${dueFor(l).toLocaleString("en-KE")}</td>
    <td class="mf-write"></td><td class="mf-write"></td><td class="mf-write"></td>
    <td class="mf-total"></td><td class="mf-balance"></td><td class="mf-sign"></td>
  </tr>`).join("")||Array.from({length:20},(_,i)=>`<tr><td class="mf-no">${i+1}</td>${Array.from({length:10},()=>'<td></td>').join("")}</tr>`).join("");
  const html=`<div class="manual-fee-sheet"><header><h1>${esc(db.settings.school||"KAPNANDA COMPREHENSIVE SCHOOL")}</h1><h2>${esc(label)} — ${esc(db.settings.term)} ${esc(String(db.settings.year))} FEE COLLECTION REGISTER</h2><p>Class Teacher: __________________________ &nbsp; Date: __________________</p><p class="mf-instruction">Record each payment in the correct learner's row. Enter date and amount in the payment columns.</p></header>
  <table class="manual-fee-table"><thead><tr><th rowspan="2">No.</th><th rowspan="2">Admission No.</th><th rowspan="2">Learner's Full Name</th><th rowspan="2">Class</th><th rowspan="2">Fee Due<br>(KSh)</th><th colspan="3">Payments Received (KSh)</th><th rowspan="2">Total Paid<br>(KSh)</th><th rowspan="2">Balance<br>(KSh)</th><th rowspan="2">Initials</th></tr><tr><th>Payment 1<br>Date / Amount</th><th>Payment 2<br>Date / Amount</th><th>Payment 3<br>Date / Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="signature">Class Teacher: ____________________ &nbsp; Bursar: ____________________ &nbsp; ${esc(schoolHeadDesignation())}: ____________________</p></div>`;
  await downloadPrintableDocument(html,`${label.replace(/[^a-z0-9]+/gi,"-")}-Manual-Fee-Register-${db.settings.term}-${db.settings.year}.pdf`,"landscape");
}
function feeCsvForm(){openModal(`<h2>Download Fee CSV</h2>${field("Section","fcsvsec","All","select",["All","ECDE","Primary","Junior"])}${field("Class","fcsvclass","All","select",["All"].concat(classes))}<div class="toolbar"><button onclick="downloadFeeCsv()">Download CSV</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`)}
function downloadFeeCsv(){const sec=v("fcsvsec")||"All",cls=v("fcsvclass")||"All",ls=feeRegisterData(sec,cls),head=["No","Admission","Learner Name","Class","Amount Payable","Amount Paid","Balance","Status","Last Payment","Receipt/Method"],rows=ls.map((l,i)=>{const ps=feePeriodPaymentsForLearner(l.id),paid=ps.reduce((a,b)=>a+Number(b.amount||0),0),due=feeFor(l.class),last=ps.slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0];return [i+1,l.adm,l.name,l.class,due,paid,Math.max(due-paid,0),feeStatus(due,paid),last?new Date(last.date).toLocaleDateString():"",last?.receipt||last?.method||""]});const csv=[head,...rows].map(r=>r.map(x=>`"${String(x??"").replace(/"/g,'""')}"`).join(",")).join("\n"),a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download=`${cls!=="All"?cls:sec}-Fee-List-${db.settings.term}-${db.settings.year}.csv`;a.click();closeModal();toast("Fee CSV downloaded")}
function registerClassForm(kind){const title=kind==="marks"?"Marks Recording Class List":"Meals Recording Class List";openModal(`<h2>${title}</h2><p class="small">Choose a class to generate a blank A4 register with the learners already enrolled in that class.</p>${field("Class","regclass",classes[0]||"Grade 1","select",classes)}<div class="toolbar"><button class="success" onclick="generateRegister('${kind}')">Generate</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`)}
function marksRegisterForm(){registerClassForm("marks")}
function mealRegisterForm(){openModal(`<h2>Meals Register</h2><p class="small">Download a printable A4 meals register for manual entry, export the class list to CSV, or import completed meal records from CSV.</p>${field("Class","mealclass",classes[0]||"Grade 1","select",classes)}<div class="toolbar"><button class="success" onclick="downloadMealsRegister()">⬇ Download Meals Register PDF</button><button class="light" onclick="printMealsRegister()">🖨 Print / Manual Entry</button><button class="light" onclick="downloadMealsCsv()">⬇ Download Meals CSV</button><button class="light" onclick="downloadMealsCsvTemplate()">Download CSV Template</button><button class="light" onclick="document.getElementById('mealsCsvFile').click()">⬆ Import Meals CSV</button><input id="mealsCsvFile" type="file" accept=".csv,text/csv" style="display:none" onchange="uploadMealsCsv(this)"></div><div class="toolbar"><button class="secondary" onclick="closeModal()">Close</button></div>`)}
function mealsForClass(c){return (db.mealRecords||[]).filter(r=>r.class===c&&String(r.term||db.settings.term)===String(db.settings.term)&&String(r.year||db.settings.year)===String(db.settings.year))}
function mealsRegisterHTML(c){
 const ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived"), records=db.mealRecords||[];
 const rows=ls.map((l,i)=>{const r=records.find(x=>String(x.learner)===String(l.id)&&x.class===c&&String(x.term||db.settings.term)===String(db.settings.term)&&String(x.year||db.settings.year)===String(db.settings.year));return `<tr><td>${i+1}</td><td>${esc(l.adm||"")}</td><td>${esc(l.name||"")}</td><td>${esc(r?.maize||"")}</td><td>${esc(r?.beans||"")}</td><td>${esc(r?.teachersWelfare||"")}</td><td>${esc(r?.totalDays||"")}</td><td>${esc(r?.remarks||"")}</td></tr>`}).join("");
 const blank=Array.from({length:Math.max(15,ls.length?0:25)},(_,i)=>`<tr><td>${ls.length+i+1}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join("");
 return `<div class="meal-register-print"><div class="schoolhead"><h1>${esc(db.settings.school||"KAPNANDA PRIMARY AND JUNIOR SCHOOL")}</h1><p>MEALS & TEACHERS WELFARE RECORDING REGISTER</p><p>${esc(c)} • ${esc(db.settings.term)}, ${esc(String(db.settings.year))}</p></div><div class="register-meta"><span>Learners: <b>${ls.length}</b></span><span>Maize: __________________</span><span>Beans: __________________</span><span>Teachers Welfare: __________________</span><span>Recorded by: __________________</span></div><table class="register-table meal-register-table"><thead><tr><th>No.</th><th>Adm.</th><th>Learner Name</th><th>Maize</th><th>Beans</th><th>Teachers Welfare Meals</th><th>Total / Days</th><th>Remarks</th></tr></thead><tbody>${rows}${blank}</tbody></table><div class="register-sign"><span>Recorded by: __________________</span><span>Checked by: __________________</span><span>Date: ____________</span></div></div>`;
}
async function downloadMealsRegister(){const c=v("mealclass")||classes[0]||"Grade 1";const html=mealsRegisterHTML(c);closeModal();await downloadPrintableDocument(html,`${c}-Meals-Register-${db.settings.term}-${db.settings.year}.pdf`,"portrait")}
function printMealsRegister(){const c=v("mealclass")||classes[0]||"Grade 1";const html=mealsRegisterHTML(c);closeModal();openPrintableWindow(html,`${c} Meals Register`,"portrait")}
function downloadMealsCsv(){const c=v("mealclass")||classes[0]||"Grade 1",ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived"),head=["admission_number","learner_name","class","maize","beans","teachers_welfare_meals","total_days","remarks","term","year"],records=db.mealRecords||[];const rows=ls.map(l=>{const r=records.find(x=>String(x.learner)===String(l.id)&&x.class===c&&String(x.term||db.settings.term)===String(db.settings.term)&&String(x.year||db.settings.year)===String(db.settings.year))||{};return [l.adm,l.name,c,r.maize||"",r.beans||"",r.teachersWelfare||"",r.totalDays||"",r.remarks||"",db.settings.term,db.settings.year]});downloadCsvFile([head,...rows],`${c}-Meals-${db.settings.term}-${db.settings.year}.csv`);toast("Meals CSV downloaded")}
function downloadMealsCsvTemplate(){downloadCsvFile([["admission_number","maize","beans","teachers_welfare_meals","total_days","remarks"],["ADM001","2 bags","1 bag","10","20",""]],"meals_upload_template.csv")}
function downloadCsvFile(rows,filename){const csv=rows.map(r=>r.map(x=>`"${String(x??"").replace(/"/g,'""')}"`).join(",")).join("\\n"),url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"})),a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function uploadMealsCsv(input){readCsvFileInput(input,text=>{const rows=parseDedicatedCsv(text);if(!rows.length){toast("CSV is empty or missing a header row");return}db.mealRecords=db.mealRecords||[];let added=0,updated=0,skipped=0;rows.forEach(r=>{const adm=csvGet(r,["admission","adm","admission_number","adm_no","learner_admission"]),l=db.learners.find(x=>String(x.adm||"").trim().toLowerCase()===adm.trim().toLowerCase()&&x.status!=="Archived");if(!l||!adm){skipped++;return}let rec=db.mealRecords.find(x=>String(x.learner)===String(l.id)&&String(x.term||db.settings.term)===String(csvGet(r,["term"])||db.settings.term)&&String(x.year||db.settings.year)===String(csvGet(r,["year"])||db.settings.year));const values={learner:l.id,class:l.class,maize:csvGet(r,["maize"]),beans:csvGet(r,["beans"]),teachersWelfare:csvGet(r,["teachers_welfare_meals","teachers_welfare","welfare"]),totalDays:csvGet(r,["total_days","days","total"]),remarks:csvGet(r,["remarks","comments"]),term:csvGet(r,["term"])||db.settings.term,year:String(csvGet(r,["year","academic_year"])||db.settings.year),updatedAt:new Date().toISOString()};if(rec){Object.assign(rec,values);updated++}else{db.mealRecords.push({id:uid("MEAL"),...values});added++}});if(added+updated){save();audit(`Meals CSV import: ${added} added, ${updated} updated, ${skipped} skipped`)}input.value="";toast(`Meals CSV: ${added} added, ${updated} updated, ${skipped} skipped. Reopen register to view records.`)})}
function marksRegisterHTML(c){const ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived"),subs=subjectsForPeriod(c,db.settings.year,db.settings.term);return `<div class="marks-register-print"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>CLASS MARKS RECORDING REGISTER</p><p>${esc(c)} • ${esc(db.settings.term)}, ${esc(String(db.settings.year))}</p></div><div class="register-meta"><span>Learners: <b>${ls.length}</b></span><span>Teacher: __________________</span><span>Assessment: __________________</span></div><table class="register-table marks-register-table"><thead><tr><th>No.</th><th>Adm.</th><th>Learner Name</th>${subs.map(s=>`<th>${esc(s)}</th>`).join("")}<th>Total</th><th>Average</th><th>Grade</th></tr></thead><tbody>${ls.map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td>${esc(l.name)}</td>${subs.map(()=>'<td class="blank-cell"></td>').join("")}<td></td><td></td><td></td></tr>`).join("")||`<tr><td colspan="${6+subs.length}">No learners found.</td></tr>`}</tbody></table><div class="register-sign"><span>Teacher: __________________</span><span>Signature: __________________</span><span>Date: ____________</span></div></div>`}
function mealRegisterHTML(c){const ls=db.learners.filter(l=>l.class===c&&l.status!=="Archived");return `<div class="meal-register-print"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>MEALS & TEACHERS WELFARE RECORDING REGISTER</p><p>${esc(c)} • ${esc(db.settings.term)}, ${esc(String(db.settings.year))}</p></div><div class="register-meta"><span>Learners: <b>${ls.length}</b></span><span>Maize: __________________</span><span>Beans: __________________</span><span>Teachers Welfare: __________________</span></div><table class="register-table meal-register-table"><thead><tr><th>No.</th><th>Adm.</th><th>Learner Name</th><th>Maize</th><th>Beans</th><th>Teachers Welfare Meals</th><th>Total / Days</th><th>Remarks</th></tr></thead><tbody>${ls.map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.adm)}</td><td>${esc(l.name)}</td><td></td><td></td><td></td><td></td><td></td></tr>`).join("")||'<tr><td colspan="8">No learners found.</td></tr>'}</tbody></table><div class="register-sign"><span>Recorded by: __________________</span><span>Checked by: __________________</span><span>Date: ____________</span></div></div>`}
function generateRegister(kind){const c=v("regclass"),html=kind==="marks"?marksRegisterHTML(c):mealRegisterHTML(c);closeModal();const title=kind==="marks"?`${c} Marks Register`:`${c} Meals Register`;openPrintableWindow(html,title,kind==="marks"?"landscape":"portrait")}
async function renderPrintableDocumentBlob(html,orientation="portrait"){
 const markup=String(html||"").trim();if(!markup||!markup.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim())throw new Error("Document is empty");
 const stage=document.createElement("div"),width=orientation==="landscape"?1122:794;stage.className="pdf-export-content-stage";stage.style.cssText=`position:absolute!important;left:0!important;top:0!important;width:${width}px!important;height:auto!important;overflow:visible!important;background:#fff!important;color:#172033!important;z-index:2147483000!important;display:block!important;visibility:visible!important;opacity:1!important;pointer-events:none!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;`;stage.innerHTML=markup;document.body.appendChild(stage);
 try{if(document.fonts?.ready)await document.fonts.ready;await Promise.all(Array.from(stage.querySelectorAll("img")).map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r;setTimeout(r,5000)})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(typeof html2pdf!=="function")throw new Error("PDF library unavailable");const w=Math.max(width,stage.scrollWidth),h=Math.max(300,stage.scrollHeight);return await html2pdf().set({margin:5,image:{type:"jpeg",quality:.95},html2canvas:{scale:markup.includes("leaving-cert")||markup.includes("fee-structure-sheet")?2:1.35,useCORS:true,allowTaint:false,backgroundColor:"#fff",logging:false,scrollX:0,scrollY:0,width:w,height:h,windowWidth:w,windowHeight:h},jsPDF:{unit:"mm",format:"a4",orientation,compress:true},pagebreak:{mode:["css","legacy"],avoid:["tr"]}}).from(stage).outputPdf("blob");}finally{stage.remove()}
}
async function sendParentPdfDocument(learnerId,html,fileName,documentType){
 if(!cloud||!cloudUser){toast("Sign in to Supabase before emailing parent documents");return false}const learner=db.learners.find(x=>String(x.id)===String(learnerId));if(!learner||!learner.parentEmail||learner.parentEmailConsent!==true){toast("A parent email address and recorded email consent are required");return false}
 try{const blob=await renderPrintableDocumentBlob(html,"portrait"),buffer=await blob.arrayBuffer(),bytes=new Uint8Array(buffer);let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));const pdfBase64=btoa(binary);const {data:{session}}=await cloud.auth.getSession();const {data,error}=await cloud.functions.invoke("send-parent-document",{body:{learnerId:String(learner.id),documentType,fileName,pdfBase64},headers:{Authorization:`Bearer ${session?.access_token||""}`}});if(error)throw error;if(!data?.accepted)throw new Error(data?.error||"Email provider did not accept the message");toast("PDF email accepted by the provider for "+learner.parentEmail);return true}catch(e){console.error("Parent PDF email failed",e);toast("Email was not sent: "+(e.message||e));return false}
}
async function emailFeeStatement(){const id=document.getElementById("feeStatementLearner")?.value;if(!id)return toast("Select a learner");const l=db.learners.find(x=>String(x.id)===String(id));const html=feeStatementHTML(id),name=`Fee-Statement-${l.adm}-${db.settings.term}-${db.settings.year}.pdf`;closeModal();await sendParentPdfDocument(id,html,name,"fee_statement")}
async function emailSelectedReport(){const id=document.getElementById("f_rl")?.value,e=document.getElementById("f_re")?.value,l=db.learners.find(x=>String(x.id)===String(id));if(!l)return toast("Select a learner and generate the report first");const html=buildLearnerReportHTML(l,e),exam=db.exams.find(x=>String(x.id)===String(e));await sendParentPdfDocument(id,html,`Report-${l.adm}-${(exam?.name||"Assessment").replace(/[^a-z0-9]+/gi,"-")}.pdf`,"examination_report")}
async function createReportStyleA4PdfBlob(html,orientation="portrait"){
  // This deliberately follows downloadReportPDF(): fixed A4 canvas, cloned
  // document, html2canvas at scale 2, then one full-page jsPDF image.
  const markup=String(html||"").trim();
  if(!markup||!markup.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim())throw new Error("Document is empty");
  const isLandscape=String(orientation).toLowerCase()==="landscape";
  const pageWidth=isLandscape?1123:794;
  const pageHeight=isLandscape?794:1123;
  const stage=document.createElement("div");
  stage.className="pdf-export-stage pdf-single-report";
  stage.style.cssText=`position:fixed!important;left:0!important;top:0!important;width:${pageWidth}px!important;height:${pageHeight}px!important;overflow:hidden!important;background:#fff!important;z-index:2147483647!important;display:block!important;visibility:visible!important;opacity:1!important;pointer-events:none!important;`;
  const holder=document.createElement("div");
  holder.innerHTML=markup;
  const clone=holder.firstElementChild||holder;
  clone.removeAttribute?.("id");
  clone.querySelectorAll?.(".no-print,.toolbar").forEach(x=>x.remove());
  // Match the approved report form's fixed page box and internal padding.
  clone.style.cssText=`box-sizing:border-box!important;width:${pageWidth}px!important;min-height:${pageHeight}px!important;height:${pageHeight}px!important;max-width:none!important;margin:0!important;padding:28px!important;background:#fff!important;display:block!important;visibility:visible!important;opacity:1!important;color:#172033!important;overflow:hidden!important;`;
  stage.appendChild(clone);
  document.body.appendChild(stage);
  try{
    if(document.fonts?.ready)await document.fonts.ready;
    await Promise.all(Array.from(clone.querySelectorAll?.("img")||[]).map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=resolve;img.onerror=resolve;setTimeout(resolve,5000)})));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(typeof html2canvas!=="function")throw new Error("html2canvas unavailable");
    const canvas=await html2canvas(clone,{scale:2,useCORS:true,allowTaint:false,backgroundColor:"#ffffff",logging:false,scrollX:0,scrollY:0,width:pageWidth,height:pageHeight,windowWidth:pageWidth,windowHeight:pageHeight});
    if(!canvas.width||!canvas.height)throw new Error("Empty canvas");
    const PDF=window.jspdf?.jsPDF;
    if(!PDF)throw new Error("jsPDF unavailable");
    const pdf=new PDF({unit:"mm",format:"a4",orientation:isLandscape?"landscape":"portrait",compress:true});
    pdf.addImage(canvas.toDataURL("image/jpeg",0.98),"JPEG",0,0,isLandscape?297:210,isLandscape?210:297,undefined,"FAST");
    return pdf.output("blob");
  }finally{stage.remove()}
}
async function downloadPrintableDocument(html,filename,orientation="landscape"){
  try{
    const blob=await createReportStyleA4PdfBlob(html,orientation);
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=String(filename||"school-document.pdf");
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    toast("Downloaded using the same A4 PDF method as the learner report form.");
    return true;
  }catch(err){
    console.error("Report-style A4 PDF export failed:",err);
    toast("PDF generation failed. Please check the browser PDF libraries and try again.");
    return false;
  }
}
async function openReportStyleA4PrintWindow(html,title,orientation="portrait"){
 const w=window.open("about:blank","_blank");
 if(!w){toast("Allow pop-ups to print this document");return}
 try{
   w.document.write("<!doctype html><html><head><title>"+esc(title||"School document")+"</title></head><body style='font-family:Arial,sans-serif;padding:24px'>Preparing A4 print document…</body></html>");
   w.document.close();
   const blob=await createReportStyleA4PdfBlob(html,orientation);
   const url=URL.createObjectURL(blob);
   w.location.href=url;
   setTimeout(()=>{try{w.focus()}catch(e){}},500);
 }catch(err){
   console.error("Report-style print preparation failed:",err);
   try{w.close()}catch(e){}
   toast("Could not prepare the A4 print document. Check the PDF libraries and try again.");
 }
}

function openPrintableWindow(html,title,orientation="portrait"){
 const w=window.open("","_blank");if(!w){toast("Allow pop-ups to print this document");return}
 const styles=Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(x=>`<link rel="stylesheet" href="${x.href}">`).join("");
 w.document.write(`<!doctype html><html><head><title>${esc(title)}</title>${styles}<style>@page{size:A4 ${orientation};margin:5mm}html,body{width:auto!important;min-width:0!important;max-width:none!important;overflow:visible!important}body{background:#fff!important;margin:0;color:#172033;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.fee-print-sheet,.marks-register-print,.meal-register-print{width:100%;box-sizing:border-box}.register-table{width:100%;border-collapse:collapse}.register-table th,.register-table td{border:1px solid #94a3b8;padding:4px;font-size:9px}.register-table th{background:#2563eb;color:#fff}.marks-register-table th,.marks-register-table td{font-size:7px;padding:3px}.blank-cell{height:25px}.register-meta{display:flex;flex-wrap:wrap;gap:14px;padding:7px 0;font-size:10px}.register-sign{display:flex;justify-content:space-between;gap:15px;margin-top:10px;font-size:9px}.schoolhead{text-align:center}.schoolhead h1{margin:0}.schoolhead p{margin:2px 0}.no-print{display:none!important}.a4-document{display:block!important;width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important;margin:0 auto!important;padding:4mm!important;overflow:visible!important;background:#fff!important;color:#172033!important;break-inside:auto}.a4-document *{box-sizing:border-box}.tinet-invoice header{gap:12px;flex-wrap:wrap;align-items:flex-start;min-width:0}.a4-document table{width:100%!important;max-width:100%!important;table-layout:fixed!important;border-collapse:collapse;overflow-wrap:anywhere}.a4-document th,.a4-document td{overflow-wrap:anywhere;word-break:normal}.leaving-cert{min-height:0!important;height:auto!important;border-width:5px!important;padding:9mm!important;font-size:11pt!important;line-height:1.45!important}.leaving-cert p{margin:10px 0!important}.leaving-cert section{margin:12px 0!important}.lc-top{font-size:14pt!important}.lc-top img{width:75px!important;height:70px!important}.lc-sign{margin-top:16px!important}.invoice-totals{margin:12px 0!important;padding:10px!important}.fee-structure-sheet table,.tinet-invoice table{font-size:10pt}.fee-structure-sheet th,.fee-structure-sheet td,.tinet-invoice th,.tinet-invoice td{padding:7px!important}.tinet-invoice,.fee-structure-sheet{padding:4mm!important;margin:0!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important}.tinet-invoice th,.tinet-invoice td,.fee-structure-sheet th,.fee-structure-sheet td{padding:2mm 2.2mm!important;line-height:1.25!important}.invoice-meta,.invoice-learner,.fee-structure-intro{margin:3mm 0!important;padding:2.5mm!important;gap:2.5mm!important}.invoice-section-title{margin:3mm 0 1.5mm!important}.invoice-totals{margin:3mm 0!important;padding:3mm!important}@media print{.a4-document{break-inside:auto;page-break-inside:auto}.leaving-cert{break-inside:avoid;page-break-inside:avoid}}</style></head><body>${html}<script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);w.document.close();
}

function paymentForm(id){let l=db.learners.find(x=>x.id===id);openModal(`<h2>Record Fee Payment</h2><p><b>${esc(l.name)}</b> — ${esc(l.class)}</p><p>Period: <b>${esc(db.settings.term)}, ${esc(db.settings.year)}</b> • Due: <b>KSh ${feeFor(l.class).toLocaleString()}</b></p><div class="formgrid">${field("Amount","amount","","number")}${field("Method","method","M-Pesa","select",["M-Pesa","Cash","Bank","Other"])}${field("Receipt Number","receipt",uid("R").toUpperCase())}</div><div class="toolbar"><button onclick="savePayment('${id}')">Save & Receipt</button><button class="secondary" onclick="closeModal()">Cancel</button></div></div>`)}
async function savePayment(id){let l=db.learners.find(x=>x.id===id),amount=Number(v("amount")),receipt=String(v("receipt")||"").trim();if(!l||!Number.isFinite(amount)||amount<=0){toast("Enter a valid payment amount greater than zero");return}if(!receipt){toast("Enter a receipt/reference number");return}if(db.payments.some(p=>String(p.receipt||"").trim().toLowerCase()===receipt.toLowerCase())){toast("This receipt/reference number is already recorded. Check payment history to avoid a duplicate.");return}const payment={id:uid("P"),learner:id,class:l.class,amount,method:v("method"),receipt,date:new Date().toISOString(),term:db.settings.term,year:db.settings.year,enteredBy:currentUser?.username||cloudUser?.email||"Staff",createdAt:new Date().toISOString()};db.payments.push(payment);const synced=await save();if(synced!==true){db.payments=db.payments.filter(p=>p.id!==payment.id);localStorage.setItem(KEY,JSON.stringify(db));toast("Payment was not confirmed in the shared database. No receipt was issued; please refresh before retrying.");return}audit("Fee payment recorded: "+receipt);closeModal();Fees();toast("Payment saved successfully. Receipt: "+receipt);if(db.settings.autoFeePaymentAlerts===true&&l.parentSmsConsent===true){sendFeePaymentParentAlert(l,payment).then(result=>{db.notificationLog.push({id:uid("MSG"),learner:l.id,recipient:l.phone,type:"fee_payment",channel:"sms",createdAt:new Date().toISOString(),status:result?.results?.find(x=>String(x.channel||"").toLowerCase()==="sms")?.status||"provider_response_received",providerResponse:JSON.stringify(result||{}).slice(0,1500),paymentId:payment.id});save()}).catch(e=>{db.notificationLog.push({id:uid("MSG"),learner:l.id,recipient:l.phone,type:"fee_payment",channel:"sms",createdAt:new Date().toISOString(),status:"failed",error:String(e.message||e),paymentId:payment.id});save();console.error("Fee payment parent alert:",e);toast("Payment saved; SMS failed. The payment remains recorded.")})}}
async function sendFeePaymentParentAlert(learner,payment){
  if(!cloud||!cloudUser||!cloudReady)throw new Error("Connect to the shared Supabase database first");
  const phone=normalizeKenyanPhone(learner.phone);
  if(!phone)throw new Error("No valid parent/guardian phone number is recorded");
  const {data:{session},error:sessionError}=await cloud.auth.getSession();
  if(sessionError||!session?.access_token)throw new Error("Staff session expired");
  const due=feeFor(learner.class),opening=feeOpeningBalanceForLearner(learner),paid=feePeriodPaymentsForLearner(learner.id).reduce((n,p)=>n+Number(p.amount||0),0),balance=Math.max(0,opening+due-paid),paymentDate=new Date(payment.date).toLocaleDateString("en-GB");
  const message=`${db.settings.school||"School"}: Payment received for ${learner.name} (Adm ${learner.adm||"—"}). Amount KSh ${Number(payment.amount).toLocaleString()}, receipt ${payment.receipt||"—"}, date ${paymentDate}. Total paid this term: KSh ${paid.toLocaleString()}; outstanding balance: KSh ${balance.toLocaleString()}. ${payment.term} ${payment.year}.`;
  const {data,error}=await cloud.functions.invoke("send-school-messages",{body:{channel:"sms",recipients:[{learnerId:String(learner.id),name:learner.parent||"Parent/Guardian",phone,message}],smsText:message,personalized:true,messageType:"fee_payment",schoolName:String(db.settings.school||"School"),term:String(payment.term||""),year:String(payment.year||"")}});
  if(error)throw new Error(error.message||"SMS gateway request failed");
  if(!data||data.error)throw new Error(data?.error||"No response from SMS gateway");
  const smsResult=(data.results||[]).find(x=>String(x.channel||"").toLowerCase()==="sms");
  if(!smsResult||smsResult.status!=="submitted"||Number(smsResult.failed||0)>0)throw new Error(smsResult?.recipients?.find(x=>x.status==="failed")?.detail||smsResult?.detail||"SMS provider did not confirm acceptance");
  audit(`Fee payment SMS submitted for ${learner.adm||learner.name}`);
  return data;
}
function managePayments(learnerId){let l=db.learners.find(x=>x.id===learnerId),ps=db.payments.filter(p=>p.learner===learnerId&&p.term===db.settings.term&&String(p.year)===String(db.settings.year));let rows=ps.map(p=>`<tr><td>${new Date(p.date).toLocaleDateString()}</td><td>KSh ${Number(p.amount||0).toLocaleString()}</td><td>${esc(p.method||"")}</td><td>${esc(p.receipt||"")}</td><td><button class="light" onclick="editPayment('${p.id}')">Edit</button> <button class="danger" onclick="deletePayment('${p.id}')">Remove</button></td></tr>`).join("");openModal(`<h2>Manage Fees</h2><p><b>${esc(l.name)}</b> — ${esc(l.class)}</p><div class="tablewrap"><table class="table"><tr><th>Date</th><th>Amount</th><th>Method</th><th>Receipt</th><th>Actions</th></tr>${rows||"<tr><td colspan=5>No payments recorded for this period.</td></tr>"}</table></div><div class="toolbar"><button onclick="paymentForm('${learnerId}')">+ Record Payment</button><button class="secondary" onclick="closeModal()">Close</button></div>`)}
function editPayment(id){let p=db.payments.find(x=>x.id===id);if(!p)return;openModal(`<h2>Edit Fee Payment</h2><div class="formgrid">${field("Amount","amount",p.amount,"number")}${field("Method","method",p.method||"M-Pesa","select",["M-Pesa","Cash","Bank","Other"])}${field("Receipt Number","receipt",p.receipt||"")}</div><div class="toolbar"><button onclick="saveEditedPayment('${id}')">Save Changes</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`)}
async function saveEditedPayment(id){let p=db.payments.find(x=>x.id===id),amount=Number(v("amount")),receipt=String(v("receipt")||"").trim();if(!p||!Number.isFinite(amount)||amount<=0||!receipt){toast("Enter a valid amount and receipt/reference number");return}if(db.payments.some(x=>x.id!==id&&String(x.receipt||"").trim().toLowerCase()===receipt.toLowerCase())){toast("That receipt/reference number is already in use");return}const before={...p};p.amount=amount;p.method=v("method");p.receipt=receipt;const synced=await save();if(synced!==true){Object.assign(p,before);localStorage.setItem(KEY,JSON.stringify(db));toast("Payment changes were not confirmed in the shared database");return}audit("Fee payment edited: "+receipt);closeModal();Fees();toast("Payment updated") }
async function deletePayment(id){let p=db.payments.find(x=>x.id===id);if(!p)return;if(confirm(`Remove fee payment of KSh ${Number(p.amount||0).toLocaleString()}? This cannot be undone.`)){const removed={...p};db.payments=db.payments.filter(x=>x.id!==id);const synced=await save();if(synced!==true){db.payments.push(removed);localStorage.setItem(KEY,JSON.stringify(db));toast("Payment removal was not confirmed in the shared database");return}audit("Fee payment removed: "+(removed.receipt||removed.id));Fees();toast("Payment removed")}}
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
function printBomMeetingPack(){const budgets=db.bomBudgets.filter(x=>String(x.year||db.settings.year)===String(db.settings.year)&&String(x.term||db.settings.term)===String(db.settings.term));const tx=db.capitationTransactions.filter(x=>String(x.year||db.settings.year)===String(db.settings.year)&&String(x.term||db.settings.term)===String(db.settings.term));const agenda=["Opening prayer and welcome","Confirmation of previous minutes","Matters arising","Review of capitation received (Primary and Junior)","Review of expenditure and supporting vouchers","Discussion and approval of proposed budget","Prioritisation of teaching and learning resources","Any other business","Date of next meeting","Adjournment"];const money=n=>"KSh "+Number(n||0).toLocaleString();const budgetRows=budgets.map((b,i)=>`<tr><td>${i+1}</td><td>${esc(b.section)}</td><td>${esc(b.category)}</td><td>${esc(b.description||"")}</td><td>${money(b.amount)}</td></tr>`).join("");const txRows=tx.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.date||"")}</td><td>${esc(x.kind==="receipt"?"Funds received":"Expenditure")}</td><td>${esc(x.section||"")}</td><td>${esc(x.description||x.category||"")}</td><td>${money(x.amount)}</td></tr>`).join("");const html=`<article class="bom-meeting-pack"><header><h1>${esc(db.settings.school)}</h1><h2>BOARD OF MANAGEMENT MEETING</h2><h3>AGENDA, CAPITATION REPORT & PROPOSED BUDGET</h3><p>${esc(db.settings.term)}, ${esc(String(db.settings.year))}</p><p>Date: __________________ &nbsp; Venue: __________________</p></header><h3>Proposed Agenda</h3><ol>${agenda.map(x=>`<li>${esc(x)}</li>`).join("")}</ol><h3>Capitation / Funds Ledger</h3><table><thead><tr><th>#</th><th>Date</th><th>Type</th><th>Section</th><th>Description</th><th>Amount</th></tr></thead><tbody>${txRows||'<tr><td colspan="6">No entries recorded</td></tr>'}</tbody></table><h3>Proposed Budget</h3><table><thead><tr><th>#</th><th>Section</th><th>Category</th><th>Purpose</th><th>Amount</th></tr></thead><tbody>${budgetRows||'<tr><td colspan="5">No budget lines entered</td></tr>'}</tbody></table><h3>Minutes / Resolutions</h3><p>1. _____________________________________________________________________</p><p>2. _____________________________________________________________________</p><p>3. _____________________________________________________________________</p><h3>Signatures</h3><p>Chairperson: __________________________ &nbsp; Secretary: __________________________</p><p>${esc(schoolHeadDesignation())}: _________________________ &nbsp; Date: __________________</p></article>`;openPrintableWindow(html,"BOM Meeting Pack","portrait")}

function Timetable(){document.getElementById("content").innerHTML=`<div class="card timetable-page"><div class="pagehero no-print"><div><h2>Smart Timetable Generator</h2><p>Separate engines for ECDE, Lower Primary, Upper Primary and Junior. The generator prevents class/teacher double-booking and respects section-specific lesson duration/breaks.</p></div></div><div class="formgrid no-print">${field("Section","ts","Junior","select",["ECDE","Lower Primary","Upper Primary","Junior"])}${field("Class","tc","Grade 7","select",classes)}${field("Teacher","tt","", "select",[""].concat(db.teachers.map(t=>t.name)))}</div><div class="toolbar no-print"><button onclick="generateTimetable()">Generate Class Timetable</button><button class="light" onclick="teacherTimetable()">Teacher Timetable</button><button class="light" onclick="printElement('tout')">Print A4</button></div><div id="tout" style="margin-top:15px"></div></div>`}
function timing(c){if(ecde.includes(c))return {dur:30,start:"08:30",end:"12:40",breaks:[["10:00","10:20"]],lunch:null};if(junior.includes(c))return {dur:40,start:"08:00",end:"15:30",breaks:[["10:00","10:30"],["11:50","12:00"]],lunch:["12:00","13:00"]};return {dur:35,start:"08:00",end:"15:30",breaks:[["09:30","09:50"],["11:00","11:30"]],lunch:["12:40","13:40"]}}
function mins(s){let [h,m]=s.split(":").map(Number);return h*60+m} function hh(n){let h=Math.floor(n/60),m=n%60;return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")}
function makeSlots(c){let t=timing(c),out=[];for(let d of days){let cur=mins(t.start);while(cur+ t.dur<=mins(t.end)){let end=cur+t.dur, blocked=false;for(let b of t.breaks){let bs=mins(b[0]),be=mins(b[1]);if(cur<be&&end>bs)blocked=true}if(t.lunch&&cur<mins(t.lunch[1])&&end>mins(t.lunch[0]))blocked=true;if(!blocked)out.push({day:d,time:`${hh(cur)}–${hh(end)}`});cur=end}}return out}
function generateTimetable(){let c=v("tc"),teacher=v("tt"),ss=subjectsFor(c);if(!ss.length){toast("No active subjects for this class");return}let slots=makeSlots(c),freq={};ss.forEach(s=>freq[s]=defaultFreq[s]||4);let assignments=[],used=new Set(),ti=0;for(const s of ss){for(let n=0;n<freq[s];n++){let placed=false;for(let k=0;k<slots.length;k++){let sl=slots[(ti+k)%slots.length],key=sl.day+"|"+sl.time;if(!used.has(key)){assignments.push({id:uid("TT"),class:c,subject:s,teacher:teacher||"Class Teacher",day:sl.day,time:sl.time});used.add(key);ti=(ti+k+1)%slots.length;placed=true;break}}if(!placed)break}}db.timetable=db.timetable.filter(x=>x.class!==c).concat(assignments);save();audit("Timetable generated for "+c);renderTimetable(c);toast("Timetable generated")}
function renderTimetable(c){let rows=days.map(d=>{let a=db.timetable.filter(x=>x.class===c&&x.day===d);return `<tr><th>${d}</th><td>${a.map(x=>`<span class="badge" style="margin:3px">${esc(x.time)} • ${esc(x.subject)} • ${esc(x.teacher)}</span>`).join(" ")||"FREE"}</td></tr>`}).join("");document.getElementById("tout").innerHTML=`<div class="report"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>${esc(c)} TIMETABLE</p><p>${esc(db.settings.term)}, ${db.settings.year}</p></div><table><tr><th>Day</th><th>Lessons</th></tr>${rows}</table></div>`}
function teacherTimetable(){let n=v("tt");if(!n){toast("Select a teacher");return}let a=db.timetable.filter(x=>x.teacher===n),rows=days.map(d=>`<tr><th>${d}</th><td>${a.filter(x=>x.day===d).map(x=>`${esc(x.time)} — ${esc(x.class)} — ${esc(x.subject)}`).join("<br>")||"FREE"}</td></tr>`).join("");document.getElementById("tout").innerHTML=`<div class="report"><div class="schoolhead"><h1>${esc(db.settings.school)}</h1><p>TEACHER TIMETABLE</p><p>${esc(n)}</p></div><table><tr><th>Day</th><th>Schedule</th></tr>${rows}</table></div>`}
function Settings(){document.getElementById("content").innerHTML=`<div class="card"><h2>School Settings</h2><div class="formgrid">${field("School name","school",db.settings.school)}${field("Motto","motto",db.settings.motto)}${field("Current term","term",db.settings.term,"select",["Term 1","Term 2","Term 3"])}${field("Academic year","year",db.settings.year,"number")}${field("Phone","phone",db.settings.phone)}${field("Email","email",db.settings.email)}${field("School Logo URL","logoUrl",db.settings.logoUrl||"")}${field("Authorised Kenya Coat of Arms Image URL","kenyaCrestUrl",db.settings.kenyaCrestUrl||"")}<label class="inline-check"><input id="useKenyaCoatOfArms" type="checkbox" ${db.settings.useKenyaCoatOfArms===true?"checked":""}> I confirm the school has written authority to use Kenya's national Coat of Arms on its documents</label>${field("Authorised Signatory Full Name","headteacherName",db.settings.headteacherName||"")}${field("Head of Institution Designation","signatoryDesignation",db.settings.signatoryDesignation||"Headteacher")}</div><label class="inline-check"><input id="autoFeePaymentAlerts" type="checkbox" ${db.settings.autoFeePaymentAlerts===true?"checked":""}> Automatically SMS a payment confirmation to opted-in parents/guardians after a fee payment is recorded</label><p class="small">Requires a deployed send-school-messages Edge Function, configured SMS provider secrets, a valid parent phone number, and recorded parent/guardian SMS consent.</p><button onclick="saveSchoolSettings()">Save School Settings</button></div><div class="card"><h2>Academic Periods</h2><p class="small">Each year/term has its own fee structure and subject combination.</p><div class="formgrid">${field("New year","py",db.settings.year,"number")}${field("New term","pt","Term 1","select",["Term 1","Term 2","Term 3"])}${field("Status","ps","Open","select",["Open","Closed"])}</div><button onclick="addAcademicPeriod()">Add / Open Period</button><div class="tablewrap" style="margin-top:15px"><table class="table"><tr><th>Year</th><th>Term</th><th>Status</th><th>Action</th></tr>${db.academicPeriods.map(p=>`<tr><td>${esc(p.year)}</td><td>${esc(p.term)}</td><td>${esc(p.status||"Open")}</td><td><button class="light" onclick="usePeriod('${esc(p.year)}','${esc(p.term)}')">Use</button></td></tr>`).join("")}</table></div></div><div class="card"><h2>☁️ Supabase Cloud Database</h2><p>Connection status: <b>${cloudConfigured()?"Configured":"Not configured"}</b></p><p class="small">Cloud mode synchronizes the school's working data to a protected Supabase record. Supabase Auth controls access. The public browser key is safe to expose only when RLS is correctly configured.</p><div class="toolbar"><button onclick="cloudSetup()">Configure / Change Connection</button>${cloudReady?'<button class="light" onclick="cloudSave(true);toast("Cloud sync requested")">Sync Now</button>':''}</div></div><div class="card"><h2>Security</h2><p>Supabase Auth account: <b>${esc(cloudUser?.email||"Not signed in")}</b></p><p>Recovery phone: <b>${esc(db.settings.phone)}</b></p><div class="toolbar"><button onclick="securitySetup(false)">Change Password / Security</button><button class="light" onclick="forgot()">Test Password Recovery</button></div></div><div class="card"><h2>Grading Scale</h2><table class="table"><tr><th>Average</th><th>Grade</th></tr>${[["41–50","EE1 — Exceeding Expectations 1"],["36–40","EE2 — Exceeding Expectations 2"],["31–35","ME1 — Meeting Expectations 1"],["25–30","ME2 — Meeting Expectations 2"],["21–24.9","AE1 — Approaching Expectations 1"],["15–20","AE2 — Approaching Expectations 2"],["6–14","BE1 — Below Expectations 1"],["0–5","BE2 — Below Expectations 2"]].map(x=>`<tr><td>${x[0]}</td><td>${x[1]}</td></tr>`).join("")}</table><p class="small">Overall reports and rankings use the active subjects configured for the selected assessment period.</p></div><div class="card"><h2>Backup & Audit</h2><div class="toolbar"><button onclick="backup()">Download Backup</button><button class="light" onclick="showAudit()">View Audit Log</button></div></div>`}
function addAcademicPeriod(){let y=String(v("py")||db.settings.year),t=v("pt"),status=v("ps")||"Open";ensurePeriodConfig(y,t);let p=db.academicPeriods.find(x=>String(x.year)===y&&x.term===t);if(p)p.status=status;else db.academicPeriods.push({year:y,term:t,status});save();audit(`Academic period ${t}, ${y} created/updated`);Settings();toast(`Period ${t}, ${y} is ready`)}
function usePeriod(y,t){db.settings.year=String(y);db.settings.term=t;ensurePeriodConfig();save();audit(`Current period changed to ${t}, ${y}`);Settings();toast(`Current period: ${t}, ${y}`)}
function saveSchoolSettings(){db.settings.school=v("school");db.settings.motto=v("motto");db.settings.term=v("term");db.settings.year=v("year");db.settings.phone=v("phone");db.settings.email=v("email");db.settings.logoUrl=v("logoUrl").trim();db.settings.kenyaCrestUrl=v("kenyaCrestUrl").trim();db.settings.useKenyaCoatOfArms=document.getElementById("useKenyaCoatOfArms")?.checked===true;db.settings.headteacherName=v("headteacherName").trim();db.settings.signatoryDesignation=v("signatoryDesignation").trim();db.settings.autoFeePaymentAlerts=document.getElementById("autoFeePaymentAlerts")?.checked===true;ensurePeriodConfig();save();audit("School settings changed");show("Settings");toast("Settings saved")}
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
function subjectsForPeriod(c,year=db.settings.year,term=db.settings.term){const k=ensurePeriodConfigV3(year,term),configured=(db.subjectConfigs[k]?.[c]||[]).filter(x=>x.active!==false).map(x=>String(x.name||"").trim()).filter(Boolean),catalog=(defaultSubjects[c]||[]);return [...new Set([...catalog,...configured])].filter(name=>{const rec=(db.subjectConfigs[k]?.[c]||[]).find(x=>String(x.name).toLowerCase()===name.toLowerCase());return !rec||rec.active!==false})}
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
  const section=ecde.includes(c)?"ECDE":(junior.includes(c)?"Junior":"Primary");
  const saved=db.schoolControls?.timetable?.[section];
  if(ecde.includes(c)){
    const base={slots:["08:30–09:00","09:00–09:30","09:30–10:00","10:20–10:50","10:50–11:20","11:20–11:50","12:00–12:30"],lessonDuration:30,startTime:"08:30",label:"30-MINUTE LESSONS • START 8:30 AM",breaks:[],lunch:null,prep:null,activity:null};
    const cfg=saved?{...base,...saved}:base;
    cfg.label=`${Number(cfg.lessonDuration)||30}-MINUTE LESSONS • START ${cfg.startTime||"08:30"}`;
    return cfg;
  }
  const base={slots:["08:00–08:40","08:40–09:20","09:20–10:00","10:30–11:10","11:10–11:50","12:00–12:40","14:00–14:40","14:40–15:20"],lessonDuration:40,startTime:"08:00",label:"40-MINUTE LESSONS • START 8:00 AM",breaks:[["10:00","10:30"],["11:50","12:00"]],lunch:["12:40","13:40"],prep:["13:40","14:00"],activity:"15:30+"};
  const cfg=saved?{...base,...saved}:base;
  cfg.label=`${Number(cfg.lessonDuration)||40}-MINUTE LESSONS • START ${cfg.startTime||"08:00"}`;
  return cfg;
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
    const code=subjectCode(x.subject),emoji=({English:"📘",Kiswahili:"📖",Mathematics:"🔢","Science & Technology":"🔬","Integrated Science":"🧪",Agriculture:"🌱","Social Studies":"🌍","Creative Arts & Sports":"🎨","Pre-Technical Studies":"🛠️","Religious Education":"✨","Environmental Activities":"🌿","Creative Arts":"🎨","Language Activities":"🗣️","Mathematical Activities":"🔢"})[x.subject]||"⭐";
    return`<div class="ttcell subject-${esc(code.toLowerCase())}">
      <b>${emoji} ${esc(timetableSubjectLabel(x))}</b><span>${esc(x.subject)}</span>
    </div>`;
  };
  const rows=[`<tr><th class="timecol">TIME</th>${days.map(d=>`<th>${d.toUpperCase()}</th>`).join("")}</tr>`];
  const special=(label,cls)=>`<tr class="ttspecial ${cls||""}"><td colspan="6">${label}</td></tr>`;

  const mins=t=>{const m=String(t||"").match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):NaN};
  const fmt=n=>`${String(Math.floor(n/60)%24).padStart(2,"0")}:${String(n%60).padStart(2,"0")}`;
  const ranges=(cfg.breaks||[]).filter(r=>r&&r.length===2).map((r,i)=>({range:r,cls:"break",label:`${i===0?"FIRST BREAK":"BREAK"} • ${r[0]}–${r[1]}`}));
  if(cfg.lunch&&cfg.lunch.length===2)ranges.push({range:cfg.lunch,cls:"lunch",label:`LUNCH • ${cfg.lunch[0]}–${cfg.lunch[1]}`});
  if(cfg.prep&&cfg.prep.length===2)ranges.push({range:cfg.prep,cls:"prep",label:`PERSONAL STUDIES / PREP • ${cfg.prep[0]}–${cfg.prep[1]}`});
  cfg.slots.forEach((time,index)=>{
    rows.push(`<tr><th class="timecol">${time}</th>${days.map(d=>`<td>${cell(d,time)}</td>`).join("")}</tr>`);
    const parts=String(time).split(/[–-]/).map(x=>x.trim()),slotEnd=mins(parts[1]),next=String(cfg.slots[index+1]||"").split(/[–-]/).map(x=>x.trim()),nextStart=mins(next[0]);
    ranges.filter(r=>{const a=mins(r.range[0]),b=mins(r.range[1]);return Number.isFinite(slotEnd)&&Number.isFinite(a)&&Number.isFinite(b)&&slotEnd<=a&&(!Number.isFinite(nextStart)||nextStart>=b)}).forEach(r=>rows.push(special(r.label,r.cls)));
  });
  if(cfg.activity)rows.push(special(`🌈 GAMES / AFTERNOON ACTIVITIES • ${cfg.activity}`,"activity"));

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

/* ---------- School controls: alumni, promotion, timetable and grading ---------- */
function deleteLearnerRecord(id){
 const l=db.learners.find(x=>String(x.id)===String(id));if(!l)return;
 if(!confirm(`Remove ${l.name} (${l.adm}) from active school records? To protect reports, marks and attendance, this uses a reversible soft-delete rather than erasing history.`))return;
 l.status="Deleted";l.deletedAt=new Date().toISOString();l.deletedBy=cloudUser?.email||"authenticated staff";save();audit("Learner marked deleted: "+l.name+" ("+l.adm+")");Learners();toast("Learner removed from active records; history retained");
}
function alumniEligible(){
 const year=Number(db.settings.year)||new Date().getFullYear();if(!String(db.settings.term||"").toLowerCase().includes("term 1"))return 0;let moved=0;
 db.learners.forEach(l=>{if(!["Grade 6","Grade 9"].includes(l.lastCompletedClass||l.class)||l.status==="Deleted"||l.status==="Archived"||l.status==="Alumni")return;const completed=Number(l.completedYear||0);if(completed>0&&year>=completed+1){db.alumni.push({id:uid("AL"),learnerId:l.id,adm:l.adm,name:l.name,assessmentNo:l.assessmentNo||"",gender:l.gender||"",lastClass:l.lastCompletedClass||l.class,completionYear:completed,transferredAt:new Date().toISOString(),status:"Alumni"});l.status="Alumni";l.alumniYear=year;moved++;}});
 if(moved){save();audit(`Automatic alumni transfer: ${moved} Grade 6/Grade 9 learner(s)`);}return moved;
}
function Alumni(){const moved=alumniEligible();const rows=(db.alumni||[]).map((a,i)=>`<tr><td>${i+1}</td><td>${esc(a.adm||"")}</td><td>${esc(a.name||"")}</td><td>${esc(a.lastClass||"")}</td><td>${esc(a.completionYear||"")}</td><td>${esc(a.transferredAt?new Date(a.transferredAt).toLocaleDateString():"")}</td></tr>`).join("");document.getElementById("content").innerHTML=`<div class="card"><div class="pagehero"><div><h2>Alumni Register</h2><p>Former Grade 6 and Grade 9 learners with school history retained.</p></div><button onclick="runAlumniTransfer()">Check eligibility</button></div><p class="small">Automatic transfer is checked in Term 1. A completion year must be recorded during promotion, and the current academic year must be at least one year later.</p><div class="tablewrap"><table class="table"><thead><tr><th>#</th><th>Admission No.</th><th>Name</th><th>Last class</th><th>Completion year</th><th>Transferred</th></tr></thead><tbody>${rows||'<tr><td colspan="6">No alumni records yet.</td></tr>'}</tbody></table></div></div>`;if(moved)toast(`${moved} learner(s) moved to alumni`);}
function runAlumniTransfer(){const n=alumniEligible();Alumni();toast(n?`${n} learner(s) moved to alumni`:"No learners currently eligible for alumni transfer");}
function SchoolControls(){const t=db.schoolControls.timetable||{},g=db.schoolControls.grading||{},secs=["ECDE","Primary","Junior"];const defaults=[{label:"EE1",min:90,max:100},{label:"EE2",min:75,max:89},{label:"ME",min:50,max:74},{label:"AE",min:25,max:49},{label:"BE",min:0,max:24}];const gradeHtml=secs.map(sec=>`<div class="card"><h3>${sec} grading</h3><p class="small">Edit grade bands as JSON. Each band needs label, min and max.</p><textarea id="grade_${sec}" rows="6" style="width:100%;font-family:monospace">${esc(JSON.stringify(g[sec]||defaults,null,2))}</textarea><button onclick="saveGradeConfig('${sec}')">Save ${sec} grading</button></div>`).join("");const timeHtml=secs.map(sec=>{const d=t[sec]||{},dur=d.lessonDuration||(sec==="ECDE"?30:40),start=d.startTime||(sec==="ECDE"?"08:30":"08:00"),br=d.breaks|| (sec==="ECDE"?[]:[["10:00","10:30"],["11:50","12:00"]]);return `<div class="card timetable-settings-card"><h3>🕒 ${sec} timetable settings</h3><p class="small">Set a different lesson length for this section. You can also edit every generated time slot manually.</p><div class="formgrid"><div><label>Lesson duration (minutes)</label><input id="duration_${sec}" type="number" min="5" max="180" step="5" value="${esc(String(dur))}"></div><div><label>School start time (24-hour)</label><input id="start_${sec}" type="time" value="${esc(start)}"></div><div><label>Number of lessons per day</label><input id="count_${sec}" type="number" min="1" max="12" value="${esc(String((d.slots||[]).length||(sec==="ECDE"?7:8)))}"></div></div><div class="formgrid"><div><label>First break start–end</label><input id="break1_${sec}" value="${esc((br[0]||[]).join("–"))}" placeholder="10:00–10:30"></div><div><label>Second break start–end</label><input id="break2_${sec}" value="${esc((br[1]||[]).join("–"))}" placeholder="11:50–12:00"></div><div><label>Lunch start–end</label><input id="lunch_${sec}" value="${esc((d.lunch||(sec==="ECDE"?[]:["12:40","13:40"])).join("–"))}" placeholder="12:40–13:40"></div><div><label>Games / activity time</label><input id="games_${sec}" value="${esc(d.activity||(sec==="ECDE"?"":"15:30+"))}" placeholder="15:30+"></div></div><div class="toolbar"><button class="success" onclick="buildTimetableSlots('${sec}')">✨ Build slots from duration</button><button onclick="saveTimetableConfig('${sec}')">Save ${sec} times</button></div><label style="display:block;margin-top:12px">Lesson slots (editable; one per line, 24-hour time)</label><textarea id="slots_${sec}" rows="6" style="width:100%">${esc((d.slots||(sec==="ECDE"?["08:30–09:00","09:00–09:30","09:30–10:00","10:20–10:50","10:50–11:20","11:20–11:50","12:00–12:30"]:["08:00–08:40","08:40–09:20","09:20–10:00","10:30–11:10","11:10–11:50","12:00–12:40","14:00–14:40","14:40–15:20"])).join("\n"))}</textarea></div>`}).join("");document.getElementById("content").innerHTML=`<div class="card"><h2>School Controls</h2><p>Configure progression, lesson times and grading independently for ECDE, Primary and Junior.</p><div class="grid"><div class="card"><h3>Academic year promotion</h3><div class="formgrid"><div><label>From year</label><input id="promFrom" value="${esc(db.settings.year||new Date().getFullYear())}"></div><div><label>To year</label><input id="promTo" value="${Number(db.settings.year||new Date().getFullYear())+1}"></div></div><button onclick="previewPromotion()">Preview promotions</button><div id="promotionPreview"></div></div><div class="card"><h3>Safety</h3><p>Back up before bulk changes. Promotion is previewed before confirmation.</p><button class="light" onclick="backup()">Create backup</button></div></div></div><h2>Timetable settings</h2>${timeHtml}<h2>Grading settings</h2>${gradeHtml}`;}
function splitTimeRange(value){const p=String(value||"").split(/[–-]/).map(x=>x.trim());return p.length===2&&p[0]&&p[1]?p:null;}
function timeToMinutes(value){const m=String(value||"").match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):NaN;}
function minutesToTime(value){return `${String(Math.floor(value/60)%24).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;}
function buildTimetableSlots(sec){const duration=Number(document.getElementById("duration_"+sec)?.value),start=timeToMinutes(document.getElementById("start_"+sec)?.value),count=Number(document.getElementById("count_"+sec)?.value);if(!Number.isFinite(duration)||duration<5||duration>180||!Number.isFinite(start)||!Number.isInteger(count)||count<1||count>12){toast("Enter a valid lesson duration, start time and lesson count");return}const ranges=[splitTimeRange(document.getElementById("break1_"+sec)?.value),splitTimeRange(document.getElementById("break2_"+sec)?.value),splitTimeRange(document.getElementById("lunch_"+sec)?.value)].filter(Boolean).map(r=>({start:timeToMinutes(r[0]),end:timeToMinutes(r[1])})).filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.end>r.start).sort((a,b)=>a.start-b.start);let cursor=start,slots=[],guard=0;while(slots.length<count&&guard++<100){let moved=false;for(const r of ranges){if(cursor>=r.start&&cursor<r.end){cursor=r.end;moved=true;break}if(cursor<r.start&&cursor+duration>r.start){cursor=r.end;moved=true;break}}if(moved)continue;const end=cursor+duration;if(end>24*60){toast("The chosen duration and lesson count run past midnight. Reduce the count or duration.");return}slots.push(`${minutesToTime(cursor)}–${minutesToTime(end)}`);cursor=end}if(slots.length!==count){toast("Could not build all lesson slots. Check your breaks and lunch times.");return}document.getElementById("slots_"+sec).value=slots.join("\n");toast(`${sec}: built ${slots.length} lessons of ${duration} minutes each. Save settings to keep them.`);}
function saveTimetableConfig(sec){const slots=String(document.getElementById("slots_"+sec)?.value||"").split(/\n/).map(x=>x.trim()).filter(Boolean);if(!slots.length){toast("Enter at least one lesson slot");return}const lessonDuration=Number(document.getElementById("duration_"+sec)?.value),startTime=document.getElementById("start_"+sec)?.value;if(!Number.isFinite(lessonDuration)||lessonDuration<5||lessonDuration>180||!startTime||!Number.isFinite(timeToMinutes(startTime))){toast("Enter a valid lesson duration and start time");return}const breaks=[splitTimeRange(document.getElementById("break1_"+sec)?.value),splitTimeRange(document.getElementById("break2_"+sec)?.value)].filter(Boolean);const lunch=splitTimeRange(document.getElementById("lunch_"+sec)?.value);db.schoolControls.timetable[sec]={slots,lessonDuration,startTime,label:`${lessonDuration}-MINUTE LESSONS • START ${startTime}`,breaks,lunch,prep:null,activity:document.getElementById("games_"+sec)?.value.trim()||null};save();audit(`${sec} timetable times updated (${lessonDuration}-minute lessons)`);SchoolControls();toast(`${sec} settings saved. Regenerate timetables to apply new slots.`);}
function saveGradeConfig(sec){try{const bands=JSON.parse(document.getElementById("grade_"+sec).value);if(!Array.isArray(bands)||!bands.length||bands.some(x=>!x.label||!Number.isFinite(Number(x.min))||!Number.isFinite(Number(x.max))||Number(x.min)<0||Number(x.max)>100||Number(x.min)>Number(x.max)))throw Error("Each band needs label and min/max between 0 and 100.");const sorted=[...bands].sort((a,b)=>Number(a.min)-Number(b.min));for(let i=1;i<sorted.length;i++)if(Number(sorted[i].min)<=Number(sorted[i-1].max))throw Error("Grade ranges overlap.");db.schoolControls.grading[sec]=bands.map(x=>({label:String(x.label),min:Number(x.min),max:Number(x.max)}));save();audit(`${sec} grading configuration updated`);SchoolControls();toast(`${sec} grading saved. Existing marks were not rewritten.`);}catch(e){toast("Invalid grading configuration: "+e.message)}}
function previewPromotion(){const from=String(document.getElementById("promFrom").value||"").trim(),to=String(document.getElementById("promTo").value||"").trim();if(!from||!to||Number(to)<=Number(from)){toast("Enter a valid later academic year");return}const next={"PP1":"PP2","PP2":"Grade 1","Grade 1":"Grade 2","Grade 2":"Grade 3","Grade 3":"Grade 4","Grade 4":"Grade 5","Grade 5":"Grade 6","Grade 6":"Grade 7","Grade 7":"Grade 8","Grade 8":"Grade 9"};const summary=Object.entries(next).map(([c,n])=>`${c}: ${db.learners.filter(l=>l.class===c&&!['Archived','Deleted','Alumni'].includes(l.status)).length} learner(s) → ${n}`).join("\n");document.getElementById("promotionPreview").innerHTML=`<pre style="white-space:pre-wrap">${esc(summary)}</pre><button onclick="applyPromotion('${esc(from)}','${esc(to)}')">Confirm and promote learners</button>`;}
function applyPromotion(from,to){if(!confirm(`Promote learners from ${from} to ${to}? This updates their current classes and records their previous class.`))return;const next={"PP1":"PP2","PP2":"Grade 1","Grade 1":"Grade 2","Grade 2":"Grade 3","Grade 3":"Grade 4","Grade 4":"Grade 5","Grade 5":"Grade 6","Grade 6":"Grade 7","Grade 7":"Grade 8","Grade 8":"Grade 9"};let count=0;db.learners.forEach(l=>{if(!next[l.class]||['Archived','Deleted','Alumni'].includes(l.status)||String(l.lastPromotedToYear||"")===String(to))return;const old=l.class;if(old==="Grade 6"){l.completedYear=Number(from);l.lastCompletedClass="Grade 6";}l.class=next[old];l.previousClass=old;l.lastPromotedFromYear=String(from);l.lastPromotedToYear=String(to);l.status="Active";count++;});db.learners.forEach(l=>{if(l.class==="Grade 9"&&!['Archived','Deleted','Alumni'].includes(l.status)){l.completedYear=Number(from);l.lastCompletedClass="Grade 9";l.status="Completed";}});save();audit(`Academic year promotion ${from} to ${to}: ${count} learner(s)`);show("SchoolControls");toast(`${count} learner(s) promoted. Grade 6/9 completion years recorded where applicable.`);}

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
    const roleResult=await cloud.from("school_staff_roles").select("role,active").eq("user_id",cloudUser.id).maybeSingle();
    if(!roleResult.error&&(!roleResult.data?.active||!roleResult.data?.role)){await cloud.auth.signOut();cloudReady=false;cloudUser=null;return;}
    cloudStaffRole=roleResult.data?.role||"migration_pending";
    currentUser={username:cloudUser.email||"Authenticated User",role:cloudStaffRole,id:cloudUser.id};
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
async function saveMarks(){
  const e=v("mex"),c=v("mclass"),subject=v("msub"),ex=db.exams.find(x=>x.id===e);
  if(!e||!c||!subject||!ex||!subjectsForPeriod(c,ex.year,ex.term).includes(subject)){toast("Select a valid exam, class and subject");return}
  const inputs=[...document.querySelectorAll(".markinput")];
  const bad=inputs.find(inp=>inp.value!==""&&(!Number.isFinite(Number(inp.value))||Number(inp.value)<0||Number(inp.value)>50));
  if(bad){toast("Marks must be between 0 and 50");bad.focus();return}
  const before=cloneDb(db.marks);
  for(const inp of inputs){
    const learnerId=inp.dataset.id,val=inp.value;
    const i=db.marks.findIndex(m=>m.learner===learnerId&&m.exam===e&&m.subject===subject);
    if(val===""){if(i>=0)db.marks.splice(i,1);continue}
    const old=i>=0?db.marks[i]:null;
    const row={id:old?.id||uid("M"),learner:learnerId,class:c,subject,exam:e,mark:Number(val),year:ex.year,term:ex.term,updatedAt:new Date().toISOString(),updatedBy:cloudUser?.id||currentUser?.username||"staff"};
    if(i>=0)db.marks[i]={...old,...row};else db.marks.push(row);
  }
  localStorage.setItem(KEY,JSON.stringify(db));
  const synced=await save();
  if(synced!==true){db.marks=before;localStorage.setItem(KEY,JSON.stringify(db));toast("Marks were not confirmed in the shared database. Please retry; your previously saved marks were restored.");return}
  selectedExamForMarks=e;audit(`Marks saved: ${c} — ${subject} — ${ex.name}`);toast(`${subject} marks saved for ${c} (${ex.name})`);
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


/* ---------- Parent/guardian contact register ---------- */
function toggleParentSmsConsent(id){const l=db.learners.find(x=>String(x.id)===String(id));if(!l)return;const next=l.parentSmsConsent!==true;if(next&&!confirm("Confirm that this parent/guardian has agreed to receive school SMS notifications for this learner."))return;l.parentSmsConsent=next;save();audit(`Parent SMS consent ${next?"recorded":"withdrawn"} for ${l.adm||l.name}`);ParentContacts();}
function toggleParentEmailConsent(id){const l=db.learners.find(x=>String(x.id)===String(id));if(!l)return;const next=l.parentEmailConsent!==true;if(next&&!confirm("Confirm that this parent/guardian has agreed to receive school emails and learner documents."))return;l.parentEmailConsent=next;save();audit(`Parent email consent ${next?"recorded":"withdrawn"} for ${l.adm||l.name}`);ParentContacts();}
function toggleParentWhatsappConsent(id){const l=db.learners.find(x=>String(x.id)===String(id));if(!l)return;const next=l.parentWhatsappConsent!==true;if(next&&!confirm("Confirm that this parent/guardian has opted in to receive school WhatsApp messages for this learner."))return;l.parentWhatsappConsent=next;save();audit(`Parent WhatsApp consent ${next?"recorded":"withdrawn"} for ${l.adm||l.name}`);ParentContacts();}
function ParentContacts(){
 const active=db.learners.filter(l=>l.status!=="Archived");
 const q=(document.getElementById("parentContactSearch")?.value||"").toLowerCase();
 const rows=active.filter(l=>(String(l.name||"")+" "+String(l.adm||"")+" "+String(l.parent||"")+" "+String(l.phone||"")+" "+String(l.parentEmail||"")+" "+String(l.class||"")).toLowerCase().includes(q)).map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.adm||"")}</td><td>${esc(l.name||"")}</td><td>${esc(l.class||"")}</td><td>${esc(l.parent||"Not entered")}</td><td>${esc(l.phone||"Not entered")}</td><td>${esc(l.parentEmail||"Not entered")}</td><td>${normalizeKenyanPhone(l.phone)?'<span class="badge">Valid format</span>':'<span class="badge">Check number</span>'}</td><td>${l.parentSmsConsent===true?'<span class="badge">Opted in</span>':'<span class="badge">Not opted in</span>'}<button class="light" onclick="toggleParentSmsConsent('${l.id}')">${l.parentSmsConsent===true?'Withdraw':'Record'} SMS consent</button><br>${l.parentWhatsappConsent===true?'<span class="badge">WhatsApp opted in</span>':'<span class="badge">WhatsApp not opted in</span>'}<button class="light" onclick="toggleParentWhatsappConsent('${l.id}')">${l.parentWhatsappConsent===true?'Withdraw':'Record'} WhatsApp consent</button><br>${l.parentEmailConsent===true?'<span class="badge">Email opted in</span>':'<span class="badge">Email not opted in</span>'}<button class="light" onclick="toggleParentEmailConsent('${l.id}')">${l.parentEmailConsent===true?'Withdraw':'Record'} Email consent</button></td><td><button onclick="learnerForm('${l.id}')">Edit contact</button></td></tr>`).join("");
 document.getElementById("content").innerHTML=`<div class="card"><div class="pagehero"><div><h2>Parent / Guardian Contacts</h2><p>Maintain the parent or guardian name and phone number used for school announcements, fee reminders and individual learner results.</p></div></div><div class="grid"><div class="card stat"><h3>Active learners</h3><div class="num">${active.length}</div></div><div class="card stat"><h3>Phone entered</h3><div class="num">${active.filter(l=>String(l.phone||"").trim()).length}</div></div><div class="card stat"><h3>Missing phone</h3><div class="num">${active.filter(l=>!String(l.phone||"").trim()).length}</div></div></div><div class="toolbar"><input id="parentContactSearch" placeholder="Search learner, parent, admission or phone" value="${esc(q)}" oninput="ParentContacts()"><button class="success" onclick="show('BulkMessaging')">Send SMS / WhatsApp</button><button onclick="downloadParentContactsCSV()">⬇ Download Contacts (CSV)</button><button class="success" onclick="importParentContactsCsv()">⬆ Upload Contacts CSV</button><button class="light" onclick="previewParentContactsPDF()">👁 View PDF / Print</button></div><p class="small">Use Edit contact to enter the parent/guardian name and phone. Kenyan numbers such as 0712345678 are accepted and normalized for messaging. Confirm the number and consent before sharing results.</p><div class="tablewrap"><table class="table"><thead><tr><th>#</th><th>Admission</th><th>Learner</th><th>Class</th><th>Parent/Guardian</th><th>Phone</th><th>Email</th><th>Number status</th><th>Messaging consent</th><th>Action</th></tr></thead><tbody>${rows||'<tr><td colspan="10">No matching learners.</td></tr>'}</tbody></table></div></div>`;
}


/* ---------- Parent contacts export and print/PDF preview ---------- */
function parentContactRows(){
  const active=db.learners.filter(l=>l.status!=="Archived"&&l.status!=="Deleted");
  const q=(document.getElementById("parentContactSearch")?.value||"").toLowerCase();
  return active.filter(l=>(String(l.name||"")+" "+String(l.adm||"")+" "+String(l.parent||"")+" "+String(l.phone||"")+" "+String(l.parentEmail||"")+" "+String(l.class||"")).toLowerCase().includes(q));
}
function downloadParentContactsCSV(){
  const rows=parentContactRows();
  const data=[["No.","Admission No.","Learner Name","Class","Parent/Guardian","Phone"]];
  rows.forEach((l,i)=>data.push([i+1,l.adm||"",l.name||"",l.class||"",l.parent||"",l.phone||""]));
  const csv=data.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="Kapnanda-Parent-Guardian-Contacts.csv";
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  audit(`Parent contacts exported to CSV: ${rows.length} record(s)`);
  toast(`Downloaded ${rows.length} parent contact record(s). Keep this file secure.`);
}
let pendingParentContactImport=null;
function importParentContactsCsv(){
  if(!cloudReady||!cloudUser){toast("Sign in to the shared Supabase school database before uploading contacts");return}
  const picker=document.createElement("input");picker.type="file";picker.accept=".csv,text/csv";
  picker.onchange=async()=>{
    const file=picker.files&&picker.files[0];if(!file)return;
    try{
      const rows=parseDedicatedCsv(await file.text());
      const errors=[],seen=new Set(),updates=[];
      rows.forEach((r,i)=>{
        const adm=csvGet(r,["admission_no","admission_number","admission","adm","student_admission_number"]);
        const parent=csvGet(r,["parent_guardian","parent_guardian_name","parent","guardian","guardian_name"]);
        const phone=csvGet(r,["phone","parent_phone","guardian_phone","phone_number","contact_number","mobile"]);
        if(!adm){errors.push(`Row ${i+2}: admission number is required to match a learner safely.`);return}
        const key=adm.trim().toUpperCase();
        if(seen.has(key)){errors.push(`Row ${i+2}: duplicate admission number ${adm} in this file.`);return}
        seen.add(key);
        const learner=db.learners.find(l=>String(l.adm||"").trim().toUpperCase()===key);
        if(!learner){errors.push(`Row ${i+2}: admission number ${adm} was not found. No new learner records will be created.`);return}
        if(!parent&&!phone){errors.push(`Row ${i+2}: enter a Parent/Guardian or Phone value.`);return}
        updates.push({learnerId:learner.id,adm:learner.adm,name:learner.name,parent,phone});
      });
      if(errors.length){pendingParentContactImport=null;openModal(`<h2>Contacts CSV validation failed</h2><p>No contacts have been changed. Correct the CSV and upload it again.</p><div class="tablewrap" style="max-height:50vh;overflow:auto"><ul>${errors.map(e=>`<li>${esc(e)}</li>`).join("")}</ul></div><div class="toolbar"><button class="secondary" onclick="closeModal()">Close</button></div>`);return}
      pendingParentContactImport={updates,fileName:file.name};
      const preview=updates.slice(0,12).map(u=>`<tr><td>${esc(u.adm)}</td><td>${esc(u.name)}</td><td>${esc(u.parent||"(leave unchanged)")}</td><td>${esc(u.phone||"(leave unchanged)")}</td></tr>`).join("");
      openModal(`<h2>Review Parent Contacts Upload</h2><p>File: <b>${esc(file.name)}</b></p><p><b>${updates.length}</b> existing learner record(s) will be updated. This upload will not create, delete, archive, or promote learners.</p><p class="small">Matching is by admission number only. Blank Parent/Guardian or Phone cells leave the existing value unchanged.</p><div class="tablewrap" style="max-height:45vh;overflow:auto"><table class="table"><thead><tr><th>Admission</th><th>Learner</th><th>Parent/Guardian</th><th>Phone</th></tr></thead><tbody>${preview}</tbody></table></div>${updates.length>12?`<p class="small">Showing first 12 of ${updates.length} records.</p>`:""}<div class="toolbar"><button class="success" onclick="commitParentContactImport()">Confirm Upload</button><button class="secondary" onclick="pendingParentContactImport=null;closeModal()">Cancel</button></div>`);
    }catch(e){openModal(`<h2>Cannot read contacts CSV</h2><p>${esc(e.message||String(e))}</p><p class="small">Use the downloaded contacts CSV as a template. Required matching column: Admission No. Contact columns: Parent/Guardian and Phone.</p><div class="toolbar"><button class="secondary" onclick="closeModal()">Close</button></div>`)}
  };
  picker.click();
}
async function commitParentContactImport(){
  if(!pendingParentContactImport)return;
  if(!cloudReady||!cloudUser){toast("Your Supabase session has expired. Sign in again before uploading contacts.");return}
  if(cloudSyncBusy){toast("A cloud sync is already running. Wait a moment and try again.");return}
  const backup=cloneDb(db),batch=pendingParentContactImport;let changed=0;
  try{
    for(const u of batch.updates){
      const l=db.learners.find(x=>x.id===u.learnerId);if(!l)continue;
      if(u.parent&&String(l.parent||"")!==u.parent){l.parent=u.parent;changed++}
      if(u.phone&&String(l.phone||"")!==u.phone){l.phone=u.phone;changed++}
    }
    db.audit.unshift({id:uid("AU"),user:cloudUser.email||"authenticated staff",action:`Parent contacts CSV upload: ${batch.updates.length} learner record(s) checked`,date:new Date().toISOString()});
    db.audit=db.audit.slice(0,500);localStorage.setItem(KEY,JSON.stringify(db));
    const saved=await cloudSave(true);
    if(!saved){db=backup;localStorage.setItem(KEY,JSON.stringify(db));toast("Cloud save failed. Contact changes were rolled back; check connection and try again.");return}
    pendingParentContactImport=null;closeModal();show("ParentContacts");toast(`Contacts upload complete: ${batch.updates.length} learner record(s) checked.`);
  }catch(e){db=backup;localStorage.setItem(KEY,JSON.stringify(db));toast("Contacts upload failed; changes were rolled back. "+(e.message||e))}
}

function previewParentContactsPDF(){
  const rows=parentContactRows();
  const escHtml=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const body=rows.map((l,i)=>`<tr><td>${i+1}</td><td>${escHtml(l.adm||"")}</td><td>${escHtml(l.name||"")}</td><td>${escHtml(l.class||"")}</td><td>${escHtml(l.parent||"Not entered")}</td><td>${escHtml(l.phone||"Not entered")}</td></tr>`).join("");
  const w=window.open("","_blank");
  if(!w){toast("Allow pop-ups for this site to open the PDF/print preview.");return;}
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Kapnanda Parent / Guardian Contacts</title><style>
  body{font-family:Arial,sans-serif;color:#111;margin:24px}h1{font-size:20px;margin:0 0 6px}p{font-size:11px;color:#444;margin:0 0 16px}
  .actions{margin:12px 0 18px}button{padding:9px 14px;margin-right:8px;cursor:pointer}
  table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #888;padding:6px;text-align:left;overflow-wrap:anywhere}th{background:#e9eef5}
  @page{size:A4 landscape;margin:12mm}@media print{.actions{display:none}body{margin:0}thead{display:table-header-group}tr{break-inside:avoid}}
  </style></head><body><h1>Kapnanda Comprehensive School</h1><h2 style="font-size:15px">Parent / Guardian Contacts</h2><p>Records shown: ${rows.length} · Generated ${new Date().toLocaleString()}</p><div class="actions"><button onclick="window.print()">Print / Save as PDF</button><button onclick="window.close()">Close preview</button></div><table><thead><tr><th>No.</th><th>Admission</th><th>Learner</th><th>Class</th><th>Parent / Guardian</th><th>Phone</th></tr></thead><tbody>${body||'<tr><td colspan="6">No matching contacts.</td></tr>'}</tbody></table></body></html>`);
  w.document.close();
  audit(`Parent contacts opened in print/PDF preview: ${rows.length} record(s)`);
}

/* ---------- Secure bulk SMS + WhatsApp messaging ---------- */
function BulkMessaging(){
  const active=db.learners.filter(l=>l.status!=="Archived");
  const withPhone=active.filter(l=>String(l.phone||"").trim());
  const noPhone=active.length-withPhone.length;
  const classOpts=['<option value="__ALL__">All classes</option>',...classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`) ].join("");
  document.getElementById("content").innerHTML=`
  <div class="card"><div class="pagehero"><div><h2>💬 Bulk Messaging</h2><p>Send school announcements, fee reminders, attendance notices and other approved communications to parents/guardians.</p></div><span class="badge bright">SMS + WhatsApp</span></div>
  <div class="grid" style="margin-top:14px"><div class="card stat"><h3>Active learners</h3><div class="num">${active.length}</div></div><div class="card stat"><h3>Have a phone number</h3><div class="num">${withPhone.length}</div></div><div class="card stat"><h3>Missing phone number</h3><div class="num">${noPhone}</div></div></div>
  <div class="formgrid" style="margin-top:16px"><div class="field"><label for="msgChannel">Delivery channel</label><select id="msgChannel" onchange="updateMessagePreview()"><option value="sms">SMS only</option><option value="whatsapp">WhatsApp only (approved template)</option><option value="both">SMS + WhatsApp</option></select></div><div class="field"><label for="msgClass">Recipients</label><select id="msgClass" onchange="updateMessagePreview()">${classOpts}</select></div></div>
  <div class="formgrid" style="margin-top:12px"><div class="field"><label for="msgKind">Message type</label><select id="msgKind" onchange="updateMessagePreview()"><option value="announcement">Announcement / fee reminder</option><option value="results">Individual exam results</option></select></div><div class="field" id="msgExamWrap" style="display:none"><label for="msgExam">Assessment / exam</label><select id="msgExam" onchange="updateMessagePreview()">${db.exams.map(e=>`<option value="${esc(e.id)}">${esc(e.name||e.id)} — ${esc(e.term||"")} ${esc(String(e.year||""))}</option>`).join("")}</select></div></div>
  <div id="msgSmsBlock" class="field" style="margin-top:14px"><label for="msgText">SMS message</label><textarea id="msgText" rows="4" maxlength="1200" placeholder="Example: Dear parent, this is a reminder that school fees are due..." oninput="updateMessagePreview()" style="width:100%;box-sizing:border-box"></textarea><p class="small">SMS length affects cost. Longer messages may be billed as multiple SMS segments.</p></div>
  <div id="msgWhatsAppBlock" class="card" style="margin-top:14px;display:none"><h3>WhatsApp approved template</h3><p class="small">Enter a template already approved in Meta WhatsApp Manager. This setup expects one text variable named {{1}} in the template body.</p><div class="formgrid"><div class="field"><label for="msgTemplate">Approved template name</label><input id="msgTemplate" placeholder="e.g. school_notice" oninput="updateMessagePreview()"></div><div class="field"><label for="msgLanguage">Template language code</label><input id="msgLanguage" value="en" placeholder="e.g. en or en_US"></div></div><div class="field" style="margin-top:12px"><label for="msgVariable">Template variable {{1}}</label><textarea id="msgVariable" rows="3" maxlength="1000" placeholder="Text to insert into the approved WhatsApp template" oninput="updateMessagePreview()" style="width:100%;box-sizing:border-box"></textarea></div></div>
  <div class="card" style="margin-top:14px"><h3>Campaign preview</h3><p id="msgPreviewCount">Select a recipient group.</p><p class="small">Recipients use the Phone field in each learner record. Use international Kenyan format (+2547… or +2541…). Results mode sends each learner’s own total, average and class position to that learner’s linked parent/guardian number. Please verify numbers and consent before sending.</p><label style="display:flex;gap:9px;align-items:flex-start;margin:12px 0"><input id="msgConsent" type="checkbox" style="width:auto;margin-top:3px"><span>I confirm these contacts are appropriate for school communications, have the required consent/opt-in, and the message is relevant and lawful.</span></label><div class="toolbar"><button class="success" id="msgSendButton" onclick="sendBulkMessages()">Send Campaign</button><button class="light" onclick="show('ParentContacts')">Manage Parent Contacts</button></div><p class="small">Messages are sent through a secure Supabase Edge Function. Provider API keys must be configured in Supabase secrets; never add them to app.js or GitHub.</p><div id="msgResult" style="margin-top:12px"></div></div></div>`;
  updateMessagePreview();
}
function normalizeKenyanPhone(value){
  let n=String(value||"").trim().replace(/[\s().-]/g,"");
  if(n.startsWith("00"))n="+"+n.slice(2);
  if(/^0[17]\d{8}$/.test(n))n="+254"+n.slice(1);
  else if(/^254[17]\d{8}$/.test(n))n="+"+n;
  else if(/^[17]\d{8}$/.test(n))n="+254"+n;
  if(/^\+254[17]\d{8}$/.test(n))return n;
  return "";
}
function getMessagingRecipients(){
  const selected=document.getElementById("msgClass")?.value||"__ALL__";
  return db.learners.filter(l=>l.status!=="Archived"&&(selected==="__ALL__"||l.class===selected)).map(l=>({...l,learnerId:l.id,normalizedPhone:normalizeKenyanPhone(l.phone)}));
}
function updateMessagePreview(){
  const channel=document.getElementById("msgChannel")?.value||"sms";
  const kind=document.getElementById("msgKind")?.value||"announcement";
  const examWrap=document.getElementById("msgExamWrap");if(examWrap)examWrap.style.display=kind==="results"?"block":"none";
  const sms=document.getElementById("msgSmsBlock"),wa=document.getElementById("msgWhatsAppBlock");
  if(sms)sms.style.display=channel==="whatsapp"?"none":"block";
  if(wa)wa.style.display=(channel==="whatsapp"||channel==="both")?"block":"none";
  const recipients=getMessagingRecipients(),valid=recipients.filter(l=>l.normalizedPhone),invalid=recipients.length-valid.length;
  const out=document.getElementById("msgPreviewCount");
  if(out)out.textContent=`${valid.length} valid recipient(s) selected; ${invalid} learner(s) excluded because their phone number is missing or invalid.`;
  const btn=document.getElementById("msgSendButton");if(btn)btn.disabled=valid.length===0;
}
function makeParentResultMessage(l,examId){
 const ex=db.exams.find(e=>String(e.id)===String(examId))||{};
 const r=calcLearner(l.id,examId);const classmates=db.learners.filter(x=>x.class===l.class&&x.status!=="Archived");
 const ranked=classmates.map(x=>({id:x.id,...calcLearner(x.id,examId)})).filter(x=>x.n>0).sort((a,b)=>b.avg-a.avg||b.total-a.total);
 const pos=ranked.findIndex(x=>x.id===l.id);const position=pos>=0?`${pos+1} of ${ranked.length}`:"not available";
 return `${db.settings.school||"Kapnanda School"}: ${l.name} (${l.class}), ${ex.name||"Assessment"} ${ex.term||db.settings.term||""} ${ex.year||db.settings.year||""}. Total ${r.total.toFixed(1)}; average ${r.avg.toFixed(1)}%; class position ${position}. ${r.n?"Please contact the school for the full report.":"Marks are not yet available."}`.slice(0,1200);
}
async function sendBulkMessages(){
  if(!cloud||!cloudUser||!cloudReady){toast("Sign in to the shared Supabase database before sending messages");return}
  const channel=document.getElementById("msgChannel")?.value||"sms";
  const smsText=document.getElementById("msgText")?.value.trim()||"";
  const templateName=document.getElementById("msgTemplate")?.value.trim()||"";
  const templateLanguage=document.getElementById("msgLanguage")?.value.trim()||"en";
  const templateVariable=document.getElementById("msgVariable")?.value.trim()||"";
  if((channel==="sms"||channel==="both")&&!smsText&&document.getElementById("msgKind")?.value!=="results"){toast("Enter the SMS message");return}
  if((channel==="whatsapp"||channel==="both")&&(!/^[a-z0-9_]+$/.test(templateName)||(!templateVariable&&document.getElementById("msgKind")?.value!=="results"))){toast("Enter an approved WhatsApp template name and its {{1}} variable text");return}
  if(!document.getElementById("msgConsent")?.checked){toast("Confirm consent and appropriate use before sending");return}
  const kind=document.getElementById("msgKind")?.value||"announcement";
  const examId=document.getElementById("msgExam")?.value||"";
  const all=getMessagingRecipients(),recipients=all.filter(l=>l.normalizedPhone).map(l=>{const resultMessage=kind==="results"?makeParentResultMessage(l,examId):"";return {learnerId:String(l.id),name:String(l.parent||l.name||"Parent/Guardian").slice(0,100),phone:l.normalizedPhone,admission:String(l.adm||"").slice(0,40),class:String(l.class||"").slice(0,40),...(kind==="results"?{message:resultMessage,variable:resultMessage}:{})}});
  if(!recipients.length){toast("No valid phone numbers in this recipient group");return}
  if(recipients.length>200){toast("For safety, send to 200 recipients or fewer per campaign. Choose a class or send smaller batches.");return}
  const summary=`Send ${channel.toUpperCase()} campaign to ${recipients.length} parent/guardian phone number(s)? This action may incur provider charges.`;
  if(!confirm(summary))return;
  const btn=document.getElementById("msgSendButton"),result=document.getElementById("msgResult");
  if(btn){btn.disabled=true;btn.textContent="Sending…"}if(result)result.textContent="Sending campaign. Please keep this page open.";
  try{
    const {data:{session},error:sessionError}=await cloud.auth.getSession();
    if(sessionError||!session?.access_token)throw new Error("Your login session has expired. Sign in again.");
    const {data,error}=await cloud.functions.invoke("send-school-messages",{body:{channel,recipients,smsText,templateName,templateLanguage,templateVariable,personalized:kind==="results",messageType:kind,schoolName:String(db.settings.school||"Kapnanda School"),term:String(db.settings.term||""),year:String(db.settings.year||"")}});
    if(error)throw new Error(error.message||"Messaging service returned an error");
    if(!data||data.error)throw new Error(data?.error||"Messaging service returned no result");
    const lines=(data.results||[]).map(r=>`<tr><td>${esc(r.channel||"")}</td><td>${esc(r.provider||"")}</td><td>${esc(r.status||"")}</td><td>${esc(String(r.accepted??"—"))}</td><td>${esc(String(r.failed??"—"))}</td><td>${esc(r.detail||"")}</td></tr>`).join("");
    if(result)result.innerHTML=`<h3>Campaign submission result</h3><p>${esc(data.message||"The provider response was received.")}</p><div class="tablewrap"><table class="table"><thead><tr><th>Channel</th><th>Provider</th><th>Status</th><th>Accepted</th><th>Failed</th><th>Details</th></tr></thead><tbody>${lines||"<tr><td colspan=6>No provider result returned.</td></tr>"}</tbody></table></div><p class="small">“Accepted” means the provider accepted the request; it is not proof that every recipient received or read the message. Check delivery reports in the provider dashboard.</p>`;
    audit(`Bulk messaging campaign submitted: ${channel}, ${recipients.length} recipients`);
    toast("Messaging provider response received");
  }catch(e){console.error(e);if(result)result.innerHTML=`<p class="error-card">Campaign not confirmed: ${esc(e.message||String(e))}</p><p class="small">Check that the Supabase Edge Function is deployed and provider secrets are configured. Do not retry until you confirm whether the provider accepted the first request.</p>`;toast("Messaging failed or was not confirmed")}
  finally{if(btn){btn.disabled=false;btn.textContent="Send Campaign"}}
}
/* ---------- End secure bulk messaging ---------- */
function invBooks(){return db.bookCatalogue||[]} function invItems(){return db.stationeryItems||[]}
function LibraryInventory(){normalizeDbShape();const books=invBooks(),items=invItems(),issues=db.bookIssues||[],tx=db.inventoryTransactions||[];const low=items.filter(x=>Number(x.currentStock||0)<=Number(x.minimumStock||0));document.getElementById("content").innerHTML=`<div class="pagehero"><div><h2>📚 Library & Learning Resources Management</h2><p>Books, class resources, stationery, stock transactions and reports.</p></div></div><div class="grid">${stat("Book titles",books.length,"📖")}${stat("Book copies",books.reduce((a,x)=>a+Number(x.currentStock||0),0),"📚")}${stat("Stationery items",items.length,"✏️")}${stat("Low stock",low.length,"⚠️")}</div><div class="card"><div class="toolbar"><button onclick="libraryBookForm()">+ Register Book</button><button onclick="libraryPurchaseForm()">+ Book Purchase</button><button onclick="classInventoryForm()">Class / Stream Inventory</button><button onclick="bookIssueForm()">Issue / Return Book</button><button onclick="stationeryItemForm()">+ Stationery Item</button><button onclick="stationeryIssueForm()">Issue Stationery</button><button class="light" onclick="inventoryReport()">Reports</button></div></div><div class="two"><div class="card"><h3>Recent stock transactions</h3><div class="tablewrap"><table class="table"><thead><tr><th>Date</th><th>Type</th><th>Item</th><th>Qty</th></tr></thead><tbody>${tx.slice(0,8).map(x=>`<tr><td>${esc(String(x.createdAt||"").slice(0,10))}</td><td>${esc(x.type)}</td><td>${esc(x.itemName)}</td><td>${x.quantity}</td></tr>`).join("")||'<tr><td colspan="4">No transactions recorded.</td></tr>'}</tbody></table></div></div><div class="card"><h3>Low-stock alerts</h3>${low.map(x=>`<p>⚠️ <b>${esc(x.name)}</b>: ${x.currentStock} ${esc(x.unit||"units")} (minimum ${x.minimumStock})</p>`).join("")||'<p>All stationery stock levels are above their minimums.</p>'}</div></div>`}
function libraryBookForm(){openModal(`<h2>Register Book</h2><div class="formgrid">${field("Book title","ib_title")}${field("Category","ib_category","Textbook")}${field("Subject","ib_subject")}${field("Grade / Class","ib_grade","Grade 1","select",classes)}${field("Author","ib_author")}${field("Publisher","ib_publisher")}${field("ISBN","ib_isbn")}${field("Edition","ib_edition")}${field("Year published","ib_pubyear","","number")}${field("Storage location","ib_location","Library")}</div><div class="toolbar"><button onclick="saveLibraryBook()">Save Book</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`)}
function saveLibraryBook(){const name=v("ib_title").trim();if(!name){toast("Enter a book title");return}let b={id:uid("BOOK"),name,category:v("ib_category"),subject:v("ib_subject"),grade:v("ib_grade"),author:v("ib_author"),publisher:v("ib_publisher"),isbn:v("ib_isbn"),edition:v("ib_edition"),year:v("ib_pubyear"),location:v("ib_location"),currentStock:0};db.bookCatalogue.push(b);save();audit(`Book registered: ${name}`);closeModal();LibraryInventory();toast("Book registered")}
function libraryPurchaseForm(){const opts=invBooks().map(x=>x.name);openModal(`<h2>Record Book Purchase</h2>${field("Book","bp_book","","select",opts)}<div class="formgrid">${field("Quantity purchased","bp_qty","1","number")}${field("Price per book","bp_price","0","number")}${field("Supplier / Bookshop","bp_supplier")}${field("Date purchased","bp_date",new Date().toISOString().slice(0,10),"date")}${field("Funding source","bp_funding")}</div><p id="bp_total" class="small">Total cost is calculated and purchase history is retained.</p><div class="toolbar"><button onclick="saveBookPurchase()">Record Purchase</button></div>`)}
function saveBookPurchase(){const book=invBooks().find(x=>x.name===v("bp_book"));const qty=Number(v("bp_qty")),price=Number(v("bp_price"));if(!book||qty<=0||price<0){toast("Select a book and enter a valid quantity and price");return}const total=qty*price;db.bookPurchases.unshift({id:uid("BP"),bookId:book.id,bookName:book.name,quantity:qty,price,total,supplier:v("bp_supplier"),date:v("bp_date"),funding:v("bp_funding")});book.currentStock=Number(book.currentStock||0)+qty;recordInventoryTx("BOOK_PURCHASE",book.name,qty,book.id,{total});save();closeModal();LibraryInventory();toast(`Purchase recorded. Total: KSh ${total.toLocaleString()}`)}
function classInventoryForm(){openModal(`<h2>Class & Stream Book Inventory</h2><div class="formgrid">${field("Academic year","ci_year",db.settings.year,"number")}${field("Grade / Class","ci_class","Grade 1","select",classes)}${field("Stream","ci_stream")}${field("Subject","ci_subject")}${field("Book","ci_book","","select",invBooks().map(x=>x.name))}${field("Copies available","ci_qty","0","number")}</div><div class="toolbar"><button onclick="saveClassInventory()">Save Inventory</button></div>`)}
function saveClassInventory(){let b=invBooks().find(x=>x.name===v("ci_book")),qty=Number(v("ci_qty"));if(!b||qty<0){toast("Select a book and valid quantity");return}let key=[v("ci_year"),v("ci_class"),v("ci_stream"),b.id].join("|");let row=db.classBookInventory.find(x=>x.key===key);if(row)row.quantity=qty;else db.classBookInventory.push({id:uid("CBI"),key,year:v("ci_year"),className:v("ci_class"),stream:v("ci_stream"),subject:v("ci_subject")||b.subject,bookId:b.id,bookName:b.name,quantity:qty});save();closeModal();LibraryInventory();toast("Class inventory saved")}
function bookIssueForm(){openModal(`<h2>Book Issue / Return</h2><div class="formgrid">${field("Learner admission number","bi_adm")}${field("Book","bi_book","","select",invBooks().map(x=>x.name))}${field("Expected return date","bi_due","","date")}<div class="field"><label>Action</label><select id="f_bi_action"><option value="issue">Issue</option><option value="return">Return selected learner's book</option></select></div>${field("Condition","bi_condition","Good")}</div><div class="toolbar"><button onclick="saveBookIssue()">Save</button></div>`)}
function saveBookIssue(){const adm=v("bi_adm").trim(),book=invBooks().find(x=>x.name===v("bi_book")),action=v("bi_action");const learner=db.learners.find(x=>String(x.adm).toLowerCase()===adm.toLowerCase());if(!adm||!book){toast("Enter learner and book");return}let open=db.bookIssues.find(x=>x.admission===adm&&x.bookId===book.id&&x.status==="issued");if(action==="return"){if(!open){toast("No outstanding issue found");return}open.status="returned";open.returnedAt=new Date().toISOString();open.condition=v("bi_condition");book.currentStock=Number(book.currentStock||0)+1;recordInventoryTx("BOOK_RETURN",book.name,1,book.id,{admission:adm});}else{if(open){toast("This learner already has this book issued");return}if(Number(book.currentStock||0)<1){toast("Book is out of stock");return}book.currentStock--;db.bookIssues.unshift({id:uid("ISS"),admission:adm,learnerName:learner?.name||adm,className:learner?.class||"",stream:learner?.stream||"",bookId:book.id,bookName:book.name,subject:book.subject,issuedAt:new Date().toISOString(),dueDate:v("bi_due"),status:"issued",staff:currentUser?.username||"staff"});recordInventoryTx("BOOK_ISSUE",book.name,-1,book.id,{admission:adm});}save();closeModal();LibraryInventory();toast(action==="return"?"Book returned":"Book issued")}
function stationeryItemForm(){openModal(`<h2>Register Stationery / Store Item</h2><div class="formgrid">${field("Item name","si_name")}${field("Category","si_category","General Stores")}${field("Description","si_desc")}${field("Unit","si_unit","pieces")}${field("Opening quantity","si_qty","0","number")}${field("Purchase price per unit","si_price","0","number")}${field("Minimum stock level","si_min","0","number")}${field("Storage location","si_location","Stores")}</div><div class="toolbar"><button onclick="saveStationeryItem()">Save Item</button></div>`)}
function saveStationeryItem(){let name=v("si_name").trim(),qty=Number(v("si_qty"));if(!name||qty<0){toast("Enter item name and valid quantity");return}if(invItems().some(x=>x.name.toLowerCase()===name.toLowerCase())){toast("An item with this name already exists");return}let x={id:uid("ST"),name,category:v("si_category"),description:v("si_desc"),unit:v("si_unit"),currentStock:qty,price:Number(v("si_price")),minimumStock:Number(v("si_min")),location:v("si_location")};db.stationeryItems.push(x);if(qty)recordInventoryTx("STATIONERY_OPENING",name,qty,x.id,{});save();closeModal();LibraryInventory()}
function stationeryIssueForm(){openModal(`<h2>Issue Stationery</h2>${field("Item","sx_item","","select",invItems().map(x=>x.name))}<div class="formgrid">${field("Quantity","sx_qty","1","number")}${field("Recipient","sx_recipient")}${field("Purpose","sx_purpose")}${field("Authorising officer","sx_authoriser",currentUser?.username||"")}</div><div class="toolbar"><button onclick="saveStationeryIssue()">Issue Stock</button></div>`)}
function saveStationeryIssue(){let x=invItems().find(a=>a.name===v("sx_item")),q=Number(v("sx_qty"));if(!x||q<=0||q>Number(x.currentStock||0)){toast("Insufficient stock or invalid quantity");return}x.currentStock-=q;db.stationeryIssuance.unshift({id:uid("SXI"),itemId:x.id,itemName:x.name,quantity:q,recipient:v("sx_recipient"),purpose:v("sx_purpose"),authoriser:v("sx_authoriser"),date:new Date().toISOString()});recordInventoryTx("STATIONERY_ISSUE",x.name,-q,x.id,{recipient:v("sx_recipient")});save();closeModal();LibraryInventory();toast("Stationery issued")}
function recordInventoryTx(type,itemName,quantity,itemId,meta){db.inventoryTransactions.unshift({id:uid("TX"),type,itemName,itemId,quantity,meta,createdAt:new Date().toISOString(),staff:currentUser?.username||"staff"})}
function inventoryReport(){const bookValue=(db.bookPurchases||[]).reduce((a,x)=>a+Number(x.total||0),0),stationeryValue=invItems().reduce((a,x)=>a+Number(x.currentStock||0)*Number(x.price||0),0);openModal(`<h2>Inventory Reports</h2><div class="report"><h3>Annual / Current Inventory Summary</h3><p><b>Book purchase expenditure:</b> KSh ${bookValue.toLocaleString()}</p><p><b>Estimated stationery value:</b> KSh ${stationeryValue.toLocaleString()}</p><p><b>Books issued:</b> ${(db.bookIssues||[]).filter(x=>x.status==="issued").length} &nbsp; <b>Returned:</b> ${(db.bookIssues||[]).filter(x=>x.status==="returned").length}</p><button onclick="window.print()">Print A4 Report</button></div>`)}


/* ---------- School Operations: calendar, learner support, meals and finance ---------- */
function kenyaHolidaySet(year){
 const fixed=[`${year}-01-01`,`${year}-05-01`,`${year}-06-01`,`${year}-10-10`,`${year}-10-20`,`${year}-12-12`,`${year}-12-25`,`${year}-12-26`];
 return new Set([...(db.schoolCalendar?.holidays||[]),...fixed]);
}
function termConfig(){const k=periodKey();return db.schoolCalendar.terms[k]||{opening:'',closing:''}}
function schoolDaysBetween(start,end,includeSaturday=false){if(!start||!end)return 0;let n=0,d=new Date(start+'T12:00:00'),last=new Date(end+'T12:00:00'),hol=kenyaHolidaySet(d.getFullYear());for(;d<=last;d.setDate(d.getDate()+1)){const day=d.getDay(),iso=d.toISOString().slice(0,10);if(day===0||(!includeSaturday&&day===6)||hol.has(iso))continue;n++}return n}
function weeksInTerm(start,end,includeSaturday=false){const out=[];if(!start||!end)return out;let d=new Date(start+'T12:00:00'),last=new Date(end+'T12:00:00');for(;d<=last;d.setDate(d.getDate()+1)){let dow=d.getDay();if(dow===1){let e=new Date(d);e.setDate(e.getDate()+(includeSaturday?5:4));out.push({start:d.toISOString().slice(0,10),end:e.toISOString().slice(0,10)})}}return out}
function activeStatus(l,start,end){const rec=(db.attendance||[]).filter(x=>x.learner===l.id&&(!start||x.date>=start)&&(!end||x.date<=end));if(!rec.length)return 'No attendance data';const present=rec.filter(x=>x.status==='Present'||x.status==='Late').length;return present/rec.length>=.6?'Active':'Inactive'}
function paidForPeriod(l){return (db.payments||[]).filter(p=>String(p.learner)===String(l.id)&&String(p.year)===String(db.settings.year)&&p.term===db.settings.term).reduce((a,p)=>a+Number(p.amount||0),0)}
function saveCalendar(){const opening=v('calopen'),closing=v('calclose');if(!opening||!closing||opening>closing){toast('Enter valid opening and closing dates');return}db.schoolCalendar.terms[periodKey()]={opening,closing};db.schoolCalendar.saturdayLearners=!!document.getElementById('satLearners').checked;db.schoolCalendar.saturdayTeachers=!!document.getElementById('satTeachers').checked;const extra=(v('calholidays')||'').split(/[,\n]/).map(x=>x.trim()).filter(Boolean);db.schoolCalendar.holidays=[...new Set(extra)];save();audit('School calendar updated');SchoolOperations();toast('Calendar saved and predictions refreshed')}
function addWorker(){const name=v('workerName').trim(),salary=Number(v('workerSalary')),sec=v('workerSection');if(!name||!(salary>=0)){toast('Enter worker name and salary');return}db.schoolWorkers.push({id:uid('WRK'),name,salary,section:sec});save();SchoolOperations()}
function addSchoolExpense(){const item=v('expenseItem').trim(),amount=Number(v('expenseCost')),sec=v('expenseSection');if(!item||!(amount>0)){toast('Enter item and price');return}db.schoolExpenses.push({id:uid('EXP'),item,amount,section:sec,date:new Date().toISOString().slice(0,10)});save();SchoolOperations()}
function saveMealProgram(){db.mealProgram={...db.mealProgram,learners:Number(v('mpLearners')),maizePerDay:Number(v('mpMaize')),beansPerDay:Number(v('mpBeans')),oilLitres:Number(v('mpOil')),oilPerDay:Number(v('mpOilDay')),teacherBudget:Number(v('mpTeacherBudget')),teacherDailyCost:Number(v('mpTeacherDaily'))};save();SchoolOperations();toast('Meals programme saved')}

function attendanceWeekOptions(){
 const cfg=termConfig(), include=!!db.schoolCalendar?.saturdayLearners;
 return weeksInTerm(cfg.opening,cfg.closing,include).map(w=>({
   ...w,label:`${w.start} to ${w.end}`
 }));
}
function attendanceRegisterDownloadForm(kind){
 const classesWithLearners=classes.filter(c=>db.learners.some(l=>l.class===c&&l.status!=='Archived'));
 const cfg=termConfig(), weeks=attendanceWeekOptions();
 const weekField=kind==='weekly'
   ? field("Week","attRegWeek",weeks[0]?.start||cfg.opening,"select",weeks.map(w=>w.start))
   : "";
 openModal(`<h2>${kind==='weekly'?'Weekly':'Termly'} Attendance Register</h2>
 <p class="small">Download a readable A4 landscape register using attendance codes <b>P</b> = Present, <b>L</b> = Late and <b>A</b> = Absent. The print sizing follows the compact school report/register layout.</p>
 <div class="formgrid">${field("Class","attRegClass",classesWithLearners[0]||"Grade 1","select",classesWithLearners)}${weekField}</div>
 <div class="toolbar"><button class="success" onclick="downloadAttendanceRegister('${kind}')">⬇ Download A4 PDF</button><button class="light" onclick="printAttendanceRegister('${kind}')">🖨️ Print / Preview</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`);
}
function attendanceCode(status){
 return status==='Present'?'P':status==='Late'?'L':status==='Absent'?'A':'—';
}
function attendanceDates(start,end,includeSaturday=false){
 const out=[]; if(!start||!end)return out;
 const holidays=new Set([...(kenyaHolidaySet(new Date(start+'T12:00:00').getFullYear())||[]),...(db.schoolCalendar?.holidays||[])]);
 let d=new Date(start+'T12:00:00'),last=new Date(end+'T12:00:00');
 for(;d<=last;d.setDate(d.getDate()+1)){
   const day=d.getDay(),iso=d.toISOString().slice(0,10);
   if(day===0||(!includeSaturday&&day===6)||holidays.has(iso))continue;
   out.push({iso,label:d.toLocaleDateString('en-KE',{weekday:'short',day:'2-digit',month:'short'})});
 }
 return out;
}
function attendanceRegisterHTML(className,start,end,title){
 const include=!!db.schoolCalendar?.saturdayLearners;
 const learners=(db.learners||[]).filter(l=>l.class===className&&l.status!=='Archived');
 const dates=attendanceDates(start,end,include);
 const cells=dates.map(d=>`<th><span>${esc(d.label.split(' ')[0])}</span><br><small>${esc(d.label.replace(/^[^ ]+ /,''))}</small></th>`).join('');
 const rows=learners.map((l,i)=>{
   let p=0,a=0,late=0;
   const codes=dates.map(d=>{
     const r=(db.attendance||[]).find(x=>String(x.learner)===String(l.id)&&x.class===className&&x.date===d.iso);
     const code=attendanceCode(r?.status);
     if(code==='P')p++; else if(code==='A')a++; else if(code==='L')late++;
     return `<td class="att-code ${code==='A'?'code-a':code==='L'?'code-l':'code-p'}">${code}</td>`;
   }).join('');
   const recorded=p+a+late,rate=recorded?Math.round(((p+late)/recorded)*100):0;
   return `<tr><td>${i+1}</td><td>${esc(l.adm||'')}</td><td class="att-name">${esc(l.name)}</td>${codes}<td>${p}</td><td>${late}</td><td>${a}</td><td>${rate}%</td></tr>`;
 }).join('')||`<tr><td colspan="${8+dates.length}">No active learners found.</td></tr>`;
 return `<div class="attendance-register-print"><div class="schoolhead"><h1>${esc(db.settings.school||'SCHOOL')}</h1><p>${esc(title)}</p><p>${esc(className)} • ${esc(start)} to ${esc(end)} • ${esc(db.settings.term)}, ${esc(String(db.settings.year))}</p></div>
 <div class="register-meta"><span>Class: <b>${esc(className)}</b></span><span>Learners: <b>${learners.length}</b></span><span>Codes: <b>P</b> Present • <b>L</b> Late • <b>A</b> Absent</span></div>
 <table class="register-table attendance-register-table"><thead><tr><th>#</th><th>Adm.</th><th>Learner Name</th>${cells}<th>P</th><th>L</th><th>A</th><th>Attendance %</th></tr></thead><tbody>${rows}</tbody></table>
 <div class="register-sign"><span>Class Teacher: __________________</span><span>Signature: __________________</span><span>Date: ____________</span></div></div>`;
}
function selectedAttendancePeriod(kind){
 const cfg=termConfig();
 if(kind==='termly')return {start:cfg.opening,end:cfg.closing,title:'TERMLY CLASS ATTENDANCE REGISTER'};
 const start=v('attRegWeek')||attendanceWeekOptions()[0]?.start||cfg.opening;
 const w=attendanceWeekOptions().find(x=>x.start===start);
 return {start,end:w?.end||start,title:'WEEKLY CLASS ATTENDANCE REGISTER'};
}
async function downloadAttendanceRegister(kind){
 const c=v('attRegClass')||classes[0],p=selectedAttendancePeriod(kind);
 if(!c||!p.start||!p.end){toast('Set the school calendar first');return}
 const html=attendanceRegisterHTML(c,p.start,p.end,p.title); closeModal();
 await downloadPrintableDocument(html,`${c}-${kind}-Attendance-Register-${p.start}-to-${p.end}.pdf`,'landscape');
}
function printAttendanceRegister(kind){
 const c=v('attRegClass')||classes[0],p=selectedAttendancePeriod(kind);
 if(!c||!p.start||!p.end){toast('Set the school calendar first');return}
 const html=attendanceRegisterHTML(c,p.start,p.end,p.title); closeModal();
 openPrintableWindow(html,`${c} ${kind} attendance register`,'landscape');
}

function schoolOpsDivisionForClass(className){
 if(ecde.includes(className))return 'ECDE';
 if(lower.includes(className))return 'Lower Primary';
 if(upper.includes(className))return 'Upper Primary';
 if(junior.includes(className))return 'Junior School';
 return 'Other';
}
function schoolOpsDivisionChanged(){SchoolOperations()}
function SchoolOperations(){
 const cfg=termConfig();
 const learnerDays=schoolDaysBetween(cfg.opening,cfg.closing,db.schoolCalendar.saturdayLearners);
 const teacherDays=schoolDaysBetween(cfg.opening,cfg.closing,db.schoolCalendar.saturdayTeachers);
 const allLearners=(db.learners||[]).filter(l=>l.status!=="Archived");
 const divisions=['All School','ECDE','Lower Primary','Upper Primary','Junior School'];
 const selectedDivision=v('opsDivision')||'All School';
 const divisionClasses=selectedDivision==='All School'?classes.slice():selectedDivision==='ECDE'?ecde.slice():selectedDivision==='Lower Primary'?lower.slice():selectedDivision==='Upper Primary'?upper.slice():junior.slice();
 let selectedClass=v('opsClass')||'All classes';
 if(selectedClass!=='All classes'&&!divisionClasses.includes(selectedClass))selectedClass='All classes';
 const scopedClasses=selectedClass==='All classes'?divisionClasses:[selectedClass];
 const ls=allLearners.filter(l=>scopedClasses.includes(l.class));
 const learnerRows=ls.map(l=>{
  const activity=activeStatus(l,cfg.opening,cfg.closing);
  const paid=paidForPeriod(l);
  const termDue=Number(feeFor(l.class)||0);
  const openingBalance=typeof feeOpeningBalanceForLearner==='function'?Number(feeOpeningBalanceForLearner(l)||0):0;
  const totalDue=termDue+openingBalance;
  const balance=Math.max(0,totalDue-paid);
  const feeStatus=paid<=0?'Not paying':balance>0?'Part payment':'Paid in full';
  return {learner:l,activity,paid,termDue,openingBalance,totalDue,balance,feeStatus};
 });
 const activeRows=learnerRows.filter(r=>r.activity==='Active');
 const inactiveRows=learnerRows.filter(r=>r.activity==='Inactive');
 const noAttendanceRows=learnerRows.filter(r=>r.activity==='No attendance data');
 const payingRows=learnerRows.filter(r=>r.paid>0);
 const notPayingRows=learnerRows.filter(r=>r.paid<=0);
 const activePaying=activeRows.filter(r=>r.paid>0);
 const activeNotPaying=activeRows.filter(r=>r.paid<=0);
 const inactivePaying=inactiveRows.filter(r=>r.paid>0);
 const inactiveNotPaying=inactiveRows.filter(r=>r.paid<=0);
 const supportRows=activeRows.filter(r=>r.balance>0);
 const money=n=>'KSh '+Number(n||0).toLocaleString();
 const mp=db.mealProgram;
 const maizeTotal=(db.mealRecords||[]).reduce((s,r)=>s+Number(r.maizeKg||r.maize||0),0);
 const beansTotal=(db.mealRecords||[]).reduce((s,r)=>s+Number(r.beansKg||r.beans||0),0);
 const oilDays=mp.oilPerDay>0?Math.floor(mp.oilLitres/mp.oilPerDay):0;
 const teacherBudgetDays=mp.teacherDailyCost>0?Math.floor(mp.teacherBudget/mp.teacherDailyCost):0;
 const salaryTotal=db.schoolWorkers.reduce((s,x)=>s+Number(x.salary||0),0);
 const expenseTotal=db.schoolExpenses.reduce((s,x)=>s+Number(x.amount||0),0);
 const divisionOptions=divisions.map(d=>`<option value="${esc(d)}" ${selectedDivision===d?'selected':''}>${esc(d)}</option>`).join('');
 const classOptions=['All classes',...divisionClasses].map(c=>`<option value="${esc(c)}" ${selectedClass===c?'selected':''}>${c==='All classes'?'All classes in selected division':esc(c)}</option>`).join('');
 const breakdownClasses=selectedClass==='All classes'?divisionClasses:[selectedClass];
 const breakdown=breakdownClasses.map(c=>{
  const rr=learnerRows.filter(r=>r.learner.class===c);
  const a=rr.filter(r=>r.activity==='Active').length;
  const i=rr.filter(r=>r.activity==='Inactive').length;
  const p=rr.filter(r=>r.paid>0).length;
  const np=rr.filter(r=>r.paid<=0).length;
  const due=rr.reduce((n,r)=>n+r.totalDue,0);
  const paid=rr.reduce((n,r)=>n+r.paid,0);
  return `<tr><td><b>${esc(c)}</b></td><td>${rr.length}</td><td>${a}</td><td>${i}</td><td>${p}</td><td>${np}</td><td>${money(due)}</td><td>${money(paid)}</td><td>${money(Math.max(0,due-paid))}</td></tr>`;
 }).join('');
 const learnerTable=learnerRows.slice().sort((a,b)=>classes.indexOf(a.learner.class)-classes.indexOf(b.learner.class)||String(a.learner.name||'').localeCompare(String(b.learner.name||''))).map(r=>{
  const activityBadge=r.activity==='Active'?'<span class="badge bright">Active</span>':r.activity==='Inactive'?'<span class="badge">Inactive</span>':'<span class="badge">No attendance data</span>';
  const feeBadge=r.feeStatus==='Paid in full'?'<span class="badge bright">Paid in full</span>':r.feeStatus==='Part payment'?'<span class="badge">Part payment</span>':'<span class="badge">Not paying</span>';
  return `<tr><td>${esc(r.learner.name||'')}</td><td>${esc(r.learner.class||'')}</td><td>${activityBadge}</td><td>${feeBadge}</td><td>${money(r.termDue)}</td><td>${money(r.paid)}</td><td>${money(r.balance)}</td></tr>`;
 }).join('')||'<tr><td colspan="7">No learners found in this selection.</td></tr>';
 const supportTable=supportRows.map(r=>`<tr><td>${esc(r.learner.name||'')}</td><td>${esc(r.learner.class||'')}</td><td>${money(r.paid)}</td><td>${money(r.balance)}</td><td>Review household circumstances</td></tr>`).join('')||'<tr><td colspan="5">No active learners with an outstanding fee balance in this selection.</td></tr>';
 document.getElementById('content').innerHTML=`<div class="pagehero"><div><h2>🌈 School Operations Centre</h2><p>School-wide operations with learner activity and fee analysis by division and individual class.</p></div><span class="badge bright">${esc(db.settings.term)} ${esc(db.settings.year)}</span></div>
 <div class="card"><h3>🎯 Learner Activity & Fees — Select Your Scope</h3><p class="small">Choose the whole school, a school division, or an individual class. All learner counts, attendance activity, fee figures, breakdowns and support-review lists below update to match your selection.</p><div class="formgrid"><div class="field"><label>School division</label><select id="f_opsDivision" onchange="schoolOpsDivisionChanged()">${divisionOptions}</select></div><div class="field"><label>Individual class</label><select id="f_opsClass" onchange="SchoolOperations()">${classOptions}</select></div></div><p class="small"><b>Current view:</b> ${esc(selectedDivision)}${selectedClass==='All classes'?' — all classes':` — ${esc(selectedClass)}`} • Current term: ${esc(db.settings.term)} ${esc(db.settings.year)}</p></div>
 <div class="grid">${stat('Learners in view',learnerRows.length,'👨‍🎓')}${stat('Active learners',activeRows.length,'🟢')}${stat('Inactive learners',inactiveRows.length,'🔴')}${stat('No attendance data',noAttendanceRows.length,'⚪')}${stat('Paying learners',payingRows.length,'💰')}${stat('Not paying',notPayingRows.length,'🟠')}</div>
 <div class="grid">${stat('Active & paying',activePaying.length,'🟢')}${stat('Active & not paying',activeNotPaying.length,'🟠')}${stat('Inactive but paying',inactivePaying.length,'🔵')}${stat('Inactive & not paying',inactiveNotPaying.length,'🔴')}${stat('Support review',supportRows.length,'⭐')}</div>
 <div class="card"><h3>📚 Class-by-class activity and fee breakdown</h3><div class="tablewrap"><table class="table"><thead><tr><th>Class</th><th>Learners</th><th>Active</th><th>Inactive</th><th>Paying</th><th>No payment</th><th>Fees due*</th><th>Paid this term</th><th>Outstanding*</th></tr></thead><tbody>${breakdown||'<tr><td colspan="9">No classes in this selection.</td></tr>'}</tbody></table></div><p class="small">* Fees due include current-term fees and any opening balance returned by the fee records. Activity is based on attendance recorded between the current term opening and closing dates. Learners without attendance entries are shown separately, not incorrectly labelled inactive.</p></div>
 <div class="card"><h3>👥 Learner-level activity and fee register</h3><div class="tablewrap"><table class="table"><thead><tr><th>Learner</th><th>Class</th><th>Activity</th><th>Fee status</th><th>Fees due</th><th>Paid this term</th><th>Outstanding</th></tr></thead><tbody>${learnerTable}</tbody></table></div></div>
 <div class="card"><h3>⭐ Scholarship / Fee-waiver review — selected scope</h3><p class="small">These are active learners with outstanding balances. This is a review shortlist, not an automatic scholarship decision; staff should assess need and eligibility before granting support.</p><div class="tablewrap"><table class="table"><thead><tr><th>Learner</th><th>Class</th><th>Paid this term</th><th>Outstanding</th><th>Next step</th></tr></thead><tbody>${supportTable}</tbody></table></div></div>
 <div class="card"><h3>📅 School Calendar & Kenyan Public Holidays</h3><div class="formgrid"><div class="field"><label>Opening date</label><input id="f_calopen" type="date" value="${esc(cfg.opening)}"></div><div class="field"><label>Closing date</label><input id="f_calclose" type="date" value="${esc(cfg.closing)}"></div><div class="field"><label>Additional holiday dates (comma separated)</label><input id="f_calholidays" placeholder="YYYY-MM-DD, YYYY-MM-DD" value="${esc((db.schoolCalendar.holidays||[]).join(', '))}"></div></div><label><input id="satLearners" type="checkbox" ${db.schoolCalendar.saturdayLearners?'checked':''}> Optional Saturday programme — learners</label> &nbsp; <label><input id="satTeachers" type="checkbox" ${db.schoolCalendar.saturdayTeachers?'checked':''}> Optional Saturday programme — teachers</label><div class="toolbar"><button onclick="saveCalendar()">Save Calendar</button></div><p class="small">Fixed Kenyan dates are included for planning; add officially gazetted/movable holidays above when announced. Learner days: <b>${learnerDays}</b> • Teacher programme days: <b>${teacherDays}</b>.</p></div>
 <div class="card"><h3>📈 Attendance planning</h3><p>Weekly attendance is calculated from Monday–Friday records, with Saturday included only when enabled.</p><p><b>Term weeks:</b> ${weeksInTerm(cfg.opening,cfg.closing,db.schoolCalendar.saturdayLearners).length}</p><p><b>Active learners in selected view:</b> ${activeRows.length} of ${learnerRows.length} learners with records classified from attendance.</p><div class="toolbar"><button class="light" onclick="show('Attendance')">Open daily register</button><button class="success" onclick="attendanceRegisterDownloadForm('weekly')">⬇ Weekly Register</button><button class="success" onclick="attendanceRegisterDownloadForm('termly')">⬇ Termly Register</button></div></div>
 <div class="card"><h3>🌽 Learner Meals Contribution & Prediction</h3><div class="formgrid"><div class="field"><label>Learners in programme</label><input id="f_mpLearners" type="number" value="${mp.learners||allLearners.length}"></div><div class="field"><label>Maize use per day (kg)</label><input id="f_mpMaize" type="number" step="0.01" value="${mp.maizePerDay||0}"></div><div class="field"><label>Beans use per day (kg)</label><input id="f_mpBeans" type="number" step="0.01" value="${mp.beansPerDay||0}"></div><div class="field"><label>Cooking oil available (litres)</label><input id="f_mpOil" type="number" step="0.01" value="${mp.oilLitres||0}"></div><div class="field"><label>Cooking oil per day (litres)</label><input id="f_mpOilDay" type="number" step="0.01" value="${mp.oilPerDay||0}"></div></div><button onclick="saveMealProgram()">Save Meals Plan</button><p class="small">Record learner contributions in the Meals Register. Use a 2 kg tin/basket standard when entering quantities. Current predicted oil coverage: <b>${oilDays} programme days</b>. Total numeric maize recorded: <b>${maizeTotal}</b>; beans: <b>${beansTotal}</b>.</p></div>
 <div class="card"><h3>👩🏽‍🏫 Teachers' Lunch Programme & Budget</h3><div class="formgrid"><div class="field"><label>Money contributed (KSh)</label><input id="f_mpTeacherBudget" type="number" value="${mp.teacherBudget||0}"></div><div class="field"><label>Budgeted meal cost per day (KSh)</label><input id="f_mpTeacherDaily" type="number" value="${mp.teacherDailyCost||0}"></div></div><button onclick="saveMealProgram()">Save Teacher Lunch Budget</button><p>Predicted coverage: <b>${teacherBudgetDays} school days</b> out of <b>${teacherDays}</b> planned programme days. Weekends and configured holidays are excluded.</p></div>
 <div class="two"><div class="card"><h3>👷 Workers & Salaries</h3><div class="formgrid"><div class="field"><label>Worker name</label><input id="f_workerName"></div><div class="field"><label>Monthly salary (KSh)</label><input id="f_workerSalary" type="number"></div><div class="field"><label>Section</label><select id="f_workerSection"><option>ECDE</option><option>Primary</option><option>Junior</option><option>Shared</option></select></div></div><button onclick="addWorker()">Add Worker</button><p><b>Total salaries:</b> ${money(salaryTotal)}</p></div><div class="card"><h3>🧾 Expenditures by Section</h3><div class="formgrid"><div class="field"><label>Item / expense</label><input id="f_expenseItem" placeholder="Transport, administration, item purchased"></div><div class="field"><label>Price (KSh)</label><input id="f_expenseCost" type="number"></div><div class="field"><label>Section</label><select id="f_expenseSection"><option>ECDE</option><option>Primary</option><option>Junior</option><option>Shared</option></select></div></div><button onclick="addSchoolExpense()">Add Expenditure</button><p><b>Total expenditure:</b> ${money(expenseTotal)} • <b>Including salaries:</b> ${money(expenseTotal+salaryTotal)}</p></div></div>`;
}
