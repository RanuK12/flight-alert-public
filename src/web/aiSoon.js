'use strict';
/** "Pro con IA" (ya disponible). Se oculta con SHOW_AI_SOON=false. */
function enabled() { return String(process.env.SHOW_AI_SOON || 'true').toLowerCase() !== 'false'; }
function text(lang) {
  return lang === 'en'
    ? 'Pro with AI: search the way you talk'
    : 'Pro con IA: buscá escribiendo como hablás';
}
function li(lang) { return enabled() ? `<li class="ai-soon">✨ ${text(lang)}</li>` : ''; }
module.exports = { enabled, text, li };
