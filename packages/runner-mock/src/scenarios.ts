import type { Task } from "@solus/core";
import { added, hunk, modified } from "./patch";
import { ansi, ask, bash, diff, done, fail, say, tool, type Scenario, type Step } from "./script";

export const MOCK_REPO = "acme/storefront";
export const MOCK_BASE_BRANCH = "main";

const MIN = 60_000;

/* ------------------------------------------------------------------ */
/* 1. Rate limiting: working → needs_input → (reply) → ready_for_review */
/* ------------------------------------------------------------------ */

const rateLimitLib = added(
  "src/lib/rate-limit.ts",
  `
import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "@/lib/cache";

const checkoutLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
  prefix: "rl:checkout",
  analytics: true,
});

export interface LimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

/** Sliding window: 10 checkout attempts per minute per user (or IP for guests). */
export async function limitCheckout(key: string): Promise<LimitResult> {
  const { success, reset } = await checkoutLimiter.limit(key);
  return {
    ok: success,
    retryAfterSeconds: success ? 0 : Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
  };
}
`,
);

const checkoutRoute = modified("app/api/checkout/route.ts", [
  hunk(
    1,
    `
 import { NextResponse, type NextRequest } from "next/server";
 import { getSession } from "@/lib/auth";
 import { createCheckoutSession } from "@/lib/payments";
+import { limitCheckout } from "@/lib/rate-limit";

 export async function POST(req: NextRequest) {
   const session = await getSession(req);
+  const key = session?.userId ?? req.headers.get("x-forwarded-for") ?? "anonymous";
+  const limit = await limitCheckout(key);
+  if (!limit.ok) {
+    return NextResponse.json(
+      { error: "Too many checkout attempts. Try again shortly." },
+      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
+    );
+  }
+
   const body = await req.json();
   const cart = await loadCart(session, body.cartId);
`,
  ),
]);

const rateLimitTest = added(
  "src/lib/rate-limit.test.ts",
  `
import { describe, expect, it, vi } from "vitest";

vi.mock("@upstash/ratelimit", () => {
  let calls = 0;
  class Ratelimit {
    static slidingWindow() {}
    async limit() {
      calls += 1;
      return { success: calls <= 10, reset: Date.now() + 42_000 };
    }
  }
  return { Ratelimit };
});

const { limitCheckout } = await import("./rate-limit");

describe("limitCheckout", () => {
  it("allows the first 10 attempts", async () => {
    for (let i = 0; i < 10; i++) expect((await limitCheckout("u_1")).ok).toBe(true);
  });

  it("blocks the 11th and reports Retry-After", async () => {
    const res = await limitCheckout("u_1");
    expect(res.ok).toBe(false);
    expect(res.retryAfterSeconds).toBe(42);
  });
});
`,
);

const packageJsonRatelimit = modified("package.json", [
  hunk(
    22,
    `
     "@stripe/stripe-js": "^5.4.0",
+    "@upstash/ratelimit": "^2.0.5",
     "@upstash/redis": "^1.34.3",
     "clsx": "^2.1.1",
`,
  ),
]);

const rateLimit: Scenario = {
  id: "tsk_rate_limit",
  title: "Add rate limiting to /api/checkout",
  prompt:
    "Add rate limiting to POST /api/checkout. Each user gets 10 checkout attempts per minute; past that, return 429 with a Retry-After header.",
  branch: "solus/rate-limit-checkout",
  state: "working",
  createdAgo: 1.5 * MIN,
  history: [
    {
      ago: 1.5 * MIN,
      role: "user",
      text: "Add rate limiting to POST /api/checkout. Each user gets 10 checkout attempts per minute; past that, return 429 with a Retry-After header.",
    },
  ],
  run: [
    say(600, "I'll start with the checkout route and look for any existing middleware or rate limiting I can reuse."),
    tool(1200, "Read", "app/api/checkout/route.ts"),
    tool(700, "Grep", "rateLimit|rate-limit|ratelimit  (0 matches)"),
    ...bash(900, 'rg -n "@upstash" --type ts', [
      'src/lib/cache.ts:1:import { Redis } from "@upstash/redis";',
      "src/lib/cache.ts:3:export const redis = Redis.fromEnv();",
    ]),
    tool(600, "Read", "src/lib/cache.ts"),
    say(
      1500,
      "There's no rate limiting today. There is an Upstash Redis client in `src/lib/cache.ts`, used for product caching. Two options:\n\n" +
        "1. **Upstash Redis**: one counter shared by every server instance, so the limit holds in production. Costs one Redis call per checkout.\n" +
        "2. **In-memory**: no new dependency, but each instance counts on its own, so on serverless the real limit becomes 10 × instances.\n\n" +
        "I'd use Redis.",
    ),
    ask(800, "Should I use the existing Upstash Redis client, or keep the limiter in-memory with no new dependency?"),
  ],
  onReply: [
    say(700, "Going with Upstash. I'll use a sliding window keyed on the user id, falling back to the client IP for guests."),
    ...bash(900, "pnpm add @upstash/ratelimit", [
      ansi.dim("Packages: +1"),
      "dependencies:",
      ansi.green("+ @upstash/ratelimit 2.0.5"),
      ansi.dim("Done in 2.1s"),
    ]),
    diff(100, packageJsonRatelimit),
    tool(1100, "Write", "src/lib/rate-limit.ts"),
    diff(200, rateLimitLib),
    tool(1000, "Edit", "app/api/checkout/route.ts"),
    diff(200, checkoutRoute),
    tool(1100, "Write", "src/lib/rate-limit.test.ts"),
    diff(200, rateLimitTest),
    ...bash(900, "pnpm vitest run src/lib/rate-limit", [
      "",
      ` ${ansi.green("✓")} src/lib/rate-limit.test.ts ${ansi.dim("(2 tests) 14ms")}`,
      "",
      ` Test Files  ${ansi.green("1 passed")} (1)`,
      `      Tests  ${ansi.green("2 passed")} (2)`,
    ]),
    say(
      1200,
      "Done. `POST /api/checkout` now allows 10 attempts per user per minute and returns **429** with `Retry-After` past that. Guests are keyed on IP. Added `@upstash/ratelimit` and 2 tests; both pass.",
    ),
    done(400),
  ],
  autopilot: [
    { when: "needs_input", after: 20_000, do: "reply", text: "Use Redis. Reuse the client in src/lib/cache.ts." },
  ],
};

/* ------------------------------------------------------------------ */
/* 2. Flaky test: working → stuck → (nudge) → ready_for_review → merged */
/* ------------------------------------------------------------------ */

const flakyFailure = [
  "",
  ` ${ansi.red("✗")} src/cart/totals.test.ts > cart totals > applies percentage discount`,
  `   ${ansi.red("AssertionError: expected 4497 to be 4047")}`,
  `   ${ansi.dim("❯ src/cart/totals.test.ts:58:32")}`,
  "",
  ` Test Files  ${ansi.red("1 failed")} (1)`,
  `      Tests  ${ansi.red("1 failed")} | ${ansi.green("399 passed")} (400)`,
];

const promoCache = modified("src/cart/promo-cache.ts", [
  hunk(
    1,
    `
 import type { Promo } from "./types";

 const cache = new Map<string, Promo>();

 export function getCachedPromo(code: string): Promo | undefined {
   return cache.get(code);
 }

 export function setCachedPromo(promo: Promo): void {
   cache.set(promo.code, promo);
 }
+
+/** Tests only: the cache is module-level and otherwise leaks between tests. */
+export function clearPromoCache(): void {
+  cache.clear();
+}
`,
  ),
]);

const totalsTest = modified("src/cart/totals.test.ts", [
  hunk(
    1,
    `
-import { describe, expect, it } from "vitest";
+import { beforeEach, describe, expect, it } from "vitest";
 import { calculateTotals } from "./totals";
+import { clearPromoCache } from "./promo-cache";
 import { cartWith, promo } from "./fixtures";

 describe("cart totals", () => {
+  beforeEach(() => {
+    clearPromoCache();
+  });
+
   it("sums line items in cents", () => {
`,
  ),
]);

const flakyTest: Scenario = {
  id: "tsk_flaky_totals",
  title: "Fix flaky cart totals test",
  prompt:
    "`cart totals > applies percentage discount` fails on roughly 1 in 5 CI runs. Find the cause and fix it properly; don't just add a retry.",
  branch: "solus/fix-flaky-cart-totals",
  state: "working",
  createdAgo: 3 * MIN,
  history: [
    {
      ago: 3 * MIN,
      role: "user",
      text: "`cart totals > applies percentage discount` fails on roughly 1 in 5 CI runs. Find the cause and fix it properly; don't just add a retry.",
    },
    { ago: 2.8 * MIN, role: "agent", text: "I'll reproduce it first by running the cart tests in a loop." },
  ],
  run: [
    ...bash(1200, "pnpm vitest run src/cart --sequence.shuffle --repeat 20", flakyFailure),
    say(900, "Reproduced: 1 failure in 20 runs. The total is 4497 instead of 4047, so the 10% discount wasn't applied. I suspect rounding in `applyDiscount`."),
    tool(1000, "Read", "src/cart/totals.ts"),
    tool(900, "Edit", "src/cart/totals.ts  (round discount per line instead of on the total)"),
    ...bash(1200, "pnpm vitest run src/cart --sequence.shuffle --repeat 20", flakyFailure),
    say(800, "Still failing, same numbers, so it isn't rounding. Reverting that edit. Trying with the fake timers pinned in case the promo's expiry check is time-dependent."),
    tool(900, "Edit", "src/cart/totals.test.ts  (vi.setSystemTime before each test)"),
    ...bash(1200, "pnpm vitest run src/cart --sequence.shuffle --repeat 20", flakyFailure),
    fail(
      700,
      "Same test failed after 3 fix attempts",
      "cart totals > applies percentage discount: expected 4497 to be 4047. Not rounding and not time-dependent. The failure only shows up with --sequence.shuffle.",
    ),
  ],
  onNudge: [
    say(700, "Good lead. That would explain why it only fails when the tests are shuffled."),
    tool(800, "Read", "src/cart/promo-cache.ts"),
    say(
      1000,
      "Found it. `promo-cache.ts` keeps a module-level `Map`. The \"expired promo is ignored\" test caches `SAVE10` with a past expiry date, and if it runs first, the discount test reads the expired promo from the cache and skips the discount.",
    ),
    tool(900, "Edit", "src/cart/promo-cache.ts"),
    diff(200, promoCache),
    tool(900, "Edit", "src/cart/totals.test.ts"),
    diff(200, totalsTest),
    ...bash(1300, "pnpm vitest run src/cart --sequence.shuffle --repeat 50", [
      "",
      ` Test Files  ${ansi.green("1 passed")} (1)`,
      `      Tests  ${ansi.green("1000 passed")} (1000)`,
    ]),
    say(1000, "Fixed. The promo cache leaked between tests; it's now cleared in `beforeEach`. I reverted my two earlier guesses. 50 shuffled runs, 0 failures."),
    done(400),
  ],
  autopilot: [
    {
      when: "stuck",
      after: 20_000,
      do: "reply",
      text: "The discount comes from the promo cache, which might be shared between tests. Check it.",
    },
    { when: "ready_for_review", after: 9000, do: "merge" },
  ],
};

/* ------------------------------------------------------------------ */
/* 3. moment → date-fns: already working, a long run → ready_for_review */
/* ------------------------------------------------------------------ */

const dateFormat = modified("src/lib/format-date.ts", [
  hunk(
    1,
    `
-import moment from "moment";
+import { format, formatDistanceToNowStrict, parseISO } from "date-fns";

 export function formatOrderDate(iso: string): string {
-  return moment(iso).format("MMM D, YYYY");
+  return format(parseISO(iso), "MMM d, yyyy");
 }

 export function formatRelative(iso: string): string {
-  return moment(iso).fromNow();
+  return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
 }
`,
  ),
]);

const shippingEstimate = modified("src/lib/shipping-estimate.ts", [
  hunk(
    1,
    `
-import moment from "moment";
+import { addBusinessDays, format } from "date-fns";

 export function estimateDelivery(orderedAt: Date, businessDays: number): string {
-  const date = moment(orderedAt).add(businessDays, "days");
-  while (date.day() === 0 || date.day() === 6) date.add(1, "day");
-  return date.format("dddd, MMM D");
+  return format(addBusinessDays(orderedAt, businessDays), "EEEE, MMM d");
 }
`,
  ),
]);

const orderRow = modified("components/orders/order-row.tsx", [
  hunk(
    3,
    `
 import { Badge } from "@/components/ui/badge";
-import moment from "moment";
+import { formatOrderDate } from "@/lib/format-date";

 export function OrderRow({ order }: { order: Order }) {
   return (
     <tr>
       <td>{order.number}</td>
-      <td>{moment(order.placedAt).format("MMM D, YYYY")}</td>
+      <td>{formatOrderDate(order.placedAt)}</td>
       <td><Badge>{order.status}</Badge></td>
`,
  ),
]);

const subscriptionRenewal = modified("src/billing/renewal.ts", [
  hunk(
    1,
    `
-import moment from "moment";
+import { addMonths, isBefore, startOfDay } from "date-fns";

 export function nextRenewal(startedAt: Date, now = new Date()): Date {
-  let next = moment(startedAt);
-  while (next.isBefore(now)) next = next.add(1, "month");
-  return next.startOf("day").toDate();
+  let next = startedAt;
+  while (isBefore(next, now)) next = addMonths(next, 1);
+  return startOfDay(next);
 }
`,
  ),
]);

const promoBanner = modified("components/promo/countdown.tsx", [
  hunk(
    1,
    `
 "use client";
-import moment from "moment";
+import { differenceInSeconds } from "date-fns";
 import { useNow } from "@/hooks/use-now";

 export function Countdown({ endsAt }: { endsAt: string }) {
   const now = useNow(1000);
-  const secs = Math.max(0, moment(endsAt).diff(now, "seconds"));
+  const secs = Math.max(0, differenceInSeconds(new Date(endsAt), now));
`,
  ),
]);

const packageJsonMoment = modified("package.json", [
  hunk(
    24,
    `
     "clsx": "^2.1.1",
-    "moment": "^2.30.1",
+    "date-fns": "^4.1.0",
     "next": "16.4.5",
`,
  ),
]);

const renewalTest = modified("src/billing/renewal.test.ts", [
  hunk(
    18,
    `
   it("rolls over month ends", () => {
     const started = new Date("2026-01-31T10:00:00Z");
-    expect(nextRenewal(started, new Date("2026-02-15"))).toEqual(new Date("2026-03-03"));
+    // date-fns clamps to the last day of the month, unlike moment's overflow.
+    expect(nextRenewal(started, new Date("2026-02-15"))).toEqual(new Date("2026-02-28"));
   });
`,
  ),
]);

const momentMigration: Scenario = {
  id: "tsk_date_fns",
  title: "Migrate date utils from moment to date-fns",
  prompt:
    "Replace moment with date-fns everywhere and drop the dependency. Keep output formats identical; flag anything where behaviour changes.",
  branch: "solus/moment-to-date-fns",
  state: "working",
  createdAgo: 9 * MIN,
  history: [
    {
      ago: 9 * MIN,
      role: "user",
      text: "Replace moment with date-fns everywhere and drop the dependency. Keep output formats identical; flag anything where behaviour changes.",
    },
    { ago: 8.8 * MIN, role: "tool", tool: "Grep", text: 'from "moment"  (5 files)' },
    {
      ago: 8.5 * MIN,
      role: "agent",
      text: "moment is imported in 5 files. I'll convert them one at a time, map the format tokens (moment's `D`/`YYYY` become date-fns's `d`/`yyyy`), then remove the package and run the full suite.",
    },
    { ago: 7 * MIN, role: "tool", tool: "Edit", text: "src/lib/format-date.ts" },
    { ago: 5.5 * MIN, role: "tool", tool: "Edit", text: "src/lib/shipping-estimate.ts" },
  ],
  initialDiff: [dateFormat, shippingEstimate],
  run: [
    say(800, "`shipping-estimate.ts` had a hand-rolled weekend skip; `addBusinessDays` does the same thing, so I replaced the loop."),
    tool(1400, "Edit", "components/orders/order-row.tsx"),
    diff(200, orderRow),
    tool(1500, "Edit", "src/billing/renewal.ts"),
    diff(200, subscriptionRenewal),
    tool(1400, "Edit", "components/promo/countdown.tsx"),
    diff(200, promoBanner),
    ...bash(1000, "pnpm remove moment && pnpm add date-fns", [
      "dependencies:",
      ansi.red("- moment 2.30.1"),
      ansi.green("+ date-fns 4.1.0"),
    ]),
    diff(100, packageJsonMoment),
    ...bash(1200, "pnpm typecheck", [ansi.dim("tsc --noEmit"), ansi.green("No errors.")]),
    ...bash(1600, "pnpm vitest run", [
      "",
      ` ${ansi.red("✗")} src/billing/renewal.test.ts > nextRenewal > rolls over month ends`,
      `   ${ansi.red("expected 2026-02-28 to equal 2026-03-03")}`,
      "",
      `      Tests  ${ansi.red("1 failed")} | ${ansi.green("611 passed")} (612)`,
    ]),
    say(
      1000,
      "One real behaviour change: a subscription started on Jan 31 used to renew on **Mar 3** (moment overflows the month), and now renews on **Feb 28** (date-fns clamps). Feb 28 is what customers would expect, so I updated the test and left a comment. Flagging it for you to confirm.",
    ),
    tool(900, "Edit", "src/billing/renewal.test.ts"),
    diff(200, renewalTest),
    ...bash(1500, "pnpm vitest run", ["", `      Tests  ${ansi.green("612 passed")} (612)`]),
    say(900, "All 5 files migrated, `moment` removed (−290 kB from the client bundle), 612 tests pass. The only behaviour change is the month-end renewal date above."),
    done(400),
  ],
};

/* ------------------------------------------------------------------ */
/* 4. Dark mode: ready_for_review → (request changes) → … → merged via PR */
/* ------------------------------------------------------------------ */

const themeToggleV1 = added(
  "components/settings/theme-toggle.tsx",
  `
"use client";
import { useEffect, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const saved = localStorage.getItem("theme") as Theme | null;
    if (saved) setTheme(saved);
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.dataset.theme = next;
  }

  return (
    <ToggleGroup type="single" value={theme} onValueChange={(v) => v && choose(v as Theme)}>
      <ToggleGroupItem value="light">Light</ToggleGroupItem>
      <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
    </ToggleGroup>
  );
}
`,
);

const themeToggleV2 = added(
  "components/settings/theme-toggle.tsx",
  `
"use client";
import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { setThemeCookie, type ThemePreference } from "@/lib/theme";

export function ThemeToggle({ initial }: { initial: ThemePreference }) {
  const [theme, setTheme] = useState<ThemePreference>(initial);

  async function choose(next: ThemePreference) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    await setThemeCookie(next);
  }

  return (
    <ToggleGroup type="single" value={theme} onValueChange={(v) => v && choose(v as ThemePreference)}>
      <ToggleGroupItem value="system">System</ToggleGroupItem>
      <ToggleGroupItem value="light">Light</ToggleGroupItem>
      <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
    </ToggleGroup>
  );
}
`,
);

const themeLib = added(
  "src/lib/theme.ts",
  `
"use server";
import { cookies } from "next/headers";

export type ThemePreference = "system" | "light" | "dark";

export async function getThemePreference(): Promise<ThemePreference> {
  const value = (await cookies()).get("theme")?.value;
  return value === "light" || value === "dark" ? value : "system";
}

export async function setThemeCookie(theme: ThemePreference): Promise<void> {
  (await cookies()).set("theme", theme, { path: "/", maxAge: 60 * 60 * 24 * 365 });
}
`,
);

const appearancePageV1 = modified("app/settings/appearance/page.tsx", [
  hunk(
    1,
    `
 import { SettingsSection } from "@/components/settings/section";
+import { ThemeToggle } from "@/components/settings/theme-toggle";

 export default function AppearancePage() {
   return (
     <SettingsSection title="Appearance" description="How the store looks for you.">
-      <p className="text-muted-foreground">More options coming soon.</p>
+      <ThemeToggle />
     </SettingsSection>
   );
 }
`,
  ),
]);

const appearancePageV2 = modified("app/settings/appearance/page.tsx", [
  hunk(
    1,
    `
 import { SettingsSection } from "@/components/settings/section";
+import { ThemeToggle } from "@/components/settings/theme-toggle";
+import { getThemePreference } from "@/lib/theme";

-export default function AppearancePage() {
+export default async function AppearancePage() {
+  const theme = await getThemePreference();
   return (
     <SettingsSection title="Appearance" description="How the store looks for you.">
-      <p className="text-muted-foreground">More options coming soon.</p>
+      <ThemeToggle initial={theme} />
     </SettingsSection>
   );
 }
`,
  ),
]);

const globalsCss = modified("app/globals.css", [
  hunk(
    12,
    `
   --muted: oklch(0.96 0 0);
 }
+
+[data-theme="dark"] {
+  --background: oklch(0.16 0 0);
+  --foreground: oklch(0.96 0 0);
+  --muted: oklch(0.24 0 0);
+}
`,
  ),
]);

const darkMode: Scenario = {
  id: "tsk_dark_mode",
  title: "Add dark mode to settings page",
  prompt: "Add a theme switch to Settings → Appearance. Light and dark for now, using our existing CSS variables.",
  branch: "solus/settings-dark-mode",
  state: "ready_for_review",
  createdAgo: 26 * MIN,
  history: [
    {
      ago: 26 * MIN,
      role: "user",
      text: "Add a theme switch to Settings → Appearance. Light and dark for now, using our existing CSS variables.",
    },
    { ago: 24 * MIN, role: "tool", tool: "Write", text: "components/settings/theme-toggle.tsx" },
    { ago: 22 * MIN, role: "tool", tool: "Edit", text: "app/settings/appearance/page.tsx" },
    { ago: 21 * MIN, role: "tool", tool: "Edit", text: "app/globals.css" },
    {
      ago: 20 * MIN,
      role: "agent",
      text: "Added a Light/Dark toggle to Settings → Appearance. The choice is saved in localStorage and applied through a `data-theme` attribute, with dark values for the existing CSS variables.",
    },
  ],
  initialDiff: [themeToggleV1, appearancePageV1, globalsCss],
  onRevise: [
    say(800, "Makes sense. A cookie lets the server render the right theme, so there's no flash of light theme on load."),
    tool(1000, "Write", "src/lib/theme.ts"),
    diff(200, themeLib),
    tool(1200, "Edit", "components/settings/theme-toggle.tsx"),
    diff(200, themeToggleV2),
    tool(1000, "Edit", "app/settings/appearance/page.tsx"),
    diff(200, appearancePageV2),
    ...bash(1200, "pnpm typecheck && pnpm lint", [ansi.green("No errors."), ansi.green("✔ No ESLint warnings or errors")]),
    say(900, "Updated: the toggle now has System / Light / Dark, defaults to System, and stores the choice in a cookie that the server reads, so the first paint is already correct."),
    done(400),
  ],
  autopilot: [
    {
      when: "ready_for_review",
      after: 12_000,
      do: "reply",
      text: "Default to 'System' and store the choice in a cookie instead of localStorage, so there's no flash on load.",
    },
    { when: "ready_for_review", after: 10_000, do: "pr" },
  ],
};

/* ------------------------------------------------------------------ */
/* 5. Stripe upgrade: ready_for_review → merged via PR, quickly        */
/* ------------------------------------------------------------------ */

const stripeLib = modified("src/lib/payments.ts", [
  hunk(
    1,
    `
 import Stripe from "stripe";

 export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
-  apiVersion: "2024-06-20",
+  apiVersion: "2026-09-30.clover",
+  maxNetworkRetries: 2,
 });
`,
  ),
  hunk(
    31,
    `
     line_items: lineItems,
     mode: "payment",
-    payment_method_types: ["card"],
+    automatic_payment_methods: { enabled: true },
     success_url: successUrl,
`,
  ),
]);

const stripeWebhook = modified("app/api/webhooks/stripe/route.ts", [
  hunk(
    14,
    `
   switch (event.type) {
     case "checkout.session.completed": {
-      const session = event.data.object as Stripe.Checkout.Session;
+      const session = event.data.object;
       await markOrderPaid(session.metadata.orderId, session.payment_intent as string);
       break;
     }
`,
  ),
]);

const stripePackageJson = modified("package.json", [
  hunk(
    30,
    `
     "react-dom": "19.3.0",
-    "stripe": "^16.12.0",
+    "stripe": "^22.5.0",
     "zod": "^4.4.3"
`,
  ),
]);

const stripeUpgrade: Scenario = {
  id: "tsk_stripe_v22",
  title: "Upgrade Stripe SDK to v22",
  prompt: "Upgrade the stripe package to v22 and fix anything that breaks. Check the webhook handler in particular.",
  branch: "solus/upgrade-stripe-v22",
  state: "ready_for_review",
  createdAgo: 48 * MIN,
  history: [
    {
      ago: 48 * MIN,
      role: "user",
      text: "Upgrade the stripe package to v22 and fix anything that breaks. Check the webhook handler in particular.",
    },
    { ago: 46 * MIN, role: "tool", tool: "Bash", text: "pnpm add stripe@22" },
    { ago: 44 * MIN, role: "tool", tool: "Edit", text: "src/lib/payments.ts" },
    { ago: 43 * MIN, role: "tool", tool: "Edit", text: "app/api/webhooks/stripe/route.ts" },
    {
      ago: 41 * MIN,
      role: "agent",
      text: "Upgraded to stripe 22.5 and pinned the new API version. Event payloads are now typed per event, so I dropped the cast in the webhook handler. Switched checkout to `automatic_payment_methods`, since `payment_method_types` is deprecated. Typecheck and the 38 payment tests pass.",
    },
  ],
  initialDiff: [stripePackageJson, stripeLib, stripeWebhook],
  autopilot: [{ when: "ready_for_review", after: 5000, do: "pr" }],
};

/* ------------------------------------------------------------------ */
/* 6. CSV export: idle → (start) → working → needs_input               */
/* ------------------------------------------------------------------ */

const csvExport: Scenario = {
  id: "tsk_csv_export",
  title: "Add CSV export to the orders table",
  prompt: "Add an Export CSV button to the admin orders table. It should export the current filtered result, not just the visible page.",
  branch: "solus/orders-csv-export",
  state: "idle",
  createdAgo: 2 * MIN,
  run: [
    say(600, "Looking at how the orders table loads and filters its data."),
    tool(1000, "Read", "app/admin/orders/page.tsx"),
    tool(800, "Read", "components/admin/orders-table.tsx"),
    tool(800, "Read", "src/admin/orders-query.ts"),
    say(
      1200,
      "The table filters on the server through `ordersQuery(filters)` and pages 50 at a time, so the export can reuse the same query without the page limit. The table also lets admins hide columns.",
    ),
    ask(700, "Should the CSV include all 11 order columns, or only the ones the admin has visible in the table?"),
  ],
  autopilot: [{ when: "idle", after: 25_000, do: "start" }],
};

export const SCENARIOS: readonly Scenario[] = [
  rateLimit,
  flakyTest,
  momentMigration,
  darkMode,
  stripeUpgrade,
  csvExport,
];

/* ------------------------------------------------------------------ */
/* Generic scripts, for tasks created at runtime and repeat interactions */
/* ------------------------------------------------------------------ */

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "task"
  );
}

export function branchFor(title: string): string {
  return `solus/${slug(title)}`;
}

export function genericRun(task: Task): Step[] {
  const file = `src/features/${slug(task.title)}.ts`;
  return [
    say(600, "Reading the relevant parts of the codebase first."),
    tool(1000, "Glob", "src/**/*.ts  (214 files)"),
    tool(900, "Read", "src/lib/index.ts"),
    say(1000, `I'll put this in \`${file}\` and wire it up from there.`),
    tool(1200, "Write", file),
    diff(
      200,
      added(
        file,
        `
// ${task.title}
export function run(): void {
  // Generated by runner-mock.
}
`,
      ),
    ),
    ...bash(1000, "pnpm typecheck", [ansi.green("No errors.")]),
    say(800, "First pass is done and typechecks. Ready for you to look at."),
    done(400),
  ];
}

export const genericReply: Step[] = [
  say(700, "Thanks, that settles it. Continuing."),
  tool(1200, "Edit", "src/index.ts"),
  ...bash(1000, "pnpm vitest run", ["", `      Tests  ${ansi.green("all passed")}`]),
  say(700, "Done with your answer applied."),
  done(400),
];

export const genericNudge: Step[] = [
  say(700, "Trying again with that in mind."),
  ...bash(1200, "pnpm vitest run", ["", `      Tests  ${ansi.green("all passed")}`]),
  say(700, "That did it. Tests pass now."),
  done(400),
];

export const genericRevise: Step[] = [
  say(700, "On it. Applying your review comments."),
  tool(1200, "Edit", "src/index.ts"),
  ...bash(1000, "pnpm typecheck", [ansi.green("No errors.")]),
  say(700, "Changes made. Ready for another look."),
  done(400),
];

export const genericAck: Step[] = [say(500, "Noted. I'll fold that into what I'm doing.")];
