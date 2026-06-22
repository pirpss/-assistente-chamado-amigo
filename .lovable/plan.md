## Diagnóstico direto

O erro `e: undefined` no depurador não significa que o script está quebrado. Isso acontece porque `doGet(e)` só recebe `e.parameter` quando é chamado pela URL publicada do Web App (`.../exec?assunto=...&descricao=...`). Ao apertar “Depurar” dentro do Apps Script, o Google executa a função sem requisição HTTP, então `e` vem vazio.

A URL que você mandou é a URL de edição do projeto:

```text
https://script.google.com/u/0/home/projects/.../edit
```

Ela não serve para testar a automação. Para eu ou você testarmos de verdade, precisa ser a URL de implantação do Web App, terminando em `/exec`.

## Limitação importante

Com “só Google/Gemini”, hoje não existe um jeito confiável de fazer o Gemini ouvir “registrar chamado”, perguntar campos, chamar uma URL de Apps Script e preencher uma planilha automaticamente. O Gemini/Assistente pode criar nota no Keep ou interagir com Gmail, mas não é confiável para executar um webhook customizado com assunto e descrição estruturados.

O caminho mais simples e testável é:

```text
Voz -> comando estruturado -> URL do Apps Script -> Google Sheets
```

Para usar só ferramentas Google, a etapa de voz fica limitada. Para funcionar de forma realmente automática, normalmente precisa de um intermediário como Tasker/AutoVoice, Make ou IFTTT. Se você quiser insistir em “só Google”, o melhor caminho prático é usar Gmail como entrada e Apps Script lendo os emails por acionador; Google Keep não é uma boa fonte porque não tem API oficial simples para Apps Script.

## Plano recomendado

### 1. Corrigir o Apps Script para aceitar teste manual e Web App

Trocar o script por uma versão mais resistente, que:

- não quebra quando `e` vier vazio no depurador;
- aceita `assunto` e `descricao` pela URL;
- aceita também texto completo no formato `Assunto: ... Descrição: ...`;
- registra data/hora junto do chamado;
- retorna uma resposta clara para teste.

Código recomendado:

```javascript
function doGet(e) {
  return registrarChamado_(e);
}

function doPost(e) {
  return registrarChamado_(e);
}

function registrarChamado_(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};
    var texto = params.texto || '';
    var assunto = params.assunto || extrairCampo_(texto, 'Assunto') || 'Sem Assunto';
    var descricao = params.descricao || extrairCampo_(texto, 'Descrição') || extrairDescricaoLivre_(texto) || 'Sem Descrição';

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheets()[0];

    sheet.appendRow([new Date(), assunto, descricao]);

    return ContentService
      .createTextOutput('OK - Chamado registrado: ' + assunto)
      .setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    return ContentService
      .createTextOutput('ERRO: ' + err.toString())
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

function extrairCampo_(texto, campo) {
  if (!texto) return '';
  var regex = new RegExp(campo + '\\s*:\\s*(.+)', 'i');
  var match = texto.match(regex);
  return match ? match[1].trim() : '';
}

function extrairDescricaoLivre_(texto) {
  if (!texto) return '';
  return texto
    .replace(/Assunto\s*:.*/i, '')
    .replace(/Descrição\s*:/i, '')
    .trim();
}

function testarLocalmente() {
  var e = {
    parameter: {
      assunto: 'Teste local',
      descricao: 'Descrição criada pelo teste local'
    }
  };
  Logger.log(registrarChamado_(e).getContent());
}

function mostrarPromptNota() {
  var ui = SpreadsheetApp.getUi();
  var resultado = ui.prompt(
    'Inserir Novo Chamado',
    'Cole aqui o conteúdo da nota. Exemplo:\nAssunto: Internet lenta\nDescrição: Cliente relata lentidão desde ontem',
    ui.ButtonSet.OK_CANCEL
  );

  if (resultado.getSelectedButton() == ui.Button.OK) {
    var texto = resultado.getResponseText();
    var e = { parameter: { texto: texto } };
    registrarChamado_(e);
    ui.alert('Chamado inserido com sucesso!');
  }
}
```

### 2. Publicar corretamente como Web App

No Apps Script:

1. Clique em **Implantar**.
2. Clique em **Nova implantação**.
3. Em tipo, escolha **App da Web**.
4. Em **Executar como**, selecione **Eu**.
5. Em **Quem pode acessar**, selecione **Qualquer pessoa** ou **Qualquer pessoa com uma Conta Google**.
6. Clique em **Implantar**.
7. Autorize as permissões.
8. Copie a URL que termina em `/exec`.

### 3. Testar antes de ligar com voz

Teste no navegador com uma URL assim:

```text
SUA_URL_EXEC?assunto=Teste%20de%20chamado&descricao=Descricao%20criada%20pelo%20navegador
```

Resultado esperado no navegador:

```text
OK - Chamado registrado: Teste de chamado
```

Resultado esperado na planilha:

```text
Data/Hora | Teste de chamado | Descricao criada pelo navegador
```

Se isso não funcionar, o problema ainda está na implantação/permissões do Apps Script, não no Gemini.

### 4. Só depois escolher a entrada por voz

#### Opção realmente confiável

Usar Tasker/AutoVoice no Android:

```text
“Ok Google, registrar novo chamado”
-> AutoVoice/Tasker abre fluxo
-> pergunta assunto
-> pergunta descrição
-> chama a URL /exec do Apps Script
-> planilha recebe o chamado
```

Essa é a opção mais eficaz para o que você quer.

#### Opção somente Google, com limitações

Usar Gmail como ponte:

```text
Voz/Gemini cria ou envia email com assunto e descrição
-> Apps Script lê emails com marcador específico
-> Apps Script grava na planilha
```

Mas isso exige um acionador de tempo no Apps Script, por exemplo a cada 1 ou 5 minutos. Não é instantâneo e pode falhar se o Gemini não criar o email no formato certo.

#### Google Keep

Eu não recomendo usar Google Keep como fonte principal. O Keep não tem uma API oficial simples para o Apps Script ler notas e transferir para Sheets. Ele pode ser usado como anotação visual, mas não como base confiável da automação.

## O que eu preciso de você para testar de verdade

Envie a URL publicada do Web App, a que termina em `/exec`, não a URL `/edit`.

Com essa URL, o teste objetivo é:

```text
/exec?assunto=Teste&descricao=Teste
```

Se ela responder `OK` e a linha aparecer na planilha, a parte da planilha está pronta. Depois disso, configuramos a parte da voz pelo caminho mais confiável.