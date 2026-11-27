/* Daily report for extensions, using the same report page and authenticated API. */
const idleDate = ms => new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo"}).format(ms);
const idleFilters = {from:idleDate(Date.now()-6*86400000),to:idleDate(Date.now()),extension:""};
let idleRequestId = 0;

function reportNavigation(idle) {
  return `<nav class="report-switch" aria-label="Tipo de relatório">
    <button type="button" data-report-view="calls" aria-pressed="${!idle}"><i data-lucide="phone-call"></i>Chamadas</button>
    <button type="button" data-report-view="idle" aria-pressed="${idle}"><i data-lucide="clock-3"></i>Ociosidade dos ramais</button>
  </nav>`;
}

function renderIdleReport() {
  if (pages.reports.querySelector("#idleReportForm")) return;
  pages.reports.innerHTML = `<div class="reports-shell">${reportNavigation(true)}
    <section class="panel idle-panel">
      <div class="panel-header"><div><h3>Tempo ocioso por ramal</h3>
      <p class="table-meta">Tempo online disponível para receber chamadas. Ligações, pausas e fichas abertas no Campanhas ficam fora da ociosidade.</p></div></div>
      <form id="idleReportForm" class="idle-filters">
        <label>De<input name="from" type="date" required value="${escapeHtml(idleFilters.from)}"></label>
        <label>Até<input name="to" type="date" required value="${escapeHtml(idleFilters.to)}"></label>
        <label>Ramal<select name="extension"><option value="">Todos os ramais</option>
          ${state.config.extensions.map(e=>option(String(e.number),idleFilters.extension,e.number+" · "+e.name)).join("")}</select></label>
        <button class="primary-btn" type="submit"><i data-lucide="search"></i>Consultar</button>
      </form>
    </section>
    <section id="idleReportResults" class="panel idle-panel" aria-live="polite"></section></div>`;
  const form = pages.reports.querySelector("#idleReportForm");
  form.onsubmit = event => {
    event.preventDefault();
    Object.assign(idleFilters,Object.fromEntries(new FormData(form)));
    void loadIdleReport();
  };
  void loadIdleReport();
}

function idleDuration(ms) {
  if (ms === null) return "—";
  const seconds = Math.round(ms/1000);
  if (seconds < 60) return seconds+" s";
  const minutes = Math.floor(seconds/60);
  return minutes < 60 ? minutes+" min" : Math.floor(minutes/60)+" h "+String(minutes%60).padStart(2,"0")+" min";
}

async function loadIdleReport() {
  const id = ++idleRequestId;
  const results = pages.reports.querySelector("#idleReportResults");
  results.dataset.ready = "false";
  results.textContent = "Consultando o período…";
  try {
    const data = await api("/api/pbx/reports/idle?"+new URLSearchParams(idleFilters));
    if (id !== idleRequestId || !results.isConnected) return;
    const dateLabel = day => day.split("-").reverse().join("/");
    const measured = data.agents.some(e=>e.daily.length);
    const rows = data.agents.map(e => {
      const daily = e.daily.map(d=>`<tr><td>${dateLabel(d.day)}</td><td>${idleDuration(d.onlineMs)}</td><td>${idleDuration(d.idleMs)}</td></tr>`).join("");
      return `<tr><td>${daily ? `<details><summary><strong>${escapeHtml(e.number)}</strong> · ${escapeHtml(e.name || "")}</summary>
          <table class="idle-daily" aria-label="Detalhe diário do ramal ${escapeHtml(e.number)}"><thead><tr><th>Dia</th><th>Online</th><th>Ocioso</th></tr></thead>
          <tbody>${daily}</tbody></table></details>` : `<strong>${escapeHtml(e.number)}</strong> · ${escapeHtml(e.name || "")}`}</td>
        <td>${e.daily.length ? e.daysOnline : "—"}</td><td>${idleDuration(daily ? e.onlineMs : null)}</td><td>${idleDuration(daily ? e.idleMs : null)}</td>
        <td><strong>${idleDuration(e.averageMs)}</strong></td><td>${e.percent === null ? "—" : `<span class="idle-share"><meter min="0" max="100" value="${e.percent}"></meter>${e.percent.toLocaleString("pt-BR")}%</span>`}</td></tr>`;
    }).join("");
    results.innerHTML = `<div class="panel-header"><div><h3>Resumo por ramal</h3>
      <p class="table-meta">Média diária = tempo ocioso dividido pelos dias em que o ramal esteve online. Selecione um ramal na tabela para ver cada dia.</p></div></div>
      ${measured ? `<div class="table-wrap"><table class="idle-summary"><thead><tr>
        <th>Ramal / atendente</th><th>Dias online</th><th>Tempo online</th><th>Tempo ocioso</th><th>Média por dia</th><th>% do tempo online</th>
        </tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty-state">Sem medições para este ramal ou período.</p>'}
      <p class="table-meta idle-footnote">${data.firstMs ? "Coleta iniciada em "+dateLabel(idleDate(data.firstMs))+". " : ""}Estimativa por amostras de 15 segundos. Intervalos sem medição ficam fora do cálculo.</p>`;
    results.dataset.ready = "true";
  } catch (error) {
    if (id === idleRequestId) results.textContent = error.message || "Não foi possível consultar a ociosidade.";
  }
}

