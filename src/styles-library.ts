import './styles-library.css';

export const imageStyles = [
  ['انیمهٔ دست‌کشیده', 'Hand-drawn anime', '1:1', 'Hand-drawn anime illustration, crisp ink outlines, expressive eyes, painted cherry blossom backdrop, luminous cel shading'],
  ['پشمی و نمدی', 'Needle felt', '1:1', 'Needle-felted wool craft, visible fluffy fibers, hand-stitched details, tiny moss diorama, warm window light, macro photography'],
  ['عکاسی واقعی', 'Photorealism', '3:2', 'Photorealistic wildlife photography, natural fur detail, misty dawn clearing, realistic colors, shallow depth of field, telephoto lens'],
  ['نئون دههٔ ۱۹۸۰', '1980s synthwave', '16:9', '1980s synthwave cover art, magenta neon horizon, violet grid floor, amber sunset disc, subtle analog film grain'],
  ['آبرنگ', 'Watercolor', '3:4', 'Traditional watercolor on cold-pressed paper, delicate washes, wet-on-wet pigment edges, generous negative space'],
  ['سینمایی', 'Cinematic', '16:9', 'Cinematic widescreen film still, blue twilight forest, warm amber rim light, volumetric haze, restrained contrast, fine film grain'],
  ['انیمیشن خمیری', 'Clay animation', '4:3', 'Handmade clay animation miniature, sculpted matte plasticine, subtle finger marks, terracotta scenery, playful lighting'],
  ['پیکسل‌آرت ۱۶ بیتی', '16-bit pixel art', '4:3', '16-bit pixel art, clean square pixels, limited emerald and amber palette, tiled woodland, crisp sprite silhouette'],
  ['مانگای مرکبی', 'Ink manga', '3:4', 'Black-and-white ink manga illustration, bamboo forest, thick and fine line weights, screentone shadows, stark monochrome'],
  ['سه‌بعدی استودیویی', 'Studio 3D', '1:1', 'Stylized 3D character render, rounded soft-toy proportions, seamless cobalt studio backdrop, area lighting, soft contact shadows'],
] as const;

export function mountStyleLibrary(
  parent: HTMLElement,
  trigger: HTMLButtonElement,
  isEnglish: () => boolean,
  apply: (prompt: string, ratio: string) => void,
) {
  const dialog = document.createElement('dialog');
  dialog.id = 'style-library';
  dialog.className = 'style-library';
  dialog.setAttribute('aria-labelledby', 'style-library-title');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', dialog.id);
  dialog.innerHTML = `
    <header class="style-header">
      <h2 id="style-library-title"></h2>
      <button type="button" class="small-button style-close" autofocus>×</button>
    </header>
    <div class="style-grid" id="style-grid">${imageStyles.map(([, , ratio], index) => `
      <button type="button" class="style-card" data-image-style="${index}" aria-pressed="false">
        <span class="style-art" aria-hidden="true" style="--tile-x:${index % 5 * 25}%;--tile-y:${Math.floor(index / 5) * 100}%"></span>
        <span class="style-card-label"><strong></strong><bdi>${ratio}</bdi></span>
      </button>`).join('')}</div>
    <form class="style-controls">
      <label for="style-subject"></label>
      <input id="style-subject" dir="auto" maxlength="800" autocomplete="off">
      <p class="style-preview" dir="ltr" aria-live="polite"></p>
      <button type="submit" class="primary-button style-apply"></button>
    </form>`;
  parent.append(dialog);

  const cards = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.style-card'));
  const close = dialog.querySelector<HTMLButtonElement>('.style-close')!;
  const subject = dialog.querySelector<HTMLInputElement>('#style-subject')!;
  const preview = dialog.querySelector<HTMLElement>('.style-preview')!;
  let selected = 0;
  const prompt = () => `${subject.value.trim() || 'An orange fox'}. ${imageStyles[selected][3]}.`;
  const updatePreview = () => { preview.textContent = prompt(); };
  cards.forEach((card, index) => card.onclick = () => {
    cards[selected].setAttribute('aria-pressed', 'false');
    selected = index;
    card.setAttribute('aria-pressed', 'true');
    updatePreview();
  });
  cards[0].setAttribute('aria-pressed', 'true');
  subject.oninput = updatePreview;
  close.onclick = () => dialog.close();
  trigger.onclick = () => { if (!dialog.open) dialog.showModal(); };
  dialog.querySelector('form')!.onsubmit = event => {
    event.preventDefault();
    dialog.close();
    apply(prompt(), imageStyles[selected][2]);
  };
  updatePreview();

  return () => {
    const en = isEnglish();
    dialog.querySelector('h2')!.textContent = en ? 'Style examples' : 'نمونه‌های سبک';
    close.setAttribute('aria-label', en ? 'Close style examples' : 'بستن نمونه‌های سبک');
    dialog.querySelector('label')!.textContent = en ? 'Subject' : 'سوژه';
    subject.placeholder = en ? 'Optional · example: an orange fox' : 'اختیاری، مثلاً یک روباه نارنجی';
    dialog.querySelector('.style-apply')!.textContent = en ? 'Replace prompt and set size' : 'جایگزینی پرامپت و تنظیم اندازه';
    cards.forEach((card, index) => { card.querySelector('strong')!.textContent = imageStyles[index][en ? 1 : 0]; });
  };
}
