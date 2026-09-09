import { redirect } from 'next/navigation';

// The middleware sends a signed-out visitor to /auth/login before this ever
// runs; a signed-in one lands here and goes straight to /dashboard.
export default function Home() {
  redirect('/dashboard');
}
