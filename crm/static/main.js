const API = '';
let customers = [];

// --- DOM refs ---
const grid = document.getElementById('customerGrid');
const summary = document.getElementById('summary');
const overlay = document.getElementById('overlay');
const sidePanel = document.getElementById('sidePanel');
const panelTitle = document.getElementById('panelTitle');
const form = document.getElementById('customerForm');
const editId = document.getElementById('editId');
const fName = document.getElementById('fName');
const fCompany = document.getElementById('fCompany');
const fContact = document.getElementById('fContact');
const fAssignee = document.getElementById('fAssignee');
const fGenre = document.getElementById('fGenre');
const fNextDate = document.getElementById('fNextDate');
const fNotes = document.getElementById('fNotes');
const modalBackdrop = document.getElementById('modalBackdrop');
const followCustomerId = document.getElementById('followCustomerId');
const followDate = document.getElementById('followDate');
const followMemo = document.getElementById('followMemo');
const followNextDate = document.getElementById('followNextDate');
const historyList = document.getElementById('historyList');
const modalCustomerName = document.getElementById('modalCustomerName');

// --- Load ---
async function loadCustomers() {
  const res = await fetch(`${API}/customers`);
  customers = await res.json();
  renderSummary();
  renderGrid();
}

function renderSummary() {
  const overdue = customers.filter(c => c.status === 'overdue').length;
  const soon = customers.filter(c => c.status === 'soon').length;
  const total = customers.length;
  const nyukyo = customers.filter(c => c.genre === '入居付').length;
  const oa = customers.filter(c => c.genre === 'OA関係').length;
  const other = customers.filter(c => c.genre === 'その他').length;
  summary.innerHTML = `
    <div class="summary-card overdue"><span class="label">期限超過</span><span class="value">${overdue}</span></div>
    <div class="summary-card soon"><span class="label">20日以内</span><span class="value">${soon}</span></div>
    <div class="summary-card"><span class="label">顧客総数</span><span class="value">${total}</span></div>
    <div class="summary-card"><span class="label">入居付</span><span class="value">${nyukyo}</span></div>
    <div class="summary-card"><span class="label">OA関係</span><span class="value">${oa}</span></div>
    <div class="summary-card"><span class="label">その他</span><span class="value">${other}</span></div>
  `;
}

function renderGrid() {
  if (customers.length === 0) {
    grid.innerHTML = '<div class="empty">顧客がいません。「＋ 顧客を追加」から登録してください。</div>';
    return;
  }
  grid.innerHTML = customers.map(c => cardHTML(c)).join('');
  grid.querySelectorAll('.btn-follow').forEach(btn => {
    btn.addEventListener('click', () => openFollowModal(btn.dataset.id));
  });
  grid.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => openEditPanel(btn.dataset.id));
  });
  grid.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteCustomer(btn.dataset.id));
  });
}

function badgeLabel(status, date) {
  if (status === 'overdue') return `⚠ ${date} 超過`;
  if (status === 'soon') return `🔔 ${date}`;
  if (status === 'ok') return `✓ ${date}`;
  return 'フォロー日未設定';
}

function cardHTML(c) {
  return `
    <div class="customer-card ${c.status}">
      <div>
        <div class="card-name">${esc(c.name)}</div>
        ${c.company ? `<div class="card-company">${esc(c.company)}</div>` : ''}
      </div>
      <div class="card-meta">
        ${c.genre ? `<span><span class="icon">🏷</span>${esc(c.genre)}</span>` : ''}
        ${c.contact ? `<span><span class="icon">📞</span>${esc(c.contact)}</span>` : ''}
        ${c.assignee ? `<span><span class="icon">👤</span>担当: ${esc(c.assignee)}</span>` : ''}
      </div>
      <span class="follow-badge ${c.status}">${badgeLabel(c.status, c.next_follow_date || '')}</span>
      ${c.notes ? `<div style="font-size:0.82rem;color:#4b5563">${esc(c.notes)}</div>` : ''}
      <div class="card-actions">
        <button class="btn btn-primary btn-sm btn-follow" data-id="${c.id}">フォロー記録</button>
        <button class="btn btn-ghost btn-sm btn-edit" data-id="${c.id}">編集</button>
        <button class="btn btn-ghost btn-sm btn-delete" data-id="${c.id}">削除</button>
      </div>
    </div>
  `;
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// --- Side Panel ---
function openAddPanel() {
  panelTitle.textContent = '顧客を追加';
  editId.value = '';
  form.reset();
  fNextDate.value = '';
  showPanel();
}

function openEditPanel(id) {
  const c = customers.find(c => String(c.id) === String(id));
  if (!c) return;
  panelTitle.textContent = '顧客を編集';
  editId.value = c.id;
  fName.value = c.name || '';
  fCompany.value = c.company || '';
  fContact.value = c.contact || '';
  fAssignee.value = c.assignee || '';
  fGenre.value = c.genre || '';
  fNextDate.value = c.next_follow_date || '';
  fNotes.value = c.notes || '';
  showPanel();
}

function showPanel() {
  sidePanel.classList.add('open');
  overlay.classList.add('active');
}

function closePanel() {
  sidePanel.classList.remove('open');
  overlay.classList.remove('active');
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const data = {
    name: fName.value.trim(),
    company: fCompany.value.trim(),
    contact: fContact.value.trim(),
    assignee: fAssignee.value.trim(),
    genre: fGenre.value || null,
    next_follow_date: fNextDate.value || null,
    notes: fNotes.value.trim(),
  };
  if (editId.value) {
    await fetch(`${API}/customers/${editId.value}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  } else {
    await fetch(`${API}/customers`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  }
  closePanel();
  loadCustomers();
});

async function deleteCustomer(id) {
  const c = customers.find(c => String(c.id) === String(id));
  if (!confirm(`「${c?.name}」を削除しますか？`)) return;
  await fetch(`${API}/customers/${id}`, { method: 'DELETE' });
  loadCustomers();
}

// --- Follow Modal ---
async function openFollowModal(id) {
  const c = customers.find(c => String(c.id) === String(id));
  if (!c) return;
  modalCustomerName.textContent = `${c.name}${c.company ? ' / ' + c.company : ''}`;
  followCustomerId.value = id;
  followDate.value = new Date().toISOString().split('T')[0];
  followMemo.value = '';
  followNextDate.value = '';
  modalBackdrop.classList.add('open');
  await loadHistory(id);
}

async function loadHistory(id) {
  const res = await fetch(`${API}/customers/${id}/history`);
  const history = await res.json();
  if (history.length === 0) {
    historyList.innerHTML = '<div class="history-empty">履歴はありません</div>';
    return;
  }
  historyList.innerHTML = history.map(h => `
    <div class="history-item">
      <div class="h-date">${esc(h.date)}</div>
      <div class="h-memo">${esc(h.memo || '（メモなし）')}</div>
    </div>
  `).join('');
}

document.getElementById('btnFollowSave').addEventListener('click', async () => {
  const id = followCustomerId.value;
  const data = {
    date: followDate.value,
    memo: followMemo.value.trim(),
    next_follow_date: followNextDate.value || null,
  };
  await fetch(`${API}/customers/${id}/follow`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  closeModal();
  loadCustomers();
});

function closeModal() {
  modalBackdrop.classList.remove('open');
}

// --- Events ---
document.getElementById('btnAdd').addEventListener('click', openAddPanel);
document.getElementById('btnClose').addEventListener('click', closePanel);
document.getElementById('btnCancel').addEventListener('click', closePanel);
overlay.addEventListener('click', closePanel);
document.getElementById('btnModalClose').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) closeModal(); });

// --- Init ---
loadCustomers();
