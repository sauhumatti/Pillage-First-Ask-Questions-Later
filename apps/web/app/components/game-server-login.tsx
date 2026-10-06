import { type FormEvent, useEffect, useState } from 'react';
import { Button } from 'app/components/ui/button';
import { Input } from 'app/components/ui/input';
import {
  gameServerFetch,
  isGameServerMode,
  LOGIN_REQUIRED_EVENT,
} from 'app/utils/game-server';

// Asks for the game server's password when the session is missing or expired.
// Renders nothing in the browser-only version of the game.
export const GameServerLogin = () => {
  const [isLoginRequired, setIsLoginRequired] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isGameServerMode) {
      return;
    }

    const requireLogin = () => setIsLoginRequired(true);
    window.addEventListener(LOGIN_REQUIRED_EVENT, requireLogin);

    fetch('/api/session', { credentials: 'same-origin' })
      .then((response) => {
        if (response.status === 401) {
          requireLogin();
        }
      })
      .catch(() => {});

    return () => {
      window.removeEventListener(LOGIN_REQUIRED_EVENT, requireLogin);
    };
  }, []);

  if (!isLoginRequired) {
    return null;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await gameServerFetch('login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      // Reload so everything is fetched again with the new session
      window.location.reload();
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : 'Login failed',
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-background/95 px-4">
      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-md border border-border bg-card p-6 shadow-lg"
      >
        <img
          src="/pillage-first-logo-horizontal.svg"
          alt="Pillage First! logo"
          className="mx-auto h-auto w-48"
        />
        <label
          htmlFor="game-server-password"
          className="text-sm font-semibold"
        >
          Game server password
        </label>
        <Input
          id="game-server-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && (
          <p
            role="alert"
            className="text-sm text-red-600"
          >
            {error}
          </p>
        )}
        <Button
          type="submit"
          disabled={isSubmitting || password.length === 0}
        >
          Log in
        </Button>
      </form>
    </div>
  );
};
