/**
 * Essentia株式会社 AIチャットウィジェット
 * Claude API（/api/chat 経由）とSSEストリーミングで通信する
 * サービス選択ボタン対応版
 */

(function () {
  'use strict';

  // ===========================
  // 状態管理
  // ===========================
  /** 会話履歴（Claude API の messages 形式） */
  const conversationHistory = [];

  /** 選択中のサービス */
  let selectedService = null;

  /** ストリーミング中フラグ */
  let isStreaming = false;

  // サービス定義
  const SERVICES = [
    {
      key: 'oa',
      label: '💻 OA機器販売',
      message: 'OA機器販売サービスについて教えてください。',
      context: 'ユーザーは【OA機器販売サービス】について相談しています。このサービスに関する質問に集中して回答してください。',
    },
    {
      key: 'elderly',
      label: '🏠 高齢者施設紹介',
      message: '高齢者施設紹介サービスについて教えてください。',
      context: 'ユーザーは【高齢者施設紹介業】について相談しています。このサービスに関する質問に集中して回答してください。',
    },
    {
      key: 'consulting',
      label: '📊 コンサルティング',
      message: 'コンサルティングサービスについて教えてください。',
      context: 'ユーザーは【医療・介護コンサルティング】について相談しています。このサービスに関する質問に集中して回答してください。',
    },
  ];

  // ===========================
  // DOM 要素の取得
  // ===========================
  const chatToggleBtn = document.getElementById('chatToggleBtn');
  const chatWidget    = document.getElementById('chatWidget');
  const chatCloseBtn  = document.getElementById('chatCloseBtn');
  const chatMessages  = document.getElementById('chatMessages');
  const chatInput     = document.getElementById('chatInput');
  const chatSendBtn   = document.getElementById('chatSendBtn');

  if (!chatToggleBtn || !chatWidget) return;

  // ===========================
  // チャットウィジェットの開閉
  // ===========================
  chatToggleBtn.addEventListener('click', () => {
    const isOpen = chatWidget.classList.toggle('chat-open');
    chatToggleBtn.classList.toggle('chat-btn-active', isOpen);

    // 初回オープン時にウェルカム＋サービス選択ボタンを表示
    if (isOpen && chatMessages.children.length === 0) {
      showWelcome();
    }

    if (isOpen) setTimeout(() => chatInput.focus(), 300);
  });

  chatCloseBtn.addEventListener('click', () => {
    chatWidget.classList.remove('chat-open');
    chatToggleBtn.classList.remove('chat-btn-active');
  });

  // ===========================
  // ウェルカム＋サービス選択
  // ===========================
  function showWelcome() {
    appendBotMessage('こんにちは！Essentia株式会社のAIアシスタントです😊\nどのサービスについてお知りになりたいですか？');
    showServiceButtons();
  }

  /** サービス選択ボタンを表示 */
  function showServiceButtons() {
    const wrap = document.createElement('div');
    wrap.className = 'chat-quick-wrap';
    wrap.id = 'serviceButtons';

    SERVICES.forEach(service => {
      const btn = document.createElement('button');
      btn.className = 'chat-quick-btn';
      btn.textContent = service.label;
      btn.addEventListener('click', () => onServiceSelect(service, wrap));
      wrap.appendChild(btn);
    });

    chatMessages.appendChild(wrap);
    scrollToBottom();
  }

  /** サービス選択後の処理 */
  function onServiceSelect(service, buttonWrap) {
    if (isStreaming) return;

    selectedService = service;

    // ボタン群を非表示にしてラベルだけ残す
    buttonWrap.innerHTML = `<span class="chat-selected-label">${service.label} を選択しました</span>`;

    // ユーザーメッセージとして表示・送信
    appendUserMessage(service.message);
    conversationHistory.push({
      role: 'user',
      // サービスのコンテキストをメッセージ先頭に付与してAIに伝える
      content: `[${service.context}]\n${service.message}`,
    });

    sendToClaude();
  }

  // ===========================
  // メッセージ送信処理
  // ===========================
  chatSendBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });

  function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || isStreaming) return;

    chatInput.value = '';
    chatInput.style.height = 'auto';

    appendUserMessage(text);

    // サービス選択済みの場合はコンテキストを先頭に付与
    const content = selectedService
      ? `[${selectedService.context}]\n${text}`
      : text;

    conversationHistory.push({ role: 'user', content });
    sendToClaude();
  }

  /** Claude API へ送信してストリーミング表示 */
  async function sendToClaude() {
    const botBubble = appendBotMessage('', true);
    isStreaming = true;
    updateSendButton(true);

    let fullText = '';

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversationHistory }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();

          if (payload === '[DONE]') {
            finalizeBotMessage(botBubble, fullText);
            conversationHistory.push({ role: 'assistant', content: fullText });
            // 回答後に「他のサービスを見る」を表示
            showChangeServiceOption();
            break;
          }

          try {
            const data = JSON.parse(payload);
            if (data.error) {
              updateBotBubble(botBubble, `⚠️ ${data.error}`);
              fullText = data.error;
              break;
            }
            if (data.text) {
              fullText += data.text;
              updateBotBubble(botBubble, fullText);
            }
          } catch { /* JSON パースエラーは無視 */ }
        }
      }

    } catch (err) {
      const errMsg = 'エラーが発生しました。しばらくしてから再度お試しください。';
      updateBotBubble(botBubble, `⚠️ ${errMsg}`);
      fullText = errMsg;
    } finally {
      isStreaming = false;
      updateSendButton(false);
      finalizeBotMessage(botBubble, fullText);
    }
  }

  /** 回答後に「他のサービスも見る」ボタンを表示 */
  function showChangeServiceOption() {
    // すでに表示済みの場合は追加しない
    if (document.querySelector('.chat-change-wrap')) return;

    const wrap = document.createElement('div');
    wrap.className = 'chat-change-wrap';

    const label = document.createElement('span');
    label.className = 'chat-change-label';
    label.textContent = '他のサービスについてもお気軽にどうぞ👇';

    const btnRow = document.createElement('div');
    btnRow.className = 'chat-quick-wrap chat-quick-wrap--sm';

    // 現在選択中以外のサービスをボタン表示
    SERVICES.forEach(service => {
      const btn = document.createElement('button');
      btn.className = 'chat-quick-btn chat-quick-btn--sm';
      btn.textContent = service.label;
      btn.addEventListener('click', () => {
        wrap.remove();
        // 会話履歴をリセットしてサービスを切り替え
        conversationHistory.length = 0;
        selectedService = service;

        const newBtnWrap = document.createElement('div');
        newBtnWrap.className = 'chat-quick-wrap';
        newBtnWrap.innerHTML = `<span class="chat-selected-label">${service.label} に切り替えました</span>`;
        chatMessages.appendChild(newBtnWrap);

        appendUserMessage(service.message);
        conversationHistory.push({
          role: 'user',
          content: `[${service.context}]\n${service.message}`,
        });
        sendToClaude();
        scrollToBottom();
      });
      btnRow.appendChild(btn);
    });

    wrap.appendChild(label);
    wrap.appendChild(btnRow);
    chatMessages.appendChild(wrap);
    scrollToBottom();
  }

  // ===========================
  // DOM 操作ヘルパー
  // ===========================
  function appendUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'chat-msg chat-msg-user';
    div.innerHTML = `<div class="chat-bubble">${escapeHtml(text)}</div>`;
    chatMessages.appendChild(div);
    scrollToBottom();
  }

  function appendBotMessage(text, streaming = false) {
    const div = document.createElement('div');
    div.className = 'chat-msg chat-msg-bot';

    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = 'E';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble' + (streaming ? ' chat-bubble-streaming' : '');
    bubble.innerHTML = streaming
      ? '<span class="chat-typing"><span></span><span></span><span></span></span>'
      : formatText(text);

    div.appendChild(avatar);
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    scrollToBottom();
    return bubble;
  }

  function updateBotBubble(bubble, text) {
    bubble.innerHTML = formatText(text) + '<span class="chat-cursor">|</span>';
    scrollToBottom();
  }

  function finalizeBotMessage(bubble, text) {
    if (!text) return;
    bubble.classList.remove('chat-bubble-streaming');
    bubble.innerHTML = formatText(text || '（応答がありませんでした）');
    scrollToBottom();
  }

  function formatText(text) {
    return escapeHtml(text)
      .replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function updateSendButton(loading) {
    chatSendBtn.disabled = loading;
    chatSendBtn.innerHTML = loading
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  }

})();
