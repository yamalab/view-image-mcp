# view-image-mcp

Claude Code から画像をターミナル内にインライン表示する MCP サーバー。

Kitty グラフィクスプロトコルを使用して、Ghostty や Kitty などの対応ターミナル上で画像を直接表示します。

## 対応環境

- **OS:** macOS
- **ターミナル:** Ghostty, Kitty（Kitty グラフィクスプロトコル対応ターミナル）
- **ランタイム:** Node.js v18+

## 対応フォーマット

| フォーマット | 対応方法 |
|---|---|
| PNG | そのまま表示 |
| JPEG | `sips` で PNG に変換して表示 |
| GIF | `sips` で PNG に変換して表示 |
| WebP | `sips` で PNG に変換して表示 |

## インストール

```bash
git clone <repository-url>
cd view-image-mcp
npm install
```

## Claude Code への登録

```bash
claude mcp add view-image node /path/to/view-image-mcp/index.js
```

または `~/.claude.json` に直接追記:

```json
{
  "mcpServers": {
    "view-image": {
      "command": "node",
      "args": ["/path/to/view-image-mcp/index.js"]
    }
  }
}
```

## 使い方

Claude Code 上で画像ファイルの表示を依頼すると、`view_image` ツールが呼ばれてターミナルにインライン表示されます。

```
> この画像を表示して: /path/to/screenshot.png
```

### ツール: `view_image`

| パラメータ | 型 | 説明 |
|---|---|---|
| `path` | string | 画像ファイルのパス（絶対パスまたは相対パス） |

## 仕組み

```
Claude Code ←(stdio JSON-RPC)→ MCP Server
                                    │
                                    ├─ 画像ファイルを読み込み
                                    ├─ 必要に応じて PNG に変換 (sips)
                                    ├─ Base64 エンコード + チャンク分割
                                    └─ /dev/tty に Kitty グラフィクスプロトコルで書き込み
                                            │
                                            ▼
                                    ターミナルにインライン表示
```

MCP サーバーの `stdout` は Claude Code との JSON-RPC 通信に使われるため、画像データは `/dev/tty` に直接書き込むことでターミナルに表示しています。

## ライセンス

MIT
