// @ts-nocheck
import { pageSeo } from "@/lib/seo";
import { createFileRoute } from "@tanstack/react-router";
import { createLazyPage } from "@/lib/lazy-page";

const Page = createLazyPage(() => import('@/pages/social/Create'));
export const Route = createFileRoute("/create")({
  head: () =>
    pageSeo({
      title: "Create a Post | GameFlex",
      description:
        "Share clips, match highlights and updates with the GameFlex community.",
      noindex: true,
    }),
  component: Page,
});