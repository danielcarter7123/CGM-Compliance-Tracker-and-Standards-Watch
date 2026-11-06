import AppHeader, { AppFooter } from "@/components/AppHeader";
import { getViewer } from "@/lib/auth";

/** CGM Workspace pages (launcher, account, admin, setup). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer().catch(() => null);
  return (
    <>
      <AppHeader app="workspace" viewer={viewer} />
      {children}
      <AppFooter app="workspace" />
    </>
  );
}
