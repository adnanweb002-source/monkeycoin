import { randomBytes } from "crypto";

export function generateTxNumber(): string {
  // timestamp + random + small salt to avoid sequential look
  const id =
  Date.now().toString(36).slice(-4) +
  randomBytes(2).toString("hex");
  return `TX-${id}`;
}
