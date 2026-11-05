import LoginForm from "@/components/LoginForm";

export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  const next = searchParams.next && searchParams.next.startsWith("/") ? searchParams.next : "/watch";
  return (
    <main className="wrap page">
      <h1>Sign in</h1>
      <p className="lede">We email you a one-time sign-in link. No password to remember.</p>
      {searchParams.error && <p className="notice">That sign-in link didn't work or has expired. Request a new one below.</p>}
      <LoginForm next={next} />
    </main>
  );
}
