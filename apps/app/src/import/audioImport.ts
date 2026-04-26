import { SUPPORTED_AUDIO_MIME_TYPES } from "@tunely/shared";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { apiBaseUrl } from "../api/config";

export interface ImportedSong {
  id: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  importStatus: "ready";
}

export interface ImportAudioOptions {
  accessToken?: string;
  apiBaseUrl?: string;
}

export async function importAudioFromDevice(options: ImportAudioOptions = {}) {
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
    type: [...SUPPORTED_AUDIO_MIME_TYPES]
  });

  if (picked.canceled) {
    return [];
  }

  const importedSongs: ImportedSong[] = [];

  for (const asset of picked.assets) {
    const contentBase64 = await readAssetAsBase64(asset);
    const response = await fetch(`${options.apiBaseUrl ?? apiBaseUrl()}/api/songs/import`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {})
      },
      body: JSON.stringify({
        fileName: asset.name,
        mimeType: asset.mimeType ?? "audio/mpeg",
        sizeBytes: asset.size ?? base64ByteLength(contentBase64),
        title: stripExtension(asset.name),
        contentBase64
      })
    });

    if (!response.ok) {
      throw new Error(`Import failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { song: ImportedSong };
    importedSongs.push(payload.song);
  }

  return importedSongs;
}

async function readAssetAsBase64(asset: DocumentPicker.DocumentPickerAsset) {
  if (asset.file) {
    return blobToBase64(asset.file);
  }

  return FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64
  });
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function base64ByteLength(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;

  return Math.floor((value.length * 3) / 4) - padding;
}
