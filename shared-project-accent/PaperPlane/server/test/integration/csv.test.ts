import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../../src/index";
import { prisma } from "../../src/config";
import { CSV_COLUMNS } from "../../src/csv";
import { createTestFlightEntry, getOrCreateMichaelSmithUser } from "../fixtures/factories";

const header = CSV_COLUMNS.join(",");
const row = '2026-09-25,N54321,KLAX,KSFO,"KLAX, KSFO",2.5,1.5,1,true,false,false,0.5,2,0,"Training, XC",https://example.com/page';

describe("CSV portability", () => {
  let cleanup: Awaited<ReturnType<typeof getOrCreateMichaelSmithUser>>;
  beforeEach(async () => { cleanup = await getOrCreateMichaelSmithUser(); });
  afterEach(async () => { await cleanup(); });

  it("previews without writing, then imports and round trips all supported fields", async () => {
    const csv = `${header}\r\n${row}\r\n`;
    const before = await prisma.flightEntry.count({ where: { userId: cleanup.user.id } });
    const preview = await request(app).post("/api/v1/flight_entry/csv/preview").send({ csv });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ importableCount: 1, errors: [], duplicates: [] });
    expect(await prisma.flightEntry.count({ where: { userId: cleanup.user.id } })).toBe(before);

    const imported = await request(app).post("/api/v1/flight_entry/csv/import").send({ csv });
    expect(imported.status).toBe(201);
    expect(imported.body.imported).toBe(1);
    const exported = await request(app).get("/api/v1/flight_entry/csv");
    expect(exported.status).toBe(200);
    expect(exported.text).toContain(row);

    const repeated = await request(app).post("/api/v1/flight_entry/csv/import").send({ csv });
    expect(repeated.body).toMatchObject({ imported: 0 });
    expect(repeated.body.skippedDuplicates).toHaveLength(1);
  });

  it("reports row and field errors and refuses the entire import", async () => {
    const before = await prisma.flightEntry.count({ where: { userId: cleanup.user.id } });
    const bad = `${header}\n2026-02-30,N123,ABC,KSFO,,oops,,,,,,,,,,\n`;
    const preview = await request(app).post("/api/v1/flight_entry/csv/preview").send({ csv: bad });
    expect(preview.status).toBe(200);
    expect(preview.body.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 2, field: "date" }),
      expect.objectContaining({ row: 2, field: "srcIcao" }),
      expect.objectContaining({ row: 2, field: "totalFlightTime" }),
    ]));
    const imported = await request(app).post("/api/v1/flight_entry/csv/import").send({ csv: bad });
    expect(imported.status).toBe(400);
    expect(await prisma.flightEntry.count({ where: { userId: cleanup.user.id } })).toBe(before);
  });

  it("exports only the authenticated pilot's entries", async () => {
    const other = await createTestFlightEntry({
      date: new Date("2026-09-25T00:00:00.000Z"), tailNumber: "N54321",
      srcIcao: "KLAX", destIcao: "KSFO", totalFlightTime: 2.5,
      remarks: "OTHER USER SECRET",
    });
    try {
      const exported = await request(app).get("/api/v1/flight_entry/csv");
      expect(exported.status).toBe(200);
      expect(exported.text).toContain(header);
      expect(exported.text).not.toContain("OTHER USER SECRET");
      const preview = await request(app).post("/api/v1/flight_entry/csv/preview").send({ csv: `${header}\n${row}\n` });
      expect(preview.body.importableCount).toBe(1);
    } finally { await other(); }
  });
});
