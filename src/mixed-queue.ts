import { newId, stored } from './projects';

type Kind = 'image' | 'video' | 'voice';
type Job = { id: string; kind: Kind; choice: string; prompt: string; source?: string; name?: string; error?: string };
type Engine = { id: string; engine: string };
type Hooks = {
  key: () => string; en: () => boolean; busy: () => boolean; folder: () => string;
  models: (kind: Kind) => Engine[]; run: (job: Job, source: string) => Promise<string>;
  lock: (active: boolean) => void; cancel: () => Promise<unknown>; refresh: () => Promise<void>;
};

export function mountMixedQueue(parent: Element, hooks: Hooks) {
  const panel = document.createElement('details');
  panel.className = 'workflow-section model-card';
  const heading = document.createElement('summary');
  const fields = document.createElement('div');
  fields.className = 'workflow-fields';
  const kind = document.createElement('select');
  const model = document.createElement('select');
  const prompt = document.createElement('input');
  prompt.dir = 'auto';
  const source = document.createElement('select');
  const add = document.createElement('button');
  const start = document.createElement('button');
  const stop = document.createElement('button');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const list = document.createElement('div');
  for (const button of [add, start, stop]) button.className = 'small-button';
  fields.append(kind, model, prompt, source, add, start, stop);
  panel.append(heading, fields, status, list);
  parent.append(panel);
  let key = '';
  let queue: Job[] = [];
  let running = false;
  let stopping = false;
  let outputFolder = '';
  const t = (en: string, fa: string) => hooks.en() ? en : fa;
  const words = () => ({ image: t('Image', 'تصویر'), video: t('Video', 'ویدیو'), voice: t('Speech', 'صدا') });

  function save() {
    localStorage.setItem(key, JSON.stringify({ jobs: queue, folder: outputFolder }));
  }

  function read() {
    const next = hooks.key();
    if (next !== key) {
      key = next;
      const draft = stored(key, { jobs: [] as Job[], folder: '' });
      queue = draft.jobs;
      outputFolder = draft.folder;
    }
  }

  function render() {
    read();
    const labels = words();
    heading.textContent = t('Image, video and speech workflow', 'صف مشترک تصویر، ویدیو و صدا');
    const currentKind = (kind.value || 'image') as Kind;
    kind.replaceChildren(...Object.entries(labels).map(([id, label]) => new Option(label, id)));
    kind.value = currentKind;
    const chosen = model.value;
    const models = hooks.models(currentKind);
    model.replaceChildren(...models.map(item => new Option(item.id, item.engine + ':' + item.id)));
    if ([...model.options].some(option => option.value === chosen)) model.value = chosen;
    const dependency = source.value;
    source.hidden = currentKind !== 'video';
    source.replaceChildren(new Option(t('No reference image', 'بدون عکس مرجع'), ''),
      ...queue.filter(job => job.kind === 'image').map(job => new Option(job.prompt.slice(0, 60), job.id)));
    if ([...source.options].some(option => option.value === dependency)) source.value = dependency;
    prompt.placeholder = currentKind === 'voice' ? t('Text to read', 'متن گفتار') : t('Prompt', 'پرامپت');
    for (const [field, label] of [[kind, t('Media type', 'نوع رسانه')], [model, t('Model', 'مدل')], [source, t('Reference job', 'کار مرجع')], [prompt, prompt.placeholder]] as const) field.setAttribute('aria-label', label);
    add.textContent = t('Add', 'افزودن');
    add.disabled = running || !models.length;
    start.textContent = queue.some(job => job.error) ? t('Retry pending jobs', 'تلاش دوباره برای کارهای باقی‌مانده') : t('Run pending jobs', 'اجرای کارهای باقی‌مانده');
    start.disabled = running || !queue.some(job => !job.name);
    stop.textContent = t('Stop', 'توقف');
    stop.hidden = !running;
    list.replaceChildren(...queue.map((job, index) => {
      const row = document.createElement('div');
      row.className = 'workflow-row';
      const details = document.createElement('strong');
      details.textContent = labels[job.kind] + ' · ' + job.prompt + (job.source ? ' ⤷ ' + t('reference image', 'عکس مرجع') : '');
      const state = document.createElement('span');
      state.textContent = job.name || job.error || t('Pending', 'در انتظار');
      row.append(details, state);
      function button(text: string, label: string, disabled: boolean, action: () => void) {
        const element = document.createElement('button');
        element.className = 'small-button';
        element.textContent = text;
        element.setAttribute('aria-label', label);
        element.disabled = running || disabled;
        element.onclick = () => { action(); save(); render(); };
        row.append(element);
      }
      const up = queue[index - 1];
      const down = queue[index + 1];
      button('↑', t('Move up', 'انتقال به بالا'), !up || job.source === up.id, () => { [queue[index - 1], queue[index]] = [job, up]; });
      button('↓', t('Move down', 'انتقال به پایین'), !down || down.source === job.id, () => { [queue[index], queue[index + 1]] = [down, job]; });
      button('×', t('Remove from queue', 'حذف از صف'), queue.some(other => other.source === job.id), () => {
        queue.splice(index, 1);
        if (!queue.length) outputFolder = '';
      });
      return row;
    }));
  }

  add.onclick = () => {
    if (running || !prompt.value.trim() || !model.value) return;
    const choice = kind.value as Kind;
    const text = prompt.value.trim();
    if (text.length > (choice === 'voice' ? 500 : 1500)) {
      status.textContent = t('The prompt is too long.', 'متن بیش از حد طولانی است.');
      return;
    }
    queue.push({ id: newId(), kind: choice, choice: model.value, prompt: text, source: choice === 'video' && source.value || undefined });
    save();
    prompt.value = '';
    render();
  };
  start.onclick = async () => {
    if (running || hooks.busy()) return;
    if (outputFolder && hooks.folder() !== outputFolder) {
      status.textContent = t('Select this queue’s original output folder.', 'پوشهٔ خروجی اصلی این صف را انتخاب کن.');
      return;
    }
    outputFolder = hooks.folder();
    save();
    running = true;
    stopping = false;
    hooks.lock(true);
    render();
    try {
      for (const job of queue) {
        if (stopping) break;
        if (job.name) continue;
        const reference = job.source ? queue.find(item => item.id === job.source)?.name : '';
        if (job.source && !reference) continue;
        status.textContent = words()[job.kind] + ' · ' + job.prompt;
        try {
          job.name = await hooks.run(job, reference || '');
          delete job.error;
        } catch (error) {
          if (!stopping) job.error = String(error);
        }
        save();
        render();
      }
    } finally {
      running = false;
      hooks.lock(false);
      status.textContent = stopping ? t('Stopped', 'متوقف شد') :
        queue.every(job => job.name) ? t('Queue complete', 'صف کامل شد') : t('Failed jobs and their dependents can be retried.', 'کارهای ناموفق و وابسته دوباره قابل اجرا هستند.');
      render();
      await hooks.refresh().catch(() => {});
    }
  };
  stop.onclick = () => { stopping = true; void hooks.cancel().catch(() => {}); };
  kind.onchange = render;
  panel.ontoggle = render;
  return render;
}
