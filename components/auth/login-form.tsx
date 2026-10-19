'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { purgeUserCaches } from '@/lib/pwa-cache';

type FormValues = { email: string; password: string };

// Public demo flag and credentials, inlined at build time. When the flag is on
// (e.g. on a public demo instance) the login page surfaces a one-click sign in.
const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
const demoEmail = process.env.NEXT_PUBLIC_DEMO_EMAIL ?? '';
const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? '';
const showDemo = demoMode && demoEmail !== '' && demoPassword !== '';

export function LoginForm() {
  const t = useTranslations('auth');
  const common = useTranslations('common');
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const schema = useMemo(
    () =>
      z.object({
        email: z.string().email(t('validation.invalidEmail')),
        password: z.string().min(1, t('validation.passwordRequired')),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  async function loginAsDemo() {
    // Prefill the fields for visible feedback, then submit the demo credentials.
    setValue('email', demoEmail);
    setValue('password', demoPassword);
    await onSubmit({ email: demoEmail, password: demoPassword });
  }

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    if (res.ok) {
      // A session that expired without a logout leaves the previous user's
      // responses in the service-worker caches (#357).
      await purgeUserCaches();
      router.replace('/');
      router.refresh();
      return;
    }

    setServerError(t('login.error'));
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t('login.title')}</CardTitle>
        <CardDescription>{t('login.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {showDemo && (
          <div className="mb-4 space-y-2 rounded-md border border-dashed bg-muted/50 p-3">
            <p className="text-sm font-medium">{t('login.demoTitle')}</p>
            <p className="text-sm text-muted-foreground">
              {demoEmail} / {demoPassword}
            </p>
            <Button
              type="button"
              variant="secondary"
              className="min-h-tap w-full"
              onClick={loginAsDemo}
              disabled={isSubmitting}
            >
              {isSubmitting ? t('login.submitting') : t('login.demoSubmit')}
            </Button>
          </div>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">{common('fields.email')}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={errors.email ? 'true' : 'false'}
              {...register('email')}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{common('fields.password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? 'true' : 'false'}
              {...register('password')}
            />
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>

          {serverError && (
            <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
              {serverError}
            </p>
          )}

          <Button
            type="submit"
            className="min-h-tap w-full text-base"
            disabled={isSubmitting}
          >
            {isSubmitting ? t('login.submitting') : t('login.submit')}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {t('login.noAccount')}{' '}
            <Link
              href="/signup"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {t('login.createAccount')}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
