import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { createIcons, Aperture, Images, Blocks, Search, Download, Sparkles, ArrowUpLeft, RefreshCw, Check, Cpu, HardDrive, X, WandSparkles, ExternalLink, Film, Play, AudioLines, Mic2, Layers, Lightbulb, FolderOpen, Globe2, ImagePlus, ShieldCheck, ScanEye, SlidersHorizontal, Save, Star, LockKeyhole, Bell, House, Settings } from 'lucide';
import './style.css';
import './themes.css';
import './studio.css';
import './workspace.css';
import './queue.css';
import { additionalTranslations } from './translations';
import { mountChat } from './chat';
import { mountLibrary } from './library';
import { mountWorkspacePreferences, pageInfo, rememberPage, startPage, workspacePages } from './workspace-ui';
import brandIcon from './assets/nocturne-icon.png';
import './redesign.css';
import './projects.css';
import { activateProject, addProject, buildCombinations, newId, pendingQueue, persistQueue, projectId, projects, relatedImages, scopedKey, stored, type QueueJob } from './projects';
import { matrixDialog, projectBar, projectDialog, queueTools } from './project-ui';

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
type Model = { id: string; downloads: number; likes: number; category: 'image' | 'video' | 'adapter' | 'sdcpp' | 'checkpoint' | 'gguf' | 'other'; pipeline_tag: string; gated: boolean };
type ImageMetadata = { project_id?: string; parent_image?: string; aspect_ratio?: string; mode?: 'edit'; strength?: number };
type GalleryItem = ImageMetadata & { name: string; thumbnail: string; date: string; prompt: string; original_prompt: string; model: string };
type Device = { id: string; name: string };
type LoadedModel = { id: string; kind: string; active: boolean };
type Status = { models: string[]; video_models: string[]; sdcpp_models: string[]; checkpoint_models: string[]; adapters: string[]; active: string | null; active_kind: string; loaded_models: LoadedModel[]; cache_enabled: boolean; devices: Device[]; device: string; images: number; model_folder: string; output_folder: string };
type DownloadProgress = { model_id: string; phase?: string; file?: string; attempt?: number; processed?: number; received?: number; total?: number; speed?: number };
type HardwareUsage = { ram_used: number | null; ram_total: number | null; gpu_used: number | null; gpu_total: number | null; gpu_percent: number | null };

const icons = { Aperture, Images, Blocks, Search, Download, Sparkles, ArrowUpLeft, RefreshCw, Check, Cpu, HardDrive, X, WandSparkles, ExternalLink, Film, Play, AudioLines, Mic2, Layers, Lightbulb, FolderOpen, Globe2, ImagePlus, ShieldCheck, ScanEye, SlidersHorizontal, Save, Star, LockKeyhole, Bell, House, Settings };
const app = document.querySelector<HTMLDivElement>('#app')!;
const featuredAnimagine = 'cagliostrolab/animagine-xl-3.1';
const featuredQwenLora = 'chatrlabs/Qwen-Image-2.1-Uncensored-Omni-LoRA-v0.1';
const featuredGGUF = 'AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF';
let models: string[] = [];
let sdcppModels: string[] = [];
let checkpointModels: string[] = [];
let videoModels: string[] = [];
let adapters: string[] = [];
let activeModel: string | null = null;
let activeKind = 'image';
let loadedModels: LoadedModel[] = [];
let keepLoaded = localStorage.getItem('nocturne-keep-models-loaded') === '1';
let startupModel = localStorage.getItem('nocturne-startup-model') || '';
let modelKind = 'image';
const aspectOptions = [['1:1', '۱:۱ · مربع'], ['16:9', '۱۶:۹ · افقی'], ['9:16', '۹:۱۶ · عمودی'], ['4:3', '۴:۳ · افقی'], ['3:4', '۳:۴ · عمودی'], ['3:2', '۳:۲ · افقی'], ['2:3', '۲:۳ · عمودی']];
const aspectPicker = (id: string) => `<label class="aspect-picker" for="${id}">نسبت تصویر <select id="${id}">${aspectOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>`;
let devices: Device[] = [];
let selectedDevice = 'cuda:0';
let modelFolder = '';
let outputFolder = '';
let snakeTimer: number | null = null;
let snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
let snakeDirection = { x: 1, y: 0 };
let snakeNextDirection = { x: 1, y: 0 };
let snakeFood = { x: 15, y: 10 };
let snakeScore = 0;
let batchRunning = false;
let batchCancelled = false;
let batchGpuDone = 0;
let batchCpuDone = 0;
let queueRunning = false;
let queueCancelled = false;
const queueDraftKey = 'nocturne-batch-queue-v2';
function readQueueDraft(): QueueJob[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(scopedKey(queueDraftKey)) || 'null');
    if (Array.isArray(saved)) {
      return saved.filter(item => item && typeof item.model_id === 'string' && typeof item.prompt === 'string' &&
        Number.isSafeInteger(item.count) && typeof item.variations === 'boolean' &&
        ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'].includes(item.aspect_ratio))
        .map(item => ({ model_id: item.model_id, count: item.count, prompt: item.prompt,
          aspect_ratio: item.aspect_ratio, variations: item.variations }));
    }
  } catch {}
  return [{ model_id: '', count: 20, prompt: '', aspect_ratio: '1:1', variations: false }];
}
let queueJobs = readQueueDraft();
let queueDraftWarning = false;

function saveQueueDraft() {
  try {
    localStorage.setItem(scopedKey(queueDraftKey), JSON.stringify(queueJobs));
    queueDraftWarning = false;
  } catch {
    if (!queueDraftWarning) toast('The queue draft could not be saved. Browser storage is full.', true);
    queueDraftWarning = true;
  }
}
let queueRowDone: number[] = [];
let ideaOffset = 0;
const ideas = [
  'A rainy city at night with neon lights', 'A fox in a snowy forest at sunrise',
  'A small house by the sea at sunset', 'A cinematic portrait in window light',
  'A spaceship on an unknown planet', 'A magical garden with glowing flowers',
  'Misty mountains and a wooden cabin', 'A friendly robot in a futuristic market',
  'An astronaut cat on the moon', 'A library with imaginative architecture',
];
let searchResults: Model[] = [];
let searchVisibleCount = 80;
let searchCategoryFilter: Model['category'] | 'all' = 'all';
let favoriteModels = new Set<string>(JSON.parse(localStorage.getItem('nocturne-favorite-models') || '[]'));
let showFavoritesOnly = false;
type Inspection = { size_gb: number | null; files: number; parameters: number | null; compatibility: string; download_kind: string | null; checkpoint_available: boolean; reason: string; gated: boolean; image_input?: boolean | null; download_bytes?: number | null; remaining_bytes?: number | null; requirements?: string[]; memory_gib?: [number, number] | null };
const inspections = new Map<string, Inspection>();
let gallery: GalleryItem[] = [];
const favoriteImagesKey = 'nocturne-favorite-images';
const promptPresetsKey = 'nocturne-prompt-presets';
const favoriteImages = new Set<string>(JSON.parse(localStorage.getItem(favoriteImagesKey) || '[]'));
type PromptPreset = { name: string; prompt: string; aspect: string };
let promptPresets = stored<PromptPreset[]>(scopedKey(promptPresetsKey), []);
let parentImage = '';
let viewerSettings: Partial<GalleryItem> = {};
let currentImageMetadata: Partial<GalleryItem> = {};
let versionFilter = '';
const studioDraftKey = 'nocturne-studio-draft';
let showFavoriteImages = false;
type StudioMode = 'create' | 'edit' | 'compare';
let studioMode: StudioMode = 'create';
let studioPreview: 'empty' | 'running' | 'ready' | 'error' = 'empty';
const imageNotificationsKey = 'nocturne-image-notifications';
let imageNotifications = localStorage.getItem(imageNotificationsKey) !== '0';
let currentImagePrompt = '';
let viewerPrompt = '';
let viewerZoom = 1;
let showGalleryDetails = localStorage.getItem('nocturne-gallery-details') === '1';
let videos: { name: string; date: string }[] = [];
let voices: { name: string; text: string; model: string; duration: number }[] = [];
let voiceModels: string[] = [];
let voiceSearchResults: { id: string; language: string; downloads: number }[] = [];
const voiceInspections = new Map<string, { engine: string | null; reason: string; size_gb: number | null }>();
let currentImage: string | null = null;
let editSourceImage = '';
let currentImageName = '';
let currentImageTemporary = false;
let hideImage = localStorage.getItem('nocturne-hide-image') === '1';
let hideRecent = localStorage.getItem('nocturne-hide-recent') === '1';
let hideCompare = localStorage.getItem('nocturne-hide-compare') === '1';
let hideGallery = localStorage.getItem('nocturne-hide-gallery') === '1';
let privacyCover = false;
let temporaryImage = localStorage.getItem('nocturne-temporary-image') === '1';
let galleryModelFilter = '';
let galleryQuery = '';
let galleryFrom = '';
let galleryTo = '';
let galleryLocked = Boolean(localStorage.getItem('nocturne-gallery-pin'));
let language = localStorage.getItem('nocturne-language') === 'fa' ? 'fa' : 'en';
let navigationRevision = 0;
const themes = { dusk: 'نُکتِرن', night: 'شب کلاسیک', gold: 'زرد و بنفش', neon: 'مشکی و آبی کم‌رنگ' } as const;

function applyTheme(theme: string | null) {
  const selected = theme && Object.prototype.hasOwnProperty.call(themes, theme) ? theme : 'dusk';
  document.documentElement.dataset.theme = selected;
  const select = document.querySelector<HTMLSelectElement>('#theme-select');
  if (select) select.value = selected;
}

const english: Record<string, string> = {
  'خانه':'Home','تنظیمات':'Settings','ظاهر':'Appearance','صفحهٔ شروع و پردازش':'Startup and processing',
  'حریم خصوصی و اعلان‌ها':'Privacy and notifications','پوشه‌ها و فضای ذخیره‌سازی':'Folders and storage',
  'یک بخش را انتخاب کن و شروع کن.':'Choose a workspace to get started.',
  'ساخت، ویرایش و مقایسهٔ تصویر':'Create, edit and compare images','ساخت ویدیو از پرامپت':'Generate video from a prompt',
  'تبدیل متن به گفتار':'Convert text to speech','گفتگو با مدل محلی':'Talk with a local model',
  'ساخت چند تصویر و مدیریت صف':'Generate images and manage the queue','پیداکردن و مدیریت مدل‌ها':'Find and manage models',
  'ظاهر و رفتار برنامه را برای خودت تنظیم کن.':'Personalize the app’s appearance and behavior.',
  'زبان برنامه':'App language','فاصلهٔ عناصر':'Interface spacing','جمع‌وجور':'Compact','راحت':'Comfortable',
  'منوی فقط‌آیکون':'Icon-only navigation','کاهش انیمیشن‌ها':'Reduce motion','ظاهر پیش‌فرض':'Default appearance','بازگردانی ظاهر':'Reset appearance',
  'صفحه هنگام بازشدن':'Startup page','نسبت پیش‌فرض تصویر':'Default image aspect ratio','آخرین صفحه':'Last page',
  'عکس‌ها ابتدا موقت باشند':'Start with temporary images','رمز گالری':'Gallery PIN','مدیریت قفل گالری':'Manage gallery lock',
  'رفتن به بخش…':'Go to a workspace…','رفتن به بخش':'Go to workspace','نام بخش':'Workspace name','بخشی پیدا نشد.':'No matching workspaces.',
  'پوشه‌ها':'Folders','مدل‌ها در حافظه':'Models in memory',
  'پوشهٔ ذخیرهٔ عکس و ویدیو':'Image and video output folder','فضای استفاده‌شده':'Storage used',
  'مدل هنگام بازشدن برنامه':'Model loaded at startup','مدل‌های قبلی در رم بمانند':'Keep previous models in RAM',
  'انتخاب پوشه':'Choose folder','تغییر پوشه':'Change folder','به‌روزرسانی حجم‌ها':'Refresh storage totals','بستن':'Close',
  'فیلترها':'Filters','تنظیمات پردازش':'Processing settings','منوی فشرده':'Compact navigation',
  'پیداکردن مدل':'Find models','مدل‌های نصب‌شده':'Installed models','دانلودها':'Downloads',
  'نسبت تصویر':'Aspect ratio','کتابخانهٔ مدل‌ها':'Model library','چت و کدنویسی':'Chat and code','وب‌سایت':'Website',
  'آمادهٔ کار':'Ready to work','حریم خصوصی و ذخیرهٔ موقت':'Privacy and temporary images',
  'پنهان‌کردن عکس‌های اخیر':'Hide recent images','پنهان‌کردن نتیجهٔ مقایسه':'Hide comparison previews',
  'تارکردن تصاویر گالری':'Blur gallery images','پوشش فوری · Ctrl+Shift+H':'Privacy screen · Ctrl+Shift+H',
  'ساخت، ویرایش و مقایسهٔ تصویر با مدل‌های محلی':'Create, edit and compare with local models',
  'اعلان ویندوز':'Windows notification','روشن':'On','خاموش':'Off','ساخت':'Create','ویرایش':'Edit','مقایسه':'Compare',
  'پیش‌نمایش تصویر':'Image preview','نتیجهٔ مقایسه':'Comparison results','آماده':'Ready',
  'در حال پردازش':'Working','موقت':'Temporary','ذخیره شد':'Saved','عملیات ناموفق':'Failed',
  'مدل در حال پردازش تصویر است':'Generating your image','پس از آماده‌شدن تصویر اعلان می‌گیری.':'You will see an alert when it is ready.',
  'پیش‌نمایش هنوز خالی است':'No preview yet','مدل و پرامپت را انتخاب کن و ساخت را بزن.':'Select a model and enter a prompt.',
  'تصویر آماده است.':'Image ready.','تصویر موقت آماده است.':'Temporary image ready.',
  'تصویر ویرایش‌شده آماده است.':'Edited image ready.','مقایسه کامل شد.':'Comparison complete.',
  'مشاهدهٔ نتیجه':'View result','بستن اعلان':'Dismiss',
  'نتیجهٔ دو مدل اینجا نمایش داده می‌شود.':'Both model results appear here.',
  'پرامپت‌های ذخیره‌شده':'Saved prompts','نام پرامپت':'Prompt name','ذخیرهٔ پرامپت':'Save prompt',
  'انتخاب پرامپت ذخیره‌شده':'Choose a saved prompt','یک پرامپت انتخاب کن':'Select a prompt',
  'استفاده':'Use','حذف':'Delete','فقط عکس‌های محبوب':'Favorite images only',
  'استفاده از پرامپت':'Reuse prompt','عکس محبوبی در این نتایج نیست.':'No favorite images match these filters.',
  'اول پرامپت و نام آن را وارد کن.':'Enter a prompt and a name first.',
  'این نام قبلاً استفاده شده است.':'This name is already in use.',
  'پرامپت و نسبت تصویر ذخیره شدند.':'Prompt and aspect ratio saved.',
  'پرامپت ذخیره‌شده حذف شد.':'Saved prompt deleted.',
  'تم برنامه':'App theme','شب کلاسیک':'Classic night','زرد و بنفش':'Yellow and purple','مشکی و آبی کم‌رنگ':'Black and pale blue','استودیوی محلی':'Local studio','کتابخانه':'Library','مدیریت':'Management','جست‌وجوی پیشرفته':'Advanced search','ابزارهای کتابخانه':'Library tools',
  'استودیوی تصویر':'Image studio','محیط کار':'Workspace','ساخت تصویر':'Create image','ساخت دسته‌ای':'Batch studio','ساخت ویدیو':'Create video','ساخت صدا':'Create audio','گالری صدا':'Audio gallery','مدل‌ها و جست‌وجو':'Models and search','گالری من':'My gallery','دستگاه پردازش':'Processing device','دستگاه انتخابی':'Selected device','رم سیستم':'System RAM','کارت گرافیک':'Graphics card','استودیو':'Studio','در حال آماده‌سازی...':'Getting ready...','تخیّل کن، تصویرش کن':'Imagine it. Create it','ایده‌ات را بنویس؛ Nocturne آن را با مدل انتخابی تو به تصویر تبدیل می‌کند.':'Describe your idea and Nocturne will create it with your selected model.','بوم تصویر':'Image canvas','هنوز تصویری ساخته نشده':'No image yet','ایدهٔ بعدی‌ات اینجا جان می‌گیرد':'Your next idea starts here','پرامپت را بنویس و روی «ساخت تصویر» بزن.':'Write a prompt and select Create image.','کتابخانهٔ تو':'Your library','عکس‌های اخیر':'Recent images','نمایش همه':'View all','پرامپت تصویر':'Image prompt','فارسی یا انگلیسی بنویس':'Write in Persian or English','انتخاب مدل':'Select model','عکس موقت؛ تا زمان ذخیره وارد گالری نشود':'Temporary image; save it to add it to the gallery','پنهان‌کردن تصویر روی بوم':'Hide image preview','پیش‌نمایش پنهان است':'Preview hidden','نمایش این عکس':'Reveal image','هنوز عکسی ذخیره نشده است.':'No saved images yet.','عکس موقت ساخته شد. برای نگه‌داشتن آن «ذخیره» را بزن.':'Temporary image created. Select Save to keep it.','عکس در پوشهٔ خروجی ذخیره شد.':'Image saved to the output folder.','همهٔ مدل‌ها':'All models','عکسی در این دسته پیدا نشد.':'No images in this category.','گالری تصاویر':'Image gallery','تمام تصویرهایی که با برنامه ساخته‌ای، همین‌جا نگهداری می‌شوند.':'Your saved images appear here.','نمایش پرامپت و مدل زیر عکس‌ها':'Show prompt and model under images','آماده‌سازی اولیه':'First run setup','برنامه پیش‌نیازها را بررسی می‌کند و فقط مواردِ نصب‌نشده را دریافت می‌کند. نصب مدل‌های هوش مصنوعی جداگانه و به انتخاب شماست.':'The app checks prerequisites and downloads only missing components. AI models are installed separately when you choose.','تلاش دوباره':'Retry','در حال جست‌وجو...':'Searching...','دانلود مدل':'Download model','بررسی':'Inspect','مدل‌های فارسی':'Persian models','مدل‌های محبوب':'Popular models','ساخت گفتار':'Generate speech','متنی که خوانده شود':'Text to read','مدل نصب‌شده و زبان':'Installed model and language','صدا در پوشهٔ خروجی ذخیره می‌شود.':'Audio is saved to the output folder.','جست‌وجوی مدل صدا':'Search voice models','تغییر پوشهٔ دانلود مدل‌ها':'Change model download folder','جست‌وجو':'Search','پخش صدا':'Play audio','هنوز صدایی ساخته نشده است.':'No audio yet.','پوشهٔ دانلود مدل‌ها':'Model download folder','مدل‌های روی سیستم':'Local models','در حال بررسی...':'Checking...'
};
Object.assign(english, {"تنظیمات ساخت دسته‌ای":"Quick batch settings","موضوع تصویرها":"Prompt","تعداد تصویر":"Image count","بدون سقف تعداد":"No fixed image limit","نصف تصویرها در پردازش GPU و نصف دیگر در پردازش جداگانهٔ CPU":"Split images across independent GPU and CPU workers","دو پردازش مستقل، هرکدام عکس‌های سهم خود را یکی‌یکی می‌سازند. مدل CPU رم بیشتری می‌گیرد و ممکن است کندتر باشد.":"Each worker processes its images independently. The CPU worker needs additional RAM.","شروع ساخت":"Generate batch","توقف ساخت":"Stop generation","ایده‌ها":"Prompt ideas","ایده‌های دیگر":"More ideas","روی یک ایده بزن تا در کادر موضوع قرار بگیرد.":"Select an idea to use it as the quick batch prompt.","مار بازی هنگام ساخت":"While you wait","شروع دوباره":"Restart","با کلیدهای جهت‌دار یا WASD بازی کن. ساخت عکس‌ها ادامه دارد.":"Use the arrow keys or WASD. Image generation continues in the background.","انتخاب نشده":"Not selected","در انتظار شروع":"Ready","در حال تکمیل مجموعه...":"Finishing the batch…","مجموعه آماده شد":"Batch completed","ساخت متوقف شد":"Generation stopped","ساخت مجموعه با خطا متوقف شد":"Batch stopped with an error","پوشهٔ دانلود:":"Download folder","هیچ‌کدام":"None","مدل‌های پیشنهادی":"Suggested models","دسترسی به مدل‌های محدود":"Restricted model access","چگونه کمکت کنم؟":"How can I help?","چطور کمکت کنم؟":"How can I help?","گفتگوها":"Conversations","＋ گفت‌وگوی جدید":"+ New conversation","جست‌وجوی گفتگوها":"Search conversations","حذف گفتگوی فعلی":"Delete current conversation","گفتگویی پیدا نشد.":"No conversations found.","ابتدا یک مدل دانلود کن":"Download a model to get started","مدل چت":"Chat model","مدل‌ها":"Models","کد ورودی":"Code input","کد":"Code","</> کد":"</> Code","＋ پیوست":"+ Attach","ایجنت":"Agent","توقف":"Stop","ارسال ↑":"Send ↑","پیام یا درخواست کدنویسی…":"Message or coding request…","کدت را اینجا بچسبان…":"Paste your code here…","کپی پاسخ":"Copy answer","پاسخ دوباره":"Regenerate response","تلاش دوباره":"Retry","بررسی کد":"Review code","برنامه‌ریزی":"Planning","شما":"You","دستیار":"Assistant","کپی کد":"Copy code","پنل کد":"Code panel","ذخیرهٔ فایل":"Save file","کپی":"Copy","مدل‌های چت و کدنویسی":"Chat models","بازخوانی مدل‌ها":"Refresh models","پیشنهادهای Ollama":"Ollama suggestions","بررسی نسخه‌ها و حجم":"Inspect variants and size","نسخهٔ مدل":"Model variant","موتور اجرا":"Runtime","دانلود نسخهٔ انتخابی":"Download selected variant","فضای استفاده‌شده":"Storage used","مدل‌های دانلودشده":"Downloaded models","عکس‌ها":"Images","ویدیوها":"Videos","فضای تاریخچه پر است؛ گفت‌وگوی جدید بسازید.":"History storage is full.","بررسی ورودی عکس":"Check image support","انتخاب عکس ورودی":"Upload source image","ویرایش عکس":"Edit image","شدت تغییر":"Edit strength","عکس دلخواه را انتخاب کن. نتیجهٔ بررسی فقط راهنماست؛ حتی اگر پشتیبانی تأیید نشد، می‌توانی ساخت را امتحان کنی.":"Upload an image and describe your changes. Model compatibility can be checked before editing.","یک پرامپت، دو خروجی کنار هم. تصاویر موقت‌اند تا خودت ذخیره‌شان کنی.":"Compare two models with the same prompt. Save the results you want to keep.","ذخیره در گالری":"Save to gallery","هنوز مدل چت دانلود نشده است.":"No chat model installed.","برای پیدا کردن مدل، در کادر بالای کتابخانه جست‌وجو کن.":"Search for a model using the library search field.","مثلاً: شهر آینده در شب، نورهای نئون، هوای بارانی":"For example: a futuristic city at night, neon lights and rain","مثلاً: شهری بارانی در شب، نورهای نئون، نمای سینمایی...":"Describe your image…","مثلاً: روباهی در جنگل برفی قدم می‌زند، حرکت دوربین آرام...":"Describe the video and camera motion…","متن فارسی یا زبان انتخابی را اینجا بنویس...":"Enter the text to read…","نام مدل، خانواده یا زبان را بنویس…":"Search models, families or languages…","جست‌وجوی پرامپت، مدل یا برچسب":"Search prompts, models or tags","از تاریخ":"From date","تا تاریخ":"To date","قفل گالری":"Gallery lock","برچسب‌ها؛ با ویرگول جدا کن":"Tags, separated by commas","ساخت ویدیو از پرامپت":"Generate video from a prompt","هنوز ویدیویی ساخته نشده":"No video generated yet","بوم ویدیو":"Video preview","ویدیوی تو اینجا نمایش داده می‌شود":"Your video preview appears here","مدل ویدیوساز را از بخش مدل‌ها انتخاب کن.":"Select a video model from the library.","پرامپت ویدیو":"Video prompt","انتخاب مدل ویدیو":"Select video model","ویدیوهای ساخته‌شده":"Generated videos","تمام تصویرهایی که با برنامه ساخته‌ای، همین‌جا نگهداری می‌شوند.":"Browse and organize your saved images.","صداهای ساخته‌شده و متن هر کدام اینجاست.":"Browse generated audio and its text.","سرور را روشن کن تا دوستانت با نام کاربری و رمز وارد شوند، مدل انتخاب کنند و عکس بسازند.":"Start the server so users can sign in and generate images remotely.","وب‌سایت تصویرسازی":"Image generation website","کنترل سرور":"Server control","روشن‌کردن وب‌سایت":"Start server","خاموش‌کردن":"Stop server","پورت":"Port","بازکردن دسترسی عمومی امن":"Enable public access","تنظیمات حافظه":"Memory settings","دانلود مدل":"Download model","جست‌وجوی مدل‌ها":"Search models"});

Object.assign(english, additionalTranslations);

const queueLabels = [
  [/^Job (\d+)$/, "کار $1", /^کار (\d+)$/, "Job $1"],
  [/^(\d+) jobs$/, "$1 کار", /^(\d+) کار$/, "$1 jobs"],
  [/^(\d+) \/ (\d+) images$/, "$1 از $2 تصویر", /^(\d+) از (\d+) تصویر$/, "$1 / $2 images"],
  [/^([\d,]+) \/ ([\d,]+) images generated$/, "$1 از $2 تصویر ساخته شد", /^([\d,]+) از ([\d,]+) تصویر ساخته شد$/, "$1 / $2 images generated"],
  [/^([\d,]+) images generated$/, "$1 تصویر ساخته شد", /^([\d,]+) تصویر ساخته شد$/, "$1 images generated"],
] as const;

function applyLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'en' ? 'ltr' : 'rtl';
  const select = document.querySelector<HTMLSelectElement>('#language-select'); if (select) select.value = language;
  const translations = language === 'en' ? english : Object.fromEntries(Object.entries(english).map(([fa, en]) => [en, fa]));
  const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('#project-select option:not([value=""]), #project-reference-select option:not([value=""]), #matrix-models label, #matrix-preview label, #chat-threads, #chat-artifact-code, .cache-path, textarea, .chat-prose, .chat-file-names, .code-box pre, [data-queue-model] option[value]:not([value=""]), #preset-select option:not([value=""])')) continue;
    const original = node.textContent?.trim() || '';
    if (Object.hasOwn(translations, original)) node.textContent = node.textContent!.replace(original, translations[original]);
    else if (node.parentElement?.matches('.queue-position, .queue-job-progress, #queue-jobs-count, #queue-details')) {
      for (const [en, faText, fa, enText] of queueLabels) {
        const pattern = language === 'en' ? fa : en;
        if (!pattern.test(original)) continue;
        node.textContent = node.textContent!.replace(original, original.replace(pattern, language === 'en' ? enText : faText));
        break;
      }
    }
  }
  for (const element of app.querySelectorAll<HTMLElement>('[placeholder], [aria-label], [title]')) {
    for (const attribute of ['placeholder', 'aria-label', 'title']) {
      const text = element.getAttribute(attribute);
      if (text && Object.hasOwn(translations, text)) element.setAttribute(attribute, translations[text]);
    }
  }
  const locale = language === 'en' ? 'en-US' : 'fa-IR';
  const counts = { 'gallery-count': projectId ? gallery.filter(item => item.project_id === projectId).length : gallery.length, 'voice-count': voices.length };
  for (const [id, count] of Object.entries(counts)) {
    const badge = document.getElementById(id);
    const text = count.toLocaleString(locale);
    if (badge && badge.textContent !== text) badge.textContent = text;
  }
  const anyProject = document.querySelector<HTMLOptionElement>('#project-select option[value=""]');
  const groupLabel = language === 'en' ? 'All projects' : 'همهٔ پروژه‌ها';
  if (anyProject && anyProject.textContent !== groupLabel) anyProject.textContent = groupLabel;
  const settings = document.querySelector('#workspace-settings-open');
  const label = language === 'en' ? 'Settings' : 'تنظیمات';
  settings?.setAttribute('aria-label', label);
  settings?.setAttribute('title', label);
  document.querySelectorAll('.nav-item').forEach(button => {
    const name = button.querySelector('span')?.textContent?.trim();
    if (name) { button.setAttribute('aria-label', name); button.setAttribute('title', name); }
  });
}

function observeInterfaceLanguage() {
  let pending = false;
  const observer = new MutationObserver(records => {
    if (pending || records.every(record => (record.target.parentElement || app).closest('.chat-prose, .code-box pre'))) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      observer.disconnect();
      applyLanguage();
      observer.observe(app, { subtree: true, childList: true, characterData: true });
    });
  });
  observer.observe(app, { subtree: true, childList: true, characterData: true });
}

function applyPrivacy() {
  const root = document.documentElement;
  root.classList.toggle('privacy-hide-images', hideImage || privacyCover);
  root.classList.toggle('privacy-hide-recent', hideRecent || privacyCover);
  root.classList.toggle('privacy-hide-compare', hideCompare || privacyCover);
  root.classList.toggle('privacy-hide-gallery', hideGallery || privacyCover);
  root.classList.toggle('privacy-cover', privacyCover);
  if (privacyCover) document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
}
let busy = false;
let cancellingDownload = false;
let lastDownloadActivity = 0;
let hardwarePoll: number | null = null;
let readingHardware = false;
let activeVoiceDownload: string | null = null;

function safe(value: string) {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function bytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '۰ B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** unit).toLocaleString('fa-IR', { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}

function updateDownloadProgress(progress: DownloadProgress) {
  if (progress.model_id === activeVoiceDownload) {
    const panel = document.querySelector<HTMLElement>('#voice-download-progress');
    if (panel) {
      panel.hidden = false;
      const percent = progress.total && progress.processed ? Math.min(100, Math.round(progress.processed / progress.total * 100)) : 0;
      document.querySelector<HTMLElement>('#voice-download-track')!.style.width = `${percent}%`;
      document.querySelector<HTMLElement>('#voice-download-stats')!.textContent = `${percent.toLocaleString('fa-IR')}٪ · ${bytes(progress.processed || 0)} از ${bytes(progress.total || 0)} · ${bytes(progress.speed || 0)}/ثانیه`;
    }
    return;
  }
  const panel = document.querySelector<HTMLElement>('#download-progress');
  if (!panel || panel.dataset.model !== progress.model_id) return;
  lastDownloadActivity = Date.now();
  const phases: Record<string, string> = { checking: 'در حال بررسی مخزن و اندازهٔ فایل‌ها...', reading: 'در حال بررسی سازگاری مدل...', starting: 'در حال اتصال و آماده‌سازی دانلود...', resuming: 'در حال ادامهٔ فایل‌های نیمه‌دانلودشده...', transferring: 'در حال دریافت و ذخیرهٔ فایل‌ها...', retrying: 'ارتباط قطع شد؛ در حال اتصال دوباره...', complete: 'دانلود کامل شد.' };
  if (progress.phase) document.querySelector<HTMLElement>('#download-phase')!.textContent = `${phases[progress.phase] || progress.phase}${progress.file ? ` ${progress.file}` : ''}${progress.phase === 'retrying' && progress.attempt ? ` · تلاش ${progress.attempt.toLocaleString('fa-IR')}` : ''}`;
  if (progress.total === undefined || progress.processed === undefined || progress.received === undefined || progress.speed === undefined) return;
  const percent = progress.total ? Math.min(100, Math.round(progress.processed / progress.total * 100)) : 0;
  document.querySelector<HTMLElement>('#download-percent')!.textContent = `${percent.toLocaleString('fa-IR')}٪`;
  document.querySelector<HTMLElement>('#download-fill')!.style.width = `${percent}%`;
  document.querySelector<HTMLElement>('#download-processed')!.textContent = `فایل‌ها: ${bytes(progress.processed)} از ${bytes(progress.total)}`;
  document.querySelector<HTMLElement>('#download-received')!.textContent = `دریافت از اینترنت: ${bytes(progress.received)}`;
  document.querySelector<HTMLElement>('#download-speed')!.textContent = `سرعت میانگین: ${bytes(progress.speed)}/ثانیه`;
}

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await invoke<ApiResult<T>>('backend_command', { action, payload });
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

function icon(name: keyof typeof icons, size = 18) {
  const iconName = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return `<i data-lucide="${iconName}" style="width:${size}px;height:${size}px"></i>`;
}

function refreshIcons() { createIcons({ icons, attrs: { 'stroke-width': 1.8 } }); }

function toast(message: string, bad = false) {
  const el = document.createElement('div');
  el.className = `toast ${bad ? 'toast-error' : ''}`;
  el.textContent = language === 'en' ? english[message] || message : message;
  document.body.append(el);
  setTimeout(() => el.remove(), 5200);
}

function imageReady(message: string, destination: StudioMode | 'gallery') {
  const body = language === 'en' ? english[message] || message : message;
  const notice = document.querySelector<HTMLElement>('#image-ready-notice')!;
  notice.querySelector('p')!.textContent = body;
  notice.hidden = false;
  const open = notice.querySelector<HTMLButtonElement>('[data-notice-open]')!;
  open.onclick = () => {
    notice.hidden = true;
    if (destination === 'gallery') setView('gallery');
    else {
      setView('studio');
      setStudioMode(destination);
      document.querySelector('.canvas-panel')!.scrollIntoView({ block: 'nearest' });
    }
  };
  if (imageNotifications) void invoke('notify_image_ready', { message: body }).catch(() => {});
}

function notifyCollection(count: number) {
  if (count <= 0) return;
  const message = language === 'en' ? `${count} images saved to your gallery.` : `${count.toLocaleString('fa-IR')} تصویر در گالری ذخیره شد.`;
  imageReady(message, 'gallery');
}

function setBusy(value: boolean, label = '') {
  busy = value;
  document.querySelectorAll<HTMLButtonElement>('button[data-work]').forEach(button => button.disabled = value || button.dataset.staticDisabled === '1');
  document.querySelector<HTMLSelectElement>('#project-select')!.disabled = value;
  const status = document.querySelector<HTMLElement>('#work-status')!;
  const ready = language === 'en' ? english['آمادهٔ کار'] : 'آمادهٔ کار';
  status.title = value ? label : "";
  status.innerHTML = value ? `<span class="spinner"></span>${safe(label)}` : '<span class="status-dot"></span>' + ready;
  refreshIcons();
}

async function refreshHardware() {
  if (readingHardware) return;
  readingHardware = true;
  try {
    const usage = await invoke<HardwareUsage>('hardware_usage', { device: selectedDevice });
    const ram = document.querySelector<HTMLElement>('#ram-usage');
    const gpu = document.querySelector<HTMLElement>('#gpu-usage');
    if (ram && usage.ram_total && usage.ram_used !== null) {
      const percent = Math.round(usage.ram_used / usage.ram_total * 100);
      ram.textContent = `${percent.toLocaleString('fa-IR')}٪ · ${bytes(usage.ram_used)} از ${bytes(usage.ram_total)}`;
      document.querySelector<HTMLElement>('#ram-fill')!.style.width = `${percent}%`;
    }
    if (gpu) {
      gpu.textContent = usage.gpu_total && usage.gpu_used !== null
        ? `${(usage.gpu_percent ?? 0).toLocaleString('fa-IR')}٪ پردازش · ${bytes(usage.gpu_used)} از ${bytes(usage.gpu_total)} حافظه`
        : selectedDevice === 'cpu' ? 'پردازش روی CPU' : 'آمار کارت گرافیک در دسترس نیست';
      document.querySelector<HTMLElement>('#gpu-fill')!.style.width = usage.gpu_total && usage.gpu_used !== null ? `${Math.round(usage.gpu_used / usage.gpu_total * 100)}%` : '0%';
    }
  } catch {} finally { readingHardware = false; }
}

function organizeModelsView() {
  const view = document.querySelector<HTMLElement>('#models-view')!;
  const layout = view.querySelector<HTMLElement>('.model-layout')!;
  const local = layout.querySelector<HTMLElement>('.model-card')!;
  const search = layout.querySelector<HTMLElement>('.search-card')!;
  const overview = document.createElement('div');
  overview.className = 'model-overview';
  overview.innerHTML = `<div><span>${icon('HardDrive', 18)}</span><small>مدل‌های تصویر</small><b id="overview-images">۰</b></div><div><span>${icon('Film', 18)}</span><small>مدل‌های ویدیو</small><b id="overview-videos">۰</b></div><div><span>${icon('Cpu', 18)}</span><small>آماده در حافظه</small><b id="overview-loaded">۰</b></div><div><span>${icon('Sparkles', 18)}</span><small>مدل فعال</small><b id="overview-active">انتخاب نشده</b></div>`;
  view.querySelector('.kind-tabs')!.after(overview);
  const group = (title: string, className: string, elements: Element[]) => {
    const details = document.createElement('details');
    details.className = `model-fold ${className}`;
    details.innerHTML = `<summary>${icon('SlidersHorizontal', 17)}<span>${title}</span><span class="fold-chevron">⌄</span></summary><div class="model-fold-content"></div>`;
    elements.forEach(element => details.querySelector('.model-fold-content')!.append(element));
    return details;
  };
  const storage = document.querySelector('#preferences-storage')!;
  const processing = document.querySelector('#preferences-processing')!;
  for (const card of local.querySelectorAll('.cache-settings')) {
    (card.querySelector('#keep-models-loaded') ? processing : storage).append(card);
  }
  const searchControls = search.querySelector('.search-presets')!;
  const suggestions = group('مدل‌های پیشنهادی', 'featured-fold', [...search.querySelectorAll('.featured-model')]);
  const access = group('دسترسی به مدل‌های محدود', 'access-fold', [...search.querySelectorAll('.hf-auth')]);
  const options = group('جست‌وجوی پیشرفته', 'search-options-fold', [
    searchControls, search.querySelector('.engine-presets')!, search.querySelector('.search-note')!,
  ]);
  const engine = search.querySelector('.engine-update')!;
  engine.before(group('ابزارهای کتابخانه', 'library-tools-fold', [suggestions, access, options]));
  processing.append(engine);
}

function organizeStudioView() {
  const view = document.querySelector<HTMLElement>('#studio-view')!;
  const composer = view.querySelector<HTMLElement>('.composer')!;
  const studioGrid = view.querySelector<HTMLElement>('.studio-grid')!;
  studioGrid.after(studioGrid.querySelector('.recent-panel')!);
  studioGrid.prepend(composer);
  const head = view.querySelector('.studio-head')!;
  head.innerHTML = `<div><h1>استودیوی تصویر</h1><p>ساخت، ویرایش و مقایسهٔ تصویر با مدل‌های محلی</p></div>
    <button id="image-notifications" class="small-button studio-bell" type="button" aria-pressed="${imageNotifications}">${icon('Bell', 16)} <span>اعلان ویندوز</span><span class="studio-bell-state">${imageNotifications ? 'روشن' : 'خاموش'}</span></button>`;
  const tabs = document.createElement('div');
  tabs.className = 'studio-mode-switch';
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'حالت استودیوی تصویر');
  tabs.innerHTML = `
    <button type="button" data-studio-mode="create">${icon('Sparkles', 15)}<span>ساخت</span></button>
    <button type="button" data-studio-mode="edit">${icon('ImagePlus', 15)}<span>ویرایش</span></button>
    <button type="button" data-studio-mode="compare">${icon('Layers', 15)}<span>مقایسه</span></button>`;
  head.after(tabs);
  tabs.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    button.onclick = () => setStudioMode(button.dataset.studioMode as StudioMode);
  });

  const privacy = composer.querySelector<HTMLElement>('.image-options')!;
  const privacyFold = document.createElement('details');
  privacyFold.className = 'studio-fold privacy-fold';
  privacyFold.innerHTML = `<summary>${icon('ShieldCheck', 16)}<span>حریم خصوصی و ذخیرهٔ موقت</span><span class="fold-chevron">⌄</span></summary>`;
  privacyFold.append(privacy);
  composer.append(privacyFold);
  const settings = composer.querySelector('.composer-bottom')!;
  const compare = view.querySelector('.compare-panel')!;
  const edit = view.querySelector('.edit-panel')!;
  settings.before(edit);
  edit.querySelector('.edit-grid')!.insertAdjacentHTML('afterend',
    `<div id="project-references" class="reference-picker" hidden>
      <label for="project-reference-select">عکس‌های مرجع پروژه</label>
      <select id="project-reference-select"></select>
      <button type="button" id="project-load-reference" class="small-button" data-work>بازکردن عکس مرجع پروژه</button>
    </div>`);
  settings.after(compare);
  const compareResults = view.querySelector('#compare-results')!;
  compareResults.innerHTML = '<p class="comparison-empty">نتیجهٔ دو مدل اینجا نمایش داده می‌شود.</p>';
  view.querySelector('#canvas-stage')!.after(compareResults);
  compare.querySelector('h2')?.remove();
  edit.querySelector('.card-heading h2')?.remove();
  view.querySelector('.panel-top')!.insertAdjacentHTML('beforeend', '<span id="studio-preview-state" class="studio-preview-state" aria-hidden="true"></span>');
  setStudioMode('create');
  renderStudioPreview();
}

function setStudioMode(mode: StudioMode) {
  studioMode = mode;
  const view = document.querySelector<HTMLElement>('#studio-view')!;
  view.dataset.mode = mode;
  view.querySelectorAll<HTMLButtonElement>('[data-studio-mode]').forEach(button =>
    button.setAttribute('aria-pressed', String(button.dataset.studioMode === mode)));
  const title = document.querySelector('#canvas-title')!;
  title.textContent = mode === 'compare' ? 'نتیجهٔ مقایسه' : 'پیش‌نمایش تصویر';
  applyLanguage();
}

function renderStudioPreview(reveal = false) {
  const stage = document.querySelector<HTMLElement>('#canvas-stage')!;
  const state = document.querySelector('#studio-preview-state')!;
  stage.classList.toggle('generating', studioPreview === 'running');
  stage.setAttribute('aria-busy', String(studioPreview === 'running'));
  state.textContent = ({
    empty: 'آماده', running: 'در حال پردازش', ready: currentImageTemporary ? 'موقت' : 'ذخیره شد', error: 'عملیات ناموفق',
  })[studioPreview];
  state.setAttribute('data-state', studioPreview);
  document.querySelector<HTMLButtonElement>('#save-image')!.disabled = !currentImage || studioPreview === 'running';
  if (studioPreview === 'running') {
    stage.innerHTML = `<div class="generation-loader" role="status"><div class="studio-scan" aria-hidden="true"></div><b>مدل در حال پردازش تصویر است</b><p>پس از آماده‌شدن تصویر اعلان می‌گیری.</p></div>`;
  } else if (currentImage && hideImage && !reveal) {
    stage.innerHTML = `<div class="hidden-image-state"><b>پیش‌نمایش پنهان است</b><button class="small-button" id="reveal-image">نمایش این عکس</button></div>`;
    stage.querySelector<HTMLButtonElement>('#reveal-image')!.onclick = () => renderStudioPreview(true);
  } else if (currentImage) {
    const image = currentImage;
    const name = currentImageName;
    stage.innerHTML = `<button type="button" class="studio-open-preview" aria-label="نمایش بزرگ تصویر"><img class="main-image" alt="تصویر ساخته‌شده" src="${safe(image)}"/></button>`;
    stage.querySelector<HTMLButtonElement>('button')!.onclick = () => { if (!privacyCover) showImage(image, name); };
  } else {
    stage.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('ImagePlus', 30)}</div><h3>${studioPreview === 'error' ? 'ساخت تصویر انجام نشد' : 'پیش‌نمایش هنوز خالی است'}</h3><p>${studioPreview === 'error' ? 'پیام خطا را ببین و دوباره تلاش کن.' : 'مدل و پرامپت را انتخاب کن و ساخت را بزن.'}</p></div>`;
  }
  refreshIcons();
  applyLanguage();
}

function setCompactNavigation(compact: boolean) {
  document.querySelector('.app-shell')!.classList.toggle('compact-nav', compact);
}

function organizeWorkspace() {
  const video = document.querySelector('.video-layout')!;
  video.prepend(video.querySelector('.composer')!);
  const gallery = document.querySelector('#gallery-view .gallery-search')!;
  const filters = document.createElement('details');
  filters.className = 'gallery-advanced';
  filters.innerHTML = `<summary>${icon('SlidersHorizontal', 15)}<span>فیلترها</span><span class="fold-chevron">⌄</span></summary><div class="gallery-filter-fields"></div>`;
  const fields = filters.querySelector('.gallery-filter-fields')!;
  for (const id of ['gallery-from', 'gallery-to', 'gallery-model-filter']) fields.append(document.getElementById(id)!);
  fields.append(document.querySelector('#gallery-details-toggle')!.closest('label')!);
  gallery.append(document.querySelector('#gallery-favorites-filter')!.closest('label')!, filters);

  const batch = document.querySelector('#batch-view')!;
  const split = batch.querySelector('.batch-split')!;
  const advanced = document.createElement('details');
  advanced.className = 'batch-advanced model-fold';
  advanced.innerHTML = '<summary>تنظیمات پردازش <span class="fold-chevron">⌄</span></summary>';
  split.before(advanced);
  advanced.append(split, batch.querySelector('.batch-split-note')!);

  const hardware = document.querySelector('.workspace-hardware-source')!;
  document.querySelector('#preferences-processing')!.prepend(hardware.firstElementChild!);
  hardware.remove();
}

function organizeBatchStudio() {
  const view = document.querySelector('#batch-view')!;
  view.querySelector('.section-head')!.innerHTML = '<h1>Batch studio</h1><p>Build a sequence of prompts and models. Each job runs in order.</p>';
  const modes = document.createElement('div');
  modes.className = 'batch-mode-tabs';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Batch mode');
  modes.innerHTML = '<button type="button" class="small-button" data-batch-mode="queue" data-work>Job queue</button><button type="button" class="small-button" data-batch-mode="quick" data-work>Quick batch</button>';
  view.querySelector('.section-head')!.after(modes);
  const choose = (mode: string) => {
    view.setAttribute('data-batch-mode', mode);
    modes.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.getAttribute('data-batch-mode') === mode)));
  };
  modes.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.onclick = () => choose(button.dataset.batchMode!));
  choose('queue');
  const queue = view.querySelector('.queue-card')!;
  modes.after(queue);
  queue.querySelector('.card-heading h2')!.textContent = 'Job queue';
  queue.querySelector('.queue-hint')!.insertAdjacentHTML('afterend', queueTools);
  queue.querySelector('.queue-hint')!.textContent = 'Set a prompt, model, count and aspect ratio for each job. Drafts are saved on this device.';
  queue.querySelector('#queue-add')!.textContent = '+ Add job';
  queue.querySelector('.queue-total')!.innerHTML = '<span id="queue-jobs-count"></span><span><b id="queue-total">0</b> images total</span>';
  queue.querySelector('#queue-start')!.innerHTML = `${icon('Play', 15)} Run queue`;
  queue.querySelector('#queue-stop')!.textContent = 'Stop queue';
  queue.querySelector('#queue-state')!.textContent = 'Ready';
  queue.querySelector('#queue-details')!.textContent = 'No images generated yet.';
}

function render() {
  applyPrivacy();
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark"><img src="${brandIcon}" alt=""/></div><div><b>Nocturne</b><span>استودیوی محلی</span></div></div>
        <nav class="nav">
          <div class="nav-group workspace-home-nav">
            <button class="nav-item" data-view="home">${icon('House')}<span>خانه</span></button>
          </div>
          <div class="nav-group" id="nav-create">
            <div class="sidebar-label">استودیو</div>
            <button class="nav-item active" data-view="studio" aria-current="page">${icon('WandSparkles')}<span>ساخت تصویر</span></button>
            <button class="nav-item" data-view="video">${icon('Film')}<span>ساخت ویدیو</span></button>
            <button class="nav-item" data-view="voice">${icon('Mic2')}<span>ساخت صدا</span></button>
            <button class="nav-item" data-view="batch">${icon('Layers')}<span>ساخت دسته‌ای</span></button>
          </div>
          <div class="nav-group">
            <div class="sidebar-label">کتابخانه</div>
            <button class="nav-item" data-view="models">${icon('SlidersHorizontal')}<span>کتابخانهٔ مدل‌ها</span></button>
            <button class="nav-item" data-view="gallery">${icon('Images')}<span>گالری من</span><em id="gallery-count">۰</em></button>
            <button class="nav-item" data-view="audio-gallery">${icon('AudioLines')}<span>گالری صدا</span><em id="voice-count">۰</em></button>
          </div>
          <div class="nav-group">
            <div class="sidebar-label">مدیریت</div>
            <button class="nav-item" data-view="website">${icon('Globe2')}<span>وب‌سایت</span></button>
          </div>
        </nav>
        <div class="sidebar-bottom workspace-settings-nav"><button class="nav-item" data-view="settings">${icon('Settings')}<span>تنظیمات</span></button></div>
        <div class="workspace-hardware-source" hidden><div class="hardware-details"><label class="device-label" for="device-select">دستگاه پردازش</label><select id="device-select" class="device-select" aria-label="دستگاه پردازش"></select><div class="gpu-card"><div class="gpu-icon">${icon('Cpu', 21)}</div><div><small>دستگاه انتخابی</small><b id="gpu-name">در حال بررسی...</b></div><span class="pulse"></span></div><div class="hardware-card"><div class="hardware-row"><span>رم سیستم</span><b id="ram-usage">در حال بررسی...</b></div><div class="hardware-track"><i id="ram-fill"></i></div><div class="hardware-row"><span>کارت گرافیک</span><b id="gpu-usage">در حال بررسی...</b></div><div class="hardware-track"><i id="gpu-fill"></i></div></div></div></div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="crumb"><span id="page-group">استودیو</span><strong id="page-title">ساخت تصویر</strong></div>
          ${projectBar}
          <div class="top-actions">
            <button type="button" id="workspace-command-open" class="small-button">${icon('Search', 15)}<span>رفتن به بخش</span><kbd dir="ltr">Ctrl K</kbd></button>
            <button type="button" id="workspace-settings-open" class="icon-button" aria-label="تنظیمات" title="تنظیمات">${icon('Settings', 16)}</button>
            <span id="work-status" role="status"><span class="status-dot"></span>در حال آماده‌سازی...</span>
          </div>
        </header>
        ${workspacePages(
          Object.entries(themes).map(([value, label]) => `<option value="${value}">${label}</option>`).join(''),
          aspectOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join(''),
          name => icon(name, 18),
        )}
        <section class="view active" id="studio-view">
          <div class="studio-head"><div><span class="eyebrow">CREATE YOUR VISION</span><h1>تخیّل کن، تصویرش کن<span>.</span></h1><p>ایده‌ات را بنویس؛ Nocturne آن را با مدل انتخابی تو به تصویر تبدیل می‌کند.</p></div></div>
          <div class="studio-grid"><div class="canvas-panel"><div class="panel-top"><div><span class="panel-kicker">بوم تصویر</span><h2 id="canvas-title">هنوز تصویری ساخته نشده</h2></div><button class="icon-button" id="save-image" title="ذخیرهٔ عکس" disabled>${icon('Save')}</button></div><div class="canvas-stage" id="canvas-stage"><div class="ambient-orb orb-a"></div><div class="ambient-orb orb-b"></div><div class="empty-state"><div class="empty-icon">${icon('ImagePlus', 42)}</div><h3>ایدهٔ بعدی‌ات اینجا جان می‌گیرد</h3><p>پرامپت را بنویس و روی «ساخت تصویر» بزن.</p></div></div></div><div class="recent-panel"><div class="recent-head"><div><span class="panel-kicker">کتابخانهٔ تو</span><h2>عکس‌های اخیر</h2></div><button class="text-button" data-view="gallery">نمایش همه ${icon('ArrowUpLeft', 15)}</button></div><div class="recent-grid" id="recent-grid"></div></div></div>
          <div class="composer"><div class="image-options"><label><input id="temporary-image" type="checkbox" ${temporaryImage ? 'checked' : ''}/> عکس موقت؛ تا زمان ذخیره وارد گالری نشود</label><label><input id="hide-image" type="checkbox" ${hideImage ? 'checked' : ''}/> پنهان‌کردن تصویر روی بوم</label><label><input id="hide-recent" type="checkbox" ${hideRecent ? 'checked' : ''}/> پنهان‌کردن عکس‌های اخیر</label><label><input id="hide-compare" type="checkbox" ${hideCompare ? 'checked' : ''}/> پنهان‌کردن نتیجهٔ مقایسه</label><label><input id="hide-gallery" type="checkbox" ${hideGallery ? 'checked' : ''}/> تارکردن تصاویر گالری</label><button id="privacy-cover-button" class="small-button">${icon('ShieldCheck', 15)} پوشش فوری · Ctrl+Shift+H</button></div><div class="composer-top"><span>${icon('Sparkles', 16)} پرامپت تصویر</span><span>فارسی یا انگلیسی بنویس</span></div><textarea id="prompt" dir="auto" placeholder="مثلاً: شهری بارانی در شب، نورهای نئون، نمای سینمایی..."></textarea><div class="composer-bottom"><button class="model-pill" id="model-pill">${icon('Blocks', 16)}<span id="active-model-label">انتخاب مدل</span>${icon('ArrowUpLeft', 14)}</button>${aspectPicker('image-aspect')}<button class="primary-button" id="generate" data-work>${icon('Sparkles', 18)}<span>ساخت تصویر</span><span class="button-shine"></span></button></div><details id="prompt-presets" class="studio-fold prompt-presets"><summary>${icon('Save', 16)}<span>پرامپت‌های ذخیره‌شده</span><span class="fold-chevron">⌄</span></summary><div class="preset-controls"><label for="preset-name">نام پرامپت</label><div class="preset-row"><input id="preset-name" maxlength="60"/><button id="preset-save" class="small-button">ذخیرهٔ پرامپت</button></div><label for="preset-select">انتخاب پرامپت ذخیره‌شده</label><select id="preset-select"></select><div class="preset-actions"><button id="preset-load" class="small-button">استفاده</button><button id="preset-remove" class="small-button">حذف</button></div></div></details></div><div class="edit-panel"><div class="card-heading"><div>${icon('Images')}<h2>ویرایش عکس با مدل</h2></div><button id="check-image-input" class="small-button">${icon('ScanEye', 15)} بررسی ورودی عکس</button></div><p>عکس دلخواه را انتخاب کن. نتیجهٔ بررسی فقط راهنماست؛ حتی اگر پشتیبانی تأیید نشد، می‌توانی ساخت را امتحان کنی.</p><div class="edit-grid"><label class="edit-upload">${icon('Images', 24)}<span>انتخاب عکس ورودی</span><input id="edit-source" type="file" accept="image/png,image/jpeg,image/webp"/></label><img id="edit-source-preview" alt="عکس ورودی" hidden/></div><p id="image-input-status">یک مدل و عکس انتخاب کن؛ سپس بررسی یا ویرایش را بزن.</p><textarea id="edit-prompt" placeholder="تغییر دلخواه را بنویس؛ مثلاً آسمان را غروب کن و ساختمان‌ها را نگه دار..."></textarea><label class="edit-strength">شدت تغییر <input id="edit-strength" type="range" min="0.1" max="0.95" step="0.05" value="0.65"/><b id="edit-strength-value">۰٫۶۵</b></label><button id="edit-generate" class="primary-button" data-work>${icon('Sparkles',18)} ویرایش عکس</button></div><div class="compare-panel"><h2>مقایسهٔ دو مدل</h2><p>یک پرامپت، دو خروجی کنار هم. تصاویر موقت‌اند تا خودت ذخیره‌شان کنی.</p><div class="compare-controls"><select id="compare-model-a"></select><select id="compare-model-b"></select><button id="compare-start" class="primary-button">${icon('Images', 17)} مقایسه</button></div><p id="compare-status"></p><div id="compare-results" class="compare-results"></div></div>
        </section>
        <section class="view" id="batch-view"><div class="section-head"><span class="eyebrow">BATCH STUDIO</span><h1>ساخت دسته‌ای</h1><p>موضوع را بنویس، تعداد را انتخاب کن و در صورت تمایل، کار را بین GPU و CPU تقسیم کن.</p></div><div class="batch-layout"><div class="model-card batch-card"><div class="card-heading"><div>${icon('Layers')}<h2>تنظیمات ساخت دسته‌ای</h2></div></div><label class="batch-label" for="batch-topic">موضوع تصویرها</label><textarea id="batch-topic" class="batch-topic" placeholder="مثلاً: شهر آینده در شب، نورهای نئون، هوای بارانی"></textarea><div class="batch-count-row"><label class="batch-label" for="batch-count">تعداد تصویر</label><input id="batch-count" type="number" min="1" step="1" value="10"/><span>بدون سقف تعداد</span></div>${aspectPicker('batch-aspect')}<label class="batch-split"><input id="batch-split-cpu" type="checkbox"/> نصف تصویرها در پردازش GPU و نصف دیگر در پردازش جداگانهٔ CPU</label><p class="batch-split-note">دو پردازش مستقل، هرکدام عکس‌های سهم خود را یکی‌یکی می‌سازند. مدل CPU رم بیشتری می‌گیرد و ممکن است کندتر باشد.</p><div class="batch-actions"><button class="primary-button" id="start-batch" data-work>${icon('Sparkles', 18)} شروع ساخت</button><button class="cancel-download" id="stop-batch" hidden>توقف ساخت</button></div><p class="batch-note">Each image is saved when ready. Active model: <b id="batch-model">انتخاب نشده</b></p><div id="batch-progress" class="batch-progress hidden"><div class="download-head"><strong id="batch-state">در حال آماده‌سازی...</strong><b id="batch-percent">۰٪</b></div><div class="download-track"><div id="batch-fill"></div></div><p id="batch-details">۰ از ۰ تصویر ساخته شد</p><p id="batch-workers">GPU: ۰ · CPU: ۰</p></div></div><div class="model-card ideas-card"><div class="card-heading"><div>${icon('Lightbulb')}<h2>ایده‌ها</h2></div><button class="small-button" id="shuffle-ideas">ایده‌های دیگر</button></div><p class="ideas-intro">روی یک ایده بزن تا در کادر موضوع قرار بگیرد.</p><div id="ideas-list" class="ideas-list"></div></div></div><div class="model-card queue-card"><div class="card-heading"><div>${icon('Layers')}<h2>صف چندمدلی</h2></div><button class="small-button" id="queue-add">افزودن مدل</button></div><p class="queue-hint">موضوع را در کادر بالا بنویس. مدل‌ها به ترتیب ردیف‌ها اجرا می‌شوند و هر عکس همان لحظه ذخیره می‌شود.</p><div id="queue-rows"></div><div class="queue-total">مجموع: <b id="queue-total">۰</b> عکس</div><div class="batch-actions"><button class="primary-button" id="queue-start" data-work>${icon('Sparkles', 18)} شروع صف</button><button class="cancel-download" id="queue-stop" hidden>توقف صف</button></div><div id="queue-progress" class="batch-progress hidden"><div class="download-head"><strong id="queue-state">در انتظار شروع</strong><b id="queue-percent">۰٪</b></div><div class="download-track"><div id="queue-fill"></div></div><p id="queue-details">۰ عکس ساخته شد</p></div></div><div class="model-card snake-card hidden" id="snake-card"><div class="card-heading"><div>${icon('Sparkles')}<h2>مار بازی هنگام ساخت</h2></div><button class="small-button" id="snake-restart">شروع دوباره</button></div><p id="snake-message">با کلیدهای جهت‌دار یا WASD بازی کن. ساخت عکس‌ها ادامه دارد.</p><div class="snake-content"><canvas id="snake-canvas" width="320" height="320" aria-label="بازی مار"></canvas><div class="snake-side"><b>Score: <span id="snake-score">۰</span></b><div class="snake-controls"><button data-snake-dir="up">↑</button><button data-snake-dir="left">←</button><button data-snake-dir="down">↓</button><button data-snake-dir="right">→</button></div></div></div></div></section>
        <section class="view" id="video-view"><div class="section-head"><span class="eyebrow">MOTION STUDIO</span><h1>ساخت ویدیو</h1><p>مدل ویدیوساز را انتخاب کن، پرامپت بنویس و ویدیو را روی سیستم ذخیره کن.</p></div><div class="video-layout"><div class="canvas-panel"><div class="panel-top"><div><span class="panel-kicker">بوم ویدیو</span><h2 id="video-title">هنوز ویدیویی ساخته نشده</h2></div></div><div class="video-stage" id="video-stage"><div class="empty-state"><div class="empty-icon">${icon('Film', 42)}</div><h3>ویدیوی تو اینجا نمایش داده می‌شود</h3><p>مدل ویدیوساز را از بخش مدل‌ها انتخاب کن.</p></div></div></div><div class="composer"><div class="composer-top"><span>${icon('Sparkles', 16)} پرامپت ویدیو</span><span>فارسی یا انگلیسی بنویس</span></div><textarea id="video-prompt" placeholder="مثلاً: روباهی در جنگل برفی قدم می‌زند، حرکت دوربین آرام..."></textarea><div class="composer-bottom"><button class="model-pill" id="video-model-pill">${icon('Blocks', 16)}<span id="active-video-model-label">انتخاب مدل ویدیو</span></button><button class="primary-button" id="generate-video" data-work>${icon('Film', 18)}<span>ساخت ویدیو</span><span class="button-shine"></span></button></div></div><div class="model-card"><div class="card-heading"><div>${icon('Film')}<h2>ویدیوهای ساخته‌شده</h2></div></div><div id="video-gallery" class="video-gallery"></div></div></div></section>
        <section class="view" id="voice-view"><div class="voice-hero"><span class="eyebrow">VOICE STUDIO</span><h1>ساخت صدا</h1><p>زبان را جست‌وجو کن، مدل گفتار را نصب کن و صدای خودت را بساز.</p><div class="voice-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div><div class="voice-layout"><div class="voice-card"><h2>ساخت گفتار</h2><label for="voice-text">متنی که خوانده شود</label><textarea maxlength="500" id="voice-text" placeholder="متن فارسی یا زبان انتخابی را اینجا بنویس..."></textarea><label for="voice-model-select">مدل نصب‌شده و زبان</label><select id="voice-model-select"></select><button id="refresh-installed-voices" class="small-button">بازخوانی مدل‌های نصب‌شده</button><div id="installed-voices" class="installed-voices"></div><button id="voice-generate" class="primary-button">ساخت صدا</button><button id="voice-stop" class="small-button" hidden>توقف ساخت یا دانلود صدا</button><p id="voice-status">صدا در پوشهٔ خروجی ذخیره می‌شود.</p><div id="voice-download-progress" class="voice-download-progress" hidden><div id="voice-download-track"></div><span id="voice-download-stats"></span></div><div id="voice-player" class="voice-player">صدای ساخته‌شده اینجا پخش می‌شود.</div></div><div class="voice-card"><h2>جست‌وجوی مدل صدا</h2><p id="voice-folder"></p><button class="small-button" id="voice-change-folder">تغییر پوشهٔ دانلود مدل‌ها</button><p>نام زبان را فارسی، انگلیسی یا با کد سه‌حرفی بنویس.</p><div class="search-row"><input id="voice-search-input" value="فارسی" placeholder="زبان"/><button id="voice-search-button">جست‌وجو</button></div><button id="persian-voice-search" class="small-button">مدل‌های فارسی</button><button id="popular-voice-search" class="small-button">مدل‌های محبوب</button><div id="voice-search-results"></div></div></div></section><section class="view" id="audio-gallery-view"><div class="section-head"><span class="eyebrow">SOUND LIBRARY</span><h1>گالری صدا</h1><p>صداهای ساخته‌شده و متن هر کدام اینجاست.</p></div><div id="voice-gallery" class="voice-gallery"></div></section><section class="view" id="models-view"><div class="section-head"><span class="eyebrow">MODEL LIBRARY</span><h1>مدل‌ها و جست‌وجو<span>.</span></h1><p>مدل‌های ذخیره‌شده را انتخاب کن یا مدل جدیدی در Hugging Face پیدا کن.</p></div><div class="kind-tabs"><button class="kind-tab active" data-kind="image">${icon('Images', 16)} مدل‌های تصویر</button><button class="kind-tab" data-kind="video">${icon('Film', 16)} مدل‌های ویدیو</button><button class="kind-tab" id="voice-model-tab">${icon('Mic2', 16)} مدل‌های صدا</button></div><div class="model-layout"><div class="model-card"><div class="card-heading"><div>${icon('HardDrive')}<h2>مدل‌های روی سیستم</h2></div><button class="icon-button" id="refresh-models" title="به‌روزرسانی">${icon('RefreshCw')}</button></div><div id="local-models" class="model-list"></div><div class="cache-settings"><div class="cache-head">${icon('Cpu', 17)} <b>مدل‌ها در حافظه</b></div><label class="memory-toggle"><input id="keep-models-loaded" type="checkbox" ${keepLoaded ? 'checked' : ''}/> مدل‌های قبلی در رم بمانند</label><p>با روشن‌بودن این گزینه، جابه‌جایی دوباره سریع‌تر است؛ مدل‌های غیرفعال از کارت گرافیک به رم منتقل می‌شوند و رم بیشتری می‌گیرند. کنار هر مدل دکمهٔ خروج از حافظه هست.</p><label class="startup-label" for="startup-model">مدل هنگام بازشدن برنامه</label><select id="startup-model" class="startup-select"></select><p>«هیچ‌کدام» یعنی برنامه بدون بارگذاری خودکار مدل باز شود.</p></div><div class="cache-settings"><div class="cache-head">${icon('FolderOpen', 17)} <b>پوشهٔ دانلود مدل‌ها</b></div><div id="model-folder" class="cache-path">در حال بررسی...</div><button id="choose-model-folder" class="small-button" data-work>انتخاب پوشه</button><p>مدل‌های قبلی سر جای خود می‌مانند. دانلودهای جدید به پوشهٔ انتخابی می‌روند.</p></div><div class="cache-settings"><div class="cache-head">${icon('FolderOpen', 17)} <b>پوشهٔ ذخیرهٔ عکس و ویدیو</b></div><div id="output-folder" class="cache-path">در حال بررسی...</div><button id="choose-output-folder" class="small-button" data-work>تغییر پوشه</button><p>فایل‌های قبلی در پوشهٔ قبلی می‌مانند؛ فایل‌های جدید در پوشهٔ انتخابی ذخیره می‌شوند.</p></div><div class="cache-settings"><div class="cache-head">${icon('HardDrive', 17)} <b>فضای استفاده‌شده</b></div><div class="storage-stats"><div>مدل‌های دانلودشده <strong id="models-size">...</strong></div><div>عکس‌ها <strong id="images-size">...</strong></div><div>ویدیوها <strong id="videos-size">...</strong></div></div><button id="refresh-storage" class="small-button">به‌روزرسانی حجم‌ها</button></div></div><div class="model-card search-card"><div class="card-heading"><div>${icon('Search')}<h2>جست‌وجوی Hugging Face</h2></div></div><div class="featured-model"><div class="featured-badge">مدل پیشنهادی · تصویر انیمه</div><strong>Animagine XL 3.1</strong><span>cagliostrolab/animagine-xl-3.1</span><p>نسخهٔ SDXL برای تصویرهای انیمه. فقط فایل‌های لازم برای اجرا دانلود می‌شوند؛ حدود ۷ گیگابایت فضا لازم است.</p><button id="featured-animagine" class="small-button" data-work>دانلود مدل</button></div><div class="featured-model featured-lora"><div class="featured-badge">LoRA · نیازمند مدل پایه</div><strong>Qwen Image 2.1 Omni LoRA</strong><span>chatrlabs/Qwen-Image-2.1-Uncensored-Omni-LoRA-v0.1</span><p>فایل LoRA حدود ۶۷۱ مگابایت است. برای ساخت تصویر باید مدل پایهٔ Qwen/Qwen-Image-2.1 جداگانه نصب شود.</p><button id="featured-qwen-lora" class="small-button" data-work>دانلود LoRA</button></div><div class="featured-model featured-gguf"><div class="featured-badge">GGUF · نیازمند موتور دیگر</div><strong>Qwen Image 2.1 Turbo Uncensored GGUF</strong><span>AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF</span><p>این مخزن رمزگذار متن GGUF است. با «نصب با موتور»، فایل تصویرساز، VAE و موتور stable-diffusion.cpp نیز خودکار دریافت می‌شوند؛ مجموع دانلود حدود ۱۰ گیگابایت است و فقط با کلیک شما شروع می‌شود.</p><button id="featured-gguf" class="small-button" data-work>نصب با موتور</button></div><div class="hf-auth"><b>دسترسی Hugging Face برای مدل‌های محدود</b><p>اگر صفحهٔ مدل از تو پذیرش شرایط می‌خواهد، ابتدا در سایت Hugging Face تأییدش کن، سپس توکن خواندن خودت را اینجا وارد کن.</p><input id="hf-token" type="password" placeholder="HF read token" autocomplete="off"/><button id="hf-login" class="small-button">ورود با توکن</button><span id="hf-auth-status"></span></div><div class="featured-model"><div class="featured-badge">FLUX · مدل تصویرساز</div><strong>FLUX.1 Schnell و Dev</strong><p>مدل کامل با Diffusers اجرا می‌شود. نسخه‌های GGUF از city96 و leejet با موتور stable-diffusion.cpp و فایل‌های CLIP-L، T5-XXL و VAE نصب می‌شوند؛ ابتدا بررسی حجم را بزن.</p><button id="flux-search" class="small-button">پیداکردن FLUX</button><button id="flux-gguf-search" class="small-button">FLUX GGUF · موتور CPU و CUDA</button><button id="flux-free" class="small-button">FLUX.1 Schnell بدون مجوز ویژه · حدود ۵۴ GB</button></div><div class="search-presets"><button id="favorites-filter" class="small-button">☆ فقط علاقه‌مندی‌ها</button><button id="uncensored-search" class="small-button">مدل‌های Uncensored</button><span>تا ۵۰۰ نتیجه؛ با دکمهٔ «نمایش بیشتر»</span></div><div class="engine-presets"><button class="small-button" data-search-family="Qwen-Image" data-search-kind="image">Qwen Image</button><button class="small-button" data-search-family="FLUX" data-search-kind="image">FLUX</button><button class="small-button" data-search-family="Sana" data-search-kind="image">Sana</button><button class="small-button" data-search-family="HunyuanVideo" data-search-kind="video">Hunyuan Video</button><button class="small-button" data-search-family="LTX-2" data-search-kind="video">LTX-2</button><button class="small-button" data-search-family="Cosmos" data-search-kind="video">Cosmos</button></div><div class="search-row"><input id="search-input" placeholder="نام مدل را بنویس یا خالی بگذار"/><button id="search-button" data-work>${icon('Search', 17)} جست‌وجو</button></div><div class="engine-update"><button id="update-engine" class="small-button" data-work>به‌روزرسانی موتور Diffusers</button><span id="engine-status">برای پشتیبانی از کلاس‌های تازه، موتور را به‌روز کن.</span></div><button id="resume-download" class="small-button" type="button">ادامهٔ دانلود ناتمام</button><p class="search-note" id="search-note">مدل‌های تک‌فایلِ پشتیبانی‌شده با موتور و فایل‌های لازم نصب می‌شوند. بسته‌ها ممکن است ۱۰ تا ۲۰ گیگابایت باشند.</p><div id="download-progress" class="download-progress hidden" role="status"><div class="download-head"><strong id="download-name"></strong><b id="download-percent">۰٪</b></div><div id="download-phase" class="download-phase">در حال آماده‌سازی...</div><div class="download-track"><div id="download-fill"></div></div><div class="download-stats"><span id="download-processed">فایل‌ها: ۰ B</span><span id="download-received">دریافت از اینترنت: ۰ B</span><span id="download-speed">سرعت میانگین: ۰ B/ثانیه</span></div><button id="cancel-download" class="cancel-download" type="button">لغو دانلود</button></div><div id="search-results" class="search-results"><div class="search-placeholder">برای دیدن مدل‌ها، جست‌وجو کن.</div></div></div></div></section>
        <section class="view" id="website-view"><div class="section-head"><span class="eyebrow">REMOTE STUDIO</span><h1>وب‌سایت تصویرسازی</h1><p>سرور را روشن کن تا دوستانت با نام کاربری و رمز وارد شوند، مدل انتخاب کنند و عکس بسازند.</p></div><div class="website-grid"><div class="model-card"><div class="card-heading"><div>${icon('ExternalLink')}<h2>کنترل سرور</h2></div></div><p id="web-state">خاموش</p><label>پورت <input id="web-port" type="number" min="1024" max="65535" value="8765"/></label><div class="website-actions"><button id="web-start" class="primary-button">روشن‌کردن وب‌سایت</button><button id="web-stop" class="small-button">خاموش‌کردن</button></div><div class="website-actions"><button id="web-public-start" class="small-button">بازکردن دسترسی عمومی امن</button><button id="web-public-stop" class="small-button">بستن دسترسی عمومی</button></div><p>با کلیک، ابزار Cloudflare Tunnel در صورت نیاز دانلود می‌شود و یک نشانی HTTPS موقت می‌دهد. نام کاربری و رمز همچنان لازم است.</p><div class="web-address"><b>آدرس عمومی HTTPS</b><code id="web-tunnel">—</code><b>آدرس خصوصی</b><code id="web-private">—</code><b>آی‌پی اینترنت · صرفاً اطلاعات شبکه</b><code id="web-public">—</code><b>پوشهٔ جداگانهٔ گالری وب</b><code id="web-gallery-path">—</code></div><p>برای دسترسی از راه دور، لینک HTTPS را بفرست. تونل اتصال خروجی می‌سازد و معمولاً نیازی به دسترسی مدیر یا بازکردن پورت روتر ندارد. آی‌پی خام پشت NAT یا اینترنت اشتراکی ممکن است از بیرون باز نشود. آی‌پی عمومی خام فقط وقتی کار می‌کند که پورت روی روتر تنظیم شده باشد؛ بدون HTTPS از آن برای ورود کاربران استفاده نکن.</p><label>حداقل رم آزاد سیستم (GB) <input id="web-free-ram" type="number" min="0" max="512" step="0.5" value="2"/></label><button id="web-save-settings" class="small-button">ذخیرهٔ حد رم آزاد</button><p>درخواست وب وقتی رم آزاد کمتر از این مقدار باشد رد می‌شود. این تنظیم سقف مصرف رم نیست؛ موتور ساخت عکس با خود برنامه مشترک است.</p></div><div class="model-card"><div class="card-heading"><div>${icon('Blocks')}<h2>کاربران و سهمیه‌ها</h2></div></div><label>نام کاربر <input id="web-user-name" maxlength="40" placeholder="مثلاً ali"/></label><label>رمز عبور (حداقل ۸ نویسه) <input id="web-user-password" type="password" autocomplete="new-password"/></label><label>تعداد عکس در روز <input id="web-user-quota" type="number" min="1" max="10000" value="10"/></label><button id="web-add-user" class="primary-button">ساخت کاربر</button><p id="web-new-token"></p><div id="web-users"></div><p>کاربران با نام و رمز وارد می‌شوند. رمز در برنامه به صورت هش ذخیره می‌شود؛ اگر فراموش شد، رمز تازه تعیین کن.</p></div></div></section><section class="view" id="gallery-view"><div class="section-head"><span class="eyebrow">YOUR COLLECTION</span><h1>گالری تصاویر</h1><p>تمام تصویرهایی که با برنامه ساخته‌ای، همین‌جا نگهداری می‌شوند.</p><div class="gallery-search"><input id="gallery-query" placeholder="جست‌وجوی پرامپت، مدل یا برچسب"/><input id="gallery-from" type="date" title="از تاریخ"/><input id="gallery-to" type="date" title="تا تاریخ"/><button id="gallery-set-pin" class="small-button">قفل گالری</button></div><select id="gallery-model-filter" class="gallery-filter" aria-label="دسته‌بندی بر اساس مدل"><option value="">همهٔ مدل‌ها</option></select><label class="gallery-details-toggle"><input id="gallery-details-toggle" type="checkbox" ${showGalleryDetails ? 'checked' : ''}/> نمایش پرامپت و مدل زیر عکس‌ها</label><label class="gallery-details-toggle"><input id="gallery-favorites-filter" type="checkbox"/> فقط عکس‌های محبوب</label></div><div id="full-gallery" class="full-gallery"></div></section>
      </main>
    </div>${projectDialog}${matrixDialog}<aside id="image-ready-notice" class="image-ready-notice" hidden><span class="image-notice-icon">${icon('Check', 18)}</span><p role="status"></p><button class="small-button" data-notice-open>مشاهدهٔ نتیجه</button><button class="icon-button" id="dismiss-image-notice" title="بستن اعلان" aria-label="بستن اعلان">${icon('X', 15)}</button></aside><div id="setup-overlay" class="setup-overlay hidden"><div class="setup-card"><div class="brand-mark"><img src="${brandIcon}" alt=""/></div><span class="eyebrow">FIRST RUN SETUP</span><h1>آماده‌سازی اولیه</h1><p>برنامه پیش‌نیازها را بررسی می‌کند و فقط مواردِ نصب‌نشده را دریافت می‌کند. نصب مدل‌های هوش مصنوعی جداگانه و به انتخاب شماست.</p><div class="setup-items"><div>✓ WebView2 آماده است</div><div id="setup-python">در حال بررسی Python...</div><div id="setup-packages">در حال بررسی بسته‌ها...</div></div><div id="setup-message" class="setup-message">در حال بررسی...</div><button id="setup-retry" class="primary-button" hidden>تلاش دوباره</button></div></div><div id="gallery-lock" class="gallery-lock hidden"><div><h2>گالری قفل است</h2><input id="gallery-pin-input" type="password" inputmode="numeric" placeholder="رمز گالری"/><button id="gallery-unlock" class="primary-button">${icon('LockKeyhole', 16)} باز کردن گالری</button><button id="gallery-lock-close" class="small-button">بستن</button><p id="gallery-lock-error"></p></div></div><div id="viewer-modal" class="modal hidden"><div class="viewer-toolbar"><button id="close-modal" class="modal-close">${icon('X')}</button><span id="modal-caption"></span><button id="viewer-reuse-prompt" class="small-button" hidden>${icon('WandSparkles', 15)} <span>ساخت نسخهٔ تازه</span></button><button type="button" id="viewer-versions" class="small-button" hidden>نسخه‌های مرتبط</button><button id="viewer-zoom-out" class="icon-button" title="کوچک‌نمایی">−</button><button id="viewer-zoom-in" class="icon-button" title="بزرگ‌نمایی">+</button><button id="viewer-save" class="icon-button" title="دانلود عکس">${icon('Download')}</button></div><div class="viewer-image-wrap"><img id="modal-image" alt="تصویر ساخته‌شده"/></div></div>`;
  applyTheme(localStorage.getItem('nocturne-theme'));
  organizeModelsView();
  organizeStudioView();
  organizeWorkspace();
  organizeBatchStudio();
  refreshIcons();
  attachEvents();
  mountProjectControls();

  renderPromptPresets();
  mountWorkspacePreferences({ setCompact: setCompactNavigation, go: openWorkspace, translate: text => language === 'en' ? english[text] || text : text });
  restoreStudioDraft();
  mountChat({ call, busy: () => busy, setBusy, view: setView, symbol: icon('Sparkles', 20) });
  mountLibrary({ busy: () => busy, view: setView, searchImage: searchModels, searchVoice: searchVoices, symbol: kind => icon(kind === 'image' ? 'Images' : kind === 'video' ? 'Film' : kind === 'voice' ? 'Mic2' : 'Sparkles', 19) });
  refreshIcons();
  applyLanguage();
  observeInterfaceLanguage();
  renderModels();
  renderGallery();
  renderIdeas();
  renderQueue();
  applyLanguage();
}

function openWorkspace(view: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-item')).find(item => item.dataset.view === view);
  if (button) button.click();
  else setView(view);
}

function setView(view: string) {
  const info = pageInfo(view);
  if (!info) return;
  if (view === 'gallery' && galleryLocked) { document.querySelector('#gallery-lock')?.classList.remove('hidden'); return; }
  const target = document.getElementById(`${view}-view`);
  if (!target) return;
  const changed = !target.classList.contains('active');
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  target.classList.add('active');
  if (changed) {
    navigationRevision++;
    document.querySelector('.main')!.scrollTop = 0;
  }
  rememberPage(view);
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelector('#page-title')!.textContent = info.label;
  document.querySelector('#page-group')!.textContent = info.group;
  refreshIcons();
  applyLanguage();
  if (view === 'voice') { void refreshInstalledVoices(); }
  if (view === 'website') void refreshWebsite();
  if (view === 'models') void call<{ logged_in: boolean }>('hf_auth_status').then(state => { document.querySelector('#hf-auth-status')!.textContent = state.logged_in ? 'حساب متصل است' : 'حساب متصل نیست'; }).catch(() => {});
}

type WebStatus = { running: boolean; local_url: string; private_ip: string; public_ip: string; public_url: string; tunnel_url: string; tunnel_error?: string; gallery_folder: string; port: number | null; users: number; min_free_ram_gb: number };
async function refreshWebsite() {
  try {
    const [status, users] = await Promise.all([call<WebStatus>('web_status'), call<{ name: string; quota: number; used: number }[]>('web_users')]);
    document.querySelector('#web-state')!.textContent = status.running ? '● وب‌سایت روشن است' : '○ وب‌سایت خاموش است';
    document.querySelector('#web-private')!.textContent = status.local_url || '—';
    document.querySelector('#web-public')!.textContent = status.public_ip ? status.public_ip + ' · آدرس اتصال نیست؛ از لینک HTTPS استفاده کن' : 'آی‌پی اینترنت در دسترس نیست؛ از لینک HTTPS استفاده کن';
    document.querySelector('#web-tunnel')!.textContent = status.tunnel_url || status.tunnel_error || 'خاموش؛ «بازکردن دسترسی عمومی» را بزن';
    document.querySelector('#web-gallery-path')!.textContent = status.gallery_folder;
    document.querySelector<HTMLButtonElement>('#web-public-start')!.disabled = !status.running || !!status.tunnel_url;
    document.querySelector<HTMLButtonElement>('#web-public-stop')!.disabled = !status.tunnel_url;
    document.querySelector<HTMLInputElement>('#web-free-ram')!.value = String(status.min_free_ram_gb);
    document.querySelector<HTMLButtonElement>('#web-start')!.disabled = status.running;
    document.querySelector<HTMLButtonElement>('#web-stop')!.disabled = !status.running;
    document.querySelector('#web-users')!.innerHTML = users.length ? users.map(user => `<div class="web-user"><b>${safe(user.name)}</b><span>${user.used.toLocaleString('fa-IR')} / ${user.quota.toLocaleString('fa-IR')} عکس امروز</span><button class="small-button" data-web-password="${safe(user.name)}">تغییر رمز</button><button class="small-button" data-web-revoke="${safe(user.name)}">حذف دسترسی</button></div>`).join('') : '<p>هنوز کاربری ساخته نشده است.</p>';
    document.querySelectorAll<HTMLButtonElement>('[data-web-password]').forEach(button => button.onclick = async () => { const password = document.querySelector<HTMLInputElement>('#web-user-password')!.value; if (password.length < 8) return toast('رمز تازه را در کادر بالا وارد کن؛ حداقل ۸ نویسه.', true); try { await call('web_set_password', { name: button.dataset.webPassword, password }); document.querySelector<HTMLInputElement>('#web-user-password')!.value = ''; toast('رمز تغییر کرد. نشست‌های قبلی باطل شدند.'); } catch (error) { toast(String(error), true); } });
    document.querySelectorAll<HTMLButtonElement>('[data-web-revoke]').forEach(button => button.onclick = async () => { try { await call('web_revoke_user', { name: button.dataset.webRevoke }); await refreshWebsite(); } catch (error) { toast(String(error), true); } });
  } catch (error) { document.querySelector('#web-state')!.textContent = String(error); }
}

function renderModels() {
  const target = document.querySelector('#local-models');
  if (!target) return;
  const list = (modelKind === 'video' ? videoModels : [...models, ...sdcppModels, ...checkpointModels]).filter(id => !showFavoritesOnly || favoriteModels.has(id)).sort((a, b) => Number(favoriteModels.has(b)) - Number(favoriteModels.has(a)));
  target.innerHTML = list.length ? list.map(id => {
    const external = sdcppModels.includes(id);
    const checkpoint = checkpointModels.includes(id);
    const installedKind = external ? 'sdcpp' : checkpoint ? 'checkpoint' : modelKind;
    const active = activeModel === id && activeKind === installedKind;
    const loaded = loadedModels.some(item => item.id === id && item.kind === installedKind);
    const label = id.split('/').pop() || id;
    return `<div class="local-model ${active ? 'selected' : ''} ${loaded ? 'is-loaded' : ''}"><button class="favorite-button ${favoriteModels.has(id) ? 'is-favorite' : ''}" data-favorite="${safe(id)}" title="علاقه‌مندی">${icon('Star', 17)}</button><div class="model-symbol">${icon(modelKind === 'video' ? 'Film' : 'Blocks', 20)}</div><div class="local-model-info"><strong title="${safe(id)}">${safe(label)}</strong><span class="model-id" title="${safe(id)}">${safe(id)}</span><small><span class="model-state-dot"></span>${active ? 'فعال و آمادهٔ ساخت' : external ? 'موتور GGUF · نصب‌شده' : checkpoint ? 'موتور SD/SDXL تک‌فایل · نصب‌شده' : loaded ? 'آماده در حافظه · انتخاب سریع' : 'روی دیسک · بارگذاری اولیه لازم است'}</small></div><div class="model-actions"><button class="small-button" data-load="${safe(id)}" data-load-kind="${installedKind}" data-static-disabled="${active ? '1' : '0'}" data-work ${active ? 'disabled' : ''}>${active ? 'فعال' : loaded ? 'فعال‌سازی' : 'بارگذاری'}</button>${loaded ? `<button class="small-button unload-button" data-unload="${safe(id)}" data-work>خروج از رم</button>` : ''}</div></div>`;
  }).join('') : `<div class="search-placeholder">هنوز مدل ${modelKind === 'video' ? 'ویدیو' : 'تصویر'}ی کاملی روی سیستم پیدا نشد.</div>`;
  document.querySelectorAll<HTMLButtonElement>('#local-models [data-favorite]').forEach(el => el.onclick = () => toggleFavorite(el.dataset.favorite!));
  document.querySelectorAll<HTMLButtonElement>('[data-load]').forEach(el => el.onclick = () => loadModel(el.dataset.load!, el.dataset.loadKind || modelKind));
  document.querySelectorAll<HTMLButtonElement>('[data-unload]').forEach(el => el.onclick = () => unloadModel(el.dataset.unload!));
  const startup = document.querySelector<HTMLSelectElement>('#startup-model');
  if (startup) {
    const choices = [{ id: '', label: 'هیچ‌کدام' }, ...models.map(id => ({ id: `image:${id}`, label: `عکس · ${id}` })), ...sdcppModels.map(id => ({ id: `sdcpp:${id}`, label: `عکس GGUF · ${id}` })), ...checkpointModels.map(id => ({ id: `checkpoint:${id}`, label: `عکس SD/SDXL · ${id}` })), ...videoModels.map(id => ({ id: `video:${id}`, label: `ویدیو · ${id}` }))];
    startup.innerHTML = choices.map(item => `<option value="${safe(item.id)}" ${startupModel === item.id ? 'selected' : ''}>${safe(item.label)}</option>`).join('');
  }
  for (const id of ['compare-model-a', 'compare-model-b']) {
    const select = document.querySelector<HTMLSelectElement>(`#${id}`);
    if (select) { const value = select.value; select.innerHTML = [...models.map(model => ({ model, kind: 'image' })), ...sdcppModels.map(model => ({ model, kind: 'sdcpp' })), ...checkpointModels.map(model => ({ model, kind: 'checkpoint' }))].map(({ model, kind }) => `<option value="${safe(kind + ':' + model)}">${safe(model)}</option>`).join(''); if ([...select.options].some(option => option.value === value)) select.value = value; else if (id === 'compare-model-b' && select.options.length > 1) select.selectedIndex = 1; }
  }
  document.querySelector('#active-model-label')!.textContent = activeModel && (activeKind === 'image' || activeKind === 'sdcpp' || activeKind === 'checkpoint') ? activeModel.split('/').pop()! : 'انتخاب مدل';
  document.querySelector('#active-video-model-label')!.textContent = activeModel && activeKind === 'video' ? activeModel.split('/').pop()! : 'انتخاب مدل ویدیو';
  document.querySelector('#batch-model')!.textContent = activeModel && (activeKind === 'image' || activeKind === 'sdcpp' || activeKind === 'checkpoint') ? activeModel : 'مدل عکس‌ساز انتخاب نشده';
  const featuredButton = document.querySelector<HTMLButtonElement>('#featured-animagine');
  if (featuredButton) featuredButton.textContent = models.includes(featuredAnimagine) ? 'انتخاب مدل' : 'دانلود مدل';
  const loraButton = document.querySelector<HTMLButtonElement>('#featured-qwen-lora');
  if (loraButton) { loraButton.textContent = adapters.includes(featuredQwenLora) ? 'LoRA دانلود شده' : 'دانلود LoRA'; loraButton.dataset.staticDisabled = adapters.includes(featuredQwenLora) ? '1' : '0'; loraButton.disabled = busy || adapters.includes(featuredQwenLora); }
  const ggufButton = document.querySelector<HTMLButtonElement>('#featured-gguf');
  if (ggufButton) ggufButton.textContent = sdcppModels.includes(featuredGGUF) ? 'انتخاب مدل' : 'نصب با موتور';
  document.querySelector('#overview-images')!.textContent = (models.length + sdcppModels.length + checkpointModels.length).toLocaleString('fa-IR');
  document.querySelector('#overview-videos')!.textContent = videoModels.length.toLocaleString('fa-IR');
  document.querySelector('#overview-loaded')!.textContent = loadedModels.length.toLocaleString('fa-IR');
  document.querySelector('#overview-active')!.textContent = activeModel ? activeModel.split('/').pop()! : 'انتخاب نشده';
  refreshIcons();
}

function toggleFavorite(id: string) {
  if (favoriteModels.has(id)) favoriteModels.delete(id); else favoriteModels.add(id);
  localStorage.setItem('nocturne-favorite-models', JSON.stringify([...favoriteModels]));
  renderModels(); renderSearch();
}

async function inspectModel(id: string) {
  const row = [...document.querySelectorAll<HTMLElement>('.search-result')].find(el => el.dataset.modelId === id);
  if (!row) return;
  const button = row.querySelector<HTMLButtonElement>('[data-inspect]')!;
  const details = row.querySelector<HTMLElement>('.inspection-details')!;
  button.disabled = true;
  details.textContent = 'در حال بررسی فرادادهٔ مخزن...';
  try {
    const info = await call<Inspection>('info', { model_id: id });
    inspections.set(id, info);
    const scroll = document.querySelector('#search-results')!.scrollTop;
    renderSearch();
    document.querySelector('#search-results')!.scrollTop = scroll;
  } catch (error) {
    details.textContent = `بررسی ناموفق: ${String(error)}`;
    button.textContent = 'تلاش دوباره';
  } finally { button.disabled = false; }
}

function modelPreflight(info?: Inspection) {
  if (!info) return '';
  const number = new Intl.NumberFormat(language === 'en' ? 'en-US' : 'fa-IR');
  const fields = [
    ['حجم دانلود', info.download_bytes == null ? 'نامشخص' : bytes(info.download_bytes)],
    ['دانلود باقی‌مانده', info.remaining_bytes == null ? 'نامشخص' : bytes(info.remaining_bytes)],
    ['پیش‌نیازها', info.requirements?.join(' · ') || 'نامشخص'],
    ['ورودی عکس', info.image_input === true ? 'احتمالاً پشتیبانی می‌شود' : info.image_input === false ? 'تأیید نشد' : 'نامشخص'],
    ['برآورد حافظهٔ کاری', info.memory_gib ? info.memory_gib.map(value => number.format(value)).join('–') + ' GiB' : 'نامشخص'],
    ['پارامترها', info.parameters == null ? 'نامشخص' : number.format(info.parameters)],
  ];
  return `<dl class="model-preflight">${fields.map(([label, value]) => `<div><dt>${label}</dt><dd>${safe(value)}</dd></div>`).join('')}</dl><span>${safe(info.reason)}</span>`;
}

function renderSearch() {
  const target = document.querySelector('#search-results')!;
  const labels: Record<Model['category'], string> = { image: 'مدل تصویر · قابل بررسی برای دانلود', video: 'مدل ویدیو · قابل بررسی برای دانلود', adapter: 'LoRA · نیازمند مدل پایه', sdcpp: 'تک‌فایل · موتور و پیش‌نیازها خودکار نصب می‌شوند', checkpoint: 'فایل کامل SD/SDXL · موتور Diffusers', gguf: 'GGUF · ترکیب فایل‌ها نیازمند بررسی', other: 'قالب دیگر · ترکیب فایل‌ها نیازمند بررسی' };
  const allResults = searchResults.filter(m => !showFavoritesOnly || favoriteModels.has(m.id)).sort((a, b) => Number(favoriteModels.has(b.id)) - Number(favoriteModels.has(a.id)));
  const results = allResults.filter(m => searchCategoryFilter === 'all' || m.category === searchCategoryFilter);
  const categoryNames: Record<Model['category'], string> = { image: 'تصویر', video: 'ویدیو', sdcpp: 'موتور GGUF', checkpoint: 'تک‌فایل', adapter: 'LoRA', gguf: 'GGUF دیگر', other: 'سایر' };
  const categories = (['image', 'video', 'sdcpp', 'checkpoint', 'adapter', 'gguf', 'other'] as Model['category'][]).filter(category => allResults.some(item => item.category === category));
  const filters = allResults.length ? `<div class="result-filters"><button class="${searchCategoryFilter === 'all' ? 'active' : ''}" data-result-category="all">همه <b>${allResults.length.toLocaleString('fa-IR')}</b></button>${categories.map(category => `<button class="${searchCategoryFilter === category ? 'active' : ''}" data-result-category="${category}">${categoryNames[category]} <b>${allResults.filter(item => item.category === category).length.toLocaleString('fa-IR')}</b></button>`).join('')}</div>` : '';
  target.innerHTML = filters + (results.length ? results.slice(0, searchVisibleCount).map(m => {
    const inspection = inspections.get(m.id);
    const kind = inspection ? inspection.download_kind : (m.category === 'image' || m.category === 'video' || m.category === 'sdcpp' || m.category === 'checkpoint' || (m.category === 'adapter' && m.id === featuredQwenLora) ? m.category : null);
    const downloadable = !(inspection?.gated ?? m.gated) && !!kind;
    const installed = models.includes(m.id) || videoModels.includes(m.id) || sdcppModels.includes(m.id) || checkpointModels.includes(m.id) || adapters.includes(m.id);
    return `<div class="search-result" data-model-id="${safe(m.id)}"><button class="favorite-button ${favoriteModels.has(m.id) ? 'is-favorite' : ''}" data-favorite="${safe(m.id)}" title="علاقه‌مندی">${icon('Star', 17)}</button><div class="model-symbol">${icon(m.category === 'video' ? 'Film' : 'Aperture', 19)}</div><div class="search-meta"><strong>${safe(m.id)}</strong><small>${safe(labels[m.category])} · ${m.downloads.toLocaleString('fa-IR')} دانلود</small></div><span class="size-label">${inspections.get(m.id)?.size_gb == null ? 'حجم: بررسی نشده' : `حجم: ${inspections.get(m.id)!.size_gb!.toLocaleString('fa-IR')} GB`}</span><button class="small-button inspect-button" data-inspect="${safe(m.id)}">${inspection ? 'بررسی دوباره' : 'بررسی'}</button><button class="small-button download-button" data-download="${safe(m.id)}" data-kind="${kind || m.category}" data-static-disabled="${downloadable && !installed ? '0' : '1'}" data-work ${downloadable && !installed ? '' : 'disabled'}>${installed ? 'نصب شده' : (m.gated && inspection?.gated !== false) ? 'دسترسی محدود' : kind === 'sdcpp' ? 'نصب با موتور' : downloadable ? 'دانلود' : inspection ? 'پشتیبانی نمی‌شود' : 'نیازمند بررسی'}</button>${inspection?.checkpoint_available && kind !== 'checkpoint' ? `<button class="small-button" data-checkpoint-download="${safe(m.id)}" data-work ${checkpointModels.includes(m.id) ? 'disabled' : ''}>${checkpointModels.includes(m.id) ? 'تک‌فایل نصب شده' : 'دریافت نسخهٔ تک‌فایل'}</button>` : ''}<div class="inspection-details">${modelPreflight(inspection)}</div></div>`;
  }).join('') + (results.length > searchVisibleCount ? `<button id="more-models" class="small-button more-models">نمایش بیشتر · ${Math.min(results.length - searchVisibleCount, 80).toLocaleString('fa-IR')} مدل دیگر از ${results.length.toLocaleString('fa-IR')}</button>` : `<p class="search-total">${results.length.toLocaleString('fa-IR')} مدل نمایش داده شد</p>`) : '<div class="search-placeholder">مدلی در این دسته پیدا نشد.</div>');
  target.querySelector<HTMLButtonElement>('#more-models')?.addEventListener('click', () => { searchVisibleCount += 80; renderSearch(); });
  target.querySelectorAll<HTMLButtonElement>('[data-result-category]').forEach(button => button.onclick = () => { searchCategoryFilter = button.dataset.resultCategory as typeof searchCategoryFilter; searchVisibleCount = 80; renderSearch(); });
  document.querySelectorAll<HTMLButtonElement>('[data-download]').forEach(el => el.onclick = () => downloadModel(el.dataset.download!, el.dataset.kind!));
  document.querySelectorAll<HTMLButtonElement>('#search-results [data-favorite]').forEach(el => el.onclick = () => toggleFavorite(el.dataset.favorite!));
  document.querySelectorAll<HTMLButtonElement>('[data-inspect]').forEach(el => el.onclick = () => void inspectModel(el.dataset.inspect!));
  document.querySelectorAll<HTMLButtonElement>('[data-checkpoint-download]').forEach(el => el.onclick = () => void downloadModel(el.dataset.checkpointDownload!, 'checkpoint'));
  refreshIcons();
}

function renderPromptPresets(selected = '') {
  const select = document.querySelector<HTMLSelectElement>('#preset-select')!;
  select.replaceChildren(new Option('یک پرامپت انتخاب کن', ''));
  for (const preset of promptPresets) select.add(new Option(preset.name, preset.name));
  select.value = selected;
  select.onchange?.(new Event('change'));
  applyLanguage();
}

function loadPrompt(prompt: string, aspect?: string) {
  const input = document.querySelector<HTMLTextAreaElement>('#prompt')!;
  input.value = prompt;
  const ratio = document.querySelector<HTMLSelectElement>('#image-aspect')!;
  if (aspect && Array.from(ratio.options).some(option => option.value === aspect)) ratio.value = aspect;
  storeStudioDraft();
  input.focus();
}

function favoriteImageButton(name: string) {
  const favorite = favoriteImages.has(name);
  const label = language === 'en' ? 'Favorite image' : 'عکس محبوب';
  return `<button type="button" class="icon-button gallery-favorite" data-favorite-image="${safe(name)}"
    aria-pressed="${favorite}" aria-label="${label}" title="${label}">${icon('Star', 16)}</button>`;
}

function renderGallery() {
  const recent = document.querySelector('#recent-grid');
  const full = document.querySelector('#full-gallery');
  const related = versionFilter ? relatedImages(gallery, versionFilter) : null;
  const projectGallery = gallery.filter(item => !projectId || item.project_id === projectId);
  const notice = document.querySelector<HTMLElement>('#gallery-versions-notice');
  if (notice) notice.hidden = !related;
  const tile = (item: GalleryItem) => `<button class="image-tile" data-image="${safe(item.name)}"><img src="${item.thumbnail}" alt="تصویر ${safe(item.name)}" loading="lazy"/><span>${icon('ArrowUpLeft', 18)}</span></button>`;
  const card = (item: GalleryItem) => `<div class="gallery-card">${tile(item)}${favoriteImageButton(item.name)}<input class="gallery-tag" data-tag="${safe(item.name)}" value="${safe(localStorage.getItem('nocturne-tags-' + item.name) || '')}" placeholder="برچسب‌ها؛ با ویرگول جدا کن"/>${showGalleryDetails ? `<div class="gallery-details">${item.model || item.prompt ? `<div><b>مدل</b><span dir="ltr">${safe(item.model || 'نامشخص')}</span></div><div><b>پرامپت</b><p>${safe(item.original_prompt || item.prompt || 'ثبت نشده')}</p></div>${item.prompt && item.original_prompt && item.prompt !== item.original_prompt ? `<div><b>متن اجراشده</b><p dir="ltr">${safe(item.prompt)}</p></div>` : ''}` : '<p>اطلاعات این عکس قبلاً ثبت نشده است.</p>'}</div>` : ''}</div>`;
  if (recent) recent.innerHTML = galleryLocked ? '<div class="gallery-empty">گالری قفل است.</div>' : projectGallery.length ? projectGallery.slice(0, 6).map(tile).join('') : '<div class="gallery-empty">هنوز عکسی ذخیره نشده است.</div>';
  const filter = document.querySelector<HTMLSelectElement>('#gallery-model-filter');
  if (filter) { const selected = galleryModelFilter; filter.innerHTML = `<option value="">همهٔ مدل‌ها</option>${[...new Set(projectGallery.map(item => item.model).filter(Boolean))].sort().map(model => `<option value="${safe(model)}">${safe(model)}</option>`).join('')}`; filter.value = selected; }
  const visible = (related ? gallery : projectGallery).filter(item => (!related || related.has(item.name)) && (!showFavoriteImages || favoriteImages.has(item.name)) && (!galleryModelFilter || item.model === galleryModelFilter) && (!galleryQuery || `${item.prompt} ${item.original_prompt} ${item.model} ${localStorage.getItem('nocturne-tags-' + item.name) || ''}`.toLowerCase().includes(galleryQuery.toLowerCase())) && (!galleryFrom || item.date.slice(0, 10) >= galleryFrom) && (!galleryTo || item.date.slice(0, 10) <= galleryTo));
  if (full) { full.classList.toggle('details-on', showGalleryDetails); full.innerHTML = galleryLocked ? '<div class="gallery-empty">گالری قفل است.</div>' : visible.length ? visible.map(card).join('') : `<div class="gallery-empty">${showFavoriteImages ? 'عکس محبوبی در این نتایج نیست.' : 'عکسی در این دسته پیدا نشد.'}</div>`; }
  document.querySelectorAll<HTMLButtonElement>('[data-image]').forEach(el => el.onclick = () => openImage(el.dataset.image!, Boolean(el.closest('#recent-grid'))));
  full?.querySelectorAll<HTMLButtonElement>('[data-favorite-image]').forEach(button => {
    button.onclick = () => {
      if (galleryLocked || hideGallery || privacyCover) return;
      const name = button.dataset.favoriteImage!;
      if (favoriteImages.has(name)) favoriteImages.delete(name);
      else favoriteImages.add(name);
      localStorage.setItem(favoriteImagesKey, JSON.stringify([...favoriteImages]));
      if (showFavoriteImages && !favoriteImages.has(name)) {
        renderGallery();
        document.querySelector<HTMLInputElement>('#gallery-favorites-filter')!.focus();
      } else {
        button.setAttribute('aria-pressed', String(favoriteImages.has(name)));
      }
    };
  });
  document.querySelectorAll<HTMLInputElement>('[data-tag]').forEach(el => el.onchange = () => localStorage.setItem('nocturne-tags-' + el.dataset.tag!, el.value.trim()));
  refreshIcons();
  applyLanguage();
}

async function hashPin(pin: string, salt: string) {
  const bytes = new TextEncoder().encode(salt + ':' + pin);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function compareModels() {
  if (busy) return;
  const prompt = document.querySelector<HTMLTextAreaElement>('#prompt')!.value.trim();
  const picks = ['compare-model-a', 'compare-model-b'].map(id => document.querySelector<HTMLSelectElement>(`#${id}`)!.value);
  if (!prompt || picks.some(pick => !pick) || picks[0] === picks[1]) return toast('یک پرامپت و دو مدل متفاوت انتخاب کن.', true);
  const previous = activeModel && ['image', 'checkpoint', 'sdcpp'].includes(activeKind) ? { id: activeModel, kind: activeKind } : null;
  const status = document.querySelector('#compare-status')!;
  const results = document.querySelector('#compare-results')!;
  const placeholder = document.createElement('p');
  placeholder.className = 'comparison-empty';
  placeholder.textContent = language === 'en' ? 'Comparing models…' : 'در حال مقایسهٔ مدل‌ها…';
  results.replaceChildren(placeholder);
  setBusy(true, 'در حال مقایسهٔ مدل‌ها...');
  try {
    for (let index = 0; index < 2; index++) {
      const [kind, ...parts] = picks[index].split(':'); const id = parts.join(':');
      status.textContent = `مدل ${index + 1} از ۲: ${id}`;
      await call('load', { model_id: id, kind, keep_loaded: keepLoaded });
      const result = await call<{ name: string; image: string }>('generate', { prompt, ...generationMetadata(), temporary: true });
      const card = document.createElement('div'); card.className = 'compare-result';
      card.innerHTML = `<b>${safe(id)}</b><img src="${result.image}" alt="خروجی ${index + 1}"/><button class="small-button">ذخیره در گالری</button>`;
      card.querySelector('img')!.onclick = () => showImage(result.image, result.name);
      card.querySelector('button')!.onclick = async () => { try { await call('save_temporary_image', { name: result.name }); gallery = await call<GalleryItem[]>('gallery'); renderGallery(); toast('عکس ذخیره شد.'); } catch (error) { toast(String(error), true); } };
      placeholder.remove();
      results.append(card);
    }
    status.textContent = 'مقایسه کامل شد.';
    imageReady('مقایسه کامل شد.', 'compare');
  } catch (error) {
    if (placeholder.isConnected) placeholder.textContent = language === 'en' ? 'Comparison failed.' : 'مقایسه انجام نشد.';
    status.textContent = String(error);
    toast(String(error), true);
  }
  finally {
    try {
      if (previous) await call('load', { model_id: previous.id, kind: previous.kind, keep_loaded: keepLoaded });
      const state = await call<{ active: string | null; active_kind: string; loaded_models: LoadedModel[] }>('models');
      activeModel = state.active;
      activeKind = state.active_kind;
      loadedModels = state.loaded_models;
      renderModels();
    } catch (error) {
      status.textContent = `مقایسه تمام شد، ولی بازیابی مدل قبلی انجام نشد: ${String(error)}`;
    } finally {
      setBusy(false);
    }
  }
}

function renderIdeas() {
  const target = document.querySelector('#ideas-list');
  if (!target) return;
  target.innerHTML = Array.from({ length: 6 }, (_, index) => {
    const idea = ideas[(ideaOffset + index) % ideas.length];
    return `<button class="idea-chip" data-idea="${safe(idea)}">${icon('Sparkles', 14)} <span>${safe(idea)}</span></button>`;
  }).join('');
  document.querySelectorAll<HTMLButtonElement>('[data-idea]').forEach(el => el.onclick = () => {
    document.querySelector<HTMLTextAreaElement>('#batch-topic')!.value = el.dataset.idea!;
    document.querySelector<HTMLTextAreaElement>('#batch-topic')!.focus();
  });
  refreshIcons();
}

function renderQueue() {
  const target = document.querySelector<HTMLElement>('#queue-rows');
  if (!target) return;
  const installed = [...new Set([...models, ...sdcppModels, ...checkpointModels])];
  target.innerHTML = queueJobs.map((job, index) => {
    const missing = job.model_id && !installed.includes(job.model_id);
    return `<article class="queue-job" data-queue-job="${index}">
      <header><span class="queue-position">Job ${index + 1}</span><span class="queue-job-progress" data-queue-progress="${index}">${queueRowDone[index] || 0} / ${job.count} images</span>
      <div class="queue-job-actions">
        <button type="button" class="icon-button" data-queue-up="${index}" aria-label="Move job ${index + 1} up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-button" data-queue-down="${index}" aria-label="Move job ${index + 1} down" ${index === queueJobs.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="small-button" data-queue-duplicate="${index}">Duplicate</button>
        <button type="button" class="icon-button" data-queue-remove="${index}" aria-label="Remove job ${index + 1}">${icon('X', 15)}</button>
      </div></header>
      <div class="queue-job-fields">
        <label>Model<select data-queue-model="${index}" aria-label="Model for job ${index + 1}"><option value="">Select an installed model</option>
          ${missing ? `<option value="${safe(job.model_id)}" selected>Unavailable · ${safe(job.model_id)}</option>` : ''}
          ${installed.map(id => `<option value="${safe(id)}" ${job.model_id === id ? 'selected' : ''}>${safe(id)}</option>`).join('')}</select></label>
        <label>Images<input data-queue-count="${index}" type="number" min="1" step="1" value="${job.count}" aria-label="Images for job ${index + 1}"/></label>
        <label>Aspect ratio<select data-queue-aspect="${index}" aria-label="Aspect ratio for job ${index + 1}">${aspectOptions.map(([ratio]) => `<option value="${ratio}" ${job.aspect_ratio === ratio ? 'selected' : ''}>${ratio}</option>`).join('')}</select></label>
      </div>
      <label class="queue-prompt">Prompt<textarea data-queue-prompt="${index}" rows="2" dir="auto" aria-label="Prompt for job ${index + 1}" placeholder="Describe the images for this job…">${safe(job.prompt)}</textarea></label>
      <label class="queue-variations"><input type="checkbox" data-queue-variations="${index}" ${job.variations ? 'checked' : ''}/> Add lighting and composition variations</label>
    </article>`;
  }).join('');
  if (!queueJobs.length) target.innerHTML = '<p class="queue-empty">Add a job to choose its prompt, model and image count.</p>';
  const pending = Boolean(pendingQueue());
  const locked = queueRunning || batchRunning || pending;
  const matrix = document.querySelector<HTMLButtonElement>('#matrix-open')!;
  matrix.dataset.staticDisabled = pending ? '1' : '0';
  matrix.disabled = busy || locked;
  document.querySelector<HTMLElement>('#pending-queue')!.hidden = !pending || queueRunning;
  const start = document.querySelector<HTMLButtonElement>('#queue-start')!;
  start.dataset.staticDisabled = pending ? '1' : '0';
  start.disabled = pending || busy || locked;
  target.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input, select, textarea, button').forEach(control => {
    control.disabled = locked || control.disabled;
  });
  const add = document.querySelector<HTMLButtonElement>('#queue-add')!;
  add.disabled = locked;
  add.dataset.staticDisabled = pending ? '1' : '0';
  target.querySelectorAll<HTMLSelectElement>('[data-queue-model]').forEach(control => control.onchange = () => {
    queueJobs[Number(control.dataset.queueModel)].model_id = control.value;
    saveQueueDraft();
  });
  target.querySelectorAll<HTMLInputElement>('[data-queue-count]').forEach(control => control.oninput = () => {
    const index = Number(control.dataset.queueCount);
    queueJobs[index].count = Number(control.value);
    target.querySelector(`[data-queue-progress="${index}"]`)!.textContent = `${queueRowDone[index] || 0} / ${control.value || 0} images`;
    saveQueueDraft();
    updateQueueTotal();
  });
  target.querySelectorAll<HTMLTextAreaElement>('[data-queue-prompt]').forEach(control => control.oninput = () => {
    queueJobs[Number(control.dataset.queuePrompt)].prompt = control.value;
    saveQueueDraft();
  });
  target.querySelectorAll<HTMLSelectElement>('[data-queue-aspect]').forEach(control => control.onchange = () => {
    queueJobs[Number(control.dataset.queueAspect)].aspect_ratio = control.value;
    saveQueueDraft();
  });
  target.querySelectorAll<HTMLInputElement>('[data-queue-variations]').forEach(control => control.onchange = () => {
    queueJobs[Number(control.dataset.queueVariations)].variations = control.checked;
    saveQueueDraft();
  });
  target.querySelectorAll<HTMLButtonElement>('[data-queue-remove], [data-queue-up], [data-queue-down], [data-queue-duplicate]').forEach(button => {
    button.onclick = () => {
      if (queueRunning || batchRunning) return;
      const index = Number(button.dataset.queueRemove ?? button.dataset.queueUp ?? button.dataset.queueDown ?? button.dataset.queueDuplicate);
      if (button.dataset.queueRemove !== undefined) queueJobs.splice(index, 1);
      else if (button.dataset.queueDuplicate !== undefined) queueJobs.splice(index + 1, 0, { ...queueJobs[index] });
      else {
        const destination = index + (button.dataset.queueUp !== undefined ? -1 : 1);
        if (destination < 0 || destination >= queueJobs.length) return;
        [queueJobs[index], queueJobs[destination]] = [queueJobs[destination], queueJobs[index]];
      }
      queueRowDone = [];
      saveQueueDraft();
      renderQueue();
    };
  });
  updateQueueTotal();
  refreshIcons();
}

function updateQueueTotal() {
  const total = queueJobs.reduce((sum, job) => sum + (Number.isSafeInteger(job.count) && job.count > 0 ? job.count : 0), 0);
  document.querySelector<HTMLElement>('#queue-total')!.textContent = Number.isSafeInteger(total) ? total.toLocaleString('en-US') : 'Count too large';
  document.querySelector<HTMLElement>('#queue-jobs-count')!.textContent = `${queueJobs.length} jobs`;
}

async function startQueue(resume = false) {
  if (busy) return;
  let run = pendingQueue();
  if (!resume) {
    if (run) return;
    if (!queueJobs.length) return toast('Add at least one job.', true);
    for (const [index, job] of queueJobs.entries()) {
      if (!job.prompt.trim()) return toast(`Job ${index + 1}: enter a prompt.`, true);
      if (![...models, ...sdcppModels, ...checkpointModels].includes(job.model_id)) return toast(`Job ${index + 1}: select an installed image model.`, true);
      if (!Number.isSafeInteger(job.count) || job.count < 1) return toast(`Job ${index + 1}: enter a positive whole number.`, true);
    }
    const jobs = queueJobs.map(job => ({ ...job, prompt: job.prompt.trim() }));
    if (!Number.isSafeInteger(jobs.reduce((sum, job) => sum + job.count, 0))) return toast('Queue total exceeds the supported range.', true);
    saveQueueDraft();
    if (!outputFolder) return toast('پوشهٔ خروجی هنوز آماده نیست.', true);
    run = { id: newId(), folder: outputFolder, jobs };
    try { persistQueue(run); }
    catch { return toast('صف ذخیره نشد.', true); }
  }
  if (!run) return;
  const { jobs } = run;
  if (resume) {
    queueJobs = jobs.map(job => ({ ...job }));
    saveQueueDraft();
  }
  const total = jobs.reduce((sum, job) => sum + job.count, 0);
  queueRowDone = jobs.map(() => 0);
  queueRunning = true;
  queueCancelled = false;
  document.querySelector<HTMLButtonElement>('#queue-stop')!.hidden = false;
  document.querySelector<HTMLElement>('#queue-progress')!.classList.remove('hidden');
  document.querySelector('#queue-state')!.textContent = 'Starting queue…';
  document.querySelector('#queue-percent')!.textContent = '0%';
  document.querySelector<HTMLElement>('#queue-fill')!.style.width = '0%';
  document.querySelector('#queue-details')!.textContent = `0 / ${total.toLocaleString('en-US')} images generated`;
  renderQueue();
  setBusy(true, 'Running image queue…');
  startSnake();
  try {
    const result = await call<{ completed: number; active_model: string; loaded_models: LoadedModel[]; translation_warning: boolean }>('batch_queue', { jobs, run_id: run.id, output_folder: run.folder, project_id: projectId, keep_loaded: keepLoaded, aspect_ratio: document.querySelector<HTMLSelectElement>('#batch-aspect')!.value });
    persistQueue(null);
    activeModel = result.active_model || null;
    activeKind = sdcppModels.includes(result.active_model) ? 'sdcpp' : checkpointModels.includes(result.active_model) ? 'checkpoint' : 'image';
    loadedModels = result.loaded_models;
    document.querySelector('#queue-state')!.textContent = 'Queue completed';
    document.querySelector('#queue-percent')!.textContent = '100%';
    document.querySelector<HTMLElement>('#queue-fill')!.style.width = '100%';
    document.querySelector('#queue-details')!.textContent = `${result.completed.toLocaleString('en-US')} images generated`;
    if (result.translation_warning) toast('Some prompts could not be translated. Their original text was used.');
    notifyCollection(result.completed);
  } catch (error) {
    document.querySelector('#queue-state')!.textContent = queueCancelled ? 'Queue stopped' : 'Queue stopped with an error';
    if (queueCancelled) activeModel = null;
    if (!queueCancelled) toast(String(error), true);
  } finally {
    queueRunning = false;
    queueCancelled = false;
    document.querySelector<HTMLButtonElement>('#queue-stop')!.hidden = true;
    try { gallery = await call<GalleryItem[]>('gallery'); renderGallery(); } catch {}
    renderModels();
    renderQueue();
    setBusy(false);
    pauseSnake();
    await refreshStorage();
  }
}

async function stopQueue() {
  if (!queueRunning || queueCancelled) return;
  queueCancelled = true;
  try { await invoke('cancel_download'); }
  catch (error) { queueCancelled = false; toast(String(error), true); }
}

function showBatchProgress(completed: number, total: number, name = '') {
  const panel = document.querySelector('#batch-progress')!;
  panel.classList.remove('hidden');
  const percent = total ? Math.round(completed / total * 100) : 0;
  document.querySelector<HTMLElement>('#batch-percent')!.textContent = `${percent.toLocaleString('fa-IR')}٪`;
  document.querySelector<HTMLElement>('#batch-fill')!.style.width = `${percent}%`;
  document.querySelector('#batch-details')!.textContent = `${completed.toLocaleString('fa-IR')} از ${total.toLocaleString('fa-IR')} تصویر ساخته شد${name ? ` · آخرین فایل: ${name}` : ''}`;
}

async function startBatch() {
  if (busy) return;
  const topic = document.querySelector<HTMLTextAreaElement>('#batch-topic')!.value.trim();
  const count = Number(document.querySelector<HTMLInputElement>('#batch-count')!.value);
  if (!topic) return toast('اول موضوع عکس‌ها را بنویس.', true);
  if (!Number.isSafeInteger(count) || count < 1) return toast('تعداد باید یک عدد صحیح مثبت باشد.', true);
  const splitCpu = document.querySelector<HTMLInputElement>('#batch-split-cpu')!.checked;
  if (splitCpu && !selectedDevice.startsWith('cuda')) return toast('برای تقسیم کار، کارت گرافیک را انتخاب کن.', true);
  if (!activeModel || (activeKind !== 'image' && activeKind !== 'sdcpp' && activeKind !== 'checkpoint')) return toast('اول یک مدل عکس‌ساز را انتخاب کن.', true);
  if (splitCpu && (activeKind === 'sdcpp' || activeKind === 'checkpoint')) return toast('تقسیم CPU/GPU برای موتور تک‌فایلی فعال نیست؛ تیک تقسیم کار را بردار.', true);
  batchRunning = true;
  renderQueue();
  batchCancelled = false;
  batchGpuDone = 0;
  batchCpuDone = 0;
  document.querySelector<HTMLElement>('#batch-workers')!.textContent = splitCpu ? 'GPU: ۰ · CPU: ۰' : 'GPU: ۰';
  setBusy(true, 'Generating image batch…');
  startSnake();
  document.querySelector<HTMLButtonElement>('#stop-batch')!.hidden = false;
  document.querySelector('#batch-state')!.textContent = 'Generating images…';
  showBatchProgress(0, count);
  try {
    const result = await call<{ completed: number; translation_warning: boolean }>('batch_generate', { topic, count, split_cpu: splitCpu, project_id: projectId, aspect_ratio: document.querySelector<HTMLSelectElement>('#batch-aspect')!.value });
    document.querySelector('#batch-state')!.textContent = 'Batch completed';
    notifyCollection(result.completed);
    if (result.translation_warning) toast('ترجمهٔ فارسی در دسترس نبود.');
  } catch (error) {
    document.querySelector('#batch-state')!.textContent = batchCancelled ? 'Generation stopped' : 'Batch stopped with an error';
    toast(String(error), !batchCancelled);
    if (batchCancelled) { activeModel = null; renderModels(); }
  } finally {
    batchRunning = false;
    renderQueue();
    batchCancelled = false;
    document.querySelector<HTMLButtonElement>('#stop-batch')!.hidden = true;
    try { gallery = await call<GalleryItem[]>('gallery'); renderGallery(); } catch {}
    setBusy(false);
    pauseSnake();
    await refreshStorage();
  }
}

async function stopBatch() {
  if (!batchRunning || batchCancelled) return;
  batchCancelled = true;
  const button = document.querySelector<HTMLButtonElement>('#stop-batch')!;
  button.disabled = true;
  button.textContent = 'در حال توقف...';
  try { await invoke('cancel_download'); }
  catch (error) { batchCancelled = false; toast(String(error), true); }
  finally { button.disabled = false; button.textContent = 'توقف ساخت'; }
}

async function refreshStorage() {
  try {
    const data = await call<{ model_bytes: number; image_bytes: number; image_count: number; video_bytes: number; video_count: number; output_folder: string }>('storage');
    document.querySelector('#models-size')!.textContent = bytes(data.model_bytes);
    document.querySelector('#images-size')!.textContent = `${bytes(data.image_bytes)} · ${data.image_count.toLocaleString('fa-IR')} عکس`;
    document.querySelector('#videos-size')!.textContent = `${bytes(data.video_bytes)} · ${data.video_count.toLocaleString('fa-IR')} ویدیو`;
    outputFolder = data.output_folder;
    document.querySelector('#output-folder')!.textContent = outputFolder;
  } catch (error) { toast(String(error), true); }
}

async function chooseOutputFolder() {
  if (busy) return;
  const selected = await open({ directory: true, multiple: false, title: 'پوشهٔ ذخیرهٔ عکس‌ها را انتخاب کن' });
  if (typeof selected !== 'string') return;
  setBusy(true, 'در حال تغییر پوشهٔ ذخیره...');
  try {
    await invoke('set_output_folder', { path: selected });
    outputFolder = selected;
    document.querySelector('#output-folder')!.textContent = outputFolder;
    await call('output_folder', { path: selected });
    gallery = await call<GalleryItem[]>('gallery');
    videos = await call<{name: string; date: string}[]>('video_gallery');
    renderGallery();
    renderVideos();
    renderModels();
    await refreshStorage();
    toast('پوشهٔ ذخیره تغییر کرد. مدل‌های بارگذاری‌شده در حافظه می‌مانند. فایل‌های قبلی در پوشهٔ قبلی هستند.');
  } catch (error) { toast(String(error), true); }
  finally { setBusy(false); }
}

function drawSnake() {
  const canvas = document.querySelector<HTMLCanvasElement>('#snake-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0b1120'; ctx.fillRect(0, 0, 320, 320);
  ctx.strokeStyle = '#1c2840';
  for (let n = 0; n <= 320; n += 16) { ctx.beginPath(); ctx.moveTo(n, 0); ctx.lineTo(n, 320); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, n); ctx.lineTo(320, n); ctx.stroke(); }
  ctx.fillStyle = '#fb7899'; ctx.beginPath(); ctx.arc(snakeFood.x * 16 + 8, snakeFood.y * 16 + 8, 6, 0, Math.PI * 2); ctx.fill();
  snake.forEach((part, index) => { ctx.fillStyle = index ? '#9472ed' : '#d1b6ff'; ctx.fillRect(part.x * 16 + 2, part.y * 16 + 2, 12, 12); });
  document.querySelector('#snake-score')!.textContent = snakeScore.toLocaleString('fa-IR');
}

function snakeTick() {
  snakeDirection = snakeNextDirection;
  const head = { x: snake[0].x + snakeDirection.x, y: snake[0].y + snakeDirection.y };
  const eating = head.x === snakeFood.x && head.y === snakeFood.y;
  if (head.x < 0 || head.x >= 20 || head.y < 0 || head.y >= 20 || snake.slice(0, eating ? undefined : -1).some(p => p.x === head.x && p.y === head.y)) {
    if (snakeTimer !== null) window.clearInterval(snakeTimer);
    snakeTimer = null;
    document.querySelector('#snake-message')!.textContent = 'بازی تمام شد؛ روی «شروع دوباره» بزن. ساخت عکس‌ها ادامه دارد.';
    return;
  }
  snake.unshift(head);
  if (eating) {
    snakeScore++;
    do { snakeFood = { x: Math.floor(Math.random() * 20), y: Math.floor(Math.random() * 20) }; }
    while (snake.some(p => p.x === snakeFood.x && p.y === snakeFood.y));
  } else snake.pop();
  drawSnake();
}

function setSnakeDirection(direction: string) {
  const directions: Record<string, {x: number; y: number}> = { up: {x: 0, y: -1}, down: {x: 0, y: 1}, left: {x: -1, y: 0}, right: {x: 1, y: 0} };
  const next = directions[direction];
  if (next && (next.x !== -snakeDirection.x || next.y !== -snakeDirection.y)) snakeNextDirection = next;
}

function startSnake() {
  document.querySelector('#snake-card')!.classList.remove('hidden');
  if (snakeTimer !== null) window.clearInterval(snakeTimer);
  snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  snakeDirection = { x: 1, y: 0 }; snakeNextDirection = { x: 1, y: 0 };
  snakeFood = { x: 15, y: 10 }; snakeScore = 0;
  document.querySelector('#snake-message')!.textContent = 'با کلیدهای جهت‌دار یا WASD بازی کن. ساخت عکس‌ها ادامه دارد.';
  drawSnake();
  snakeTimer = window.setInterval(snakeTick, 150);
}

function pauseSnake() {
  if (snakeTimer !== null) window.clearInterval(snakeTimer);
  snakeTimer = null;
  document.querySelector('#snake-message')!.textContent = 'ساخت تمام شد. برای بازی دوباره، «شروع دوباره» را بزن.';
}

async function chooseModelFolder() {
  if (busy) return;
  const selected = await open({ directory: true, multiple: false, title: 'پوشهٔ دانلود مدل‌ها را انتخاب کن' });
  if (typeof selected !== 'string') return;
  setBusy(true, 'در حال تغییر پوشهٔ مدل‌ها...');
  try {
    await invoke('set_model_folder', { path: selected });
    modelFolder = selected;
    document.querySelector('#model-folder')!.textContent = modelFolder;
    activeModel = null;
    loadedModels = [];
    await call('device', { device: selectedDevice });
    const data = await call<{ models: string[]; video_models: string[]; sdcpp_models: string[]; checkpoint_models: string[]; adapters: string[] }>('models');
    models = data.models;
    videoModels = data.video_models;
    sdcppModels = data.sdcpp_models;
    checkpointModels = data.checkpoint_models;
    adapters = data.adapters;
    renderModels();
    renderQueue();
    toast('پوشهٔ دانلود تغییر کرد. مدل‌های قبلی در فهرست می‌مانند؛ مدل را دوباره انتخاب کن.');
  } catch (error) { toast(String(error), true); }
  finally { setBusy(false); }
}

async function loadModel(id: string, kind = modelKind, navigate = true) {
  if (busy) return;
  setBusy(true, `در حال بارگذاری ${id}...`);
  try {
    const result = await call<{ model: string; kind: string; loaded_models: LoadedModel[] }>('load', { model_id: id, kind, keep_loaded: keepLoaded });
    activeModel = result.model;
    activeKind = result.kind;
    loadedModels = result.loaded_models;
    renderModels();
    toast(language === 'en' ? `Model ${id} is ready.` : `مدل ${id} آماده است.`);
    if (navigate) setView(kind === 'video' ? 'video' : 'studio');
    if (kind !== 'video') void checkImageInput();
  } catch (error) {
    try {
      const state = await call<{ active: string | null; active_kind: string; loaded_models: LoadedModel[] }>('models');
      activeModel = state.active;
      activeKind = state.active_kind;
      loadedModels = state.loaded_models;
      renderModels();
    } catch {}
    toast(String(error), true);
  }
  finally { setBusy(false); }
}

async function unloadModel(id: string) {
  if (busy) return;
  setBusy(true, `در حال خروج ${id} از حافظه...`);
  try {
    const result = await call<{ active: string | null; loaded_models: LoadedModel[] }>('unload', { model_id: id, kind: sdcppModels.includes(id) ? 'sdcpp' : checkpointModels.includes(id) ? 'checkpoint' : modelKind });
    activeModel = result.active;
    loadedModels = result.loaded_models;
    renderModels();
    renderQueue();
    toast(`مدل ${id} از حافظه خارج شد.`);
  } catch (error) { toast(String(error), true); }
  finally { setBusy(false); }
}

async function generate() {
  if (busy) return;
  const prompt = (document.querySelector<HTMLTextAreaElement>('#prompt')?.value || '').trim();
  if (!prompt) return toast('اول توضیح تصویر را بنویس.', true);
  if (!activeModel || (activeKind !== 'image' && activeKind !== 'sdcpp' && activeKind !== 'checkpoint')) return toast('اول یک مدل تصویر را انتخاب کن.', true);
  const metadata = generationMetadata();
  setBusy(true, 'در حال ساخت تصویر...');
  studioPreview = 'running';
  renderStudioPreview();
  try {
    const result = await call<{ name: string; image: string; translated: string; model: string; translation_warning: boolean; temporary: boolean }>('generate', { prompt, ...metadata, temporary: temporaryImage });
    currentImageMetadata = { ...metadata, model: result.model };
    currentImage = result.image;
    currentImageName = result.name;
    currentImagePrompt = prompt;
    currentImageTemporary = result.temporary;
    studioPreview = 'ready';
    renderStudioPreview();
    const input = document.querySelector<HTMLTextAreaElement>('#prompt')!;
    if (input.value.trim() === prompt) input.value = '';
    storeStudioDraft();
    imageReady(result.temporary ? 'تصویر موقت آماده است.' : 'تصویر آماده است.', 'create');
    if (!result.temporary) { gallery.unshift({ ...metadata, name: result.name, thumbnail: result.image, date: new Date().toISOString(), prompt: result.translated, original_prompt: prompt, model: result.model }); renderGallery(); }
    if (result.translation_warning) toast('ترجمه در دسترس نبود.');
  } catch (error) {
    studioPreview = 'error';
    renderStudioPreview();
    toast(String(error), true);
  } finally { setBusy(false); }
}

async function checkImageInput() {
  const status = document.querySelector('#image-input-status')!;
  status.textContent = 'در حال بررسی موتور ویرایش مدل فعال...';
  try {
    const result = await call<{ supported: boolean; reason: string }>('image_input_capability');
    status.textContent = `${result.supported ? '✓' : '؟'} ${result.reason} دکمهٔ ویرایش در هر دو حالت فعال است.`;
  } catch (error) { status.textContent = `بررسی ناموفق بود: ${String(error)}. تلاش دستی همچنان ممکن است.`; }
}

async function editImage() {
  if (busy) return;
  const prompt = document.querySelector<HTMLTextAreaElement>('#edit-prompt')!.value.trim();
  if (!editSourceImage || !prompt) return toast('اول عکس و توضیح ویرایش را وارد کن.', true);
  if (!activeModel || !['image', 'checkpoint', 'sdcpp'].includes(activeKind)) return toast('اول یک مدل تصویر انتخاب کن.', true);
  const status = document.querySelector('#image-input-status')!;
  const metadata = { ...generationMetadata(), mode: 'edit' as const, strength: Number(document.querySelector<HTMLInputElement>('#edit-strength')!.value) };
  setBusy(true, 'در حال ویرایش عکس...');
  status.textContent = 'مدل در حال ویرایش عکس است...';
  studioPreview = 'running';
  renderStudioPreview();
  try {
    const result = await call<{ name: string; image: string; translated: string; model: string; temporary: boolean }>('edit_image', { prompt, image: editSourceImage, ...metadata, temporary: temporaryImage });
    currentImageMetadata = { ...metadata, model: result.model };
    currentImage = result.image; currentImageName = result.name; currentImageTemporary = result.temporary;
    currentImagePrompt = prompt;
    studioPreview = 'ready';
    renderStudioPreview();
    imageReady('تصویر ویرایش‌شده آماده است.', 'edit');
    if (!result.temporary) { gallery.unshift({ ...metadata, name: result.name, thumbnail: result.image, date: new Date().toISOString(), prompt: result.translated, original_prompt: prompt, model: result.model }); renderGallery(); }
    status.textContent = result.temporary ? 'ویرایش موقت آماده است؛ برای نگه‌داشتن آن ذخیره را بزن.' : 'عکس ویرایش شد و در گالری ذخیره شد.';
  } catch (error) {
    studioPreview = 'error';
    renderStudioPreview();
    status.textContent = `ویرایش انجام نشد: ${String(error)}`;
    toast(String(error), true);
  }
  finally { setBusy(false); }
}

async function updateEngine() {
  if (busy) return;
  const status = document.querySelector('#engine-status')!;
  setBusy(true, 'در حال به‌روزرسانی موتور Diffusers...');
  status.textContent = 'در حال دریافت نسخهٔ تازهٔ موتور...';
  let unlisten: (() => void) | null = null;
  try {
    unlisten = await listen<{ message: string }>('setup-progress', event => { status.textContent = event.payload.message; });
    const result = await invoke<{ version: string }>('update_diffusers_engine');
    inspections.clear();
    status.textContent = `Diffusers ${result.version} آماده است. مدل‌های دلخواهت را دوباره بررسی کن.`;
    toast(`موتور Diffusers به نسخهٔ ${result.version} به‌روز شد.`);
  } catch (error) {
    status.textContent = `به‌روزرسانی ناموفق بود: ${String(error)}`;
    toast(String(error), true);
  } finally {
    unlisten?.();
    setBusy(false);
  }
}

async function searchModels(imageOnly = false) {
  if (busy) return;
  const query = document.querySelector<HTMLInputElement>('#search-input')!.value.trim();
  setBusy(true, 'در حال جست‌وجو در Hugging Face...');
  document.querySelector('#search-results')!.innerHTML = '<div class="search-placeholder"><span class="spinner"></span> در حال جست‌وجو...</div>';
  try { searchResults = await call<Model[]>('search', { query, kind: modelKind, image_only: imageOnly }); searchCategoryFilter = 'all'; searchVisibleCount = 80; renderSearch(); }
  catch (error) { toast(String(error), true); }
  finally { setBusy(false); }
}

async function downloadModel(id: string, kind = modelKind) {
  if (busy) return;
  localStorage.setItem('nocturne-pending-download', JSON.stringify({ id, kind }));
  cancellingDownload = false;
  const panel = document.querySelector<HTMLElement>('#download-progress')!;
  panel.dataset.model = id;
  panel.classList.remove('hidden', 'download-failed', 'download-done');
  document.querySelector('#download-name')!.textContent = id;
  const cancel = document.querySelector<HTMLButtonElement>('#cancel-download')!;
  cancel.hidden = false;
  cancel.disabled = false;
  cancel.textContent = 'لغو دانلود';
  document.querySelector('#download-phase')!.textContent = 'در حال آماده‌سازی...';
  updateDownloadProgress({ model_id: id, processed: 0, received: 0, total: 0, speed: 0 });
  const idleTimer = window.setInterval(() => {
    const idle = Math.floor((Date.now() - lastDownloadActivity) / 1000);
    if (idle >= 15 && !cancellingDownload) document.querySelector('#download-phase')!.textContent = `منتظر پاسخ سرور؛ ${idle.toLocaleString('fa-IR')} ثانیه بدون دادهٔ تازه. اتصال خودکار دوباره امتحان می‌شود.`;
  }, 1000);
  setBusy(true, `در حال دانلود ${id}؛ این کار ممکن است چند دقیقه طول بکشد...`);
  try {
    await call('download', { model_id: id, kind });
    const result = await call<{ models: string[]; video_models: string[]; sdcpp_models: string[]; checkpoint_models: string[]; adapters: string[] }>('models');
    models = result.models;
    videoModels = result.video_models;
    sdcppModels = result.sdcpp_models;
    checkpointModels = result.checkpoint_models;
    adapters = result.adapters;
    renderModels();
    panel.classList.add('download-done');
    void refreshStorage();
    document.querySelector('#download-percent')!.textContent = 'کامل';
    document.querySelector('#download-phase')!.textContent = kind === 'adapter' ? 'LoRA دانلود شد؛ برای اجرا به مدل پایهٔ Qwen/Qwen-Image-2.1 نیاز دارد.' : kind === 'sdcpp' ? 'مدل، موتور و پیش‌نیازها نصب شدند؛ اکنون مدل را انتخاب کن.' : 'دانلود کامل شد و مدل آمادهٔ انتخاب است.';
    toast(kind === 'adapter' ? 'LoRA دانلود شد. مدل پایهٔ Qwen-Image-2.1 جداگانه لازم است.' : `${id} دانلود شد. اکنون روی «انتخاب» بزن.`);
    localStorage.removeItem('nocturne-pending-download');
  } catch (error) {
    panel.classList.add('download-failed');
    document.querySelector('#download-percent')!.textContent = cancellingDownload ? 'لغو شد' : 'خطا';
    document.querySelector('#download-phase')!.textContent = cancellingDownload ? 'دانلود متوقف شد. دوباره می‌توانی ادامه بدهی.' : 'دانلود انجام نشد. پیام خطا را ببین.';
    toast(String(error), !cancellingDownload);
  }
  finally { inspections.delete(id); renderSearch(); window.clearInterval(idleTimer); cancel.hidden = true; cancellingDownload = false; setBusy(false); }
}

async function cancelDownload() {
  if (!busy || cancellingDownload) return;
  cancellingDownload = true;
  const button = document.querySelector<HTMLButtonElement>('#cancel-download')!;
  button.disabled = true;
  button.textContent = 'در حال لغو...';
  try {
    const stopped = await invoke<boolean>('cancel_download');
    if (!stopped) {
      cancellingDownload = false;
      button.disabled = false;
      button.textContent = 'لغو دانلود';
    }
  } catch (error) {
    cancellingDownload = false;
    button.disabled = false;
    button.textContent = 'لغو دانلود';
    toast(String(error), true);
  }
}

async function openImage(name: string, recent: boolean) {
  const hidden = () => galleryLocked || privacyCover || (recent ? hideRecent : hideGallery);
  if (hidden()) return;
  try {
    const result = await call<{ image: string }>('image', { name });
    if (!hidden()) showImage(result.image, name);
  } catch (error) { toast(String(error), true); }
}

function showImage(image: string, name: string) {
  const saved = gallery.find(item => item.name === name);
  viewerSettings = saved || (name === currentImageName ? currentImageMetadata : {});
  document.querySelector<HTMLButtonElement>('#viewer-versions')!.hidden = !saved || relatedImages(gallery, name).size < 2;
  viewerPrompt = saved?.original_prompt || saved?.prompt || (name === currentImageName ? currentImagePrompt : '');
  document.querySelector<HTMLButtonElement>('#viewer-reuse-prompt')!.hidden = !viewerPrompt;
  viewerZoom = 1;
  document.querySelector<HTMLImageElement>('#modal-image')!.src = image;
  document.querySelector('#modal-caption')!.textContent = name;
  document.querySelector<HTMLImageElement>('#modal-image')!.style.transform = 'scale(1)';
  document.querySelector('#viewer-modal')!.classList.remove('hidden');
}

function renderVoices() {
  const select = document.querySelector<HTMLSelectElement>('#voice-model-select')!;
  const previous = select.value || localStorage.getItem('nocturne-selected-voice') || '';
  select.innerHTML = voiceModels.length ? voiceModels.map(id => `<option value="${safe(id)}">${safe(id)}</option>`).join('') : '<option value="">مدل صدا نصب نشده</option>';
  if (voiceModels.includes(previous)) select.value = previous;
  select.onchange = () => localStorage.setItem('nocturne-selected-voice', select.value);
  const installed = document.querySelector('#installed-voices');
  if (installed) { installed.innerHTML = voiceModels.length ? voiceModels.map(id => `<button class="small-button" data-select-voice="${safe(id)}">${safe(id)} · انتخاب</button>`).join('') : '<span>مدل صدای کاملی در پوشه‌های فعلی پیدا نشد.</span>'; installed.querySelectorAll<HTMLButtonElement>('[data-select-voice]').forEach(button => button.onclick = () => { select.value = button.dataset.selectVoice!; localStorage.setItem('nocturne-selected-voice', select.value); setView('voice'); document.querySelector('#voice-status')!.textContent = `${button.dataset.selectVoice} آمادهٔ ساخت است.`; }); }
  document.querySelector('#voice-gallery')!.innerHTML = voices.length ? voices.map(item => `<div class="voice-gallery-card"><strong>${safe(item.name)}</strong><span>${item.duration.toLocaleString('fa-IR')} ثانیه</span><p>${safe(item.text)}</p><small>${safe(item.model)}</small><button class="small-button" data-play-voice="${safe(item.name)}">پخش صدا</button></div>`).join('') : '<div class="gallery-empty">هنوز صدایی ساخته نشده است.</div>';
  document.querySelectorAll<HTMLButtonElement>('[data-play-voice]').forEach(el => el.onclick = () => void playVoice(el.dataset.playVoice!));
}

async function refreshInstalledVoices() {
  try { voiceModels = await call<string[]>('tts_installed'); renderVoices(); if (voiceSearchResults.length) renderVoiceSearchResults(); }
  catch (error) { document.querySelector('#voice-status')!.textContent = String(error); }
}

async function playVoice(name: string) {
  try {
    const result = await call<{ audio: string }>('tts_audio', { name });
    document.querySelector('#voice-player')!.innerHTML = `<audio controls autoplay src="${result.audio}"></audio>`;
    setView('voice');
  } catch (error) { toast(String(error), true); }
}

let voiceSearchSequence = 0;
async function searchVoices() {
  const sequence = ++voiceSearchSequence;
  const query = document.querySelector<HTMLInputElement>('#voice-search-input')!.value.trim();
  const target = document.querySelector('#voice-search-results')!;
  target.innerHTML = '<div class="search-placeholder"><span class="spinner"></span> در حال جست‌وجو...</div>';
  try {
    const results = await call<{ id: string; language: string; downloads: number }[]>('tts_search', { query });
    if (sequence !== voiceSearchSequence) return;
    voiceSearchResults = results;
    renderVoiceSearchResults();
  } catch (error) { if (sequence === voiceSearchSequence) target.textContent = String(error); }
}

function renderVoiceSearchResults() {
  const target = document.querySelector('#voice-search-results')!;
  const scroll = target.scrollTop;
  target.innerHTML = voiceSearchResults.length ? voiceSearchResults.map(item => {
      const info = voiceInspections.get(item.id);
      const installed = voiceModels.includes(item.id);
      const scale = item.id === 'facebook/mms-tts-fas' ? '۳۶٫۳ میلیون پارامتر · ' : item.id.includes('Qwen3-TTS-12Hz-0.6B-CustomVoice') ? '۶۰۰ میلیون پارامتر · ' : item.id.includes('Qwen3-TTS-12Hz-1.7B-CustomVoice') ? '۱٫۷ میلیارد پارامتر · ' : '';
      const detail = scale + (info ? `${info.engine || 'موتور پشتیبانی‌نشده'} · ${info.size_gb == null ? '' : `${(info.size_gb ?? 0).toLocaleString('fa-IR')} GB · `}${info.reason}` : `زبان: ${item.language}`);
      return `<div class="voice-result"><div class="voice-model-icon">${icon('Mic2', 22)}</div><div><b>${safe(item.id)}</b><small>${safe(detail)} · ${item.downloads.toLocaleString('fa-IR')} دانلود</small></div><div><button class="small-button" data-voice-inspect="${safe(item.id)}">بررسی</button><button class="small-button" data-voice-download="${safe(item.id)}" ${!installed && !info?.engine ? 'disabled' : ''}>${installed ? 'انتخاب مدل' : info?.engine ? 'دانلود مدل' : 'بررسی برای دانلود'}</button></div></div>`;
    }).join('') : '<div class="search-placeholder">مدلی پیدا نشد.</div>';
    target.querySelectorAll<HTMLButtonElement>('[data-voice-inspect]').forEach(el => el.onclick = () => void inspectVoice(el.dataset.voiceInspect!));
    target.querySelectorAll<HTMLButtonElement>('[data-voice-download]').forEach(el => el.onclick = () => void downloadVoice(el.dataset.voiceDownload!));
  target.scrollTop = scroll; refreshIcons();
}

async function inspectVoice(id: string) {
  const target = document.querySelector('#voice-status')!;
  target.textContent = `در حال بررسی ${id}...`;
  try {
    const info = await call<{ engine: string | null; reason: string; size_gb: number | null }>('tts_info', { model_id: id });
    voiceInspections.set(id, info);
    target.textContent = info.reason;
    const row = [...document.querySelectorAll<HTMLElement>('.voice-result')].find(element => element.querySelector<HTMLButtonElement>('[data-voice-inspect]')?.dataset.voiceInspect === id);
    if (row) { const detail = row.querySelector('small')!; detail.textContent = `${info.engine || 'موتور پشتیبانی‌نشده'} · ${(info.size_gb ?? 0).toLocaleString('fa-IR')} GB · ${info.reason}`; const button = row.querySelector<HTMLButtonElement>('[data-voice-download]')!; const installed = voiceModels.includes(id); button.disabled = !installed && !info.engine; button.textContent = installed ? 'انتخاب مدل' : info.engine ? 'دانلود مدل' : 'پشتیبانی نمی‌شود'; }
  } catch (error) { target.textContent = String(error); toast(String(error), true); }
}

async function downloadVoice(id: string) {
  if (voiceModels.includes(id)) { const select = document.querySelector<HTMLSelectElement>('#voice-model-select')!; select.value = id; localStorage.setItem('nocturne-selected-voice', id); document.querySelector('#voice-status')!.textContent = `${id} آمادهٔ ساخت است.`; return; }
  if (busy) return;
  activeVoiceDownload = id;
  document.querySelector<HTMLElement>('#voice-stop')!.hidden = false;
  setBusy(true, `در حال دانلود مدل صدای ${id}...`);
  document.querySelector('#voice-status')!.textContent = `در حال دریافت ${id}...`;
  document.querySelector<HTMLElement>('#voice-download-progress')!.hidden = false;
  document.querySelector<HTMLElement>('#voice-download-track')!.style.width = '0%';
  document.querySelector<HTMLElement>('#voice-download-stats')!.textContent = 'در حال اتصال...';
  try {
    await call('tts_download', { model_id: id });
    voiceModels = await call('tts_installed');
    renderVoices(); await searchVoices();
    document.querySelector('#voice-status')!.textContent = `${id} آماده است.`;
    toast('مدل صدا نصب شد.');
  } catch (error) {
    document.querySelector('#voice-status')!.textContent = `دانلود مدل صدا ناموفق بود: ${String(error)}`;
    toast(String(error), true);
  }
  finally { activeVoiceDownload = null; document.querySelector<HTMLElement>('#voice-stop')!.hidden = true; setBusy(false); }
}

async function generateVoice() {
  if (busy) return;
  const textValue = document.querySelector<HTMLTextAreaElement>('#voice-text')!.value.trim();
  const model_id = document.querySelector<HTMLSelectElement>('#voice-model-select')!.value;
  if (!textValue || !model_id) return toast('متن و مدل زبان را انتخاب کن.', true);
  setBusy(true, 'در حال ساخت صدا...');
  document.querySelector<HTMLElement>('#voice-stop')!.hidden = false;
  document.querySelector('#voice-status')!.textContent = 'مدل در حال خواندن متن است...';
  try {
    const result = await call<{ name: string }>('tts_generate', { model_id, text: textValue });
    voices = await call('tts_gallery'); renderVoices(); await playVoice(result.name);
    document.querySelector('#voice-status')!.textContent = 'صدا ساخته و ذخیره شد.';
  } catch (error) { toast(String(error), true); document.querySelector('#voice-status')!.textContent = 'ساخت صدا ناموفق بود: ' + String(error); }
  finally { document.querySelector<HTMLElement>('#voice-stop')!.hidden = true; setBusy(false); }
}

function renderVideos() {
  const target = document.querySelector('#video-gallery')!;
  target.innerHTML = videos.length ? videos.map(item => `<button class="video-item" data-video="${safe(item.name)}">${icon('Play', 16)} <span>${safe(item.name)}</span></button>`).join('') : '<div class="gallery-empty">هنوز ویدیویی ذخیره نشده است.</div>';
  document.querySelectorAll<HTMLButtonElement>('[data-video]').forEach(el => el.onclick = () => openVideo(el.dataset.video!));
  refreshIcons();
}

async function openVideo(name: string) {
  try {
    const result = await call<{ video: string }>('video_data', { name });
    document.querySelector('#video-stage')!.innerHTML = `<video class="main-video" controls autoplay playsinline src="${result.video}"></video>`;
    document.querySelector('#video-title')!.textContent = name;
  } catch (error) { toast(String(error), true); }
}

async function generateVideo() {
  if (busy) return;
  const prompt = document.querySelector<HTMLTextAreaElement>('#video-prompt')!.value.trim();
  if (!prompt) return toast('اول توضیح ویدیو را بنویس.', true);
  if (!activeModel || activeKind !== 'video') return toast('اول یک مدل ویدیوساز را انتخاب کن.', true);
  setBusy(true, 'در حال ساخت ویدیو؛ این کار ممکن است زمان ببرد...');
  document.querySelector('#video-stage')!.innerHTML = '<div class="generation-loader"><div class="loader-rings"><span></span><span></span><span></span></div><b>در حال ساخت ویدیو</b><p>لطفاً تا پایان پردازش صبر کن.</p></div>';
  try {
    const result = await call<{ name: string; translated: string; translation_warning: boolean }>('generate_video', { prompt });
    videos = await call('video_gallery');
    renderVideos();
    await openVideo(result.name);
    document.querySelector<HTMLTextAreaElement>('#video-prompt')!.value = '';
    toast(result.translation_warning ? 'ویدیو ذخیره شد؛ ترجمه در دسترس نبود و متن فارسی مستقیم به مدل فرستاده شد.' : 'ویدیو ساخته و در پوشهٔ generated_images ذخیره شد.');
  } catch (error) {
    document.querySelector('#video-stage')!.innerHTML = '<div class="empty-state"><h3>ساخت ویدیو انجام نشد</h3><p>پیام خطا را ببین و دوباره تلاش کن.</p></div>';
    toast(String(error), true);
  } finally { setBusy(false); }
}

async function changeDevice(device: string) {
  if (busy) return;
  setBusy(true, 'در حال تغییر دستگاه پردازش...');
  try {
    await call('device', { device });
    selectedDevice = device;
    activeModel = null;
    loadedModels = [];
    document.querySelector('#gpu-name')!.textContent = devices.find(item => item.id === device)?.name || device;
    void refreshHardware();
    renderModels();
    renderQueue();
    toast('دستگاه تغییر کرد. مدل را دوباره انتخاب کن.');
  } catch (error) {
    document.querySelector<HTMLSelectElement>('#device-select')!.value = selectedDevice;
    toast(String(error), true);
  } finally { setBusy(false); }
}


function generationMetadata() {
  return {
    project_id: projectId,
    parent_image: parentImage,
    aspect_ratio: document.querySelector<HTMLSelectElement>('#image-aspect')!.value,
  };
}

function storeStudioDraft() {
  const draft = {
    prompt: document.querySelector<HTMLTextAreaElement>('#prompt')!.value,
    edit: document.querySelector<HTMLTextAreaElement>('#edit-prompt')!.value,
    aspect: document.querySelector<HTMLSelectElement>('#image-aspect')!.value,
    parent: parentImage,
  };
  try { localStorage.setItem(scopedKey(studioDraftKey), JSON.stringify(draft)); }
  catch { /* The current prompt remains available in the editor. */ }
}

function restoreStudioDraft() {
  const draft = stored(scopedKey(studioDraftKey), { prompt: '', edit: '', aspect: '', parent: '' });
  document.querySelector<HTMLTextAreaElement>('#prompt')!.value = draft.prompt;
  document.querySelector<HTMLTextAreaElement>('#edit-prompt')!.value = draft.edit;
  const ratio = document.querySelector<HTMLSelectElement>('#image-aspect')!;
  const fallback = localStorage.getItem('nocturne-default-aspect') || '1:1';
  const chosen = draft.aspect || fallback;
  ratio.value = aspectOptions.some(([value]) => value === chosen) ? chosen : '1:1';
  parentImage = draft.parent;
}

function setEditSource(image: string) {
  editSourceImage = image;
  const preview = document.querySelector<HTMLImageElement>('#edit-source-preview')!;
  if (image) preview.src = image;
  else preview.removeAttribute('src');
  preview.hidden = !image;
}

async function uploadReference(file: File) {
  if (busy) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 ** 2) {
    return toast('فقط PNG، JPEG یا WebP تا ۲۰ مگابایت پذیرفته می‌شود.', true);
  }
  const owner = projectId;
  const reader = new FileReader();
  reader.onload = async () => {
    if (owner !== projectId || busy) return;
    const image = String(reader.result);
    setEditSource(image);
    document.querySelector('#image-input-status')!.textContent = file.name;
    if (!owner) return;
    setBusy(true, 'در حال ذخیرهٔ عکس مرجع…');
    try { const saved = await call<{ id: string }>('project_reference', { project_id: owner, image, name: file.name });
      await refreshReferences(saved.id); }
    catch (error) { toast(String(error), true); }
    finally { setBusy(false); }
  };
  reader.onerror = () => toast('خواندن عکس ناموفق بود.', true);
  reader.readAsDataURL(file);
}

function refreshProjectPicker() {
  const picker = document.querySelector<HTMLSelectElement>('#project-select')!;
  picker.replaceChildren(new Option(language === 'en' ? 'All projects' : 'همهٔ پروژه‌ها', ''),
    ...projects.map(project => new Option(project.name, project.id)));
  picker.value = projectId;
  document.querySelector<HTMLElement>('#project-references')!.hidden = !projectId;
}

function switchProject(id: string) {
  if (busy || id === projectId) return;
  storeStudioDraft();
  try { activateProject(id); }
  catch { refreshProjectPicker(); return toast('پروژه ذخیره نشد.', true); }
  queueJobs = readQueueDraft();
  queueRowDone = [];
  promptPresets = stored<PromptPreset[]>(scopedKey(promptPresetsKey), []);
  setStudioMode('create');
  restoreStudioDraft();
  setEditSource('');
  document.querySelector('#image-input-status')!.textContent = 'یک مدل و عکس انتخاب کن؛ سپس بررسی یا ویرایش را بزن.';
  document.querySelector<HTMLInputElement>('#edit-source')!.value = '';
  currentImage = null;
  currentImageName = '';
  currentImageMetadata = {};
  studioPreview = 'empty';
  document.querySelector('#viewer-modal')!.classList.add('hidden');
  document.querySelector<HTMLElement>('#image-ready-notice')!.hidden = true;
  document.querySelector('#queue-progress')!.classList.add('hidden');
  versionFilter = '';
  galleryModelFilter = '';
  refreshProjectPicker();
  void refreshReferences();
  renderPromptPresets();
  renderStudioPreview();
  renderQueue();
  renderGallery();
}

async function reuseImage() {
  if (!viewerPrompt || privacyCover || busy) return;
  const saved = viewerSettings;
  const prompt = viewerPrompt;
  const shownImage = document.querySelector<HTMLImageElement>('#modal-image')!.src;
  const savedModel = saved.model;
  const kind = savedModel && (
    sdcppModels.includes(savedModel) ? 'sdcpp' : checkpointModels.includes(savedModel) ? 'checkpoint'
      : models.includes(savedModel) ? 'image' : ''
  );
  document.querySelector('#viewer-modal')!.classList.add('hidden');
  setView('studio');
  setStudioMode(saved.mode === 'edit' ? 'edit' : 'create');
  parentImage = saved.name || '';
  loadPrompt(prompt, saved.aspect_ratio);
  if (saved.mode === 'edit') {
    setEditSource(shownImage);
    const edit = document.querySelector<HTMLTextAreaElement>('#edit-prompt')!;
    edit.value = prompt;
    const strength = document.querySelector<HTMLInputElement>('#edit-strength')!;
    if (typeof saved.strength === 'number') {
      strength.value = String(saved.strength);
      strength.dispatchEvent(new Event('input'));
    }
    edit.focus();
  }
  storeStudioDraft();
  if (savedModel && kind && activeModel !== savedModel) await loadModel(savedModel, kind, false);
  if (savedModel && activeModel !== savedModel) toast('مدل تصویر اصلی آماده نیست؛ مدل را بررسی کن.', true);
}

async function refreshReferences(selected = '') {
  const owner = projectId;
  const picker = document.querySelector<HTMLSelectElement>('#project-reference-select')!;
  picker.replaceChildren(new Option('انتخاب عکس مرجع', ''));
  if (!owner) return;
  try {
    const data = await call<{ references: { id: string; name: string }[] }>('project_reference', { project_id: owner });
    if (owner !== projectId) return;
    picker.append(...data.references.map(ref => new Option(ref.name, ref.id)));
    picker.value = selected;
    if (!picker.selectedOptions.length) picker.selectedIndex = 0;
    applyLanguage();
  } catch (error) { if (owner === projectId) toast(String(error), true); }
}

function mountProjectControls() {
  const picker = document.querySelector<HTMLSelectElement>('#project-select')!;
  const dialog = document.querySelector<HTMLDialogElement>('#project-dialog')!;
  const name = document.querySelector<HTMLInputElement>('#project-name')!;
  refreshProjectPicker();
  picker.onchange = () => switchProject(picker.value);
  document.querySelector<HTMLButtonElement>('#project-create')!.onclick = () => {
    if (busy || privacyCover) return;
    name.value = '';
    dialog.returnValue = '';
    dialog.showModal();
  };
  dialog.onclose = () => {
    if (dialog.returnValue !== 'create' || busy) return;
    const label = name.value.trim();
    if (!label) return;
    try { switchProject(addProject(label)); }
    catch { toast('پروژه ذخیره نشد.', true); }
  };
  for (const id of ['prompt', 'edit-prompt', 'image-aspect']) {
    document.getElementById(id)!.addEventListener('input', storeStudioDraft);
  }

  document.querySelector<HTMLButtonElement>('#project-load-reference')!.onclick = async () => {
    if (!projectId || busy) return;
    const referenceId = document.querySelector<HTMLSelectElement>('#project-reference-select')!.value;
    if (!referenceId) return toast('یک عکس مرجع انتخاب کن.', true);
    setBusy(true, 'در حال خواندن عکس مرجع…');
    try {
      const data = await call<{ image: string }>('project_reference', { project_id: projectId, reference_id: referenceId });
      if (data.image) setEditSource(data.image);
      else toast('عکس مرجعی برای این پروژه ذخیره نشده است.', true);
    } catch (error) { toast(String(error), true); }
    finally { setBusy(false); }
  };

  document.querySelector('#full-gallery')!.insertAdjacentHTML('beforebegin', `
    <div id="gallery-versions-notice" hidden><span>نسخه‌های مرتبط</span>
      <button type="button" class="small-button" id="gallery-clear-versions">نمایش همه</button></div>`);
  document.querySelector<HTMLButtonElement>('#gallery-clear-versions')!.onclick = () => {
    versionFilter = '';
    renderGallery();
  };
  document.querySelector<HTMLButtonElement>('#viewer-versions')!.onclick = () => {
    if (!viewerSettings.name || galleryLocked || privacyCover) return;
    versionFilter = viewerSettings.name;
    galleryModelFilter = galleryQuery = galleryFrom = galleryTo = '';
    for (const id of ['gallery-query', 'gallery-from', 'gallery-to']) document.querySelector<HTMLInputElement>('#' + id)!.value = '';
    showFavoriteImages = false;
    document.querySelector<HTMLInputElement>('#gallery-favorites-filter')!.checked = false;
    document.querySelector('#viewer-modal')!.classList.add('hidden');
    renderGallery();
    setView('gallery');
  };

  document.querySelector<HTMLButtonElement>('#queue-resume')!.onclick = () => void startQueue(true);
  document.querySelector<HTMLButtonElement>('#queue-discard')!.onclick = () => {
    if (busy || !window.confirm(language === 'en'
      ? 'Clear the saved run? Generated images and the queue draft will stay.'
      : 'صف ذخیره‌شده کنار گذاشته شود؟ عکس‌های ساخته‌شده و پیش‌نویس صف باقی می‌مانند.')) return;
    try {
      persistQueue(null);
      queueRowDone = [];
      document.querySelector('#queue-progress')!.classList.add('hidden');
      renderQueue();
    } catch { toast('صف ذخیره نشد.', true); }
  };

  mountMatrix();
}

function mountMatrix() {
  const dialog = document.querySelector<HTMLDialogElement>('#matrix-dialog')!;
  const form = document.querySelector<HTMLFormElement>('#matrix-form')!;
  const prompts = document.querySelector<HTMLTextAreaElement>('#matrix-prompts')!;
  const count = document.querySelector<HTMLInputElement>('#matrix-count')!;
  const preview = document.querySelector<HTMLElement>('#matrix-preview')!;
  const append = document.querySelector<HTMLButtonElement>('#matrix-append')!;
  let combinations: QueueJob[] = [];
  function clearPreview() {
    combinations = [];
    preview.replaceChildren();
    append.disabled = true;
  }
  document.querySelector<HTMLButtonElement>('#matrix-open')!.onclick = () => {
    if (busy || privacyCover) return;
    const installed = [...new Set([...models, ...sdcppModels, ...checkpointModels])];
    if (!installed.length) return toast('اول یک مدل تصویر را انتخاب کن.', true);
    clearPreview();
    document.querySelector('#matrix-models')!.innerHTML = installed.map(id =>
      `<label dir="ltr"><input type="checkbox" name="model" value="${safe(id)}" ${id === activeModel ? 'checked' : ''}/>${safe(id)}</label>`).join('');
    document.querySelector('#matrix-ratios')!.innerHTML = aspectOptions.map(([ratio]) =>
      `<label dir="ltr"><input type="checkbox" name="ratio" value="${ratio}" ${ratio === '1:1' ? 'checked' : ''}/>${ratio}</label>`).join('');
    dialog.showModal();
  };
  document.querySelector<HTMLButtonElement>('#matrix-close')!.onclick = () => dialog.close();
  form.oninput = event => {
    if (preview.contains(event.target as Node)) {
      append.disabled = !preview.querySelector(':checked');
    } else clearPreview();
  };
  form.onsubmit = event => {
    event.preventDefault();
    const data = new FormData(form);
    const lines = [...new Set(prompts.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
    const picks = data.getAll('model').map(String);
    const ratios = data.getAll('ratio').map(String);
    const images = count.valueAsNumber;
    const total = lines.length * picks.length * ratios.length;
    if (!total || !Number.isSafeInteger(images) || images < 1) return toast('پرامپت، مدل و نسبت تصویر را انتخاب کن.', true);
    if (total > 2000 || !Number.isSafeInteger(total * images)) return toast('ترکیب‌ها را در چند مرحله اضافه کن.', true);
    combinations = buildCombinations(lines, picks, ratios, images);
    preview.innerHTML = combinations.map((job, index) => `
      <label dir="auto"><input type="checkbox" data-combination="${index}" checked/>
        <span>${safe(job.prompt)} · <bdi>${safe(job.model_id)} · ${job.aspect_ratio} · ×${job.count}</bdi></span>
      </label>`).join('');
    append.disabled = false;
  };
  append.onclick = () => {
    if (busy) return;
    const chosen = Array.from(preview.querySelectorAll<HTMLInputElement>('[data-combination]:checked'),
      item => combinations[Number(item.dataset.combination)]);
    if (!chosen.length) return;
    const draft = queueJobs[0];
    if (queueJobs.length === 1 && !draft.model_id && !draft.prompt && draft.count === 20 && !draft.variations) {
      queueJobs = [];
    }
    queueJobs.push(...chosen);
    queueRowDone = [];
    saveQueueDraft();
    renderQueue();
    dialog.close();
  };
}

function attachEvents() {
  const notification = document.querySelector<HTMLButtonElement>('#image-notifications')!;
  notification.onclick = () => {
    imageNotifications = !imageNotifications;
    localStorage.setItem(imageNotificationsKey, imageNotifications ? '1' : '0');
    notification.setAttribute('aria-pressed', String(imageNotifications));
    notification.querySelector('.studio-bell-state')!.textContent = imageNotifications ? 'روشن' : 'خاموش';
    applyLanguage();
  };
  document.querySelector<HTMLButtonElement>('#dismiss-image-notice')!.onclick = () => {
    document.querySelector<HTMLElement>('#image-ready-notice')!.hidden = true;
  };
  const presetSelect = document.querySelector<HTMLSelectElement>('#preset-select')!;
  const presetName = document.querySelector<HTMLInputElement>('#preset-name')!;
  const presetLoad = document.querySelector<HTMLButtonElement>('#preset-load')!;
  const presetRemove = document.querySelector<HTMLButtonElement>('#preset-remove')!;
  presetSelect.onchange = () => { presetLoad.disabled = presetRemove.disabled = !presetSelect.value; };
  document.querySelector<HTMLButtonElement>('#preset-save')!.onclick = () => {
    const name = presetName.value.trim();
    const prompt = document.querySelector<HTMLTextAreaElement>('#prompt')!.value.trim();
    if (!name || !prompt) return toast('اول پرامپت و نام آن را وارد کن.', true);
    if (promptPresets.some(preset => preset.name === name)) return toast('این نام قبلاً استفاده شده است.', true);
    const aspect = document.querySelector<HTMLSelectElement>('#image-aspect')!.value;
    promptPresets.push({ name, prompt, aspect });
    localStorage.setItem(scopedKey(promptPresetsKey), JSON.stringify(promptPresets));
    presetName.value = '';
    renderPromptPresets(name);
    toast('پرامپت و نسبت تصویر ذخیره شدند.');
  };
  presetLoad.onclick = () => {
    const preset = promptPresets.find(item => item.name === presetSelect.value);
    if (preset) loadPrompt(preset.prompt, preset.aspect);
  };
  presetRemove.onclick = () => {
    if (!presetSelect.value) return;
    promptPresets = promptPresets.filter(item => item.name !== presetSelect.value);
    localStorage.setItem(scopedKey(promptPresetsKey), JSON.stringify(promptPresets));
    renderPromptPresets();
    toast('پرامپت ذخیره‌شده حذف شد.');
  };
  const favoriteFilter = document.querySelector<HTMLInputElement>('#gallery-favorites-filter')!;
  favoriteFilter.onchange = () => { showFavoriteImages = favoriteFilter.checked; renderGallery(); };
  window.setInterval(() => { if (!busy && document.querySelector('#website-view')?.classList.contains('active')) void refreshWebsite(); }, 10000);
  document.querySelector<HTMLButtonElement>('#voice-stop')!.onclick = () => void invoke('cancel_download').catch(error => toast(String(error), true));
  document.querySelector<HTMLButtonElement>('#check-image-input')!.onclick = () => void checkImageInput();
  document.querySelector<HTMLButtonElement>('#edit-generate')!.onclick = () => void editImage();
  document.querySelector<HTMLInputElement>('#edit-strength')!.oninput = event => { document.querySelector('#edit-strength-value')!.textContent = Number((event.target as HTMLInputElement).value).toLocaleString('fa-IR'); };
  document.querySelector<HTMLInputElement>('#edit-source')!.onchange = event => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void uploadReference(file);
  };
  document.querySelector<HTMLButtonElement>('#hf-login')!.onclick = async () => { const input = document.querySelector<HTMLInputElement>('#hf-token')!; try { await call('hf_login', { token: input.value }); input.value = ''; document.querySelector('#hf-auth-status')!.textContent = 'حساب متصل شد. مدل را دوباره بررسی کن.'; toast('ورود Hugging Face انجام شد.'); } catch (error) { input.value = ''; toast(String(error), true); } };
  document.querySelector<HTMLButtonElement>('#flux-search')!.onclick = () => { setView('models'); document.querySelector<HTMLInputElement>('#search-input')!.value = 'FLUX'; void searchModels(true); };
  document.querySelector<HTMLButtonElement>('#flux-free')!.onclick = () => { setView('models'); document.querySelector<HTMLInputElement>('#search-input')!.value = 'unsloth/FLUX.1-schnell'; void searchModels(true); };
  document.querySelector<HTMLButtonElement>('#web-start')!.onclick = async () => { try { await call('web_start', { port: Number(document.querySelector<HTMLInputElement>('#web-port')!.value) }); await refreshWebsite(); } catch (error) { toast(String(error), true); } };
  document.querySelector<HTMLButtonElement>('#web-public-start')!.onclick = async () => { const button = document.querySelector<HTMLButtonElement>('#web-public-start')!; button.disabled = true; setBusy(true, 'در حال بررسی اتصال عمومی...'); button.textContent = 'در حال آماده‌سازی تونل...'; try { await call('web_public_start'); } catch (error) { toast(String(error), true); } finally { setBusy(false); button.textContent = 'بازکردن دسترسی عمومی امن'; await refreshWebsite(); } };
  document.querySelector<HTMLButtonElement>('#web-public-stop')!.onclick = async () => { try { await call('web_public_stop'); await refreshWebsite(); } catch (error) { toast(String(error), true); } };
  document.querySelector<HTMLButtonElement>('#web-stop')!.onclick = async () => { try { await call('web_stop'); await refreshWebsite(); } catch (error) { toast(String(error), true); } };
  document.querySelector<HTMLButtonElement>('#web-save-settings')!.onclick = async () => { try { await call('web_settings', { min_free_ram_gb: Number(document.querySelector<HTMLInputElement>('#web-free-ram')!.value) }); await refreshWebsite(); } catch (error) { toast(String(error), true); } };
  document.querySelector<HTMLButtonElement>('#web-add-user')!.onclick = async () => { try { const password = document.querySelector<HTMLInputElement>('#web-user-password')!.value; const result = await call<{ name: string }>('web_create_user', { name: document.querySelector<HTMLInputElement>('#web-user-name')!.value, password, quota: Number(document.querySelector<HTMLInputElement>('#web-user-quota')!.value) }); document.querySelector<HTMLInputElement>('#web-user-password')!.value = ''; document.querySelector('#web-new-token')!.textContent = `کاربر ${result.name} ساخته شد.`; await refreshWebsite(); } catch (error) { toast(String(error), true); } };
  for (const [id, key] of [['hide-recent', 'nocturne-hide-recent'], ['hide-compare', 'nocturne-hide-compare'], ['hide-gallery', 'nocturne-hide-gallery']]) {
    document.querySelector<HTMLInputElement>(`#${id}`)!.onchange = event => { const checked = (event.target as HTMLInputElement).checked; localStorage.setItem(key, checked ? '1' : '0'); if (id === 'hide-recent') hideRecent = checked; else if (id === 'hide-compare') hideCompare = checked; else hideGallery = checked; applyPrivacy(); };
  }
  document.querySelector<HTMLButtonElement>('#privacy-cover-button')!.onclick = () => { privacyCover = !privacyCover; applyPrivacy(); };
  document.querySelector<HTMLButtonElement>('#resume-download')!.onclick = () => { const saved = localStorage.getItem('nocturne-pending-download'); if (!saved) return toast('دانلود ناتمامی ثبت نشده است.', true); try { const { id, kind } = JSON.parse(saved); void downloadModel(id, kind); } catch { toast('اطلاعات دانلود ناتمام معتبر نیست.', true); } };
  document.querySelector<HTMLButtonElement>('#compare-start')!.onclick = () => void compareModels();
  document.querySelector<HTMLInputElement>('#gallery-query')!.oninput = event => {
    galleryQuery = (event.target as HTMLInputElement).value.trim();
    renderGallery();
  };
  document.querySelector<HTMLInputElement>('#gallery-from')!.onchange = event => { galleryFrom = (event.target as HTMLInputElement).value; renderGallery(); };
  document.querySelector<HTMLInputElement>('#gallery-to')!.onchange = event => { galleryTo = (event.target as HTMLInputElement).value; renderGallery(); };
  document.querySelector<HTMLButtonElement>('#gallery-set-pin')!.onclick = async () => {
    const stored = localStorage.getItem('nocturne-gallery-pin');
    const pin = window.prompt(stored ? 'رمز فعلی را برای برداشتن قفل وارد کن:' : 'یک رمز حداقل چهار نویسه‌ای برای قفل گالری تعیین کن:');
    if (!pin) return;
    if (stored) {
      const [salt, hash] = stored.split(':');
      if (await hashPin(pin, salt) !== hash) return toast('رمز اشتباه است.', true);
      localStorage.removeItem('nocturne-gallery-pin');
      galleryLocked = false;
      toast('قفل گالری برداشته شد.');
    } else {
      if (pin.length < 4) return toast('رمز باید حداقل چهار نویسه باشد.', true);
      const salt = crypto.randomUUID();
      localStorage.setItem('nocturne-gallery-pin', salt + ':' + await hashPin(pin, salt));
      galleryLocked = true;
      toast('گالری قفل شد.');
      if (document.querySelector('#gallery-view.active')) setView('studio');
    }
    renderGallery();
  };
  document.querySelector<HTMLButtonElement>('#gallery-unlock')!.onclick = async () => { const value = document.querySelector<HTMLInputElement>('#gallery-pin-input')!.value; const [salt, hash] = (localStorage.getItem('nocturne-gallery-pin') || '').split(':'); if (salt && await hashPin(value, salt) === hash) { galleryLocked = false; document.querySelector('#gallery-lock')!.classList.add('hidden'); renderGallery(); setView('gallery'); } else document.querySelector('#gallery-lock-error')!.textContent = 'رمز اشتباه است.'; };
  document.querySelector<HTMLButtonElement>('#gallery-lock-close')!.onclick = () => document.querySelector('#gallery-lock')!.classList.add('hidden');
  document.querySelector<HTMLSelectElement>('#theme-select')!.onchange = event => {
    const selected = (event.currentTarget as HTMLSelectElement).value;
    applyTheme(selected);
    localStorage.setItem('nocturne-theme', selected);
  };
  document.querySelector<HTMLSelectElement>('#language-select')!.onchange = event => { language = (event.target as HTMLSelectElement).value; localStorage.setItem('nocturne-language', language); applyLanguage(); };
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(el => el.onclick = () => setView(el.dataset.view!));
  document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(el => el.onclick = () => {
    modelKind = el.dataset.kind!;
    document.querySelectorAll('.kind-tab').forEach(tab => tab.classList.toggle('active', (tab as HTMLElement).dataset.kind === modelKind));
    document.querySelector('#search-note')!.textContent = 'جست‌وجو همهٔ نتیجه‌ها را نشان می‌دهد؛ فقط قالب‌های قابل اجرای برنامه دکمهٔ دانلود فعال دارند.';
    searchResults = [];
    document.querySelector('#search-results')!.innerHTML = '<div class="search-placeholder">برای دیدن مدل‌ها، جست‌وجو کن.</div>';
    renderModels();
  });
  document.querySelector<HTMLButtonElement>('#model-pill')!.onclick = () => { setView('models'); document.querySelector<HTMLButtonElement>('[data-library-kind="image"]')!.click(); document.querySelector<HTMLButtonElement>('[data-library-scope="installed"]')!.click(); };
  document.querySelector<HTMLButtonElement>('#video-model-pill')!.onclick = () => { setView('models'); document.querySelector<HTMLButtonElement>('[data-library-kind="video"]')!.click(); document.querySelector<HTMLButtonElement>('[data-library-scope="installed"]')!.click(); };
  document.querySelector<HTMLButtonElement>('#generate')!.onclick = generate;
  document.querySelector<HTMLButtonElement>('#start-batch')!.onclick = startBatch;
  document.querySelector<HTMLButtonElement>('#queue-add')!.onclick = () => { if (queueRunning || batchRunning) return;
    queueJobs.push({ model_id: activeModel && ['image', 'checkpoint', 'sdcpp'].includes(activeKind) ? activeModel : '',
      count: 20, prompt: '', aspect_ratio: document.querySelector<HTMLSelectElement>('#image-aspect')!.value, variations: false });
    queueRowDone = [];
    saveQueueDraft();
    renderQueue();
    document.querySelector<HTMLTextAreaElement>('[data-queue-prompt="' + (queueJobs.length - 1) + '"]')!.focus(); };
  document.querySelector<HTMLButtonElement>('#queue-start')!.onclick = () => void startQueue();
  document.querySelector<HTMLButtonElement>('#queue-stop')!.onclick = stopQueue;
  document.querySelector<HTMLButtonElement>('#stop-batch')!.onclick = stopBatch;
  document.querySelector<HTMLButtonElement>('#shuffle-ideas')!.onclick = () => { ideaOffset = (ideaOffset + 6) % ideas.length; renderIdeas(); };
  document.querySelector<HTMLButtonElement>('#choose-model-folder')!.onclick = chooseModelFolder;
  document.querySelector<HTMLButtonElement>('#choose-output-folder')!.onclick = chooseOutputFolder;
  document.querySelector<HTMLButtonElement>('#refresh-storage')!.onclick = refreshStorage;
  document.querySelector<HTMLButtonElement>('#snake-restart')!.onclick = startSnake;
  document.querySelectorAll<HTMLButtonElement>('[data-snake-dir]').forEach(button => button.onclick = () => setSnakeDirection(button.dataset.snakeDir!));
  document.querySelector<HTMLButtonElement>('#generate-video')!.onclick = generateVideo;
  document.querySelector<HTMLButtonElement>('#voice-change-folder')!.onclick = chooseModelFolder;
  document.querySelector<HTMLButtonElement>('#voice-model-tab')!.onclick = () => setView('voice');
  document.querySelector<HTMLButtonElement>('#refresh-installed-voices')!.onclick = () => void refreshInstalledVoices();
  document.querySelector<HTMLButtonElement>('#voice-search-button')!.onclick = () => void searchVoices();
  document.querySelector<HTMLButtonElement>('#persian-voice-search')!.onclick = () => { document.querySelector<HTMLInputElement>('#voice-search-input')!.value = 'فارسی'; void searchVoices(); };
  document.querySelector<HTMLButtonElement>('#popular-voice-search')!.onclick = () => { document.querySelector<HTMLInputElement>('#voice-search-input')!.value = ''; void searchVoices(); };
  document.querySelector<HTMLButtonElement>('#voice-generate')!.onclick = () => void generateVoice();
  document.querySelector<HTMLSelectElement>('#device-select')!.onchange = event => changeDevice((event.target as HTMLSelectElement).value);
  document.querySelector<HTMLInputElement>('#keep-models-loaded')!.onchange = async event => {
    const checkbox = event.target as HTMLInputElement;
    if (busy) { checkbox.checked = keepLoaded; return; }
    setBusy(true, 'در حال تنظیم حافظهٔ مدل‌ها...');
    try {
      const result = await call<{ enabled: boolean; loaded_models: LoadedModel[] }>('cache_mode', { enabled: checkbox.checked });
      keepLoaded = result.enabled;
      loadedModels = result.loaded_models;
      localStorage.setItem('nocturne-keep-models-loaded', keepLoaded ? '1' : '0');
      renderModels();
    } catch (error) { checkbox.checked = keepLoaded; toast(String(error), true); }
    finally { setBusy(false); }
  };
  document.querySelector<HTMLSelectElement>('#startup-model')!.onchange = event => {
    startupModel = (event.target as HTMLSelectElement).value;
    localStorage.setItem('nocturne-startup-model', startupModel);
  };
  document.querySelector<HTMLButtonElement>('#search-button')!.onclick = () => { void searchModels(); };
  document.querySelector<HTMLButtonElement>('#update-engine')!.onclick = () => void updateEngine();
  document.querySelectorAll<HTMLButtonElement>('[data-search-family]').forEach(button => button.onclick = () => {
    const kind = button.dataset.searchKind!;
    if (modelKind !== kind) document.querySelector<HTMLButtonElement>(`.kind-tab[data-kind="${kind}"]`)!.click();
    document.querySelector<HTMLInputElement>('#search-input')!.value = button.dataset.searchFamily!;
    void searchModels();
  });
  document.querySelector<HTMLButtonElement>('#uncensored-search')!.onclick = () => {
    modelKind = 'image';
    document.querySelectorAll('.kind-tab').forEach(tab => tab.classList.toggle('active', (tab as HTMLElement).dataset.kind === 'image'));
    document.querySelector<HTMLInputElement>('#search-input')!.value = 'uncensored';
    renderModels();
    void searchModels(true);
  };
  document.querySelector<HTMLButtonElement>('#featured-gguf')!.onclick = () => {
    modelKind = 'image';
    document.querySelectorAll('.kind-tab').forEach(tab => tab.classList.toggle('active', (tab as HTMLElement).dataset.kind === 'image'));
    renderModels();
    if (sdcppModels.includes(featuredGGUF)) void loadModel(featuredGGUF, 'sdcpp');
    else void downloadModel(featuredGGUF, 'sdcpp');
  };
  document.querySelector<HTMLButtonElement>('#featured-animagine')!.onclick = () => {
    modelKind = 'image';
    document.querySelectorAll('.kind-tab').forEach(tab => tab.classList.toggle('active', (tab as HTMLElement).dataset.kind === 'image'));
    renderModels();
    if (models.includes(featuredAnimagine)) void loadModel(featuredAnimagine);
    else void downloadModel(featuredAnimagine, 'image');
  };
  document.querySelector<HTMLButtonElement>('#flux-gguf-search')!.onclick = () => {
    setView('models');
    document.querySelector<HTMLButtonElement>('[data-library-kind="image"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-library-scope="find"]')!.click();
    document.querySelector<HTMLInputElement>('#library-query')!.value = 'FLUX.1 gguf';
    document.querySelector<HTMLButtonElement>('#library-search-button')!.click();
  };
  document.querySelector<HTMLButtonElement>('#featured-qwen-lora')!.onclick = () => {
    if (!adapters.includes(featuredQwenLora)) void downloadModel(featuredQwenLora, 'adapter');
  };
  document.querySelector<HTMLButtonElement>('#cancel-download')!.onclick = cancelDownload;
  document.querySelector<HTMLInputElement>('#search-input')!.onkeydown = event => { if (event.key === 'Enter') searchModels(); };
  document.querySelector<HTMLButtonElement>('#favorites-filter')!.onclick = () => { showFavoritesOnly = !showFavoritesOnly; document.querySelector('#favorites-filter')!.textContent = showFavoritesOnly ? '★ نمایش همه' : '☆ فقط علاقه‌مندی‌ها'; renderModels(); renderSearch(); };
  document.querySelector<HTMLButtonElement>('#refresh-models')!.onclick = async () => { const data = await call<{ models: string[]; video_models: string[]; sdcpp_models: string[]; checkpoint_models: string[]; adapters: string[]; loaded_models: LoadedModel[] }>('models'); models = data.models; videoModels = data.video_models; sdcppModels = data.sdcpp_models;
    checkpointModels = data.checkpoint_models; adapters = data.adapters; loadedModels = data.loaded_models; renderModels(); };
  document.querySelector<HTMLInputElement>('#gallery-details-toggle')!.onchange = event => { showGalleryDetails = (event.target as HTMLInputElement).checked; localStorage.setItem('nocturne-gallery-details', showGalleryDetails ? '1' : '0'); renderGallery(); };
  document.querySelector<HTMLInputElement>('#temporary-image')!.onchange = event => { temporaryImage = (event.target as HTMLInputElement).checked; localStorage.setItem('nocturne-temporary-image', temporaryImage ? '1' : '0'); };
  document.querySelector<HTMLInputElement>('#hide-image')!.onchange = event => {
    hideImage = (event.target as HTMLInputElement).checked;
    localStorage.setItem('nocturne-hide-image', hideImage ? '1' : '0');
    applyPrivacy();
    renderStudioPreview();
  };
  document.querySelector<HTMLSelectElement>('#gallery-model-filter')!.onchange = event => { galleryModelFilter = (event.target as HTMLSelectElement).value; renderGallery(); };
  document.querySelector<HTMLButtonElement>('#save-image')!.onclick = async () => { if (!currentImage) return; if (currentImageTemporary) { try { await call('save_temporary_image', { name: currentImageName }); currentImageTemporary = false; renderStudioPreview(); gallery = await call<GalleryItem[]>('gallery'); renderGallery(); toast('عکس در پوشهٔ خروجی ذخیره شد.'); } catch (error) { toast(String(error), true); } } else { const a = document.createElement('a'); a.href = currentImage; a.download = currentImageName; a.click(); } };
  document.querySelector<HTMLButtonElement>('#viewer-reuse-prompt')!.onclick = () => void reuseImage();
  document.querySelector<HTMLButtonElement>('#viewer-zoom-in')!.onclick = () => { viewerZoom = Math.min(4, viewerZoom + .25); document.querySelector<HTMLImageElement>('#modal-image')!.style.transform = `scale(${viewerZoom})`; };
  document.querySelector<HTMLButtonElement>('#viewer-zoom-out')!.onclick = () => { viewerZoom = Math.max(.5, viewerZoom - .25); document.querySelector<HTMLImageElement>('#modal-image')!.style.transform = `scale(${viewerZoom})`; };
  document.querySelector<HTMLButtonElement>('#viewer-save')!.onclick = () => { const image = document.querySelector<HTMLImageElement>('#modal-image')!; const a = document.createElement('a'); a.href = image.src; a.download = document.querySelector('#modal-caption')!.textContent || 'nocturne.png'; a.click(); };
  document.querySelector<HTMLButtonElement>('#close-modal')!.onclick = () => document.querySelector('#viewer-modal')!.classList.add('hidden');
  document.querySelector('#viewer-modal')!.addEventListener('click', event => { if (event.target === event.currentTarget) (event.currentTarget as HTMLElement).classList.add('hidden'); });
  window.addEventListener('keydown', event => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'h') { event.preventDefault(); privacyCover = !privacyCover; applyPrivacy(); return; }
    if (snakeTimer !== null && document.querySelector('#batch-view')?.classList.contains('active') && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
      const direction = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' } as Record<string, string>)[event.key];
      if (direction) { event.preventDefault(); setSnakeDirection(direction); }
    }
    if (event.key === 'Escape') document.querySelector('#viewer-modal')?.classList.add('hidden'); if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && document.querySelector('#studio-view')?.classList.contains('active')
      && document.querySelector('#viewer-modal')?.classList.contains('hidden')
      && !(event.target instanceof Element && event.target.closest('#prompt-presets'))) {
      event.preventDefault();
      if (studioMode === 'edit') void editImage();
      else if (studioMode === 'compare') void compareModels();
      else void generate();
    }
   });
}

type SetupStatus = { ready: boolean; python: boolean; python_path?: string; missing: string[] };

async function ensureSetup(): Promise<void> {
  const status = await invoke<SetupStatus>('setup_status');
  if (status.ready) return;
  const overlay = document.querySelector<HTMLElement>('#setup-overlay')!;
  const message = document.querySelector<HTMLElement>('#setup-message')!;
  const retry = document.querySelector<HTMLButtonElement>('#setup-retry')!;
  overlay.classList.remove('hidden');
  document.querySelector('#setup-python')!.textContent = status.python ? '✓ Python 3.13 نصب است' : '• Python 3.13 نصب نیست';
  document.querySelector('#setup-packages')!.textContent = `${status.missing.length.toLocaleString('fa-IR')} بستهٔ لازم باید نصب شود`;
  await new Promise<void>(resolve => {
    const run = async () => {
      retry.hidden = true;
      retry.disabled = true;
      message.textContent = 'در حال آماده‌سازی... این مرحله ممکن است چند دقیقه طول بکشد.';
      try {
        await invoke('setup_install');
        overlay.classList.add('hidden');
        resolve();
      } catch (error) {
        message.textContent = String(error);
        retry.hidden = false;
        retry.disabled = false;
      }
    };
    retry.onclick = run;
    void run();
  });
}

async function boot() {
  const initialPage = startPage();
  render();
  if (initialPage === 'home') setView('home');
  await listen<{ message: string }>('setup-progress', event => { const el = document.querySelector('#setup-message'); if (el) el.textContent = event.payload.message; });
  await listen<DownloadProgress>('download-progress', event => updateDownloadProgress(event.payload));
  await listen<{ phase: string; row: number; model_id: string; row_completed: number; row_total: number; completed: number; total: number; name?: string }>('queue-progress', event => {
    if (!queueRunning) return;
    const p = event.payload;
    queueRowDone[p.row] = p.row_completed;
    const percent = p.total ? Math.round(p.completed / p.total * 100) : 0;
    document.querySelector('#queue-state')!.textContent = p.phase === 'loading' ? `Loading job ${p.row + 1} · ${p.model_id}` : `Job ${p.row + 1} · ${p.model_id}`;
    document.querySelector('#queue-percent')!.textContent = `${percent}%`;
    document.querySelector<HTMLElement>('#queue-fill')!.style.width = `${percent}%`;
    document.querySelector('#queue-details')!.textContent = `${p.completed.toLocaleString('en-US')} / ${p.total.toLocaleString('en-US')} images · Current job: ${p.row_completed} / ${p.row_total}`;
    const jobStatus = document.querySelector<HTMLElement>('[data-queue-progress="' + p.row + '"]');
    if (jobStatus) jobStatus.textContent = `${p.row_completed} / ${p.row_total} images`;
    document.querySelectorAll<HTMLElement>('.queue-job').forEach((job, index) => {
      job.classList.toggle('queue-job-active', index === p.row);
      job.classList.toggle('queue-job-complete', (queueRowDone[index] || 0) >= (queueJobs[index]?.count || Infinity));
    });
  });
  await listen<{ completed: number; total: number; name: string; device: string }>('batch-progress', event => {
    if (event.payload.device === 'cpu') batchCpuDone++; else batchGpuDone++;
    document.querySelector<HTMLElement>('#batch-workers')!.textContent = `GPU: ${batchGpuDone.toLocaleString('fa-IR')} · CPU: ${batchCpuDone.toLocaleString('fa-IR')}`;
    showBatchProgress(event.payload.completed, event.payload.total, event.payload.name);
    document.querySelector('#batch-state')!.textContent = event.payload.completed < event.payload.total ? `Generating image ${event.payload.completed + 1} / ${event.payload.total}` : 'Finishing the batch…';
  });
  try {
    await ensureSetup();
    const [status, images, savedVideos] = await Promise.all([call<Status>('status'), call<GalleryItem[]>('gallery'), call<{name:string; date:string}[]>('video_gallery')]);
    models = status.models;
    videoModels = status.video_models;
    sdcppModels = status.sdcpp_models;
    checkpointModels = status.checkpoint_models;
    adapters = status.adapters;
    loadedModels = status.loaded_models;
    const cacheState = await call<{ enabled: boolean; loaded_models: LoadedModel[] }>('cache_mode', { enabled: keepLoaded });
    loadedModels = cacheState.loaded_models;
    videos = savedVideos;
    await refreshInstalledVoices();
    try { voices = await call('tts_gallery'); } catch { voices = []; }
    renderVoices();
    gallery = images;
    modelFolder = status.model_folder;
    document.querySelector('#voice-folder')!.textContent = "پوشهٔ دانلود: " + modelFolder;
    outputFolder = status.output_folder;
    document.querySelector('#output-folder')!.textContent = outputFolder;
    document.querySelector('#model-folder')!.textContent = modelFolder;
    devices = status.devices;
    selectedDevice = status.device;
    const deviceSelect = document.querySelector<HTMLSelectElement>('#device-select')!;
    deviceSelect.innerHTML = devices.map(item => `<option value="${safe(item.id)}">${safe(item.name)}</option>`).join('');
    deviceSelect.value = selectedDevice;
    document.querySelector('#gpu-name')!.textContent = devices.find(item => item.id === selectedDevice)?.name || selectedDevice;
    void refreshHardware();
    if (hardwarePoll !== null) window.clearInterval(hardwarePoll);
    hardwarePoll = window.setInterval(() => { void refreshHardware(); }, 3500);
    renderModels();
    renderQueue();
    renderGallery();
    renderVideos();
    await refreshStorage();
    await refreshReferences();
    if (startupModel) {
      const separator = startupModel.indexOf(':');
      const kind = startupModel.slice(0, separator);
      const id = startupModel.slice(separator + 1);
      if ((kind === 'image' && models.includes(id)) || (kind === 'video' && videoModels.includes(id)) || (kind === 'sdcpp' && sdcppModels.includes(id)) || (kind === 'checkpoint' && checkpointModels.includes(id))) {
        modelKind = kind === 'sdcpp' || kind === 'checkpoint' ? 'image' : kind;
        document.querySelectorAll('.kind-tab').forEach(tab => tab.classList.toggle('active', (tab as HTMLElement).dataset.kind === modelKind));
        renderModels();
        await loadModel(id, kind, false);
      } else { setBusy(false); toast('مدل انتخاب‌شده برای شروع پیدا نشد. از بخش مدل‌ها مدل دیگری انتخاب کن.', true); }
    } else setBusy(false);
    if (navigationRevision === 0 && initialPage !== 'studio') openWorkspace(initialPage);
  } catch (error) { setBusy(false); toast(String(error), true); }
}

boot();
