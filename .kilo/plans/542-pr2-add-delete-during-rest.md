# Implementation Plan: PR2 - Add/Delete/Replace During Rest

**Issue:** #542 (Part 2 of 2)
**Branch:** `feat/issue-542-exercise-operations-during-rest`
**Base:** `feat/issue-542-free-switching` (PR1 must be merged first)
**Description:** Enable adding, deleting, and replacing exercises during rest periods without losing rest timer state.

## Overview

Build on PR1's per-exercise state tracking to allow full exercise management operations (add, delete, replace) while rest timers are running. This completes the "free gym flow" user story where equipment availability and improvisation drive workout adjustments on the fly.

## Current Constraints (After PR1)

After PR1 merges:
- ✅ Strip and navigation are always usable
- ✅ Switching preserves rest states
- ✅ Multiple timers run simultaneously
- ❌ Exercise menu still disabled during rest (line 864: `menuDisabled` removed but functionality may still be gated)
- ❌ Exercise operations might not handle state map cleanup properly

## Goals for PR2

1. **Exercise menu always functional** - add/delete/replace work regardless of current exercise state
2. **State cleanup on delete** - removing an exercise clears its rest state
3. **State initialization on add** - new exercises start in input mode
4. **Preserve other timers** - deleting exercise A doesn't affect exercise B's rest
5. **Handle edge cases** - deleting currently-resting exercise, deleting next-in-auto-advance, etc.

## Implementation Steps

### Step 1: Audit Exercise Menu Operations

**File:** `components/session/session-exercise-menu.tsx`

Review the three operations:
1. **Add Exercise** - Calls server to add to workout, refreshes
2. **Delete Exercise** - Calls server to remove, refreshes
3. **Replace Exercise** - Calls server to swap, refreshes

**Key Question:** Do these operations trigger a full page reload or just a router.refresh()?

Check session-runner.tsx lines 866-882:
```typescript
<SessionExerciseMenu
  open={exerciseMenuOpen}
  onOpenChange={setExerciseMenuOpen}
  programExercise={currentPE}
  programExercises={programExercises}
  catalog={catalog}
  loggedSetCount={currentSets.length}
  onChanged={(options) => {
    setExerciseMenuOpen(false);
    if (options?.selectProgramExerciseId) {
      setPendingExerciseSelection({
        selectProgramExerciseId: options.selectProgramExerciseId,
        removedProgramExerciseId: options.removedProgramExerciseId,
      });
    }
    router.refresh(); // <-- Server-side refresh
  }}
/>
```

**Finding:** `router.refresh()` triggers a server re-render. The exerciseStates Map will be reset to empty because it's not persisted. This is the core problem.

### Step 2: Add State Persistence Between Refreshes

The exerciseStates Map needs to survive router.refresh() calls. Two approaches:

#### Option A: Session Storage (Simpler, Recommended)
Store the state map in sessionStorage, restore on mount, clear on session finish.

#### Option B: URL State (More Complex)
Encode state in URL query params, but this gets unwieldy with multiple timers.

**Recommended: Option A**

### Step 3: Implement State Persistence

**File:** `components/session/session-runner.tsx`

#### 3.1 Add persistence helpers (top of file, after imports)
```typescript
// Persist per-exercise rest states across router.refresh() so exercise menu
// operations (add/delete/replace) don't lose running timers (issue #542, PR2).
const EXERCISE_STATES_KEY = (sessionId: string) =>
  `gymcoach:session:${sessionId}:exercise-states`;

function saveExerciseStates(
  sessionId: string,
  states: Map<string, ExerciseState>
): void {
  if (typeof window === 'undefined') return;
  try {
    const serialized = Array.from(states.entries()).map(([id, state]) => ({
      id,
      state,
    }));
    sessionStorage.setItem(
      EXERCISE_STATES_KEY(sessionId),
      JSON.stringify(serialized)
    );
  } catch {
    // Quota exceeded or other error - fail silently
  }
}

function loadExerciseStates(sessionId: string): Map<string, ExerciseState> {
  if (typeof window === 'undefined') return new Map();
  try {
    const stored = sessionStorage.getItem(EXERCISE_STATES_KEY(sessionId));
    if (!stored) return new Map();
    const parsed = JSON.parse(stored) as Array<{
      id: string;
      state: ExerciseState;
    }>;
    return new Map(parsed.map(({ id, state }) => [id, state]));
  } catch {
    return new Map();
  }
}

function clearExerciseStates(sessionId: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(EXERCISE_STATES_KEY(sessionId));
  } catch {
    // Fail silently
  }
}
```

#### 3.2 Initialize state from storage (update state declaration)
```typescript
const [exerciseStates, setExerciseStates] = useState<Map<string, ExerciseState>>(
  () => loadExerciseStates(session.id)
);
```

#### 3.3 Save state on every update
```typescript
// Wrap setExerciseStates calls or use useEffect
useEffect(() => {
  saveExerciseStates(session.id, exerciseStates);
}, [exerciseStates, session.id]);
```

#### 3.4 Clear state when session finishes (in handleFinishSession)
```typescript
async function handleFinishSession() {
  setClosing(true);
  try {
    // ... existing flush and API call ...
    clearExerciseStates(session.id); // Add this
    toast.success(t('finished'));
    router.replace('/');
    router.refresh();
  } finally {
    setClosing(false);
  }
}
```

#### 3.5 Clean up stale states after refresh
When exercises are added/deleted, the state map may contain keys for removed exercises or be missing keys for new ones. Add cleanup logic:

```typescript
// After programExercises is derived (around line 207)
useEffect(() => {
  // Remove states for exercises no longer in the workout
  const validIds = new Set(programExercises.map(pe => pe.id));
  setExerciseStates(prev => {
    const next = new Map(prev);
    let changed = false;

    for (const id of next.keys()) {
      if (!validIds.has(id)) {
        next.delete(id);
        changed = true;
      }
    }

    return changed ? next : prev;
  });
}, [programExercises]);
```

### Step 4: Handle Edge Cases

#### 4.1 Deleting the Currently Viewed Exercise

If the user deletes the exercise they're currently viewing:
- The menu's `onChanged` callback already handles selection via `setPendingExerciseSelection`
- The pending selection logic (lines 269-291) will switch to the target exercise
- The deleted exercise's state will be cleaned up by the useEffect above

**No additional code needed** - existing logic handles this.

#### 4.2 Deleting an Exercise with Auto-Advance Target

Scenario: Exercise A is resting, with nextExerciseIdx pointing to Exercise B. User deletes Exercise B.

**Solution:** The auto-advance logic uses indices. When programExercises changes (after refresh), the nextExerciseIdx in the stored state may be stale. The global timer (PR1 Step 1.5) should validate indices:

```typescript
// In global timer effect, before auto-navigating:
if (!state.navigatedImmediately && state.nextExerciseIdx != null) {
  // Validate index is still in range
  if (state.nextExerciseIdx < programExercises.length) {
    selectExercise(state.nextExerciseIdx);
  } else {
    // Target exercise was deleted, just stay put
    console.warn('Auto-advance target out of range, staying on current');
  }
}
```

#### 4.3 Adding an Exercise

New exercises have no state, which defaults to `{ kind: 'input' }` via the nullish coalescing in currentState derivation. This is correct behavior.

**No additional code needed.**

#### 4.4 Replacing an Exercise

Replace is: delete old, add new, select new. The old exercise's state is cleaned up (deleted key), the new one starts in input mode. Correct behavior.

**No additional code needed.**

### Step 5: Remove Any Remaining menuDisabled Logic

**File:** `components/session/exercise-card.tsx`

Search for any remnants of `menuDisabled` prop:
- Remove from props interface
- Remove from button disabled conditions
- Ensure the menu button is always enabled

**File:** `components/session/session-runner.tsx`

Line 864: Confirm menuDisabled prop is not passed (should be removed in PR1, but verify).

### Step 6: Unit Tests

**File:** `components/session/session-runner.test.tsx` (add to existing from PR1)

```typescript
describe('SessionRunner - Exercise Operations During Rest', () => {
  it('preserves other exercise timers when deleting an exercise', async () => {
    // Setup: 3 exercises
    // Log set on ex 1 -> rest
    // Log set on ex 3 -> rest
    // Delete ex 2 via menu
    // Verify ex 1 and ex 3 still have rest states
  });

  it('cleans up state when deleting a resting exercise', async () => {
    // Setup: 2 exercises
    // Log set on ex 1 -> rest
    // Delete ex 1
    // Verify state map no longer has key for ex 1
  });

  it('initializes new exercise in input state', async () => {
    // Add exercise via menu
    // Verify new exercise is in input state (no rest)
  });

  it('handles replacing a resting exercise', async () => {
    // Log set on ex 1 -> rest
    // Replace ex 1 with different exercise
    // Verify old state is gone, new exercise is input
  });

  it('survives router refresh with states intact', async () => {
    // Mock sessionStorage
    // Set up resting exercises
    // Trigger router.refresh()
    // Verify states restored from sessionStorage
  });

  it('clears session storage on finish', async () => {
    // Setup session with rest states
    // Finish session
    // Verify sessionStorage cleared
  });
});
```

### Step 7: Integration Test

**File:** `tests/integration/session-exercise-menu.test.ts` (add to existing or create)

```typescript
import { describe, it, expect } from 'vitest';

describe('Exercise Menu During Rest', () => {
  it('allows adding exercise while resting', async () => {
    // Create session with 2 exercises
    // Log set on ex 1 (trigger rest)
    // Call add-exercise API
    // Verify success (200)
  });

  it('allows deleting exercise while resting', async () => {
    // Create session with 2 exercises
    // Log set on ex 1 (trigger rest)
    // Call delete-exercise API for ex 2
    // Verify success (200)
  });

  it('allows replacing exercise while resting', async () => {
    // Create session
    // Log set (trigger rest)
    // Call replace-exercise API
    // Verify success (200)
  });
});
```

### Step 8: E2E Test

**File:** `tests/e2e/exercise-operations-during-rest.spec.ts` (create new)

```typescript
import { test, expect } from '@playwright/test';
import { signUp } from './helpers/sign-up';
import { deleteAccount } from './helpers/delete-account';

test.describe('Exercise Operations During Rest', () => {
  test('adds exercise during rest without losing timer', async ({ page }) => {
    const { email } = await signUp(page);

    try {
      // Setup: session with 2 exercises
      // Log set on ex 1 -> rest timer starts
      // Open exercise menu
      await page.click('[data-testid="exercise-menu-button"]');

      // Add new exercise
      await page.click('[data-testid="add-exercise"]');
      await page.click('[data-testid="exercise-catalog-item-0"]');
      await page.click('[data-testid="confirm-add"]');

      // Wait for refresh
      await page.waitForLoadState('networkidle');

      // Verify ex 1 timer still shows (state preserved)
      await expect(
        page.locator('[data-testid="exercise-strip-item-0"]')
          .locator('text=/⏱️/')
      ).toBeVisible();

      // Verify new exercise is visible
      await expect(
        page.locator('[data-testid="exercise-strip-item-2"]')
      ).toBeVisible();

    } finally {
      await deleteAccount(page, email);
    }
  });

  test('deletes non-resting exercise while another is resting', async ({ page }) => {
    const { email } = await signUp(page);

    try {
      // Setup: 3 exercises
      // Log set on ex 1 -> rest
      // Open exercise menu while on ex 2
      // Delete ex 2
      // Verify ex 1 timer still shows
      // Verify ex 2 is gone (only 2 exercises remain)

    } finally {
      await deleteAccount(page, email);
    }
  });

  test('deletes currently resting exercise and switches away', async ({ page }) => {
    const { email } = await signUp(page);

    try {
      // Setup: 2 exercises
      // Log set on ex 1 -> rest
      // Open menu, delete ex 1
      // Verify switched to ex 2 (or to first remaining)
      // Verify ex 1 is gone

    } finally {
      await deleteAccount(page, email);
    }
  });

  test('replaces exercise during rest without losing other timers', async ({ page }) => {
    const { email } = await signUp(page);

    try {
      // Setup: 3 exercises
      // Log set on ex 1 -> rest
      // Log set on ex 3 -> rest
      // Replace ex 2 with different exercise
      // Verify ex 1 and ex 3 timers still show
      // Verify ex 2 is replaced

    } finally {
      await deleteAccount(page, email);
    }
  });
});
```

### Step 9: Changelog Fragment

**File:** `changelog.d/542-exercise-ops-during-rest.md` (create)
```markdown
---
section: Added
---
You can now add, delete, or replace exercises during rest periods via the exercise menu. All running rest timers on other exercises are preserved across these operations, so you can freely reorganize your workout on the fly without losing your place (#542).
```

## Acceptance Criteria

- [ ] Exercise menu operations (add/delete/replace) work during rest
- [ ] Rest states persist across router.refresh() via sessionStorage
- [ ] Deleting an exercise removes its state from the map
- [ ] Adding an exercise initializes it in input state
- [ ] Replacing an exercise cleans up old state, new starts in input
- [ ] Other exercises' rest timers unaffected by operations
- [ ] Stale states (removed exercises) cleaned up after refresh
- [ ] Invalid auto-advance indices handled gracefully
- [ ] Session storage cleared on session finish
- [ ] Unit tests pass for all operations
- [ ] Integration tests pass for API calls during rest
- [ ] E2E tests pass for operations preserving timers
- [ ] `bash scripts/verify.sh --full` passes
- [ ] Changelog fragment added

## Testing Strategy

1. **Unit tests** - State persistence, cleanup, edge cases
2. **Integration tests** - API calls succeed during rest
3. **E2E tests** - Full user flows with timer preservation
4. **Manual testing** - Exercise menu during rest, various operations
5. **Session storage testing** - Verify quota handling, clear on finish

## Edge Cases Covered

1. ✅ Deleting currently viewed exercise → handled by pending selection
2. ✅ Deleting exercise that's an auto-advance target → index validation
3. ✅ Adding exercise → defaults to input state
4. ✅ Replacing exercise → old state cleaned, new initialized
5. ✅ Multiple operations in succession → all states preserved
6. ✅ Session storage quota exceeded → fail silently, continue
7. ✅ Session finish → storage cleared

## Migration Notes

- No database schema changes
- No API changes
- Existing sessions continue working
- Session storage is per-tab (opening same session in two tabs = independent state)

## Known Limitations (Acceptable for PR2)

- Session storage cleared on tab close (rest timers don't survive closing the tab)
- Multiple tabs with same session have independent timers (not synced)
- Refresh still causes brief UI flicker (state loads after mount)

## Files to Modify

1. `components/session/session-runner.tsx` - State persistence logic (main work)
2. `components/session/exercise-card.tsx` - Remove any menuDisabled remnants
3. `components/session/session-runner.test.tsx` - Add unit tests
4. `tests/integration/session-exercise-menu.test.ts` - Integration tests
5. `tests/e2e/exercise-operations-during-rest.spec.ts` - E2E tests (new file)
6. `changelog.d/542-exercise-ops-during-rest.md` - Changelog fragment (new file)

## Estimated Complexity

**Medium** - Building on PR1's foundation. The core challenge is state persistence across refreshes, which sessionStorage solves cleanly.

## Dependencies

- **Requires PR1 merged** - Builds on per-exercise state map

## Review Focus Areas

1. Session storage usage - quota handling, security (no sensitive data)
2. State cleanup logic - no memory leaks from orphaned states
3. Edge case handling - invalid indices, missing states
4. User experience - operations feel instant despite refresh
5. Accessibility - menu always usable is a feature, not a bug

## Future Enhancements (Out of Scope)

- Persist rest timers across page reload (would need server-side storage)
- Sync timers across multiple tabs (would need broadcast channel or polling)
- Optimize refresh to avoid flicker (would need Next.js server actions or similar)
- Show "X seconds ago" for expired timers that you return to (UX polish)

## Performance Considerations

- Session storage read/write on every state change - fast, synchronous
- Typical workout has <10 exercises, state map is <1KB serialized
- Cleanup loop runs O(n) on programExercises change - negligible
- No performance concerns expected

## Security Considerations

- Session storage is per-origin, per-tab - safe from XSS (if app has no XSS)
- No sensitive data in state (only timers and indices)
- Storage cleared on finish - no stale data left behind
- Quota exceeded handled gracefully - no app crash

## Rollback Plan

If PR2 causes issues:
1. Revert the PR (git revert)
2. PR1's functionality remains intact
3. Users lose add/delete/replace during rest, but free switching still works
4. No data corruption risk (state is ephemeral, not persisted to DB)
