// Lit la clé d'API de production (variable d'environnement et/ou TEXTE du fichier `.env` local, jamais importé), uniquement pour REFUSER qu'elle serve en N2.
// Ce module est le seul de `real/` autorisé à lire cette configuration. Sans clé lisible : ERREUR explicite (jamais de contrôle silencieusement vide).
import fs from 'fs';
import path from 'path';
import { productionApiKeysFromEnvironment, RealGuardError } from './guardsReal';

export const ENV_FILE = path.join(__dirname, '..', '..', '..', '..', '.env');

export function readProductionApiKeys(env: Record<string, string | undefined> = process.env, envFile: string = ENV_FILE): string[] {
  let text: string | null = null;
  if (fs.existsSync(envFile)) {
    try {
      text = fs.readFileSync(envFile, 'utf8');
    } catch {
      throw new RealGuardError('le fichier .env local est illisible : référence de PRODUCTION introuvable — ARRÊT.'); // jamais un contrôle silencieusement vide
    }
  }
  return productionApiKeysFromEnvironment(env, text);
}
