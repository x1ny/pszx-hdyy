import { expect, test } from "bun:test";
import { db } from "../../infra/db";
import { batches } from "../../shared/batches";
import { segmentSeat } from "./schema";

test("large seat inserts keep every row while staying within PostgreSQL parameter limits", () => {
  const seats = Array.from({ length: 1000 }, (_, i) => ({
    planId: 1,
    externalId: `s-${i}`,
    label: `A${i}`,
    ordinal: i,
  }));
  let inserted = 0;
  for (const batch of batches(seats)) {
    const query = db.insert(segmentSeat).values(batch).toSQL();
    expect(query.params.length).toBeLessThan(65535);
    inserted += batch.length;
  }
  expect(inserted).toBe(seats.length);
  expect([...batches([])]).toEqual([]);
});
