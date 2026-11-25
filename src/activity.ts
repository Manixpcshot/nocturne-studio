import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './activity.css';

type Entry = { time: number; area: string; action: string; phase: string; code?: string; elapsed_ms?: number };
type Labels = Record<string, readonly [string, string]>;
const labels: Labels = {
  image: ['Image', 'تصویر'], video: ['Video', 'ویدیو'], voice: ['Speech', 'صدا'], chat: ['Chat', 'چت'],
  queue: ['Queue', 'صف'], downloads: ['Downloads', 'دانلودها'], models: ['Models', 'مدل‌ها'], gallery: ['Gallery', 'گالری'],
  storage: ['Storage', 'فضای ذخیره‌سازی'], website: ['Website', 'وب‌سایت'], system: ['System', 'سیستم'],
  started: ['Started', 'شروع'], success: ['Completed', 'انجام شد'], cancelled: ['Stopped', 'توقف'], error: ['Error', 'خطا'],
  disk: ['Insufficient disk space', 'فضای دیسک کافی نیست'], memory: ['Insufficient working memory', 'حافظهٔ کاری کافی نیست'],
  connection: ['Connection interrupted', 'اتصال قطع شد'], access: ['Access required', 'دسترسی لازم است'],
  integrity: ['Verification failed', 'صحت فایل تأیید نشد'], dependency: ['Python dependency unavailable', 'وابستگی پایتون پیدا نشد'],
  missing_file: ['File missing', 'فایل پیدا نشد'], worker_exit: ['Worker closed', 'موتور بسته شد'],
  invalid_input: ['Invalid input', 'ورودی نامعتبر'], failed: ['Operation failed', 'عملیات ناموفق بود'],
  generate: ['Generate image', 'ساخت تصویر'], edit_image: ['Edit image', 'ویرایش تصویر'],
  generate_video: ['Generate video', 'ساخت ویدیو'], tts_generate: ['Generate speech', 'ساخت گفتار'],
  chat_generate: ['Generate response', 'ساخت پاسخ'], media_workflow_job: ['Run media job', 'اجرای کار چندرسانه‌ای'],
  batch_queue: ['Run image queue', 'اجرای صف تصاویر'], batch_generate: ['Generate image batch', 'ساخت دسته‌ای تصویر'],
  download: ['Download model', 'دانلود مدل'], tts_download: ['Download voice model', 'دانلود مدل صدا'], chat_pull: ['Download chat model', 'دانلود مدل چت'],
  load: ['Load model', 'بارگذاری مدل'], unload: ['Unload model', 'خروج مدل از حافظه'], info: ['Inspect model', 'بررسی مدل'],
  device: ['Change device', 'تغییر دستگاه'], startup: ['Open app', 'اجرای برنامه'],
  setup_install: ['Install dependencies', 'نصب پیش‌نیازها'], install_app_update: ['App update', 'به‌روزرسانی برنامه'],
  web_generate: ['Generate from the website', 'ساخت از وب‌سایت'], web_start: ['Start server', 'راه‌اندازی سرور'],
  web_stop: ['Stop server', 'توقف سرور'], interface: ['Interface error', 'خطای رابط'],
};

export const activityPage = '<section class="view" id="activity-view"></section>';

export function mountActivity(en: () => boolean) {
  const view = document.querySelector<HTMLElement>('#activity-view')!;
  view.innerHTML = '<header class="section-head"><h1></h1><p></p></header><div class="activity-tools"><input id="activity-query" type="search" dir="auto"><select id="activity-area"></select><select id="activity-phase"></select><button class="small-button" id="activity-refresh"></button><button class="small-button" id="activity-export"></button><button class="small-button" id="activity-clear"></button></div><p class="activity-message" role="status"></p><ol class="activity-list"></ol>';
  const query = view.querySelector<HTMLInputElement>('#activity-query')!;
  const area = view.querySelector<HTMLSelectElement>('#activity-area')!;
  const phase = view.querySelector<HTMLSelectElement>('#activity-phase')!;
  const message = view.querySelector('.activity-message')!;
  const list = view.querySelector('.activity-list')!;
  const refreshButton = view.querySelector<HTMLButtonElement>('#activity-refresh')!;
  const exportButton = view.querySelector<HTMLButtonElement>('#activity-export')!;
  const clear = view.querySelector<HTMLButtonElement>('#activity-clear')!;
  const tr = (english: string, farsi: string) => en() ? english : farsi;
  const label = (key: string) => labels[key]?.[en() ? 0 : 1] ?? key.replaceAll('_', ' ');
  let entries: Entry[] = [];
  let visible: Entry[] = [];
  let timer = 0;
  let revision = 0;
  let locale = '';

  function draw() {
    const needle = query.value.trim().toLowerCase();
    visible = entries.filter(row => (!area.value || area.value === row.area) &&
      (!phase.value || phase.value === row.phase) && (!needle ||
      [row.action, label(row.action), label(row.area), label(row.code || '')].some(value => value.toLowerCase().includes(needle))));
    const time = new Intl.DateTimeFormat(en() ? 'en' : 'fa', { dateStyle: 'short', timeStyle: 'medium' });
    list.replaceChildren(...visible.map(row => {
      const item = document.createElement('li');
      item.className = 'activity-entry';
      item.dataset.phase = row.phase;
      const state = document.createElement('span');
      state.className = 'activity-state';
      state.textContent = label(row.phase);
      const name = document.createElement('strong');
      name.textContent = label(row.action);
      const meta = document.createElement('small');
      meta.textContent = label(row.area) + (row.code ? ' · ' + label(row.code) : '');
      const details = document.createElement('div');
      details.append(name, meta);
      const when = document.createElement('time');
      when.textContent = time.format(row.time) + (row.elapsed_ms != null ? ' · ' +
        new Intl.NumberFormat(en() ? 'en' : 'fa', { maximumFractionDigits: 1 }).format(row.elapsed_ms / 1000) +
        tr(' s', ' ثانیه') : '');
      item.append(state, details, when);
      return item;
    }));
    message.textContent = visible.length
      ? tr(visible.length + ' matching entries', visible.length.toLocaleString('fa') + ' رویداد')
      : tr('No matching activity.', 'رویدادی پیدا نشد.');
    exportButton.disabled = !visible.length;
    clear.disabled = !entries.length;
  }

  function localize() {
    const next = en() ? 'en' : 'fa';
    if (locale === next) return;
    locale = next;
    view.querySelector('h1')!.textContent = tr('Activity log', 'گزارش فعالیت');
    view.querySelector('header p')!.textContent = tr(
      'Recent jobs and errors on this device. Diagnostic records exclude prompts, chats and passwords.',
      'کارها و خطاهای اخیر همین دستگاه. پرامپت، پیام‌های چت و رمزها در گزارش ذخیره نمی‌شوند.');
    query.placeholder = tr('Search activities', 'جست‌وجوی رویدادها');
    query.setAttribute('aria-label', query.placeholder);
    for (const [select, options, text] of [
      [area, ['image','video','voice','chat','queue','downloads','models','gallery','storage','website','system'], tr('All sections','همهٔ بخش‌ها')],
      [phase, ['started','success','error','cancelled'], tr('All statuses','همهٔ وضعیت‌ها')],
    ] as const) {
      const previous = select.value;
      select.setAttribute('aria-label', text);
      select.replaceChildren(new Option(text, ''), ...options.map(option => new Option(label(option), option)));
      select.value = previous;
    }
    refreshButton.textContent = tr('Refresh', 'بازخوانی');
    exportButton.textContent = tr('Export JSON', 'خروجی JSON');
    clear.textContent = tr('Clear history', 'پاک کردن گزارش');
    draw();
  }

  async function refresh() {
    const attempt = ++revision;
    try {
      const result = await invoke<Entry[]>('activity_read');
      if (attempt !== revision) return;
      entries = Array.isArray(result) ? result : [];
      draw();
    } catch {
      if (attempt === revision) message.textContent = tr('The activity log could not be opened.', 'خواندن گزارش ممکن نشد.');
    }
  }

  query.oninput = area.onchange = phase.onchange = draw;
  refreshButton.onclick = () => void refresh();
  clear.onclick = async () => {
    if (!window.confirm(tr('Clear all saved activity records?', 'همهٔ رویدادهای ذخیره‌شده پاک شوند؟'))) return;
    try { await invoke('activity_clear'); await refresh(); }
    catch { message.textContent = tr('The activity log could not be cleared.', 'پاک کردن گزارش ممکن نشد.'); }
  };
  exportButton.onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(visible, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nocturne-activity.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  };
  void listen('activity-changed', () => {
    if (!view.classList.contains('active')) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), 130);
  }).catch(() => {});
  localize();
  return { localize, refresh };
}
