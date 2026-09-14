(() => {
  const descriptions = {
    usuario: 'Nome usado para entrar no painel. Cada pessoa deve ter seu proprio acesso.',
    senha: 'Senha de acesso. Ela nao e exibida para outras pessoas.',
    novasenha: 'Preencha somente para substituir a senha atual. Deixe vazio para manter a senha existente.',
    confirmarsenha: 'Repita a nova senha para confirmar que foi digitada corretamente.',
    perfil: 'Administrador tem acesso completo. Os outros perfis usam as permissoes selecionadas abaixo.',
    ramal: 'Numero interno da pessoa ou telefone. Selecione o ramal relacionado a esta operacao.',
    ramaispermitidos: 'Limita os ramais que esta pessoa pode acompanhar. Separe os numeros por virgula.',
    departamentos: 'Departamentos relacionados a esta conta. Separe os nomes por virgula.',
    nome: 'Nome que aparece nas listas e ajuda a identificar este cadastro.',
    nomedousuario: 'Filtra os resultados pelo nome da pessoa associada a chamada.',
    numero: 'Numero de telefone ou ramal usado para localizar os registros desejados.',
    numerodigitado: 'Numero que deseja simular. A validacao mostra a rota utilizada sem fazer uma ligacao.',
    fila: 'Grupo de atendimento que distribui as chamadas entre seus agentes.',
    origem: 'Numero de quem iniciou a chamada.',
    destino: 'Pessoa, fila ou fluxo que deve receber a chamada.',
    direcao: 'Entrada: chamada recebida. Saida: chamada feita. Interna: chamada entre ramais.',
    tipo: 'Escolha a categoria dos registros que deseja consultar.',
    status: 'Resultado ou situacao da chamada. Deixe Todos para nao limitar a busca.',
    datainicial: 'Primeiro dia do periodo que deseja consultar.',
    datafinal: 'Ultimo dia do periodo que deseja consultar.',
    horainicial: 'Horario a partir do qual os registros devem ser considerados.',
    horafinal: 'Horario limite dos registros que deseja consultar.',
    duracaominima: 'Mostra chamadas com pelo menos esta duracao, em segundos. Vazio nao define um minimo.',
    duracaomaxima: 'Mostra chamadas com ate esta duracao, em segundos. Vazio nao define um limite.',
    gravacao: 'Escolha se deseja ver chamadas com audio gravado, sem audio ou todas.',
    pesquisar: 'Digite parte do nome, numero ou texto que deseja encontrar.',
    buscageral: 'Procura o texto informado nos dados dos registros.',
    buscarfilaouramal: 'Filtra a tela pelo nome da fila, nome da pessoa ou numero do ramal.',
    filtrarfila: 'Mostra somente os indicadores da fila selecionada. Todas as filas mostra o total.',
    filtrarramal: 'Mostra somente os indicadores do ramal selecionado. Todos os ramais mostra o total.',
    datadoresumo: 'Dia usado para calcular os indicadores do painel.',
    membros: 'Ramais que participam deste grupo. Separe os numeros por virgula.',
    agentes: 'Pessoas que recebem chamadas desta fila, identificadas pelos numeros dos ramais.',
    local: 'Permite fazer ligacoes para telefones locais.',
    celular: 'Permite fazer ligacoes para celulares.',
    ddd: 'Permite fazer ligacoes para numeros de outras cidades.',
    internacional: 'Permite chamadas para outros paises. Pode gerar custos adicionais na operadora.',
    especiais: 'Permite chamadas para numeros de servicos especiais conforme as rotas configuradas.',
    senhasfortes: 'Exige senhas com maior complexidade para proteger os acessos.',
    bloquearinternacional: 'Restringe chamadas internacionais por padrao.',
    firewall: 'Controla quais conexoes de rede podem chegar ao servidor.',
    fail2ban: 'Bloqueia temporariamente origens com repetidas tentativas de acesso indevido.',
    tls: 'Protege a sinalizacao das chamadas com criptografia quando os dispositivos suportam.',
    srtp: 'Protege o audio das chamadas com criptografia quando os dispositivos suportam.',
    escutargravacoes: 'Permite reproduzir gravacoes que estejam dentro do escopo de acesso desta pessoa.',
    baixargravacoes: 'Permite baixar os arquivos de audio das gravacoes autorizadas.',
    interviremchamadas: 'Permite usar sussurro e intervencao nas chamadas autorizadas.',
    trocarsenhanoproximologin: 'Solicita que esta pessoa escolha uma nova senha ao entrar novamente.',
    troncossip: 'Conexao com a operadora de telefonia usada pela chamada.',
    protocolo: 'Identificador do atendimento, usado para localizar uma chamada especifica.',
    uniqueid: 'Identificador tecnico exclusivo da chamada no Asterisk.',
    callerid: 'Identificacao apresentada pelo originador da chamada.',
    did: 'Numero externo que recebeu a chamada na operadora.',
    grupodepartamento: 'Limita a consulta ao grupo ou departamento selecionado.',
    menuura: 'Menu de atendimento automatico percorrido pelo cliente.',
    opcaoura: 'Tecla escolhida pelo cliente durante o atendimento automatico.',
    inicio: 'Horario em que esta regra comeca a valer.',
    fim: 'Horario em que esta regra deixa de valer.',
    dias: 'Dias da semana em que o horario deve ser aplicado.',
    arquivo: 'Selecione o arquivo que deseja enviar. Confira os formatos aceitos antes de salvar.',
    audio: 'Mensagem de voz que o cliente escuta durante o atendimento.',
    descricao: 'Observacao para ajudar a identificar o cadastro.',
    tecla: 'Digito que o cliente deve pressionar para escolher esta opcao.',
    ativo: 'Habilita ou desabilita este cadastro sem exclui-lo.'
  };
  const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const prepared = new WeakSet();
  let tooltip;
  let anchor;
  let pinned = false;

  function hideHelp() {
    if (anchor) { anchor.setAttribute('aria-expanded', 'false'); anchor.removeAttribute('aria-describedby'); }
    if (tooltip) tooltip.hidden = true;
    anchor = null;
    pinned = false;
  }

  function showHelp(button) {
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'fieldHelpTooltip';
      tooltip.className = 'field-help-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      document.body.append(tooltip);
    }
    hideHelp();
    anchor = button;
    tooltip.textContent = button.dataset.help;
    tooltip.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-describedby', tooltip.id);
    const rect = button.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    tooltip.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    tooltip.style.top = `${Math.max(12, rect.bottom + height + 16 < innerHeight ? rect.bottom + 8 : rect.top - height - 8)}px`;
  }

  window.installFieldHelp = (root = document) => {
    if (anchor && !anchor.isConnected) hideHelp();
    root.querySelectorAll('label').forEach(label => {
      if (prepared.has(label)) return;
      const control = label.querySelector('input:not([type="hidden"]), select, textarea');
      if (!control) return;
      prepared.add(label);
      const copy = label.cloneNode(true);
      copy.querySelectorAll('input,select,textarea,button,small').forEach(node => node.remove());
      const title = copy.textContent.trim().replace(/\s+/g, ' ') || control.getAttribute('aria-label') || control.placeholder || 'Campo';
      label.querySelectorAll('input:not([type="hidden"]),select,textarea').forEach(input => {
        if (!input.hasAttribute('aria-label')) input.setAttribute('aria-label', title);
      });
      if (label.querySelector('.help-icon')) return;
      const key = normalized(title);
      const menuPermission = control.hasAttribute('data-user-menu');
      const text = descriptions[key] || (menuPermission ? `Permite que esta pessoa acesse o menu ${title}.` :
        control.type === 'checkbox' ? `Marque para habilitar a opcao ${title.toLowerCase()}. Desmarque para desabilitar.` :
        control.type === 'file' ? descriptions.arquivo :
        control.type === 'date' ? 'Escolha a data para consultar os registros deste periodo.' :
        control.type === 'time' ? 'Escolha o horario utilizado por esta regra ou consulta.' :
        `Defina ${title.toLowerCase()} para este cadastro ou consulta.${control.required ? ' Este campo e obrigatorio.' : ''}`);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'help-icon';
      button.dataset.help = text;
      button.setAttribute('aria-label', `Sobre ${title}`);
      button.innerHTML = '<i data-lucide="info"></i>';
      if (label.matches('.command-filter-field, .command-search')) {
        label.append(button);
        return;
      }
      let heading = label.querySelector('.field-title, strong');
      if (!heading && control.type !== 'checkbox' && control.type !== 'radio') {
        heading = document.createElement('span');
        heading.className = 'field-title';
        Array.from(label.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => heading.append(node));
        if (!heading.textContent.trim()) heading.textContent = title;
        label.prepend(heading);
      }
      if (heading) heading.append(button);
      else label.append(button);
    });
    root.querySelectorAll('.help-icon').forEach(button => {
      if (!button.dataset.help) button.dataset.help = button.title || button.getAttribute('aria-label') || '';
      button.removeAttribute('title');
      if (!button.hasAttribute('aria-expanded')) button.setAttribute('aria-expanded', 'false');
    });
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('.help-icon');
    if (button) {
      event.preventDefault(); event.stopPropagation();
      if (anchor === button && pinned) hideHelp();
      else { showHelp(button); pinned = true; }
    }
    else hideHelp();
  }, true);
  document.addEventListener('mouseover', event => { const button = event.target.closest('.help-icon'); if (button && anchor !== button) showHelp(button); });
  document.addEventListener('mouseout', event => { if (anchor && !pinned && event.target.closest('.help-icon') === anchor && !anchor.contains(event.relatedTarget)) hideHelp(); });
  document.addEventListener('focusin', event => { if (event.target.matches('.help-icon')) showHelp(event.target); });
  document.addEventListener('focusout', event => { if (event.target === anchor) hideHelp(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideHelp(); });
  window.addEventListener('resize', hideHelp);
  window.addEventListener('scroll', hideHelp, true);
})();
