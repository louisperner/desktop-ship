# HANDOFF — Controle do Desktop Ship via MCP

Estado em **2026-06-06**. Este doc resume o que foi construído, como testar e o
que falta. Para o guia de uso das tools, ver [MCP.md](MCP.md).

## O que é

O **Desktop Ship** (overlay de cockpit transparente em Electron) agora é
**controlável externamente via MCP**. Qualquer cliente MCP — Claude
Code/Desktop ou o **LocalMind** (`~/Work/localmind`, o "macaco") — pode
abrir/fechar/mover widgets e ajustar o cockpit.

```
Cliente MCP ──stdio──► src/mcp/server.cjs ──ws+token──► Electron main ──IPC──► renderer (CockpitHolos)
```

Descoberta automática: ao iniciar, o app grava `~/.desktopship/control.json`
com `{ port, token, pid }`; o MCP server lê esse arquivo. Sem config de porta.

## Arquivos (novos e alterados)

| Arquivo | Papel |
|---|---|
| `src/control-server.js` | **novo** — WebSocketServer em `127.0.0.1:8788` (env `DESKTOPSHIP_CONTROL_PORT` muda a porta). Token aleatório por sessão; valida via `?token=`. Publica/remove o handshake. |
| `src/main.js` | **alterado** — importa e sobe o control server; `invokeRenderer()` faz round-trip main↔renderer por IPC (`control:invoke` / `control:result`) com timeout de 10s; fecha o server em `will-quit`. |
| `src/preload.js` | **alterado** — expõe `cockpit.control.onInvoke()` e `cockpit.control.result()`. |
| `src/renderer/control.js` | **novo** — dispatcher: mapeia cada `method` para `CockpitHolos` / `CockpitPanels` / `window.cockpit`. Incluído no fim do `index.html` (depois de holo.js/hub.js). |
| `src/renderer/panels.js` | **alterado** — novo `setGeometry(idOrEl, {x,y,w,h})` público (move/resize externos), exposto em `window.CockpitPanels`. |
| `src/renderer/index.html` | **alterado** — `<script src="control.js">` no fim. |
| `src/mcp/server.cjs` | **novo** — servidor MCP stdio (SDK `@modelcontextprotocol/sdk` 1.29, `McpServer` + `registerTool`). Conecta no control server como cliente WS e expõe as tools. |
| `package.json` | **alterado** — deps `ws`, `@modelcontextprotocol/sdk`; devDeps `electron-builder`, `esbuild`. Scripts `build:mcp`, `dist`, `pack`. Bloco `build` do electron-builder. |
| `MCP.md` | **novo** — guia de tools + registro em clientes. |

## Tools MCP expostas

`cockpit_status`, `list_widget_types`, `list_widgets`, `spawn_widget`,
`close_widget`, `set_widget_config`, `set_widget_open`, `move_widget`,
`set_display`, `set_clickthrough`, `set_always_on_top`.

Tipos de widget (do catálogo em `holo.js`): `clock, sys, map, ship, log, todo,
image, video, folder, gmap, spotify, camera`.

Detalhe do protocolo WS (cliente → server / server → cliente):
```
{ id, method, params }            →
                                  ← { id, ok: true, result } | { id, ok: false, error }
```

## Como rodar / testar

```bash
npm start                 # sobe o app (control server em :8788, grava handshake)
npm run build:mcp         # bundla o MCP server → build/mcp/server.cjs (esbuild, 1 arquivo)
node src/mcp/server.cjs   # roda o MCP server em dev (precisa do app no ar p/ tools)
```

Smoke test do MCP server (boot stdio): `node build/mcp/server.cjs` deve imprimir
`[desktop-ship mcp] ready (stdio)` no stderr.

Teste E2E manual (app no ar) — conectar um WS client com o token do handshake e
chamar `get_state` / `spawn_widget` / `list_widgets`. Já validado: spawn cria
`w-clock-1`, list retorna o widget, get_state retorna displays/viewport.

## Empacotamento DMG

```bash
npm run dist    # build:mcp + electron-builder --mac dmg (arm64 + x64) → dist/
npm run pack    # só o .app (--dir), p/ testar rápido
```

`extraResources` copia `build/mcp/` → `Desktop Ship.app/Contents/Resources/mcp/`.
O bundle é self-contained (esbuild embute `ws`, sdk, `zod`), então **não exige
Node na máquina do usuário** — registrar usando o Electron do app como Node
(`ELECTRON_RUN_AS_NODE=1`, ver MCP.md).

## O que falta / próximos passos

- [ ] **Gerar o DMG de verdade** (`npm run dist`) — ainda não rodado aqui
      (baixa o Electron por arch, demorado).
- [ ] **Assinar + notarizar** o `.app` (Apple Developer ID) p/ distribuir sem o
      aviso do Gatekeeper. Sem isso o DMG abre via botão-direito → Abrir.
- [ ] **Registrar no LocalMind** — adicionar o servidor MCP na config de MCP do
      `Brain` (`pydantic-ai-slim[mcp]`) p/ o macaco comandar o cockpit.
- [ ] (Opcional) **Macaco como widget nativo** do cockpit, além do controle MCP.
- [ ] (Opcional) **Eventos push** do cockpit → MCP (hoje é só request/response):
      notificar o cliente quando o usuário move/fecha um widget na mão.
- [ ] **Limpeza**: o teste E2E deixou um widget `clock` salvo no estado do app
      (localStorage do userData) — fechar pelo ×.

## Gotchas

- O control server escuta só em `127.0.0.1` e exige token (gerado por sessão e
  publicado no handshake `~/.desktopship/control.json`). O handshake é apagado
  ao sair (`will-quit`).
- `control.js` precisa carregar **depois** de `holo.js`/`hub.js`/`panels.js`
  (usa `window.CockpitHolos` e `window.CockpitPanels`).
- O round-trip main↔renderer tem timeout de 10s; se o renderer não responder
  (janela não pronta), o tool retorna erro.
- `node-pty` continua em `asarUnpack` (módulo nativo); não mexer.
