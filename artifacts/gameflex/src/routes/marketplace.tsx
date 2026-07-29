// @ts-nocheck
import { pageSeo } from "@/lib/seo";
import { createFileRoute } from "@tanstack/react-router";
import { createLazyPage } from "@/lib/lazy-page";

const Page = createLazyPage(() => import('@/pages/Marketplace'));

export const Route = createFileRoute("/marketplace")({
  head: () =>
    pageSeo({
      title: "Gaming Marketplace | GameFlex",
      description:
        "Buy and sell accounts, skins, coaching and in-game items with escrow-protected payments.",
    }),
  component: Page,
});
