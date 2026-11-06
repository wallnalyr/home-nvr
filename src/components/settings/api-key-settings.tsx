"use client";

import { useState } from "react";
import useSWR from "swr";
import { authFetcher } from "@/lib/fetcher";
import { useCameras } from "@/hooks/use-cameras";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface KeyStatus {
  exists: boolean;
  hint?: string;
  createdAt?: string;
}

export function ApiKeySettings() {
  const { data: status, mutate } = useSWR<KeyStatus>(
    "/api/settings/api-key",
    authFetcher,
  );
  const { cameras } = useCameras();

  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"generate" | "revoke" | null>(null);
  // Plaintext key, held in memory only right after generation
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const generate = async () => {
    setConfirmAction(null);
    setBusy(true);
    try {
      const res = await fetch("/api/settings/api-key", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.key) {
        setFreshKey(body.key);
        await mutate();
        toast.success("API key generated");
      } else {
        toast.error("Failed to generate API key");
      }
    } catch {
      toast.error("Failed to generate API key");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setConfirmAction(null);
    setBusy(true);
    try {
      const res = await fetch("/api/settings/api-key", { method: "DELETE" });
      if (res.ok) {
        setFreshKey(null);
        await mutate();
        toast.success("API key revoked");
      } else {
        toast.error("Failed to revoke API key");
      }
    } catch {
      toast.error("Failed to revoke API key");
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const snapshotUrl = (slug: string, key: string) =>
    `${origin}/api/snapshot/${slug}?key=${key}`;

  return (
    <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <KeyRound className="h-4 w-4 text-ios-blue" />
          <h3 className="text-sm font-medium">Snapshot API Key</h3>
        </div>
        {status?.exists ? (
          <Badge variant="default">Active</Badge>
        ) : (
          <Badge variant="secondary">Not set</Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Lets external displays (smart hubs, wall tablets) fetch still
        snapshots of your cameras without logging in. The key only works on
        the snapshot endpoint — it cannot access anything else.
      </p>

      {status?.exists && !freshKey && (
        <div className="rounded-lg bg-secondary/50 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Current key:{" "}
            <code className="font-mono text-foreground">{status.hint}</code>
            {status.createdAt && (
              <> · created {new Date(status.createdAt).toLocaleDateString()}</>
            )}
          </span>
        </div>
      )}

      {freshKey && (
        <div className="space-y-2">
          <div className="rounded-lg bg-secondary/50 p-3 space-y-2">
            <p className="text-xs font-medium text-amber-500">
              Copy this key now — it won&apos;t be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] font-mono break-all">
                {freshKey}
              </code>
              <Button
                variant="secondary"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-lg"
                onClick={() => copyText(freshKey, "API key")}
                aria-label="Copy API key"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {cameras.length > 0 && (
            <div className="rounded-lg bg-secondary/50 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Snapshot URLs for your hub:
              </p>
              {cameras.map((cam) => (
                <div key={cam.id} className="flex items-center gap-2">
                  <span className="text-xs font-medium w-24 truncate shrink-0">
                    {cam.name}
                  </span>
                  <code className="flex-1 text-[10px] font-mono truncate text-muted-foreground">
                    {snapshotUrl(cam.slug, freshKey)}
                  </code>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 shrink-0 rounded-lg"
                    onClick={() => copyText(snapshotUrl(cam.slug, freshKey), `${cam.name} URL`)}
                    aria-label={`Copy ${cam.name} snapshot URL`}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">
                Append <code className="font-mono">&amp;h=720</code> to resize.
                The key can also be sent as an{" "}
                <code className="font-mono">X-Api-Key</code> header instead of
                the <code className="font-mono">?key=</code> parameter.
              </p>
            </div>
          )}
        </div>
      )}

      {confirmAction ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {confirmAction === "generate" && status?.exists
              ? "Generating a new key immediately invalidates the current one — devices using it will stop working until updated."
              : confirmAction === "revoke"
                ? "Revoking disables snapshot access for all devices using this key."
                : "Generate a snapshot API key?"}
          </p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={confirmAction === "generate" ? generate : revoke}
              disabled={busy}
              className="flex-1 h-10 rounded-xl"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setConfirmAction(null)}
              disabled={busy}
              className="flex-1 h-10 rounded-xl"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              status?.exists ? setConfirmAction("generate") : generate()
            }
            disabled={busy}
            className="flex-1 h-10 gap-2 rounded-xl"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            {status?.exists ? "Regenerate Key" : "Generate Key"}
          </Button>
          {status?.exists && (
            <Button
              variant="secondary"
              onClick={() => setConfirmAction("revoke")}
              disabled={busy}
              className="h-10 gap-2 rounded-xl text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Revoke
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
