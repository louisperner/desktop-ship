# Controlando o Desktop Ship via MCP

O cockpit expõe um **servidor de controle WebSocket** (em `127.0.0.1`, com token)
e um **servidor MCP** stdio que faz a ponte. Qualquer cliente MCP — Claude
Code/Desktop, LocalMind, etc. — pode abrir/fechar/mover widgets e ajustar o
cockpit.

```
Cliente MCP ──stdio──► mcp/server.cjs ──ws (token)──► Electron main ──IPC──► renderer (CockpitHolos)
```

A descoberta é automática: ao iniciar, o app grava
`~/.desktopship/control.json` com `{ port, token, pid }`, e o MCP server lê esse
arquivo. Nada de configurar porta à mão.

## Tools expostas

| Tool | O que faz |
|---|---|
| `cockpit_status` | displays, viewport e nº de widgets |
| `list_widget_types` | catálogo de tipos + campos de config |
| `list_widgets` | widgets atuais (id, type, cfg, open) |
| `spawn_widget` | adiciona um widget (`type`, `cfg`, `geometry?`) |
| `close_widget` | remove por `id` |
| `set_widget_config` | mescla config (ex.: trocar `src` da imagem) |
| `set_widget_open` | mostra/esconde sem remover |
| `move_widget` | reposiciona/redimensiona (`x,y,w,h`) |
| `set_display` | move o cockpit pra outro monitor |
| `set_clickthrough` | clique atravessa pro app de baixo |
| `set_always_on_top` | fixa acima de tudo / solta atrás |

Tipos de widget: `clock, sys, map, ship, log, todo, image, video, folder, gmap,
spotify, camera`.

## Registro — desenvolvimento (rodando do repo)

```jsonc
{
  "mcpServers": {
    "desktop-ship": {
      "command": "node",
      "args": ["/path/to/DesktopShip/src/mcp/server.cjs"]
    }
  }
}
```

(Em dev o `node` do sistema enxerga o `node_modules` do repo.)

## Registro — app instalado (DMG)

O DMG embute o MCP server bundlado (arquivo único, sem `node_modules`) em
`Desktop Ship.app/Contents/Resources/mcp/server.cjs`. Pra não exigir Node
instalado na máquina do usuário, use o **próprio Electron do app como Node**:

```jsonc
{
  "mcpServers": {
    "desktop-ship": {
      "command": "/Applications/Desktop Ship.app/Contents/MacOS/Desktop Ship",
      "args": ["/Applications/Desktop Ship.app/Contents/Resources/mcp/server.cjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

Se o usuário tiver Node, `"command": "node"` com o mesmo caminho também funciona.

### LocalMind (o macaco)

O `Brain` do LocalMind já agrega toolsets MCP (`pydantic-ai-slim[mcp]`). Basta
adicionar o servidor acima na config de MCP dele — o macaco passa a comandar o
cockpit pelas mesmas tools.

## Gerando o DMG

```bash
npm run dist    # bundla o MCP server e gera o .dmg (arm64 + x64) em dist/
npm run pack    # só empacota o .app (sem dmg) pra testar rápido
```

O `npm run dist` roda `build:mcp` (esbuild → `build/mcp/server.cjs`) e o
`electron-builder`, que copia esse bundle pra `Resources/mcp/` via
`extraResources`.

> macOS: para distribuir fora da sua máquina sem o Gatekeeper bloquear, o `.app`
> precisa ser **assinado e notarizado** (Apple Developer ID). Sem isso, o DMG
> funciona, mas o usuário verá o aviso de "app não verificado" e terá que abrir
> via botão-direito → Abrir.
