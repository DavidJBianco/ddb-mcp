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

const monsterSearchPage = `<!doctype html><html><body><main class="listing-body">
  <div class="info" data-slug="synthetic-watcher">
    <a class="link" href="/monsters/42-synthetic-watcher">Synthetic Watcher</a>
    <div class="row monster-challenge"><span>7</span></div>
    <div class="row monster-type">Aberration</div>
    <div class="row monster-tags">NPC</div>
    <div class="source">Synthetic Manual 5.5e</div>
  </div>
  <div class="info legacy" data-slug="synthetic-watcher-legacy">
    <a class="link" href="/monsters/41-synthetic-watcher">Synthetic Watcher</a>
    <div>Legacy This doesn't reflect the latest rules and lore.</div>
    <div class="row monster-challenge"><span>6</span></div>
    <div class="row monster-type">Aberration</div>
    <div class="source">Synthetic Manual 5e</div>
  </div>
</main></body></html>`;

const statBlockPage = `<!doctype html><html><body><main>
  <article class="mon-stat-block" data-testid="monster-stat-block">
    <header><h1>Synthetic Watcher</h1><p class="mon-stat-block__meta">Large Aberration, Neutral</p></header>
    <p><strong>Armor Class</strong> 16 (synthetic armor)</p>
    <p><strong>Hit Points</strong> 84 (8d10 + 40)</p>
    <p><strong>Speed</strong> 30 ft., fly 40 ft.</p>
    <div class="ability"><span>STR</span><span>18 (+4)</span></div><div class="ability"><span>DEX</span><span>14 (+2)</span></div><div class="ability"><span>CON</span><span>20 (+5)</span></div><div class="ability"><span>INT</span><span>12 (+1)</span></div><div class="ability"><span>WIS</span><span>16 (+3)</span></div><div class="ability"><span>CHA</span><span>10 (+0)</span></div>
    <p><strong>Senses</strong> darkvision 120 ft., passive Perception 13</p>
    <p><strong>Languages</strong> Common, Deep Speech</p>
    <p><strong>Challenge</strong> 7 (2,900 XP)</p>
    <h2>Traits</h2>
    <p><strong>Steady Gaze.</strong> The watcher sees through entirely synthetic illusions.</p>
    <h2>Actions</h2>
    <p><strong>Observing Ray.</strong> Ranged Spell Attack: +7 to hit. Hit: 13 synthetic damage.</p>
    <footer class="source">Synthetic Manual 5.5e</footer>
  </article>
  <section id="comments"><h2>Comments</h2><p>This comment must never be extracted.</p></section>
</main></body></html>`;

const charactersPage = `<!doctype html><html><body><main><ul>
  <li class="ddb-campaigns-character-card-wrapper">
    <div class="ddb-campaigns-character-card-header-upper-character-info">
      <h2>Synthetic Hero</h2>
      <div class="ddb-campaigns-character-card-header-upper-character-info-secondary">Level 3 | Construct | Wizard</div>
    </div>
    <div class="ddb-campaigns-character-card-footer-links"><a href="/characters/4242">View</a></div>
  </li>
</ul></main><script>
fetch("https://character-service.dndbeyond.com/character/v5/characters/list?userId=123", { credentials: "include" })
  .then((response) => response.json())
  .then(() => document.body.dataset.charactersLoaded = "true");
</script></body></html>`;

const characterExportPage = `<!doctype html><html><body><main>
  <h1 class="character-name">Synthetic Hero</h1>
  <button type="button">Manage</button>
  <button type="button">Export to PDF</button>
  <a href="/sheet-pdfs/synthetic-character-sheet.pdf">Generated character PDF</a>
</main></body></html>`;

const campaignsPage = `<!doctype html><html><body><main><ul>
  <li class="ddb-campaigns-list-item-wrapper">
    <div class="ddb-campaigns-list-item-body-title">Synthetic Campaign</div>
    <div class="ddb-campaigns-list-item-body-role">Role: Dungeon Master</div>
    <div class="ddb-campaigns-list-item-body-date">Created: 1/2/2025</div>
    <div class="ddb-campaigns-list-item-body-players"><span class="player-count">1 Player</span></div>
    <div class="ddb-campaigns-list-item-body-sharing">Content Sharing Enabled</div>
    <a class="ddb-campaigns-list-item-footer-buttons-item" href="/campaigns/7">View</a>
    <a class="ddb-campaigns-list-item-footer-buttons-item-deactivate" data-confirm-message="Confirm" href="/campaigns/7/deactivate">Deactivate</a>
  </li>
</ul></main></body></html>`;

const campaignPage = `<!doctype html><html><body><main>
  <div class="user-role-registered-users" data-userid="10"></div>
  <h1 class="page-title">Synthetic Campaign</h1>
  <span class="user-interactions-profile-nickname">Synthetic DM</span>
  <div class="ddb-campaigns-detail">
    <p class="ddb-campaigns-detail-header-secondary-description">This entirely synthetic campaign description contains no account data.</p>
    <div class="ddb-campaigns-detail-body-dm-notes-public">Synthetic public note.</div>
    <div class="ddb-campaigns-detail-body-dm-notes-private">Synthetic private note.</div>
    <div class="ddb-campaigns-invite-wrapper"><button data-clipboard-text="https://www.dndbeyond.com/campaigns/join/synthetic-secret">Copy Invite</button></div>
    <a href="/campaigns/7/edit">Edit Campaign</a>
    <a data-confirm-message="Confirm" href="/campaigns/7/delete">Delete Campaign</a>
  </div>
  <div class="ddb-campaigns-detail-body-listing">
  <li class="ddb-campaigns-character-card-wrapper">
    <div class="ddb-campaigns-character-card-header-upper-character-info-primary">Synthetic Hero</div>
    <div class="ddb-campaigns-character-card-header-upper-character-info-secondary">Level 3</div>
    <div class="ddb-campaigns-character-card-header-upper-character-info-secondary">Player: Synthetic Player</div>
    <a class="ddb-campaigns-character-card-header-upper-details-link" href="/characters/4242">View</a>
  </li>
  </div>
</main><script>
fetch("https://api.dndbeyond.com/campaigns/v1/details/7", { credentials: "include" }).then((response) => response.json());
fetch("https://www.dndbeyond.com/api/campaign/stt/active-short-characters/7", { credentials: "include" }).then((response) => response.json());
</script></body></html>`;

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

const genericPage = `<!doctype html><html><head><title>Synthetic Page</title></head><body>
<script>
setTimeout(() => {
  const main = document.createElement("main");
  main.innerHTML = '<nav id="preserved-navigation">Navigation excluded from extracted text.</nav>' +
    '<h1>Synthetic Page</h1>' +
    '<p>Deterministic navigation content with a Unicode glyph: 😀.</p>' +
    '<p>Second synthetic paragraph for bounded cursor pagination.</p>' +
    '<p>Third synthetic paragraph completes the rendered page.</p>' +
    '<section id="visual-target" style="width: 240px; height: 80px; background: rgb(10, 20, 30); color: white">Visible screenshot target</section>' +
    '<p hidden>Hidden content must not be extracted.</p>';
  document.body.append(main);
}, 25);
</script></body></html>`;

const emptyGenericPage = `<!doctype html><html><head><title>Empty Synthetic Page</title></head><body></body></html>`;

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

    if (url.origin === "https://www.dndbeyond.com" && url.pathname === "/monsters") {
      await route.fulfill(html(monsterSearchPage));
      return;
    }

    if (
      url.origin === "https://www.dndbeyond.com" &&
      (url.pathname === "/monsters/42" || url.pathname === "/monsters/42-synthetic-watcher")
    ) {
      await route.fulfill(html(statBlockPage));
      return;
    }

    if (url.origin === "https://www.dndbeyond.com" && url.pathname === "/characters") {
      await route.fulfill(html(charactersPage));
      return;
    }

    if (url.origin === "https://www.dndbeyond.com" && url.pathname === "/characters/4242") {
      await route.fulfill(html(characterExportPage));
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

    if (url.origin === "https://api.dndbeyond.com" && url.pathname === "/campaigns/v1/details/7") {
      await route.fulfill(json({ data: {
        id: 7,
        name: "Synthetic Campaign",
        status: 1,
        dateCreated: "2025-01-02T03:04:05Z",
        dmId: 10,
        dmDisplayName: "Synthetic DM",
        contentSharingEnabled: true,
        itemSharingEnabled: false,
        activePlayers: [{ id: 20, displayName: "Synthetic Player" }],
        activeCharacters: [{ id: 4242, name: "Synthetic Hero", userId: 20, isPrivate: false }],
      } }));
      return;
    }

    if (url.origin === "https://www.dndbeyond.com" && url.pathname === "/api/campaign/stt/active-short-characters/7") {
      await route.fulfill(json({
        status: "success",
        data: [{ id: 4242, name: "Synthetic Hero", userId: 20, userName: "Synthetic Player", characterStatus: 1, isAssigned: true }],
      }));
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

    if (url.origin === "https://www.dndbeyond.com" && url.pathname === "/synthetic-empty-page") {
      await route.fulfill(html(emptyGenericPage));
      return;
    }

    if (
      url.origin === "https://character-service.dndbeyond.com" &&
      url.pathname === "/character/v5/characters/list"
    ) {
      await route.fulfill(json({
        id: 0,
        success: true,
        message: null,
        data: {
          characters: [{
            id: 4242,
            name: "Synthetic Hero",
            level: 3,
            classDescription: "Wizard 3",
            raceName: "Construct",
            campaignId: 7,
            campaignName: "Synthetic Campaign",
            status: 1,
            createdDate: Date.parse("2025-01-02T03:04:05Z"),
            lastModifiedDate: Date.parse("2025-03-04T05:06:07Z"),
          }],
          characterSlotLimit: 6,
          canUnlockCharacters: false,
        },
        pagination: null,
      }));
      return;
    }

    if (
      url.origin === "https://character-service.dndbeyond.com" &&
      url.pathname === "/character/v5/character/4242"
    ) {
      await route.fulfill(
        json({
          id: 0,
          success: true,
          message: null,
          data: {
            id: 4242,
            name: "Synthetic Hero",
            classes: [{ level: 3 }],
            decorations: { avatarUrl: "https://www.dndbeyond.com/avatars/synthetic-hero.jpeg?width=150&height=150" },
          },
          pagination: null,
        })
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
      url.pathname === "/campaigns/999"
    ) {
      await route.abort("failed");
      return;
    }

    state.unmatched.push(url.href);
    await route.abort("blockedbyclient");
  });

  return state;
}
