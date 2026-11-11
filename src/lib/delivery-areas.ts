import { parsePula } from "@/lib/money";

export interface DeliveryArea {
  name: string;
  fee: number; // thebe
}

/** Owners type one area per line: "Tlokweng = 150", "Mogoditshane: P200", "Block 8 free". */
export function parseDeliveryAreas(text: string): { areas: DeliveryArea[]; errors: string[] } {
  const areas: DeliveryArea[] = [];
  const errors: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.+?)\s*(?:[=:\-–]\s*|\s+)(free|p?\s*[\d.,]+(?:\s*pula)?)$/i.exec(line);
    if (!m) {
      errors.push(`"${line}": write it like "Tlokweng = 150"`);
      continue;
    }
    const fee = m[2].toLowerCase() === "free" ? 0 : parsePula(m[2]);
    if (fee === null) {
      errors.push(`"${line}": "${m[2]}" is not a valid amount`);
      continue;
    }
    areas.push({ name: m[1].trim(), fee });
  }
  return { areas, errors };
}

export function formatDeliveryAreas(areas: DeliveryArea[]): string {
  return areas.map((a) => `${a.name} = ${a.fee === 0 ? "free" : (a.fee / 100).toFixed(2)}`).join("\n");
}
