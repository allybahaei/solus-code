"use client";

import { useEffect } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { AgentKind, ChatOptions } from "@solus/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { loadModels } from "@/lib/actions";
import { useSolus } from "@/lib/store";

const pretty = (effort: string) => effort[0]?.toUpperCase() + effort.slice(1);

/** The chat's model and effort. Hidden for agents Solus can't choose a model for. */
export function ModelPicker({ agent, options, onChange }: { agent: AgentKind; options: ChatOptions; onChange: (options: ChatOptions) => void }) {
  const models = useSolus((s) => s.models[agent]);
  useEffect(() => void loadModels(agent), [agent]);
  if (!models?.length) return null;

  const model = models.find((m) => m.id === options.model);
  const efforts = (model ?? models[0])?.efforts ?? [];
  const label = [model?.label ?? "Default model", options.effort && pretty(options.effort)].filter(Boolean).join(" · ");
  const row = (text: string, on: boolean, select: () => void) => (
    <DropdownMenuItem key={text} onSelect={select} className="gap-2">
      <Check className={on ? "size-3.5" : "size-3.5 opacity-0"} />
      {text}
    </DropdownMenuItem>
  );
  const without = (key: "model" | "effort") => {
    const rest = { ...options };
    delete rest[key];
    return rest;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Model: ${label}. Change model`}
        className="inline-flex h-7 max-w-44 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Model</DropdownMenuLabel>
        {row("Default model", !options.model, () => onChange(without("model")))}
        {models.map((m) => row(m.label, m.id === options.model, () => onChange({ ...options, model: m.id })))}
        {efforts.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Effort</DropdownMenuLabel>
            {row("Default effort", !options.effort, () => onChange(without("effort")))}
            {efforts.map((e) => row(pretty(e), e === options.effort, () => onChange({ ...options, effort: e })))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
