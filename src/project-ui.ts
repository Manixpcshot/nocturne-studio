export const projectBar = `
  <div class="project-bar">
    <select id="project-select" aria-label="پروژه"></select>
    <button id="project-create" class="small-button" type="button" data-work aria-label="پروژهٔ جدید" title="پروژهٔ جدید">＋</button>
  </div>`;

export const projectDialog = `
  <dialog id="project-dialog" class="work-dialog" aria-labelledby="project-title">
    <form method="dialog">
      <h2 id="project-title">پروژهٔ جدید</h2>
      <label>نام پروژه<input id="project-name" required maxlength="70" dir="auto" autofocus/></label>
      <footer><button class="small-button" value="cancel" formnovalidate>لغو</button>
        <button class="primary-button" value="create">ساخت پروژه</button></footer>
    </form>
  </dialog>`;

export const queueTools = `
  <div class="queue-tools">
    <button type="button" class="small-button" id="matrix-open" data-work>ترکیب پرامپت و مدل</button>
    <div class="pending-queue" id="pending-queue" hidden>
      <span>یک صف برای ادامه ذخیره شده است.</span>
      <button type="button" class="primary-button" id="queue-resume" data-work>ادامهٔ صف</button>
      <button type="button" class="small-button" id="queue-discard" data-work>کنارگذاشتن صف</button>
    </div>
  </div>`;

export const matrixDialog = `
  <dialog id="matrix-dialog" class="work-dialog matrix-dialog" aria-labelledby="matrix-title">
    <form id="matrix-form">
      <h2 id="matrix-title">ترکیب پرامپت و مدل</h2>
      <label>هر پرامپت در یک خط<textarea id="matrix-prompts" required rows="3" dir="auto"></textarea></label>
      <div class="matrix-fields">
        <fieldset><legend>مدل‌ها</legend><div id="matrix-models"></div></fieldset>
        <fieldset><legend>نسبت‌های تصویر</legend><div id="matrix-ratios" class="matrix-ratios"></div></fieldset>
        <label>تعداد برای هر ترکیب<input id="matrix-count" type="number" value="1" min="1" step="1" required/></label>
      </div>
      <div id="matrix-preview" aria-live="polite"></div>
      <footer>
        <button type="button" class="small-button" id="matrix-close">بستن</button>
        <button type="submit" class="small-button">پیش‌نمایش ترکیب‌ها</button>
        <button type="button" class="primary-button" id="matrix-append" disabled>افزودن به صف</button>
      </footer>
    </form>
  </dialog>`;
