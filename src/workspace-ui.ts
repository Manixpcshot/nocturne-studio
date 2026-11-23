import './workspace-ui.css';
import cover from './assets/nocturne-cover.webp';

export const pages = {
  home: { label: 'خانه', group: '' },
  studio: { label: 'ساخت تصویر', group: 'استودیو' },
  video: { label: 'ساخت ویدیو', group: 'استودیو' },
  voice: { label: 'ساخت صدا', group: 'استودیو' },
  batch: { label: 'ساخت دسته‌ای', group: 'استودیو' },
  chat: { label: 'چت و کدنویسی', group: 'استودیو' },
  models: { label: 'کتابخانهٔ مدل‌ها', group: 'کتابخانه' },
  gallery: { label: 'گالری من', group: 'کتابخانه' },
  'audio-gallery': { label: 'گالری صدا', group: 'کتابخانه' },
  website: { label: 'وب‌سایت', group: 'مدیریت' },
  settings: { label: 'تنظیمات', group: '' },
} as const;

type Page = keyof typeof pages;
const startKey = 'nocturne-start-page';
const lastKey = 'nocturne-last-page';
const compactKey = 'nocturne-compact-navigation';
const densityKey = 'nocturne-density';
const motionKey = 'nocturne-motion';
const aspectKey = 'nocturne-default-aspect';

export function pageInfo(page: string) {
  return Object.hasOwn(pages, page) ? pages[page as Page] : undefined;
}

export function rememberPage(page: string) {
  localStorage.setItem(lastKey, page);
}

export function startPage() {
  const saved = localStorage.getItem(startKey);
  const page = saved === 'last' ? localStorage.getItem(lastKey) : saved;
  return page && pageInfo(page) ? page : 'home';
}

const settingsTabs = [
  ['appearance', 'ظاهر'],
  ['startup', 'صفحهٔ شروع و پردازش'],
  ['privacy', 'حریم خصوصی و اعلان‌ها'],
  ['storage', 'پوشه‌ها و فضای ذخیره‌سازی'],
] as const;

const privacyControls = [
  ['temporary-image', 'عکس‌ها ابتدا موقت باشند'],
  ['hide-image', 'پنهان‌کردن تصویر روی بوم'],
  ['hide-recent', 'پنهان‌کردن عکس‌های اخیر'],
  ['hide-compare', 'پنهان‌کردن نتیجهٔ مقایسه'],
  ['hide-gallery', 'تارکردن تصاویر گالری'],
] as const;

export function workspacePages(themeOptions: string, aspectOptions: string, icon: (name: 'WandSparkles' | 'Film' | 'Mic2' | 'Layers' | 'Blocks' | 'Images' | 'ArrowUpLeft' | 'Sparkles' | 'Globe2') => string) {
  const cards = [
    ['video', 'Film', 'ساخت ویدیو از پرامپت'],
    ['voice', 'Mic2', 'تبدیل متن به گفتار'],
    ['chat', 'Sparkles', 'گفتگو با مدل محلی'],
    ['batch', 'Layers', 'ساخت چند تصویر و مدیریت صف'],
    ['gallery', 'Images', 'تصاویر ذخیره‌شده و پرامپت‌های قبلی'],
    ['website', 'Globe2', 'مدیریت سایت، کاربران و سهمیه‌ها'],
  ] as const;
  const startOptions = (Object.keys(pages) as Page[]).filter(page => page !== 'settings');
  const savedStart = localStorage.getItem(startKey) || 'home';
  const validStart = savedStart === 'last' || startOptions.some(page => page === savedStart) ? savedStart : 'home';
  const option = (value: string, label: string) => `<option value="${value}" ${validStart === value ? 'selected' : ''}>${label}</option>`;
  return `
    <section class="view" id="home-view">
      <header class="home-hero">
        <div class="hero-content">
          <div class="hero-wordmark" dir="ltr">Nocturne <span>Studio</span></div>
          <h1>از ایده تا اثر</h1>
          <p>تصویر بساز، ویدیو و صدا تولید کن یا با مدل‌های محلی گفت‌وگو کن.</p>
          <div class="hero-actions">
            <button type="button" class="primary-button" data-open-workspace="studio">${icon('WandSparkles')} <span>ساخت تصویر</span></button>
            <button type="button" class="small-button" data-open-workspace="models">${icon('Blocks')} <span>کتابخانهٔ مدل‌ها</span></button>
          </div>
        </div>
        <img class="hero-cover" src="${cover}" alt="" fetchpriority="high"/>
      </header>
      <section class="home-tools" aria-labelledby="home-tools-title">
        <h2 id="home-tools-title">ابزارهای استودیو</h2>
        <div class="workspace-launchers">${cards.map(([page, symbol, description]) => `
          <button type="button" class="workspace-launcher" data-open-workspace="${page}">
            <span class="launcher-symbol" aria-hidden="true">${icon(symbol)}</span>
            <span><b>${pages[page].label}</b><small>${description}</small></span>
            <span class="launcher-arrow" aria-hidden="true">${icon('ArrowUpLeft')}</span>
          </button>`).join('')}</div>
      </section>
    </section>
    <section class="view" id="settings-view">
      <div class="section-head"><h1>تنظیمات</h1><p>ظاهر و رفتار برنامه را برای خودت تنظیم کن.</p></div>
      <div class="preferences-layout">
        <nav class="preferences-nav" aria-label="بخش‌های تنظیمات">
          ${settingsTabs.map(([id, title]) => `<button type="button" data-settings-tab="${id}">${title}</button>`).join('')}
        </nav>
        <div class="preferences-content">
          <section class="preferences-card" data-settings-panel="appearance">
            <h2>ظاهر</h2>
            <label class="preference-row"><span>تم برنامه</span><select id="theme-select">${themeOptions}</select></label>
            <label class="preference-row"><span>زبان برنامه</span><select id="language-select"><option value="fa">فارسی</option><option value="en">English</option></select></label>
            <label class="preference-row"><span>فاصلهٔ عناصر</span><select id="preference-density"><option value="compact">جمع‌وجور</option><option value="comfortable">راحت</option></select></label>
            <label class="preference-row"><span>منوی فقط‌آیکون</span><input id="preference-compact-nav" type="checkbox"/></label>
            <label class="preference-row"><span>کاهش انیمیشن‌ها</span><input id="preference-reduce-motion" type="checkbox"/></label>
            <div class="preference-row"><span>ظاهر پیش‌فرض</span><button id="reset-appearance" type="button" class="small-button">بازگردانی ظاهر</button></div>
          </section>
          <section class="preferences-card" data-settings-panel="startup" hidden>
            <h2>صفحهٔ شروع و پردازش</h2>
            <label class="preference-row"><span>صفحه هنگام بازشدن</span><select id="preference-start-page">${startOptions.map(page => option(page, pages[page].label)).join('')}${option('last', 'آخرین صفحه')}</select></label>
            <label class="preference-row"><span>نسبت پیش‌فرض تصویر</span><select id="preference-aspect">${aspectOptions}</select></label>
            <div id="preferences-processing" class="preferences-subgrid"></div>
          </section>
          <section class="preferences-card" data-settings-panel="privacy" hidden>
            <h2>حریم خصوصی و اعلان‌ها</h2>
            <label class="preference-row"><span>اعلان ویندوز</span><input type="checkbox" id="preference-notifications"/></label>
            ${privacyControls.map(([id, label]) => `<label class="preference-row"><span>${label}</span><input type="checkbox" data-preference-mirror="${id}"/></label>`).join('')}
            <div class="preference-row"><span>رمز گالری</span><button id="preferences-gallery-pin" type="button" class="small-button">مدیریت قفل گالری</button></div>
          </section>
          <section class="preferences-card" data-settings-panel="storage" hidden>
            <h2>پوشه‌ها و فضای ذخیره‌سازی</h2>
            <div id="preferences-storage" class="preferences-subgrid"></div>
          </section>
        </div>
      </div>
    </section>
    <dialog id="workspace-command" class="workspace-command" aria-labelledby="workspace-command-title">
      <header><h2 id="workspace-command-title">رفتن به بخش…</h2><button type="button" id="workspace-command-close" class="small-button">بستن</button></header>
      <label class="command-search"><span>نام بخش</span><input id="workspace-command-query" type="search" autocomplete="off" autofocus/></label>
      <div id="workspace-command-results" class="workspace-command-results"></div>
    </dialog>`;
}

export function mountWorkspacePreferences(api: { setCompact: (compact: boolean) => void; go: (page: string) => void; translate: (text: string) => string }) {
  const select = (id: string) => document.querySelector<HTMLSelectElement>('#' + id)!;
  const inputField = (id: string) => document.querySelector<HTMLInputElement>('#' + id)!;
  const nav = inputField('preference-compact-nav');
  const motion = inputField('preference-reduce-motion');
  const density = select('preference-density');
  const aspect = select('preference-aspect');
  const notification = inputField('preference-notifications');
  const bell = document.querySelector<HTMLButtonElement>('#image-notifications')!;

  function applyAppearance() {
    nav.checked = localStorage.getItem(compactKey) === '1';
    motion.checked = localStorage.getItem(motionKey) === '1';
    density.value = localStorage.getItem(densityKey) === 'comfortable' ? 'comfortable' : 'compact';
    document.documentElement.classList.toggle('reduce-motion', motion.checked);
    document.documentElement.dataset.density = density.value;
    api.setCompact(nav.checked);
  }

  applyAppearance();
  nav.onchange = () => {
    localStorage.setItem(compactKey, nav.checked ? '1' : '0');
    applyAppearance();
  };
  motion.onchange = () => {
    localStorage.setItem(motionKey, motion.checked ? '1' : '0');
    applyAppearance();
  };
  density.onchange = () => {
    localStorage.setItem(densityKey, density.value);
    applyAppearance();
  };
  document.querySelector<HTMLButtonElement>('#reset-appearance')!.onclick = () => {
    for (const key of [compactKey, densityKey, motionKey]) localStorage.removeItem(key);
    applyAppearance();
    select('theme-select').value = 'dusk';
    select('theme-select').dispatchEvent(new Event('change', { bubbles: true }));
  };

  const chosenAspect = localStorage.getItem(aspectKey) || '1:1';
  if (Array.from(aspect.options).some(option => option.value === chosenAspect)) aspect.value = chosenAspect;
  select('image-aspect').value = aspect.value;
  aspect.onchange = () => {
    localStorage.setItem(aspectKey, aspect.value);
    select('image-aspect').value = aspect.value;
  };
  const startup = select('preference-start-page');
  startup.onchange = () => localStorage.setItem(startKey, startup.value);

  for (const mirror of document.querySelectorAll<HTMLInputElement>('[data-preference-mirror]')) {
    const control = inputField(mirror.dataset.preferenceMirror!);
    mirror.checked = control.checked;
    control.addEventListener('change', () => { mirror.checked = control.checked; });
    mirror.onchange = () => {
      control.checked = mirror.checked;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    };
  }
  const syncNotification = () => { notification.checked = bell.getAttribute('aria-pressed') === 'true'; };
  syncNotification();
  bell.addEventListener('click', () => queueMicrotask(syncNotification));
  notification.onchange = () => bell.click();
  document.querySelector<HTMLButtonElement>('#preferences-gallery-pin')!.onclick = () =>
    document.querySelector<HTMLButtonElement>('#gallery-set-pin')!.click();

  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-settings-tab]'));
  const panels = document.querySelectorAll<HTMLElement>('[data-settings-panel]');
  const chooseTab = (tab: string) => {
    for (const button of tabs) button.setAttribute('aria-pressed', String(button.dataset.settingsTab === tab));
    for (const panel of panels) panel.hidden = panel.dataset.settingsPanel !== tab;
  };
  chooseTab('appearance');
  for (const button of tabs) button.onclick = () => chooseTab(button.dataset.settingsTab!);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open-workspace]')) {
    button.onclick = () => api.go(button.dataset.openWorkspace!);
  }

  const dialog = document.querySelector<HTMLDialogElement>('#workspace-command')!;
  const input = inputField('workspace-command-query');
  const resultList = document.querySelector('#workspace-command-results')!;
  const opener = document.querySelector<HTMLButtonElement>('#workspace-command-open')!;
  const openSettings = document.querySelector<HTMLButtonElement>('#workspace-settings-open')!;
  openSettings.onclick = () => api.go('settings');
  const normalize = (text: string) => text.toLowerCase().normalize('NFKC')
    .replace(/[\u200c\s]+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim();
  const renderResults = () => {
    const query = normalize(input.value);
    const matches = Object.entries(pages).filter(([id, page]) =>
      [id, page.label, page.group, api.translate(page.label), api.translate(page.group)].some(text => normalize(text).includes(query)));
    resultList.replaceChildren(...matches.map(([id, page]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'command-result';
      button.textContent = api.translate(page.label);
      if (page.group) {
        const group = document.createElement('small');
        group.textContent = api.translate(page.group);
        button.append(group);
      }
      button.onclick = () => { dialog.close(); api.go(id); };
      return button;
    }));
    if (!matches.length) {
      const message = document.createElement('p');
      message.textContent = api.translate('بخشی پیدا نشد.');
      resultList.append(message);
    }
  };
  const openCommand = () => {
    if (dialog.open || document.documentElement.classList.contains('privacy-cover') ||
        document.querySelector('#setup-overlay:not(.hidden), #viewer-modal:not(.hidden), #gallery-lock:not(.hidden)')) return;
    input.value = '';
    renderResults();
    dialog.showModal();
    input.focus();
  };
  opener.onclick = openCommand;
  document.querySelector<HTMLButtonElement>('#workspace-command-close')!.onclick = () => dialog.close();
  input.oninput = renderResults;
  dialog.onkeydown = event => {
    const results = Array.from(resultList.querySelectorAll('button'));
    if (!results.length || event.isComposing) return;
    const index = results.findIndex(button => button === document.activeElement);
    if (event.key === 'Enter' && document.activeElement === input) {
      event.preventDefault();
      results[0].click();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? index + 1 : index < 0 ? results.length - 1 : index - 1;
      (results[next] || input).focus();
    }
  };
  window.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'k' && !event.isComposing) {
      event.preventDefault();
      openCommand();
    }
  });
}
