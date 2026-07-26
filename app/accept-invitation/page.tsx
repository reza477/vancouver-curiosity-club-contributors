import type { Metadata } from "next";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { AcceptInvitationFlow } from "./AcceptInvitationFlow";
import "@/app/_organizer/organizer.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accept organizer invitation",
  description: "Secure one-time invitation acceptance for the private organizer workspace.",
  alternates: {},
  openGraph: null,
  twitter: null,
  referrer: "no-referrer",
  robots: {
    follow: false,
    index: false,
    nocache: true,
    noarchive: true,
    noimageindex: true,
  },
};

export default async function AcceptInvitationPage() {
  await requireChatGPTUser("/accept-invitation");
  return <AcceptInvitationFlow />;
}
