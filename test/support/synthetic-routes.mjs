const loggedInHome = `<!doctype html><html><body><main>Signed in synthetic user</main></body></html>`;
const loggedOutHome = `<!doctype html><html><body><main><a href="/login">Sign In</a></main></body></html>`;

const searchPage = `<!doctype html><html><body><main class="listing-body">
  <div class="info" data-slug="synthetic-shield">
    <a class="link" href="/spells/synthetic-shield">Synthetic Shield</a>
    <div class="row spell-level"><span>1st Level</span></div>
    <div class="row spell-school"><span class="school abjuration"></span></div>
    <div class="source">
      <a href="/sources/synthetic-handbook">Synthetic Handbook</a>
      <a href="/sources/synthetic-expansion/chapter-one" data-book-slug="synthetic-expansion" data-chapter-slug="chapter-one">Synthetic Expansion</a>
    </div>
    <div class="source">Source: Printed Reference</div>
  </div>
  <div class="info" data-slug="synthetic-ward">
    <a class="link" href="/spells/synthetic-ward">Synthetic Ward</a>
    <div class="row spell-level"><span>2nd Level</span></div>
  </div>
</main></body></html>`;

const charactersPage = `<!doctype html><html><body><main><ul>
  <li class="ddb-campaigns-character-card-wrapper">
    <div class="ddb-campaigns-character-card-header-upper-character-info">
      <h2>Synthetic Hero</h2>
      <div class="ddb-campaigns-character-card-header-upper-character-info-secondary">Level 3 | Construct | Wizard</div>
    </div>
    <div class="ddb-campaigns-character-card-footer-links"><a href="/characters/4242">View</a></div>
  </li>
</ul></main></body></html>`;

const characterSheetPage = `<!doctype html><html><body><main>
  <h1 class="character-name">Synthetic Fallback Hero</h1>
  <div class="character-level">Level 2</div>
  <div class="character-race">Construct</div>
  <div class="character-class">Rogue</div>
  <div class="hp-current">12</div>
</main></body></html>`;

const campaignsPage = `<!doctype html><html><body><main><ul>
  <li class="ddb-campaigns-list-item-wrapper">
    <div class="ddb-campaigns-list-item-body-title">Synthetic Campaign</div>
    <div class="ddb-campaigns-list-item-body-role">Role: Dungeon Master</div>
    <a class="ddb-campaigns-list-item-footer-buttons-item" href="/campaigns/7">View</a>
  </li>
</ul></main></body></html>`;

const campaignPage = `<!doctype html><html><body><main>
  <h1 class="page-title">Synthetic Campaign</h1>
  <span class="user-interactions-profile-nickname">Synthetic DM</span>
  <div class="ddb-campaigns-detail"><p>This entirely synthetic campaign description is deliberately long enough for extraction tests and contains no account data.</p></div>
  <li class="ddb-campaigns-character-card-wrapper">
    <div class="ddb-campaigns-character-card-header-upper-character-info-primary">Synthetic Hero</div>
    <div class="ddb-campaigns-character-card-header-upper-character-info-secondary">Level 3</div>
    <div class="ddb-campaigns-character-card-header-upper-character-info-secondary">Player: Synthetic Player</div>
    <a class="ddb-campaigns-character-card-header-upper-details-link" href="/characters/4242">View</a>
  </li>
</main></body></html>`;

const accessibleLibraryPage = `<!doctype html><html><body><main>
  <input placeholder="Filter by title" />
  <div data-testid="sourceCard">
    <a class="SourceCard_sourceTitle_synthetic" href="/sources/synthetic-handbook">Synthetic Handbook</a>
    <p class="SourceCard_sourceSubtitle_synthetic">Owned</p>
  </div>
</main></body></html>`;

const catalogLibraryPage = `<!doctype html><html><body><main>
  <input placeholder="Filter by title" />
  <div data-testid="sourceCard">
    <a class="SourceCard_sourceTitle_synthetic" href="/sources/synthetic-handbook">Synthetic Handbook</a>
    <p class="SourceCard_sourceSubtitle_synthetic">Owned</p>
  </div>
  <div data-testid="sourceCard">
    <a class="SourceCard_sourceTitle_synthetic" href="https://marketplace.dndbeyond.com/synthetic-store-book">Synthetic Store Book</a>
    <a href="https://marketplace.dndbeyond.com/synthetic-store-book">View in Store</a>
  </div>
</main></body></html>`;

const bookPage = `<!doctype html><html><body><article>
  <h1>Synthetic Handbook</h1>
  <section class="toc" aria-label="Contents"><ol>
    <li><a href="/sources/synthetic-handbook/safe-examples">Safe Examples</a>
      <ol><li><a href="/sources/synthetic-handbook/safe-examples#details">Details</a></li></ol>
    </li>
    <li><a href="/sources/synthetic-handbook/second-chapter">Second Chapter</a></li>
  </ol></section>
</article></body></html>`;

const chapterPage = `<!doctype html><html><body><article class="content-container">
  <aside>Preserved navigation marker</aside>
  <h1>Safe Examples</h1>
  <p>This original fixture tests deterministic sourcebook extraction and pagination.</p>
  <h2>Details</h2>
  <p>First detail paragraph with enough synthetic words to cross a deliberately small response boundary.</p>
  <ul><li>First synthetic rule<ul><li>Nested synthetic rule</li></ul></li><li>Second synthetic rule</li></ul>
  <ol><li>First ordered step</li><li>Second ordered step</li></ol>
  <table><tr><th>Kind</th><th>Value</th></tr><tr><td>Safe</td><td>Example</td></tr></table>
  <figure><img src="/synthetic-image.svg" alt="Synthetic diagram"><figcaption>Entirely synthetic figure</figcaption></figure>
  <h2>Repeated</h2><p>First repeated section.</p>
  <h2>Repeated</h2><p>Second repeated section.</p>
</article></body></html>`;

const alternateChapterPage = `<!doctype html><html><body><main>
  <section class="p-content"><h1>Alternate Layout</h1><p>Alternate supported sourcebook structure.</p></section>
</main></body></html>`;

const changedChapterPage = `<!doctype html><html><body><main>
  <section data-testid="unexpected-source-layout"><h1>Changed Layout</h1><p>This must not be silently scraped from body.</p></section>
</main></body></html>`;

const genericPage = `<!doctype html><html><body><main>
  <h1>Synthetic Page</h1><p>Deterministic navigation content.</p>
  <button id="synthetic-button">Safe Button</button><input id="synthetic-input" />
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

    if (url.origin === "https://www.dndbeyond.com" && url.pathname === "/characters") {
      await route.fulfill(html(charactersPage));
      return;
    }

    if (url.origin === "https://www.dndbeyond.com" && url.pathname === "/characters/999") {
      await route.fulfill(html(characterSheetPage));
      return;
    }

    if (url.origin === "https://www.dndbeyond.com" && url.pathname === "/my-campaigns") {
      await route.fulfill(html(campaignsPage));
      return;
    }

    if (url.origin === "https://www.dndbeyond.com" && url.pathname === "/campaigns/7") {
      await route.fulfill(html(campaignPage));
      return;
    }

    if (url.origin === "https://www.dndbeyond.com" && url.pathname === "/en/library") {
      await route.fulfill(html(url.searchParams.get("ownership") === "owned-shared" ? accessibleLibraryPage : catalogLibraryPage));
      return;
    }

    if (
      url.origin === "https://www.dndbeyond.com" &&
      url.pathname === "/sources/synthetic-handbook"
    ) {
      await route.fulfill(html(bookPage));
      return;
    }

    if (
      url.origin === "https://www.dndbeyond.com" &&
      url.pathname === "/sources/synthetic-handbook/safe-examples"
    ) {
      await route.fulfill(html(chapterPage));
      return;
    }

    if (
      url.origin === "https://www.dndbeyond.com" &&
      url.pathname === "/sources/synthetic-handbook/alternate-layout"
    ) {
      await route.fulfill(html(alternateChapterPage));
      return;
    }

    if (
      url.origin === "https://www.dndbeyond.com" &&
      url.pathname === "/sources/synthetic-handbook/changed-layout"
    ) {
      await route.fulfill(html(changedChapterPage));
      return;
    }

    if (url.origin === "https://www.dndbeyond.com" && url.pathname === "/synthetic-image.svg") {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
      });
      return;
    }

    if (url.origin === "https://www.dndbeyond.com" && url.pathname === "/synthetic-page") {
      await route.fulfill(html(genericPage));
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
      url.origin === "https://character-service.dndbeyond.com" &&
      url.pathname === "/character/v5/character/999"
    ) {
      await route.fulfill(json({ message: "synthetic upstream failure" }, 500));
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
