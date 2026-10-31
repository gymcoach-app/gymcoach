'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/', label: 'home' },
  { href: '/history', label: 'history' },
  { href: '/progress', label: 'progress' },
  { href: '/coach', label: 'coach' },
  { href: '/chat', label: 'chat' },
  { href: '/programs', label: 'programs' },
  { href: '/exercises', label: 'catalog' },
  { href: '/settings', label: 'settings' },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations('navigation');
  return (
    <nav className="flex gap-1 overflow-x-auto border-t border-border px-2 py-1">
      {LINKS.map((link) => {
        const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'rounded-md px-3 py-2 text-sm font-medium transition-colors',
              locale === 'zh-CN' && 'shrink-0 whitespace-nowrap',
              active
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(link.label)}
          </Link>
        );
      })}
    </nav>
  );
}
