const API = '';
let customers = [];
let currentTab = 'list'; // 'list' | 'ended' | 'calendar'
let searchQuery = '';
let currentArea = '';
let currentGenre = '';
let currentAssignee = '';
let currentStatusFilter = ''; // 'overdue' | 'u3' | 'u14' | 'u30' | ''

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
const fPhone = document.getElementById('fPhone');
const fEmail = document.getElementById('fEmail');
const fGenre = document.getElementById('fGenre');
const fArea = document.getElementById('fArea');
const fNextDate = document.getElementById('fNextDate');
const fNotes = document.getElementById('fNotes');
const modalBackdrop = document.getElementById('modalBackdrop');
const followCustomerId = document.getElementById('followCustomerId');
const followDate = document.getElementById('followDate');
const followMemo = document.getElementById('followMemo');
const followNextDate = document.getElementById('followNextDate');
const historyList = document.getElementById('historyList');
const modalCustomerName = document.getElementById('modalCustomerName');

// --- マスターデータ ---
let masterGenres = [];
let masterAreas  = [];

async function loadMasters() {
  const [gRes, aRes] = await Promise.all([
    fetch(`${API}/master/genres`),
    fetch(`${API}/master/areas`)
  ]);
  masterGenres = await gRes.json();
  masterAreas  = await aRes.json();
  updateGenreSelect();
  updateAreaSelect();
  renderGenreFilter();
  renderAreaFilter();
}

function updateGenreSelect() {
  fGenre.innerHTML = '<option value="">未選択</option>' +
    masterGenres.map(g => `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join('');
}

function updateAreaSelect() {
  fArea.innerHTML = '<option value="">未選択</option>' +
    masterAreas.map(a => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('');
}

function renderGenreFilter() {
  const wrap = document.getElementById('genreFilter');
  wrap.innerHTML = `<button class="area-btn ${currentGenre === '' ? 'active' : ''}" data-genre="">すべて</button>` +
    masterGenres.map(g => `<button class="area-btn ${currentGenre === g.name ? 'active' : ''}" data-genre="${esc(g.name)}">${esc(g.name)}</button>`).join('');
  wrap.querySelectorAll('.area-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentGenre = btn.dataset.genre;
      renderGenreFilter();
      if (currentTab !== 'calendar') renderGrid();
    });
  });
}

function renderAreaFilter() {
  const wrap = document.getElementById('areaFilter');
  wrap.innerHTML = `<button class="area-btn ${currentArea === '' ? 'active' : ''}" data-area="">すべて</button>` +
    masterAreas.map(a => `<button class="area-btn ${currentArea === a.name ? 'active' : ''}" data-area="${esc(a.name)}">${esc(a.name)}</button>`).join('');
  wrap.querySelectorAll('.area-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentArea = btn.dataset.area;
      renderAreaFilter();
      if (currentTab !== 'calendar') renderGrid();
    });
  });
}

// --- Load ---
async function loadCustomers() {
  const res = await fetch(`${API}/customers`);
  customers = await res.json();
  renderSummary();
  renderAssigneeFilter();
  renderGrid();
}

// --- Summary ---
function renderSummary() {
  const active = customers.filter(c => c.account_status !== 'ended');
  const now = new Date();
  const d3  = new Date(now); d3.setDate(d3.getDate() + 3);
  const d14 = new Date(now); d14.setDate(d14.getDate() + 14);
  const d30 = new Date(now); d30.setDate(d30.getDate() + 30);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = fmt(now), s3 = fmt(d3), s14 = fmt(d14), s30 = fmt(d30);

  const overdue = active.filter(c => c.next_follow_date && c.next_follow_date < today).length;
  const u3  = active.filter(c => c.next_follow_date && c.next_follow_date >= today && c.next_follow_date <= s3).length;
  const u14 = active.filter(c => c.next_follow_date && c.next_follow_date > s3  && c.next_follow_date <= s14).length;
  const u30 = active.filter(c => c.next_follow_date && c.next_follow_date > s14 && c.next_follow_date <= s30).length;
  const total   = active.length;
  const nyukyo  = active.filter(c => c.genre === '入居付').length;
  const oa      = active.filter(c => c.genre === 'OA関係').length;
  const other   = active.filter(c => c.genre === 'その他').length;
  const ended   = customers.filter(c => c.account_status === 'ended').length;

  const sf = currentStatusFilter;
  summary.innerHTML = `
    <div class="summary-group">
      <div class="summary-group-label">フォロー状況</div>
      <div class="summary-group-cards">
        <div class="summary-card overdue ${sf==='overdue'?'selected':''}" data-filter="overdue" style="cursor:pointer"><span class="label">期限超過</span><span class="value">${overdue}</span></div>
        <div class="summary-card urgent ${sf==='u3'?'selected':''}" data-filter="u3" style="cursor:pointer"><span class="label">🔥 3日以内</span><span class="value">${u3}</span></div>
        <div class="summary-card mid ${sf==='u14'?'selected':''}" data-filter="u14" style="cursor:pointer"><span class="label">😐 14日以内</span><span class="value">${u14}</span></div>
        <div class="summary-card low ${sf==='u30'?'selected':''}" data-filter="u30" style="cursor:pointer"><span class="label">🧊 30日以内</span><span class="value">${u30}</span></div>
      </div>
    </div>
    <div class="summary-divider"></div>
    <div class="summary-group">
      <div class="summary-group-label">顧客内訳</div>
      <div class="summary-group-cards">
        <div class="summary-card"><span class="label">総数</span><span class="value">${total}</span></div>
        <div class="summary-card"><span class="label">入居付</span><span class="value">${nyukyo}</span></div>
        <div class="summary-card"><span class="label">OA関係</span><span class="value">${oa}</span></div>
        <div class="summary-card ended-card"><span class="label">終了済み</span><span class="value">${ended}</span></div>
      </div>
    </div>
  `;

  // サマリーカードのクリックで絞り込み
  document.querySelectorAll('.summary-card[data-filter]').forEach(card => {
    card.addEventListener('click', () => {
      const f = card.dataset.filter;
      currentStatusFilter = currentStatusFilter === f ? '' : f; // 同じカードで解除
      if (currentTab === 'list') {
        renderSummary();
        renderGrid();
      } else {
        setTab('list');
      }
    });
  });
}

// --- 担当者フィルター生成 ---
function renderAssigneeFilter() {
  const wrap = document.getElementById('assigneeFilter');
  const active = customers.filter(c => c.account_status !== 'ended');
  const assignees = [...new Set(active.map(c => c.assignee).filter(Boolean))].sort();
  let html = `<button class="area-btn ${currentAssignee === '' ? 'active' : ''}" data-assignee="">すべて</button>`;
  if (CURRENT_USER.name) {
    html += `<button class="area-btn ${currentAssignee === CURRENT_USER.name ? 'active' : ''}" data-assignee="${esc(CURRENT_USER.name)}">🙋 自分</button>`;
  }
  assignees.filter(a => a !== CURRENT_USER.name).forEach(a => {
    html += `<button class="area-btn ${currentAssignee === a ? 'active' : ''}" data-assignee="${esc(a)}">${esc(a)}</button>`;
  });
  wrap.innerHTML = html;
  wrap.querySelectorAll('.area-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentAssignee = btn.dataset.assignee;
      renderAssigneeFilter();
      if (currentTab !== 'calendar') renderGrid();
    });
  });
}

// --- Grid ---
function renderGrid() {
  const isEnded = currentTab === 'ended';
  let list = customers.filter(c =>
    isEnded ? c.account_status === 'ended' : c.account_status !== 'ended'
  );

  if (currentAssignee) {
    list = list.filter(c => c.assignee === currentAssignee);
  }

  if (currentStatusFilter) {
    const now = new Date();
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const today = fmt(now);
    const d3  = new Date(now); d3.setDate(d3.getDate() + 3);
    const d14 = new Date(now); d14.setDate(d14.getDate() + 14);
    const d30 = new Date(now); d30.setDate(d30.getDate() + 30);
    const s3 = fmt(d3), s14 = fmt(d14), s30 = fmt(d30);
    if (currentStatusFilter === 'overdue') {
      list = list.filter(c => c.next_follow_date && c.next_follow_date < today);
    } else if (currentStatusFilter === 'u3') {
      list = list.filter(c => c.next_follow_date && c.next_follow_date >= today && c.next_follow_date <= s3);
    } else if (currentStatusFilter === 'u14') {
      list = list.filter(c => c.next_follow_date && c.next_follow_date > s3 && c.next_follow_date <= s14);
    } else if (currentStatusFilter === 'u30') {
      list = list.filter(c => c.next_follow_date && c.next_follow_date > s14 && c.next_follow_date <= s30);
    }
  }

  if (currentGenre) {
    list = list.filter(c => c.genre === currentGenre);
  }

  if (currentArea) {
    list = list.filter(c => c.area === currentArea);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q) ||
      (c.assignee || '').toLowerCase().includes(q)
    );
  }

  if (list.length === 0) {
    grid.innerHTML = isEnded
      ? '<div class="empty">終了済みの顧客はいません。</div>'
      : '<div class="empty">顧客がいません。「＋ 顧客を追加」から登録してください。</div>';
    return;
  }

  grid.innerHTML = list.map(c => isEnded ? cardHTMLEnded(c) : cardHTML(c)).join('');

  grid.querySelectorAll('.btn-follow').forEach(btn =>
    btn.addEventListener('click', () => openFollowModal(btn.dataset.id)));
  grid.querySelectorAll('.btn-edit').forEach(btn =>
    btn.addEventListener('click', () => openEditPanel(btn.dataset.id)));
  grid.querySelectorAll('.btn-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteCustomer(btn.dataset.id)));
  grid.querySelectorAll('.btn-ai-chat').forEach(btn =>
    btn.addEventListener('click', () => openChatModal(btn.dataset.id)));
  grid.querySelectorAll('.btn-ai-email').forEach(btn =>
    btn.addEventListener('click', () => openAiModal(btn.dataset.id, 'email')));
  grid.querySelectorAll('.btn-reopen').forEach(btn =>
    btn.addEventListener('click', () => reopenCustomer(btn.dataset.id)));
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
        ${c.area ? `<span><span class="icon">📍</span>${esc(c.area)}</span>` : ''}
        ${c.phone ? `<span><span class="icon">📞</span>${esc(c.phone)}</span>` : ''}
        ${c.email_address ? `<span><span class="icon">✉</span>${esc(c.email_address)}</span>` : ''}
        ${c.assignee ? `<span><span class="icon">👤</span>担当: ${esc(c.assignee)}</span>` : ''}
      </div>
      <span class="follow-badge ${c.status}">${badgeLabel(c.status, c.next_follow_date || '')}</span>
      ${c.notes ? `<div style="font-size:0.82rem;color:#4b5563;white-space:pre-wrap">${esc(c.notes)}</div>` : ''}
      ${c.created_by_name ? `<div style="font-size:0.75rem;color:#94a3b8;margin-top:0.1rem">登録: ${esc(c.created_by_name)}</div>` : ''}
      <div class="card-actions">
        <button class="btn-follow-card btn-follow" data-id="${c.id}">フォロー記録</button>
        <button class="btn btn-sm btn-edit" style="background:var(--gray-100);color:var(--gray-600);border:none" data-id="${c.id}">編集</button>
        <button class="btn btn-sm btn-delete" style="background:var(--gray-100);color:var(--gray-400);border:none" data-id="${c.id}">削除</button>
      </div>
      <div class="card-actions">
        <button class="btn btn-ai btn-sm btn-ai-chat" data-id="${c.id}">💬 AIと相談</button>
        <button class="btn btn-ai btn-sm btn-ai-email" data-id="${c.id}">✉ メール作成</button>
      </div>
    </div>
  `;
}

function cardHTMLEnded(c) {
  return `
    <div class="customer-card ended">
      <div>
        <div class="card-name">${esc(c.name)}</div>
        ${c.company ? `<div class="card-company">${esc(c.company)}</div>` : ''}
      </div>
      <div class="card-meta">
        ${c.genre ? `<span><span class="icon">🏷</span>${esc(c.genre)}</span>` : ''}
        ${c.area ? `<span><span class="icon">📍</span>${esc(c.area)}</span>` : ''}
        ${c.phone ? `<span><span class="icon">📞</span>${esc(c.phone)}</span>` : ''}
        ${c.email_address ? `<span><span class="icon">✉</span>${esc(c.email_address)}</span>` : ''}
        ${c.assignee ? `<span><span class="icon">👤</span>担当: ${esc(c.assignee)}</span>` : ''}
      </div>
      <span class="follow-badge ended-badge">✓ フォロー終了</span>
      ${c.notes ? `<div style="font-size:0.82rem;color:#94a3b8;white-space:pre-wrap">${esc(c.notes)}</div>` : ''}
      <div class="card-actions">
        <button class="btn btn-reopen btn-sm btn-reopen" data-id="${c.id}">🔄 再開</button>
        <button class="btn btn-sm btn-delete" style="background:var(--gray-100);color:var(--gray-400);border:none" data-id="${c.id}">削除</button>
      </div>
    </div>
  `;
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// --- 重複チェック ---
function checkDuplicate() {
  const nameVal    = fName.value.trim().toLowerCase();
  const companyVal = fCompany.value.trim().toLowerCase();
  const currentId  = editId.value;

  const emailVal    = fEmail.value.trim().toLowerCase();
  const nameWarn    = document.getElementById('dupWarnName');
  const companyWarn = document.getElementById('dupWarnCompany');
  nameWarn.innerHTML = '';
  companyWarn.innerHTML = '';

  if (!nameVal && !companyVal && !emailVal) return;

  const others = customers.filter(c => String(c.id) !== String(currentId) && c.account_status !== 'ended');

  if (nameVal) {
    const hits = others.filter(c => (c.name || '').toLowerCase().includes(nameVal) || nameVal.includes((c.name || '').toLowerCase()));
    if (hits.length) {
      nameWarn.innerHTML = `⚠ 似た顧客名: ${hits.map(c => `<b>${esc(c.name)}</b>${c.company ? '（' + esc(c.company) + '）' : ''}`).join('、')}`;
    }
  }

  if (companyVal) {
    const hits = others.filter(c => (c.company || '').toLowerCase().includes(companyVal) || companyVal.includes((c.company || '').toLowerCase()));
    if (hits.length) {
      companyWarn.innerHTML = `⚠ 似た会社名: ${hits.map(c => `<b>${esc(c.company)}</b>（${esc(c.name)}）`).join('、')}`;
    }
  }

  if (emailVal) {
    const hits = others.filter(c => (c.email_address || '').toLowerCase() === emailVal);
    if (hits.length) {
      companyWarn.innerHTML += (companyWarn.innerHTML ? '<br>' : '') +
        `⚠ 同じメールアドレス: ${hits.map(c => `<b>${esc(c.name)}</b>${c.company ? '（' + esc(c.company) + '）' : ''}`).join('、')}`;
    }
  }
}

// --- Side Panel ---
function openAddPanel() {
  panelTitle.textContent = '顧客を追加';
  editId.value = '';
  form.reset();
  fNextDate.value = '';
  document.querySelectorAll('#formExpectBtns .btn-expect').forEach(b => b.classList.remove('selected'));
  document.getElementById('dupWarnName').innerHTML = '';
  document.getElementById('dupWarnCompany').innerHTML = '';
  showPanel();
}

function openEditPanel(id) {
  const c = customers.find(c => String(c.id) === String(id));
  if (!c) return;
  panelTitle.textContent = '顧客を編集';
  editId.value = c.id;
  fName.value = c.name || '';
  fCompany.value = c.company || '';
  fPhone.value = c.phone || '';
  fEmail.value = c.email_address || '';
  fAssignee.value = c.assignee || '';
  fGenre.value = c.genre || '';
  fArea.value = c.area || '';
  fNextDate.value = c.next_follow_date || '';
  fNotes.value = c.notes || '';
  document.querySelectorAll('#formExpectBtns .btn-expect').forEach(b => b.classList.remove('selected'));
  document.getElementById('dupWarnName').innerHTML = '';
  document.getElementById('dupWarnCompany').innerHTML = '';
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
    phone: fPhone.value.trim(),
    email_address: fEmail.value.trim(),
    assignee: fAssignee.value.trim(),
    genre: fGenre.value || null,
    area: fArea.value || null,
    next_follow_date: fNextDate.value || null,
    notes: fNotes.value.trim(),
  };
  let res;
  if (editId.value) {
    res = await fetch(`${API}/customers/${editId.value}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  } else {
    res = await fetch(`${API}/customers`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  }
  if (!res.ok) {
    const err = await res.json();
    alert(err.error || '保存に失敗しました');
    return;
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

async function reopenCustomer(id) {
  const c = customers.find(c => String(c.id) === String(id));
  if (!confirm(`「${c?.name}」を再開しますか？`)) return;
  await fetch(`${API}/customers/${id}/reopen`, { method: 'POST' });
  loadCustomers();
}

// --- Follow Modal ---
function getSelectedExpectation() {
  const sel = document.querySelector('#modalBackdrop .btn-expect.selected');
  return sel ? sel.dataset.level : null;
}

async function openFollowModal(id) {
  const c = customers.find(c => String(c.id) === String(id));
  if (!c) return;
  modalCustomerName.textContent = `${c.name}${c.company ? ' / ' + c.company : ''}`;
  followCustomerId.value = id;
  const now = new Date();
  followDate.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  followMemo.value = '';
  followNextDate.value = '';
  document.querySelectorAll('#modalBackdrop .btn-expect').forEach(b => b.classList.remove('selected'));
  modalBackdrop.classList.add('open');
  await loadHistory(id);
  await loadActivity(id);
}

function expectLabel(exp) {
  if (exp === 'high') return '🔥 高い';
  if (exp === 'mid')  return '😐 普通';
  if (exp === 'low')  return '🧊 低い';
  if (exp === 'ended') return '⏹ 終了';
  return '';
}

async function loadHistory(id) {
  const res = await fetch(`${API}/customers/${id}/history`);
  const history = await res.json();
  if (history.length === 0) {
    historyList.innerHTML = '<div class="history-empty">履歴はありません</div>';
    return;
  }
  historyList.innerHTML = history.map(h => {
    const badge = h.expectation ? `<span class="expect-history-badge">${expectLabel(h.expectation)}</span>` : '';
    return `
      <div class="history-item">
        <div class="h-date">${esc(h.date)} ${badge}</div>
        <div class="h-memo">${esc(h.memo || '（メモなし）')}</div>
      </div>
    `;
  }).join('');
}

async function loadActivity(id) {
  const res  = await fetch(`${API}/customers/${id}/activity`);
  const logs = await res.json();
  const el   = document.getElementById('activityList');
  if (logs.length === 0) { el.innerHTML = '<div class="history-empty">ログはありません</div>'; return; }
  const actionIcon = a => ({'登録':'✅','編集':'✏️','フォロー記録':'📝','終了':'⏹','再開':'🔄'}[a] || '•');
  el.innerHTML = logs.map(l => `
    <div class="history-item" style="border-left-color:#94a3b8">
      <div class="h-date" style="color:#64748b">${actionIcon(l.action)} ${esc(l.action)} — ${esc(l.user_name || '不明')} <span style="font-weight:400;color:#94a3b8">${l.created_at.slice(0,16).replace('T',' ')}</span></div>
      ${l.detail ? `<div class="h-memo" style="color:#64748b">${esc(l.detail)}</div>` : ''}
    </div>
  `).join('');
}

document.getElementById('btnFollowSave').addEventListener('click', async () => {
  const id = followCustomerId.value;
  const data = {
    date: followDate.value,
    memo: followMemo.value.trim(),
    next_follow_date: followNextDate.value || null,
    expectation: getSelectedExpectation(),
  };
  await fetch(`${API}/customers/${id}/follow`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  closeModal();
  loadCustomers();
});

document.getElementById('btnFollowEnd').addEventListener('click', async () => {
  const id = followCustomerId.value;
  const c = customers.find(c => String(c.id) === String(id));
  if (!confirm(`「${c?.name}」のフォローを終了しますか？\n終了済みタブから再開できます。`)) return;
  await fetch(`${API}/customers/${id}/end`, { method: 'POST' });
  closeModal();
  loadCustomers();
});

function closeModal() {
  modalBackdrop.classList.remove('open');
}

// --- AI Chat ---
const chatModalBackdrop = document.getElementById('chatModalBackdrop');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
let chatHistory = [];
let chatCustomerId = null;

function openChatModal(id) {
  const c = customers.find(c => String(c.id) === String(id));
  chatCustomerId = id;
  chatHistory = [];
  chatMessages.innerHTML = '';
  document.getElementById('chatModalTitle').textContent = `💬 AIと相談 — ${c?.name}`;
  chatModalBackdrop.classList.add('open');
  sendChat('');
}

function appendBubble(role, text) {
  const div = document.createElement('div');
  div.className = `chat-bubble ${role}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

async function sendChat(userText) {
  if (userText) {
    appendBubble('user', userText);
    chatHistory.push({ role: 'user', content: userText });
  } else {
    chatHistory.push({ role: 'user', content: 'この顧客について一緒に考えたいです。状況を整理して、何を相談すべか教えてください。' });
  }
  const aiBubble = appendBubble('ai', '');
  aiBubble.classList.add('typing');
  let fullText = '';
  const res = await fetch(`${API}/customers/${chatCustomerId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: chatHistory })
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const text = line.slice(6);
      if (text === '[DONE]') break;
      fullText += text;
      aiBubble.textContent = fullText;
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }
  aiBubble.classList.remove('typing');
  chatHistory.push({ role: 'assistant', content: fullText });
}

document.getElementById('btnChatSend').addEventListener('click', () => {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  sendChat(text);
});
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('btnChatSend').click(); }
});
document.getElementById('btnChatModalClose').addEventListener('click', () => {
  chatModalBackdrop.classList.remove('open');
});
chatModalBackdrop.addEventListener('click', e => {
  if (e.target === chatModalBackdrop) chatModalBackdrop.classList.remove('open');
});

// --- AI Modal ---
const aiModalBackdrop = document.getElementById('aiModalBackdrop');
const aiModalTitle = document.getElementById('aiModalTitle');
const aiResult = document.getElementById('aiResult');

async function openAiModal(id, type) {
  const c = customers.find(c => String(c.id) === String(id));
  aiModalTitle.textContent = type === 'suggest' ? `✨ AI提案 — ${c?.name}` : `✉ メール作成 — ${c?.name}`;
  aiResult.textContent = '生成中...';
  aiModalBackdrop.classList.add('open');
  try {
    const res = await fetch(`${API}/customers/${id}/${type}`, { method: 'POST' });
    const data = await res.json();
    aiResult.textContent = data.result || data.error || 'エラーが発生しました';
  } catch {
    aiResult.textContent = 'エラーが発生しました';
  }
}

document.getElementById('btnAiModalClose').addEventListener('click', () => { aiModalBackdrop.classList.remove('open'); });
aiModalBackdrop.addEventListener('click', e => { if (e.target === aiModalBackdrop) aiModalBackdrop.classList.remove('open'); });
document.getElementById('btnCopyAi').addEventListener('click', () => {
  navigator.clipboard.writeText(aiResult.textContent);
  document.getElementById('btnCopyAi').textContent = 'コピーしました！';
  setTimeout(() => { document.getElementById('btnCopyAi').textContent = 'コピー'; }, 2000);
});

// --- Calendar ---
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
const DAYS = ['日','月','火','水','木','金','土'];

function renderCalendar() {
  const title = document.getElementById('calTitle');
  const calGrid = document.getElementById('calendarGrid');
  title.textContent = `${calYear}年 ${calMonth + 1}月`;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay = new Date(calYear, calMonth + 1, 0);
  const startDow = firstDay.getDay();
  const eventMap = {};
  customers.filter(c => c.account_status !== 'ended').forEach(c => {
    if (!c.next_follow_date) return;
    if (!eventMap[c.next_follow_date]) eventMap[c.next_follow_date] = [];
    eventMap[c.next_follow_date].push(c);
  });
  let html = DAYS.map((d, i) => {
    const cls = i === 0 ? 'sun' : i === 6 ? 'sat' : '';
    return `<div class="cal-header ${cls}">${d}</div>`;
  }).join('');
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = new Date(calYear, calMonth, d).getDay();
    const isToday = dateStr === today;
    const dowCls = dow === 0 ? 'sun' : dow === 6 ? 'sat' : '';
    const events = eventMap[dateStr] || [];
    const eventHtml = events.map(c => `
      <div class="cal-event genre-${esc(c.genre || '')}" onclick="openFollowModal(${c.id})" title="${esc(c.name)}">${esc(c.name)}</div>
    `).join('');
    const colStart = d === 1 ? `style="grid-column-start:${startDow + 1}"` : '';
    html += `<div class="cal-day ${isToday ? 'today' : ''}" ${colStart}><div class="cal-date ${dowCls}">${d}</div>${eventHtml}</div>`;
  }
  calGrid.innerHTML = html;
}

document.getElementById('calPrev').addEventListener('click', () => {
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar();
});
document.getElementById('calNext').addEventListener('click', () => {
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar();
});

// --- タブ切り替え ---
const tabList     = document.getElementById('tabList');
const tabEnded    = document.getElementById('tabEnded');
const tabCalendar = document.getElementById('tabCalendar');
const customerGrid = document.getElementById('customerGrid');
const calendarView = document.getElementById('calendarView');

function setTab(tab) {
  currentTab = tab;
  tabList.classList.toggle('active', tab === 'list');
  tabEnded.classList.toggle('active', tab === 'ended');
  tabCalendar.classList.toggle('active', tab === 'calendar');
  customerGrid.style.display = tab === 'calendar' ? 'none' : '';
  calendarView.style.display = tab === 'calendar' ? '' : 'none';
  if (tab === 'calendar') renderCalendar();
  else renderGrid();
}

tabList.addEventListener('click', () => setTab('list'));
tabEnded.addEventListener('click', () => setTab('ended'));
tabCalendar.addEventListener('click', () => setTab('calendar'));

// --- 検索バー ---
document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  if (currentTab !== 'calendar') renderGrid();
});

// マスターデータ・顧客データを並行ロード

// --- 期待度ボタン（フォローモーダル） ---
document.querySelectorAll('#modalBackdrop .btn-expect').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#modalBackdrop .btn-expect').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const d = new Date();
    d.setDate(d.getDate() + parseInt(btn.dataset.days));
    followNextDate.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
});

// --- 期待度ボタン（顧客登録フォーム） ---
document.querySelectorAll('#formExpectBtns .btn-expect').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#formExpectBtns .btn-expect').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const d = new Date();
    d.setDate(d.getDate() + parseInt(btn.dataset.days));
    fNextDate.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
});

// --- 重複チェックイベント ---
fName.addEventListener('input', checkDuplicate);
fCompany.addEventListener('input', checkDuplicate);
fEmail.addEventListener('input', checkDuplicate);

// --- パスワード変更モーダル ---
const changePwBackdrop = document.getElementById('changePwBackdrop');
document.getElementById('btnChangePw').addEventListener('click', () => {
  document.getElementById('pwCurrent').value = '';
  document.getElementById('pwNew').value = '';
  document.getElementById('pwConfirm').value = '';
  document.getElementById('pwError').style.display = 'none';
  changePwBackdrop.classList.add('open');
});
document.getElementById('btnChangePwClose').addEventListener('click', () => changePwBackdrop.classList.remove('open'));
changePwBackdrop.addEventListener('click', e => { if (e.target === changePwBackdrop) changePwBackdrop.classList.remove('open'); });

document.getElementById('btnChangePwSave').addEventListener('click', async () => {
  const current = document.getElementById('pwCurrent').value;
  const newPw   = document.getElementById('pwNew').value;
  const confirm = document.getElementById('pwConfirm').value;
  const errEl   = document.getElementById('pwError');
  errEl.style.display = 'none';
  if (newPw.length < 6) { errEl.textContent = 'パスワードは6文字以上にしてください'; errEl.style.display = 'block'; return; }
  if (newPw !== confirm) { errEl.textContent = '新しいパスワードが一致しません'; errEl.style.display = 'block'; return; }
  const res  = await fetch('/change-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: current, new_password: newPw })
  });
  const data = await res.json();
  if (data.ok) { changePwBackdrop.classList.remove('open'); alert('パスワードを変更しました。'); }
  else { errEl.textContent = data.error || 'エラーが発生しました'; errEl.style.display = 'block'; }
});

// --- Events ---
document.getElementById('btnAdd').addEventListener('click', openAddPanel);
document.getElementById('btnClose').addEventListener('click', closePanel);
document.getElementById('btnCancel').addEventListener('click', closePanel);
overlay.addEventListener('click', closePanel);
document.getElementById('btnModalClose').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) closeModal(); });

// --- 名刺OCR ---
document.getElementById('cardImageInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const status = document.getElementById('ocrStatus');
  status.textContent = '🔍 読み取り中...';
  status.className = 'ocr-status loading';

  const formData = new FormData();
  formData.append('image', file);

  try {
    const res  = await fetch('/ocr/card', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.error) {
      status.textContent = '⚠ ' + data.error;
      status.className = 'ocr-status error';
      return;
    }

    // フォームに自動入力
    if (data.name)          fName.value    = data.name;
    if (data.company)       fCompany.value = data.company;
    if (data.phone)         fPhone.value   = data.phone;
    if (data.email_address) fEmail.value   = data.email_address;
    if (data.area) {
      // マスターのエリアと部分一致で選択
      const match = masterAreas.find(a => data.area.includes(a.name) || a.name.includes(data.area));
      if (match) fArea.value = match.name;
    }

    // 重複チェック実行
    checkDuplicate();

    const filled = [data.name, data.company, data.phone, data.email_address].filter(Boolean).length;
    status.textContent = `✅ ${filled}項目を自動入力しました。内容を確認してください。`;
    status.className = 'ocr-status success';
  } catch {
    status.textContent = '⚠ 読み取りに失敗しました。';
    status.className = 'ocr-status error';
  }

  // ファイル入力をリセット（同じ画像を再選択できるように）
  e.target.value = '';
});

// --- スマホメニュー ---
const spMenu = document.getElementById('spMenu');
const spMenuOverlay = document.getElementById('spMenuOverlay');
document.getElementById('btnMenu')?.addEventListener('click', () => {
  spMenu.classList.add('open');
  spMenuOverlay.classList.add('open');
});
spMenuOverlay.addEventListener('click', () => {
  spMenu.classList.remove('open');
  spMenuOverlay.classList.remove('open');
});
document.getElementById('btnChangePwSp')?.addEventListener('click', () => {
  spMenu.classList.remove('open');
  spMenuOverlay.classList.remove('open');
  changePwBackdrop.classList.add('open');
});

// --- Init ---
loadMasters();
loadCustomers();
