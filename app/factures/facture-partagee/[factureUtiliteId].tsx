import { RepartitionScreen } from '@/features/immobilier/screens/RepartitionScreen';

// Même écran que app/immobilier/facture-utility/[factureUtiliteId].tsx —
// accès direct depuis Factures pour une facture_partagee sans bien (Factures
// autonome) ou pour retrouver une facture_partagee née depuis Immobilier sans
// repasser par le bien. Un seul moteur, voir services/utilityBillingService.ts.
export default RepartitionScreen;
