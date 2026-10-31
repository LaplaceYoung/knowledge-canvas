# Knowledge Canvas Bridge

Chrome / Chromium MV3 extension for Web nodes.

It lets the canvas:

- open, focus, and bind real ChatGPT / DeepSeek tabs;
- for a **new ChatGPT session only**, submit a prompt through the normal page composer and mirror the visible new messages back to the node;
- leave DeepSeek in linked-tab mode. No page reading, auto-submit, or background history capture.

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

## Provider notes

- **ChatGPT**: mirror adapter is version `chatgpt-dom-0.1`. It is DOM-dependent and can degrade when the provider changes its page; the node falls back to “open original page”.
- **DeepSeek**: linked tab only until its terms and adapter are explicitly approved.

The extension only executes a fixed command allowlist. It rejects unknown commands, non-allowlisted canvas origins, provider URLs outside the allowlist, and duplicate tab bindings.
