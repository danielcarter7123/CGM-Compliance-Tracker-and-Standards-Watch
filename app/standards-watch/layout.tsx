import AppHeader, { AppFooter } from "@/components/AppHeader";
import { getViewer } from "@/lib/auth";

export const metadata = { title: { default: "CGM Standards Watch", template: "%s | CGM Standards Watch" } };

/** CGM Standards Watch: its own app, with its own header and a way back to CGM Workspace. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer().catch(() => null);
  return (
    <>
      <AppHeader app="watch" viewer={viewer} />
      {children}
      <AppFooter app="watch" />
    </>
  );
}
