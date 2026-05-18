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
  grid.querySelectorAll('.btn-ai-chat').forEach(btn => {
    btn.addEventListener('click', () => openChatModal(btn.dataset.id));
  });
  grid.querySelectorAll('.btn-ai-email').forEach(btn => {
    btn.addEventListener('click', () => openAiModal(btn.dataset.id, 'email'));
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
      <div class="card-actions">
        <button class="btn btn-ai btn-sm btn-ai-chat" data-id="${c.id}">💬 AIと相談</button>
        <button class="btn btn-ai btn-sm btn-ai-email" data-id="${c.id}">✉ メール作成</button>
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
  document.querySelectorAll('.btn-expect').forEach(b => b.classList.remove('selected'));
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
  // 最初のAIメッセージを自動生成
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
    // 初回は空メッセージでAIに先に話させる
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
  aiModalTitle.textContent = type === 'suggest'
    ? `✨ AI提案 — ${c?.name}`
    : `✉ メール作成 — ${c?.name}`;
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

document.getElementById('btnAiModalClose').addEventListener('click', () => {
  aiModalBackdrop.classList.remove('open');
});
aiModalBackdrop.addEventListener('click', e => {
  if (e.target === aiModalBackdrop) aiModalBackdrop.classList.remove('open');
});
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
  const grid = document.getElementById('calendarGrid');
  title.textContent = `${calYear}年 ${calMonth + 1}月`;

  const today = new Date().toISOString().split('T')[0];
  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay = new Date(calYear, calMonth + 1, 0);
  const startDow = firstDay.getDay();

  // ジャンルごとのイベントマップ
  const eventMap = {};
  customers.forEach(c => {
    if (!c.next_follow_date) return;
    const d = c.next_follow_date;
    if (!eventMap[d]) eventMap[d] = [];
    eventMap[d].push(c);
  });

  // ヘッダー
  let html = DAYS.map((d, i) => {
    const cls = i === 0 ? 'sun' : i === 6 ? 'sat' : '';
    return `<div class="cal-header ${cls}">${d}</div>`;
  }).join('');

  // 前月の空白
  for (let i = 0; i < startDow; i++) {
    html += `<div class="cal-day empty"></div>`;
  }

  // 日付セル
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = new Date(calYear, calMonth, d).getDay();
    const isToday = dateStr === today;
    const dowCls = dow === 0 ? 'sun' : dow === 6 ? 'sat' : '';
    const events = eventMap[dateStr] || [];
    const eventHtml = events.map(c => `
      <div class="cal-event genre-${esc(c.genre || '')}" onclick="openFollowModal(${c.id})" title="${esc(c.name)}">
        ${esc(c.name)}
      </div>
    `).join('');
    html += `
      <div class="cal-day ${isToday ? 'today' : ''}">
        <div class="cal-date ${dowCls}">${d}</div>
        ${eventHtml}
      </div>
    `;
  }

  // 後月の空白
  const endDow = lastDay.getDay();
  for (let i = endDow + 1; i < 7; i++) {
    html += `<div class="cal-day empty"></div>`;
  }

  grid.innerHTML = html;
}

document.getElementById('calPrev').addEventListener('click', () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
});
document.getElementById('calNext').addEventListener('click', () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
});

// --- タブ切り替え ---
const tabList = document.getElementById('tabList');
const tabCalendar = document.getElementById('tabCalendar');
const customerGrid = document.getElementById('customerGrid');
const calendarView = document.getElementById('calendarView');

tabList.addEventListener('click', () => {
  tabList.classList.add('active');
  tabCalendar.classList.remove('active');
  customerGrid.style.display = '';
  calendarView.style.display = 'none';
});
tabCalendar.addEventListener('click', () => {
  tabCalendar.classList.add('active');
  tabList.classList.remove('active');
  customerGrid.style.display = 'none';
  calendarView.style.display = '';
  renderCalendar();
});

// --- 期待度ボタン ---
document.querySelectorAll('.btn-expect').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-expect').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const days = parseInt(btn.dataset.days);
    const d = new Date();
    d.setDate(d.getDate() + days);
    followNextDate.value = d.toISOString().split('T')[0];
  });
});

// --- Events ---
document.getElementById('btnAdd').addEventListener('click', openAddPanel);
document.getElementById('btnClose').addEventListener('click', closePanel);
document.getElementById('btnCancel').addEventListener('click', closePanel);
overlay.addEventListener('click', closePanel);
document.getElementById('btnModalClose').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) closeModal(); });

// --- Init ---
loadCustomers();
