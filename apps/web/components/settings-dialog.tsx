"use client";

import { useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { loadOpenTargets, saveSettings } from "@/lib/actions";
import { useTheme } from "@/lib/hooks";
import { useSolus } from "@/lib/store";
import { setTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-5 w-9 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        on ? "bg-foreground" : "bg-muted",
      )}
    >
      <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-background transition-transform", on && "translate-x-4")} />
    </button>
  );
}

export function SettingsDialog() {
  const open = useSolus((s) => s.overlay === "settings");
  const setOverlay = useSolus((s) => s.setOverlay);
  const settings = useSolus((s) => s.settings);
  const targets = useSolus((s) => s.openTargets);
  const theme = useTheme();
  const editors = (targets ?? []).filter((t) => t.kind !== "finder");

  useEffect(() => {
    if (open) void loadOpenTargets();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => setOverlay(o ? "settings" : null)}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription className="sr-only">Your Solus preferences</DialogDescription>
        <div className="divide-y">
          <Row label="Theme">
            <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
              {THEMES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                  className={cn("rounded px-2.5 py-1 text-xs", theme === value ? "bg-background font-medium" : "text-muted-foreground")}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Notifications" hint="In the Mac app, when a task needs you and Solus isn't in front.">
            <Toggle label="Notifications" on={settings.notifications} onChange={(notifications) => void saveSettings({ notifications })} />
          </Row>
          <Row label="Sound" hint="Plays with the notification.">
            <Toggle label="Sound" on={settings.sound} onChange={(sound) => void saveSettings({ sound })} />
          </Row>
          {editors.length > 0 && (
            <Row label="Open with" hint="What the O shortcut uses.">
              <select
                aria-label="Open with"
                value={settings.editor ?? editors[0]?.id}
                onChange={(e) => void saveSettings({ editor: e.target.value })}
                className="rounded-md border bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {editors.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Row>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
