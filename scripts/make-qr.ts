/**
 * Generates docs/qr.png — the QR code shown at the top of the README.
 * Run after changing PUBLIC_APP_URL: npm run qr
 */
import { mkdirSync } from "node:fs";
import QRCode from "qrcode";
import { PUBLIC_APP_URL } from "../lib/config";

mkdirSync("docs", { recursive: true });
QRCode.toFile("docs/qr.png", PUBLIC_APP_URL, { width: 360, margin: 2, errorCorrectionLevel: "M" })
  .then(() => console.log(`docs/qr.png → ${PUBLIC_APP_URL}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
