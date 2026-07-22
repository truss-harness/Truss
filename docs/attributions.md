# Attributions

This file tracks third-party libraries and external attribution requirements used by rich rendering features.

## Libraries

| Package | Version | License | Use |
| --- | --- | --- | --- |
| `katex` | `0.17.0` | MIT | Parses LaTeX math expressions and emits MathML for KaTeX rendering. |
| `pandoc-wasm` | `1.1.0` | GPL-2.0-or-later | Converts webpage HTML and document attachments to Markdown inside the Bun backend. |
| `plantuml-encoder` | `1.4.0` | MIT | Encodes PlantUML source for PlantUML server image URLs. |
| `adm-zip` | `0.5.17` | MIT | Extracts the app-managed Camoufox browser archive for Truss Web Tools. |
| `playwright-core` | `1.53.0` | Apache-2.0 | Launches and controls the app-managed Camoufox browser used by Truss Web Tools. |
| `react-easy-crop` | `6.0.2` | MIT | Provides the interactive image cropper in transcript attachment previews. |
| WinSW | `2.12.0` | MIT | Supports optional Windows service-mode installs for the compiled `truss.exe`. |

## External Services And Data

| Source | Attribution | Use |
| --- | --- | --- |
| OpenStreetMap | Map data © OpenStreetMap contributors. See `https://www.openstreetmap.org/copyright`. | Map markdown blocks render OpenStreetMap embeds. |
| PlantUML server | The default server is `https://www.plantuml.com/plantuml`; users can configure another HTTP or HTTPS PlantUML server. | PlantUML fenced code blocks render as SVG or PNG diagrams when enabled. |
| Camoufox | Camoufox is an open source anti-detect browser. See `https://github.com/daijro/camoufox`. | Truss Web Tools downloads a pinned Camoufox release into Truss home and launches it for browser-backed search, page loading, and screenshots. |
| uBlock Origin | uBlock Origin is licensed under GPL-3.0-or-later. See `https://github.com/gorhill/uBlock`. | Truss Web Tools downloads uBlock Origin `1.71.0` into the Camoufox add-on cache and loads it by default. |
| DuckDuckGo HTML search | Search results are requested from `https://html.duckduckgo.com/html/`. | Native web search returns up to five model-visible results in TOON format. |
