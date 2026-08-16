const ALLOWED_DESCRIPTION_TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'H3', 'A']);

export function descriptionLooksLikeHtml(value: string): boolean {
  return /<\/?(p|br|strong|b|em|i|ul|ol|li|h3|a)\b/i.test(value || '');
}

export function descriptionToEditorHtml(value: string): string {
  if (!value) return '';
  return descriptionLooksLikeHtml(value) ? sanitizeDescriptionHtml(value) : plainDescriptionTextToHtml(value);
}

export function sanitizeDescriptionHtml(value: string): string {
  const doc = new DOMParser().parseFromString(value || '', 'text/html');
  doc.body.querySelectorAll('*').forEach((el) => {
    if (!ALLOWED_DESCRIPTION_TAGS.has(el.tagName)) {
      el.replaceWith(...Array.from(el.childNodes));
      return;
    }

    const originalHref = el.getAttribute('href') || '';
    Array.from(el.attributes).forEach((attr) => el.removeAttribute(attr.name));

    if (el.tagName === 'A') {
      const href = normalizeDescriptionLinkUrl(originalHref);
      if (href) {
        el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      } else {
        el.replaceWith(...Array.from(el.childNodes));
      }
    }
  });
  return emptyDescriptionHtmlToBlank(doc.body.innerHTML);
}

export function normalizeDescriptionLinkUrl(value: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

export function emptyDescriptionHtmlToBlank(value: string): string {
  const normalized = (value || '').replace(/<p><br><\/p>/gi, '').replace(/&nbsp;/gi, ' ').trim();
  return normalized && normalized !== '<br>' ? normalized : '';
}

function plainDescriptionTextToHtml(value: string): string {
  const escaped = escapeHtml(value.trim());
  if (!escaped) return '';
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
