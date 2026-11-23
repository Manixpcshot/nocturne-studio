type Stage = 'prerequisites' | 'library' | 'workspace' | 'model';

const messages: Record<Stage, [string, string]> = {
  prerequisites: ['در حال بررسی پیش‌نیازها…', 'Checking prerequisites…'],
  library: ['در حال خواندن مدل‌ها و گالری…', 'Reading models and gallery…'],
  workspace: ['در حال آماده‌کردن محیط کار…', 'Preparing your workspace…'],
  model: ['در حال بارگذاری مدل انتخاب‌شده…', 'Loading your selected model…'],
};

const screen = document.querySelector<HTMLElement>('#startup-screen')!;
const app = document.querySelector<HTMLElement>('#app')!;
const status = document.querySelector<HTMLElement>('#startup-status')!;

export function showStartup(stage: Stage) {
  const english = document.documentElement.lang === 'en';
  status.textContent = messages[stage][english ? 1 : 0];
  app.inert = true;
  screen.hidden = false;
}

export function hideStartup() {
  screen.hidden = true;
  app.inert = false;
}

export function startupFailed(error: unknown, canContinue: boolean) {
  const english = document.documentElement.lang === 'en';
  const details = document.querySelector<HTMLElement>('#startup-details')!;
  const actions = document.querySelector<HTMLElement>('.startup-actions')!;
  const retry = document.querySelector<HTMLButtonElement>('#startup-retry')!;
  const continueButton = document.querySelector<HTMLButtonElement>('#startup-continue')!;
  app.inert = true;
  screen.hidden = false;
  screen.setAttribute('data-error', '');
  status.textContent = english ? 'Startup failed' : 'راه‌اندازی برنامه ناموفق بود';
  details.hidden = false;
  details.textContent = String(error);
  retry.textContent = english ? 'Try again' : 'تلاش دوباره';
  retry.onclick = () => location.reload();
  continueButton.hidden = !canContinue;
  continueButton.textContent = english ? 'Open workspace' : 'بازکردن محیط کار';
  continueButton.onclick = hideStartup;
  actions.hidden = false;
  retry.focus();
}
