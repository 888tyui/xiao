# xiaoyue.world – cybernetic Solana agent

Full-stack app for chatting with xiaoyue (晓月), pulling Solana token intel, and bilingual analysis. Built for Railway deployment with separate backend (Express) and frontend (Vite React).

## Features
- OpenAI-powered chat with cybernetic-girl persona, bilingual (EN/中文).
- Token lookup via Solana RPC (supply, decimals, top holders) and AI-backed analysis.
- Sessions stored in PostgreSQL; no login required. First 4 user messages are free, then wallet connect required.
- Solana wallet prompt (Phantom) on frontend; wallet binding on backend.
- Modern, dual-language UI with agent mood/avatar placeholder.

## Tech stack
- Backend: Node.js + Express + TypeScript, OpenAI SDK, pg, @solana/web3.js.
- Frontend: Vite + React + TypeScript, i18next, axios.
- Database: PostgreSQL.

## Environment

Backend (`backend/.env`):
```
PORT=8080
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4o-mini
DATABASE_URL=postgres://user:password@host:5432/dbname
PGSSLMODE=require
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
CORS_ORIGIN=*
```

Frontend (`frontend/.env`):
```
VITE_API_BASE_URL=http://localhost:8080
```

## Local development
```bash
# backend
cd backend
npm install
npm run dev

# frontend
cd ../frontend
npm install
npm run dev
```
Open http://localhost:5173 and ensure backend is reachable at `VITE_API_BASE_URL`.

## Railway deployment
- Create two services (monorepo):
  - **backend service**: root `backend`, build `npm install && npm run build`, start `npm run start`. Set env vars above.
  - **frontend service**: root `frontend`, build `npm install && npm run build`, start `npm run preview -- --host 0.0.0.0 --port ${PORT}`. Set `VITE_API_BASE_URL` to the backend’s public URL.
- Add PostgreSQL plugin and set `DATABASE_URL` on backend service.
- For SSL-required Postgres, keep `PGSSLMODE=require`.

## Notes
- Token intel uses Solana RPC only; no price feeds are fetched.
- Wallet gating triggers after 4 user messages unless a wallet is attached.
- Placeholder avatar lives at `frontend/public/agent-placeholder.svg` (512×512).

