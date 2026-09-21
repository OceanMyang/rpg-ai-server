const STORAGE_KEY = 'rpg-ai.game-id.v1';
const TOKEN_KEY = 'rpg-ai.access-token.v1';
const PENDING_KEY = 'rpg-ai.pending-turn.v1';
const TURN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TURN_TIMEOUT_MS = 195_000;
const ELAPSED_NOTICE_MS = 10_000;
const SLOW_TURN_MS = 45_000;
const messagesElement = document.querySelector('#messages');
const form = document.querySelector('#composer');
const input = document.querySelector('#action');
const sendButton = document.querySelector('#send');
const newGameButton = document.querySelector('#new-game');
const statusElement = document.querySelector('#status');

let gameId = localStorage.getItem(STORAGE_KEY);
let busy = false;
let gameStatus = 'playing';
let awaitingRetry = false;
let hostConfigured = true;
let retryNotice = null;
let accessToken = localStorage.getItem(TOKEN_KEY) || '';
let locked = false;

function escapeHtml(text) {
  return text.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/gu, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/gu, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/gu, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/gu, '$1<em>$2</em>');
}

// A deliberately small Markdown subset: paragraphs, headings, lists, quotes and inline marks.
function renderMarkdown(text) {
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    blocks.push(`</${list}>`);
    list = null;
  };

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/u.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/u.exec(line);
    const quote = /^>\s?(.*)$/u.exec(line);

    if (/^(-{3,}|\*{3,}|_{3,})$/u.test(line.trim())) {
      flushParagraph();
      closeList();
      blocks.push('<hr>');
    } else if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(heading[1].length + 2, 6);
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
    } else if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (list !== tag) {
        closeList();
        list = tag;
        blocks.push(`<${tag}>`);
      }
      blocks.push(`<li>${renderInline((bullet || numbered)[1])}</li>`);
    } else if (quote) {
      flushParagraph();
      closeList();
      blocks.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  closeList();
  return blocks.join('');
}

function appendMessage(role, content, extraClass = '') {
  const element = document.createElement('article');
  element.className = `message ${role} ${extraClass}`.trim();
  if (role === 'assistant' && extraClass !== 'waiting') {
    element.classList.add('markdown');
    element.innerHTML = renderMarkdown(content);
  } else {
    element.textContent = content;
  }
  messagesElement.append(element);
  messagesElement.scrollTop = messagesElement.scrollHeight;
  return element;
}

function startWaitingTimer(element) {
  const startedAt = Date.now();
  const limit = Math.round(TURN_TIMEOUT_MS / 1000);
  const timer = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    if (elapsed < ELAPSED_NOTICE_MS) return;
    const seconds = Math.round(elapsed / 1000);
    element.textContent = elapsed >= SLOW_TURN_MS
      ? `… the host is taking longer than usual (${seconds}s of ${limit}s)`
      : `… (${seconds}s)`;
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }, 1_000);
  return () => clearInterval(timer);
}

function renderMessages(messages) {
  messagesElement.replaceChildren();
  for (const message of messages) appendMessage(message.role, message.content);
}

function setBusy(value) {
  busy = value;
  input.disabled = value || (!locked && (awaitingRetry || gameStatus === 'won'));
  sendButton.disabled = value || (!locked && (gameStatus === 'won' || (awaitingRetry && !pendingTurn())));
  sendButton.textContent = awaitingRetry ? 'Retry' : 'Send';
  newGameButton.disabled = value;
  if (!input.disabled) input.focus();
}

function lockAccess() {
  locked = true;
  accessToken = '';
  localStorage.removeItem(TOKEN_KEY);
  input.value = '';
  input.type = 'password';
  input.placeholder = 'Access password';
  statusElement.textContent = 'Password required';
}

function unlockAccess(token) {
  locked = false;
  accessToken = token;
  localStorage.setItem(TOKEN_KEY, token);
  input.type = 'text';
  input.placeholder = 'What do you do?';
}

async function submitPassword(password) {
  setBusy(true);
  statusElement.textContent = 'Checking…';
  try {
    const { token } = await api('/api/session', {
      method: 'POST',
      body: JSON.stringify({ password })
    });
    unlockAccess(token);
    messagesElement.replaceChildren();
    await restoreGame();
  } catch (error) {
    appendMessage('notice', error.message);
    statusElement.textContent = 'Password required';
  } finally {
    setBusy(false);
  }
}

function setGameStatus(status) {
  gameStatus = status;
  statusElement.textContent = status === 'won'
    ? 'The beacon burns · victory'
    : hostConfigured
      ? 'Merrowdale'
      : 'Host needs an API key';
  setBusy(busy);
}

async function api(path, options = {}) {
  const { timeoutMs = 15_000, ...requestOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(path, {
      ...requestOptions,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { 'X-Access-Token': accessToken } : {}),
        ...(requestOptions.headers || {})
      }
    });
  } catch (cause) {
    clearTimeout(timeout);
    const error = new Error(
      cause?.name === 'AbortError'
        ? 'The host took too long to answer and the turn timed out.'
        : 'The connection was interrupted.'
    );
    error.retryable = true;
    error.cause = cause;
    throw error;
  }
  let body;
  try {
    body = await response.json();
  } catch (cause) {
    const error = new Error(
      response.ok
        ? 'The server response was interrupted.'
        : `Request failed (${response.status}).`
    );
    error.status = response.status;
    error.retryable = response.ok
      || response.status === 408
      || response.status === 425
      || response.status === 429
      || response.status >= 500;
    error.cause = cause;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    if (response.status === 401) lockAccess();
    const error = new Error(body.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.retryable = body.retryable === true;
    throw error;
  }
  return body;
}

function makeTurnId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-');
}

function pendingTurn() {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (
      !pending
      || typeof pending.gameId !== 'string'
      || !TURN_ID_PATTERN.test(pending.gameId)
      || typeof pending.turnId !== 'string'
      || !TURN_ID_PATTERN.test(pending.turnId)
      || typeof pending.action !== 'string'
      || pending.action.length < 1
      || pending.action.length > 2_000
    ) {
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
    return pending;
  } catch {
    localStorage.removeItem(PENDING_KEY);
    return null;
  }
}

async function submitTurn(turn) {
  const result = await api(`/api/games/${encodeURIComponent(turn.gameId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ action: turn.action, turnId: turn.turnId }),
    timeoutMs: TURN_TIMEOUT_MS
  });
  if (
    typeof result?.narration !== 'string'
    || result.narration.trim().length < 1
    || result.narration.length > 8_000
    || !['playing', 'won'].includes(result.status)
  ) {
    const error = new Error('The server returned an incomplete turn.');
    error.retryable = true;
    throw error;
  }
  return result;
}

async function finishPendingTurn(turn, waiting) {
  retryNotice?.remove();
  retryNotice = null;
  const stopTimer = startWaitingTimer(waiting);
  statusElement.textContent = 'The host is thinking…';
  try {
    const result = await submitTurn(turn);
    localStorage.removeItem(PENDING_KEY);
    awaitingRetry = false;
    stopTimer();
    waiting.remove();
    try {
      const game = await api(`/api/games/${encodeURIComponent(turn.gameId)}`);
      renderMessages(game.messages);
      setGameStatus(game.status);
    } catch {
      appendMessage('assistant', result.narration);
      setGameStatus(result.status);
    }
    return true;
  } catch (error) {
    stopTimer();
    waiting.remove();
    awaitingRetry = error.retryable === true;
    if (awaitingRetry) {
      retryNotice = appendMessage(
        'notice',
        `${error.message} Press Retry to try the same action again.`
      );
      statusElement.textContent = 'Action saved · ready to retry';
    } else {
      localStorage.removeItem(PENDING_KEY);
      retryNotice = appendMessage('notice', error.message);
      statusElement.textContent = 'Turn not completed';
    }
    return false;
  }
}

async function createGame() {
  setBusy(true);
  statusElement.textContent = 'Preparing a new world…';
  try {
    const game = await api('/api/games', { method: 'POST', body: '{}' });
    gameId = game.id;
    localStorage.setItem(STORAGE_KEY, gameId);
    localStorage.removeItem(PENDING_KEY);
    awaitingRetry = false;
    renderMessages(game.messages);
    setGameStatus(game.status);
  } catch (error) {
    appendMessage('notice', error.message);
    statusElement.textContent = 'Unavailable';
  } finally {
    setBusy(false);
  }
}

async function restoreGame() {
  setBusy(true);
  try {
    const server = await api('/api/status');
    hostConfigured = server.configured;
    if (server.requiresPassword && !accessToken) {
      lockAccess();
      appendMessage('notice', 'This game is password-protected. Enter the password to continue.');
      setBusy(false);
      return;
    }
    let game;
    if (gameId) {
      try {
        game = await api(`/api/games/${encodeURIComponent(gameId)}`);
      } catch (error) {
        if (error.status !== 404) throw error;
        localStorage.removeItem(STORAGE_KEY);
        gameId = null;
      }
    }
    if (!game) {
      try {
        game = await api('/api/games/current');
        gameId = game.id;
        localStorage.setItem(STORAGE_KEY, gameId);
      } catch (error) {
        if (error.status !== 404) throw error;
        localStorage.removeItem(PENDING_KEY);
        await createGame();
        return;
      }
    }
    renderMessages(game.messages);
    setGameStatus(game.status);

    const pending = pendingTurn();
    if (pending?.gameId === gameId) {
      appendMessage('user', pending.action);
      awaitingRetry = true;
      retryNotice = appendMessage(
        'notice',
        'This action was interrupted. Press Retry to resume it with the same turn ID.'
      );
      statusElement.textContent = 'Action saved · ready to retry';
    } else if (pending) {
      localStorage.removeItem(PENDING_KEY);
    }
  } catch (error) {
    awaitingRetry = Boolean(pendingTurn());
    appendMessage('notice', error.message);
    statusElement.textContent = awaitingRetry
      ? 'Action saved · press Retry'
      : 'Connection unavailable';
  } finally {
    setBusy(false);
  }
}

function resizeInput() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  if (locked) {
    const password = input.value;
    if (!password) return;
    input.value = '';
    resizeInput();
    await submitPassword(password);
    return;
  }
  if (!gameId) return;
  if (awaitingRetry) {
    const turn = pendingTurn();
    if (!turn || turn.gameId !== gameId) return;
    const waiting = appendMessage('assistant', '…', 'waiting');
    setBusy(true);
    try {
      await finishPendingTurn(turn, waiting);
    } finally {
      setBusy(false);
    }
    return;
  }
  const action = input.value.trim();
  if (!action) return;

  input.value = '';
  resizeInput();
  appendMessage('user', action);
  const waiting = appendMessage('assistant', '…', 'waiting');
  const turn = { gameId, action, turnId: makeTurnId() };
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(turn));
  } catch {
    waiting.remove();
    appendMessage('notice', 'This browser could not save the pending action. Free storage and try again.');
    return;
  }
  setBusy(true);
  try {
    await finishPendingTurn(turn, waiting);
  } finally {
    setBusy(false);
  }
});

input.addEventListener('input', resizeInput);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

newGameButton.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(PENDING_KEY);
  gameId = null;
  awaitingRetry = false;
  gameStatus = 'playing';
  messagesElement.replaceChildren();
  createGame();
});

restoreGame();
