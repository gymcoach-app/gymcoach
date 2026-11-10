import { Settings as SettingsIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { SettingsClient } from '@/components/settings/settings-client';
import { ProfileSection } from '@/components/settings/profile-section';
import { ImportSection } from '@/components/settings/import-section';
import { GymProfilesSection } from '@/components/settings/gym-profiles-section';
import { McpSection } from '@/components/settings/mcp-section';

export default async function SettingsPage() {
  const t = await getTranslations('settings');
  const common = await getTranslations('common');
  const auth = await requireSession();
  const [user, gyms, exercises, mcpTokens] = await Promise.all([
    db.user.findUnique({
      where: { id: auth.userId },
      select: {
        displayName: true,
        bodyweight: true,
        sex: true,
        heightCm: true,
        goal: true,
        weeklyFrequency: true,
        unit: true,
        effortScale: true,
        activeGymId: true,
      },
    }),
    db.gym.findMany({
      where: { userId: auth.userId },
      orderBy: { name: 'asc' },
      include: { exerciseConfigs: true },
    }),
    db.exercise.findMany({
      where: { userId: auth.userId },
      orderBy: { name: 'asc' },
    }),
    db.mcpAccessToken.findMany({
      where: { userId: auth.userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        canWrite: true,
        createdAt: true,
        lastUsedAt: true,
      },
    }),
  ]);

  return (
    <main className="flex-1 px-4 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <SettingsIcon className="size-6" />
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <h2 className="text-base font-semibold">{t('account')}</h2>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{common('fields.email')}</span>
              <span className="font-medium">{auth.email}</span>
            </div>
          </CardContent>
        </Card>

        <ProfileSection
          initial={{
            displayName: user?.displayName ?? null,
            bodyweight: user?.bodyweight ?? null,
            sex: user?.sex ?? null,
            heightCm: user?.heightCm ?? null,
            goal: user?.goal ?? null,
            weeklyFrequency: user?.weeklyFrequency ?? null,
            unit: user?.unit ?? 'KG',
            effortScale: user?.effortScale ?? 'RIR',
          }}
        />

        <GymProfilesSection
          initialGyms={gyms}
          activeGymId={user?.activeGymId ?? null}
          exercises={exercises}
        />

        <ImportSection />

        <McpSection
          initialTokens={mcpTokens.map((token) => ({
            ...token,
            createdAt: token.createdAt.toISOString(),
            lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
          }))}
        />

        <SettingsClient />
      </div>
    </main>
  );
}
