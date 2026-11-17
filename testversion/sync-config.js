// Einstellungen für die Synchronisation mit OneDrive.
// clientId und tenant stammen aus der App-Registrierung im Microsoft-Konto der Schule (siehe ANLEITUNG-Synchronisation.md).
// Die Werte lassen sich auch in der App unter Einstellungen › Synchronisation pro Gerät eintragen.
const SYNC_CONFIG = {
  clientId: '',             // Anwendungs-ID (Client-ID), z. B. '1a2b3c4d-....'
  tenant: 'organizations',  // Verzeichnis-ID (Mandanten-ID) der Schule; 'organizations' geht für jedes Schulkonto
  folder: 'Unterrichtsheft' // Ordner im OneDrive, in dem die Daten liegen
};
