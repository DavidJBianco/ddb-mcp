const loggedInHome = `<!doctype html><html><body><main>Signed in synthetic user</main></body></html>`;
const loggedOutHome = `<!doctype html><html><body><main><a href="/login">Sign In</a></main></body></html>`;

const searchPage = `<!doctype html><html><body><main class="listing-body">
  <div class="info" data-slug="synthetic-shield">
    <a class="link" href="/spells/synthetic-shield">Synthetic Shield</a>
    <div class="row spell-level"><span>1st Level</span></div>
    <div class="row spell-school"><span class="school abjuration"></span></div>
  </div>
</main></body></html>`;

function html(body, status = 200, headers = {}) {
  return {
    status,
    contentType: "text/html; charset=utf-8",
    headers: { "cache-control": "no-store", ...headers },
    body,
  };
}

function json(body, status = 200, headers = {}) {
  return {
    status,
    contentType: "application/json; charset=utf-8",
    headers: {
      "access-control-allow-origin": "https://www.dndbeyond.com",
      "access-control-allow-credentials": "true",
      "cache-control": "no-store",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

export async function installSyntheticRoutes(context, options = {}) {
  const state = {
    requests: [],
    unmatched: [],
  };
  const authenticated = options.authenticated ?? true;

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    state.requests.push({ method: request.method(), url: url.href });

    if (url.origin === "https://www.dndbeyond.com" && url.pathname === "/") {
      await route.fulfill(html(authenticated ? loggedInHome : loggedOutHome));
      return;
    }

    if (
      url.origin === "https://www.dndbeyond.com" &&
      (url.pathname === "/spells" || url.pathname === "/search")
    ) {
      await route.fulfill(html(searchPage));
      return;
    }

    if (
      url.origin === "https://character-service.dndbeyond.com" &&
      url.pathname === "/character/v5/character/4242"
    ) {
      await route.fulfill(
        json({ data: { id: 4242, name: "Synthetic Hero", classes: [{ level: 3 }] } })
      );
      return;
    }

    if (
      url.origin === "https://www.dndbeyond.com" &&
      url.pathname === "/campaigns/network-error"
    ) {
      await route.abort("failed");
      return;
    }

    state.unmatched.push(url.href);
    await route.abort("blockedbyclient");
  });

  return state;
}
