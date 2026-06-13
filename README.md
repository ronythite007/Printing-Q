# SmartPrint

SmartPrint is a WhatsApp-driven document printing POC. Incoming WhatsApp documents are downloaded on the server, shown immediately in the Try Now screen, and can be added to a FIFO print queue.

## Requirements

- Node.js 18.0.0 or higher
- WhatsApp Web access for the phone number you want to connect
- A printer available to the machine running the server

## Setup

```bash
npm install
```

If you need to refresh the browser compatibility database:

```bash
npx update-browserslist-db@latest
```

## Run

```bash
npm run dev
```

This starts both the Vite UI and the backend server. The frontend uses the backend for `/api/*` and `/ws` traffic.

## WhatsApp QR Login

- Open `/try-now`
- If a session already exists, click `Force QR` to reset the saved LocalAuth session
- Scan the QR code with WhatsApp Web on your phone
- Once connected, incoming documents appear in realtime

## Notes

- Incoming files are stored under `downloads/`
- Sessions are persisted under `server-state/whatsapp-session/`
- The print queue currently supports PDF printing through `pdf-to-printer`
