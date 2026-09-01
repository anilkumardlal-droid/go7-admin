const API_BASE = "https://admin-api.go7.in";
let inquiries = [];
let currentId = null;
let apiPage = 1;
let apiTotal = 0;
const apiLimit = 50;
let authenticated = false;

function setAuthState(isAuthenticated){
  authenticated = isAuthenticated;
  document.body.classList.toggle("auth-loading", !isAuthenticated);
  document.getElementById("loginScreen").style.display = isAuthenticated ? "none" : "grid";
}

function showLogin(message=""){
  const box = document.getElementById("loginError");
  const otpWrap = document.getElementById("otpWrap");
  const otpInput = document.getElementById("loginOtp");

  box.textContent = message;
  box.classList.toggle("show", !!message);

  if(otpWrap){
    otpWrap.style.display = "none";
  }
  if(otpInput){
    otpInput.value = "";
    otpInput.required = false;
  }

  document.getElementById("loginScreen").style.display = "grid";
  document.body.classList.add("auth-loading");
  setTimeout(()=>document.getElementById("loginUsername")?.focus(),50);
}

function hideLogin(){
  document.getElementById("loginScreen").style.display = "none";
  document.body.classList.remove("auth-loading");
}

async function apiFetch(path, options={}){
  const opts = {...options, credentials:"include", cache:"no-store"};
  opts.headers = {"Accept":"application/json", ...(options.headers || {})};
  const res = await fetch(`${API_BASE}${path}`, opts);
  let data = {};
  try { data = await res.json(); } catch(e) {}
  if(res.status === 401){
    authenticated = false;
    showLogin("Your admin session has expired or is not available. Please sign in again.");
    throw new Error("Unauthorized");
  }
  if(!res.ok || data.success === false){
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

async function checkSession(){
  // Keep the dashboard hidden until the existing session is checked.
  document.body.classList.add("auth-loading");
  try{
    const data = await apiFetch("/api/session", {method:"GET"});
    if(data.authenticated){
      authenticated = true;
      hideLogin();
      await loadInquiries();
      return true;
    }
  }catch(error){
    if(error.message !== "Unauthorized") console.error("Session check:",error);
  }
  showLogin("");
  return false;
}

async function login(username,password){
  const submit = document.getElementById("loginSubmit");
  const errorBox = document.getElementById("loginError");
  const otpWrap = document.getElementById("otpWrap");
  const otpInput = document.getElementById("loginOtp");

  submit.disabled = true;
  submit.textContent = "Signing in…";
  errorBox.classList.remove("show");

  try{
    const otp = otpWrap && otpWrap.style.display !== "none"
      ? String(otpInput.value || "").replace(/\D/g,"").slice(0,6)
      : "";

    const data = await apiFetch("/api/login", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username,password,otp})
    });

    // First step: password accepted, OTP required.
    if(data.two_factor_required){
      otpWrap.style.display = "block";
      otpInput.required = true;
      submit.textContent = "Verify & Sign in";
      otpInput.focus();
      errorBox.textContent = "Enter your 6-digit authenticator code.";
      errorBox.classList.add("show");
      return;
    }

    if(!data.success){
      throw new Error(data.error || "Unable to login");
    }

    authenticated = true;
    hideLogin();
    apiPage = 1;
    await loadInquiries();
    toast("Login successful");

  }catch(error){
    console.error("Login:",error);
    errorBox.textContent =
      error.message === "Unauthorized"
        ? "Invalid username, password, or 2FA code."
        : (error.message || "Unable to login");
    errorBox.classList.add("show");

    // Keep OTP visible after a failed OTP attempt.
    if(otpWrap && otpWrap.style.display !== "none"){
      otpInput.focus();
      otpInput.select();
    }

  }finally{
    submit.disabled = false;

    const otpVisible =
      otpWrap && otpWrap.style.display !== "none";

    submit.textContent =
      otpVisible
        ? "Verify & Sign in"
        : "Sign in";
  }
}
async function logout(){
  const confirmed = await showConfirm("Log out?", "Your secure admin session will be ended.", "Log out", "logout");
  if(!confirmed) return;
  try{
    await apiFetch("/api/logout", {method:"POST"});
  }catch(error){
    console.warn("Logout:",error);
  }
  authenticated = false;
  inquiries = [];
  apiTotal = 0;
  renderTable();
  renderRecent();
  updateStats();
  showLogin("You have been logged out.");
  window.setTimeout(function(){
    showLogin("");
  }, 4500);
  toast("Logged out");
}

async function loadInquiries(){
  if(!authenticated) return;
  try{
    const data = await apiFetch(`/api/inquiries?page=${apiPage}&limit=${apiLimit}`, {method:"GET"});
    inquiries = (data.inquiries || []).map(normalizeInquiry);
    apiTotal = Number(data.total || 0);
    renderTable();
    renderRecent();
    updateStats();
    updateApiInfo();
    updatePageNumber();
  }catch(error){
    if(error.message !== "Unauthorized"){
      console.error("GO7 Admin API error:", error);
      toast(error.message || "Unable to load inquiries");
    }
  }finally{
  }
}

async function refreshDashboard(){
  if(!authenticated){
    await checkSession();
    return;
  }

  const btn = document.getElementById("refreshBtn");
  if(btn.dataset.refreshing === "1") return;

  btn.dataset.refreshing = "1";
  btn.disabled = true;
  btn.classList.add("refreshing");

  try{
    await loadInquiries();
    btn.classList.remove("is-error");
    btn.classList.add("is-success");
    toast("Dashboard refreshed successfully");
    setTimeout(()=>btn.classList.remove("is-success"),1200);
  }catch(error){
    btn.classList.remove("is-success");
    btn.classList.add("is-error");
    setTimeout(()=>btn.classList.remove("is-error"),1400);
    throw error;
  }finally{
    btn.classList.remove("refreshing");
    btn.disabled = false;
    btn.dataset.refreshing = "0";
  }
}

function normalizeInquiry(x){
  return {
    id:x.inquiry_id || x.id || "",
    name:x.name || "",
    email:x.email || "",
    subject:x.subject || "",
    message:x.message || "",
    date:formatDate(x.created_at),
    createdAt:x.created_at || x.createdAt || "",
    ip:x.ip || "",
    country:x.country || "",
    city:x.city || "",
    region:x.region || "",
    device:x.device || "",
    browser:x.browser || "",
    timezone:x.timezone || "",
    status:x.status || "New",
    admin_note:x.admin_note || "",
    source_domain:x.source_domain || "go7.in"
  };
}

function formatDate(value){
  if(!value) return "—";

  let raw = String(value).trim();

  // Cloudflare D1 CURRENT_TIMESTAMP is UTC
  // Convert SQL timestamp to an explicit UTC ISO timestamp.
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)){
    raw = raw.replace(" ", "T") + "Z";
  }

  const d = new Date(raw);

  if(Number.isNaN(d.getTime())) return String(value);

  return d.toLocaleString("en-IN", {
    day:"2-digit",
    month:"short",
    year:"numeric",
    hour:"numeric",
    minute:"2-digit",
    hour12:true,
    timeZone:"Asia/Kolkata"
  });
}

function updateApiInfo(){
  document.querySelectorAll("#apiConnectionStatus").forEach(el=>{
    el.textContent = `API connected • ${apiTotal} total inquiries`;
    el.style.color = "#16a34a";
  });
}

function escapeHtml(value){
  return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function escapeAttr(value){ return escapeHtml(value); }
function statusClass(s){
  return s==="New" ? "new" : (s==="In Progress" || s==="Read") ? "read" : s==="Replied" ? "replied" : "closed";
}
function statusLabel(s){
  return (s==="In Progress" || s==="Read") ? "Read" : s;
}
function statusMatches(actual, filter){
  if(filter==="all") return true;
  if(filter==="Read") return actual==="Read" || actual==="In Progress";
  return actual===filter;
}

function renderTable(){
  const search=document.getElementById("searchInput");
  const status=document.getElementById("statusFilter");
  const q=(search?.value || "").toLowerCase();
  const filter=status?.value || "all";
  const rows=inquiries.filter(x=>(statusMatches(x.status,filter))&&(`${x.name} ${x.email} ${x.subject} ${x.message} ${x.id}`.toLowerCase().includes(q)));
  document.getElementById("resultCount").textContent=`${rows.length} shown • ${apiTotal} total`;
  document.getElementById("inquiryTable").innerHTML=rows.map(x=>`
  <tr>
    <td><strong>${escapeHtml(x.name)}</strong><br><span style="font-size:11px;color:#94a3b8">${escapeHtml(x.email)}</span></td>
    <td style="max-width:220px"><strong>${escapeHtml(x.subject)}</strong></td>
    <td><strong>${escapeHtml(x.id)}</strong></td>
    <td style="white-space:nowrap">${escapeHtml(x.date)}</td>
    <td><span class="status ${statusClass(x.status)}">${escapeHtml(statusLabel(x.status))}</span></td>
    <td><div class="actions"><button class="small-btn view-inquiry" data-inquiry-id="${escapeAttr(x.id)}">View</button><button class="small-btn delete-inquiry" data-inquiry-id="${escapeAttr(x.id)}">Delete</button></div></td>
  </tr>`).join("") || `<tr><td colspan="6"><div class="empty">No inquiries found.</div></td></tr>`;
}

function renderRecent(){
  const list=document.getElementById("recentList");
  if(!inquiries.length){list.innerHTML='<div class="empty" style="padding:35px 10px">No inquiries found.</div>';return;}
  list.innerHTML=inquiries.slice(0,5).map(x=>`<div class="activity-row"><span class="activity-dot"></span><div><strong>${escapeHtml(x.name)} · ${escapeHtml(x.subject)}</strong><p>${escapeHtml(x.message.slice(0,72))}${x.message.length>72?'…':''}</p></div><span class="activity-time">${escapeHtml(x.date.split(",")[0])}</span></div>`).join("");
}


function renderAnalytics(){
  const totalEl=document.getElementById("analyticsTotal");
  const newEl=document.getElementById("analyticsNew");
  const responseEl=document.getElementById("analyticsResponse");
  const pageEl=document.getElementById("analyticsPage");
  const totalStatusEl=document.getElementById("analyticsStatusTotal");
  const barsEl=document.getElementById("inquiryTrendBars");
  const breakdownEl=document.getElementById("analyticsStatusBreakdown");

  if(!barsEl || !breakdownEl) return;

  if(totalEl) totalEl.textContent=apiTotal;
  if(newEl) newEl.textContent=inquiries.filter(x=>x.status==="New").length;
  if(responseEl){
    responseEl.textContent=inquiries.length
      ? Math.round(inquiries.filter(x=>x.status==="Replied").length/inquiries.length*100)+"%"
      : "—";
  }
  if(pageEl) pageEl.textContent=apiPage;

  const now=new Date();
  const days=[];
  for(let i=6;i>=0;i--){
    const d=new Date(now);
    d.setHours(0,0,0,0);
    d.setDate(d.getDate()-i);
    days.push(d);
  }

  const counts=days.map(day=>{
    const next=new Date(day);
    next.setDate(next.getDate()+1);
    return inquiries.filter(x=>{
      const raw=x.createdAt || x.date;
      const d=new Date(raw);
      return !Number.isNaN(d.getTime()) && d>=day && d<next;
    }).length;
  });
  const maxCount=Math.max(...counts,1);

  barsEl.innerHTML=days.map((day,i)=>{
    const label=day.toLocaleDateString("en-IN",{weekday:"short"});
    const value=counts[i];
    const height=value ? Math.max(7,(value/maxCount)*100) : 2;
    return `<div class="trend-bar-item">
      <span class="trend-value">${value}</span>
      <div class="trend-bar-track">
        <span class="trend-bar" style="--bar-height:${height}%"></span>
      </div>
      <span class="trend-day">${label}</span>
    </div>`;
  }).join("");

  const statuses=[
    ["New","new"],
    ["Read","read"],
    ["Replied","replied"],
    ["Closed","closed"]
  ];
  const loaded=inquiries.length;
  if(totalStatusEl) totalStatusEl.textContent=`${loaded} loaded`;

  breakdownEl.innerHTML=statuses.map(([label,key])=>{
    const count=inquiries.filter(x=>statusMatches(x.status,label)).length;
    const percent=loaded ? Math.round(count/loaded*100) : 0;
    return `<div class="analytics-status-row">
      <div class="analytics-status-top">
        <span class="analytics-status-name">${label}</span>
        <span class="analytics-status-count">${count}</span>
      </div>
      <div class="analytics-progress"><span style="--progress:${percent}%"></span></div>
    </div>`;
  }).join("");
}

function updateStats(){
  const total=apiTotal;
  const n=inquiries.filter(x=>x.status==="New").length;
  const p=inquiries.filter(x=>x.status==="In Progress").length;
  const r=inquiries.filter(x=>x.status==="Replied").length;
  document.getElementById("totalStat").textContent=total;
  document.getElementById("newStat").textContent=n;
  document.getElementById("progressStat").textContent=p;
  document.getElementById("repliedStat").textContent=r;
  renderAnalytics();
}
function updatePageNumber(){const el=document.getElementById("pageNumber");if(el)el.textContent=apiPage;}
async function prevPage(){if(apiPage<=1)return;apiPage--;await loadInquiries();}
async function nextPage(){if(apiPage*apiLimit>=apiTotal)return;apiPage++;await loadInquiries();}

function showPage(page){
  document.body.classList.remove("inquiry-page-open");
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.getElementById(page).classList.add("active");
  document.querySelectorAll(".nav button[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  const names={dashboard:"Dashboard",inquiries:"Inquiries",analytics:"Analytics",settings:"Settings"};
  document.getElementById("pageTitle").textContent=names[page];
  document.getElementById("sidebar").classList.remove("open");
  window.scrollTo({top:0,behavior:"smooth"});
}

function openInquiry(id){
  const x=inquiries.find(i=>String(i.id)===String(id));
  if(!x)return;
  currentId=x.id;
  document.getElementById("drawerTitle").textContent=x.name||"Inquiry";

function detailIcon(label){
  const icons = {
    "Name": `<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>`,
    "Email": `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>`,
    "Subject": `<path d="M4 5h16v12H7l-3 3V5Z"/><path d="M8 9h8M8 12h5"/>`,
    "Inquiry ID": `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>`,
    "Date & Time": `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
    "IP Address": `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>`,
    "Country": `<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>`,
    "City": `<path d="M4 21V9l6-4v16M10 21h10V12l-10-3M7 12h1M7 16h1M13 15h1M17 15h1M13 18h1M17 18h1"/>`,
    "Region": `<path d="M4 6h6l2 3h8v9H4z"/><path d="M4 6V4h6l2 3"/>`,
    "Device": `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M10 18h4"/>`,
    "Browser": `<circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M12 3c2.2 2.5 3.2 5.5 3.2 9S14.2 18.5 12 21M3.5 15h17"/>`,
    "Timezone": `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
    "Environment": `<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>`,
    "API": `<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/><circle cx="12" cy="12" r="3"/>`,
    "Database": `<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/>`,
  };
  const path = icons[label] || `<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}

  document.getElementById("drawerSubtitle").textContent=`Inquiry #${x.id} · ${x.date}`;
  document.getElementById("drawerBody").innerHTML=`
    
    <div class="detail-row"><span class="detail-label">${detailIcon("Name")}Name</span><strong>${escapeHtml(x.name)}</strong></div>
    <div class="detail-row"><span class="detail-label">${detailIcon("Email")}Email</span><strong>${escapeHtml(x.email)}</strong></div>
    <div class="detail-row"><span class="detail-label">${detailIcon("Subject")}Subject</span><strong>${escapeHtml(x.subject)}</strong></div>
    <div class="detail-row"><span class="detail-label">${detailIcon("Inquiry ID")}Inquiry ID</span><strong>${escapeHtml(x.id)}</strong></div>
    <div class="detail-row"><span class="detail-label">${detailIcon("Environment")}Source Domain</span><strong>${escapeHtml(x.source_domain)}</strong></div>
    <div class="detail-row"><span class="detail-label">${detailIcon("Date & Time")}Date & Time</span><span>${escapeHtml(x.date)}</span></div>
    <div class="detail-row"><span class="detail-label">${detailIcon("IP Address")}IP Address</span><strong>${escapeHtml(x.ip)}</strong></div>
    <div class="detail-row"><span class="detail-label">${detailIcon("Country")}Country</span><span>${escapeHtml(x.country)}</span></div>
    <div class="detail-row"><span class="detail-label">${detailIcon("City")}City</span><span>${escapeHtml(x.city)}</span></div>
    <div class="detail-row"><span class="detail-label">${detailIcon("Region")}Region</span><span>${escapeHtml(x.region)}</span></div>
    <div class="detail-row"><span class="detail-label">${detailIcon("Device")}Device</span><span>${escapeHtml(x.device)}</span></div>
    <div class="detail-row"><span class="detail-label">${detailIcon("Browser")}Browser</span><span>${escapeHtml(x.browser)}</span></div>
    <div class="detail-row"><span class="detail-label">${detailIcon("Timezone")}Timezone</span><span>${escapeHtml(x.timezone)}</span></div>
    <div class="form-group message-group"><label>Message</label><div class="message-box">${escapeHtml(x.message)}</div></div>
    <div class="form-group"><label>Internal note</label><textarea class="form-control" id="drawerNote" placeholder="Add a private note...">${escapeHtml(x.admin_note)}</textarea><div class="field-hint">Private admin note. Stored securely in Cloudflare D1.</div></div>
    <div class="reply-box">
      <div class="form-group">
        <label>Reply to customer</label>
        <input class="form-control" id="replySubject" type="text" value="${escapeAttr(x.subject ? `Re: ${x.subject}` : "Regarding your GO7.IN inquiry")}" placeholder="Email subject">
      </div>
      <div class="form-group">
        <textarea class="form-control" id="replyMessage" placeholder="Write your reply to the customer..."></textarea>
        <div class="reply-hint">Reply will be sent from info@go7.in. After a successful send, status becomes Replied.</div>
      </div>
      <div class="reply-actions">
        <button class="primary" id="sendReplyBtn" onclick="sendCustomerReply()">Reply</button>
      </div>
    </div>`;
  document.body.classList.add("inquiry-page-open");
  document.getElementById("pageTitle").textContent = "Customer Inquiry";
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.getElementById("inquiryView").classList.add("active");
  document.querySelectorAll(".nav button[data-page]").forEach(b=>b.classList.remove("active"));
  document.getElementById("sidebar").classList.remove("open");
  window.scrollTo({top:0,behavior:"smooth"});
}
async function saveInquiryChanges(){
  if(!authenticated || !currentId){
    showLogin();
    return;
  }

  const x = inquiries.find(i => String(i.id) === String(currentId));
  if(!x) return;

  const statusEl = document.getElementById("drawerStatus");
  const noteEl = document.getElementById("drawerNote");
  const saveBtn = document.getElementById("saveInquiryBtn");

  const status = statusEl ? statusEl.value : x.status;
  const admin_note = noteEl ? noteEl.value : (x.admin_note || "");

  if(saveBtn){
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
  }

  try{
    const data = await apiFetch(
      `/api/inquiries/${encodeURIComponent(String(currentId))}`,
      {
        method:"PATCH",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({status,admin_note})
      }
    );

    x.status = data.inquiry?.status ?? status;
    x.admin_note = data.inquiry?.admin_note ?? admin_note;

    renderTable();
    renderRecent();
    updateStats();
    closeDrawer();
    toast("Inquiry updated successfully");
  }catch(error){
    if(error.message !== "Unauthorized"){
      console.error("Save inquiry:",error);
      toast(error.message || "Unable to save inquiry");
    }
  }finally{
    if(saveBtn){
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  }
}

async function changeStatus(){
  await saveInquiryChanges();
}

async function markCurrentReplied(){
  const statusEl = document.getElementById("drawerStatus");
  if(statusEl) statusEl.value = "Replied";
  await saveInquiryChanges();
}

async function sendCustomerReply(){
  if(!authenticated || !currentId){
    showLogin();
    return;
  }

  const subjectEl = document.getElementById("replySubject");
  const messageEl = document.getElementById("replyMessage");
  const sendBtn = document.getElementById("sendReplyBtn");

  const subject = subjectEl ? subjectEl.value.trim() : "";
  const message = messageEl ? messageEl.value.trim() : "";

  if(!message){
    toast("Write a reply first");
    messageEl?.focus();
    return;
  }

  if(sendBtn){
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
  }

  try{
    const data = await apiFetch(
      `/api/inquiries/${encodeURIComponent(String(currentId))}/reply`,
      {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({subject, message})
      }
    );

    const x = inquiries.find(i => String(i.id) === String(currentId));
    if(x) x.status = data.inquiry?.status || "Replied";

    renderTable();
    renderRecent();
    updateStats();

    if(messageEl) messageEl.value = "";

    toast("Reply sent successfully");
  }catch(error){
    if(error.message !== "Unauthorized"){
      console.error("Reply:", error);
      toast(error.message || "Unable to send reply");
    }
  }finally{
    if(sendBtn){
      sendBtn.disabled = false;
      sendBtn.textContent = "Reply";
    }
  }
}

async function deleteCurrentInquiry(){
  if(!authenticated || !currentId){
    showLogin();
    return;
  }

  const x = inquiries.find(i => String(i.id) === String(currentId));
  const customer = x?.name ? ` for ${x.name}` : "";

  const confirmed = await showConfirm(
    "Delete inquiry?",
    `Delete this inquiry${customer} permanently? This action cannot be undone.`,
    "Delete",
    "danger"
  );
  if(!confirmed) return;

  const deleteBtn = document.getElementById("deleteInquiryBtn");

  if(deleteBtn){
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Deleting…";
  }

  try{
    await apiFetch(
      `/api/inquiries/${encodeURIComponent(String(currentId))}`,
      {method:"DELETE"}
    );

    inquiries = inquiries.filter(
      i => String(i.id) !== String(currentId)
    );

    apiTotal = Math.max(0, apiTotal - 1);

    currentId = null;
    renderTable();
    renderRecent();
    updateStats();
    closeDrawer();

    toast("Inquiry deleted permanently");
  }catch(error){
    if(error.message !== "Unauthorized"){
      console.error("Delete inquiry:", error);
      toast(error.message || "Unable to delete inquiry");
    }
  }finally{
    if(deleteBtn){
      deleteBtn.disabled = false;
      deleteBtn.textContent = "Delete";
    }
  }
}

function closeDrawer(){
  document.body.classList.remove("inquiry-page-open");
  document.getElementById("overlay")?.classList.remove("show");
  document.getElementById("drawer")?.classList.remove("show");
  if(document.getElementById("inquiries")){
    showPage("inquiries");
  }
}
function toast(msg){
  const t=document.getElementById("toast");
  if(!t) return;
  t.textContent=msg;
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(window._toast);
  window._toast=setTimeout(()=>{
    t.classList.remove("show");
  },2400);
}

function exportCSV(){
  if(!authenticated){showLogin();return;}
  const header=["Inquiry ID","Name","Email","Subject","Source Domain","Date & Time","IP Address","Country","City","Region","Device","Browser","Timezone","Message","Status","Admin Note"];
  const lines=[header,...inquiries.map(x=>[x.id,x.name,x.email,x.subject,x.source_domain,x.date,x.ip,x.country,x.city,x.region,x.device,x.browser,x.timezone,x.message,x.status,x.admin_note])].map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n");
  const blob=new Blob([lines],{type:"text/csv;charset=utf-8;"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="go7-inquiries.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast("CSV exported");
}

document.getElementById("loginForm").addEventListener("submit", e => {
  e.preventDefault();
  login(
    document.getElementById("loginUsername").value.trim(),
    document.getElementById("loginPassword").value
  );
});
document.querySelectorAll(".nav button[data-page]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
document.getElementById("inquiryTable").addEventListener("click",event=>{
  const viewBtn = event.target.closest(".view-inquiry");
  if(viewBtn){
    openInquiry(viewBtn.dataset.inquiryId);
    return;
  }

  const deleteBtn = event.target.closest(".delete-inquiry");
  if(deleteBtn){
    const id = deleteBtn.dataset.inquiryId;
    currentId = id;
    deleteCurrentInquiry();
  }
});
document.getElementById("drawerBody").addEventListener("change",event=>{ /* changes are saved with Save */ });
document.getElementById("searchInput").addEventListener("input",renderTable);
document.getElementById("statusFilter").addEventListener("change",renderTable);

document.getElementById("mobileMenu").addEventListener("click",()=>document.getElementById("sidebar").classList.toggle("open"));
document.getElementById("refreshBtn").addEventListener("click",refreshDashboard);

function showConfirm(title,message,confirmText="Confirm",variant="info"){
  return new Promise(resolve=>{
    const back=document.getElementById("go7ModalBackdrop");
    const titleEl=document.getElementById("go7ModalTitle");
    const msgEl=document.getElementById("go7ModalMessage");
    const yes=document.getElementById("go7ModalConfirm");
    const no=document.getElementById("go7ModalCancel");
    back.dataset.variant = variant;
    titleEl.textContent=title;
    msgEl.textContent=message;
    yes.textContent=confirmText;
    yes.className = variant==="danger" ? "danger-btn" : variant==="logout" ? "warning-btn" : "primary";
    back.classList.add("show");
    back.setAttribute("aria-hidden","false");
    const finish=v=>{
      back.classList.remove("show");
      back.setAttribute("aria-hidden","true");
      back.removeAttribute("data-variant");
      yes.onclick=no.onclick=null;
      resolve(v);
    };
    yes.onclick=()=>finish(true);
    no.onclick=()=>finish(false);
  });
}
function showNotifications(){
  const btn=document.getElementById("notificationBtn");
  const count=inquiries.filter(x=>x.status==="New").length;
  if(btn){
    btn.classList.toggle("has-new",count>0);
    btn.classList.add("is-read");
    setTimeout(()=>btn.classList.remove("is-read"),900);
  }
  toast(count ? `${count} new ${count===1?"inquiry":"inquiries"} need your attention` : "No new notifications");
}
document.getElementById("notificationBtn").addEventListener("click",showNotifications);

document.getElementById("logoutBtn").addEventListener("click",logout);
document.getElementById("go7ModalBackdrop")?.addEventListener("click",e=>{
  if(e.target.id==="go7ModalBackdrop") document.getElementById("go7ModalCancel")?.click();
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    if(document.getElementById("go7ModalBackdrop")?.classList.contains("show")) document.getElementById("go7ModalCancel")?.click();
    else closeDrawer();
  }
});

renderTable();
renderRecent();
updateStats();
checkSession();

(function(){
  const root=document.documentElement;
  const key="go7-admin-theme";
  const toggle=document.getElementById("themeToggle");
  const icon=document.getElementById("themeToggleIcon");

  function setTheme(theme){
    const dark=theme==="dark";
    root.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem(key, theme);
    if(toggle){
      toggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      toggle.setAttribute("title", dark ? "Light mode" : "Dark mode");
    }
    if(icon){
      icon.innerHTML=dark
        ? '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.7 6.7 0 0 0 21 12.8Z"></path>'
        : '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path>';
    }
  }

  const saved=localStorage.getItem(key);
  setTheme(saved==="dark" ? "dark" : "light");

  if(toggle){
    toggle.addEventListener("click",function(){
      setTheme(root.getAttribute("data-theme")==="dark" ? "light" : "dark");
    });
  }
})();
