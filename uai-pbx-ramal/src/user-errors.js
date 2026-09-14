(function (root) {
  const fallback = 'N\u00e3o foi poss\u00edvel concluir a opera\u00e7\u00e3o. Tente novamente. Se continuar, fale com o suporte.';
  const rules = [
    [/numero sem rota de saida/, 'N\u00famero sem rota de sa\u00edda para este ramal.'],
    [/(ramal|usuario) ou senha invalid|senha atual invalida/, 'Ramal ou senha incorretos. Confira os dados e tente novamente.'],
    [/ramal nao encontrado|ramal invalido/, 'Ramal n\u00e3o encontrado. Confira o n\u00famero informado.'],
    [/nao autenticado|entre com o ramal|sessao.*expir|unauthorized|\b401\b/, 'Entre novamente com seu ramal para continuar.'],
    [/encerre a ligacao.*pausa/, 'Encerre a liga\u00e7\u00e3o antes de colocar o ramal em pausa.'],
    [/nenhuma chamada ativa.*transfer/, 'N\u00e3o h\u00e1 uma chamada em andamento para transferir.'],
    [/informe.*(ramal ou fila|destino)/, 'Informe um ramal ou fila de destino v\u00e1lido, com at\u00e9 20 d\u00edgitos.'],
    [/informe o numero para ligar/, 'Informe o n\u00famero para ligar.'],
    [/somente numeros|apenas numeros/, 'Use apenas n\u00fameros, com no m\u00e1ximo 20 d\u00edgitos.'],
    [/ramal com 2 a 8/, 'Informe um ramal com 2 a 8 d\u00edgitos.'],
    [/senha.*160 caracteres/, 'A senha deve ter no m\u00e1ximo 160 caracteres.'],
    [/notallowederror|permission denied|permissao.*microfone/, 'Permita o acesso ao microfone para usar o telefone.'],
    [/notfounderror|devices? not found|microfone.*nao encontrado/, 'Nenhum microfone encontrado. Conecte um microfone e tente novamente.'],
    [/notreadableerror|could not start audio|device.*busy/, 'N\u00e3o foi poss\u00edvel acessar o microfone. Confira se outro aplicativo est\u00e1 usando o dispositivo.'],
    [/sem permissao|forbidden|\b403\b|canal fora/, 'Seu ramal n\u00e3o tem permiss\u00e3o para essa a\u00e7\u00e3o. Fale com o administrador.'],
    [/too many requests|\b429\b/, 'Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente.'],
    [/timeout|timed out|aborterror|tempo.*esgot/, 'O servidor demorou para responder. Aguarde um momento e tente novamente.'],
    [/fetch failed|failed to fetch|network|econn|enotfound|websocket|err_internet|err_name|err_connection/, 'N\u00e3o foi poss\u00edvel conectar ao servidor. Confira sua conex\u00e3o e tente novamente.'],
    [/nao foi possivel transferir/, 'N\u00e3o foi poss\u00edvel transferir a chamada. Confira o destino e tente novamente.'],
    [/nao foi possivel originar/, 'N\u00e3o foi poss\u00edvel iniciar a chamada. Tente novamente.'],
    [/comando indisponivel|service unavailable|\b503\b/, 'O servi\u00e7o de telefonia est\u00e1 indispon\u00edvel no momento. Tente novamente em instantes.']
  ];
  function message(error, safeFallback = fallback) {
    const raw = typeof error === 'string' ? error : `${error?.name || ''} ${error?.message || ''}`;
    const text = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return rules.find(([pattern]) => pattern.test(text))?.[1] || safeFallback;
  }
  const api = { message };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PhoneErrors = api;
})(typeof window !== 'undefined' ? window : globalThis);
