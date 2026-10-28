// F3b — correspondance des erreurs Firestore du port des modules (pure) ; aucune opération Firestore n'est jouée ici (jamais exécutée en réel à ce jour).

import { toModulesError } from '../firebase/firestoreModulesBackend';
import { ModulesError } from '../sharedModules/modulesPort';

jest.mock('firebase/firestore', () => ({ Timestamp: class {}, collection: jest.fn(), deleteDoc: jest.fn(), doc: jest.fn(), getDocFromServer: jest.fn(), getDocsFromServer: jest.fn(), setDoc: jest.fn(), updateDoc: jest.fn(), writeBatch: jest.fn() }));

describe('Erreurs Firestore → port des modules', () => {
  it('chaque code connu est traduit ; tout inconnu reste « unknown » (jamais pris pour un succès)', () => {
    const cases: [string, string][] = [
      ['permission-denied', 'permission'],
      ['firestore/permission-denied', 'permission'],
      ['unauthenticated', 'permission'],
      ['not-found', 'not_found'],
      ['already-exists', 'exists'],
      ['unavailable', 'network'],
      ['deadline-exceeded', 'network'],
      ['internal', 'unknown'],
      ['', 'unknown'],
    ];
    for (const [code, expected] of cases) expect({ code, mapped: toModulesError({ code }).code }).toEqual({ code, mapped: expected });
    expect(toModulesError(new Error('Failed to get document because the client is offline.')).code).toBe('network');
    expect(toModulesError(null).code).toBe('unknown');
    const own = new ModulesError('exists', 'x');
    expect(toModulesError(own)).toBe(own);
  });

  it('un refus d’accès ne porte aucun détail technique à l’utilisateur', () => {
    expect(toModulesError({ code: 'permission-denied', message: 'Missing or insufficient permissions. rules line 42' }).message).toBe('Accès refusé par les règles de sécurité.');
  });
});
