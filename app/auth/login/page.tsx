'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from '@/lib/auth';

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signIn(phone, password);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="text-center font-condensed text-[28px] uppercase tracking-[0.04em]">
            Noon Enterprises
          </h2>
          <p className="mt-2 text-center text-[13px] text-ink-2">
            Sign in to your account
          </p>
        </div>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className="border border-rule border-l-2 border-l-danger bg-danger-tint p-3">
              <p className="text-[13px] font-medium text-danger">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label htmlFor="phone" className="sr-only">
                Phone number
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                required
                className="block w-full h-11 px-3 border border-rule rounded-xs placeholder-ink-3 text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 text-[15px]"
                placeholder="Phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="block w-full h-11 px-3 border border-rule rounded-xs placeholder-ink-3 text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 text-[15px]"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center h-11 items-center text-[15px] font-semibold text-white bg-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>

        <p className="mt-2 text-center text-[13px] text-ink-2">
          Contact the admin to create an account.
        </p>
        <p className="text-center text-[12px] text-ink-3">
          Forgot your password? There is no self-service reset — ask the app&apos;s developer to reset it for you.
        </p>
      </div>
    </div>
  );
}
