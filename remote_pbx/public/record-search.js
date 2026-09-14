(function (root) {
  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function matches(text, query) {
    const content = normalize(text);
    return normalize(query).split(' ').filter(Boolean).every(term => content.includes(term));
  }
  if (typeof module !== 'undefined') module.exports = { normalize, matches };
  if (!root.document) return;
  const queries = new Map();
  let owner = '';
  const labels = { extensions: 'ramais', queues: 'filas', trunk: 'troncos', routing: 'rotas', ivr: 'URAs', users: 'usu\u00e1rios', dialer: 'campanhas' };
  const selector = '.extension-grid, .trunk-grid, .entity-list-grid, .ivr-list-grid';
  function apply(grid, bar, query) {
    const cards = Array.from(grid.children).filter(node => node.matches('article, .entity-list-card, .trunk-list-card, .ivr-list-card, .dialer-campaign-card'));
    let count = 0;
    cards.forEach(card => {
      const found = matches(card.textContent, query);
      card.classList.toggle('record-search-hidden', !found);
      if (found) count += 1;
    });
    const status = bar.querySelector('[data-search-count]');
    status.textContent = `${count} de ${cards.length}`;
    const empty = bar.nextElementSibling;
    empty.hidden = !query.trim() || count > 0 || cards.length === 0;
    bar.querySelector('[data-search-clear]').disabled = !query;
  }
  root.installRecordSearch = function (username = '') {
    if (owner !== username) { queries.clear(); owner = username; }
    root.document.querySelectorAll(selector).forEach(grid => {
      const tab = grid.closest('.tab-page');
      const key = tab?.id.replace('tab-', '');
      if (!labels[key] || grid.closest('[data-entity-editor]')) return;
      let bar = grid.previousElementSibling?.previousElementSibling;
      if (!bar?.classList.contains('record-search')) {
        bar = root.document.createElement('form');
        bar.className = 'record-search';
        bar.setAttribute('role', 'search');
        bar.setAttribute('aria-label', `Pesquisar ${labels[key]}`);
        bar.innerHTML = `<input type="search" maxlength="120" autocomplete="off" aria-label="Pesquisar ${labels[key]}" placeholder="Pesquisar ${labels[key]}..." /><button type="submit" class="secondary-btn"><i data-lucide="search"></i>Pesquisar</button><button type="button" class="icon-btn" data-search-clear title="Limpar pesquisa" aria-label="Limpar pesquisa"><i data-lucide="x"></i></button><button type="button" class="help-icon" data-help="Pesquise pelo nome, n\u00famero ou informa\u00e7\u00f5es do cadastro. A pesquisa ignora acentos e mai\u00fasculas." aria-label="Sobre a pesquisa"><i data-lucide="info"></i></button><span data-search-count role="status" aria-live="polite"></span>`;
        const empty = root.document.createElement('p');
        empty.className = 'record-search-empty';
        empty.textContent = 'Nenhum cadastro encontrado.';
        empty.hidden = true;
        grid.before(bar, empty);
        const input = bar.querySelector('input');
        input.value = queries.get(key) || '';
        const filter = () => { queries.set(key, input.value); apply(grid, bar, input.value); };
        input.addEventListener('input', filter);
        bar.addEventListener('submit', event => { event.preventDefault(); event.stopPropagation(); filter(); });
        bar.querySelector('[data-search-clear]').addEventListener('click', () => { input.value = ''; filter(); input.focus(); });
      }
      apply(grid, bar, bar.querySelector('input').value);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
