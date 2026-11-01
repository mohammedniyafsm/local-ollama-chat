const elements = {
  activeChatTitle: document.querySelector("#active-chat-title"),
  chatScrollArea: document.querySelector("#chat-scroll-area"),
  connectionDot: document.querySelector("#connection-dot"),
  connectionLabel: document.querySelector("#connection-label"),
  conversationList: document.querySelector("#conversation-list"),
  historyCount: document.querySelector("#history-count"),
  messages: document.querySelector("#messages"),
  modelSelect: document.querySelector("#model-select"),
  newChatButton: document.querySelector("#new-chat-button"),
  promptInput: document.querySelector("#prompt-input"),
  refreshModels: document.querySelector("#refresh-models"),
  sendButton: document.querySelector("#send-button"),
  settingsPanel: document.querySelector("#settings-panel"),
  settingsToggle: document.querySelector("#settings-toggle"),
  systemPrompt: document.querySelector("#system-prompt"),
  temperature: document.querySelector("#temperature"),
  temperatureValue: document.querySelector("#temperature-value"),
  welcomeState: document.querySelector("#welcome-state"),
};

const storageKey = "ollama-studio-conversations";
const selectedModelKey = "ollama-studio-selected-model";
let conversations = loadConversations();
let activeConversationId = null;
let currentRequest = null;
let availableModels = [];

function loadConversations() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(stored) ? stored.filter((item) => item && Array.isArray(item.messages)) : [];
  } catch {
    return [];
  }
}

function saveConversations() {
  localStorage.setItem(storageKey, JSON.stringify(conversations.slice(0, 40)));
}

function currentConversation() {
  return conversations.find((conversation) => conversation.id === activeConversationId);
}

function updateSendButton() {
  const isGenerating = Boolean(currentRequest);
  elements.sendButton.disabled = !isGenerating && (!elements.promptInput.value.trim() || !elements.modelSelect.value);
  elements.sendButton.classList.toggle("stop", isGenerating);
  elements.sendButton.setAttribute("aria-label", isGenerating ? "Stop response" : "Send message");
  elements.sendButton.title = isGenerating ? "Stop response" : "Send message";
  elements.sendButton.innerHTML = isGenerating
    ? '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 15V5m0 0L6 9m4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function renderInline(text) {
  const codeBlocks = [];
  let html = escapeHtml(text).replace(/`([^`\n]+)`/g, (_, code) => {
    codeBlocks.push(`<code>${code}</code>`);
    return `\u0000${codeBlocks.length - 1}\u0000`;
  });
  html = html
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
  return html.replace(/\u0000(\d+)\u0000/g, (_, index) => codeBlocks[Number(index)]);
}

function renderMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const output = [];
  let paragraph = [];
  let listType = null;
  let codeLines = [];

  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listType) return;
    output.push(`<${listType}>${paragraph.map((line) => `<li>${renderInline(line.replace(/^(?:[-*]|\d+\.)\s+/, ""))}</li>`).join("")}</${listType}>`);
    paragraph = [];
    listType = null;
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      if (codeLines.length) {
        output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
      } else {
        codeLines.push("");
      }
      continue;
    }
    if (codeLines.length) {
      codeLines.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 1, 3);
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    const listItem = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      const nextType = /^\d/.test(listItem[2]) ? "ol" : "ul";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      paragraph.push(`${listItem[2]} ${listItem[3]}`);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  if (codeLines.length) output.push(`<pre><code>${escapeHtml(codeLines.slice(1).join("\n"))}</code></pre>`);
  return output.join("") || "<p></p>";
}

function setTitle(title) {
  elements.activeChatTitle.textContent = title;
}

function renderConversationList() {
  const recent = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  elements.historyCount.textContent = String(recent.length);
  elements.conversationList.replaceChildren();
  if (!recent.length) {
    const empty = document.createElement("p");
    empty.className = "empty-history";
    empty.textContent = "Your chats will show up here.";
    elements.conversationList.append(empty);
    return;
  }
  for (const conversation of recent) {
    const button = document.createElement("button");
    button.className = `conversation-item${conversation.id === activeConversationId ? " active" : ""}`;
    button.type = "button";
    button.title = conversation.title;
    button.innerHTML = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4.5 5.5h11m-11 4.5h7m-7 4.5h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    const title = document.createElement("span");
    title.textContent = conversation.title;
    button.append(title);
    button.addEventListener("click", () => openConversation(conversation.id));
    elements.conversationList.append(button);
  }
}

function renderMessages() {
  const conversation = currentConversation();
  const messages = conversation?.messages || [];
  elements.welcomeState.hidden = messages.length > 0;
  elements.messages.hidden = messages.length === 0;
  elements.messages.replaceChildren();
  setTitle(conversation?.title || "New conversation");
  for (const message of messages) {
    appendMessage(message.role, message.content, { renderOnly: true, model: conversation.model });
  }
  renderConversationList();
  elements.chatScrollArea.scrollTop = elements.chatScrollArea.scrollHeight;
}

function appendMessage(role, content, options = {}) {
  const message = document.createElement("article");
  message.className = `message ${role === "user" ? "user" : "assistant"}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "user" ? "Y" : "✳";

  const body = document.createElement("div");
  body.className = "message-body";
  if (role !== "user") {
    const heading = document.createElement("div");
    heading.className = "message-heading";
    const name = document.createElement("strong");
    name.textContent = options.model || elements.modelSelect.value || "Ollama";
    const time = document.createElement("span");
    time.textContent = "LOCAL MODEL";
    heading.append(name, time);
    body.append(heading);
  }

  const contentElement = document.createElement("div");
  contentElement.className = "message-content";
  contentElement.innerHTML = role === "user" ? escapeHtml(content).replace(/\n/g, "<br>") : renderMarkdown(content);
  body.append(contentElement);
  message.append(avatar, body);

  if (role !== "user" && !options.renderOnly) {
    const toolbar = document.createElement("div");
    toolbar.className = "assistant-toolbar";
    const copy = document.createElement("button");
    copy.className = "copy-button";
    copy.type = "button";
    copy.innerHTML = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.3" y="5.3" width="8" height="8" rx="1.4" stroke="currentColor" stroke-width="1.2"/><path d="M10.7 5.3V3.9A1.4 1.4 0 0 0 9.3 2.5H3.9a1.4 1.4 0 0 0-1.4 1.4v5.4a1.4 1.4 0 0 0 1.4 1.4h1.4" stroke="currentColor" stroke-width="1.2"/></svg> Copy';
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(contentElement.innerText);
        copy.lastChild.textContent = " Copied";
        setTimeout(() => { copy.lastChild.textContent = " Copy"; }, 1400);
      } catch (error) {
        showError(`Could not copy response: ${error.message}`);
      }
    });
    toolbar.append(copy);
    body.append(toolbar);
  }

  elements.messages.append(message);
  return contentElement;
}

function openConversation(id) {
  activeConversationId = id;
  renderMessages();
}

function startNewConversation() {
  if (currentRequest) currentRequest.abort();
  activeConversationId = null;
  elements.promptInput.value = "";
  elements.promptInput.style.height = "auto";
  renderMessages();
  updateSendButton();
  elements.promptInput.focus();
}

function showError(message) {
  const error = document.createElement("div");
  error.className = "request-error";
  error.setAttribute("role", "alert");
  error.style.cssText = "margin:8px 0;padding:10px 12px;border:1px solid #edd8d2;border-radius:7px;color:#8b5147;background:#fbf0ed;font-size:11px;line-height:1.6;overflow-wrap:anywhere";
  error.textContent = message;
  elements.messages.append(error);
  elements.chatScrollArea.scrollTop = elements.chatScrollArea.scrollHeight;
}

async function loadModels() {
  elements.refreshModels.classList.add("is-loading");
  elements.connectionLabel.textContent = "Connecting to Ollama…";
  elements.connectionDot.className = "connection-dot";
  try {
    const response = await fetch("/api/ollama/api/tags");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Ollama returned ${response.status}`);
    if (!Array.isArray(result.models)) throw new Error("Ollama returned an unexpected model list.");
    availableModels = result.models;

    const previousModel = elements.modelSelect.value || localStorage.getItem(selectedModelKey);
    elements.modelSelect.replaceChildren();
    if (!availableModels.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No models installed";
      elements.modelSelect.append(option);
      elements.connectionLabel.textContent = "Ollama connected · no models";
      elements.connectionDot.className = "connection-dot connected";
    } else {
      for (const model of availableModels) {
        const option = document.createElement("option");
        option.value = model.name;
        const size = model.details?.parameter_size;
        option.textContent = size ? `${model.name} · ${size}` : model.name;
        elements.modelSelect.append(option);
      }
      elements.modelSelect.value = availableModels.some((model) => model.name === previousModel)
        ? previousModel
        : availableModels[0].name;
      elements.connectionLabel.textContent = `Ollama connected · ${availableModels.length} model${availableModels.length === 1 ? "" : "s"}`;
      elements.connectionDot.className = "connection-dot connected";
    }
    localStorage.setItem(selectedModelKey, elements.modelSelect.value);
    updateSendButton();
  } catch (error) {
    elements.modelSelect.replaceChildren();
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Ollama unavailable";
    elements.modelSelect.append(option);
    elements.connectionLabel.textContent = "Could not connect to Ollama";
    elements.connectionDot.className = "connection-dot disconnected";
    showError(`Could not load Ollama models. ${error.message}`);
    updateSendButton();
  } finally {
    elements.refreshModels.classList.remove("is-loading");
  }
}

async function sendMessage() {
  if (currentRequest) {
    currentRequest.abort();
    return;
  }
  const prompt = elements.promptInput.value.trim();
  const model = elements.modelSelect.value;
  if (!prompt || !model) return;

  if (!currentConversation()) {
    const conversation = {
      id: crypto.randomUUID(),
      title: prompt.replace(/\s+/g, " ").slice(0, 44) || "New conversation",
      model,
      messages: [],
      updatedAt: Date.now(),
    };
    conversations.unshift(conversation);
    activeConversationId = conversation.id;
  }

  const conversation = currentConversation();
  conversation.model = model;
  conversation.messages.push({ role: "user", content: prompt });
  conversation.updatedAt = Date.now();
  if (conversation.messages.filter((message) => message.role === "user").length === 1) {
    conversation.title = prompt.replace(/\s+/g, " ").slice(0, 44) || "New conversation";
  }
  elements.promptInput.value = "";
  elements.promptInput.style.height = "auto";
  elements.welcomeState.hidden = true;
  elements.messages.hidden = false;
  renderMessages();
  const responseContent = appendMessage("assistant", "", { model });
  const loading = document.createElement("div");
  loading.className = "typing-indicator";
  loading.innerHTML = "<span></span><span></span><span></span>";
  responseContent.append(loading);
  elements.chatScrollArea.scrollTop = elements.chatScrollArea.scrollHeight;

  const controller = new AbortController();
  currentRequest = controller;
  updateSendButton();

  const systemPrompt = elements.systemPrompt.value.trim();
  const messages = conversation.messages.map(({ role, content }) => ({ role, content }));
  if (systemPrompt) messages.unshift({ role: "system", content: systemPrompt });

  try {
    const response = await fetch("/api/ollama/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: { temperature: Number(elements.temperature.value) },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || `Ollama returned ${response.status}`);
    }
    if (!response.body) throw new Error("This browser does not support streamed responses.");

    let answer = "";
    let pending = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const processLines = (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        if (data.error) throw new Error(data.error);
        answer += data.message?.content || "";
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      processLines(decoder.decode(value, { stream: true }));
      responseContent.innerHTML = renderMarkdown(answer);
      elements.chatScrollArea.scrollTop = elements.chatScrollArea.scrollHeight;
    }
    processLines(decoder.decode());
    if (pending.trim()) {
      const finalData = JSON.parse(pending);
      if (finalData.error) throw new Error(finalData.error);
      answer += finalData.message?.content || "";
    }
    if (!answer && !controller.signal.aborted) throw new Error("Ollama returned an empty response.");

    if (controller.signal.aborted) {
      responseContent.innerHTML = renderMarkdown(answer || "Response stopped.");
    } else {
      conversation.messages.push({ role: "assistant", content: answer });
      conversation.updatedAt = Date.now();
      saveConversations();
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      responseContent.innerHTML = "";
      showError(error.message);
    } else if (!responseContent.textContent.trim()) {
      responseContent.textContent = "Response stopped.";
    }
  } finally {
    currentRequest = null;
    updateSendButton();
    renderConversationList();
    elements.chatScrollArea.scrollTop = elements.chatScrollArea.scrollHeight;
  }
}

elements.promptInput.addEventListener("input", () => {
  elements.promptInput.style.height = "auto";
  elements.promptInput.style.height = `${Math.min(elements.promptInput.scrollHeight, 180)}px`;
  updateSendButton();
});
elements.promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!elements.sendButton.disabled) sendMessage();
  }
});
elements.sendButton.addEventListener("click", sendMessage);
elements.newChatButton.addEventListener("click", startNewConversation);
elements.refreshModels.addEventListener("click", loadModels);
elements.modelSelect.addEventListener("change", () => {
  localStorage.setItem(selectedModelKey, elements.modelSelect.value);
  updateSendButton();
});
elements.settingsToggle.addEventListener("click", () => {
  const open = elements.settingsPanel.hidden;
  elements.settingsPanel.hidden = !open;
  elements.settingsToggle.setAttribute("aria-expanded", String(open));
});
elements.temperature.addEventListener("input", () => {
  elements.temperatureValue.value = Number(elements.temperature.value).toFixed(1);
});
document.querySelectorAll(".starter-card").forEach((button) => {
  button.addEventListener("click", () => {
    elements.promptInput.value = button.dataset.prompt || "";
    elements.promptInput.focus();
    elements.promptInput.dispatchEvent(new Event("input"));
  });
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    startNewConversation();
  }
});

renderMessages();
loadModels();
