import { db } from '@/lib/db';
import { ApiError } from '@/lib/api';

// Guard shared by the freestyle exercise routes (issue #388): the session
// must be the caller's, still open, and not run from a workout. A session
// with a workout takes its exercises from the program, so writing a second
// list for it would only create rows nothing reads.
export async function requireOpenFreestyleSession(sessionId: string, userId: string) {
  const session = await db.session.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, workoutId: true, finishedAt: true },
  });
  if (!session) throw new ApiError(404, 'Session not found.');
  if (session.finishedAt) throw new ApiError(400, 'Session already finished.');
  if (session.workoutId) {
    throw new ApiError(409, 'This session follows a workout. Edit the workout instead.');
  }
  return session;
}
