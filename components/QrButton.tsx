"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { PUBLIC_APP_URL } from "@/lib/config";

/**
 * "לנסות בטלפון" — shows a QR code of the app's own address, so someone watching a demo
 * can open it on their phone. Built from window.location, so it is right on any deployment.
 */
export function QrButton() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [img, setImg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || img) return;
    // A phone can't open localhost, so a local run points at the production deployment instead.
    const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
    const target = isLocal ? PUBLIC_APP_URL : window.location.origin;
    setUrl(target);
    QRCode.toDataURL(target, { width: 320, margin: 1, errorCorrectionLevel: "M" }).then(setImg).catch(() => setImg(null));
  }, [open, img]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        📱 לנסות בטלפון
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="קוד QR לאפליקציה" onClick={(e) => e.stopPropagation()}>
            <h2>סרקו כדי לנסות בעצמכם</h2>
            {img ? <img src={img} alt={`קוד QR לכתובת ${url}`} width={240} height={240} /> : <div className="qr-placeholder" />}
            <a href={url} dir="ltr" target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//, "")}</a>
            <button className="btn" onClick={() => setOpen(false)}>סגירה</button>
          </div>
        </div>
      )}
    </>
  );
}
