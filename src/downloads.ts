import './downloads.css';
import { stored } from './projects';

export type DownloadKind = 'image' | 'video' | 'sdcpp' | 'checkpoint' | 'adapter' | 'voice' | 'chat';
export type Transfer = { model_id: string; job_id?: string; phase?: string; file?: string; processed?: number; total?: number; speed?: number; received?: number; retry_in?: number; error?: string };
export type EngineUpgrade = { installed: string; minimum: string; profile: 'minimax-h3' };
export type DownloadPlan = {
  upgrade?: EngineUpgrade | null;
  download_kind?: string | null; gated?: boolean; reason?: string; folder?: string;
  download_bytes?: number | null; remaining_bytes?: number | null; required_bytes?: number | null; free_bytes?: number | null;
  requirements?: string[]; revisions?: Record<string, string>; variants?: { name: string; size: number }[];
  file_plan?: { name: string; size: number | null; remaining: number | null }[];
};
type State = 'queued' | 'running' | 'paused' | 'waiting' | 'failed' | 'ready' | 'dependency';
export type DownloadJob = {
  key: string; id: string; kind: DownloadKind; payload: Record<string, unknown>;
  folder?: string; state: State; finishedAt?: number; progress?: Transfer; error?: string; retryAt?: number; attempts?: number;
};
type Request = Pick<DownloadJob, 'id' | 'kind' | 'payload'> & { size?: number };
type Api = {
  available: () => boolean;
  english: () => boolean;
  busy: () => boolean;
  plan: (request: Request, variant?: string) => Promise<DownloadPlan>;
  run: (job: DownloadJob, bandwidth: number) => Promise<'ready' | 'dependency'>;
  stop: (job: DownloadJob) => Promise<boolean>;
  partials: (job: DownloadJob, expected?: number) => Promise<{ bytes: number; files: number }>;
  open: (job: DownloadJob) => void;
  error: (message: string) => void;
  upgrade: () => Promise<true | string>;
  notify: (message: string) => void;
};
const key = 'nocturne-download-center-v1';
const bandwidthKey = 'nocturne-download-bandwidth';
const concurrencyKey = 'nocturne-download-concurrency';
const suspensionKey = 'nocturne-download-suspended';
const alertsKey = 'nocturne-download-notifications';
type Lane = 'active' | 'queue' | 'history';
function laneOf(state: State): Lane {
  return state === 'running' ? 'active' : state === 'ready' || state === 'dependency' ? 'history' : 'queue';
}
const connectionError = /\b(offline|timed?\s*out|connection|network|503|502|504|429|ssl|dns|remote disconnected|another process|download worker stopped)\b|اتصال|شبکه|مهلت اتصال/i;
const blockedError = /\b(401|403|404|gated|unauthorized|forbidden|not found|no space|permission denied|hash mismatch)\b|فضای کافی|صحت فایل|مسیر قبلی/i;
function escape(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

export function mountDownloadCenter(api: Api) {
  const tr = (fa: string, en: string) => api.english() ? en : fa;
  const format = (value: number | null | undefined) => {
    if (value == null) return tr('نامشخص', 'Unknown');
    const unit = value ? Math.max(0, Math.min(4, Math.floor(Math.log(value) / Math.log(1024)))) : 0;
    return new Intl.NumberFormat(api.english() ? 'en-US' : 'fa-IR', { maximumFractionDigits: 2 }).format(value / 1024 ** unit)
      + ' ' + ['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit];
  };
  document.querySelector('.top-actions')!.insertAdjacentHTML('afterbegin',
    '<button type="button" class="small-button" id="download-center-open"></button>');
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="download-center" class="work-dialog transfer-dialog" aria-labelledby="transfer-title">
      <header class="transfer-header">
        <h2 id="transfer-title"></h2>
        <button class="small-button" type="button" data-transfer-close></button>
      </header>
      <section class="transfer-overview">
        <div id="transfer-metrics"></div>
        <div class="transfer-chart" id="transfer-chart" role="img"></div>
      </section>
      <div class="transfer-controls">
        <div id="transfer-filters" role="group"></div>
        <button id="transfer-suspend" type="button" class="small-button"></button>
      </div>
      <details class="transfer-settings"><summary id="transfer-options"></summary>
        <div class="transfer-toolbar">
          <label><span id="transfer-limit-label"></span><input id="transfer-limit" type="number" min="0" max="5000" step="1" /></label>
          <label><span id="transfer-concurrency-label"></span>
            <select id="transfer-concurrency"><option value="1">1</option><option value="2">2</option></select></label>
          <label class="transfer-check"><input id="transfer-alerts" type="checkbox" /><span id="transfer-alerts-label"></span></label>
          <span id="transfer-limit-help"></span>
        </div>
      </details>
      <div id="transfer-list"></div>
    </dialog>
    <dialog id="download-plan" class="work-dialog transfer-dialog" aria-labelledby="download-plan-title">
      <header><h2 id="download-plan-title"></h2><button class="small-button" type="button" data-transfer-close></button></header>
      <strong id="transfer-plan-model" dir="auto"></strong>
      <label id="transfer-variant-wrap" hidden><span id="transfer-variant-label"></span><select id="transfer-variant"></select></label>
      <div id="transfer-plan-body" aria-live="polite"></div>
      <footer><button class="primary-button" type="button" id="transfer-confirm" disabled></button></footer>
    </dialog>
    <aside id="transfer-notice" class="transfer-notice" hidden>
      <p role="status"></p><button type="button" class="small-button" data-notice-downloads></button>
    </aside>`);
  const dialog = document.querySelector<HTMLDialogElement>('#download-center')!;
  const planDialog = document.querySelector<HTMLDialogElement>('#download-plan')!;
  const opener = document.querySelector<HTMLButtonElement>('#download-center-open')!;
  const list = document.querySelector<HTMLElement>('#transfer-list')!;
  const planBody = document.querySelector<HTMLElement>('#transfer-plan-body')!;
  const variant = document.querySelector<HTMLSelectElement>('#transfer-variant')!;
  const confirm = document.querySelector<HTMLButtonElement>('#transfer-confirm')!;
  const limit = document.querySelector<HTMLInputElement>('#transfer-limit')!;
  const filters = document.querySelector<HTMLElement>('#transfer-filters')!;
  const suspend = document.querySelector<HTMLButtonElement>('#transfer-suspend')!;
  const alerts = document.querySelector<HTMLInputElement>('#transfer-alerts')!;
  const notice = document.querySelector<HTMLElement>('#transfer-notice')!;
  const chart = document.querySelector<HTMLElement>('#transfer-chart')!;
  const metrics = document.querySelector<HTMLElement>('#transfer-metrics')!;
  let filter: Lane | 'all' = 'all';
  let suspended = stored<boolean>(suspensionKey, false);
  let changingSuspension = false;
  let noticeTimer: number | undefined;
  const speeds: number[] = [];
  alerts.checked = stored<boolean>(alertsKey, true);
  alerts.onchange = () => {
    try { localStorage.setItem(alertsKey, JSON.stringify(alerts.checked)); }
    catch (error) { api.error(String(error)); }
  };
  const jobs = stored<DownloadJob[]>(key, []);
  for (const job of jobs) if (job.state === 'running') job.state = 'queued';
  const legacy = stored<{ id: string; kind: DownloadKind } | null>('nocturne-pending-download', null);
  if (legacy?.id && !jobs.some(job => job.id === legacy.id && job.kind === legacy.kind)) {
    jobs.push({ ...legacy, key: crypto.randomUUID(), payload: {}, state: 'paused' });
  }
  const parallel = document.querySelector<HTMLSelectElement>('#transfer-concurrency')!;
  parallel.value = stored<number>(concurrencyKey, 1) === 2 ? '2' : '1';
  parallel.onchange = () => {
    try { localStorage.setItem(concurrencyKey, parallel.value); } catch (error) { api.error(String(error)); }
    void drain();
  };
  const active = new Map<DownloadJob, { pausing: false | 'manual' | 'queue'; retryAt: number; updateAt: number; sample?: { at: number; bytes: number } }>();
  const sharesFiles = (a: DownloadJob, b: DownloadJob) => a.id.toLowerCase() === b.id.toLowerCase()
    || (a.kind === b.kind && ['sdcpp', 'chat'].includes(a.kind));
  let clearing = false;
  let lastWrite = 0;
  let requestNumber = 0;
  let translations = '';
  limit.value = String(stored<number>(bandwidthKey, 0));
  function save() {
    try {
      localStorage.setItem(key, JSON.stringify(jobs));
      if (legacy) localStorage.removeItem('nocturne-pending-download');
    } catch {
      api.error(tr('صف دانلود ذخیره نشد.', 'Could not save the download queue.'));
      return false;
    }
    return true;
  }
  limit.onchange = () => {
    const value = Number.isFinite(limit.valueAsNumber) ? Math.max(0, Math.min(5000, Math.trunc(limit.valueAsNumber))) : 0;
    limit.value = String(value);
    try { localStorage.setItem(bandwidthKey, JSON.stringify(value)); } catch (error) { api.error(String(error)); }
  };
  dialog.querySelector<HTMLButtonElement>('[data-transfer-close]')!.onclick = () => dialog.close();
  planDialog.querySelector<HTMLButtonElement>('[data-transfer-close]')!.onclick = () => planDialog.close();
  const show = () => {
    if (document.querySelector<HTMLElement>('#app')?.inert || document.documentElement.classList.contains('privacy-cover')) return;
    if (!dialog.open) dialog.showModal();
    render();
  };
  function announce(job: DownloadJob) {
    if (!alerts.checked || document.documentElement.classList.contains('privacy-cover')) return;
    const title = job.state === 'ready' ? tr('مدل آمادهٔ استفاده است', 'Model ready to use')
      : job.state === 'dependency' ? tr('فایل‌ها دریافت شدند', 'Files downloaded')
        : tr('دانلود نیاز به بررسی دارد', 'Download needs attention');
    const message = title + ' · ' + job.id;
    api.notify(message);
    if (dialog.open) return;
    notice.querySelector('p')!.textContent = message;
    const action = notice.querySelector<HTMLButtonElement>('[data-notice-downloads]')!;
    action.textContent = tr('بازکردن دانلودها', 'Open downloads');
    action.onclick = () => { notice.hidden = true; filter = 'all'; show(); };
    notice.hidden = false;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 6500);
  }

  async function stopJob(job: DownloadJob, reason: 'manual' | 'queue') {
    const running = active.get(job);
    if (!running || running.pausing) return;
    running.pausing = reason;
    render();
    try {
      for (let attempt = 0; attempt < 3 && active.get(job) === running; attempt++) {
        if (await api.stop(job)) return;
        await new Promise(resolve => window.setTimeout(resolve, 170));
      }
      running.pausing = false;
    } catch (error) {
      running.pausing = false;
      api.error(String(error));
    }
  }
  suspend.onclick = async () => {
    if (changingSuspension) return;
    suspended = !suspended;
    try { localStorage.setItem(suspensionKey, JSON.stringify(suspended)); }
    catch (error) { api.error(String(error)); }
    if (suspended) {
      changingSuspension = true;
      render();
      await Promise.all([...active.keys()].map(job => stopJob(job, 'queue')));
      changingSuspension = false;
    }
    render();
    void drain();
  };
  filters.onclick = event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-lane]');
    if (!button) return;
    filter = button.dataset.lane as typeof filter;
    render();
  };

  function currentSpeed() {
    const now = Date.now();
    return [...active.entries()].reduce((sum, [job, running]) => {
      const progress = job.progress;
      if (running.pausing || now - running.updateAt > 3000 || !progress?.speed ||
          ['checking','retrying','verifying','installing','complete'].includes(progress.phase || '')) return sum;
      return sum + Math.max(0, progress.speed);
    }, 0);
  }
  function renderMetrics() {
    const rate = currentSpeed();
    const max = Math.max(0, ...speeds, rate);
    const received = [...active.keys()].reduce((sum, job) => sum + (job.progress?.received || 0), 0);
    metrics.innerHTML = `<dl>
      <div><dt>${tr('سرعت فعلی','Current speed')}</dt><dd dir="ltr">${format(rate)}/s</dd></div>
      <div><dt>${tr('اوج در ۴۰ ثانیه','40-second peak')}</dt><dd dir="ltr">${format(max)}/s</dd></div>
      <div><dt>${tr('دریافت در کارهای فعال','Received in active tasks')}</dt><dd dir="ltr">${format(received)}</dd></div>
    </dl>`;
    chart.setAttribute('aria-label', tr('نمودار سرعت ۴۰ ثانیهٔ اخیر', 'Download speed over the last 40 seconds'));
    chart.replaceChildren(...Array.from({ length: 40 }, (_unused, index) => {
      const bar = document.createElement('span');
      const speed = speeds[index - (40 - speeds.length)] || 0;
      bar.style.setProperty('--height', max ? `${speed / max * 100}%` : '0%');
      bar.classList.toggle('has-rate', speed > 0);
      return bar;
    }));
  }
  opener.onclick = show;
  function words() {
    return {
      queued: tr('در صف', 'Queued'), running: tr('در حال دریافت', 'Downloading'),
      paused: tr('مکث', 'Paused'), waiting: tr('منتظر اتصال', 'Waiting for connection'),
      failed: tr('نیازمند بررسی', 'Needs attention'), ready: tr('آمادهٔ استفاده', 'Ready to use'),
      dependency: tr('دریافت شد · نیازمند مدل پایه', 'Downloaded · base model required'),
    };
  }
  function render() {
    const count = jobs.filter(job => !['ready', 'dependency'].includes(job.state)).length;
    opener.textContent = tr('دانلودها', 'Downloads') + (count ? ' · ' + count : '');
    if (!dialog.open && translations === String(api.english())) return;
    renderMetrics();
    translations = String(api.english());
    for (const [id, label] of Object.entries({
      'transfer-title': tr('مرکز دانلود', 'Download center'),
      'transfer-options': tr('تنظیمات دانلود', 'Download settings'),
      'transfer-alerts-label': tr('اعلان دانلودها', 'Download notifications'),
      'download-plan-title': tr('پیش‌نمایش بسته', 'Download preview'),
      'transfer-limit-label': tr('سقف سرعت MiB/s', 'Speed limit MiB/s'),
      'transfer-concurrency-label': tr('دانلود هم‌زمان', 'Parallel transfers'),
      'transfer-limit-help': tr('۰ یعنی آزاد · برای دریافت مستقیم فایل', '0 for unlimited · direct file transfers'),
      'transfer-variant-label': tr('نسخهٔ فایل', 'File variant'),
      'transfer-confirm': tr('افزودن به صف', 'Add to queue'),
    })) document.getElementById(id)!.textContent = label;
    for (const button of document.querySelectorAll('[data-transfer-close]')) button.textContent = tr('بستن', 'Close');
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusKey = previousFocus?.dataset.task;
    const focusAction = previousFocus?.dataset.action;
    const focusedFilter = previousFocus?.dataset.lane;
    const lanes: Record<Lane, DownloadJob[]> = { active: [], queue: [], history: [] };
    for (const job of jobs) lanes[laneOf(job.state)].push(job);
    lanes.history.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    const labels = { all: tr('همه', 'All'), active: tr('فعال', 'Active'),
      queue: tr('صف دانلود', 'Queue'), history: tr('تاریخچه', 'History') };
    const num = new Intl.NumberFormat(api.english() ? 'en-US' : 'fa-IR');
    filters.innerHTML = (['all', 'active', 'queue', 'history'] as const).map(id =>
      `<button type="button" class="small-button" data-lane="${id}" aria-pressed="${filter === id}">${labels[id]}
        <span>${num.format(id === 'all' ? jobs.length : lanes[id].length)}</span></button>`).join('');
    if (focusedFilter) filters.querySelector<HTMLButtonElement>(`[data-lane="${focusedFilter}"]`)?.focus({ preventScroll: true });
    suspend.textContent = suspended ? tr('ادامهٔ صف', 'Resume queue') : tr('مکث کل صف', 'Pause queue');
    suspend.disabled = changingSuspension || (!suspended && !lanes.active.length && !lanes.queue.some(job => job.state === 'queued' || job.state === 'waiting'));
    dialog.toggleAttribute('data-suspended', suspended);
    const readyToMove = lanes.queue.filter(job => job.state === 'queued' || job.state === 'waiting');
    const kinds: Record<DownloadKind, string> = {
      image: tr('تصویر','Image'), sdcpp: 'GGUF', checkpoint: tr('تک‌فایل','Checkpoint'),
      adapter: 'LoRA', video: tr('ویدیو','Video'), voice: tr('صدا','Audio'), chat: tr('چت','Chat'),
    };
    const card = (job: DownloadJob) => {
      const running = active.get(job);
      const p: Partial<Transfer> = job.progress || {};
      const total = p.total || 0;
      const downloaded = Math.min(total || Infinity, p.processed || 0);
      const speed = p.speed || 0;
      const retryTime = job.retryAt || running?.retryAt || 0;
      const retry = Math.max(0, Math.ceil((retryTime - Date.now()) / 1000));
      const phases: Record<string, string> = {
        checking: tr('بررسی بسته', 'Checking package'), retrying: tr('اتصال دوباره', 'Reconnecting'),
        verifying: tr('بررسی صحت فایل', 'Verifying files'), installing: tr('نصب موتور', 'Installing engine'),
        resuming: tr('ادامهٔ دریافت', 'Resuming'), restarting: tr('دریافت دوبارهٔ فایل جاری', 'Restarting the current file'),
        complete: tr('بررسی آمادگی', 'Checking readiness'),
      };
      const state = running?.pausing ? tr('در حال مکث', 'Pausing') : job.state === 'running' && p.phase && phases[p.phase] || words()[job.state];
      const button = (action: string, label: string, disabled = false) =>
        `<button type="button" class="small-button" data-task="${job.key}" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
      const timing = speed > 0 && total > downloaded && job.state === 'running' && !['verifying','installing','retrying'].includes(p.phase || '')
        ? ` · ~${Math.max(1, Math.ceil((total - downloaded) / speed / 60))} ${tr('دقیقه', 'min')}` : '';
      const order = readyToMove.indexOf(job);
      const percent = total ? num.format(Math.floor(100 * downloaded / total)) + '%' : '';
      return `<article class="transfer-item" data-state="${job.state}">
        <div class="transfer-item-heading">
          <div class="transfer-name"><span class="transfer-kind">${kinds[job.kind]}</span><strong dir="auto">${escape(job.id)}</strong></div>
          <span class="transfer-state">${suspended && job.state === 'queued' ? tr('صف در مکث','Queue paused') : state}</span>
        </div>
        ${job.state === 'ready' ? '' : `<progress max="${total || 1}" ${total ? 'value="'+downloaded+'"' : job.state==='running' ? '' : 'value="0"'}></progress>`}
        <div class="transfer-meta"><span>${total ? percent + ' · ' + format(downloaded) + ' / ' + format(total) : ''}</span>
          <span>${speed && job.state === 'running' && !['verifying','installing','retrying'].includes(p.phase || '') ? format(speed) + '/s' + timing : ''}</span>
          <span>${retry && (job.state === 'waiting' || p.phase === 'retrying') ? retry + ' ' + tr('ثانیه تا تلاش بعدی', 's until retry') : ''}</span></div>
        ${p.file && laneOf(job.state) !== 'history' ? `<small dir="auto">${escape(p.file)}</small>` : ''}
        ${job.finishedAt && laneOf(job.state) === 'history' ? `<small>${new Date(job.finishedAt).toLocaleString(api.english() ? 'en-US' : 'fa-IR')}</small>` : ''}
        ${job.error ? `<p class="transfer-error" dir="auto">${escape(job.error)}</p>` : ''}
        <div class="transfer-buttons">
          ${['running','queued','waiting'].includes(job.state) ? button('pause',tr('مکث','Pause'),Boolean(running?.pausing)) : ''}
          ${['paused','failed','waiting'].includes(job.state) ? button('resume',tr('ادامه','Resume')) : ''}
          ${order > 0 ? button('up',tr('برو بالا','Move up')) : ''}
          ${order >= 0 && order < readyToMove.length - 1 ? button('down',tr('برو پایین','Move down')) : ''}
          ${order > 1 ? button('priority',tr('ابتدای صف','Move to front')) : ''}
          ${job.state === 'ready' ? button('open',tr('بازکردن استودیو','Open studio')) : ''}
          ${['ready','failed'].includes(job.state) && ['image','video','sdcpp','checkpoint'].includes(job.kind) ? button('repair',tr('بررسی و تعمیر','Verify and repair')) : ''}
          ${!active.has(job) && ['paused','failed'].includes(job.state) && ['image','video','checkpoint','adapter','voice'].includes(job.kind)
            ? button('clear',tr('حذف فایل ناقص','Delete partial files'),clearing) : ''}
          ${!active.has(job) ? button('remove',tr('برداشتن از صف','Remove entry')) : ''}
        </div></article>`;
    };
    const shown = (['active','queue','history'] as const)
      .filter(id => (filter === 'all' || filter === id) && lanes[id].length);
    list.innerHTML = shown.length ? shown.map(id =>
      `<section class="transfer-lane"><h3>${labels[id]} <span>${num.format(lanes[id].length)}</span></h3>
        ${lanes[id].map(card).join('')}</section>`).join('')
      : `<p class="transfer-empty">${filter === 'all'
        ? tr('صف دانلود خالی است. از کتابخانه یک مدل انتخاب کن.','The queue is empty. Select a model in the library.')
        : tr('دانلودی در این بخش نیست.','There are no downloads in this section.')}</p>`;
    if (focusKey && focusAction) {
      list.querySelector<HTMLButtonElement>(`[data-task="${focusKey}"][data-action="${focusAction}"]`)?.focus({ preventScroll: true });
    }
  }
  dialog.addEventListener('close', () => { translations = ''; });
  dialog.addEventListener('focusin', () => { if (!list.childElementCount) render(); });
  list.onclick = async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-task]');
    if (!button) return;
    const job = jobs.find(item => item.key === button.dataset.task);
    if (!job) return;
    switch (button.dataset.action) {
      case 'pause':
        if (active.has(job)) await stopJob(job, 'manual');
        else job.state = 'paused';
        break;
      case 'resume':
        if (!active.has(job)) { job.state = 'queued'; job.error = ''; job.attempts = 0; job.retryAt = undefined; }
        break;
      case 'repair':
        if (!active.has(job)) { job.payload.repair = true; job.state = 'queued'; job.error = ''; job.retryAt = undefined; job.attempts = 0; }
        break;
      case 'priority':
      case 'up':
      case 'down': {
        const movable = jobs.filter(item => item.state === 'queued' || item.state === 'waiting');
        const index = movable.indexOf(job);
        const target = movable[button.dataset.action === 'priority' ? 0 : index + (button.dataset.action === 'up' ? -1 : 1)];
        if (!target || target === job) break;
        const position = jobs.indexOf(target);
        jobs.splice(jobs.indexOf(job), 1);
        jobs.splice(position, 0, job);
        break;
      }
      case 'open':
        dialog.close();
        api.open(job);
        return;
      case 'clear':
        if (active.has(job) || clearing) return;
        clearing = true;
        render();
        try {
          const data = await api.partials(job);
          if (!data.files) {
            api.error(tr('فایل نیمه‌کارهٔ قابل‌حذف پیدا نشد.', 'No removable partial files were found.'));
          } else if (window.confirm(tr(
            `${data.files} فایل نیمه‌کاره با حجم ${format(data.bytes)} حذف شود؟`,
            `Delete ${data.files} partial files and free ${format(data.bytes)}?`))) {
            await api.partials(job, data.bytes);
            if (job.progress) job.progress.processed = Math.max(0, (job.progress.processed || 0) - data.bytes);
          }
        } catch (error) { api.error(String(error)); }
        finally { clearing = false; }
        break;
      case 'remove':
        if (!active.has(job) && window.confirm(tr('این مورد از مرکز دانلود برداشته شود؟ فایل‌های روی دیسک حفظ می‌شوند.',
          'Remove this entry from the download center? Files on disk will be kept.'))) jobs.splice(jobs.indexOf(job), 1);
        break;
    }
    save();
    render();
    void drain();
  };
  async function drain() {
    if (suspended || active.size >= Number(parallel.value) || clearing || !api.available() || api.busy() || !navigator.onLine) return;
    const job = jobs.find(item => ![...active.keys()].some(other => sharesFiles(item, other)) &&
      (item.state === 'queued' || (item.state === 'waiting' && (item.retryAt || 0) <= Date.now())));
    if (!job) return;
    const running: { pausing: false | 'manual' | 'queue'; retryAt: number; updateAt: number } =
      { pausing: false, retryAt: 0, updateAt: 0 };
    active.set(job, running);
    job.state = 'running';
    job.finishedAt = undefined;
    job.retryAt = undefined;
    job.error = '';
    job.progress = { ...job.progress, model_id: job.id, phase: 'checking', speed: 0, received: 0 };
    save();
    render();
    queueMicrotask(() => void drain());
    try {
      job.state = await api.run(job, Math.floor(Number(limit.value) * 1024 ** 2 / Number(parallel.value)));
      job.attempts = 0;
      job.finishedAt = Date.now();
      delete job.payload.repair;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.state = running.pausing === 'manual' ? 'paused' : running.pausing === 'queue' ? 'queued' : 'failed';
      if (!running.pausing) {
        job.error = message;
        if (!blockedError.test(message) && (!navigator.onLine || connectionError.test(message))) {
          job.attempts = (job.attempts || 0) + 1;
          job.state = 'waiting';
          job.retryAt = Date.now() + Math.min(120, 5 * 2 ** Math.min(5, job.attempts - 1)) * 1000;
        }
      }
    } finally {
      active.delete(job);
      save();
      render();
      if (job.state === 'ready' || job.state === 'dependency' || job.state === 'failed') announce(job);
      queueMicrotask(() => void drain());
    }
  }
  function progress(update: Transfer, chat = false) {
    const job = [...active.keys()].find(item => update.job_id
      ? item.key === update.job_id : chat ? item.kind === 'chat' : item.id === update.model_id);
    if (!job) return;
    const running = active.get(job)!;
    running.updateAt = Date.now();
    if (update.phase) {
      running.retryAt = update.phase === 'retrying' && update.retry_in ? Date.now() + update.retry_in * 1000 : 0;
    }
    if (chat && update.processed != null) {
      const now = Date.now();
      const sample = running.sample;
      if (sample && now !== sample.at && update.processed >= sample.bytes) {
        update.speed = (update.processed - sample.bytes) * 1000 / (now - sample.at);
      }
      running.sample = { at: now, bytes: update.processed };
    }
    const known = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
    job.progress = { ...job.progress, ...known, model_id: job.id };
    if (Date.now() - lastWrite > 1000 || update.phase === 'complete') {
      save();
      lastWrite = Date.now();
    }
    if (dialog.open) render();
  }
  function preview(request: Request) {
    if (document.documentElement.classList.contains('privacy-cover')) return;
    const existing = jobs.find(job => job.id === request.id && job.kind === request.kind &&
      job.payload.filename === request.payload.filename && !['ready','dependency'].includes(job.state));
    if (existing) { show(); return; }
    render();
    document.querySelector('#transfer-plan-model')!.textContent = request.id;
    planDialog.showModal();
    async function inspect(selected?: string) {
      const sequence = ++requestNumber;
      confirm.disabled = true;
      variant.disabled = true;
      (variant.parentElement as HTMLElement).hidden = true;
      planBody.textContent = tr('در حال بررسی بسته…', 'Checking the package…');
      try {
        const plan = await api.plan(request, selected);
        if (requestNumber !== sequence || !planDialog.open) return;
        const chosen = selected || plan.variants?.[0]?.name;
        if (plan.variants?.length) {
          variant.replaceChildren(...plan.variants.map(item => new Option(item.name + ' · ' + format(item.size), item.name)));
          variant.value = chosen || '';
          variant.disabled = false;
          (variant.parentElement as HTMLElement).hidden = false;
          variant.onchange = () => void inspect(variant.value);
        }
        const insufficient = plan.required_bytes != null && plan.free_bytes != null && plan.free_bytes < plan.required_bytes;
        const supported = !plan.gated && (request.kind === 'chat' || !!plan.download_kind);
        const figures = [
          [tr('حجم بسته','Package size'), format(plan.download_bytes ?? request.size)],
          [tr('باقی‌مانده','Remaining'), format(plan.remaining_bytes)],
          [tr('فضای موردنیاز','Space needed'), format(plan.required_bytes)],
          [tr('فضای آزاد','Free space'), format(plan.free_bytes)],
        ];
        planBody.innerHTML = `<dl class="transfer-figures">${figures.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('')}</dl>
          ${plan.folder ? `<p class="transfer-path" dir="ltr">${escape(plan.folder)}</p>` : ''}
          ${plan.requirements?.length ? `<p>${tr('پیش‌نیازها','Requirements')} · ${escape(plan.requirements.join(' · '))}</p>` : ''}
          ${plan.reason ? `<p>${escape(plan.reason)}</p>` : ''}
          ${plan.gated ? `<p>${tr('دسترسی مخزن را در Hugging Face تأیید کن.','Confirm repository access on Hugging Face.')}
          <a href="https://huggingface.co/${request.id.split('/').map(encodeURIComponent).join('/')}" target="_blank" rel="noreferrer">Hugging Face</a></p>` : ''}
          ${insufficient ? `<p class="transfer-error">${tr('فضای آزاد کافی نیست.','There is not enough free disk space.')}</p>` : ''}
          ${plan.file_plan?.length ? `<details ${plan.file_plan.length < 12 ? 'open' : ''}><summary>${tr('فایل‌ها','Files')} · ${plan.file_plan.length}</summary>
          <ul>${plan.file_plan.map(file => `<li><bdi>${escape(file.name)}</bdi><span>${format(file.size)} · ${file.remaining === 0 ? tr('روی سیستم','Cached') : file.remaining === file.size ? tr('برای دریافت','To download') : format(file.remaining) + ' ' + tr('باقی‌مانده','left')}</span></li>`).join('')}</ul></details>` : ''}`;
        if (plan.upgrade) {
          const notice = document.createElement('div');
          notice.className = 'engine-review engine-review-warning';
          notice.innerHTML = `<div><strong>${tr('به‌روزرسانی موتور لازم است','Engine update required')}</strong>
            <p dir="ltr">Diffusers ${escape(plan.upgrade.installed)} → ≥ ${escape(plan.upgrade.minimum)}</p></div>
            <button type="button" class="small-button">${tr('به‌روزرسانی و بررسی دوباره','Update and recheck')}</button>`;
          planBody.prepend(notice);
          notice.querySelector('button')!.onclick = async () => {
            const button = notice.querySelector<HTMLButtonElement>('button')!;
            button.disabled = true;
            const original = button.textContent;
            button.textContent = tr('در حال به‌روزرسانی…','Updating…');
            const result = await api.upgrade();
            if (!planDialog.open || sequence !== requestNumber) return;
            if (result === true) void inspect(selected);
            else {
              button.disabled = false;
              button.textContent = original;
              notice.querySelector('.engine-review-error')?.remove();
              const error = document.createElement('p');
              error.className = 'engine-review-error';
              error.setAttribute('role', 'alert');
              error.textContent = result;
              notice.append(error);
            }
          };
        }
        confirm.disabled = !supported || insufficient;
        confirm.onclick = () => {
          if (confirm.disabled) return;
          const job: DownloadJob = {
            id: request.id, kind: request.kind === 'voice' || request.kind === 'chat' ? request.kind : plan.download_kind as DownloadKind,
            key: crypto.randomUUID(), state: 'queued', folder: plan.folder,
            payload: { ...request.payload, revisions: plan.revisions, variant: chosen },
            progress: { model_id: request.id, total: plan.download_bytes || request.size, processed: plan.download_bytes != null && plan.remaining_bytes != null ? plan.download_bytes - plan.remaining_bytes : 0 },
          };
          jobs.push(job);
          if (!save()) { jobs.pop(); return; }
          planDialog.close();
          filter = 'all';
          show();
          void drain();
        };
      } catch (error) {
        if (sequence === requestNumber && planDialog.open) planBody.textContent = String(error);
      }
    }
    void inspect();
  }
  planDialog.addEventListener('close', () => { requestNumber++; });
  window.addEventListener('online', () => void drain());
  window.setInterval(() => {
    speeds.push(currentSpeed());
    if (speeds.length > 40) speeds.shift();
    if (dialog.open) renderMetrics();
    if (dialog.open && ([...active.values()].some(job => job.retryAt) || jobs.some(job => job.state === 'waiting'))) render();
    void drain();
  }, 1000);
  save();
  render();
  return { preview, show, progress, drain, render, running: () => active.size > 0 };
}
