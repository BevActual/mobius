export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  /** One line about it. */
  note: string;
  needsKey: boolean;
  /** Where to make a key. Only for providers that need one. */
  keyUrl?: string;
}

/**
 * Services that speak the OpenAI chat format, so picking one only fills in the server address. The addresses are
 * the ones each service documents for that format; whether a key works is between you and the service.
 */
export const PROVIDERS: readonly Provider[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', note: 'GPT models.', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1/', note: 'Claude models, through their OpenAI-compatible layer.', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', note: 'Gemini models from Google AI Studio.', needsKey: true, keyUrl: 'https://aistudio.google.com/app/apikey' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', note: 'One key for hundreds of models.', needsKey: true, keyUrl: 'https://openrouter.ai/keys' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', note: 'DeepSeek chat and reasoning models.', needsKey: true, keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', note: 'Fast hosted open models.', needsKey: true, keyUrl: 'https://console.groq.com/keys' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', note: 'Hosted open models.', needsKey: true, keyUrl: 'https://api.together.ai/settings/api-keys' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', note: 'Mistral models.', needsKey: true, keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'xai', name: 'xAI', baseUrl: 'https://api.x.ai/v1', note: 'Grok models.', needsKey: true, keyUrl: 'https://console.x.ai/' },
  { id: 'fireworks', name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', note: 'Hosted open models.', needsKey: true, keyUrl: 'https://app.fireworks.ai/settings/users/api-keys' },
  { id: 'huggingface', name: 'Hugging Face', baseUrl: 'https://router.huggingface.co/v1', note: 'Inference providers behind one address.', needsKey: true, keyUrl: 'https://huggingface.co/settings/tokens' },
  { id: 'ollama', name: 'Ollama (this computer)', baseUrl: 'http://127.0.0.1:11434/v1', note: 'Models you run with Ollama. No key needed.', needsKey: false },
  { id: 'lmstudio', name: 'LM Studio (this computer)', baseUrl: 'http://127.0.0.1:1234/v1', note: 'The local server in LM Studio. No key needed.', needsKey: false },
  { id: 'llamacpp', name: 'llama.cpp (this computer)', baseUrl: 'http://127.0.0.1:8080/v1', note: 'A llama-server you started yourself. No key needed.', needsKey: false },
];

export const findProvider = (id: string): Provider | undefined => PROVIDERS.find((p) => p.id === id);

const normal = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();

/** The provider whose address this is, so the form can show it as chosen. */
export const providerForUrl = (url: string): Provider | undefined => (normal(url) === '' ? undefined : PROVIDERS.find((p) => normal(p.baseUrl) === normal(url)));
