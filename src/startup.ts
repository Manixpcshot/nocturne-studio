const phases = [
  { id: 'prerequisites', label: ['پیش‌نیازها', 'Prerequisites'], status: ['در حال بررسی Python و بسته‌ها…', 'Checking Python and dependencies…'] },
  { id: 'models', label: ['مدل‌ها', 'Models'], status: ['در حال خواندن مدل‌های نصب‌شده…', 'Reading installed models…'] },
  { id: 'gallery', label: ['گالری', 'Gallery'], status: ['در حال آماده‌کردن گالری…', 'Preparing the gallery…'] },
  { id: 'model', label: ['مدل شروع', 'Startup model'], status: ['در حال بارگذاری مدل انتخاب‌شده…', 'Loading the selected model…'] },
] as const;

type Stage = (typeof phases)[number]['id'];

const screen = document.querySelector<HTMLElement>('#startup-screen')!;
const app = document.querySelector<HTMLElement>('#app')!;
const status = document.querySelector<HTMLElement>('#startup-status')!;
const steps = document.querySelector<HTMLOListElement>('#startup-steps')!;
const details = document.querySelector<HTMLElement>('#startup-details')!;
const slow = document.querySelector<HTMLElement>('#startup-slow')!;
const actions = document.querySelector<HTMLElement>('.startup-actions')!;
const retry = document.querySelector<HTMLButtonElement>('#startup-retry')!;
const enter = document.querySelector<HTMLButtonElement>('#startup-continue')!;
let tick: number | undefined;

const locale = () => document.documentElement.lang === 'en' ? 1 : 0;
function stopClock() {
  window.clearInterval(tick);
  slow.hidden = true;
}

function renderSteps(stage: Stage, autoLoad: boolean) {
  const selected = phases.findIndex(phase => phase.id === stage);
  steps.replaceChildren();
  for (const [index, phase] of phases.entries()) {
    if (phase.id === 'model' && !autoLoad) continue;
    const row = document.createElement('li');
    const marker = document.createElement('span');
    const name = document.createElement('span');
    marker.className = 'startup-marker';
    marker.setAttribute('aria-hidden', 'true');
    name.textContent = phase.label[locale()];
    if (index < selected) {
      row.dataset.state = 'done';
      marker.textContent = '✓';
      const complete = document.createElement('span');
      complete.className = 'startup-sr-only';
      complete.textContent = locale() ? 'Complete' : 'انجام شد';
      row.append(complete);
    } else if (index === selected) {
      row.dataset.state = 'active';
      row.setAttribute('aria-current', 'step');
    }
    row.append(marker, name);
    steps.append(row);
  }
}

export function showStartup(stage: Stage, autoLoad = false, model?: string) {
  const phase = phases.find(item => item.id === stage)!;
  status.textContent = phase.status[locale()];
  app.inert = true;
  screen.hidden = false;
  screen.removeAttribute('data-error');
  renderSteps(stage, autoLoad);
  details.textContent = model || '';
  details.hidden = !model;
  details.dir = 'auto';
  retry.hidden = true;
  enter.hidden = !model;
  enter.textContent = locale() ? 'Open workspace' : 'ورود به محیط کار';
  enter.onclick = hideStartup;
  actions.hidden = !model;

  stopClock();
  const started = performance.now();
  const number = new Intl.NumberFormat(locale() ? 'en-US' : 'fa-IR');
  tick = window.setInterval(() => {
    const seconds = Math.floor((performance.now() - started) / 1000);
    if (seconds < 5) return;
    const elapsed = number.format(seconds);
    slow.textContent = locale() ? `${elapsed} s on this step` : `${elapsed} ثانیه در این مرحله`;
    slow.hidden = false;
  }, 1000);
}

export function hideStartup() {
  stopClock();
  screen.hidden = true;
  app.inert = false;
}

export function startupFailed(error: unknown, canContinue: boolean) {
  stopClock();
  app.inert = true;
  screen.hidden = false;
  screen.setAttribute('data-error', '');
  status.textContent = locale() ? 'Startup failed' : 'راه‌اندازی برنامه ناموفق بود';
  details.hidden = false;
  details.dir = 'auto';
  details.textContent = error instanceof Error ? error.message : String(error);
  retry.hidden = false;
  retry.textContent = locale() ? 'Try again' : 'تلاش دوباره';
  retry.onclick = () => location.reload();
  enter.hidden = !canContinue;
  enter.textContent = locale() ? 'Open workspace' : 'ورود به محیط کار';
  enter.onclick = hideStartup;
  actions.hidden = false;
  retry.focus();
}
