import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github-dark.css';
import './chat.css';

type Message = { role: 'user' | 'assistant'; content: string; steps?: string[]; agent?: boolean; attached?: boolean; fileNames?: string[] };
type Thread = { id: string; title: string; messages: Message[] };
type Attachment = { name: string; text: string };
type Draft = { input: string; code: string; attachments: Attachment[]; agent: boolean; codeOpen: boolean; language: string };
const titleFor = (content: string) => content.trim().replace(/\s+/g, ' ').slice(0, 65);
type Model = { id?: string; name: string; size: number; engine?: string };
type HFVariant = { tag: string; ollama_tag: string | null; size: number; files: number; filenames: string[] };
const engineLabels: Record<string, string> = {
  ollama: 'Ollama',
  'llama-cpu': 'llama.cpp · CPU',
  'llama-vulkan': 'llama.cpp · Vulkan',
  'llama-cuda': 'llama.cpp · NVIDIA CUDA',
  'llama-rocm': 'llama.cpp · AMD ROCm',
  'llama-openvino': 'llama.cpp · Intel OpenVINO',
};
const modelKey = (model: Model) => model.id ?? model.name;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function formatProse(text: string) {
  const inline = (value: string) => value.split(/(`[^`\n]+`)/g).map(part => part.startsWith('`') && part.endsWith('`')
    ? '<code>' + escape(part.slice(1, -1)) + '</code>'
    : escape(part).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')).join('');
  const blocks = text.trim().split(/\n\s*\n/).filter(Boolean).map(block => {
    const lines = block.split('\n');
    if (lines.every(line => /^\s*[-*]\s+/.test(line))) {
      return '<ul>' + lines.map(line => '<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>').join('') + '</ul>';
    }
    if (lines.length === 1 && /^#{1,6}\s/.test(block)) {
      return '<h3>' + inline(block.replace(/^#{1,6}\s+/, '')) + '</h3>';
    }
    if (lines.every(line => /^>\s?/.test(line))) {
      return '<blockquote>' + lines.map(line => inline(line.replace(/^>\s?/, ''))).join('<br>') + '</blockquote>';
    }
    return '<p>' + lines.map(inline).join('<br>') + '</p>';
  });
  return '<div class="chat-prose" dir="auto">' + blocks.join('') + '</div>';
}

export function formatMessage(text: string) {
  return text.split(/(```[\s\S]*?(?:```|$))/g).map(part => {
    if (!part.startsWith('```')) return formatProse(part);
    const match = part.match(/^```([^\n]*)\n?([\s\S]*?)(?:```)?$/)!;
    const language = match[1].trim().toLowerCase().split(/\s+/, 1)[0];
    const code = match[2].replace(/\n$/, '');
    const highlighted = hljs.getLanguage(language) ? hljs.highlight(code, {language}).value : escape(code);
    return `<div class="code-box" data-language="${escape(language || 'text')}"><header><span>${escape(language || 'code')}</span><div class="chat-code-actions"><button class="copy-code" type="button">کپی کد</button><button class="copy-code open-code" type="button">پنل کد</button></div></header><pre dir="ltr"><code class="hljs">${highlighted}</code></pre></div>`;
  }).join('');
}

export function mountChat(api: { queueDownload: (id: string, payload: Record<string, unknown>, size?: number) => void; call: (action: string, payload?: Record<string, unknown>) => Promise<any>; busy: () => boolean; setBusy: (value: boolean, label?: string) => void; view: (name: string) => void; symbol: string }) {
  const nav = document.createElement('button');
  nav.className = 'nav-item'; nav.dataset.view = 'chat';
  nav.innerHTML = `${api.symbol}<span>چت و کدنویسی</span>`;
  document.querySelector('#nav-create')!.append(nav);
  const section = document.createElement('section'); section.id = 'chat-view'; section.className = 'view';
  section.innerHTML = `<div class="chat-layout">
    <aside class="chat-library model-card"><div class="chat-catalog"><div class="chat-presets"></div><progress id="chat-progress" max="100" hidden></progress><p id="chat-status" role="status"></p></div></aside>
    <aside class="chat-history">
      <button id="chat-new" class="small-button">＋ گفت‌وگوی جدید</button>
      <input id="chat-history-search" type="search" placeholder="جست‌وجوی گفتگوها" aria-label="جست‌وجوی گفتگوها"/>
      <div id="chat-threads"></div>
      <button id="chat-delete" class="small-button" hidden>حذف گفتگوی فعلی</button>
    </aside>
    <div class="chat-workspace">
      <header class="chat-toolbar">
        <button id="chat-history-toggle" class="small-button" aria-expanded="true">گفتگوها</button>
        <div class="chat-model-control"><select id="chat-model" aria-label="مدل چت"><option value="">مدل چت</option></select></div>
        <button id="chat-manage" class="small-button">مدل‌ها</button>
        <label class="chat-cpu"><input id="chat-cpu" type="checkbox"/> CPU</label>
      </header>
      <div id="chat-messages"></div>
      <div class="chat-composer">
        <div id="chat-code-editor" class="chat-code-editor" hidden>
          <header><b>کد ورودی</b><select id="chat-code-language" aria-label="زبان کد"><option>python</option><option>javascript</option><option>typescript</option><option>html</option><option>css</option><option>rust</option><option>json</option><option>bash</option><option>text</option></select></header>
          <textarea id="chat-code-input" dir="ltr" spellcheck="false" placeholder="کدت را اینجا بچسبان…"></textarea>
        </div>
        <div id="chat-attachments" class="chat-attachments" hidden></div>
        <textarea id="chat-input" aria-label="پیام" placeholder="پیام یا درخواست کدنویسی…" rows="2" dir="auto"></textarea>
        <div class="chat-composer-actions">
          <button id="chat-code-toggle" class="small-button" aria-expanded="false">&lt;/&gt; کد</button>
          <button id="chat-attach" class="small-button" title="فایل متنی برای حالت ایجنت">＋ پیوست</button>
          <input id="chat-files" type="file" multiple accept=".txt,.md,.csv,.json,.log,.ts,.tsx,.js,.jsx,.py,.rs,.html,.css,.yaml,.yml,.toml,.xml,.sql,.sh,.ps1,.java,.cpp,.c,.h,.go,.rb,.php" hidden/>
          <button id="chat-agent" class="small-button" aria-pressed="false" title="برنامه‌ریزی و بررسی فایل‌های پیوست">ایجنت</button>
          <button id="chat-reply-stop" class="small-button" hidden>توقف</button>
          <button id="chat-send" class="primary-button" data-work>ارسال ↑</button>
        </div>
      </div>
    </div>
    <aside id="chat-artifact" class="chat-artifact" hidden>
      <header><b id="chat-artifact-title">کد</b><button id="chat-artifact-close" class="small-button">بستن</button></header>
      <pre dir="ltr"><code id="chat-artifact-code" class="hljs"></code></pre>
      <footer><button id="chat-artifact-copy" class="small-button">کپی</button><button id="chat-artifact-save" class="small-button">ذخیرهٔ فایل</button></footer>
    </aside>
  </div>`;
  document.querySelector('main')!.append(section);
  const manager = document.createElement('details');
  manager.className = 'model-fold chat-model-manager';
  manager.innerHTML = '<summary><span>مدل‌های چت و کدنویسی</span><span class="fold-chevron">⌄</span></summary>';
  manager.append(section.querySelector('.chat-library')!);
  const installedFold = document.createElement('details');
  installedFold.className = 'model-fold chat-installed-fold';
  installedFold.innerHTML = '<summary><span>مدل‌های نصب‌شده</span><span class="fold-chevron">⌄</span></summary><div class="model-fold-content"><button id="chat-refresh" class="small-button">بازخوانی مدل‌ها</button><div id="chat-installed-cards"></div></div>';
  const catalog = manager.querySelector('.chat-catalog')!;
  catalog.before(installedFold);
  const installedCards = installedFold.querySelector('#chat-installed-cards')!;
  document.querySelector('#models-view .model-overview')!.before(manager);
  const conversationStatus = document.createElement('p');
  conversationStatus.id = 'chat-conversation-status'; conversationStatus.setAttribute('role', 'status');
  section.querySelector('.chat-composer')!.append(conversationStatus);

  const q = <T extends HTMLElement>(id: string) => document.querySelector<T>('#' + id)!;
  const status = q('chat-status');
  const input = q<HTMLTextAreaElement>('chat-input');
  const codeInput = q<HTMLTextAreaElement>('chat-code-input');
  const codeLanguage = q<HTMLSelectElement>('chat-code-language');
  const codeEditor = q('chat-code-editor');
  const historySearch = q<HTMLInputElement>('chat-history-search');
  const modelSelect = q<HTMLSelectElement>('chat-model');
  const sendButton = q<HTMLButtonElement>('chat-send');
  const stopButton = q<HTMLButtonElement>('chat-reply-stop');
  const agentButton = q<HTMLButtonElement>('chat-agent');
  const layout = section.querySelector('.chat-layout')!;
  const messageBox = q('chat-messages');
  const storageKey = 'nocturne-chat-threads';
  const drafts = new Map<string, Draft>();
  let threads: Thread[] = [];
  let activeId = '';
  let generating = false;
  let agent = false;
  let readingFiles = false;
  let attachments: Attachment[] = [];
  let artifact = { language: '', code: '' };
  let run: { id: string; inFlight: boolean; stopped: boolean; stopping?: Promise<void> } | undefined;

  const setStatus = (text: string) => {
    status.textContent = text;
    q('chat-conversation-status').textContent = text;
  };

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved && Array.isArray(saved.threads)) {
      threads = saved.threads.filter((thread: Thread) => thread && typeof thread.id === 'string' &&
        typeof thread.title === 'string' && Array.isArray(thread.messages));
      activeId = saved.activeId;
    } else {
      const legacy = JSON.parse(localStorage.getItem('nocturne-chat-history') || '[]');
      if (Array.isArray(legacy) && legacy.length) {
        const messages: Message[] = legacy.filter(message => message && ['user', 'assistant'].includes(message.role) &&
          typeof message.content === 'string' && message.content.trim());
        if (messages.length) threads.push({ id: crypto.randomUUID(), title: titleFor(messages[0].content), messages });
      }
    }
  } catch {}
  activeId = threads.find(thread => thread.id === activeId)?.id || threads[0]?.id || crypto.randomUUID();

  const activeThread = () => threads.find(thread => thread.id === activeId);
  const save = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ threads, activeId }));
    } catch {
      setStatus('فضای ذخیرهٔ گفتگوها پر است.');
    }
  };

  const renderThreads = () => {
    q<HTMLButtonElement>('chat-delete').hidden = generating || !activeThread();
    const query = historySearch.value.trim().toLowerCase();
    q('chat-threads').innerHTML = threads
      .filter(thread => thread.title.toLowerCase().includes(query))
      .map(thread => `<button class="chat-thread" data-thread="${escape(thread.id)}" aria-pressed="${thread.id === activeId}" ${generating ? 'disabled' : ''}>${escape(thread.title)}</button>`)
      .join('') || '<p class="chat-history-empty">گفتگویی پیدا نشد.</p>';
  };

  const render = (forceScroll = false) => {
    const atBottom = messageBox.scrollHeight - messageBox.scrollTop - messageBox.clientHeight < 90;
    const messages = activeThread()?.messages || [];
    messageBox.innerHTML = messages.length ? messages.map((message, index) => {
      const streaming = generating && message.role === 'assistant' && index === messages.length - 1;
      const actions = message.role === 'assistant' && !streaming && message.content
        ? `<footer class="chat-message-actions"><button class="small-button" data-copy-answer="${index}">کپی پاسخ</button></footer>` : '';
      return `<article class="chat-message ${message.role}${streaming ? ' is-streaming' : ''}">
        <b>${message.role === 'user' ? 'شما' : 'دستیار'}</b>
        ${message.fileNames?.length ? `<ul class="chat-file-names">${message.fileNames.map(name => `<li>${escape(name)}</li>`).join('')}</ul>` : ''}
        ${message.steps?.length ? `<ol class="chat-agent-steps" aria-label="مراحل ایجنت">${message.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol>` : ''}
        ${streaming ? `<div class="chat-prose chat-live-text" dir="auto">${escape(message.content)}</div><span class="stream-cursor" aria-hidden="true"></span>` : formatMessage(message.content)}
        ${actions}</article>`;
    }).join('') : '<div class="chat-empty"><h2>چطور کمکت کنم؟</h2><div class="chat-starters"><button class="small-button" data-starter="این کد را بررسی کن و راه‌حل پیشنهاد بده.">بررسی کد</button><button class="small-button" data-starter="برای این کار یک برنامهٔ مرحله‌به‌مرحله بنویس.">برنامه‌ریزی</button></div></div>';
    if (!generating && messages.at(-1)?.role === 'assistant') {
      messageBox.insertAdjacentHTML('beforeend', '<button class="small-button chat-retry" data-retry>پاسخ دوباره</button>');
    } else if (!generating && messages.length) {
      messageBox.insertAdjacentHTML('beforeend', '<button class="small-button chat-retry" data-retry>تلاش دوباره</button>');
    }
    if (forceScroll || atBottom) messageBox.scrollTop = messageBox.scrollHeight;
  };

  const renderAttachments = () => {
    const list = q('chat-attachments');
    list.hidden = !attachments.length;
    list.innerHTML = attachments.map((file, index) =>
      `<button type="button" class="small-button" data-remove-file="${index}" aria-label="حذف ${escape(file.name)}">${escape(file.name)} ×</button>`).join('');
  };

  const setAgent = (enabled: boolean) => {
    agent = enabled;
    agentButton.setAttribute('aria-pressed', String(enabled));
  };

  const selectThread = (id: string) => {
    if (generating || readingFiles || id === activeId) return;
    drafts.set(activeId, { input: input.value, code: codeInput.value, attachments, agent, codeOpen: !codeEditor.hidden, language: codeLanguage.value });
    activeId = id;
    const draft = drafts.get(id);
    input.value = draft?.input || '';
    codeInput.value = draft?.code || '';
    codeLanguage.value = draft?.language || 'python';
    attachments = draft?.attachments || [];
    setAgent(draft?.agent || false);
    codeEditor.hidden = !draft?.codeOpen;
    q('chat-code-toggle').setAttribute('aria-expanded', String(!codeEditor.hidden));
    closeArtifact();
    renderAttachments();
    renderThreads();
    render(true);
    setStatus('');
    save();
    input.focus();
  };

  const closeArtifact = () => {
    q('chat-artifact').hidden = true;
    layout.classList.remove('has-artifact');
  };

  const openArtifact = (block: HTMLElement) => {
    artifact = { language: block.dataset.language || 'text', code: block.querySelector('code')?.textContent || '' };
    q('chat-artifact-title').textContent = artifact.language;
    const code = q('chat-artifact-code');
    code.innerHTML = hljs.getLanguage(artifact.language)
      ? hljs.highlight(artifact.code, { language: artifact.language }).value : escape(artifact.code);
    q('chat-artifact').hidden = false;
    layout.classList.add('has-artifact');
    q('chat-artifact-close').focus();
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('کپی شد.');
    } catch {
      setStatus('کپی انجام نشد.');
    }
  };
  const refresh = async (selectedId?: string) => {
    if (api.busy()) return;
    try {
      const models: Model[] = await api.call('chat_models');
      const select = q<HTMLSelectElement>('chat-model');
      const previous = selectedId || select.value || (localStorage.getItem('nocturne-chat-model') || '');
      select.innerHTML = models.length ? models.map(model => `<option value="${escape(modelKey(model))}">${escape(model.name)} · ${engineLabels[model.engine || 'ollama'] || 'Ollama'}</option>`).join('') : '<option value="">ابتدا یک مدل دانلود کن</option>';
      if (models.some(model => modelKey(model) === previous)) select.value = previous;
      installedCards.innerHTML = models.length ? models.map(model => `<button class="chat-installed-card" data-chat-select="${escape(modelKey(model))}"><span>✦</span><div><b>${escape(model.name)}</b><small>${(model.size/1024**3).toFixed(1)} GB · ${engineLabels[model.engine || 'ollama'] || 'Ollama'}</small></div><em>شروع چت ←</em></button>`).join('') : '<p>هنوز مدل چت دانلود نشده است.</p>';
      installedCards.querySelectorAll<HTMLButtonElement>('[data-chat-select]').forEach(button => button.onclick=()=>{select.value=button.dataset.chatSelect!;api.view('chat');document.querySelector('.main')!.scrollTop=0;q('chat-input').focus();});
    } catch(error) { setStatus(String(error)); }
  };
  nav.onclick = () => { api.view('chat'); void refresh(); };
  manager.addEventListener('toggle', () => { if (manager.open) void refresh(); });
  q('chat-manage').onclick = () => { manager.open=true; api.view('models'); document.querySelector<HTMLButtonElement>('[data-library-kind="chat"]')?.click(); document.querySelector('.main')!.scrollTop=0; };
  q('chat-code-toggle').onclick = () => { const editor=q('chat-code-editor'); editor.hidden=!editor.hidden; q('chat-code-toggle').setAttribute('aria-expanded', String(!editor.hidden)); if(!editor.hidden) q('chat-code-input').focus(); };
  q('chat-refresh').onclick = () => void refresh();
  const presets = [['dolphin3:8b','Dolphin 3 · 8B · حدود ۵ GB'],['qwen3.5:4b','Qwen 3.5 · 4B · حدود ۴ GB'],['qwen3-coder:30b','Qwen3 Coder · 30B · حدود ۱۹ GB'],['qwen2.5-coder:3b','Coder 3B · سبک‌تر · حدود ۲ GB']];
  const presetButtons = manager.querySelector('.chat-presets')!;
  presetButtons.innerHTML = presets.map(([id,label]) => `<button class="small-button" data-chat-preset="${id}">${label}</button>`).join('');
  const presetFold = document.createElement('details');
  presetFold.className = 'model-fold chat-suggestions';
  presetFold.innerHTML = '<summary><span>پیشنهادهای Ollama</span><span class="fold-chevron">⌄</span></summary>';
  presetFold.append(presetButtons);
  catalog.after(presetFold);
  const searchResults=document.createElement('div');searchResults.id='chat-search-results';
  searchResults.innerHTML = '<p class="chat-search-note">برای پیدا کردن مدل، در کادر بالای کتابخانه جست‌وجو کن.</p>';
  catalog.prepend(searchResults);
  const pull = (payload: Record<string, unknown>, size?: number) => {
    const id = String(payload.model || payload.repo || '');
    if (id) api.queueDownload(id, payload, size);
  };
  document.addEventListener('nocturne-chat-installed', event => {
    const id = (event as CustomEvent<string>).detail;
    if (id) { installedFold.open = true; void refresh(id); }
  });
  document.addEventListener('nocturne-chat-search',async event=>{
    if(api.busy())return;
    api.setBusy(true,'در حال جست‌وجوی مدل‌های چت...');
    searchResults.innerHTML='<p class="search-placeholder">در حال جست‌وجو...</p>';
    try{
      const detail=(event as CustomEvent<string|{query:string;source:string}>).detail;
      const data=await api.call('chat_search',typeof detail==='string'?{query:detail}:detail);
      searchResults.innerHTML=`${data.note ? `<p class="chat-search-note">${escape(data.note)}</p>` : ''}${data.models.map((model:{name:string;repo?:string;source?:string;downloads?:number;unverified?:boolean})=>`<article class="chat-search-card"><div class="model-symbol">✦</div><b>${escape(model.name)}</b><small>${model.source==='huggingface' ? 'Hugging Face · GGUF · '+Number(model.downloads||0).toLocaleString('fa-IR')+' دانلود' : model.unverified ? 'نام واردشده · وجود مدل هنوز تأیید نشده' : 'Ollama · اندازه پس از شروع دریافت مشخص می‌شود'}</small>${model.repo ? `<button class="small-button" data-chat-hf-info="${escape(model.repo)}">بررسی نسخه‌ها و حجم</button><div class="hf-chat-variants"></div>` : `<button class="small-button" data-chat-download="${escape(model.name)}">دانلود با موتور</button>`}</article>`).join('') || '<p>مدلی پیدا نشد. نام دیگری را امتحان کن.</p>'}`;
      searchResults.querySelectorAll<HTMLButtonElement>('[data-chat-download]').forEach(button => button.onclick = () => void pull({model: button.dataset.chatDownload}));
      searchResults.querySelectorAll<HTMLButtonElement>('[data-chat-hf-info]').forEach(button=>button.onclick=async()=>{
        if(api.busy())return;
        const repo=button.dataset.chatHfInfo!;const target=button.parentElement!.querySelector<HTMLElement>('.hf-chat-variants')!;
        api.setBusy(true,'در حال بررسی نسخه‌های GGUF...');button.disabled=true;target.textContent='در حال خواندن حجم فایل‌ها...';
        try{
          const info=await api.call('chat_hf_info',{repo});
          const variants: HFVariant[] = info.variants;
          if (!variants.length) {
            target.textContent = 'نسخهٔ GGUF کامل پیدا نشد.';
            return;
          }
          target.innerHTML = `<label>نسخهٔ مدل<select data-variant>${variants.map((variant, index) => `<option value="${index}">${escape(variant.tag)} · ${(variant.size/1024**3).toFixed(2)} GB${variant.files > 1 ? ` · ${variant.files} فایل` : ''}</option>`).join('')}</select></label>
            <label>موتور اجرا<select data-engine>${Object.entries(engineLabels).filter(([key]) => !info.engines || info.engines.includes(key)).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
            <small data-engine-help></small><button class="small-button">دانلود نسخهٔ انتخابی</button>`;
          const variantSelect = target.querySelector<HTMLSelectElement>('[data-variant]')!;
          const engineSelect = target.querySelector<HTMLSelectElement>('[data-engine]')!;
          const download = target.querySelector('button')!;
          const syncEngine = () => {
            const variant = variants[Number(variantSelect.value)];
            const ollama = engineSelect.querySelector<HTMLOptionElement>('option[value="ollama"]')!;
            ollama.disabled = !variant.ollama_tag;
            if (ollama.disabled && engineSelect.value === 'ollama') engineSelect.value = 'llama-cpu';
            const help = engineSelect.value === 'llama-vulkan' ? 'نیازمند کارت و درایور سازگار با Vulkan.'
              : engineSelect.value === 'llama-cpu' ? 'اجرا روی CPU؛ حافظهٔ اصلی سیستم برای مدل لازم است.'
              : engineSelect.value === 'llama-cuda' ? 'برای کارت NVIDIA با درایور سازگار؛ بستهٔ CUDA جداگانه دانلود می‌شود.'
              : engineSelect.value === 'llama-rocm' ? 'برای کارت AMD و درایور سازگار با ROCm.'
              : engineSelect.value === 'llama-openvino' ? 'برای سخت‌افزار Intel یا پردازندهٔ سازگار با OpenVINO.'
              : 'Ollama دستگاه اجرا را انتخاب می‌کند.';
            target.querySelector('[data-engine-help]')!.textContent = help + (info.gated ? ' این مخزن به مجوز Hugging Face نیاز دارد.' : '');
          };
          variantSelect.onchange = engineSelect.onchange = syncEngine;
          syncEngine();
          download.onclick = () => {
            const variant = variants[Number(variantSelect.value)];
            const engine = engineSelect.value;
            if (engine === 'ollama' && variant.ollama_tag) void pull({model: `hf.co/${repo}:${variant.ollama_tag}`}, variant.size);
            if (engine !== 'ollama') void pull({engine, repo, revision: info.revision, filename: variant.filenames[0]}, variant.size);
          };
        }catch(error){target.textContent=String(error);}finally{button.disabled=false;api.setBusy(false);}
      });
    }catch(error){searchResults.textContent=String(error);}finally{api.setBusy(false);}
  });
  const retryFiles = new WeakMap<Message, Attachment[]>();

  const runReply = async (thread: Thread, user: Message, files: Attachment[], previous?: Message) => {
    const model = modelSelect.value;
    if (api.busy() || readingFiles || !model) return;
    const answer: Message = { role: 'assistant', content: '' };
    const context: Message[] = [];
    let remaining = 14000;
    for (const message of thread.messages.slice(-40).reverse()) {
      if (context.length && message.content.length > remaining) break;
      if (!message.content.trim()) continue;
      context.unshift({ role: message.role, content: message.content });
      remaining -= message.content.length;
    }
    const task = { id: crypto.randomUUID(), inFlight: false, stopped: false } as NonNullable<typeof run>;
    run = task;
    thread.messages.push(answer);
    generating = true;
    api.setBusy(true, user.agent ? 'ایجنت در حال کار است…' : 'در حال پاسخ‌دادن…');
    stopButton.hidden = false;
    stopButton.disabled = false;
    sendButton.hidden = true;
    setStatus('در حال آماده‌سازی…');
    renderThreads();
    render(true);
    let offToken = () => {};
    let offStep = () => {};
    let frame = 0;
    try {
      offToken = await listen<{ text: string; request_id: string }>('chat-token', ({ payload }) => {
        if (payload.request_id !== task.id || task.stopped) return;
        answer.content += payload.text;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const live = messageBox.querySelector('.chat-live-text');
          const atBottom = messageBox.scrollHeight - messageBox.scrollTop - messageBox.clientHeight < 90;
          if (live) live.textContent = answer.content;
          if (atBottom) messageBox.scrollTop = messageBox.scrollHeight;
        });
      });
      offStep = await listen<{ label: string; request_id: string }>('chat-agent-step', ({ payload }) => {
        if (payload.request_id !== task.id || task.stopped) return;
        (answer.steps ??= []).push(payload.label);
        setStatus(payload.label);
        render();
      });
      if (!task.stopped) {
        task.inFlight = true;
        const result = await api.call('chat_generate', {
          model, messages: context, cpu: q<HTMLInputElement>('chat-cpu').checked,
          request_id: task.id, agent: user.agent || false, attachments: files,
        });
        if (!task.stopped && typeof result.text === 'string') answer.content = result.text;
        if (!task.stopped && !answer.content.trim()) setStatus('مدل پاسخ خالی فرستاد.');
        else if (!task.stopped) setStatus('پاسخ کامل شد.');
      }
    } catch (error) {
      if (!task.stopped) setStatus(String(error));
    } finally {
      task.inFlight = false;
      await task.stopping;
      offToken();
      offStep();
      cancelAnimationFrame(frame);
      if (!answer.content.trim()) {
        thread.messages.pop();
        if (previous) thread.messages.push(previous);
      }
      if (task.stopped) setStatus('پاسخ متوقف شد.');
      run = undefined;
      generating = false;
      save();
      render();
      renderThreads();
      stopButton.hidden = true;
      sendButton.hidden = false;
      api.setBusy(false);
    }
  };

  stopButton.onclick = () => {
    const task = run;
    if (!task || task.stopped) return;
    task.stopped = true;
    stopButton.disabled = true;
    setStatus('در حال توقف…');
    task.stopping = (async () => {
      while (task.inFlight) {
        try {
          if (await invoke<boolean>('cancel_download')) return;
        } catch (error) {
          task.stopped = false;
          stopButton.disabled = false;
          setStatus(String(error));
          return;
        }
        await new Promise(resolve => window.setTimeout(resolve, 100));
      }
    })();
  };

  const send = async () => {
    if (api.busy() || readingFiles) return;
    const code = codeInput.value;
    const fence = String.fromCharCode(96).repeat(3);
    const content = input.value.trim() + (code.trim() ? '\n\n' + fence + codeLanguage.value + '\n' + code + '\n' + fence : '');
    if (!modelSelect.value || !content.trim()) {
      setStatus('ابتدا مدل و پیام را انتخاب کن.');
      return;
    }
    if (content.length > (agent ? 10000 : 20000)) {
      setStatus(agent ? 'پیام ایجنت باید کمتر از ۱۰ هزار نویسه باشد.' : 'پیام و کد را به بخش‌های کوتاه‌تر از ۲۰ هزار نویسه تقسیم کن.');
      return;
    }
    let thread = activeThread();
    if (!thread) {
      thread = { id: activeId, title: titleFor(content), messages: [] };
      threads.unshift(thread);
    }
    const user: Message = { role: 'user', content, agent, attached: attachments.length > 0, fileNames: attachments.map(file => file.name) };
    thread.messages.push(user);
    retryFiles.set(user, attachments);
    const files = attachments;
    attachments = [];
    input.value = '';
    codeInput.value = '';
    codeEditor.hidden = true;
    q('chat-code-toggle').setAttribute('aria-expanded', 'false');
    renderAttachments();
    save();
    await runReply(thread, user, files);
  };

  const retry = () => {
    if (api.busy() || readingFiles) return;
    const thread = activeThread();
    const last = thread?.messages.at(-1);
    const user = last?.role === 'assistant' ? thread?.messages.at(-2) : last;
    if (!thread || user?.role !== 'user') return;
    if (!modelSelect.value) return setStatus('ابتدا مدل چت را انتخاب کن.');
    const files = retryFiles.get(user) || (user.attached ? attachments : []);
    if (user.attached && !files.length) return setStatus('برای تکرار این پاسخ، فایل‌های قبلی را دوباره پیوست کن.');
    if (last?.role === 'assistant') thread.messages.pop();
    void runReply(thread, user, user.agent ? files : [], last?.role === 'assistant' ? last : undefined);
  };

  q('chat-new').onclick = () => selectThread(crypto.randomUUID());
  q('chat-delete').onclick = () => {
    if (generating || readingFiles || !activeThread() || !window.confirm('این گفتگو حذف شود؟')) return;
    const id = activeId;
    threads = threads.filter(thread => thread.id !== id);
    selectThread(threads[0]?.id || crypto.randomUUID());
    drafts.delete(id);
  };
  historySearch.oninput = renderThreads;
  q('chat-threads').onclick = event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-thread]');
    if (button) selectThread(button.dataset.thread!);
  };
  q('chat-history-toggle').onclick = () => {
    const hidden = layout.classList.toggle('history-collapsed');
    q('chat-history-toggle').setAttribute('aria-expanded', String(!hidden));
  };
  modelSelect.onchange = () => localStorage.setItem('nocturne-chat-model', modelSelect.value);
  agentButton.onclick = () => {
    if (generating || readingFiles) return;
    if (agent && attachments.length) return setStatus('برای خاموش‌کردن ایجنت، پیوست‌ها را بردار.');
    setAgent(!agent);
    setStatus(agent ? 'ایجنت روشن است. می‌توانی فایل متنی پیوست کنی.' : '');
  };

  const fileInput = q<HTMLInputElement>('chat-files');
  q('chat-attach').onclick = () => { if (!generating && !readingFiles) fileInput.click(); };
  fileInput.onchange = async () => {
    const selected = Array.from(fileInput.files || []);
    fileInput.value = '';
    if (generating || readingFiles || !selected.length) return;
    if (attachments.length + selected.length > 5 || selected.some(file => file.size > 40000)) {
      return setStatus('حداکثر ۵ فایل متنی، هرکدام تا ۴۰ کیلوبایت.');
    }
    readingFiles = true;
    try {
      const added = await Promise.all(selected.map(async file => ({ name: file.name, text: await file.text() })));
      if (added.some(file => /[\u0000\uFFFD]/.test(file.text))) throw new Error('فایل متنی UTF-8 انتخاب کن.');
      attachments = [...attachments, ...added];
      setAgent(true);
      renderAttachments();
      setStatus('پیوست‌ها برای پیام بعد آماده‌اند.');
    } catch (error) {
      setStatus(String(error));
    } finally {
      readingFiles = false;
    }
  };
  q('chat-attachments').onclick = event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-remove-file]');
    if (button && !readingFiles) {
      attachments = attachments.filter((_, index) => index !== Number(button.dataset.removeFile));
      renderAttachments();
    }
  };

  messageBox.onclick = event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.starter) { input.value = button.dataset.starter; input.focus(); }
    if (button.hasAttribute('data-retry')) retry();
    if (button.dataset.copyAnswer) {
      const answer = activeThread()?.messages[Number(button.dataset.copyAnswer)];
      if (answer) void copy(answer.content);
    }
    const block = button.closest<HTMLElement>('.code-box');
    if (block && button.classList.contains('open-code')) openArtifact(block);
    else if (block && button.classList.contains('copy-code')) void copy(block.querySelector('code')?.textContent || '');
  };

  q('chat-artifact-close').onclick = closeArtifact;
  q('chat-artifact-copy').onclick = () => void copy(artifact.code);
  q('chat-artifact-save').onclick = () => {
    const extensions: Record<string, string> = { python: 'py', javascript: 'js', typescript: 'ts', rust: 'rs', html: 'html', css: 'css', json: 'json', bash: 'sh' };
    const url = URL.createObjectURL(new Blob([artifact.code], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nocturne-code.' + (extensions[artifact.language] || 'txt');
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  sendButton.onclick = () => void send();
  input.onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void send();
    }
  };
  renderThreads();
  render();
}
