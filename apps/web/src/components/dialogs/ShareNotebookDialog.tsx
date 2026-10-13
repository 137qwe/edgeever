import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, LoaderCircle, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SharePasswordControls } from "./SharePasswordControls";
import { Input } from "@/components/ui/input";
import { api, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";

export const getPublicNotebookShareUrl = (token: string) =>
  `${(getConfiguredDesktopApiBaseUrl() || window.location.origin).replace(/\/$/, "")}/share/notebook/${encodeURIComponent(token)}`;

export const ShareNotebookDialog = ({
  notebookId,
  notebookName,
  inherited = false,
  open,
  onOpenChange,
}: {
  notebookId: string;
  notebookName: string;
  inherited?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<{ token: string; updatedAt: string; password: string } | null>(null);
  const [copyResult, setCopyResult] = useState<boolean | null>(null);
  const queryKey = [
    "notebook-share",
    getConfiguredDesktopApiBaseUrl(),
    notebookId,
  ];
  const query = useQuery({
    queryKey,
    queryFn: () => api.getNotebookShare(notebookId),
    enabled: open,
    retry: false,
    refetchOnMount: "always",
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["notebook-shares"] });
  const create = useMutation({
    mutationFn: () => api.createNotebookShare(notebookId),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      void invalidate();
    },
  });
  const passwordMutation = useMutation({
    mutationFn: (passwordProtected: boolean) => api.updateNotebookShare(notebookId, { passwordProtected }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, { share: { ...data.share, password: undefined } });
      setSecret(data.share.password ? { token: data.share.token, updatedAt: data.share.updatedAt, password: data.share.password } : null);
      void invalidate();
    },
  });
  const revoke = useMutation({
    mutationFn: () => api.revokeNotebookShare(notebookId),
    onSuccess: () => {
      queryClient.setQueryData(queryKey, { share: null });
      setSecret(null);
      setCopyResult(null);
      void invalidate();
    },
  });
  const share = query.data?.share;
  const busy = query.isFetching || create.isPending || revoke.isPending || passwordMutation.isPending;
  const failed = query.isError || create.isError || revoke.isError || passwordMutation.isError;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            {t("sharing.notebookTitle")}
          </DialogTitle>
          <DialogDescription>{notebookName}</DialogDescription>
        </DialogHeader>
        <p className="rounded-lg bg-muted p-3 text-sm leading-6 text-muted-foreground">
          {t(share?.passwordProtected ? "sharing.notebookProtectedScopeHint" : "sharing.notebookScopeHint")}
        </p>
        {inherited ? (
          <p className="text-sm leading-6 text-slate-600">
            {t("sharing.notebookInheritedHint")}
          </p>
        ) : null}
        {query.isPending ? (
          <LoaderCircle
            className="mx-auto h-5 w-5 animate-spin"
            aria-label={t("sharing.publicLoading")}
          />
        ) : share ? (
          <>
            <Input
              value={getPublicNotebookShareUrl(share.token)}
              readOnly
              aria-label={t("sharing.linkLabel")}
            />
            <SharePasswordControls
              key={share.token}
              passwordProtected={share.passwordProtected}
              password={secret?.token === share.token && secret.updatedAt === share.updatedAt ? secret.password : ""}
              busy={busy}
              shareUrl={getPublicNotebookShareUrl(share.token)}
              onChange={(enabled) => passwordMutation.mutate(enabled)}
            />
            <p className="text-xs leading-5 text-slate-500">{t("sharing.notebookPasswordScopeHint")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={async () =>
                  setCopyResult(
                    await copyTextToClipboard(
                      getPublicNotebookShareUrl(share.token),
                    ),
                  )
                }
              >
                <Copy className="h-4 w-4" />
                {t(
                  copyResult === null
                    ? "sharing.copy"
                    : copyResult
                      ? "sharing.copied"
                      : "sharing.copyFailed",
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  window.open(
                    getPublicNotebookShareUrl(share.token),
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                <ExternalLink className="h-4 w-4" />
                {t("sharing.open")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => revoke.mutate()}
              >
                <Trash2 className="h-4 w-4" />
                {t("sharing.revoke")}
              </Button>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              {t("sharing.notebookRevokeHint")}
            </p>
          </>
        ) : !query.isError ? (
          <Button disabled={busy} onClick={() => create.mutate()}>
            {create.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
            {t("sharing.create")}
          </Button>
        ) : null}
        {failed ? (
          <div role="alert" className="space-y-2 text-sm text-rose-600">
            <p>{t("sharing.error")}</p>
            {query.isError ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void query.refetch()}
              >
                {t("sharing.retry")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
