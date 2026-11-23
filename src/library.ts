import { invoke } from '@tauri-apps/api/core';

type Kind = 'image' | 'video' | 'voice' | 'chat';
type Scope = 'find' | 'installed';
export function mountLibrary(api: { busy: () => boolean; view: (view: string) => void; searchImage: () => Promise<void>; searchVoice: () => Promise<void>; symbol: (kind: Kind) => string }) {
  const root = document.querySelector<HTMLElement>('#models-view')!;
  root.classList.add('unified-library');
  root.querySelector('h1')!.textContent = 'کتابخانهٔ مدل‌ها';
  root.querySelector('.section-head p')!.remove();
  const oldTabs = root.querySelector<HTMLElement>('.kind-tabs')!; oldTabs.hidden=true;
  const header=document.createElement('div'); header.className='library-header';
  header.innerHTML=`<div class="library-tabs">${(['image','video','voice','chat'] as Kind[]).map(kind=>`<button class="library-tab" data-library-kind="${kind}">${api.symbol(kind)}<span>${({image:'تصویر',video:'ویدیو',voice:'صدا',chat:'چت و کدنویسی'})[kind]}</span></button>`).join('')}</div><div class="library-scopes" role="group" aria-label="نمای مدل‌ها">
    <button type="button" class="small-button" data-library-scope="find">پیداکردن مدل</button>
    <button type="button" class="small-button" data-library-scope="installed">مدل‌های نصب‌شده</button>
  </div><div class="library-search"><input id="library-query" placeholder="نام مدل، خانواده یا زبان را بنویس…"/><button id="library-search-button" class="primary-button" data-work>جست‌وجوی مدل‌ها</button></div><p id="library-source"></p>`;
  oldTabs.after(header);
  const diffusion=root.querySelector<HTMLElement>('.model-layout')!;
  diffusion.firstElementChild!.classList.add('library-installed-pane');
  const voiceSearch=document.querySelector<HTMLElement>('#voice-view .voice-card:last-child')!;
  const voice=document.createElement('div'); voice.className='library-voice-pane';
  const voiceLocal=document.createElement('div');voiceLocal.className='model-card library-voice-local';
  voiceLocal.innerHTML='<div class="card-heading"><h2>مدل‌های صدای نصب‌شده</h2></div>';
  voiceLocal.append(document.querySelector('#installed-voices')!);
  voice.append(voiceLocal,voiceSearch);
  const chat=root.querySelector<HTMLDetailsElement>('.chat-model-manager')!;
  root.append(voice,chat);
  const progress=document.createElement('details');progress.className='library-downloads model-fold';progress.open=false;
  progress.innerHTML='<summary>دانلودها <span class="fold-chevron">⌄</span></summary><div class="library-download-body"><p id="library-download-status">دانلودها با انتخاب شما شروع می‌شوند.</p><button id="library-cancel" class="small-button" hidden>توقف دانلود</button></div>';
  const body=progress.querySelector('.library-download-body')!;
  body.append(document.querySelector('#download-progress')!,document.querySelector('#voice-download-progress')!,document.querySelector('#chat-progress')!);
  body.append(root.querySelector('#resume-download')!);
  const controls = document.createElement('div');
  controls.className = 'library-utilities';
  const folders = document.createElement('button');
  folders.type = 'button';
  folders.className = 'small-button library-folders-link';
  folders.textContent = 'پوشه‌ها';
  folders.onclick = () => {
    api.view('settings');
    document.querySelector<HTMLButtonElement>('[data-settings-tab="storage"]')!.click();
  };
  controls.append(progress, diffusion.querySelector('.library-tools-fold')!, folders);
  header.after(controls);
  const feedback=document.querySelector<HTMLElement>('#library-download-status')!;
  const cancel=document.querySelector<HTMLButtonElement>('#library-cancel')!;
  cancel.onclick=()=>void invoke('cancel_download').catch(error=>{feedback.textContent=String(error);});
  // Keep existing engine-specific progress paths, with one visible download centre.
  for(const id of ['voice-status','download-phase']){
    const source=document.getElementById(id)!;
    new MutationObserver(()=>{
      if(api.busy()){feedback.textContent=source.textContent;progress.open=true;}
      cancel.hidden=!api.busy();
    }).observe(source,{subtree:true,childList:true,characterData:true});
  }
  new MutationObserver(()=>{if (!api.busy()) cancel.hidden=true;}).observe(document.getElementById('work-status')!,{subtree:true,childList:true});
  document.addEventListener('nocturne-chat-download', event => {
    const {active, text} = (event as CustomEvent<{active: boolean; text: string}>).detail;
    feedback.textContent = text;
    cancel.hidden = !active;
    progress.open = true;
  });
  const query=document.querySelector<HTMLInputElement>('#library-query')!;
  const source=document.querySelector<HTMLElement>('#library-source')!;
  const chatSource=document.createElement('select');chatSource.id='library-chat-source';chatSource.setAttribute('aria-label','منبع مدل چت');
  chatSource.innerHTML='<option value="huggingface">Hugging Face · GGUF</option><option value="ollama">Ollama</option>';
  header.querySelector('.library-search')!.prepend(chatSource);chatSource.hidden=true;
  const queries:Record<Kind,string>={image:'',video:'',voice:'فارسی',chat:''};
  let current: Kind = 'image';
  let scope: Scope = 'find';
  const selectScope = (next: Scope) => {
    scope = next;
    root.dataset.libraryScope = scope;
    root.querySelectorAll<HTMLButtonElement>('[data-library-scope]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.libraryScope === scope)));
    if (scope === 'installed' && current === 'chat') {
      chat.querySelector<HTMLDetailsElement>('.chat-installed-fold')!.open = true;
      chat.querySelector<HTMLButtonElement>('#chat-refresh')!.click();
    }
  };
  root.querySelectorAll<HTMLButtonElement>('[data-library-scope]').forEach(button => {
    button.onclick = () => selectScope(button.dataset.libraryScope as Scope);
  });
  const select=(kind:Kind,sync=true)=>{
    queries[current]=query.value;current=kind;query.value=queries[kind];
    root.dataset.libraryKind=kind;
    chatSource.hidden=kind!=='chat';
    diffusion.hidden=kind!=='image'&&kind!=='video';voice.hidden=kind!=='voice';chat.hidden=kind!=='chat';
    if (kind === 'chat') {
      chat.open = true;
      if (scope === 'installed') selectScope(scope);
    }
    root.querySelectorAll<HTMLButtonElement>('[data-library-kind]').forEach(button => {
      const selected = button.dataset.libraryKind === kind;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    source.textContent=kind==='chat'?'برای مدل‌های GGUF می‌توانی موتور Ollama، llama.cpp CPU یا llama.cpp Vulkan را انتخاب کنی.':kind==='voice'?'Hugging Face · نام مدل یا زبان، مثلاً فارسی یا English':'Hugging Face · مدل کامل، تک‌فایل، LoRA و GGUF';
    if(sync&&(kind==='image'||kind==='video'))root.querySelector<HTMLButtonElement>(`[data-kind="${kind}"]`)!.click();
    if(kind==='voice')document.querySelector<HTMLButtonElement>('#refresh-installed-voices')!.click();
  };
  root.querySelectorAll<HTMLButtonElement>('[data-library-kind]').forEach(button=>button.onclick=()=>select(button.dataset.libraryKind as Kind));
  root.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(button=>button.addEventListener('click',()=>select(button.dataset.kind as Kind,false)));
  document.querySelector<HTMLButtonElement>('#voice-model-tab')!.onclick=()=>select('voice');
  const search=async()=>{
    if(api.busy())return;
    queries[current]=query.value;
    if(current==='chat'){
      document.dispatchEvent(new CustomEvent('nocturne-chat-search',{detail:{query:query.value.trim(),source:chatSource.value}}));return;
    }
    if(current==='voice'){
      document.querySelector<HTMLInputElement>('#voice-search-input')!.value=query.value;
      await api.searchVoice();
    }else{
      document.querySelector<HTMLInputElement>('#search-input')!.value=query.value;
      await api.searchImage();
    }
  };
  document.querySelector<HTMLButtonElement>('#library-search-button')!.onclick=()=>void search();
  query.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();void search();}};
  const voiceLink=document.createElement('button');voiceLink.className='small-button';voiceLink.textContent='پیداکردن و دانلود مدل صدا';
  document.querySelector('#voice-view .voice-card')!.prepend(voiceLink);
  voiceLink.onclick=()=>{api.view('models');selectScope('find');select('voice');};
  document.querySelectorAll<HTMLButtonElement>('[data-chat-preset]').forEach(button=>button.addEventListener('click',()=>{chatSource.value='ollama';query.value=button.dataset.chatPreset!;void search();}));
  document.querySelectorAll<HTMLButtonElement>('[data-search-family]').forEach(button=>button.addEventListener('click',()=>{query.value=button.dataset.searchFamily!;}));
  for(const [id,value] of [['persian-voice-search','فارسی'],['popular-voice-search','']])document.getElementById(id)!.addEventListener('click',()=>{query.value=value;});
  selectScope('find');
  select('image',false);
}
