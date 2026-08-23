import assert from "node:assert/strict";
import test from "node:test";

import { summarizeLiveFailure, withFailureDiagnostics } from "./support/failure-diagnostics.mjs";

test("offline safeguard: authenticated-test diagnostics redact arbitrary content", () => {
  const summary = summarizeLiveFailure(
    new Error(
      "Unauthorized HTTP 403 for Private Hero at https://character-service.dndbeyond.com/character/v5/character/4242"
    ),
    { stderr: "net::ERR_TIMED_OUT /private/session.json Private Hero" }
  );

  assert.match(summary, /error type: Error/);
  assert.match(summary, /HTTP status: 403/);
  assert.match(summary, /authentication or authorization/);
  assert.match(summary, /timeout/);
  assert.match(summary, /navigation or network/);
  assert.match(summary, /character-service\.dndbeyond\.com\/character\/v5\/character\/\[redacted\]/);
  assert.match(summary, /net::ERR_TIMED_OUT/);
  assert.doesNotMatch(summary, /Private Hero|4242|session\.json/);
});

test("offline subprocess diagnostics are appended only after failure", async () => {
  let diagnosticsRead = false;
  const successful = await withFailureDiagnostics(
    "synthetic server",
    () => {
      diagnosticsRead = true;
      return "unused";
    },
    async () => "ok"
  );
  assert.equal(successful, "ok");
  assert.equal(diagnosticsRead, false);

  await assert.rejects(
    withFailureDiagnostics("synthetic server", () => "full synthetic stderr", async () => {
      throw new Error("synthetic assertion failed");
    }),
    /synthetic assertion failed\nsynthetic server diagnostics:\nfull synthetic stderr/
  );
});
