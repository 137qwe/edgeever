import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { Hono } from "hono";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter";
import {
  registerNotebookShareRoutes,
  registerPublicNotebookShareRoutes,
} from "./notebook-share-routes";
import { registerPublicShareRoutes } from "./share-routes";

const databases = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
const token = "n".repeat(43);
const individualToken = "s".repeat(43);
const auth = {
  kind: "user",
  actorType: "user",
  actorId: null,
  workspaceId: "ws_test",
  role: "member",
  scopes: [],
  username: "test",
};
const fixture = () => {
  const db = new Database(":memory:");
  databases.push(db);
  // Populate a real pre-feature schema first, then upgrade it in place.
  const migrations = globSync("migrations/*.sql").sort();
  for (const file of migrations.filter(
    (file) => !file.endsWith("0067_notebook_shares.sql"),
  ))
    db.exec(readFileSync(file, "utf8"));
  db.run(
    "INSERT INTO workspaces (id, name) VALUES ('ws_test', 'Test'), ('ws_other', 'Other')",
  );
  for (const [id, parent, workspace] of [
    ["root", null, "ws_test"],
    ["child", "root", "ws_test"],
    ["grandchild", "child", "ws_test"],
    ["private", null, "ws_test"],
    ["foreign", "root", "ws_other"],
  ]) {
    db.run(
      "INSERT INTO notebooks (id, parent_id, workspace_id, name) VALUES (?, ?, ?, ?)",
      [id, parent, workspace, id],
    );
  }
  const addMemo = (id, notebookId, workspace = "ws_test") => {
    db.run(
      "INSERT INTO memos (id, notebook_id, workspace_id, title) VALUES (?, ?, ?, ?)",
      [id, notebookId, workspace, id],
    );
    db.run(
      "INSERT INTO memo_contents (memo_id, content_json, content_markdown, content_hash) VALUES (?, ?, ?, ?)",
      [id, '{"type":"doc","content":[]}', id, id],
    );
    db.run(
      "INSERT INTO resources (id, memo_id, object_key, kind, mime_type, byte_size) VALUES (?, ?, ?, 'image', 'image/png', 10)",
      [`res_${id}`, id, id],
    );
  };
  addMemo("memo_root", "root");
  addMemo("memo_child", "child");
  addMemo("memo_grand", "grandchild");
  addMemo("memo_private", "private");
  addMemo("memo_other", "foreign", "ws_other");
  db.run(
    "INSERT INTO memo_shares (id, memo_id, workspace_id, token) VALUES ('individual', 'memo_child', 'ws_test', ?)",
    [individualToken],
  );
  db.exec(readFileSync("migrations/0067_notebook_shares.sql", "utf8"));
  db.run(
    "INSERT INTO notebook_shares (id, notebook_id, workspace_id, token) VALUES ('shared', 'root', 'ws_test', ?)",
    [token],
  );
  const environment = {
    storage: createSelfHostedStorageAdapter(
      db,
      "/tmp/edgeever-notebook-share-unused",
    ),
  };
  let blobReads = 0;
  environment.storage.resources = {
    get: async (_key, options) => {
      blobReads++;
      return {
        body: new Blob([options ? "2345" : "0123456789"]).stream(),
        size: 10,
        range: options?.range,
        writeHttpMetadata: () => {},
      };
    },
  };
  const app = new Hono();
  app.use("/api/v1/*", async (c, next) => {
    if (c.req.header("test-auth") !== "none")
      c.set(
        "auth",
        c.req.header("test-auth") === "agent"
          ? { ...auth, kind: "agent" }
          : auth,
      );
    await next();
  });
  registerPublicNotebookShareRoutes(app);
  registerNotebookShareRoutes(app);
  registerPublicShareRoutes(app);
  const request = (path = "", init = {}) =>
    app.request(
      `/api/public/notebook-shares/${token}${path}`,
      init,
      environment,
    );
  return { db, app, environment, request, addMemo, blobReads: () => blobReads };
};

describe("live recursive notebook sharing", () => {
  test("upgrades existing data without creating individual shares; exposes only the live workspace subtree", async () => {
    const { db, request } = fixture();
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const { share } = await response.json();
    expect(share.notebooks.map((n) => n.id).sort()).toEqual([
      "child",
      "grandchild",
      "root",
    ]);
    expect(share.notebooks.find((n) => n.id === "root").parentId).toBeNull();
    expect(share.memos.map((m) => m.id).sort()).toEqual([
      "memo_child",
      "memo_grand",
      "memo_root",
    ]);
    expect(
      db.query("SELECT COUNT(*) AS total FROM memo_shares").get().total,
    ).toBe(1);
    expect(
      db
        .query(
          "SELECT content_markdown FROM memo_contents WHERE memo_id = 'memo_private'",
        )
        .get().content_markdown,
    ).toBe("memo_private");
    for (const id of ["memo_private", "memo_other"]) {
      expect((await request(`/memos/${id}`)).status).toBe(404);
      expect((await request(`/resources/res_${id}/blob`)).status).toBe(404);
    }
  });

  test("publishes new and moved-in notes, edits, and moved-in subtrees without changing the token", async () => {
    const { db, request, addMemo } = fixture();
    addMemo("new_note", "grandchild");
    db.run("UPDATE memos SET notebook_id = 'child' WHERE id = 'memo_private'");
    db.run(
      "UPDATE memo_contents SET content_markdown = 'edited live' WHERE memo_id = 'memo_child'",
    );
    const { share } = await (await request()).json();
    expect(share.memos.some((m) => m.id === "new_note")).toBe(true);
    expect(share.memos.some((m) => m.id === "memo_private")).toBe(true);
    expect(
      (await (await request("/memos/memo_child")).json()).share.contentMarkdown,
    ).toBe("edited live");
    db.run("UPDATE notebooks SET parent_id = 'root' WHERE id = 'private'");
    addMemo("new_private_child", "private");
    expect((await request("/memos/new_private_child")).status).toBe(200);
  });

  test("moving a note or subtree out immediately denies its note and resource endpoints", async () => {
    const { db, request, blobReads } = fixture();
    expect((await request("/resources/res_memo_child/blob")).status).toBe(200);
    db.run("UPDATE memos SET notebook_id = 'private' WHERE id = 'memo_child'");
    db.run(
      "UPDATE notebooks SET parent_id = 'private' WHERE id = 'grandchild'",
    );
    for (const id of ["memo_child", "memo_grand"]) {
      expect((await request(`/memos/${id}`)).status).toBe(404);
      expect((await request(`/resources/res_${id}/blob`)).status).toBe(404);
    }
    expect(blobReads()).toBe(1);
  });

  test("deleted notes, resources, ancestors, and roots cannot be read", async () => {
    const { db, request } = fixture();
    db.run("UPDATE memos SET is_deleted = 1 WHERE id = 'memo_root'");
    expect((await request("/memos/memo_root")).status).toBe(404);
    expect((await request("/resources/res_memo_root/blob")).status).toBe(404);
    db.run("UPDATE resources SET is_deleted = 1 WHERE id = 'res_memo_child'");
    expect((await request("/resources/res_memo_child/blob")).status).toBe(404);
    db.run("UPDATE notebooks SET is_deleted = 1 WHERE id = 'child'");
    expect((await request("/memos/memo_grand")).status).toBe(404);
    expect((await request("/resources/res_memo_grand/blob")).status).toBe(404);
    db.run("UPDATE notebooks SET is_deleted = 1 WHERE id = 'root'");
    expect((await request()).status).toBe(404);
  });

  test("revocation closes every endpoint, keeps independent shares, and recreation gets a fresh token", async () => {
    const { db, app, environment, request } = fixture();
    const revoke = await app.request(
      "/api/v1/notebooks/root/share",
      { method: "DELETE" },
      environment,
    );
    expect(revoke.status).toBe(200);
    for (const path of [
      "",
      "/memos/memo_child",
      "/resources/res_memo_child/blob",
    ])
      expect((await request(path)).status).toBe(404);
    expect(
      (
        await app.request(
          `/api/public/shares/${individualToken}`,
          {},
          environment,
        )
      ).status,
    ).toBe(200);
    expect(
      db.query("SELECT COUNT(*) AS total FROM memo_shares").get().total,
    ).toBe(1);
    const created = await (
      await app.request(
        "/api/v1/notebooks/root/share",
        { method: "POST" },
        environment,
      )
    ).json();
    expect(created.share.token).not.toBe(token);
    expect(created.share.token).toHaveLength(43);
    const again = await (
      await app.request(
        "/api/v1/notebooks/root/share",
        { method: "POST" },
        environment,
      )
    ).json();
    expect(again.share.token).toBe(created.share.token);
  });

  test("interactive management is workspace scoped and rejects anonymous and API-token callers", async () => {
    const { app, environment, db } = fixture();
    for (const kind of ["none", "agent"]) {
      for (const method of ["GET", "POST", "DELETE"])
        expect(
          (
            await app.request(
              "/api/v1/notebooks/root/share",
              { method, headers: { "test-auth": kind } },
              environment,
            )
          ).status,
        ).toBe(403);
    }
    expect(
      (
        await app.request(
          "/api/v1/notebooks/foreign/share",
          { method: "POST" },
          environment,
        )
      ).status,
    ).toBe(404);
    await app.request(
      "/api/v1/notebooks/foreign/share",
      { method: "DELETE" },
      environment,
    );
    const response = await app.request(
      "/api/v1/notebook-shares",
      {},
      environment,
    );
    expect((await response.json()).shares.map((s) => s.notebookId)).toEqual([
      "root",
    ]);
    expect(
      db.query("SELECT COUNT(*) AS total FROM notebook_shares").get().total,
    ).toBe(1);
  });

  test("internal links resolve only within the shared tree, even if an outside note has an independent share", async () => {
    const { db, request } = fixture();
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: ["memo_child", "memo_private", "memo_other"].map((id) => ({
            type: "text",
            text: id,
            marks: [{ type: "link", attrs: { href: `#memo=${id}` } }],
          })),
        },
      ],
    };
    db.run(
      "UPDATE memo_contents SET content_json = ? WHERE memo_id = 'memo_root'",
      [JSON.stringify(doc)],
    );
    const response = await (await request("/memos/memo_root")).json();
    expect(response.memoUrls).toEqual({
      memo_child: `/share/notebook/${token}/memo_child`,
    });
    expect(response.share.memoShareTokens).toEqual({});
  });

  test("resource streaming keeps range, MIME, and no-store behavior", async () => {
    const { request } = fixture();
    const response = await request("/resources/res_memo_child/blob", {
      headers: { Range: "bytes=2-5" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("2345");
  });
  test("independent child notebook shares survive parent revocation", async () => {
    const { app, environment, request } = fixture();
    const created = await (
      await app.request(
        "/api/v1/notebooks/child/share",
        { method: "POST" },
        environment,
      )
    ).json();
    await app.request(
      "/api/v1/notebooks/root/share",
      { method: "DELETE" },
      environment,
    );
    expect((await request("/memos/memo_child")).status).toBe(404);
    const base = `/api/public/notebook-shares/${created.share.token}`;
    expect((await app.request(base, {}, environment)).status).toBe(200);
    expect(
      (await app.request(`${base}/memos/memo_grand`, {}, environment)).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          `${base}/resources/res_memo_grand/blob`,
          {},
          environment,
        )
      ).status,
    ).toBe(200);
  });

  test("even inconsistent cross-workspace notebook references do not grant access", async () => {
    const { db, request } = fixture();
    db.run("UPDATE memos SET notebook_id = 'root' WHERE id = 'memo_other'");
    expect((await request("/memos/memo_other")).status).toBe(404);
    expect((await request("/resources/res_memo_other/blob")).status).toBe(404);
    const { share } = await (await request()).json();
    expect(share.memos.some((memo) => memo.id === "memo_other")).toBe(false);
  });
});
