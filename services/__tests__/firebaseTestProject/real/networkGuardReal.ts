// Garde RÉSEAU du lot N2 : seuls la boucle locale et les trois services du projet de test (Authentication, jeton, Firestore) sont
// joignables ; toute autre destination est refusée AVANT l'envoi. PORTE FERMÉE par défaut.
//
// Limite connue (documentée) : les serveurs Google sont communs à tous les projets, le réseau ne peut donc pas distinguer le projet
// de test de la production. La protection de ce point repose sur : l'identifiant de projet autorisé, la clé d'API du projet de test
// exigée dans chaque requête Authentication, le contrôle des chemins `/projects/<id>/…`, la double confirmation manuelle et la
// vérification de l'audience du jeton (harnessReal.ts).
//
// gRPC peut se connecter à une adresse IP déjà résolue : les adresses obtenues en résolvant un hôte AUTORISÉ sont mémorisées et
// seules celles-là sont admises en plus. Une adresse inconnue est bloquée (échec bruyant, jamais silencieux).
//
// Installé AVANT le chargement du SDK (jest `setupFiles`). Réversible (uninstallNetworkGuard) pour être testé hors N2.

import dns from 'dns';
import net from 'net';
import { checkRequestUrl, isAllowedHost, isLoopbackHost, RealGuardError } from './guardsReal';

const blocked: string[] = [];
const allowedIps = new Set<string>();
const allowedLog = new Map<string, number>();
let testApiKey: string | null = null;

export const getBlockedAttempts = (): readonly string[] => blocked;
export const resetBlockedAttempts = (): void => void (blocked.length = 0);
/** Destinations réellement contactées (hôte ou adresse → nombre de connexions), pour le rapport. */
export const getAllowedDestinations = (): Record<string, number> => Object.fromEntries(allowedLog);
/** Clé d'API du projet de test : exigée dans chaque requête Authentication. Sans elle, ces requêtes sont bloquées. */
export const configureGuard = (apiKey: string | null): void => void (testApiKey = apiKey);

function refuse(kind: string, destination: string): never {
  blocked.push(`${kind}:${destination}`);
  throw new RealGuardError(`RÉSEAU BLOQUÉ (${kind}) vers « ${destination} » : seuls la boucle locale et le projet de test sont autorisés.`);
}

/** Décision pure pour une destination de socket (hôte ou adresse IP). */
export const isAllowedSocketDestination = (destination: string): boolean => isAllowedHost(destination) || allowedIps.has(destination.toLowerCase());

function socketDestination(args: unknown[]): string | null {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (typeof first === 'object' && first !== null) {
    const o = first as { host?: string; hostname?: string; path?: string; port?: number | string };
    if (o.path && o.port === undefined) return null;
    return o.host ?? o.hostname ?? 'localhost';
  }
  if (typeof first === 'string' && Number.isNaN(Number(first))) return null; // chemin de socket local
  if (typeof first === 'number' || typeof first === 'string') return typeof args[1] === 'string' ? args[1] : 'localhost';
  return '(destination inconnue)';
}

function remember(host: string, result: unknown): void {
  const add = (value: unknown) => {
    const address = typeof value === 'string' ? value : (value as { address?: unknown } | null)?.address;
    if (typeof address === 'string') allowedIps.add(address.toLowerCase());
  };
  if (Array.isArray(result)) result.forEach(add);
  else add(result);
  allowedLog.set(host, (allowedLog.get(host) ?? 0) + 1);
}

type AnyFn = (...args: unknown[]) => unknown;
const originals: { connect?: AnyFn; fetch?: typeof fetch; patched: [object, string, unknown][] } = { patched: [] };
let installed = false;

function patch(target: object, name: string, replacement: unknown): void {
  originals.patched.push([target, name, (target as Record<string, unknown>)[name]]);
  (target as Record<string, unknown>)[name] = replacement;
}

/** Enveloppe une fonction DNS : refuse les hôtes non autorisés et mémorise les adresses des hôtes autorisés. */
function guardedCallbackResolver(original: AnyFn): AnyFn {
  return function guarded(hostname: unknown, ...rest: unknown[]) {
    const host = String(hostname);
    if (!isAllowedHost(host)) refuse('dns', host);
    const last = rest[rest.length - 1];
    if (typeof last === 'function') {
      rest[rest.length - 1] = (error: unknown, ...values: unknown[]) => {
        if (!error) remember(host, values[0]);
        (last as AnyFn)(error, ...values);
      };
    }
    return original(hostname, ...rest);
  };
}

function guardedPromiseResolver(original: AnyFn): AnyFn {
  return async function guarded(hostname: unknown, ...rest: unknown[]) {
    const host = String(hostname);
    if (!isAllowedHost(host)) refuse('dns', host);
    const result = await original(hostname, ...rest);
    remember(host, result);
    return result;
  };
}

export function installNetworkGuard(): void {
  if (installed) return;
  installed = true;

  originals.connect = net.Socket.prototype.connect as unknown as AnyFn;
  net.Socket.prototype.connect = function patchedConnect(this: net.Socket, ...args: unknown[]) {
    const destination = socketDestination(args);
    if (destination !== null && !isLoopbackHost(destination)) {
      if (!isAllowedSocketDestination(destination)) refuse('socket', destination);
      allowedLog.set(destination, (allowedLog.get(destination) ?? 0) + 1);
    }
    return (originals.connect as AnyFn).apply(this, args) as net.Socket;
  } as typeof net.Socket.prototype.connect;

  for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny'] as const) {
    const current = (dns as unknown as Record<string, unknown>)[name];
    if (typeof current === 'function') patch(dns, name, guardedCallbackResolver(current as AnyFn));
    const currentPromise = (dns.promises as unknown as Record<string, unknown>)[name];
    if (typeof currentPromise === 'function') patch(dns.promises, name, guardedPromiseResolver(currentPromise as AnyFn));
  }

  originals.fetch = globalThis.fetch;
  if (originals.fetch) {
    const originalFetch = originals.fetch;
    globalThis.fetch = (async (input: unknown, init?: unknown) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as { url?: string }).url ?? '';
      const decision = checkRequestUrl(raw, testApiKey);
      if (!decision.ok) refuse('fetch', `${raw.split('?')[0] || '(adresse illisible)'} — ${decision.reason}`);
      return (originalFetch as unknown as AnyFn)(input, init) as Promise<Response>;
    }) as typeof fetch;
  }
}

/** Restaure tout (utilisé par les tests hors N2 pour ne pas laisser de patch dans le processus). */
export function uninstallNetworkGuard(): void {
  if (!installed) return;
  net.Socket.prototype.connect = originals.connect as unknown as typeof net.Socket.prototype.connect;
  for (const [target, name, original] of originals.patched.splice(0).reverse()) (target as Record<string, unknown>)[name] = original;
  if (originals.fetch) globalThis.fetch = originals.fetch;
  allowedIps.clear();
  allowedLog.clear();
  installed = false;
}
