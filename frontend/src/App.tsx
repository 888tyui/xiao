import axios from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
};

type TokenInfo = {
  mint: string;
  decimals: number;
  supply: number;
  rawAmount: string;
  uiAmountString: string;
  largestHolders: { address: string; owner: string | null; amount: number | null; decimals: number }[];
  lastUpdated: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

const moodMap = {
  joy: { label: 'Joyful', labelZh: '开心', color: '#f59e0b' },
  neutral: { label: 'Chill', labelZh: '平静', color: '#6b7280' },
  sad: { label: 'Sad', labelZh: '难过', color: '#3b82f6' },
  angry: { label: 'Annoyed', labelZh: '生气', color: '#ef4444' },
  shy: { label: 'Shy', labelZh: '害羞', color: '#a855f7' },
};

const moodImageMap: Record<keyof typeof moodMap, string> = {
  joy: '/happy.png',
  neutral: '/chill.png',
  sad: '/sad.png',
  angry: '/angry.png',
  shy: '/shy.png',
};

function shortAddress(addr?: string | null) {
  if (!addr) return '';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function timestampLabel(date?: string) {
  if (!date) return '';
  return new Date(date).toLocaleTimeString();
}

function deriveMood(text?: string): keyof typeof moodMap {
  if (!text) return 'neutral';
  const lower = text.toLowerCase();
  if (/(angry|mad|annoyed|frustrat)/.test(lower)) return 'angry';
  if (/(sorry|apolog|shy|embarrass)/.test(lower)) return 'shy';
  if (/(sad|unhappy|upset|unfortunate)/.test(lower)) return 'sad';
  if (/(great|glad|happy|awesome|nice|yay|love)/.test(lower)) return 'joy';
  return 'neutral';
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [requireWallet, setRequireWallet] = useState(false);
  const [language, setLanguage] = useState<'en' | 'zh'>(
    (localStorage.getItem('lang') as 'en' | 'zh') || 'en',
  );
  const [tokenMint, setTokenMint] = useState('');
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [tokenAnalysis, setTokenAnalysis] = useState<string | null>(null);
  const [freeMessagesLeft, setFreeMessagesLeft] = useState<number | null>(null);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [moodKey, setMoodKey] = useState<keyof typeof moodMap>('neutral');
  const chatInputRef = useRef<HTMLInputElement>(null);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  const mood = useMemo(() => moodMap[moodKey], [moodKey]);

  useEffect(() => {
    i18n.changeLanguage(language);
    localStorage.setItem('lang', language);
  }, [language, i18n]);

  useEffect(() => {
    const existingId = localStorage.getItem('sessionId') || undefined;
    bootstrapSession(existingId).catch(() => null);
  }, []);

  async function bootstrapSession(existingId?: string) {
    try {
      const { data } = await axios.post(`${API_BASE}/api/session`, {
        sessionId: existingId,
        locale: language,
      });
      setSessionId(data.sessionId);
      localStorage.setItem('sessionId', data.sessionId);
      setMessages(data.messages || []);
      setFreeMessagesLeft(data.freeMessagesLeft ?? null);
      if (data.walletAddress) {
        setWalletAddress(data.walletAddress);
        setRequireWallet(false);
      }
    } catch (err) {
      setError('Unable to start session.');
    }
  }

  async function handleSend() {
    if (!input.trim()) return;
    if (!sessionId) {
      await bootstrapSession();
    }

    const pending: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, pending]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const wallet = walletAddress ?? undefined;
      const { data } = await axios.post(`${API_BASE}/api/chat`, {
        sessionId: sessionId || undefined,
        prompt: pending.content,
        locale: language,
        ...(wallet ? { walletAddress: wallet } : {}),
      });

      if (data.requireWallet) {
        setRequireWallet(true);
        setShowWalletModal(true);
        return;
      }

      setRequireWallet(false);
      setSessionId(data.sessionId);
      localStorage.setItem('sessionId', data.sessionId);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: data.message },
      ]);
      setFreeMessagesLeft(data.freeMessagesLeft ?? null);
      if (data.message) setMoodKey(deriveMood(data.message));
    } catch (err: any) {
      if (err?.response?.data?.requireWallet) {
        setRequireWallet(true);
        setShowWalletModal(true);
      } else {
        setError(err?.response?.data?.error || 'Something went wrong.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function connectWallet() {
    if (!window.solana?.isPhantom) {
      setError('Phantom wallet not detected. Please install or unlock it.');
      return;
    }
    try {
      const res = await window.solana.connect();
      const address = res.publicKey.toString();
      setWalletAddress(address);
      setRequireWallet(false);
      if (sessionId) {
        await axios.post(`${API_BASE}/api/session`, {
          sessionId,
          walletAddress: address,
          locale: language,
        });
      }
    } catch (err) {
      setError('Wallet connection was cancelled.');
    }
  }

  async function fetchTokenInfo(mintOverride?: string) {
    const mint = (mintOverride ?? tokenMint).trim();
    if (!mint) return;
    setError(null);
    setTokenAnalysis(null);
    try {
      const { data } = await axios.get<TokenInfo>(`${API_BASE}/api/token/${mint}`);
      setTokenInfo(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to fetch token info.');
    }
  }

  async function analyzeToken(mintOverride?: string) {
    const mint = (mintOverride ?? tokenMint).trim();
    if (!mint) return;
    setLoading(true);
    setTokenAnalysis(null);
    setError(null);
    try {
      const wallet = walletAddress ?? undefined;
      const { data } = await axios.post(`${API_BASE}/api/token/analyze`, {
        mint,
        sessionId: sessionId || undefined,
        locale: language,
        ...(wallet ? { walletAddress: wallet } : {}),
      });

      if (data.requireWallet) {
        setRequireWallet(true);
        setShowWalletModal(true);
        return;
      }

      setRequireWallet(false);
      setSessionId(data.sessionId);
      localStorage.setItem('sessionId', data.sessionId);
      setTokenMint(mint);
      setTokenAnalysis(data.analysis);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.analysis || '',
        },
      ]);
      setFreeMessagesLeft(data.freeMessagesLeft ?? null);
      if (data.analysis) setMoodKey(deriveMood(data.analysis));
    } catch (err: any) {
      if (err?.response?.data?.requireWallet) {
        setRequireWallet(true);
        setShowWalletModal(true);
      } else {
        setError(err?.response?.data?.error || 'Failed to analyze token.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">✦ xiaoyue</div>
        <div className="mood-block">
          <img src={moodImageMap[moodKey]} alt="xiaoyue mood" />
          <div className="mood-text">
            <div className="eyebrow">{t('mood')}</div>
            <div className="mood-line">
              <span className="dot" style={{ background: mood.color }} />
              {language === 'zh' ? mood.labelZh : mood.label}
            </div>
          </div>
        </div>
        <div className="social-buttons">
          <button className="soft wide-btn" onClick={() => window.open('https://x.com/xiaoyue_agent', '_blank')}>
            Twitter
          </button>
          <button
            className="soft wide-btn"
            onClick={() =>
              window.open(
                'https://bags.fm/xMzyTfkzyrcaRsQqnaxPr4P7vKNgLcEGnHQc4tzBAGS',
                '_blank',
              )
            }
          >
            $XIAOYUE
          </button>
        </div>
        <div className="sidebar-footer">
          <button className="primary" onClick={connectWallet}>
            {walletAddress ? shortAddress(walletAddress) : t('connectWallet')}
          </button>
          <div className="pill lang-pill wide">
            <button
              className={language === 'en' ? 'active' : ''}
              onClick={() => setLanguage('en')}
            >
              EN
            </button>
            <button
              className={language === 'zh' ? 'active' : ''}
              onClick={() => setLanguage('zh')}
            >
              中文
            </button>
          </div>
          <div className="pill-info">
            {freeMessagesLeft !== null ? `Demo chats left: ${freeMessagesLeft}` : 'Welcome'}
          </div>
        </div>
      </aside>

      <div className="content content-compact">
        <section className="card chat-card full">
          <div className="card-header">
            <div className="eyebrow">Chat</div>
            <div className="card-actions">
              <button className="soft" onClick={() => setShowTokenModal(true)}>
                Token Intel
              </button>
              {requireWallet && <div className="badge warning">{t('walletNeeded')}</div>}
            </div>
          </div>

          <div className="messages tall">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`message ${message.role === 'assistant' ? 'assistant' : 'user'}`}
              >
                <div className="meta">
                  <span>{message.role === 'assistant' ? '晓月' : 'You'}</span>
                  <span className="time">{timestampLabel(message.created_at)}</span>
                </div>
                <p>{message.content}</p>
              </div>
            ))}
            {messages.length === 0 && <div className="empty">Say hi to xiaoyue to begin.</div>}
          </div>

          <div className="composer">
            <input
              ref={chatInputRef}
              value={input}
              disabled={loading}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={t('inputPlaceholder')}
            />
            <button onClick={handleSend} disabled={loading}>
              {loading ? t('statusThinking') : t('send')}
            </button>
          </div>

          {error && <div className="error">{error}</div>}
        </section>
      </div>
    </div>

    {showTokenModal && (
      <div className="modal-backdrop" onClick={() => setShowTokenModal(false)}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="card-header">
            <div>
              <div className="eyebrow">{t('tokenPanel')}</div>
              <div className="muted">Solana RPC · EN / 中文 analysis</div>
            </div>
            <button className="soft" onClick={() => setShowTokenModal(false)}>
              Close
            </button>
          </div>
          <div className="token-actions">
            <input
              ref={tokenInputRef}
              value={tokenMint}
              onChange={(e) => setTokenMint(e.target.value)}
              placeholder={t('tokenPlaceholder')}
            />
            <div className="token-buttons">
              <button onClick={() => fetchTokenInfo()}>{t('fetchInfo')}</button>
              <button onClick={() => analyzeToken()} disabled={loading}>
                {t('analyze')}
              </button>
            </div>
          </div>
          {tokenInfo && (
            <div className="token-card">
              <div className="row">
                <span>Mint</span>
                <span className="mono">{shortAddress(tokenInfo.mint)}</span>
              </div>
              <div className="row">
                <span>Supply</span>
                <span className="mono">{tokenInfo.uiAmountString}</span>
              </div>
              <div className="row">
                <span>Decimals</span>
                <span className="mono">{tokenInfo.decimals}</span>
              </div>
              <div className="holders">
                <span>Top holders</span>
                <ul>
                  {tokenInfo.largestHolders.map((h) => (
                    <li key={h.address}>
                      <span className="mono">{shortAddress(h.owner || h.address)}</span>
                      <span className="mono">{h.amount ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="timestamp">{tokenInfo.lastUpdated}</div>
            </div>
          )}
          <div className="card-section">
            <div className="card-header">
              <div className="eyebrow">{t('analysisPanel')}</div>
            </div>
            {tokenAnalysis ? (
              <div className="analysis">{tokenAnalysis}</div>
            ) : (
              <div className="empty">No analysis yet. Run an analysis after fetching info.</div>
            )}
          </div>
        </div>
      </div>
    )}

    {requireWallet && showWalletModal && (
      <div className="modal-backdrop" onClick={() => setShowWalletModal(false)}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="card-header">
            <div className="eyebrow">Wallet Required</div>
            <div className="muted">Connect to continue after 5 free chats.</div>
          </div>
          <div className="modal-actions">
            <button className="primary" onClick={connectWallet}>Connect Wallet</button>
            <button className="soft" onClick={() => setShowWalletModal(false)}>Close</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

