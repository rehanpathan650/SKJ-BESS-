import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { View } from "react-native";
import { api } from "../lib/session";
import { Button, ErrorBox, Notice, P, s } from "./ui";

type Picked = { uri: string; name: string; type: string };
const MAX = 12;
const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp", "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];

/** Capture bills with the camera, or pick PDFs/images/spreadsheets, and upload them in one batch. */
export function BillUpload({ customerId, projectId, onDone, send }: {
  customerId?: string; projectId?: string; onDone: () => void;
  /** Custom destination (e.g. start a quotation); default uploads to the customer. */
  send?: (form: FormData) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload(files: Picked[]) {
    if (!files.length) return;
    const form = new FormData();
    files.slice(0, MAX).forEach((f) => form.append("files", f as unknown as Blob)); // React Native file descriptor
    if (projectId) form.append("project_id", projectId);
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      if (send) await send(form);
      else {
        const res = await api.customers.uploadBills(customerId!, form);
        setMsg(`${res.length} bill(s) uploaded. They are being scanned and read; you'll be notified when ready to review.`);
      }
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  async function camera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setError(new Error("Camera permission is needed to photograph bills."));
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, exif: false });
    if (!r.canceled) await upload(r.assets.map((a, i) => ({ uri: a.uri, name: `bill-photo-${Date.now()}-${i}.jpg`, type: "image/jpeg" })));
  }

  async function gallery() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: MAX,
      quality: 0.8, exif: false });
    if (!r.canceled) await upload(r.assets.map((a, i) => ({ uri: a.uri, name: a.fileName ?? `bill-${i}.jpg`, type: a.mimeType ?? "image/jpeg" })));
  }

  async function documents() {
    const r = await DocumentPicker.getDocumentAsync({ type: ALLOWED, multiple: true, copyToCacheDirectory: true });
    if (!r.canceled) await upload(r.assets.map((a) => ({ uri: a.uri, name: a.name, type: a.mimeType ?? "application/pdf" })));
  }

  return (
    <View>
      <ErrorBox error={error} />
      {msg && <Notice tone="ok">{msg}</Notice>}
      <View style={[s.row, { gap: 8 }]}>
        <Button title="📷 Photograph bill" variant="primary" onPress={camera} loading={busy} />
        <Button title="Photos" onPress={gallery} disabled={busy} />
        <Button title="PDF / Excel" onPress={documents} disabled={busy} />
      </View>
      <P small muted style={{ marginTop: 6 }}>Up to {MAX} files, 15 MB each. Files are malware-scanned; extracted values must be reviewed.</P>
    </View>
  );
}
