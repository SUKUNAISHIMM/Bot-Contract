# BOT Contract Decoder 🔬

A lightweight JavaScript/React contract decoder for BOT Chain Mainnet.

## Network

- Chain ID: 677
- RPC: https://rpc.botchain.ai
- Explorer: https://scan.botchain.ai

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to Vercel

Import this repository into Vercel. Vercel will detect the Vite app automatically.

Build command: `npm run build`

Output directory: `dist`

No environment variables are required for the basic app.

## Structure

The project is intentionally flat for simple Vercel deployment:

```text
index.html
main.jsx
App.jsx
style.css
package.json
vite.config.js
```


## Configured contract

The app opens with this BOT Chain contract preloaded:

`0x152D0A0cfEc331d2b26E617b55b2594262DFC359`

The app still fetches the contract bytecode and ABI from BOT Chain/BOTScan at runtime, so the address must exist on BOT Chain and its ABI must be available from the explorer for the Read/Write interface to populate.
