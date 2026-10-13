import { useQuery } from "@tanstack/react-query";
import { BookOpen, FileText, Folder, LoaderCircle } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { PublicNotebookShare } from "@edgeever/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PublicShareArticle } from "./PublicSharePage";

const NotebookContents = ({
  share,
  token,
  selectedId,
}: {
  share: PublicNotebookShare;
  token: string;
  selectedId?: string;
}) => {
  const { t } = useTranslation();
  const tree = useMemo(() => {
    const children = new Map<string | null, PublicNotebookShare["notebooks"]>();
    const memos = new Map<string, PublicNotebookShare["memos"]>();
    for (const notebook of share.notebooks) {
      const siblings = children.get(notebook.parentId) ?? [];
      siblings.push(notebook);
      children.set(notebook.parentId, siblings);
    }
    for (const memo of share.memos) {
      const siblings = memos.get(memo.notebookId) ?? [];
      siblings.push(memo);
      memos.set(memo.notebookId, siblings);
    }
    return { children, memos };
  }, [share]);
  const renderNotebook = (id: string, visited: ReadonlySet<string>) => {
    if (visited.has(id)) return null;
    const path = new Set(visited).add(id);
    return (
      <ul className="space-y-1 border-l border-slate-200 pl-3">
        {(tree.memos.get(id) ?? []).map((memo) => (
          <li key={memo.id}>
            <Link
              to={`/share/notebook/${encodeURIComponent(token)}/${encodeURIComponent(memo.id)}`}
              aria-current={selectedId === memo.id ? "page" : undefined}
              className={`flex items-start gap-2 rounded-md px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${selectedId === memo.id ? "bg-emerald-50 font-medium text-emerald-800" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <FileText className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">
                {memo.title?.trim() || t("common.untitledMemo")}
              </span>
            </Link>
          </li>
        ))}
        {(tree.children.get(id) ?? []).map((notebook) => (
          <li key={notebook.id}>
            <details open>
              <summary className="flex cursor-pointer items-center gap-2 px-2 py-2 text-sm font-medium text-slate-800">
                <Folder className="h-4 w-4 shrink-0" />
                <span className="break-words">{notebook.name}</span>
              </summary>
              {renderNotebook(notebook.id, path)}
            </details>
          </li>
        ))}
      </ul>
    );
  };
  return (
    <nav aria-label={t("sharing.notebookContents")}>
      {renderNotebook(share.notebookId, new Set())}
    </nav>
  );
};

export const PublicNotebookSharePage = () => {
  const { t } = useTranslation();
  const { token = "", memoId } = useParams();
  const directory = useQuery({
    queryKey: ["public-notebook-share", token],
    queryFn: () => api.getPublicNotebookShare(token),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30_000,
  });
  const memo = useQuery({
    queryKey: ["public-notebook-memo", token, memoId],
    queryFn: () => api.getPublicNotebookMemo(token, memoId!),
    enabled: Boolean(memoId),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30_000,
  });
  const share = directory.isError ? undefined : directory.data?.share;
  const note = memo.isError ? undefined : memo.data?.share;
  const access = useMemo(
    () => ({
      resourceBasePath: `/api/public/notebook-shares/${encodeURIComponent(token)}/resources`,
      memoUrls: memo.data?.memoUrls ?? {},
    }),
    [token, memo.data?.memoUrls],
  );
  useEffect(() => {
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex,nofollow,noarchive";
    document.head.appendChild(robots);
    const previous = document.title;
    document.title = `${note?.title?.trim() || share?.name || t("sharing.notebookTitle")} · EdgeEver`;
    return () => {
      robots.remove();
      document.title = previous;
    };
  }, [note?.title, share?.name, t]);
  if (directory.isPending)
    return (
      <main className="flex min-h-[100dvh] items-center justify-center">
        <LoaderCircle
          className="h-6 w-6 animate-spin"
          aria-label={t("sharing.publicLoading")}
        />
      </main>
    );
  if (!share)
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold">
          {t("sharing.notebookUnavailable")}
        </h1>
        <p>{t("sharing.notebookUnavailableHint")}</p>
        <Button variant="outline" onClick={() => void directory.refetch()}>
          {t("sharing.retry")}
        </Button>
      </main>
    );
  return (
    <main className="min-h-[100dvh] bg-slate-50 lg:flex lg:items-start">
      <aside className="border-b border-slate-200 bg-card p-4 lg:sticky lg:top-0 lg:max-h-[100dvh] lg:w-72 lg:shrink-0 lg:overflow-auto lg:border-b-0 lg:border-r">
        <Link
          to={`/share/notebook/${encodeURIComponent(token)}`}
          className="mb-4 flex items-center gap-2 break-words text-lg font-semibold text-slate-900"
        >
          <BookOpen className="h-5 w-5 shrink-0 text-emerald-700" />
          {share.name}
        </Link>
        <details className="lg:hidden">
          <summary className="cursor-pointer py-2 text-sm font-medium">
            {t("sharing.notebookContents")}
          </summary>
          <NotebookContents share={share} token={token} selectedId={memoId} />
        </details>
        <div className="hidden lg:block">
          <NotebookContents share={share} token={token} selectedId={memoId} />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {!memoId ? (
          <section className="mx-auto max-w-3xl p-8">
            <h1 className="text-3xl font-bold">{share.name}</h1>
            <p className="my-5 text-slate-500">
              {t(
                share.memos.length
                  ? "sharing.notebookWelcome"
                  : "sharing.notebookEmpty",
              )}
            </p>
            <NotebookContents share={share} token={token} />
          </section>
        ) : memo.isPending ? (
          <div className="flex min-h-60 items-center justify-center">
            <LoaderCircle
              className="h-6 w-6 animate-spin"
              aria-label={t("sharing.publicLoading")}
            />
          </div>
        ) : note && share.memos.some((item) => item.id === memoId) ? (
          <PublicShareArticle share={note} token={token} access={access} />
        ) : (
          <section className="space-y-4 p-8">
            <h1 className="text-xl font-semibold">
              {t("sharing.publicUnavailable")}
            </h1>
            <p className="text-slate-500">
              {t("sharing.notebookNoteUnavailableHint")}
            </p>
            <Button variant="outline" onClick={() => void memo.refetch()}>
              {t("sharing.retry")}
            </Button>
          </section>
        )}
      </div>
    </main>
  );
};
