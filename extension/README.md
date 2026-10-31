# Knowledge Canvas Bridge

Chrome / Chromium MV3 extension for Web nodes.

It lets the canvas:

- open, focus, and bind real ChatGPT, Claude, Gemini, Grok, DeepSeek, Doubao, Qwen, and Kimi tabs;
- submit prompts through each page's normal composer from inside the canvas node;
- mirror visible messages from the bound page back into the node;
- expose the page's current model, thinking, or search controls when the page renders them.

It never reads cookies, authorization headers, or provider tokens, and it does not call private APIs.

## Load unpacked

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose “Load unpacked” and select this `extension/` directory.
4. Open the canvas on `http://localhost:3000` or `http://127.0.0.1:3000`.

The manifest contains a public `key`, so the extension ID is stable:

```text
gnfmgnonoifibmaddbcbkojgcgjnpkej
```

The canvas already uses this ID. If you publish a different build with another key, update `WEB_EXTENSION_ID` in `app/src/lib/web-providers.ts`.

## Production origin

`externally_connectable.matches` only allows local development origins. Before deploying the canvas on another origin, add that exact origin to the manifest and rebuild the extension. Do not use `<all_urls>`.

## Provider controls

The content script is injected on every allowlisted provider origin. Each provider exposes only the controls that are actually present in its current page:

| Provider | Typical controls |
| --- | --- |
| ChatGPT | Thinking toggle |
| Claude | Model and thinking menu |
| Gemini | Model/thinking menu when the page renders it |
| Grok | Model menu |
| DeepSeek | Deep thinking and smart search toggles |
| Doubao | Model menu when the page renders it |
| Qwen | Model or search controls when the page renders them |
| Kimi | Model and thinking menu |

Menus are read from the live page and are not hardcoded model lists. A control is hidden when the provider does not render it for the current account, conversation, or mode.

## Adapter behaviour

The adapter is DOM-based, not an API integration:

- it fills the page composer, clicks the page's own send button, or sends Enter;
- it converts visible message DOM into Markdown so tables, code blocks, lists, quotes, links, and formulas survive the mirror;
- it polls only messages that appear after the prompt;
- it stops at a stable assistant message or reports an unknown state after a timeout;
- if a page has no readable message container, it falls back to the visible text after the submitted prompt;
- it never reads cookies, localStorage tokens, authorization headers, or provider internals.

DOM changes can break any adapter. Each provider has its own selectors and version; a broken adapter should degrade to a real-page shortcut rather than claim success.

## Security boundary

The extension only executes a fixed command allowlist. It rejects unknown commands, non-allowlisted canvas origins, provider URLs outside the allowlist, and duplicate tab bindings.
