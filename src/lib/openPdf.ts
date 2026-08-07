import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// Öffnet eine als lokales Asset gebündelte PDF (Speisekarte/Getränkekarte). Expo hat
// keinen eingebauten PDF-Viewer und die App bindet auch keine WebView ein — der von
// Expo empfohlene Weg, ein gebündeltes Dokument trotzdem anzuzeigen, ist es, die Datei
// ins Cache-Verzeichnis zu kopieren und über den nativen Share-/Vorschau-Dialog zu
// öffnen (auf iOS zeigt das direkt eine Vorschau, auf Android eine App-Auswahl).
//
// Nutzt die neue File/Directory-API aus expo-file-system (SDK 54) statt der
// deprecateten FileSystem.copyAsync-Funktion.
export async function openBundledPdf(moduleId: number, fileName: string) {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();

  if (!asset.localUri) {
    throw new Error('PDF konnte nicht geladen werden.');
  }

  const source = new File(asset.localUri);
  const destination = new File(Paths.cache, fileName);
  // Bei wiederholtem Öffnen liegt die Datei vom letzten Mal noch im Cache —
  // copy() würde dann fehlschlagen, weil das Ziel schon existiert.
  if (destination.exists) {
    destination.delete();
  }
  source.copy(destination);

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Öffnen von Dateien wird auf diesem Gerät nicht unterstützt.');
  }

  await Sharing.shareAsync(destination.uri, { mimeType: 'application/pdf', dialogTitle: fileName });
}
