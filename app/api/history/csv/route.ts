import { NextResponse } from 'next/server';
import type { Prisma } from '@/prisma/generated/client';
import { db } from '@/lib/db';
import { handleApiError, requireApiUserId } from '@/lib/api';
import { csvEscape, HISTORY_CSV_HEADERS } from '@/lib/csv';
import { effectiveWeight, estimate1RM, setVolume } from '@/lib/stats';

// GET /api/history/csv?programId=...&month=YYYY-MM
// Returns a CSV (UTF-8 + BOM for Excel) with one row per set (warmups
// included, flagged by is_warmup). Same filters as the /history page.
// The GymCoach CSV import (app/api/import/gymcoach/route.ts, issue #270) is
// the symmetric inverse of this export.
export async function GET(req: Request) {
  try {
    const userId = await requireApiUserId();
    const url = new URL(req.url);
    const programId = url.searchParams.get('programId');
    const month = url.searchParams.get('month');

    // The where stays typed as a real Prisma filter (issue #317) so its
    // shape is checked; the userId scope itself is pinned by the cross-user
    // case in tests/integration/route-ownership.test.ts.
    const where: Prisma.SessionWhereInput = {
      userId,
      finishedAt: { not: null },
    };
    if (programId) where.programId = programId;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [yStr, mStr] = month.split('-');
      const y = Number(yStr);
      const m = Number(mStr);
      where.startedAt = {
        gte: new Date(Date.UTC(y, m - 1, 1)),
        lt: new Date(Date.UTC(y, m, 1)),
      };
    }

    const [sessions, user] = await Promise.all([
      db.session.findMany({
        where,
        orderBy: { startedAt: 'asc' },
        include: {
          program: { select: { name: true } },
          workout: { select: { name: true } },
          sets: {
            orderBy: [{ exerciseId: 'asc' }, { setNumber: 'asc' }],
            include: {
              exercise: {
                select: { name: true, muscleGroup: true, usesBodyweight: true },
              },
            },
          },
        },
      }),
      db.user.findUnique({
        where: { id: userId },
        select: { bodyweight: true },
      }),
    ]);
    const bodyweight = user?.bodyweight ?? null;

    const lines: string[] = [HISTORY_CSV_HEADERS.join(',')];

    for (const s of sessions) {
      const durationMin =
        s.finishedAt && s.startedAt
          ? Math.round((s.finishedAt.getTime() - s.startedAt.getTime()) / 60000)
          : '';
      const dateOnly = s.startedAt.toISOString().slice(0, 10);
      for (const set of s.sets) {
        const eff = effectiveWeight(
          set.weight,
          set.exercise.usesBodyweight,
          bodyweight,
        );
        const effSet = { weight: eff, reps: set.reps, isWarmup: set.isWarmup };
        const row = [
          s.id,
          dateOnly,
          s.startedAt.toISOString(),
          s.finishedAt?.toISOString() ?? '',
          String(durationMin),
          s.program?.name ?? '',
          s.workout?.name ?? '',
          set.exercise.name,
          set.exercise.muscleGroup,
          set.exercise.usesBodyweight ? 'true' : 'false',
          String(set.setNumber),
          String(set.weight),
          String(eff),
          String(set.reps),
          set.rir != null ? String(set.rir) : '',
          set.isWarmup ? 'true' : 'false',
          set.isDropSet ? 'true' : 'false',
          String(setVolume(effSet)),
          set.isWarmup ? '' : estimate1RM(eff, set.reps).toFixed(2),
          set.notes ?? '',
          // Cardio columns (issue #144): raw storage units, empty on strength sets.
          set.durationSec != null ? String(set.durationSec) : '',
          set.distanceM != null ? String(set.distanceM) : '',
          // Heart-rate columns (issue #203): bpm, empty on strength sets and on
          // cardio logged without a heart-rate reading.
          set.avgHr != null ? String(set.avgHr) : '',
          set.maxHr != null ? String(set.maxHr) : '',
          // Block of a deliberately repeated exercise (issue #475): which of
          // the workout's rows of this lift the set was logged against. Empty
          // when the set stored none (the lift appears once), so a 5/3/1 BBB
          // day does not export two indistinguishable set 1 rows.
          set.block != null ? String(set.block) : '',
        ];
        lines.push(row.map(csvEscape).join(','));
      }
    }

    // UTF-8 BOM so Excel detects the encoding and displays accents correctly.
    const body = '﻿' + lines.join('\n');
    const filename = buildFilename(month, programId);
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

function buildFilename(month: string | null, programId: string | null): string {
  const parts = ['gymcoach-history'];
  if (month) parts.push(month);
  if (programId) parts.push(`prog-${programId.slice(0, 8)}`);
  if (parts.length === 1) parts.push(new Date().toISOString().slice(0, 10));
  return parts.join('-') + '.csv';
}
