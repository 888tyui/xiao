import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import { Connection, PublicKey, type ParsedAccountData } from '@solana/web3.js';
import { OpenAI } from 'openai';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

dotenv.config();

const PORT = Number(process.env.PORT) || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required');
}

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map((item) => item.trim())
      : '*',
  }),
);
app.use(express.json({ limit: '1mb' }));

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
});

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const solana = new Connection(SOLANA_RPC_URL, 'confirmed');

type SessionRow = {
  id: string;
  wallet_address: string | null;
  locale: string | null;
  created_at: Date;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: Date;
};

const sessionSchema = z.object({
  sessionId: z.string().uuid().optional(),
  locale: z.enum(['en', 'zh']).optional(),
  walletAddress: z.string().optional().nullable(),
});

const chatSchema = z.object({
  sessionId: z.string().uuid().optional(),
  prompt: z.string().min(1, 'Prompt cannot be empty'),
  locale: z.enum(['en', 'zh']).optional(),
  walletAddress: z.string().optional().nullable(),
});

const tokenAnalyzeSchema = z.object({
  sessionId: z.string().uuid().optional(),
  mint: z.string().min(1, 'Mint address required'),
  locale: z.enum(['en', 'zh']).optional(),
  walletAddress: z.string().optional().nullable(),
});

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      wallet_address TEXT,
      locale TEXT DEFAULT 'en',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function createSession(locale = 'en', walletAddress?: string): Promise<SessionRow> {
  const id = uuidv4();
  await pool.query(
    'INSERT INTO sessions (id, wallet_address, locale) VALUES ($1, $2, $3)',
    [id, walletAddress ?? null, locale],
  );
  return {
    id,
    wallet_address: walletAddress ?? null,
    locale,
    created_at: new Date(),
  };
}

async function getSession(sessionId: string): Promise<SessionRow | null> {
  const { rows } = await pool.query<SessionRow>('SELECT * FROM sessions WHERE id = $1', [
    sessionId,
  ]);
  return rows[0] ?? null;
}

async function attachWallet(sessionId: string, walletAddress: string) {
  await pool.query('UPDATE sessions SET wallet_address = $1 WHERE id = $2', [
    walletAddress,
    sessionId,
  ]);
}

async function storeMessage(sessionId: string, role: 'user' | 'assistant', content: string) {
  await pool.query(
    'INSERT INTO messages (id, session_id, role, content) VALUES ($1, $2, $3, $4)',
    [uuidv4(), sessionId, role, content],
  );
}

async function getMessages(sessionId: string): Promise<MessageRow[]> {
  const { rows } = await pool.query<MessageRow>(
    'SELECT id, session_id, role, content, created_at FROM messages WHERE session_id = $1 ORDER BY created_at ASC',
    [sessionId],
  );
  return rows;
}

async function getRecentMessages(sessionId: string, limit = 8): Promise<MessageRow[]> {
  const { rows } = await pool.query<MessageRow>(
    'SELECT id, role, content, created_at FROM messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2',
    [sessionId, limit],
  );
  return rows.reverse();
}

async function getMessageCount(sessionId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::INT as count FROM messages WHERE session_id = $1 AND role = 'user'",
    [sessionId],
  );
  return Number(rows[0]?.count ?? 0);
}

function buildSystemPrompt(locale: 'en' | 'zh' = 'en') {
  const persona = `You are xiaoyue (晓月), a cybernetic girl AI agent. Keep responses concise, warm, and futuristic. Always answer in bilingual format: first English, then Chinese on a new paragraph. Do not fabricate token prices. Warn users about risk and lack of guarantees.`;

  const guidance =
    locale === 'zh'
      ? '保持英语+中文双语格式。风格偏未来感但友好，注意合规和风险提示。'
      : 'Keep answers compliant, friendly, futuristic. Always include risk disclaimers for trading.';

  return `${persona}\n${guidance}`;
}

async function getTokenInfo(mintAddress: string) {
  const mint = new PublicKey(mintAddress);
  const [supply, largestAccounts] = await Promise.all([
    solana.getTokenSupply(mint),
    solana.getTokenLargestAccounts(mint),
  ]);

  const holders = [];
  for (const account of largestAccounts.value.slice(0, 5)) {
    const parsed = await solana.getParsedAccountInfo(account.address);
    const parsedInfo = (parsed.value?.data as ParsedAccountData | null)?.parsed as
      | { info?: { owner?: string } }
      | undefined;

    holders.push({
      address: account.address.toBase58(),
      owner: parsedInfo?.info?.owner ?? null,
      amount: account.uiAmount,
      decimals: supply.value.decimals,
    });
  }

  return {
    mint: mint.toBase58(),
    decimals: supply.value.decimals,
    supply: supply.value.uiAmount,
    rawAmount: supply.value.amount,
    uiAmountString: supply.value.uiAmountString,
    largestHolders: holders,
    lastUpdated: new Date().toISOString(),
  };
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'xiaoyue-backend' });
});

app.post('/api/session', async (req: Request, res: Response) => {
  try {
    const payload = sessionSchema.parse(req.body ?? {});
    let session = payload.sessionId ? await getSession(payload.sessionId) : null;
    if (!session) {
      session = await createSession(payload.locale ?? 'en', payload.walletAddress ?? undefined);
    }

    const incomingWallet = payload.walletAddress ?? undefined;
    if (incomingWallet && session.wallet_address !== incomingWallet) {
      await attachWallet(session.id, incomingWallet);
      session.wallet_address = incomingWallet;
    }

    const [messages, userMessageCount] = await Promise.all([
      getMessages(session.id),
      getMessageCount(session.id),
    ]);

    res.json({
      sessionId: session.id,
      walletAddress: session.wallet_address,
      locale: session.locale ?? 'en',
      messageCount: messages.length,
      userMessageCount,
      freeMessagesLeft: Math.max(0, 4 - userMessageCount),
      messages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid payload';
    res.status(400).json({ error: message });
  }
});

app.get('/api/session/:id/messages', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const messages = await getMessages(session.id);
    res.json({ sessionId: session.id, messages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/api/token/:mint', async (req: Request, res: Response) => {
  try {
    const mint = req.params.mint;
    let info;
    try {
      info = await getTokenInfo(mint);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid token mint or RPC failure' });
    }
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: 'Unable to fetch token info' });
  }
});

app.post('/api/token/analyze', async (req: Request, res: Response) => {
  try {
    const payload = tokenAnalyzeSchema.parse(req.body ?? {});
    const session = payload.sessionId
      ? await getSession(payload.sessionId)
      : await createSession(payload.locale ?? 'en', payload.walletAddress ?? undefined);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const totalMessages = await getMessageCount(session.id);
    if (totalMessages >= 4 && !(session.wallet_address || payload.walletAddress)) {
      return res.status(403).json({
        requireWallet: true,
        message:
          'Please connect your Solana wallet to continue after 4 messages / 四条对话后请连接钱包。',
      });
    }

    const incomingWallet = payload.walletAddress ?? undefined;
    if (incomingWallet && !session.wallet_address) {
      await attachWallet(session.id, incomingWallet);
      session.wallet_address = incomingWallet;
    }

    const info = await getTokenInfo(payload.mint);
    const systemPrompt = buildSystemPrompt((session.locale as 'en' | 'zh') ?? 'en');
    const prompt = `
Token mint: ${info.mint}
Supply: ${info.supply} (raw: ${info.rawAmount}, decimals: ${info.decimals})
Top holders: ${info.largestHolders
      .map((h) => `${h.owner ?? 'unknown'}: ${h.amount}`)
      .join(', ')}
Last updated: ${info.lastUpdated}

Provide a concise bilingual (EN first, then 中文) analysis covering:
- Basic description from the numbers above
- Concentration risk from top holders
- Liquidity or circulation notes (if inferable)
- Neutral, non-speculative guidance and risk warning
`;

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 400,
    });

    const reply = completion.choices[0]?.message?.content?.trim();
    if (reply) {
      await storeMessage(session.id, 'user', `Analyze token ${info.mint}`);
      await storeMessage(session.id, 'assistant', reply);
    }

    const freeMessagesLeft = Math.max(0, 4 - (await getMessageCount(session.id)));

    res.json({ sessionId: session.id, analysis: reply, token: info, freeMessagesLeft });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to analyze token';
    res.status(400).json({ error: message });
  }
});

app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const payload = chatSchema.parse(req.body ?? {});
    let session = payload.sessionId
      ? await getSession(payload.sessionId)
      : await createSession(payload.locale ?? 'en', payload.walletAddress ?? undefined);

    if (!session) {
      session = await createSession(payload.locale ?? 'en', payload.walletAddress ?? undefined);
    }

    const totalMessages = await getMessageCount(session.id);
    if (totalMessages >= 4 && !(session.wallet_address || payload.walletAddress)) {
      return res.status(403).json({
        requireWallet: true,
        message:
          'Please connect your Solana wallet to continue after 4 messages / 四条对话后请连接钱包。',
      });
    }

    const incomingWallet = payload.walletAddress ?? undefined;
    if (incomingWallet && !session.wallet_address) {
      await attachWallet(session.id, incomingWallet);
      session.wallet_address = incomingWallet;
    }

    const history = await getRecentMessages(session.id, 8);
    const systemPrompt = buildSystemPrompt((session.locale as 'en' | 'zh') ?? 'en');

    await storeMessage(session.id, 'user', payload.prompt);

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: payload.prompt },
      ],
      temperature: 0.65,
      max_tokens: 450,
    });

    const reply = completion.choices[0]?.message?.content?.trim() ?? '';
    await storeMessage(session.id, 'assistant', reply);

    const freeMessagesLeft = Math.max(0, 4 - (await getMessageCount(session.id)));

    res.json({
      sessionId: session.id,
      message: reply,
      walletAddress: session.wallet_address,
      freeMessagesLeft,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to process chat';
    res.status(400).json({ error: message });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`xiaoyue backend running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server', err);
    process.exit(1);
  });

