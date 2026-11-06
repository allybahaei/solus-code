"use client";

import { Check, ChevronDown } from "lucide-react";
import type { AgentCheck, AgentKind } from "@solus/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSolus } from "@/lib/store";
import { cn } from "@/lib/utils";

export const AGENTS: Record<AgentKind, { label: string; maker: string; description: string }> = {
  "claude-code": { label: "Claude Code", maker: "Anthropic", description: "Agentic coding in the terminal" },
  claude: { label: "Claude", maker: "Anthropic", description: "Chat and reasoning" },
  codex: { label: "Codex", maker: "OpenAI", description: "Coding agent" },
  gemini: { label: "Gemini", maker: "Google", description: "Gemini CLI" },
};

/** Agents with no adapter don't appear; ones not set up appear disabled with their fix. */
const hint = (check: AgentCheck) => (check.state === "ready" ? null : (check.fix ?? "Not available"));

export function AgentIcon({ agent, className }: { agent: AgentKind; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny static SVG, no optimisation needed
    <img src={`/agents/${agent}.svg`} alt="" aria-hidden width={16} height={16} className={cn("size-4 shrink-0", className)} />
  );
}

/** A small pill that opens a menu of agents. */
export function AgentPicker({
  value,
  onChange,
  disabled,
  align = "start",
}: {
  value: AgentKind;
  onChange: (agent: AgentKind) => void;
  disabled?: boolean;
  align?: "start" | "end";
}) {
  const checks = useSolus((s) => s.setup?.agents) ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={`Agent: ${AGENTS[value].label}. Change agent`}
        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-accent data-[state=open]:text-foreground"
      >
        <AgentIcon agent={value} className="size-3.5" />
        <span className="font-medium">{AGENTS[value].label}</span>
        <ChevronDown className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side="top" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Agent</DropdownMenuLabel>
        {checks.map((check) => (
          <DropdownMenuItem
            key={check.agent}
            disabled={check.state !== "ready"}
            onSelect={() => onChange(check.agent)}
            className="gap-2.5 py-2"
          >
            <AgentIcon agent={check.agent} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm">{AGENTS[check.agent].label}</span>
              <span className="truncate text-xs text-muted-foreground">
                {hint(check) ?? `${AGENTS[check.agent].maker} · ${AGENTS[check.agent].description}`}
              </span>
            </span>
            {check.agent === value && <Check className="size-4 text-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
