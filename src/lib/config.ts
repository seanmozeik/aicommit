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
  anthropic: {
    description: 'Direct Anthropic API access',
    name: 'Anthropic API',
    requiresCredentials: true
  },
  claude: {
    description: 'Anthropic Claude via CLI (requires claude installed)',
    name: 'Claude CLI',
    requiresCredentials: false
  },
  cloudflare: {
    description: 'Cloudflare Workers AI',
    name: 'Cloudflare AI',
    requiresCredentials: true
  },
  openai: {
    description: 'OpenAI GPT models',
    name: 'OpenAI API',
    requiresCredentials: true
  }
};
