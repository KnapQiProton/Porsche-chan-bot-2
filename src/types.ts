export interface BotStatus {
  isConfigured: boolean;
  isLoggedIn: boolean;
  userTag: string | null;
  userId: string | null;
  guildCount: number;
  ping: number | null;
  startTime: string | null;
  error: string | null;
  availableProviders: {
    gemini: boolean;
    groq: boolean;
    mistral: boolean;
    deepseek: boolean;
    openrouter: boolean;
    pollinations: boolean;
  };
  creator: {
    name: string;
    id: string;
  };
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  provider?: string;
  timestamp: string;
  isCreator?: boolean;
}

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface TranslationResult {
  text: string;
  detectedSourceLanguage: string;
  provider: "LibreTranslate" | "DeepLX" | "MyMemory";
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  meta?: any;
}
