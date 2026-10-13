import {
  collectMemoLinkIds,
  accountNoteProseFromRow,
  publicNoteProseFromAccount,
  sanitizeNoteProseCss,
  parsePublishedNoteBodyFont,
  resolveMemoContentDoc,
  type NotebookShare,
  type PublicNotebookShare,
  type PublicMemoShare,
  type NoteProseAccountRow,
  type TiptapDoc,
} from "@edgeever/shared";
import type { Hono } from "hono";
import type { AppEnv } from "./api-context";
import { randomToken } from "./auth-crypto";
import { audit } from "./audit";
import { createId, isoNow, parseJsonArray } from "./entity-utils";
import { notFound } from "./http-errors";
import { getAuditActor, getWorkspaceId, requireUser } from "./request-auth";
import { serveSharedResource } from "./share-routes";

// Every public query starts at the live share, and constrains every level to
// its workspace. Deleted ancestors stop traversal; UNION also tolerates cycles.
const publicTreeSql = `WITH RECURSIVE tree(id, workspace_id) AS (
  SELECT n.id, n.workspace_id FROM notebook_shares ns
  JOIN notebooks n ON n.id = ns.notebook_id AND n.workspace_id = ns.workspace_id
  WHERE ns.token = ? AND n.is_deleted = 0
  UNION
  SELECT n.id, n.workspace_id FROM notebooks n JOIN tree t ON n.parent_id = t.id
  WHERE n.workspace_id = t.workspace_id AND n.is_deleted = 0
)`;

type ShareRow = {
  notebook_id: string;
  notebook_name: string;
  token: string;
  created_at: string;
  updated_at: string;
};
const mapShare = (row: ShareRow): NotebookShare => ({
  notebookId: row.notebook_id,
  notebookName: row.notebook_name,
  token: row.token,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const selectShareSql = `SELECT ns.notebook_id, n.name AS notebook_name, ns.token, ns.created_at, ns.updated_at
  FROM notebook_shares ns JOIN notebooks n ON n.id = ns.notebook_id AND n.workspace_id = ns.workspace_id
  WHERE ns.workspace_id = ? AND n.is_deleted = 0`;
const validToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

export const registerNotebookShareRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/notebook-shares", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const rows = await c.env.storage.db
      .prepare(`${selectShareSql} ORDER BY ns.created_at DESC, ns.id`)
      .bind(getWorkspaceId(c))
      .all<ShareRow>();
    c.header("Cache-Control", "private, no-store");
    return c.json({ shares: rows.results.map(mapShare) });
  });
  app.get("/api/v1/notebooks/:id/share", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const row = await c.env.storage.db
      .prepare(`${selectShareSql} AND ns.notebook_id = ?`)
      .bind(getWorkspaceId(c), c.req.param("id"))
      .first<ShareRow>();
    c.header("Cache-Control", "private, no-store");
    return c.json({ share: row ? mapShare(row) : null });
  });
  app.post("/api/v1/notebooks/:id/share", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const workspaceId = getWorkspaceId(c);
    const notebookId = c.req.param("id");
    const notebook = await c.env.storage.db
      .prepare(
        "SELECT id FROM notebooks WHERE id = ? AND workspace_id = ? AND is_deleted = 0",
      )
      .bind(notebookId, workspaceId)
      .first();
    if (!notebook) return notFound(c, "Notebook not found");
    const token = randomToken(32);
    const now = isoNow();
    await c.env.storage.db
      .prepare(
        `INSERT OR IGNORE INTO notebook_shares (id, notebook_id, workspace_id, token, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        createId("nbshare"),
        notebookId,
        workspaceId,
        token,
        getAuditActor(c).actorId,
        now,
        now,
      )
      .run();
    const row = await c.env.storage.db
      .prepare(`${selectShareSql} AND ns.notebook_id = ?`)
      .bind(workspaceId, notebookId)
      .first<ShareRow>();
    if (!row) throw new Error("Could not allocate notebook share");
    if (row.token === token)
      await audit(
        c.env.storage.db,
        getAuditActor(c).actorType,
        getAuditActor(c).actorId,
        "notebook.share.create",
        "notebook",
        notebookId,
        {},
      );
    c.header("Cache-Control", "private, no-store");
    return c.json({ share: mapShare(row) });
  });
  app.delete("/api/v1/notebooks/:id/share", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    await c.env.storage.db
      .prepare(
        "DELETE FROM notebook_shares WHERE notebook_id = ? AND workspace_id = ?",
      )
      .bind(c.req.param("id"), getWorkspaceId(c))
      .run();
    await audit(
      c.env.storage.db,
      getAuditActor(c).actorType,
      getAuditActor(c).actorId,
      "notebook.share.revoke",
      "notebook",
      c.req.param("id"),
      {},
    );
    c.header("Cache-Control", "private, no-store");
    return c.json({ ok: true });
  });
};

export const registerPublicNotebookShareRoutes = (app: Hono<AppEnv>) => {
  app.use("/api/public/notebook-shares/*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    await next();
  });
  app.get("/api/public/notebook-shares/:token", async (c) => {
    const token = c.req.param("token");
    if (!validToken(token)) return notFound(c, "Shared notebook not found");
    const root = await c.env.storage.db
      .prepare(
        `SELECT n.id, n.name FROM notebook_shares ns
      JOIN notebooks n ON n.id = ns.notebook_id AND n.workspace_id = ns.workspace_id
      WHERE ns.token = ? AND n.is_deleted = 0`,
      )
      .bind(token)
      .first<{ id: string; name: string }>();
    if (!root) return notFound(c, "Shared notebook not found");
    const notebooks = await c.env.storage.db
      .prepare(
        `${publicTreeSql}
      SELECT n.id, n.parent_id AS parentId, n.name FROM notebooks n JOIN tree t ON n.id = t.id AND n.workspace_id = t.workspace_id
      ORDER BY n.sort_order, n.name, n.id`,
      )
      .bind(token)
      .all<PublicNotebookShare["notebooks"][number]>();
    if (!notebooks.results.length)
      return notFound(c, "Shared notebook not found");
    const memos = await c.env.storage.db
      .prepare(
        `${publicTreeSql}
      SELECT m.id, m.notebook_id AS notebookId, m.title FROM memos m JOIN tree t ON m.notebook_id = t.id AND m.workspace_id = t.workspace_id
      WHERE m.is_deleted = 0 ORDER BY m.is_pinned DESC, m.updated_at DESC, m.id`,
      )
      .bind(token)
      .all<PublicNotebookShare["memos"][number]>();
    const share: PublicNotebookShare = {
      notebookId: root.id,
      name: root.name,
      notebooks: notebooks.results.map((n) => ({
        ...n,
        parentId: n.id === root.id ? null : n.parentId,
      })),
      memos: memos.results,
    };
    return c.json({ share });
  });
  app.get("/api/public/notebook-shares/:token/memos/:memoId", async (c) => {
    const token = c.req.param("token");
    if (!validToken(token)) return notFound(c, "Shared note not found");
    const row = await c.env.storage.db
      .prepare(
        `${publicTreeSql}
      SELECT m.title, mc.content_json, mc.content_markdown, m.tags_json, m.updated_at, u.note_body_font,
        u.note_prose_font_size, u.note_prose_line_height, u.note_prose_palette, u.note_prose_custom_css, u.note_prose_custom_colors
      FROM memos m JOIN tree t ON m.notebook_id = t.id AND m.workspace_id = t.workspace_id
      JOIN memo_contents mc ON mc.memo_id = m.id
      JOIN notebook_shares ns ON ns.token = ?
      LEFT JOIN users u ON u.id = ns.created_by
      WHERE m.id = ? AND m.is_deleted = 0`,
      )
      .bind(token, token, c.req.param("memoId"))
      .first<
        NoteProseAccountRow & {
          title: string | null;
          content_json: string;
          content_markdown: string;
          tags_json: string;
          updated_at: string;
          note_body_font: string | null;
        }
      >();
    if (!row) return notFound(c, "Shared note not found");
    const contentJson = JSON.parse(row.content_json) as TiptapDoc;
    const memoUrls: Record<string, string> = {};
    const ids = collectMemoLinkIds(
      resolveMemoContentDoc(contentJson, row.content_markdown),
    );
    for (let offset = 0; offset < ids.length; offset += 80) {
      const batch = ids.slice(offset, offset + 80);
      const linked = await c.env.storage.db
        .prepare(
          `${publicTreeSql}
        SELECT m.id FROM memos m JOIN tree t ON m.notebook_id = t.id AND m.workspace_id = t.workspace_id
        WHERE m.is_deleted = 0 AND m.id IN (${batch.map(() => "?").join(",")})`,
        )
        .bind(token, ...batch)
        .all<{ id: string }>();
      for (const memo of linked.results)
        memoUrls[memo.id] =
          `/share/notebook/${encodeURIComponent(token)}/${encodeURIComponent(memo.id)}`;
    }
    const account = accountNoteProseFromRow(row);
    const share: PublicMemoShare = {
      title: row.title,
      contentJson,
      contentMarkdown: row.content_markdown,
      tags: parseJsonArray(row.tags_json),
      updatedAt: row.updated_at,
      memoShareTokens: {},
      bodyFont: parsePublishedNoteBodyFont(row.note_body_font),
      prose: publicNoteProseFromAccount({
        ...account,
        customCss:
          account.customCss === null
            ? null
            : sanitizeNoteProseCss(account.customCss),
      }),
    };
    return c.json({ share, memoUrls });
  });
  app.get(
    "/api/public/notebook-shares/:token/resources/:resourceId/blob",
    async (c) => {
      const token = c.req.param("token");
      if (!validToken(token)) return notFound(c, "Shared resource not found");
      const resource = await c.env.storage.db
        .prepare(
          `${publicTreeSql}
      SELECT r.object_key, r.storage_config_id, r.kind, r.mime_type, r.filename, r.byte_size,
        m.workspace_id, NULL AS password_hash
      FROM resources r JOIN memos m ON r.memo_id = m.id
      JOIN tree t ON m.notebook_id = t.id AND m.workspace_id = t.workspace_id
      WHERE r.id = ? AND r.is_deleted = 0 AND m.is_deleted = 0`,
        )
        .bind(token, c.req.param("resourceId"))
        .first<Parameters<typeof serveSharedResource>[1]>();
      if (!resource) return notFound(c, "Shared resource not found");
      return serveSharedResource(c, resource);
    },
  );
};
