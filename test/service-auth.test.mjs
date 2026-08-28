import assert from "node:assert/strict";
import test from "node:test";

import {
  DdbServiceRequestError,
  fetchAuthenticatedDdbJson,
} from "../dist/service-auth.js";

function pageReturning(result, onEvaluate = () => {}) {
  return {
    evaluate: async (_callback, argument) => {
      onEvaluate(argument);
      return result;
    },
  };
}

test("returns authenticated JSON without exposing token material to the caller", async () => {
  const body = { success: true, data: { id: 4242 } };
  let browserArguments;
  const result = await fetchAuthenticatedDdbJson(
    pageReturning({ kind: "success", body }, (argument) => { browserArguments = argument; }),
    "https://character-service.dndbeyond.com/character/v5/character/4242"
  );

  assert.deepEqual(result, body);
  assert.equal(browserArguments.url, "https://character-service.dndbeyond.com/character/v5/character/4242");
  assert.equal(browserArguments.authUrl, "https://auth-service.dndbeyond.com/v1/cobalt-token");
  assert.deepEqual(Object.keys(browserArguments).sort(), ["authUrl", "timeoutMs", "url"]);
});

test("rejects unsafe service URLs before browser access", async () => {
  let evaluated = false;
  const page = pageReturning({ kind: "success", body: {} }, () => { evaluated = true; });

  await assert.rejects(fetchAuthenticatedDdbJson(page, "http://character-service.dndbeyond.com/value"), /must use HTTPS/);
  await assert.rejects(fetchAuthenticatedDdbJson(page, "https://example.test/value"), /dndbeyond\.com host/);
  await assert.rejects(fetchAuthenticatedDdbJson(page, "https://user:pass@www.dndbeyond.com/value"), /dndbeyond\.com host/);
  assert.equal(evaluated, false);
});

test("classifies token and service authentication failures consistently", async () => {
  await assert.rejects(
    fetchAuthenticatedDdbJson(pageReturning({ kind: "authentication-http-error", status: 401 }), "https://www.dndbeyond.com/api/value"),
    /mysterium-auth login/
  );
  await assert.rejects(
    fetchAuthenticatedDdbJson(pageReturning({ kind: "authentication-shape-error" }), "https://www.dndbeyond.com/api/value"),
    /mysterium-auth login/
  );
  await assert.rejects(
    fetchAuthenticatedDdbJson(pageReturning({ kind: "service-http-error", status: 401 }), "https://www.dndbeyond.com/api/value"),
    /mysterium-auth login/
  );
});

test("does not misclassify an authenticated service 403 as an expired session", async () => {
  await assert.rejects(
    fetchAuthenticatedDdbJson(pageReturning({ kind: "service-http-error", status: 403 }), "https://www.dndbeyond.com/api/value"),
    (error) => error instanceof DdbServiceRequestError && error.status === 403 && !error.message.includes("mysterium-auth")
  );
});

test("reports upstream auth, service, and JSON failures without response contents", async () => {
  await assert.rejects(
    fetchAuthenticatedDdbJson(pageReturning({ kind: "authentication-http-error", status: 503 }), "https://www.dndbeyond.com/api/value"),
    /authentication service returned HTTP 503/
  );
  await assert.rejects(
    fetchAuthenticatedDdbJson(pageReturning({ kind: "service-http-error", status: 500 }), "https://www.dndbeyond.com/api/value"),
    /service request returned HTTP 500/
  );
  await assert.rejects(
    fetchAuthenticatedDdbJson(pageReturning({ kind: "service-json-error" }), "https://www.dndbeyond.com/api/value"),
    /non-JSON service response/
  );
});
