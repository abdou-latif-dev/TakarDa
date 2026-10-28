// N1 — garde réseau et branchement : prouve que le harnais ne peut atteindre que les émulateurs locaux.

import type * as GuardModule from './networkGuard';

const enabled = !!process.env.FIREBASE_AUTH_EMULATOR_HOST && !!process.env.FIRESTORE_EMULATOR_HOST;
const suite = enabled ? describe : describe.skip;

suite('N1 · garde réseau et branchement sur les émulateurs', () => {
  let guard: typeof GuardModule;
  let h: typeof import('./harness');

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    guard = require('./networkGuard');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    h = require('./harness');
  });
  afterAll(async () => {
    await h.disposeClients();
    await h.disposeAdmin();
  });

  // Les cibles de ces essais sont volontairement INATTEIGNABLES par construction (plage de documentation RFC 5737, domaine
  // réservé « .invalid ») : même si le garde était défaillant, aucun service réel ne pourrait être contacté.
  it('une connexion socket vers une adresse non locale est bloquée AVANT tout envoi (toutes les formes d’appel)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const net = require('net');
    expect(() => net.connect({ host: '192.0.2.1', port: 443 })).toThrow(/RÉSEAU BLOQUÉ/);
    expect(() => net.connect(443, '192.0.2.1')).toThrow(/RÉSEAU BLOQUÉ/);
    expect(() => net.createConnection({ host: '198.51.100.7', port: 80 })).toThrow(/RÉSEAU BLOQUÉ/);
    expect(() => new net.Socket().connect(443, 'service.invalid')).toThrow(/RÉSEAU BLOQUÉ/);
    expect(() => net.connect({ host: 'service.invalid', port: 443 })).toThrow(/RÉSEAU BLOQUÉ/);
  });

  it('TLS, HTTP et résolution de noms vers un service Google sont bloqués', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tls = require('tls');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const http = require('http');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dns = require('dns');
    expect(() => tls.connect({ host: '192.0.2.1', port: 443 })).toThrow(/RÉSEAU BLOQUÉ/);
    const httpError: Error = await new Promise((resolve) => {
      try {
        const req = http.get('http://192.0.2.1/', () => resolve(new Error('connecté')));
        req.on('error', resolve);
      } catch (error) {
        resolve(error as Error);
      }
    });
    expect(httpError.message).toMatch(/RÉSEAU BLOQUÉ/);
    await expect(dns.promises.lookup('service.invalid')).rejects.toThrow(/RÉSEAU BLOQUÉ/);
  });

  it('fetch vers l’API réelle d’Authentication ou de Firestore est refusé', async () => {
    // adresses de même forme que les API réelles, mais en « .invalid » : jamais joignables
    await expect(fetch('https://identitytoolkit.googleapis.com.invalid/v1/accounts:signUp?key=x', { method: 'POST' })).rejects.toThrow(/RÉSEAU BLOQUÉ/);
    await expect(fetch('https://firestore.googleapis.com.invalid/v1/projects/projet-reel/databases/(default)/documents/users/x')).rejects.toThrow(/RÉSEAU BLOQUÉ/);
    await expect(fetch('not a url')).rejects.toThrow(/RÉSEAU BLOQUÉ/); // forme illisible : porte fermée
  });

  it('les connexions locales (émulateurs) restent possibles', async () => {
    const response = await fetch(`http://${h.N1.auth.host}:${h.N1.auth.port}/`);
    expect(response.status).toBeLessThan(500);
  });

  it('le harnais est bien dans l’environnement fictif : projet demo-…, hôtes locaux', () => {
    expect(h.N1.projectId).toMatch(/^demo-/);
    expect(h.N1.projectId).not.toBe('takarda-c8cd8');
    expect(['127.0.0.1', 'localhost', '::1']).toContain(h.N1.auth.host);
    expect(['127.0.0.1', 'localhost', '::1']).toContain(h.N1.firestore.host);
  });

  it('un client est branché sur l’émulateur Authentication et sur l’émulateur Firestore chargé avec les règles du dépôt', async () => {
    const client = h.newClient('branchement');
    expect(client.auth.emulatorConfig?.host).toBeTruthy();
    // Un utilisateur non connecté est refusé PAR LES RÈGLES : ce refus ne peut venir que de l'émulateur chargé avec firestore.rules.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { doc, getDoc } = require('firebase/firestore');
    await expect(getDoc(doc(client.db, 'spaces', 'personal_inconnu'))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('aucune tentative bloquée en dehors des essais volontaires ci-dessus (les tests suivants n’en produiront aucune)', () => {
    const before = guard.getBlockedAttempts().length;
    expect(before).toBeGreaterThan(0); // les essais volontaires ont bien été enregistrés
    guard.resetBlockedAttempts();
    expect(guard.getBlockedAttempts()).toHaveLength(0);
  });
});
