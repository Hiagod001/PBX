# Laboratório de ligações WhatsApp

Serviço gratuito em contêiner separado, integrado ao Discador do PBX, usando o projeto comunitário [whatsapp-rust](https://github.com/oxidezap/whatsapp-rust), versão 0.7.0 no commit `f8165f282008935732e0b26d6f5cca5038ecd222`. Não utiliza WaVoIP nem assinatura de provedor. O servidor e a conexão com a Internet continuam necessários.

## O que este primeiro laboratório faz

- Vincula uma conta pelo QR Code, com sessão SQLite persistente.
- Mostra o número realmente vinculado e exige correspondência com a conta autorizada.
- Faz uma ligação manual para um único destino configurado, com exclusão mútua e duração máxima.
- Consulta explicitamente o contato antes de ligar, solicitando a identificação usada pelo WhatsApp para preparar a chamada; não depende de uma conversa prévia ou do histórico sincronizado.
- Retorna a voz recebida para verificar os dois sentidos do áudio, sem tom periódico que possa ser confundido com outra chamada.
- Exibe contadores de quadros e guarda apenas os metadados do último teste.
- Protege o painel por chave de acesso, cookie HttpOnly, expiração e limite de tentativas.

O painel de laboratório mantém o teste manual de retorno da voz. As campanhas são iniciadas separadamente no Discador do PBX e usam a ponte de áudio descrita abaixo para atender em filas ou ramais, com a gravação configurada no PBX. A vinculação pelo QR Code não envia mensagens nem inicia ligações automaticamente.

Trata-se de uma implementação comunitária, sem suporte oficial do WhatsApp. Mudanças no protocolo podem exigir atualização. Use uma conta de laboratório separada; não trate este teste como capacidade de produção comprovada.

## Implantação

O Dockerfile compila com Rust 1.95 estável, sem o recurso SIMD experimental do upstream. As dependências são fixadas em `Cargo.lock`. O build executa os testes antes de gerar a imagem.

```sh
docker build -t uai-whatsapp-lab:0.1.0 .
```

Na VM Dokploy, os arquivos ficam em `/home/dokploy/whatsapp-lab`. Nesse servidor, `/etc/dokploy` é um bind do diretório `/home/dokploy`; o `env_file` usa o caminho visível dentro do contêiner do Dokploy.

Prepare `data` com proprietário `10001:10001` e modo `0700`. Crie uma chave aleatória com pelo menos 32 caracteres no arquivo `admin-secret`, proprietário `10001:10001`, modo `0400`. Não reutilize a senha administrativa da VM. Os arquivos de sessão e a chave não entram no Git.

Copie `.env.example` para `lab.env` na VM, ajustando `LAB_PHONE` e `TEST_DESTINATION` para os números autorizados, com `55` e DDD, apenas dígitos. Mantenha modo `0600`. A correspondência da conta é exata: não há inclusão automática do nono dígito.

Crie um projeto separado no Dokploy e um serviço Compose com o conteúdo de `compose.yaml`. A imagem é construída na própria VM; `pull_policy: never` impede buscar uma imagem homônima externa. A implantação só deve ocorrer depois do build bem-sucedido. O contêiner recebe limites de CPU, RAM e processos, logs com rotação, filesystem somente leitura e volume exclusivo.

## Acesso ao painel

A porta `3098` está vinculada apenas a `127.0.0.1` na VM. Não há domínio público nem abertura de firewall para o laboratório. Em um computador autorizado com Python e Paramiko, execute:

```powershell
python ops/tunnel.py
```

O script exige a chave SSH do servidor previamente conhecida e a senha em tempo de execução. Abra `http://127.0.0.1:3098` no mesmo computador, entre com a chave do laboratório e escaneie o QR Code pelo WhatsApp em **Dispositivos conectados → Conectar dispositivo**. O túnel precisa permanecer aberto durante o acesso; fechá-lo não interrompe o contêiner.

O cookie não usa `Secure` porque o endpoint local utiliza HTTP dentro do túnel SSH. Não publique esse endpoint por HTTP aberto. Caso seja colocado atrás de HTTPS no futuro, adapte cookie, origem e política de acesso antes de expor.

## Teste e operação

1. Confira o número vinculado e o destino exibidos no painel.
2. Clique em **Ligar pelo WhatsApp** e atenda no aparelho de destino.
3. Fale uma frase: você deverá ouvir sua própria voz de volta, sem tom periódico de chamada.
4. Confira os contadores de entrada e os quadros com som. A confirmação auditiva no aparelho é indispensável; contadores sozinhos não comprovam qualidade.
5. Use **Encerrar teste**. A consulta do contato tem limite de 15 segundos. A chamada também possui limite automático de 90 segundos depois da negociação, além do limite de 35 segundos para preparação.

O processo restaura a sessão após reiniciar. Se o QR Code expirar antes da vinculação, reinicie apenas o serviço **WhatsApp Lab** pelo Dokploy para gerar outro. Para invalidar a sessão, desvincule o dispositivo pelo próprio WhatsApp.

`GET /healthz` confirma que o processo responde; a conexão WhatsApp é apresentada separadamente no painel. Rotas de estado, QR Code e chamada exigem autenticação. Chamadas e encerramento exigem também o cabeçalho de ação usado pelo painel, sem CORS público.

Para interromper ou reverter este experimento, pare apenas **WhatsApp Lab** no projeto **WhatsApp - Laboratorio**. Não reinicie Docker, Traefik, Asterisk ou os outros projetos.

## Campanhas no PBX

No Discador, escolha **Ligar por → WhatsApp**, informe a fila ou o ramal de destino e os números com DDD. Quando o cliente atender, a chamada segue diretamente para o atendimento, sem áudio e sem tecla. Campanhas por linha telefônica continuam usando áudio e confirmação normalmente.

Há uma chamada de WhatsApp por vez para esta conta, compartilhada entre campanhas e testes de laboratório. Pausar impede novos envios e preserva a conversa em andamento. Uma chamada que foi atendida não é repetida automaticamente; falhas de resultado incerto também exigem revisão antes de repetir. O relatório diferencia atendimento no WhatsApp de uma conversa efetivamente conectada a um agente.

O serviço usa uma segunda rede privada, `pbx-validation-internal`, com alias `whatsapp-gateway`. A API de integração exige uma chave própria em `gateway-secret`, diferente da chave do laboratório. O PBX a lê de `data/whatsapp-gateway.json` (`url`, `token`, `audioSocketAddress`), com acesso restrito ao usuário do serviço. Esses arquivos nunca entram no Git. O Compose monta a chave em `/run/secrets/pbx-gateway` e notifica `http://web:3090/internal/whatsapp/events`; a consulta periódica recupera notificações perdidas.

O Asterisk 20.6 conecta por AudioSocket em `127.0.0.1:3099`, usando PCM mono de 8 kHz; o serviço converte para os 16 kHz do WhatsApp com filtro e buffers limitados. A porta de áudio não é pública. Os módulos `res_audiosocket.so` e `chan_audiosocket.so` devem estar carregados; o gerador do PBX mantém essas cargas. O contexto `dialer-whatsapp` grava a chamada conforme a configuração existente e usa exatamente a fila escolhida, sem destino alternativo de outra fila.

`gateway-calls.json` conserva as chaves de tentativa por sete dias e os resultados após reiniciar. O PBX grava a intenção antes de chamar a API; repetir a mesma chave não faz outra chamada. Marcadores em `data/dialer-outgoing/.whatsapp-delivered` impedem duplicar a conexão ao atendente. Não apague esses arquivos para tentar recuperar chamadas: confira primeiro o resultado e o histórico.
