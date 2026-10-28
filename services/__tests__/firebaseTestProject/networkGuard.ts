// Garde RÉSEAU du lot N1 : bloque toute connexion sortante qui n'est pas locale (boucle locale), avant même qu'elle parte.
//
// Installé AVANT le chargement du SDK Firebase (jest `setupFiles`). Couvre les sockets (net, tls, donc http, https, http2 et gRPC),
// la résolution de noms (dns) et `fetch`. Une tentative bloquée est enregistrée : les tests vérifient qu'il n'y en a eu AUCUNE.

import dns from 'dns';
import net from 'net';
import { GuardError, isLoopbackHost } from './guards';

const blocked: string[] = [];
export const getBlockedAttempts = (): readonly string[] => blocked;
export const resetBlockedAttempts = (): void => void (blocked.length = 0);

function refuse(kind: string, destination: string): never {
  blocked.push(`${kind}:${destination}`);
  throw new GuardError(`RÉSEAU BLOQUÉ (${kind}) vers « ${destination} » : seules les connexions locales sont autorisées.`);
}

/** Destination d'un appel `socket.connect(...)` ; null = socket local (chemin). PORTE FERMÉE par défaut : une forme d'arguments
 * inconnue est traitée comme une destination inconnue, donc bloquée. (Node appelle `socket.connect([options, rappel])` avec un
 * TABLEAU depuis net.connect : une première version ne le voyait pas et laissait passer les adresses IP littérales.) */
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

let installed = false;

export function installNetworkGuard(): void {
  if (installed) return;
  installed = true;

  // Sockets : net.Socket est la base de tls.TLSSocket, de http, https, http2 et de gRPC.
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function patchedConnect(this: net.Socket, ...args: unknown[]) {
    const destination = socketDestination(args);
    if (destination !== null && !isLoopbackHost(destination)) refuse('socket', destination);
    return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;

  // Résolution de noms : seuls les noms locaux sont résolus.
  const originalLookup = dns.lookup;
  (dns as { lookup: unknown }).lookup = function patchedLookup(hostname: string, ...rest: unknown[]) {
    if (!isLoopbackHost(hostname)) refuse('dns', hostname);
    return (originalLookup as (...a: unknown[]) => unknown)(hostname, ...rest);
  };
  const originalPromiseLookup = dns.promises.lookup;
  (dns.promises as { lookup: unknown }).lookup = async function patchedPromiseLookup(hostname: string, ...rest: unknown[]) {
    if (!isLoopbackHost(hostname)) refuse('dns', hostname);
    return (originalPromiseLookup as (...a: unknown[]) => Promise<unknown>)(hostname, ...rest);
  };

  // fetch (Authentication utilise fetch) : l'adresse est vérifiée avant l'envoi.
  const originalFetch = globalThis.fetch;
  if (originalFetch) {
    globalThis.fetch = (async (input: unknown, init?: unknown) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as { url?: string }).url ?? '';
      let host = '';
      try {
        host = new URL(raw).hostname;
      } catch {
        refuse('fetch', raw || '(adresse illisible)');
      }
      if (!isLoopbackHost(host)) refuse('fetch', host);
      return (originalFetch as (...a: unknown[]) => Promise<Response>)(input, init);
    }) as typeof fetch;
  }
}
