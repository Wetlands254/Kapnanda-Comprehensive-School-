/* Kapnanda Comprehensive School Management System
   Open-access version: no login/password screen.
   Data is saved in this browser automatically. Optional Supabase sync can be enabled below.
*/
const KEY="kapnanda_csms_v1";
const defaultData={
 students:[], teachers:[], classes:[], attendance:[], fees:[], exams:[], users:[
  {id:"U001",name:"School Administrator",role:"Administrator",phone:"",status:"Active"},
  {id:"U002",name:"Academic Office",role:"Teacher",phone:"",status:"Active"},
  {id:"U003",name:"Accounts Office",role:"Bursar",phone:"",status:"Active"}
 ], notices:[]
};
let data;
try {
  const saved = localStorage.getItem(KEY);
  data = saved ? JSON.parse(saved) : null;
  if (!data || typeof data !== "object") data = null;
} catch (err) {
  console.warn("Kapnanda: saved local data could not be read; starting with a clean database.", err);
  data = null;
}
if (!data) data = JSON.parse(JSON.stringify(defaultData));
let page="dashboard";
const navItems=[
 ["dashboard","Dashboard","▦"],["students","Students","♙"],["teachers","Teachers","♟"],["classes","Classes","▤"],
 ["attendance","Attendance","✓"],["fees","Fees & Payments","₿"],["exams","Exams & Results","★"],["users","Staff & Users","♧"],["notices","Announcements","✦"],["settings","Settings","⚙"]
];
const el=s=>document.querySelector(s);
function save(){localStorage.setItem(KEY,JSON.stringify(data));el("#saveState").textContent="Saved automatically";setTimeout(()=>el("#saveState").textContent="Local changes enabled",1200)}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,5)}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function setPage(p){page=p;renderNav();render()}
function renderNav(){el("#nav").innerHTML=navItems.map(([id,n,ic])=>`<button class="${page===id?"active":""}" onclick="setPage('${id}')">${ic} &nbsp; ${n}</button>`).join("")}
function render(){
 const titles=Object.fromEntries(navItems.map(x=>[x[0],x[1]]));el("#pageTitle").textContent=titles[page]||"Dashboard";el("#pageSub").textContent=page==="dashboard"?"School overview":"Manage and save school records";
 const fn={dashboard:dashboard,students:students,teachers:teachers,classes:classes,attendance:attendance,fees:fees,exams:exams,users:users,notices:notices,settings:settings}[page];el("#content").innerHTML=fn();
}
function dashboard(){return `<div class="cards">
<div class="card"><div class="label">Students</div><div class="num">${data.students.length}</div></div>
<div class="card"><div class="label">Teachers</div><div class="num">${data.teachers.length}</div></div>
<div class="card"><div class="label">Classes</div><div class="num">${data.classes.length}</div></div>
<div class="card"><div class="label">Staff / Users</div><div class="num">${data.users.length}</div></div></div>
<div class="grid2"><div class="panel"><h3>Quick actions</h3><div class="toolbar">
<button class="btn primary" onclick="openForm('student')">Add student</button><button class="btn primary" onclick="openForm('teacher')">Add teacher</button><button class="btn secondary" onclick="openForm('class')">Add class</button><button class="btn secondary" onclick="openForm('payment')">Record payment</button></div>
<div class="notice">This version intentionally has <b>no password</b>. Multiple school staff can open the system and edit records. Changes are saved automatically on this device.</div></div>
<div class="panel"><h3>Recent students</h3>${data.students.slice(-5).reverse().map(s=>`<div class="list"><li><span>${esc(s.name)}</span><span class="badge">${esc(s.className||"")}</span></li></div>`).join("")||'<div class="empty">No students yet.</div>'}</div></div>`}
function pageTable(title,add,type,headers,rows){return `<div class="panel"><div class="toolbar"><button class="btn primary" onclick="openForm('${type}')">+ ${add}</button><input id="search" placeholder="Search..." oninput="filterRows()"></div><div class="table-wrap"><table class="table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}<th>Actions</th></tr></thead><tbody id="rows">${rows||""}</tbody></table></div></div>`}
function action(type,id){return `<div class="actions"><button class="mini secondary" onclick="openForm('${type}','${id}')">Edit</button><button class="mini danger" onclick="removeItem('${type}','${id}')">Delete</button></div>`}
function students(){return pageTable("Students","Student","student",["Admission No.","Name","Gender","Class","Guardian","Phone"],data.students.map(s=>`<tr><td>${esc(s.adm)}</td><td>${esc(s.name)}</td><td>${esc(s.gender)}</td><td>${esc(s.className)}</td><td>${esc(s.guardian)}</td><td>${esc(s.phone)}</td><td>${action("student",s.id)}</td></tr>`).join(""))}
function teachers(){return pageTable("Teachers","Teacher","teacher",["ID","Name","Subject","Phone","Status"],data.teachers.map(s=>`<tr><td>${esc(s.tid)}</td><td>${esc(s.name)}</td><td>${esc(s.subject)}</td><td>${esc(s.phone)}</td><td>${esc(s.status)}</td><td>${action("teacher",s.id)}</td></tr>`).join(""))}
function classes(){return pageTable("Classes","Class","class",["Name","Stream","Teacher","Room"],data.classes.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.stream)}</td><td>${esc(s.teacher)}</td><td>${esc(s.room)}</td><td>${action("class",s.id)}</td></tr>`).join(""))}
function attendance(){return pageTable("Attendance","Attendance record","attendance",["Date","Student","Status","Remarks"],data.attendance.map(s=>`<tr><td>${esc(s.date)}</td><td>${esc(s.student)}</td><td>${esc(s.status)}</td><td>${esc(s.remarks)}</td><td>${action("attendance",s.id)}</td></tr>`).join(""))}
function fees(){let total=data.fees.reduce((a,b)=>a+Number(b.amount||0),0);return `<div class="cards"><div class="card"><div class="label">Recorded payments</div><div class="num">${data.fees.length}</div></div><div class="card"><div class="label">Total collected</div><div class="num">${total.toLocaleString()}</div></div></div><div style="margin-top:15px">${pageTable("Fees","Payment","payment",["Date","Student","Amount","Method","Reference"],data.fees.map(s=>`<tr><td>${esc(s.date)}</td><td>${esc(s.student)}</td><td>${Number(s.amount||0).toLocaleString()}</td><td>${esc(s.method)}</td><td>${esc(s.ref)}</td><td>${action("payment",s.id)}</td></tr>`).join(""))}</div>`}
function exams(){return pageTable("Exams & Results","Result","exam",["Date","Student","Subject","Exam","Score","Grade"],data.exams.map(s=>`<tr><td>${esc(s.date)}</td><td>${esc(s.student)}</td><td>${esc(s.subject)}</td><td>${esc(s.exam)}</td><td>${esc(s.score)}</td><td>${esc(s.grade)}</td><td>${action("exam",s.id)}</td></tr>`).join(""))}
function users(){return pageTable("Staff & Users","User","user",["Name","Role","Phone","Status"],data.users.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.role)}</td><td>${esc(s.phone)}</td><td>${esc(s.status)}</td><td>${action("user",s.id)}</td></tr>`).join(""))}
function notices(){return pageTable("Announcements","Announcement","notice",["Date","Title","Message"],data.notices.map(s=>`<tr><td>${esc(s.date)}</td><td>${esc(s.title)}</td><td>${esc(s.message)}</td><td>${action("notice",s.id)}</td></tr>`).join(""))}
function settings(){return `<div class="panel"><h3>System settings</h3><div class="notice"><b>Open access:</b> there is no password or login screen in this version. Anyone who can open the application can edit and save records.</div><p><b>Storage:</b> browser local storage. For a shared multi-device school database, connect Supabase and apply shared write policies.</p><button class="btn danger" onclick="resetData()">Reset all local data</button></div>`}
const schemas={
student:[["adm","Admission No.","text"],["name","Full name","text"],["gender","Gender","select:Male|Female|Other"],["className","Class","text"],["guardian","Guardian","text"],["phone","Phone","text"]],
teacher:[["tid","Teacher ID","text"],["name","Full name","text"],["subject","Subject","text"],["phone","Phone","text"],["status","Status","select:Active|Inactive"]],
class:[["name","Class name","text"],["stream","Stream","text"],["teacher","Class teacher","text"],["room","Room","text"]],
attendance:[["date","Date","date"],["student","Student","text"],["status","Status","select:Present|Absent|Late|Excused"],["remarks","Remarks","text"]],
payment:[["date","Date","date"],["student","Student","text"],["amount","Amount","number"],["method","Method","select:Cash|Bank|Mobile Money|Other"],["ref","Reference","text"]],
exam:[["date","Date","date"],["student","Student","text"],["subject","Subject","text"],["exam","Exam","text"],["score","Score","number"],["grade","Grade","text"]],
user:[["name","Full name","text"],["role","Role","select:Administrator|Teacher|Bursar|Secretary|Registrar|Other"],["phone","Phone","text"],["status","Status","select:Active|Inactive"]],
notice:[["date","Date","date"],["title","Title","text"],["message","Message","textarea"]]
};
function openForm(type,id=null){
 const item=id?data[type==="payment"?"fees":type==="user"?"users":type==="notice"?"notices":type+"s"].find(x=>x.id===id):{};
 const fields=schemas[type].map(([k,l,t])=>{
   if(t.startsWith("select:"))return `<div class="field"><label>${l}</label><select name="${k}">${t.slice(7).split("|").map(o=>`<option ${item[k]===o?"selected":""}>${o}</option>`).join("")}</select></div>`;
   return `<div class="field ${t==="textarea"?"full":""}"><label>${l}</label>${t==="textarea"?`<textarea name="${k}" rows="4">${esc(item[k]||"")}</textarea>`:`<input name="${k}" type="${t}" value="${esc(item[k]||"")} required>`}</div>`;
 }).join("");

 const m=document.createElement("div");m.id="body";m.className="modal";m.innerHTML=`<div class="modal-box"><div class="modal-head"><h3>${id?"Edit":"Add"} ${type}</h3><button class="close" onclick="this.closest('.modal').remove()">✕</button></div><form onsubmit="submitForm(event,'${type}','${id||""}')"><div class="formgrid">${fields}</div><div style="margin-top:15px;text-align:right"><button type="button" class="btn secondary" onclick="this.closest('.modal').remove()">Cancel</button> <button class="btn primary">Save</button></div></form></div>`;document.body.appendChild(m)
}
function submitForm(e,type,id){e.preventDefault();let o=Object.fromEntries(new FormData(e.target).entries());o.id=id||uid(type[0].toUpperCase());let key=type==="payment"?"fees":type==="user"?"users":type==="notice"?"notices":type+"s";let arr=data[key];let ix=arr.findIndex(x=>x.id===o.id);if(ix>=0)arr[ix]=o;else arr.push(o);save();e.target.closest(".modal").remove();render()}
function removeItem(type,id){if(!confirm("Delete this record?"))return;let key=type==="payment"?"fees":type==="user"?"users":type==="notice"?"notices":type+"s";data[key]=data[key].filter(x=>x.id!==id);save();render()}
function filterRows(){let q=(el("#search")?.value||"").toLowerCase();document.querySelectorAll("#rows tr").forEach(r=>r.style.display=r.innerText.toLowerCase().includes(q)?"":"none")}
function resetData(){if(confirm("This will delete all records saved on this browser. Continue?")){localStorage.removeItem(KEY);data=JSON.parse(JSON.stringify(defaultData));render()}}
function exportData(){let blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});let a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="kapnanda-school-data.json";a.click();URL.revokeObjectURL(a.href)}
el("#exportBtn").onclick=exportData;
el("#menu").onclick=()=>el(".sidebar").classList.toggle("open");
try {
  renderNav();
  render();
} catch (err) {
  console.error("Kapnanda startup error:", err);
  el("#content").innerHTML =
    '<div class="panel"><h3>Kapnanda could not finish loading</h3>' +
    '<p>Please refresh the page. If the problem continues, clear this site\'s stored data and reload.</p>' +
    '<button class="btn danger" onclick="resetData()">Clear local data and restart</button></div>';
}

/* Optional Supabase configuration.
   To make records shared across many computers, set these two values and
   replace the localStorage save/load layer with your database tables + RLS.
   This build intentionally does not create password authentication.
*/
window.KAPNANDA_SUPABASE={url:"",anonKey:""};
