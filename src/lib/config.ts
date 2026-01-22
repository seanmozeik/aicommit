// src/lib/config.ts

export type Provider = 'cloudflare' | 'claude' | 'anthropic' | 'openai';

export interface CloudflareCredentials {
  accountId: string;
  apiToken: string;
}

export interface AnthropicCredentials {
  apiKey: string;
}

export interface OpenAICredentials {
  apiKey: string;
}

export interface SecretsConfig {
  defaultProvider: Provider;
  providers: {
    cloudflare?: CloudflareCredentials;
    anthropic?: AnthropicCredentials;
    openai?: OpenAICredentials;
    // claude uses CLI, no credentials stored
  };
}

export interface ProviderInfo {
  name: string;
  description: string;
  requiresCredentials: boolean;
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  cloudflare: {
    name: 'Cloudflare AI',
    description: 'Cloudflare Workers AI',
    requiresCredentials: true
  },
  claude: {
    name: 'Claude CLI',
    description: 'Anthropic Claude via CLI (requires claude installed)',
    requiresCredentials: false
  },
  anthropic: {
    name: 'Anthropic API',
    description: 'Direct Anthropic API access',
    requiresCredentials: true
  },
  openai: {
    name: 'OpenAI API',
    description: 'OpenAI GPT models',
    requiresCredentials: true
  }
};
