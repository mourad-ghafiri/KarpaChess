/** Selector + tiny DOM helpers. No framework — just the bits every view needs. */

export const $  = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

/** A very small Markdown subset: **bold**, *italic*, `code`, and newlines → <br>. */
export function markdownLite(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

/**
 * Downscale an uploaded image file to a JPEG data URL whose longest side is
 * `maxSide` px. Used for player photos so localStorage doesn't balloon.
 */
export async function imageFileToDataUrl(file, maxSide = 192) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  try { await img.decode(); }
  catch { URL.revokeObjectURL(img.src); throw new Error('Invalid image'); }
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(img.src);
  return c.toDataURL('image/jpeg', 0.82);
}
