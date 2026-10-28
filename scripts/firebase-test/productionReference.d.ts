export const ENV_NAMES: Record<'apiKey' | 'authDomain' | 'projectId' | 'storageBucket' | 'messagingSenderId' | 'appId', string>;
export function parseEnvText(text: string): { values: Record<string, string>; conflicts: string[] };
export function resolveProductionReference(
  env: Record<string, string | undefined>,
  envFile: string | null,
  constants: { projectIds: readonly string[]; projectNumbers: readonly string[] },
): { ok: true; apiKeys: string[] } | { ok: false; problems: string[] };
