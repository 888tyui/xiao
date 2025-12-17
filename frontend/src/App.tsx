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
  idle: { label: 'Pulse steady', labelZh: '脉冲平稳', color: '#7dd3fc' },
  thinking: { label: 'Neon thoughts running', labelZh: '霓虹思绪处理中', color: '#a78bfa' },
  alert: { label: 'Awaiting wallet sync', labelZh: '等待钱包同步', color: '#f59e0b' },
  ready: { label: 'Systems ready', labelZh: '系统就绪', color: '#34d399' },
};

function shortAddress(addr?: string | null) {
  if (!addr) return '';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function timestampLabel(date?: string) {
  if (!date) return '';
  return new Date(date).toLocaleTimeString();
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
  const chatInputRef = useRef<HTMLInputElement>(null);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  const mood = useMemo(() => {
    if (requireWallet) return moodMap.alert;
    if (loading) return moodMap.thinking;
    if (messages.length > 0) return moodMap.ready;
    return moodMap.idle;
  }, [requireWallet, loading, messages.length]);

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
      const { data } = await axios.post(`${API_BASE}/api/chat`, {
        sessionId: sessionId || undefined,
        prompt: pending.content,
        locale: language,
        walletAddress,
      });

      if (data.requireWallet) {
        setRequireWallet(true);
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
    } catch (err: any) {
      if (err?.response?.data?.requireWallet) {
        setRequireWallet(true);
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
      const { data } = await axios.post(`${API_BASE}/api/token/analyze`, {
        mint,
        sessionId: sessionId || undefined,
        locale: language,
        walletAddress,
      });

      if (data.requireWallet) {
        setRequireWallet(true);
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
    } catch (err: any) {
      if (err?.response?.data?.requireWallet) {
        setRequireWallet(true);
      } else {
        setError(err?.response?.data?.error || 'Failed to analyze token.');
      }
    } finally {
      setLoading(false);
    }
  }

  function quickPrompt(text: string) {
    setInput(text);
    chatInputRef.current?.focus();
  }

  function quickMint(mint: string) {
    setTokenMint(mint);
    tokenInputRef.current?.focus();
  }

  const quickTiles = [
    {
      title: 'Check a token',
      desc: 'Get supply, decimals, and top holders fast.',
      action: () => {
        quickMint('So11111111111111111111111111111111111111112');
        fetchTokenInfo('So11111111111111111111111111111111111111112');
      },
    },
    {
      title: 'Analyze risk',
      desc: 'Bilingual analysis with risk notes.',
      action: () => {
        const mint = tokenMint || 'So11111111111111111111111111111111111111112';
        quickMint(mint);
        analyzeToken(mint);
      },
    },
    {
      title: 'Continue chat',
      desc: 'Ask about a token or strategy in EN/中文.',
      action: () => quickPrompt('Give me a bilingual view on SOL token activity.'),
    },
    {
      title: 'Connect wallet',
      desc: 'Unlock after 4 free user messages.',
      action: () => connectWallet(),
    },
  ];

  const assistantMessages = messages.filter((m) => m.role === 'assistant');

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">✦ xiaoyue</div>
        <nav className="nav">
          <button className="nav-item active">Home</button>
          <button className="nav-item">Chat</button>
          <button className="nav-item">Token Intel</button>
          <button className="nav-item">History</button>
        </nav>
        <div className="sidebar-footer">
          <div className="pill-info">
            {freeMessagesLeft !== null ? `Free chats left: ${freeMessagesLeft}` : 'Welcome'}
          </div>
          <div className="status-line">
            <span className="dot" style={{ background: mood.color }} />
            {language === 'zh' ? mood.labelZh : mood.label}
          </div>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">Cybernetic Agent · EN / 中文</div>
            <h1>How can xiaoyue help today?</h1>
            <p className="subtext">
              Ask about Solana tokens, bilingual analysis, and chat. Wallet connect after 4 free user
              messages.
            </p>
          </div>
          <div className="top-actions">
            <div className="pill lang-pill">
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
            <button className="soft" onClick={connectWallet}>
              {walletAddress ? shortAddress(walletAddress) : t('connectWallet')}
            </button>
          </div>
        </header>

        <section className="hero">
          <div className="spark" />
          <p>Start with a suggested action or type your own prompt below.</p>
        </section>

        <section className="suggestions">
          {quickTiles.map((tile) => (
            <button key={tile.title} className="suggest-card" onClick={tile.action}>
              <div className="eyebrow">{tile.title}</div>
              <div className="suggest-desc">{tile.desc}</div>
            </button>
          ))}
        </section>

        <section className="main-grid">
          <div className="card chat-card">
            <div className="card-header">
              <div>
                <div className="eyebrow">Chat</div>
                <div className="muted">{t('chatHistory')}</div>
              </div>
              {requireWallet && <div className="badge warning">{t('walletNeeded')}</div>}
            </div>

            <div className="messages">
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
              {messages.length === 0 && (
                <div className="empty">Say hi to xiaoyue to begin.</div>
              )}
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
          </div>

          <div className="card side-card">
            <div className="agent-block">
              <img src="/agent-placeholder.svg" alt="xiaoyue mood" />
              <div>
                <div className="eyebrow">Agent</div>
                <div className="agent-name">
                  <span>晓月</span>
                  <span className="dot" style={{ background: mood.color }} />
                </div>
                <p className="muted">
                  {assistantMessages.at(-1)?.content ?? 'Ready for your next prompt.'}
                </p>
              </div>
            </div>

            <div className="card-section">
              <div className="card-header">
                <div className="eyebrow">{t('tokenPanel')}</div>
                <span className="muted">Solana RPC</span>
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
            </div>

            <div className="card-section">
              <div className="card-header">
                <div className="eyebrow">{t('analysisPanel')}</div>
                <span className="muted">EN / 中文</span>
              </div>
              {tokenAnalysis ? (
                <div className="analysis">{tokenAnalysis}</div>
              ) : (
                <div className="empty">No analysis yet. Run an analysis after fetching info.</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

