import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      title: 'xiaoyue (晓月)',
      subtitle: 'Cybernetic Solana agent for token intel, analysis, and chat.',
      inputPlaceholder: 'Ask me anything…',
      send: 'Send',
      connectWallet: 'Connect Wallet',
      walletNeeded: 'Connect your Solana wallet to keep chatting after 4 messages.',
      tokenPlaceholder: 'Paste a token mint address',
      fetchInfo: 'Get token info',
      analyze: 'Analyze token',
      language: 'Language',
      mood: 'Mood',
      tokenPanel: 'Token Intel',
      analysisPanel: 'Analysis',
      statusReady: 'Ready',
      statusThinking: 'Processing…',
      statusIdle: 'Standing by',
      freeMessages: 'Free messages left: {{count}}',
      chatHistory: 'Chat history auto-loads. No login required.',
    },
  },
  zh: {
    translation: {
      title: '晓月 xiaoyue',
      subtitle: '面向 Solana 的赛博少女特工，提供聊天、代币情报与分析。',
      inputPlaceholder: '想问什么都可以…',
      send: '发送',
      connectWallet: '连接钱包',
      walletNeeded: '超过 4 条对话需连接 Solana 钱包。',
      tokenPlaceholder: '粘贴代币 Mint 地址',
      fetchInfo: '获取代币信息',
      analyze: '分析代币',
      language: '语言',
      mood: '状态',
      tokenPanel: '代币情报',
      analysisPanel: '分析',
      statusReady: '就绪',
      statusThinking: '处理中…',
      statusIdle: '待命',
      freeMessages: '剩余免费消息：{{count}}',
      chatHistory: '聊天记录自动加载，无需登录。',
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem('lang') || 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;

