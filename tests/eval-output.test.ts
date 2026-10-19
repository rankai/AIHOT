import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { accessSync, chmodSync, constants, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { REPO_ROOT } from "@aihot/backend/config";

const exec = promisify(execFile);

for (const kind of ["relations", "selection"] as const) {
  for (const target of ["writable", "invalid", "read-only"] as const) {
    test(`${kind} evaluation checks the ${target} data directory before model calls`, async (t) => {
      const dir = mkdtempSync(path.join(tmpdir(), "eval-output-"));
      t.after(() => {
        if (target === "read-only") chmodSync(path.join(dir, "data", "eval"), 0o700);
        rmSync(dir, { recursive: true, force: true });
      });
      const input = tag();
      const gold = kind === "relations" ? {
        caseId: input,
        a: { title: `${input} A`, source: "Example", firstParty: false, publishedAt: null, summary: null },
        b: { title: `${input} B`, source: "Example", firstParty: false, publishedAt: null, summary: null },
        gold: { relation: "UNRELATED" },
      } : {
        caseId: input,
        material: { title: input, originalTitle: null, publishedAt: null, sourceName: "Example", bodyZh: null, bodyOriginal: "Unrelated material with enough text for a complete prefilter input." },
        sourceFacts: { sourceKind: "rss", sourceTier: "T2" },
        gold: { decision: "reject" },
      };
      const goldPath = path.join(dir, "gold.jsonl");
      writeFileSync(goldPath, JSON.stringify(gold));
      const dataDir = path.join(dir, "data");
      if (target === "invalid") writeFileSync(dataDir, "not a directory");
      if (target === "read-only") {
        mkdirSync(path.join(dataDir, "eval"), { recursive: true });
        chmodSync(path.join(dataDir, "eval"), 0o555);
        assert.throws(() => accessSync(path.join(dataDir, "eval"), constants.W_OK), "fixture must actually be non-writable");
      }
      const provider = await stub(() => ({
        choices: [{ message: { content: JSON.stringify(kind === "relations"
          ? { a: "A", b: "B", relation: "UNRELATED", difference: "different events", confidence: 0.99 }
          : { label: "BLOCK", reason: "outside the industry" }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));
      t.after(() => provider.close());
      const run = exec(process.execPath, [
        // Give the source tree read access only; all writes must stay in this temporary directory.
        "--permission", "--allow-addons", "--allow-fs-read=*", `--allow-fs-write=${dir}`,
        path.join(REPO_ROOT, `scripts/eval-${kind}.ts`),
        "--gold", path.relative(REPO_ROOT, goldPath), "--models", "deepseek-flash", "--n", "1",
        ...(kind === "selection" ? ["--no-import"] : []),
      ], {
        cwd: dir,
        env: {
          ...process.env,
          AIHOT_DATA_DIR: dataDir,
          MODEL_CALLS_ENABLED: "true",
          PREFILTER_MODEL: "deepseek-flash",
          DEEPSEEK_BASE_URL: `${provider.url}/v1`,
          DEEPSEEK_API_KEY: "test-key",
        },
        timeout: 15_000,
      });
      if (target !== "writable") {
        await assert.rejects(run, (error: unknown) => {
          const failure = error as { code: number; stderr: string };
          assert.notEqual(failure.code, 0);
          assert.match(failure.stderr, target === "invalid" ? /ENOTDIR|EEXIST/ : /EACCES/);
          return true;
        });
        assert.equal(provider.hits(), 0, "invalid output must fail before a paid request");
        return;
      }
      const { stdout } = await run;
      const reportPath = stdout.split("\n").find((line) => line.startsWith("report: "))?.slice(8);
      assert.ok(reportPath, stdout);
      assert.equal(path.dirname(reportPath), path.join(dataDir, "eval"));
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      assert.equal(report.models["deepseek-flash"].summary.errors, 0);
      assert.equal(report.models["deepseek-flash"].cases.length, 1);
      assert.ok(provider.hits() > 0, "the real evaluation must reach the local model stub");
    });
  }
}
