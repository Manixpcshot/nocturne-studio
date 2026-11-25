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

export function styleLibrary(en: boolean) {
  return imageStyles.map(([fa, label, ratio], index) => `<button type="button" class="style-card" data-image-style="${index}">
    <span class="style-art" aria-hidden="true" style="--tile-x:${index % 5 * 25}%;--tile-y:${Math.floor(index / 5) * 100}%"></span>
    <strong>${en ? label : fa}</strong><bdi>${ratio}</bdi></button>`).join('');
}

export function stylePrompt(index: number, subject: string) {
  const style = imageStyles[index];
  return style ? { ratio: style[2], text: `${subject.trim() || 'An orange fox'}. ${style[3]}.` } : null;
}
