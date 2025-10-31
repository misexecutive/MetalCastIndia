/* Attendance + OT Frontend (Plain JS)
   Hinglish UX labels where appropriate
*/

const API_BASE = 'https://script.google.com/macros/s/AKfycbzF8QztIfP10depI87HY04T4arUaaYkF7FXkYb7AvZynpnUtmo09VuKIR-JvYkmWpp0/exec'; // <-- UPDATE (Apps Script Web App URL)

/* ---------- State ---------- */
const state = {
  serverTime: null,
  configRaw: [],
  employees: [],
  filteredEmployees: [],
  selectedEmployeeId: null,
  selectedEmployeeName: null,
  workStart: '09:00',
  workEnd: '17:00',
  overtimeRatePerHour: 0,
  month: getYYYYMM(new Date()),
  attendanceRows: [], // for selected month (+ employee or all)
  overview: [],       // salary summary for selected employee
};

/* ---------- DOM ---------- */
const el = {
  serverTime: () => document.getElementById('serverTime'),
  monthPicker: () => document.getElementById('monthPicker'),
  btnPrev: () => document.getElementById('btnPrev'),
  btnNext: () => document.getElementById('btnNext'),
  btnRefresh: () => document.getElementById('btnRefresh'),
  employeeSelect: () => document.getElementById('employeeSelect'),
  employeeSearch: () => document.getElementById('employeeSearch'),
  employeeList: () => document.getElementById('employeeList'),
  selectedEmpName: () => document.getElementById('selectedEmpName'),
  selectedEmpId: () => document.getElementById('selectedEmpId'),
  workWindow: () => document.getElementById('workWindow'),
  attendanceTableWrap: () => document.getElementById('attendanceTableWrap'),
  overviewTableWrap: () => document.getElementById('overviewTableWrap'),
  salaryCard: () => document.getElementById('salaryCard'),
  btnGenerateLedger: () => document.getElementById('btnGenerateLedger'),
  histMonth: () => document.getElementById('histMonth'),
  histEmployee: () => document.getElementById('histEmployee'),
  btnHistLoad: () => document.getElementById('btnHistLoad'),
  histTableWrap: () => document.getElementById('histTableWrap'),
  histSalaryWrap: () => document.getElementById('histSalaryWrap'),
  configTableWrap: () => document.getElementById('configTableWrap'),
  tabs: () => document.querySelectorAll('.tab'),
  panels: () => document.querySelectorAll('.tab-panel'),
  toast: () => document.getElementById('toast'),
  loader: () => document.getElementById('loader'),
};

/* ---------- Init ---------- */
window.addEventListener('DOMContentLoaded', async () => {
  wireTabs();
  wireControls();
  await loadInit();
  setMonthPicker(state.month);
  await refreshAll();
});

/* ---------- Wiring ---------- */
function wireTabs(){
  el.tabs().forEach(btn => {
    btn.addEventListener('click', () => {
      el.tabs().forEach(b => b.classList.remove('active'));
      el.panels().forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      // On tab switch, optionally refresh specific data
      if (btn.dataset.tab === 'overview') loadOverview();
      if (btn.dataset.tab === 'config') renderConfigTable();
    });
  });
}

function wireControls(){
  el.btnPrev().addEventListener('click', async () => {
    state.month = shiftMonth(state.month, -1);
    setMonthPicker(state.month);
    await refreshAll();
  });
  el.btnNext().addEventListener('click', async () => {
    state.month = shiftMonth(state.month, +1);
    setMonthPicker(state.month);
    await refreshAll();
  });
  el.btnRefresh().addEventListener('click', refreshAll);

  el.monthPicker().addEventListener('change', async (e) => {
    state.month = e.target.value || state.month;
    await refreshAll();
  });

  el.employeeSearch().addEventListener('input', () => {
    const q = el.employeeSearch().value.toLowerCase().trim();
    state.filteredEmployees = state.employees.filter(emp =>
      emp.employeeName.toLowerCase().includes(q) || emp.employeeId.toLowerCase().includes(q)
    );
    renderEmployeeList();
  });

  el.employeeSelect().addEventListener('change', async (e) => {
    const id = e.target.value;
    selectEmployee(id);
    await loadMonthAttendance();
    await loadOverview();
  });

  el.btnGenerateLedger().addEventListener('click', async () => {
    if (!confirm('Current month ka Salary Ledger generate/update karna hai?')) return;
    showLoader(true);
    try {
      const res = await apiPOST({ action:'generateMonthlySalary', month: state.month });
      toast('Salary Ledger updated ✅');
      console.log(res);
    } catch (err) {
      toast('Ledger error: ' + err.message, true);
    } finally { showLoader(false); }
  });

  el.btnHistLoad().addEventListener('click', async () => {
    await loadHistorical();
  });

  // Historical pickers default
  el.histMonth().value = state.month;
}

/* ---------- API Client ---------- */
async function apiGET(params){
  const qs = new URLSearchParams(params);
  const url = `${API_BASE}?${qs.toString()}`;
  const res = await fetch(url, { method:'GET' });
  const j = await res.json();
  if (j.status !== 'success') throw new Error(j.message || 'API error');
  return j.data;
}
async function apiPOST(body){
  const res = await fetch(API_BASE, {
    method:'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
}

/* ---------- Loaders ---------- */
async function loadInit(){
  showLoader(true);
  try {
    const data = await apiGET({ action:'getInit' });
    state.serverTime = data.serverTime;
    state.configRaw = data.configRaw || [];
    state.employees = data.employees || [];
    state.filteredEmployees = state.employees.slice();

    el.serverTime().textContent = state.serverTime || '—';
    renderEmployeeSelect();
    renderEmployeeList();

    // Select first employee by default (active)
    if (state.employees.length){
      selectEmployee(state.employees[0].employeeId);
    }
  } catch (err) {
    toast('Init error: ' + err.message, true);
  } finally { showLoader(false); }
}

async function refreshAll(){
  await loadMonthAttendance();
  await loadOverview();
  renderConfigTable();
}

/* ---------- Employee selection ---------- */
function selectEmployee(employeeId){
  const emp = state.employees.find(e => e.employeeId === employeeId);
  if (!emp) return;
  state.selectedEmployeeId = emp.employeeId;
  state.selectedEmployeeName = emp.employeeName;
  state.workStart = emp.workStart || '09:00';
  state.workEnd = emp.workEnd || '17:00';
  state.overtimeRatePerHour = Number(emp.overtimeRatePerHour || 0);

  el.selectedEmpName().textContent = emp.employeeName;
  el.selectedEmpId().textContent = emp.employeeId;
  el.workWindow().textContent = `Work Hours: ${state.workStart} – ${state.workEnd}`;
  // Update selects highlight
  renderEmployeeList();
  renderEmployeeSelect();
}

/* ---------- Rendering: Employee list & select ---------- */
function renderEmployeeSelect(){
  const sel = el.employeeSelect();
  const prev = sel.value;
  sel.innerHTML = '';
  state.filteredEmployees.forEach(emp => {
    const opt = document.createElement('option');
    opt.value = emp.employeeId;
    opt.textContent = `${emp.employeeName} (${emp.employeeId})`;
    sel.appendChild(opt);
  });
  const chosen = state.selectedEmployeeId || (state.filteredEmployees[0] && state.filteredEmployees[0].employeeId);
  sel.value = chosen || '';
}

function renderEmployeeList(){
  const ul = el.employeeList();
  ul.innerHTML = '';
  state.filteredEmployees.forEach(emp => {
    const li = document.createElement('li');
    if (emp.employeeId === state.selectedEmployeeId) li.classList.add('active');
    const left = document.createElement('div');
    left.innerHTML = `<strong>${emp.employeeName}</strong><br/><small>${emp.employeeId}</small>`;
    const right = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'btn ghost';
    btn.textContent = 'Select';
    btn.addEventListener('click', async () => {
      selectEmployee(emp.employeeId);
      await loadMonthAttendance();
      await loadOverview();
    });
    right.appendChild(btn);
    li.append(left, right);
    ul.appendChild(li);
  });
}

/* ---------- Attendance Table ---------- */
async function loadMonthAttendance(){
  if (!state.selectedEmployeeId) return;
  showLoader(true);
  try {
    const data = await apiGET({ action:'getMonthAttendance', month: state.month, employeeId: state.selectedEmployeeId });
    state.attendanceRows = data || [];
    renderAttendanceTable();
  } catch (err) {
    toast('Attendance load error: ' + err.message, true);
  } finally { showLoader(false); }
}

function renderAttendanceTable(){
  const wrap = el.attendanceTableWrap();
  const days = getDaysOfMonth(state.month);
  const map = new Map();
  state.attendanceRows.forEach(r => map.set(r.date, r));

  let html = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>In-Time</th>
          <th>Save</th>
          <th>Out-Time</th>
          <th>Save</th>
          <th>Work</th>
          <th>OT</th>
          <th>Notes</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
  `;
  days.forEach(d => {
    const dstr = d;
    const row = map.get(dstr);
    const inTime = row?.inTime || '';
    const outTime = row?.outTime || '';
    const work = row ? minutesToHHmm(row.workMinutes) : '00:00';
    const ot = row ? minutesToHHmm(row.overtimeMinutes) : '00:00';
    const ok = (inTime && outTime);

    html += `
      <tr data-date="${dstr}">
        <td><strong>${dstr}</strong></td>

        <td><input class="input-time" type="time" value="${inTime}" aria-label="In Time"></td>
        <td class="action-cells">
          <button class="tick" data-act="save-in" title="Save In-Time">✔</button>
        </td>

        <td><input class="input-time" type="time" value="${outTime}" aria-label="Out Time"></td>
        <td class="action-cells">
          <button class="tick" data-act="save-out" title="Save Out-Time">✔</button>
        </td>

        <td><span class="badge ${work!=='00:00'?'green':''}">${work}</span></td>
        <td><span class="badge ${ot!=='00:00'?'red':''}">${ot}</span></td>

        <td><input type="text" placeholder="Optional note" value="${row?.notes||''}" style="min-width:180px"/></td>
        <td><span class="status-dot ${ok?'ok':''}" title="${ok?'Complete':'Pending'}"></span></td>
      </tr>
    `;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  // attach button handlers
  wrap.querySelectorAll('button.tick').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const date = tr.dataset.date;
      const inputs = tr.querySelectorAll('input');
      const inInput = inputs[0];
      const outInput = inputs[1];
      const noteInput = inputs[2];
      const notes = (noteInput && noteInput.value || '').trim();

      const act = btn.dataset.act;
      try {
        if (act === 'save-in') {
          const t = (inInput.value || '').trim();
          if (!isValidHHmm(t)) return toast('Invalid In-Time. Format HH:mm', true);
          await saveIn(date, state.selectedEmployeeId, t, notes);
        } else {
          const t = (outInput.value || '').trim();
          if (!isValidHHmm(t)) return toast('Invalid Out-Time. Format HH:mm', true);
          await saveOut(date, state.selectedEmployeeId, t, notes);
        }
        await loadMonthAttendance(); // refresh row values
        toast('Saved ✅');
      } catch (err) {
        toast('Save error: ' + err.message, true);
      }
    });
  });
}

/* ---------- Overview & Salary ---------- */
async function loadOverview(){
  if (!state.selectedEmployeeId) return;
  showLoader(true);
  try {
    const data = await apiGET({ action:'getSalarySummary', month: state.month, employeeId: state.selectedEmployeeId });
    state.overview = data || [];
    renderOverview();
  } catch (err) {
    toast('Overview error: ' + err.message, true);
  } finally { showLoader(false); }
}

function renderOverview(){
  const list = state.overview;
  const wrap = el.overviewTableWrap();
  wrap.innerHTML = '';

  if (!list.length){
    wrap.innerHTML = '<p>No data…</p>';
    el.salaryCard().innerHTML = '';
    return;
  }
  const card = list[0]; // single employee summary when employeeId specified
  const days = card.days || [];

  // Table
  let html = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>In</th>
          <th>Out</th>
          <th>Work</th>
          <th>OT</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
  `;
  days.sort((a,b)=> a.date.localeCompare(b.date)).forEach(r => {
    html += `
      <tr>
        <td>${r.date}</td>
        <td>${r.inTime||''}</td>
        <td>${r.outTime||''}</td>
        <td>${minutesToHHmm(r.workMinutes)}</td>
        <td>${minutesToHHmm(r.overtimeMinutes)}</td>
        <td>${r.notes||''}</td>
      </tr>
    `;
  });
  html += `
      <tr>
        <td><strong>Totals</strong></td>
        <td></td><td></td>
        <td><strong>${minutesToHHmm(card.totalWorkMinutes)}</strong></td>
        <td><strong>${minutesToHHmm(card.totalOvertimeMinutes)}</strong></td>
        <td></td>
      </tr>
    </tbody>
    </table>
  `;
  wrap.innerHTML = html;

  // Salary card
  const base = money(card.baseSalary);
  const otHours = (card.totalOvertimeMinutes/60).toFixed(2);
  const rate = money(card.overtimeRatePerHour);
  const otPay = money(card.overtimePay);
  const payable = money(card.payableSalary);

  el.salaryCard().innerHTML = `
    <div class="salary-line"><span>Employee</span><strong>${card.employeeName} (${card.employeeId})</strong></div>
    <div class="salary-line"><span>Month</span><strong>${state.month}</strong></div>
    <hr/>
    <div class="salary-line"><span>Base Salary</span><strong>${base}</strong></div>
    <div class="salary-line"><span>Overtime Hours</span><strong>${otHours} h</strong></div>
    <div class="salary-line"><span>OT Rate</span><strong>${rate}/h</strong></div>
    <div class="salary-line"><span>Overtime Pay</span><strong>${otPay}</strong></div>
    <hr/>
    <div class="salary-line"><span>Payable Salary</span><strong>${payable}</strong></div>
  `;
}

/* ---------- Historical ---------- */
async function loadHistorical(){
  const month = el.histMonth().value || state.month;
  const empId = el.histEmployee().value || state.selectedEmployeeId || '';
  showLoader(true);
  try {
    const data = await apiGET({ action:'getHistorical', month, employeeId: empId });
    // Attendance table
    const rows = (data.attendance || []).sort((a,b)=> a.date.localeCompare(b.date));
    let html = `
      <table>
        <thead><tr>
          <th>Date</th><th>EmpID</th><th>In</th><th>Out</th><th>Work</th><th>OT</th><th>Notes</th>
        </tr></thead><tbody>
    `;
    rows.forEach(r => {
      html += `<tr>
        <td>${r.date}</td><td>${r.employeeId}</td>
        <td>${r.inTime||''}</td><td>${r.outTime||''}</td>
        <td>${minutesToHHmm(r.workMinutes)}</td><td>${minutesToHHmm(r.overtimeMinutes)}</td>
        <td>${r.notes||''}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
    el.histTableWrap().innerHTML = html;

    // Salary summary
    const list = data.summary || [];
    let s = '';
    list.forEach(card => {
      s += `
        <div class="card mt">
          <div class="salary-line"><span>Employee</span><strong>${card.employeeName} (${card.employeeId})</strong></div>
          <div class="salary-line"><span>Month</span><strong>${month}</strong></div>
          <div class="salary-line"><span>Work</span><strong>${minutesToHHmm(card.totalWorkMinutes)}</strong></div>
          <div class="salary-line"><span>OT</span><strong>${minutesToHHmm(card.totalOvertimeMinutes)}</strong></div>
          <div class="salary-line"><span>Base</span><strong>${money(card.baseSalary)}</strong></div>
          <div class="salary-line"><span>OT Pay</span><strong>${money(card.overtimePay)}</strong></div>
          <div class="salary-line"><span>Payable</span><strong>${money(card.payableSalary)}</strong></div>
        </div>
      `;
    });
    el.histSalaryWrap().innerHTML = s || '<p>No summary.</p>';
  } catch (err) {
    toast('Historical error: ' + err.message, true);
  } finally { showLoader(false); }
}

/* ---------- Config table (read-only) ---------- */
function renderConfigTable(){
  const wrap = el.configTableWrap();
  const rows = state.configRaw || [];
  let html = `
    <table>
      <thead><tr>
        <th>EmployeeID</th><th>EmployeeName</th><th>MonthlySalary</th>
        <th>WorkStart</th><th>WorkEnd</th><th>OT Rate/h</th><th>IsActive</th>
      </tr></thead><tbody>
  `;
  rows.forEach(r => {
    html += `<tr>
      <td>${r.EmployeeID}</td><td>${r.EmployeeName}</td><td>${money(r.MonthlySalary)}</td>
      <td>${r.WorkStart}</td><td>${r.WorkEnd}</td><td>${money(r.OvertimeRatePerHour)}</td><td>${r.IsActive ? 'TRUE':'FALSE'}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  // Also populate historical employee selector
  const sel = el.histEmployee();
  sel.innerHTML = '';
  const optAny = document.createElement('option');
  optAny.value = '';
  optAny.textContent = 'All Employees';
  sel.appendChild(optAny);
  rows.filter(r=>r.IsActive).forEach(r => {
    const o = document.createElement('option');
    o.value = r.EmployeeID;
    o.textContent = `${r.EmployeeName} (${r.EmployeeID})`;
    sel.appendChild(o);
  });
}

/* ---------- Save helpers ---------- */
async function saveIn(date, employeeId, inTime, notes){
  return apiPOST({ action:'saveInTime', date, employeeId, inTime, notes, recordedBy:'admin' });
}
async function saveOut(date, employeeId, outTime, notes){
  return apiPOST({ action:'saveOutTime', date, employeeId, outTime, notes, recordedBy:'admin' });
}

/* ---------- Utilities ---------- */
function toast(msg, isError=false){
  const t = el.toast();
  t.textContent = msg;
  t.style.background = isError ? '#b91c1c' : '#0f2544';
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}
function showLoader(v){ el.loader().classList.toggle('hidden', !v); }

function getYYYYMM(d){
  const year = d.getFullYear();
  const month = (d.getMonth()+1).toString().padStart(2,'0');
  return `${year}-${month}`;
}
function setMonthPicker(yyyyMM){ el.monthPicker().value = yyyyMM; }
function shiftMonth(yyyyMM, delta){
  const [y,m]=yyyyMM.split('-').map(Number);
  const d = new Date(y, m-1+delta, 1);
  return getYYYYMM(d);
}
function getDaysOfMonth(yyyyMM){
  const [y,m]=yyyyMM.split('-').map(Number);
  const first = new Date(y, m-1, 1);
  const next = new Date(y, m, 1);
  const out = [];
  for(let d = new Date(first); d < next; d.setDate(d.getDate()+1)){
    out.push(formatDate(d));
  }
  return out;
}
function formatDate(d){
  const y = d.getFullYear();
  const m = (d.getMonth()+1).toString().padStart(2,'0');
  const day = d.getDate().toString().padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function minutesToHHmm(mins){
  const m = Math.max(0, Math.floor(mins||0));
  const hh = Math.floor(m/60).toString().padStart(2,'0');
  const mm = (m%60).toString().padStart(2,'0');
  return `${hh}:${mm}`;
}
function isValidHHmm(s){
  return /^\d{2}:\d{2}$/.test(s);
}
function money(n){
  const v = Number(n||0);
  return '₹ ' + v.toFixed(2);
}
