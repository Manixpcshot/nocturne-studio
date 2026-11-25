"use strict";

const text = {
  activityTitle: ["Activity log", "گزارش فعالیت"], activityAll: ["All statuses", "همهٔ وضعیت‌ها"],
  activityClear: ["Clear history", "پاک کردن گزارش"], activityEmpty: ["No recorded activity.", "رویدادی ثبت نشده."],
  activityConfirm: ["Clear all activity records?", "گزارش فعالیت پاک شود؟"],
  activityDownloads: ["Downloads", "دانلودها"],
  activity_started: ["Started", "شروع"], activity_completed: ["Completed", "انجام شد"],
  activity_stopped: ["Stopped", "متوقف شد"], activity_error: ["Error", "خطا"], activity_retry: ["Retry", "تلاش دوباره"],
  chat: ["Chat", "چت"], text: ["Text", "متن"], imageModels: ["Image", "تصویر"],
  chatIntro: ["Generate text offline with llama.cpp on your CPU.", "با موتور llama.cpp روی پردازندهٔ گوشی، آفلاین متن بساز."],
  textModel: ["Text model", "مدل متنی"], chatPrompt: ["Write a message…", "پیام را بنویس…"],
  addText: ["Find a text model", "پیدا کردن مدل متنی"], send: ["Send", "ارسال"],
  chatCancelled: ["Response stopped.", "پاسخ متوقف شد."],
  answering: ["Generating an answer…", "در حال نوشتن پاسخ…"],
  textFailed: ["The text engine could not answer. Try a shorter message.", "موتور متن نتوانست پاسخ بسازد. پیام کوتاه‌تری امتحان کن."],
  appUpdates: ["App updates", "به‌روزرسانی برنامه"], checkUpdate: ["Check for updates", "بررسی به‌روزرسانی"],
  update_checking: ["Checking GitHub…", "در حال بررسی گیت‌هاب…"],
  update_current: ["You're up to date.", "آخرین نسخه نصب است."],
  update_downloading: ["Downloading the app update", "در حال دانلود نسخهٔ تازه"],
  update_ready: ["Update ready to install", "نسخهٔ تازه آمادهٔ نصب است"],
  update_error: ["The update couldn't be checked or downloaded. Try again.", "بررسی یا دانلود نسخه انجام نشد. دوباره امتحان کن."],
  installUpdate: ["Install update", "نصب به‌روزرسانی"],
  modelIntro: ["Choose an image or text model for your phone.", "برای گوشی‌ات مدل تصویر یا متن انتخاب کن."],
  studio: ["Studio", "استودیو"], models: ["Models", "مدل‌ها"], gallery: ["Gallery", "گالری"], device: ["Device", "گوشی"],
  local: ["On-device generation", "تولید روی گوشی"], hero: ["Image studio", "استودیوی تصویر"],
  heroBody: ["Create on your phone, even offline.", "مستقیم روی گوشی، حتی آفلاین."],
  prompt: ["Prompt", "پرامپت"], promptHint: ["Describe the image you want…", "تصویری را که می‌خواهی توصیف کن…"],
  clearPrompt: ["Clear", "پاک‌کردن"],
  example: ["Try a prompt", "پرامپت نمونه"], offlineNote: ["Once a model is installed, you can create without internet.", "بعد از نصب مدل، بدون اینترنت هم می‌توانی عکس بسازی."],
  modelEstimate: ["RAM recommendations are estimates. Speed depends on the processor and available memory.", "رده‌ها برآوردی بر اساس رم هستند. سرعت به پردازنده و رم آزاد بستگی دارد."],
  deviceIntro: ["Hardware and capacity reported by Android.", "مشخصات سخت‌افزار و ظرفیت گزارش‌شده توسط اندروید."],
  refresh: ["Refresh", "به‌روزرسانی"], preview: ["Image preview", "نمایش تصویر"], close: ["Close", "بستن"],
  keep: ["Keep", "نگه داشتن"], remove: ["Remove", "حذف"], removeModel: ["Remove model files?", "فایل‌های مدل حذف شوند؟"],
  removeModelCopy: ["Installed weights and any partial download for this model will be removed.", "مدل نصب‌شده و فایل ناقص دانلود آن حذف می‌شوند."],
  removePhoto: ["Remove this image?", "این عکس حذف شود؟"], removePhotoCopy: ["The copy in the app gallery will be removed.", "نسخهٔ داخل گالری برنامه پاک می‌شود."],
  noModels: ["Install a model first", "ابتدا یک مدل نصب کن"], chooseModel: ["Choose a model", "انتخاب مدل"],
  generate: ["Create image", "ساخت تصویر"], stop: ["Stop", "توقف"],
  loading: ["Opening model…", "در حال باز کردن مدل…"], working: ["Generating on the device…", "در حال ساخت روی گوشی…"],
  sampling: ["Sampling image…", "در حال شکل‌دادن تصویر…"], decoding: ["Rendering image…", "در حال آماده‌کردن تصویر…"],
  saving: ["Saving to gallery…", "در حال ذخیره در گالری…"],
  stopping: ["Stopping generation…", "در حال توقف تولید…"], cancelled: ["Generation stopped.", "ساخت تصویر متوقف شد."],
  ready: ["Image saved to your gallery.", "تصویر در گالری ذخیره شد."],
  recommended: ["Recommended for this device", "پیشنهاد برای این گوشی"], noFit: ["No matching RAM tier detected", "رم کافی برای مدل‌های فعلی تشخیص داده نشد"],
  noFitDetail: ["The lightest model is recommended for phones with 4 GB RAM or more.", "سبک‌ترین مدل برای گوشی‌های دارای ۴ گیگابایت رم یا بیشتر پیشنهاد می‌شود."],
  light: ["Weak", "ضعیف"], balanced: ["Medium", "متوسط"], power: ["Strong", "قوی"],
  all: ["All models", "همهٔ مدل‌ها"], installed: ["Installed", "نصب‌شده"], selected: ["Selected", "انتخاب‌شده"],
  fits: ["Within RAM estimate", "متناسب با رم گوشی"], ramShort: ["More RAM needed", "رم بیشتری لازم است"],
  ramRecommendation: ["GB RAM recommended", "گیگابایت رم پیشنهادی"], use: ["Use model", "استفاده"], download: ["Download", "دانلود"],
  resume: ["Resume", "ادامهٔ دانلود"], pause: ["Pause", "مکث"], connecting: ["Connecting…", "در حال اتصال…"],
  downloading: ["Downloading…", "در حال دانلود…"], retrying: ["Reconnecting…", "در حال اتصال دوباره…"],
  verifying: ["Verifying model file…", "در حال بررسی صحت فایل…"], pausing: ["Pausing…", "در حال توقف دانلود…"],
  paused: ["Paused · Progress kept", "متوقف شد؛ پیشرفت ذخیره شد"], modelReady: ["Ready to use", "آمادهٔ استفاده"],
  steps: ["steps", "مرحله"], empty: ["Your images will appear here.", "تصویرهای ساخته‌شده اینجا نمایش داده می‌شوند."],
  image: ["Image", "تصویر"], images: ["images", "تصویر"], export: ["Save PNG", "ذخیرهٔ PNG"],
  saved: ["PNG exported.", "فایل PNG ذخیره شد."], saveError: ["Could not export the image.", "ذخیرهٔ تصویر ناموفق بود."],
  hardwareWait: ["Reading this device…", "در حال خواندن مشخصات گوشی…"], ram: ["RAM", "رم"], storage: ["Internal storage", "فضای داخلی"],
  free: ["available", "فضای آزاد"], processor: ["Processor", "پردازنده"], cores: ["logical cores available", "هستهٔ منطقی در دسترس"],
  gpu: ["Graphics", "گرافیک"], os: ["Android", "اندروید"], engine: ["Image engine", "موتور تولید تصویر"],
  unavailable: ["Unavailable", "نامشخص"],
  memory: ["Close other apps to free RAM, or use a lighter model.", "برای آزاد کردن رم، برنامه‌های دیگر را ببند یا مدل سبک‌تری انتخاب کن."],
  disk: ["There is not enough free internal storage.", "فضای آزاد حافظهٔ داخلی کافی نیست."],
  diskShort: ["More storage needed", "فضای آزاد بیشتری لازم است"],
  needsFree: ["free space needed", "حداقل فضای آزاد لازم"],
  checksum: ["The file failed verification. Start the download again.", "فایل تأیید نشد. دانلود را دوباره شروع کن."],
  range: ["Resume is temporarily unavailable. Your downloaded bytes are still saved.", "فعلاً ادامهٔ دانلود ممکن نیست. بخش دانلودشده حفظ شده."],
  size: ["The server returned a different file size.", "حجم فایل سرور با فهرست مدل‌ها مطابقت ندارد."],
  network: ["Download interrupted. Check your connection and tap Resume.", "دانلود قطع شد. اینترنت را بررسی کن و «ادامهٔ دانلود» را بزن."],
  downloadAccess: ["The model host refused this download.", "میزبان مدل اجازهٔ این دانلود را نداد."],
  removeError: ["The file could not be removed.", "حذف فایل ممکن نشد."],
  engineError: ["The image engine could not start.", "موتور تولید تصویر شروع نشد."],
  engineStopped: ["The engine stopped. Free up RAM or try a lighter model.", "موتور متوقف شد. رم بیشتری آزاد کن یا مدل سبک‌تری امتحان کن."],
  generationError: ["Could not create the image.", "ساخت تصویر ناموفق بود."],
  catalog: ["Could not read the model catalog.", "خواندن فهرست مدل‌ها ناموفق بود."],
  search: ["Search models", "جست‌وجوی مدل"],
  searchPhotos: ["Search by prompt or model", "جست‌وجو با پرامپت یا مدل"],
  noPhotos: ["No images match this search.", "تصویری با این جست‌وجو پیدا نشد."],
  preparingGallery: ["Opening gallery…", "در حال باز کردن گالری…"],
  previous: ["Previous image", "تصویر قبلی"], next: ["Next image", "تصویر بعدی"],
  zoom: ["Zoom in", "بزرگ‌نمایی"], fit: ["Fit", "اندازهٔ کامل"],
  noResults: ["No models match these filters.", "مدلی با این فیلترها پیدا نشد."],
  auto: ["Automatic", "خودکار"], vulkan: ["Vulkan GPU", "گرافیک Vulkan"], hybrid: ["Hybrid", "ترکیبی"],
  cpu: ["CPU", "پردازندهٔ مرکزی"], fast: ["CPU · Fast decoder", "CPU با رمزگشای سریع"],
  autoDetail: ["Uses Vulkan when available and retries on CPU if acceleration fails.", "در صورت سازگاری از Vulkan استفاده می‌کند و در صورت خطا با CPU دوباره تلاش می‌کند."],
  vulkanDetail: ["Runs image processing on a compatible Vulkan 1.2+ GPU.", "پردازش تصویر روی گرافیک سازگار با Vulkan ۱.۲ به بالا."],
  hybridDetail: ["GPU denoising with CPU text encoding and image decoding.", "پردازش اصلی با GPU و پردازش متن و رمزگشایی تصویر با CPU."],
  cpuDetail: ["Runs every stage on the CPU.", "همهٔ مراحل روی پردازندهٔ مرکزی اجرا می‌شوند."],
  fastDetail: ["A smaller decoder speeds up SD 1.x and SD Turbo at the cost of some detail.", "در SD 1.x و SD Turbo رمزگشایی سریع‌تر است و ممکن است جزئیات کمتری داشته باشد."],
  gpuUnavailable: ["Compatible Vulkan unavailable", "Vulkan سازگار در دسترس نیست"],
  fastUnavailable: ["Works with SD 1.x and SD Turbo", "سازگار با SD 1.x و SD Turbo"],
  fallback: ["Trying again on CPU…", "تلاش دوباره با پردازندهٔ مرکزی…"],
  components: ["files", "فایل"], downloadStep: ["File", "فایل"]
};

const icons = {
  chat: '<path d="M20 11a8 8 0 0 1-8 8H7l-4 2 1.5-5A8 8 0 1 1 20 11Z"/>',
  studio: '<path d="M9 3 7 9 1 11l6 2 2 6 2-6 6-2-6-2-2-6ZM19 12v8m-4-4h8M17 2v4m-2-2h4"/>',
  models: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  gallery: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m4 17 5-5 3 3 4-4 5 5"/>',
  device: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/><rect x="10" y="10" width="4" height="4" rx=".5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  remove: '<path d="M4 7h16M10 4h4m4 3-1 13H7L6 7m4 4v5m4-5v5"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  previous: '<path d="m15 6-6 6 6 6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6m-3-3v6m5 2 4.5 4.5"/>'
};

const $ = (id) => document.getElementById(id);
const tabs = ["studio", "chat", "models", "gallery", "device"];
const filters = ["all", "imageModels", "text", "installed", "light", "balanced", "power"];
const engines = ["auto", "vulkan", "hybrid", "cpu", "fast"];
const button = (action, label, style = "outline", data = "", icon = "", disabled = false, aria = "remove") =>
  '<button class="' + style + '" data-action="' + action + '" data-value="' + esc(data) + '"' + (disabled ? " disabled" : "") +
  (label ? "" : ' aria-label="' + esc(t(aria)) + '"') + ">" + (icon ? glyph(icon) : "") + (label ? esc(t(label)) : "") + "</button>";
const glyph = (name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + "</svg>";
const esc = (value = "") => String(value).replace(/[&<>"']/g, (letter) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[letter]);
const validId = (id) => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
const photoUrl = (id) => "/photo/" + encodeURIComponent(id);
const bridge = window.Nocturne;
let language = localStorage.getItem("language") || (/^fa\b/.test(navigator.language) ? "fa" : "en");
let view = "studio";
let filter = "all";
let query = "";
let photoQuery = "";
let data = {models: [], photos: [], hardware: {}, generation: {}, download: {}};
let currentPhoto = "";
let viewerPhoto = "";
let zoom = 1;
let confirmAction = null;
let noticeTimer = 0;
const scrollPositions = new Map();
const defaultCanvas = $("canvas").innerHTML;

function t(key) { return text[key]?.[language === "fa" ? 1 : 0] ?? key; }
function number(value, decimals = 0) {
  return new Intl.NumberFormat(language, {maximumFractionDigits: decimals}).format(value);
}
function bytes(value = 0, disk = false) {
  const base = disk ? 1000 : 1024;
  if (!value) return number(0) + " MB";
  return value >= base ** 3 ? number(value / base ** 3, 2) + (disk ? " GB" : " GiB")
    : number(value / base ** 2, 1) + (disk ? " MB" : " MiB");
}
function replace(id, markup) {
  const node = $(id);
  if (node.dataset.rendered === markup) return;
  node.innerHTML = markup;
  node.dataset.rendered = markup;
}

function translations() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "fa" ? "rtl" : "ltr";
  $("language").textContent = language === "fa" ? "English" : "فارسی";
  document.querySelectorAll("[data-text]").forEach((node) => { node.textContent = t(node.dataset.text); });
  document.querySelectorAll("[data-placeholder]").forEach((node) => { node.placeholder = t(node.dataset.placeholder); });
  $("viewer").setAttribute("aria-label", t("preview"));
}

function switchView(id) {
  if (!tabs.includes(id)) return;
  const surface = $("surface");
  const changing = view !== id;
  if (changing) {
    scrollPositions.set(view, surface.scrollTop);
    if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) {
      document.activeElement.blur();
    }
  }
  view = id;
  for (const tab of tabs) $(tab).hidden = tab !== view;
  drawNav();
  drawActive();
  if (changing) surface.scrollTop = scrollPositions.get(view) || 0;
  if (id === "device" || id === "models") bridge?.refresh();
}

function drawNav() {
  replace("nav", tabs.map((id) => '<button data-action="tab" data-value="' + id + '"' +
    (view === id ? ' aria-current="page"' : "") + ">" + glyph(id) + "<span>" + t(id) + "</span></button>").join(""));
}

function drawActive() {
  drawActivity();
  drawAppUpdates();
  if (view === "chat") drawChat();
  if (view === "studio") drawStudio();
  if (view === "models") drawModels();
  if (view === "gallery") drawGallery();
  if (view === "device") drawHardware();
}

function generationPhase(status) {
  if (status.phase !== "working") return status.phase;
  const stage = status.stage || "";
  if (stage === "saving") return "saving";
  if (/sampl/i.test(stage)) return "sampling";
  if (/decod|vae/i.test(stage)) return "decoding";
  if (/load/i.test(stage)) return "loading";
  return "working";
}

function elapsed() {
  if (!data.generating || !data.generationStarted) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - data.generationStarted) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = new Intl.NumberFormat(language, {minimumIntegerDigits: 2}).format(seconds % 60);
  return number(minutes) + ":" + rest;
}

function refreshElapsed() {
  const time = elapsed();
  document.querySelectorAll("[data-elapsed]").forEach((node) => { node.textContent = time; });
}

function drawActivity() {
  const item = data.download;
  const currentDownload = data.models.find((model) => model.id === item.id);
  const showDownload = view !== "models" && currentDownload && (data.downloading || item.phase === "paused");
  const showGeneration = view !== "studio" && data.generating && !data.chat?.working;
  $("activity-strip").hidden = !showDownload && !showGeneration;
  replace("activity-strip", (showDownload ? '<button class="activity-item" data-action="tab" data-value="models">' +
    glyph("download") + '<span id="activity-download"></span></button>' : "") +
    (showGeneration ? '<button class="activity-item" data-action="tab" data-value="studio">' + glyph("studio") +
      '<span id="activity-generation"></span><bdi class="job-time" data-elapsed aria-hidden="true"></bdi></button>' : ""));
  if (showDownload) {
    const percent = currentDownload.bytes ? Math.min(100, Math.floor((item.received || 0) * 100 / currentDownload.bytes)) : 0;
    $("activity-download").textContent = currentDownload.name + " · " + t(item.phase) + " " + number(percent) + "%";
  }
  if (showGeneration) $("activity-generation").textContent = t(generationPhase(data.generation) || "loading");
  refreshElapsed();
}

function generationMessage(status) {
  if (status.phase === "error") {
    const code = {model: "noModels", engine: "engineError"}[status.error] || status.error;
    return '<div class="feedback error">' + (text[code] ? esc(t(code)) :
      esc(t("generationError")) + " " + esc(String(status.error || "").slice(0, 280))) + "</div>";
  }
  if (!status.phase) return "";
  const phase = generationPhase(status);
  const measurable = status.total > 0 && status.completed >= 0;
  const bar = data.generating ? '<progress aria-label="' + esc(t(phase)) + '"' +
    (measurable ? ' max="' + Number(status.total) + '" value="' + Math.min(status.completed, status.total) + '"' : "") + '></progress>' : "";
  const mode = engines.includes(status.mode) ? " · " + t(status.mode) : "";
  const steps = measurable ? " · " + number(status.completed) + "/" + number(status.total) : "";
  const clock = data.generating ? '<bdi class="job-time" data-elapsed aria-hidden="true"></bdi>' : "";
  return '<div class="feedback"><div class="job-line"><span>' + esc(t(phase) + mode + steps) + "</span>" + clock + "</div>" + bar + "</div>";
}

function drawStudio() {
  const photos = data.photos;
  if (!validId(currentPhoto) || !photos.some((photo) => photo.id === currentPhoto)) currentPhoto = photos[0]?.id || "";
  $("canvas").classList.toggle("photo", validId(currentPhoto));
  replace("canvas", validId(currentPhoto) ? '<button class="canvas-result" data-action="preview" data-value="' + esc(currentPhoto) +
    '" aria-label="' + esc(t("preview")) + '"><img src="' + photoUrl(currentPhoto) + '" alt="' + esc(t("image")) +
    '"></button><span class="canvas-overlay">' + glyph("expand") + "</span>" : defaultCanvas);
  if (!validId(currentPhoto)) {
    $("canvas").querySelectorAll("[data-text]").forEach((node) => {
      const label = t(node.dataset.text);
      if (node.textContent !== label) node.textContent = label;
    });
  }

  const installed = data.models.filter((model) => model.installed && model.task !== "text");
  const current = installed.find((model) => model.id === data.selected);
  replace("model-picker", installed.length ? '<select id="model-select" aria-label="' + esc(t("chooseModel")) + '"' +
    (data.generating ? " disabled" : "") + '><option value="" disabled' + (current ? "" : " selected") + ">" + esc(t("chooseModel")) +
    '</option>' + installed.map((model) => '<option value="' + esc(model.id) + '"' + (model === current ? " selected" : "") +
    ">" + esc(model.name) + " · " + number(model.size) + "²</option>").join("") + "</select>" :
    button("tab", "noModels", "outline", "models", "models"));
  const preference = data.preferred || "auto";
  const effective = engineUnavailable(preference) ? "cpu" : preference;
  replace("engine-picker", '<select id="engine-select"' + (data.generating ? " disabled" : "") + ">" +
    engines.map((id) => '<option value="' + id + '"' + (id === effective ? " selected" : "") +
      (engineUnavailable(id) ? " disabled" : "") + ">" + esc(t(id)) + "</option>").join("") + "</select>");
  replace("generation-status", data.initError ? '<div class="feedback error">' + t("catalog") + "</div>" : generationMessage(data.generation));
  replace("generate-actions", button("generate", "generate", "primary", "", "studio", !current || data.generating) +
    (data.generating ? button("stop", "stop", "outline danger", "", "", data.generation.phase === "stopping") : ""));
  updatePromptControls();
  refreshElapsed();
}

function updatePromptControls(save = false) {
  const prompt = $("prompt").value;
  if (save) localStorage.setItem("draft-prompt", prompt);
  $("count").textContent = number(prompt.length) + " / " + number(1500);
  document.querySelector('[data-action="clearPrompt"]').disabled = !prompt || data.generating;
  document.querySelector('[data-action="example"]').disabled = data.generating;
  const action = document.querySelector('[data-action="generate"]');
  if (action) action.disabled = data.generating || !prompt.trim()
    || !data.models.some((item) => item.installed && item.id === data.selected);
}

function modelTransfer(model) {
  const item = data.download;
  if (item.id !== model.id || !item.phase) return "";
  let phase = item.phase;
  let feedback = "";
  if (phase === "error") {
    const error = {ram: "ramShort", remove: "removeError", http401: "downloadAccess", http403: "downloadAccess", http404: "downloadAccess"}[item.error] || item.error;
    feedback = t(text[error] ? error : "network");
  } else feedback = t(phase === "ready" ? "modelReady" : phase);
  const received = Math.min(item.received || 0, model.bytes);
  const hasBar = data.downloading && phase !== "verifying";
  if (model.components > 1 && item.component > 0) {
    feedback += " · " + t("downloadStep") + " " + number(item.component) + "/" + number(model.components);
  }
  return (hasBar ? '<progress max="' + model.bytes + '" value="' + received + '" aria-label="' + esc(feedback) + '"></progress>' : "") +
    '<div class="progress-line' + (phase === "error" ? " danger" : "") + '"><span>' + esc(feedback) + "</span>" +
    (hasBar ? "<bdi>" + bytes(received, true) + " / " + bytes(model.bytes, true) + (item.rate > 0 ? " · " + bytes(item.rate, true) + "/s" : "") + "</bdi>" : "") + "</div>";
}

function drawModels() {
  const fits = data.models.filter((model) => model.fits && (filter === "text" ? model.task === "text" : model.task !== "text"));
  const hardwareTier = data.hardware.tier;
  const first = fits.find((model) => model.tier === hardwareTier) || fits[fits.length - 1];
  replace("recommendation", '<div class="banner"><span class="tile-icon">' + glyph("chip") + "</span><div><strong>" +
    esc(first?.name ?? t("noFit")) + "</strong><p>" + esc(first ? t("recommended") + " · " + t(first.tier) : t("noFitDetail")) + "</p></div></div>");
  replace("model-filters", filters.map((name) => '<button class="filter" data-action="filter" data-value="' + name +
    '" aria-pressed="' + (filter === name) + '">' + t(name) + "</button>").join(""));
  const models = data.models.filter((model) =>
    (filter === "all" || (filter === "installed" && model.installed) ||
      (filter === "text" && model.task === "text") || (filter === "imageModels" && model.task !== "text") ||
      model.tier === filter) &&
    (!query || (model.name + " " + (model.repo || "")).toLowerCase().includes(query)));
  const cards = models.map((model) => {
    const active = data.downloading && data.download.id === model.id;
    const current = (model.task === "text" ? data.selectedText : data.selected) === model.id && model.installed;
    const short = model.spaceOk === false && !model.installed;
    const badge = current ? "selected" : model.installed ? "installed" : !model.fits ? "ramShort" : short ? "diskShort" : "fits";
    const action = active ? "" :
      model.installed ? button("select", current ? "selected" : "use", "outline", model.id, "check", current || data.generating) :
      button("download", model.partial ? "resume" : "download", "primary", model.id, "download", data.downloading || !model.fits || short);
    const remove = !active && (model.installed || model.partial)
      ? button("removeModel", "", "icon-button danger", model.id, "remove", data.generating && current) : "";
    return '<article class="model' + (current ? " selected" : "") + '"><div class="model-header"><span class="tile-icon">' +
      glyph("models") + "</span><div><h2><bdi>" + esc(model.name) + '</bdi></h2><p class="meta"><bdi>' +
      esc(model.quant.toUpperCase()) + " · " + bytes(model.bytes, true) + " · " + (model.task === "text" ? "llama.cpp" : number(model.size) + "²") + "</bdi></p>" +
      '<p class="meta">' + esc(t(model.tier)) + " · " + number(model.ram) + " " + esc(t("ramRecommendation")) +
      (model.components > 1 ? " · " + number(model.components) + " " + t("components") : "") + "</p>" +
      (short ? '<p class="meta">' + bytes(model.requiredSpace, true) + " " + t("needsFree") + "</p>" : "") + "</div></div>" +
      '<div id="transfer-' + esc(model.id) + '"></div><div class="model-actions"><span class="badge ' + (model.fits && !short ? "good" : "warn") + '">' +
      t(badge) + '</span><div class="right">' + remove + action + "</div></div></article>";
  });
  replace("model-list", data.initError ? '<div class="feedback error">' + t("catalog") + "</div>" :
    cards.join("") || '<div class="empty">' + esc(t("noResults")) + "</div>");
  const downloading = data.downloading && data.models.find((model) => model.id === data.download.id);
  replace("transfer-shelf", downloading ? '<div class="transfer-shelf"><div><strong><bdi>' +
    esc(downloading.name) + '</bdi></strong><div id="active-transfer"></div></div>' +
    button("pause", "pause", "outline", "", "", data.download.phase === "pausing") + '</div>' : "");
  if (downloading) replace("active-transfer", modelTransfer(downloading));
  for (const model of models) {
    const transfer = "transfer-" + model.id;
    if ($(transfer)) replace(transfer, downloading ? "" : modelTransfer(model));
  }
}

function visiblePhotos() {
  return data.photos.filter((photo) => validId(photo.id) && (!photoQuery ||
    [photo.prompt, photo.model].some((value) => typeof value === "string" && value.toLowerCase().includes(photoQuery))));
}

function drawGallery() {
  const all = data.photos.length;
  const photos = visiblePhotos();
  $("gallery-search").hidden = !all && !photoQuery;
  $("gallery-count").textContent = data.galleryReady === false ? t("preparingGallery") :
    (photoQuery ? number(photos.length) + " / " : "") + number(all) + " " + t(all === 1 ? "image" : "images");
  replace("photo-list", photos.length ? '<div class="grid">' + photos.map((photo) =>
    '<button class="photo-card" data-action="preview" data-value="' + esc(photo.id) + '"><img loading="lazy" src="' +
    photoUrl(photo.id) + '" alt=""><span class="photo-prompt"><bdi>' + esc(photo.prompt || photo.model || t("image")) +
    '</bdi></span>' + (photo.model ? '<span class="photo-model"><bdi>' + esc(photo.model) + '</bdi></span>' : '') + "</button>").join("") +
    '</div>' : data.galleryReady === false ? "" : '<div class="empty">' + glyph("gallery") + "<p>" + t(photoQuery ? "noPhotos" : "empty") + "</p>" +
    (photoQuery ? "" : button("tab", "studio", "outline", "studio")) + "</div>");
}

function drawAppUpdates() {
  const update = data.appUpdate || {};
  const phase = update.phase;
  const install = button("installUpdate", "installUpdate", "primary", "", "download", data.generating);
  const version = update.version ? " · <bdi>" + esc(update.version) + "</bdi>" : "";
  $("update-alert").hidden = phase !== "ready";
  replace("update-alert", phase === "ready" ? '<div class="update-line"><span>' + t("update_ready") + version + "</span>" + install + "</div>" : "");
  if (view !== "device") return;
  const progress = phase === "downloading" && update.total > 0
    ? '<progress max="' + Number(update.total) + '" value="' + Number(update.received) + '"></progress><bdi>' +
      bytes(update.received, true) + " / " + bytes(update.total, true) + "</bdi>" : "";
  replace("update-card", '<div class="update-line"><span>' + (phase ? t("update_" + phase) : "") + version + "</span>" +
    (phase === "ready" ? install : button("checkUpdate", "checkUpdate", "outline", "", "", phase === "checking" || phase === "downloading")) +
    "</div>" + progress);
}

function drawChat() {
  const modelList = data.models.filter((item) => item.task === "text" && item.installed);
  const result = data.chat || {};
  const current = modelList.some((item) => item.id === data.selectedText);
  replace("chat-picker", modelList.length ? '<select id="chat-select" dir="auto"' +
    (data.generating ? " disabled" : "") + ">" +
    (current ? "" : '<option value="" disabled selected>' + t("textModel") + "</option>") +
    modelList.map((item) => '<option value="' + esc(item.id) + '"' + (data.selectedText === item.id ? " selected" : "") +
      ">" + esc(item.name) + "</option>").join("") + "</select>" : button("findText", "addText", "outline"));
  const message = result.prompt ? '<p class="chat-message user" dir="auto">' + esc(result.prompt) + "</p>" : "";
  const body = result.working ? t("answering") : result.answer ? esc(result.answer) : result.error ? t(({engine: "textFailed", model: "addText", cancelled: "chatCancelled"})[result.error] || result.error) : "";
  replace("chat-result", message + (body ? '<p class="chat-message" dir="auto">' + body + "</p>" : ""));
  replace("chat-actions", result.working ? button("stop", "stop", "outline danger") :
    button("chatSend", "send", "primary", "", "chat", !current || data.generating || !$("chat-prompt").value.trim()));
}

function sendChat() {
  const field = $("chat-prompt");
  const prompt = field.value.trim();
  if (!prompt || data.generating || !data.selectedText || !bridge) return;
  bridge.chat(prompt);
  field.value = "";
  field.blur();
  drawChat();
}

function drawDeviceActivity() {
  const phase = $("activity-filter").value;
  const events = (data.activity || []).filter(item => !phase || item.phase === phase);
  const date = new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "short" });
  const rows = events.map(item => '<div class="activity-record" data-phase="' + esc(item.phase) + '"><div><strong>' +
    esc(t(item.section === "downloads" ? "activityDownloads" : item.section)) + '</strong><small>' +
    esc(t("activity_" + item.phase)) + (item.detail ? " · " + esc(t(item.detail)) : "") +
    '</small></div><time><bdi>' + esc(date.format(item.time)) + '</bdi></time></div>');
  replace("device-activity", rows.join("") || '<p class="hint">' + t("activityEmpty") + '</p>');
}

function drawHardware() {
  drawDeviceActivity();
  const device = data.hardware;
  const stat = (key, value, detail = "") => '<div class="stat"><span>' + t(key) + '</span><strong><bdi>' + esc(value || t("unavailable")) +
    "</bdi></strong>" + (detail ? "<small><bdi>" + esc(detail) + "</bdi></small>" : "") + "</div>";
  replace("device-details", device.device ? '<div class="device-summary"><span class="tile-icon">' + glyph("device") +
    "</span><div><strong><bdi>" + esc(device.device) + "</bdi></strong><p>" + esc(t(device.tier)) + "</p></div></div><div class=\"stats\">" +
    stat("processor", device.chip, number(device.cores) + " " + t("cores")) +
    stat("ram", bytes(device.ram), bytes(device.available) + " " + t("free")) +
    stat("gpu", device.gpu, device.vulkan ? "Vulkan " + device.vulkan : "") +
    stat("storage", bytes(device.disk), bytes(device.free) + " " + t("free")) +
    stat("os", device.android, device.abi) + stat("engine", t(data.preferred || "auto"), "stable-diffusion.cpp") + "</div>" :
    '<div class="empty">' + esc(t("hardwareWait")) + "</div>");
  replace("engine-list", engines.map((id) => {
    const reason = engineUnavailable(id);
    return '<button class="engine-option" data-action="engine" data-value="' + id + '" aria-pressed="' +
      (id === (data.preferred || "auto")) + '"' + (reason || data.generating ? " disabled" : "") +
      '><span class="tile-icon">' + glyph("chip") + '</span><span class="engine-copy"><strong>' + esc(t(id)) +
      '</strong><small>' + esc(t(reason || id + "Detail")) + '</small></span>' +
      (id === (data.preferred || "auto") ? glyph("check") : "") + "</button>";
  }).join(""));
}

function engineUnavailable(id) {
  if ((id === "vulkan" || id === "hybrid") && !data.gpuAvailable) return "gpuUnavailable";
  if (id === "fast" && data.models.some((model) => model.id === data.selected && !model.fast)) return "fastUnavailable";
  return "";
}

function preview(id) {
  const photo = data.photos.find((item) => item.id === id);
  if (!photo || !validId(id)) return;
  if (viewerPhoto !== id) {
    $("full-image").src = photoUrl(id);
    $("viewer-notice").hidden = true;
    zoom = 1;
  }
  viewerPhoto = id;
  $("full-image").alt = photo.prompt || t("image");
  const date = photo.date ? new Date(photo.date).toLocaleDateString(language) : "";
  replace("photo-details", (photo.prompt ? '<p class="viewer-prompt"><bdi>' + esc(photo.prompt) + '</bdi></p>' : "") +
    '<p class="meta"><bdi>' +
    esc([photo.model, photo.size ? number(photo.size) + "²" : "", engines.includes(photo.engine) ? t(photo.engine) : "", date].filter(Boolean).join(" · ")) +
    '</bdi></p><div class="confirm-actions">' + button("removePhoto", "remove", "outline danger", id, "remove") +
    button("export", "export", "primary", id, "download") + "</div>");
  if (!$("viewer").open) $("viewer").showModal();
  drawViewerControls();
}

function viewerSequence() { return view === "gallery" ? visiblePhotos() : data.photos; }

function drawViewerControls() {
  const images = viewerSequence();
  const index = images.findIndex((photo) => photo.id === viewerPhoto);
  const nextIcon = language === "fa" ? "previous" : "next";
  const previousIcon = language === "fa" ? "next" : "previous";
  $("viewer-media").dataset.zoom = String(zoom);
  replace("viewer-controls", '<div class="viewer-navigation">' +
    button("previousPhoto", "", "icon-button", "", previousIcon, index <= 0, "previous") +
    '<bdi class="viewer-index">' + number(Math.max(0, index + 1)) + " / " + number(images.length) + '</bdi>' +
    button("nextPhoto", "", "icon-button", "", nextIcon, index < 0 || index >= images.length - 1, "next") +
    '</div><div class="viewer-navigation">' +
    button("zoomPhoto", "", "icon-button", "", "zoom", zoom >= 3, "zoom") +
    '<bdi class="viewer-index">' + number(zoom) + '×</bdi>' +
    button("fitPhoto", "fit", "quiet", "", "", zoom === 1) + "</div>");
}

function stepPhoto(step) {
  const list = viewerSequence();
  const index = list.findIndex((photo) => photo.id === viewerPhoto);
  if (index >= 0 && list[index + step]) preview(list[index + step].id);
}

function zoomPhoto(level) {
  const media = $("viewer-media");
  zoom = level;
  drawViewerControls();
  requestAnimationFrame(() => {
    media.scrollLeft = (media.scrollWidth - media.clientWidth) / 2;
    media.scrollTop = (media.scrollHeight - media.clientHeight) / 2;
  });
}

function confirmRemoval(type, id) {
  const dialog = $("confirm");
  $("confirm-title").textContent = t(type === "photo" ? "removePhoto" : "removeModel");
  $("confirm-copy").textContent = t(type === "photo" ? "removePhotoCopy" : "removeModelCopy");
  confirmAction = {type, id};
  dialog.returnValue = "";
  dialog.showModal();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button[data-action]");
  if (!target || target.disabled) return;
  const {action, value} = target.dataset;
  switch (action) {
    case "tab": switchView(value); break;
    case "language":
      language = language === "fa" ? "en" : "fa";
      localStorage.setItem("language", language);
      translations(); drawNav(); drawActive();
      if (viewerPhoto) preview(viewerPhoto);
      break;
    case "example":
      $("prompt").value = "A tiny observatory on a snow-covered mountain, violet night sky, cinematic landscape, soft moonlight";
      updatePromptControls(true);
      break;
    case "clearPrompt": $("prompt").value = ""; updatePromptControls(true); break;
    case "filter": if (filters.includes(value)) { filter = value; drawModels(); } break;
    case "refresh": bridge?.refresh(); break;
    case "download": bridge?.download(value); break;
    case "pause": bridge?.pauseDownload(); break;
    case "select": bridge?.select(value); switchView(data.models.some((item) => item.id === value && item.task === "text") ? "chat" : "studio"); break;
    case "findText": filter = "text"; switchView("models"); break;
    case "chatSend": sendChat(); break;
    case "clearActivity": if (window.confirm(t("activityConfirm"))) bridge?.clearActivity(); break;
    case "checkUpdate": bridge?.checkUpdate(); break;
    case "installUpdate": bridge?.installUpdate(); break;
    case "engine": bridge?.engine(value); break;
    case "generate": bridge?.generate($("prompt").value.trim()); $("prompt").blur(); break;
    case "stop": bridge?.stop(); break;
    case "preview": preview(value); break;
    case "closePreview": $("viewer").close(); break;
    case "previousPhoto": stepPhoto(-1); break;
    case "nextPhoto": stepPhoto(1); break;
    case "zoomPhoto": zoomPhoto(Math.min(3, zoom + 1)); break;
    case "fitPhoto": zoomPhoto(1); break;
    case "export": bridge?.export(value); break;
    case "removeModel": confirmRemoval("model", value); break;
    case "removePhoto": confirmRemoval("photo", value); break;
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id === "activity-filter") drawDeviceActivity();
  if (event.target.id === "chat-select") bridge?.select(event.target.value);
  if (event.target.id === "model-select") bridge?.select(event.target.value);
  if (event.target.id === "engine-select" && !engineUnavailable(event.target.value)) bridge?.engine(event.target.value);
});
$("catalog-query").addEventListener("input", (event) => {
  query = event.target.value.trim().toLowerCase();
  drawModels();
});
$("gallery-query").addEventListener("input", (event) => {
  photoQuery = event.target.value.trim().toLowerCase();
  drawGallery();
});
$("prompt").addEventListener("input", () => updatePromptControls(true));
$("chat-prompt").addEventListener("input", drawChat);
$("chat-prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault();
    sendChat();
  }
});
$("viewer").addEventListener("keydown", (event) => {
  if ($("confirm").open || zoom > 1 || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const forward = language === "fa" ? "ArrowLeft" : "ArrowRight";
  stepPhoto(event.key === forward ? 1 : -1);
});
$("confirm").addEventListener("close", () => {
  const pending = confirmAction;
  confirmAction = null;
  if (!pending || $("confirm").returnValue !== "remove") return;
  if (pending.type === "model") bridge?.remove(pending.id);
  else { $("viewer").close(); bridge?.deleteImage(pending.id); }
});
$("viewer").addEventListener("close", () => {
  viewerPhoto = "";
  $("full-image").removeAttribute("src");
  $("viewer-notice").hidden = true;
});

window.nocturneState = (snapshot) => {
  const previous = data.generation.id;
  data = {...data, ...snapshot};
  if (data.generation.phase === "ready") {
    currentPhoto = data.generation.id;
    if (previous !== currentPhoto && view !== "studio") notice("ready");
  }
  if (viewerPhoto && !data.photos.some((photo) => photo.id === viewerPhoto)) $("viewer").close();
  else if (viewerPhoto) drawViewerControls();
  drawActive();
};
window.nocturneRefresh = () => bridge?.refresh();
window.nocturneKeyboard = (visible) => document.body.classList.toggle("keys-visible", Boolean(visible));
function notice(key) {
  const target = $("viewer").open ? $("viewer-notice") : $("toast");
  const other = target === $("toast") ? $("viewer-notice") : $("toast");
  other.hidden = true;
  target.textContent = t(key);
  target.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { target.hidden = true; }, 3800);
}
window.nocturneNotice = (success) => notice(success ? "saved" : "saveError");
window.nocturneBack = () => {
  if ($("confirm").open) { $("confirm").close(); return true; }
  if ($("viewer").open) { $("viewer").close(); return true; }
  if (view !== "studio") { switchView("studio"); return true; }
  return false;
};

translations();
$("prompt").value = (localStorage.getItem("draft-prompt") || "").slice(0, 1500);
drawNav();
drawStudio();
setInterval(refreshElapsed, 1000);
window.nocturneRefresh();
