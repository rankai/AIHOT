import { assertConfiguredTestDatabase, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { costs } from "@aihot/backend/admin/costs";
import type { CostResponse } from "@aihot/contracts/costs";

after(closeDb);

test("catalog failure degrades skills without blocking historical cost statistics", async () => {
  const [database] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(database!.name, database!.port);
  const suffix = tag();
  const service = `cost.catalog.${suffix}`;
  const range = { start: "2042-01-01T00:00:00.000Z", end: "2042-02-01T00:00:00.000Z" };
  const [receipt] = await sql<{ id: number }[]>`
    INSERT INTO receipts(logical_key,service,purpose,status,request,response,attempts)
    VALUES (${`catalog-${suffix}`},${service},'catalog-test','completed','{}','{}',1) RETURNING id`;
  try {
    await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,model,origin,status,started_at,environment,
        billing_provider,operation_id,model_id,cost,currency,cost_basis)
      VALUES (${receipt!.id},1,${service},'known-model','live','received',${new Date("2042-01-10T00:00:00.000Z")},'test',
        'catalog-fixture','catalog.operation','known-model',2.5,'CNY','actual')`;
    let catalogReads = 0;
    const loadCatalog = async (): Promise<never> => {
      catalogReads += 1;
      throw new Error("synthetic catalog validation failure");
    };
    const overview: CostResponse = await costs(
      { ...range, view: "overview", groupBy: "model", billingProvider: "catalog-fixture", limit: 50 },
      { loadCatalog },
    );
    assert.equal(overview.view, "overview");
    if (overview.view === "overview") {
      assert.equal(overview.totals.amountBuckets[0]!.amount, "2.500000");
      assert.deepEqual(overview.facets.skills, []);
      assert(overview.facets.providers.some((facet) => facet.value === "catalog-fixture"));
      assert(overview.facets.services.some((facet) => facet.value === service));
      assert(overview.facets.models.some((facet) => facet.value === "known-model"));
      assert.equal(overview.warnings.find((warning) => warning.code === "skills_catalog_unavailable")?.count, 1);
      assert.equal(catalogReads, 1);
    }
    const details = await costs({ ...range, view: "details", billingProvider: "catalog-fixture", limit: 50 });
    assert.equal(details.view, "details");
    if (details.view === "details") assert.equal(details.rows.length, 1);
  } finally {
    await sql`DELETE FROM receipts WHERE id=${receipt!.id}`;
  }
});
