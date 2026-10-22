'use strict';
/** "Pro con IA · muy pronto". Quitar con SHOW_AI_SOON=false cuando la IA salga. */
function enabled() { return String(process.env.SHOW_AI_SOON || 'true').toLowerCase() !== 'false'; }
function text(lang) {
  return lang === 'en'
    ? 'Pro with AI · coming soon: search the way you talk'
    : 'Pro con IA · muy pronto: buscá escribiendo como hablás';
}
function li(lang) { return enabled() ? `<li class="ai-soon">✨ ${text(lang)}</li>` : ''; }
module.exports = { enabled, text, li };
