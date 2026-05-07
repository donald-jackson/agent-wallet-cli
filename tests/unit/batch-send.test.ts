/**
 * Unit tests for the batch-send command helpers.
 *
 * Tests CSV parsing, JSON loading, inline parsing, and error handling.
 */

import { describe, it, expect } from "vitest";

// Re-export helpers for testing (in the real repo these would be exported
// from the command module or extracted to a shared util).

// ─── CSV Parser ──────────────────────────────────────────────────────────────

function parseCSV(raw: string): { to: string; amount: string; reference?: string }[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error("CSV must contain a header row and at least one data row");
  }

  const headers = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const toIdx = headers.indexOf("to");
  const amountIdx = headers.indexOf("amount");
  const refIdx = headers.indexOf("reference");

  if (toIdx === -1 || amountIdx === -1) {
    throw new Error(
      'CSV header must include "to" and "amount" columns. Optional: "reference"'
    );
  }

  return lines.slice(1).map((line, i) => {
    const cols = line.split(",").map((c) => c.trim());
    const to = cols[toIdx];
    const amount = cols[amountIdx];

    if (!to || !amount) {
      throw new Error(`Row ${i + 2}: missing "to" or "amount" value`);
    }

    const recipient: { to: string; amount: string; reference?: string } = { to, amount };
    if (refIdx !== -1 && cols[refIdx]) {
      recipient.reference = cols[refIdx];
    }
    return recipient;
  });
}

// ─── Inline JSON Parser ─────────────────────────────────────────────────────

function parseInlineRecipients(jsonStr: string) {
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) {
    throw new Error("--recipients must be a JSON array");
  }
  return parsed.map((item: any, i: number) => {
    if (!item.to || !item.amount) {
      throw new Error(
        `Recipient at index ${i}: missing required "to" or "amount" field`
      );
    }
    return {
      to: String(item.to),
      amount: String(item.amount),
      reference: item.reference ? String(item.reference) : undefined,
    };
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("parseCSV", () => {
  it("parses a valid CSV with to, amount, reference", () => {
    const csv = `to,amount,reference
0xABCD1234,10.5,salary-jan
0xEF567890,20,salary-jan`;
    const result = parseCSV(csv);
    expect(result).toEqual([
      { to: "0xABCD1234", amount: "10.5", reference: "salary-jan" },
      { to: "0xEF567890", amount: "20", reference: "salary-jan" },
    ]);
  });

  it("parses CSV without reference column", () => {
    const csv = `to,amount
0xABCD1234,10
0xEF567890,20`;
    const result = parseCSV(csv);
    expect(result).toEqual([
      { to: "0xABCD1234", amount: "10" },
      { to: "0xEF567890", amount: "20" },
    ]);
  });

  it("handles columns in any order", () => {
    const csv = `amount,reference,to
5,bonus,0xABCD`;
    const result = parseCSV(csv);
    expect(result).toEqual([{ to: "0xABCD", amount: "5", reference: "bonus" }]);
  });

  it("handles Windows-style line endings", () => {
    const csv = "to,amount\r\n0xABCD,10\r\n0xEF56,20\r\n";
    const result = parseCSV(csv);
    expect(result).toHaveLength(2);
  });

  it("throws on missing header", () => {
    expect(() => parseCSV("0xABCD,10")).toThrow("header row");
  });

  it("throws on missing to column", () => {
    expect(() => parseCSV("address,amount\n0xABCD,10")).toThrow('"to"');
  });

  it("throws on missing amount column", () => {
    expect(() => parseCSV("to,value\n0xABCD,10")).toThrow('"amount"');
  });

  it("throws on empty amount in data row", () => {
    expect(() => parseCSV("to,amount\n0xABCD,")).toThrow("Row 2");
  });
});

describe("parseInlineRecipients", () => {
  it("parses valid JSON array", () => {
    const json = '[{"to":"0xABCD","amount":"10"},{"to":"0xEF56","amount":"20"}]';
    const result = parseInlineRecipients(json);
    expect(result).toEqual([
      { to: "0xABCD", amount: "10", reference: undefined },
      { to: "0xEF56", amount: "20", reference: undefined },
    ]);
  });

  it("includes reference when present", () => {
    const json = '[{"to":"0xABCD","amount":"10","reference":"payroll-001"}]';
    const result = parseInlineRecipients(json);
    expect(result[0].reference).toBe("payroll-001");
  });

  it("coerces numeric amounts to strings", () => {
    const json = '[{"to":"0xABCD","amount":10}]';
    const result = parseInlineRecipients(json);
    expect(result[0].amount).toBe("10");
  });

  it("throws on non-array input", () => {
    expect(() => parseInlineRecipients('{"to":"0x","amount":"1"}')).toThrow(
      "JSON array"
    );
  });

  it("throws on missing to field", () => {
    expect(() => parseInlineRecipients('[{"amount":"1"}]')).toThrow("index 0");
  });

  it("throws on missing amount field", () => {
    expect(() => parseInlineRecipients('[{"to":"0xABCD"}]')).toThrow("index 0");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseInlineRecipients("not json")).toThrow();
  });
});
