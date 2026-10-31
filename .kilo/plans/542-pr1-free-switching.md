# Implementation Plan: PR1 - Free Switching with Independent Rest Timers

**Issue:** #542 (Part 1 of 2)
**Branch:** `feat/issue-542-free-switching`
**Description:** Enable free switching between exercises during rest periods with independent, continuously-running timers per exercise.

## Overview

Transform the session runner from a single global mode (input/rest/summary) to per-exercise state tracking. Users can switch between any exercises at any time, all rest timers continue running in the background, and visual indicators show each exercise's state.

## Current Architecture Analysis

### Current State Management (lines 138-149, 224)
```typescript
type Mode =
  | { kind: 'input' }
  | {
      kind: 'rest';
      endsAt: number;
      pausedRemainingMs: number | null;
      totalSec: number;
      nextExerciseIdx: number | null;
      navigatedImmediately: boolean;
    }
  | { kind: 'summary' };

const [mode, setMode] = useState<Mode>({ kind: 'input' });
```

**Problem:** Switching exercises (lines 687-692, 727, 741) calls `setMode({ kind: 'input' })`, discarding rest state.

### Current Constraints
- Line 837: Strip disabled during rest: `disabled={mode.kind !== 'input'}`
- Line 864: Menu disabled during rest: `menuDisabled={mode.kind !== 'input'}`
- Lines 974, 995: Prev/Next buttons disabled during rest
- Lines 838-841: Switching calls `selectExercise()` AND `setMode({ kind: 'input' })` - timer lost

## Target Architecture

### New State Structure
```typescript
type ExerciseState =
  | { kind: 'input' }
  | {
      kind: 'rest';
      endsAt: number;
      pausedRemainingMs: number | null;
      totalSec: number;
      // Auto-advance is per-exercise: where this exercise's timer
      // should navigate when it expires (if user is still viewing it)
      nextExerciseIdx: number | null;
      navigatedImmediately: boolean;
    };

// Map keyed by ProgramExercise.id (NOT exerciseId - multiple rows
// can have the same exercise but need independent state)
const [exerciseStates, setExerciseStates] =
  useState<Map<string, ExerciseState>>(new Map());

// Summary is still global
const [globalMode, setGlobalMode] = useState<'active' | 'summary'>('active');

// Derive current exercise's state
const currentState = exerciseStates.get(currentPE.id) ?? { kind: 'input' };
```

### Key Behavioral Changes

1. **Switching preserves all timers** - `selectExercise()` only changes `selectedIdx`, never touches state map
2. **All timers run continuously** - global interval checks every exercise every second
3. **Auto-advance only when viewing** - timer expiring on viewed exercise navigates; others silently become ready
4. **Visual state indicators** - strip shows which exercises are resting/ready/done

## Implementation Steps

### Step 1: Refactor State Management in session-runner.tsx

**File:** `components/session/session-runner.tsx`

#### 1.1 Update type definitions (after line 149)
```typescript
type ExerciseState =
  | { kind: 'input' }
  | {
      kind: 'rest';
      endsAt: number;
      pausedRemainingMs: number | null;
      totalSec: number;
      nextExerciseIdx: number | null;
      navigatedImmediately: boolean;
    };

type GlobalMode = 'active' | 'summary';
```

#### 1.2 Replace mode state (line 224)
```typescript
// Replace:
const [mode, setMode] = useState<Mode>({ kind: 'input' });

// With:
const [exerciseStates, setExerciseStates] = useState<Map<string, ExerciseState>>(
  new Map()
);
const [globalMode, setGlobalMode] = useState<GlobalMode>('active');
```

#### 1.3 Add derived current state (after line 260)
```typescript
const currentState: ExerciseState =
  exerciseStates.get(currentPE.id) ?? { kind: 'input' };
```

#### 1.4 Update handleValidate to set per-exercise state (lines 510-581)
```typescript
// After queueSet (around line 543), replace setMode call with:
setExerciseStates(prev => {
  const next = new Map(prev);
  next.set(currentPE.id, {
    kind: 'rest',
    endsAt: Date.now() + restSec * 1000,
    pausedRemainingMs: null,
    totalSec: restSec,
    nextExerciseIdx: nextIdx,
    navigatedImmediately,
  });
  return next;
});
```

#### 1.5 Implement global background timer (after hydration effect, ~line 345)
```typescript
// Global timer that checks ALL exercises, not just current
useEffect(() => {
  if (globalMode !== 'active') return;

  const interval = setInterval(() => {
    const now = Date.now();

    setExerciseStates(prev => {
      const next = new Map(prev);
      let changed = false;

      // Check every exercise's timer
      for (const pe of programExercises) {
        const state = prev.get(pe.id);
        if (!state || state.kind !== 'rest') continue;

        // Skip paused timers
        if (state.pausedRemainingMs != null) continue;

        // Timer expired?
        if (now >= state.endsAt) {
          // Auto-navigate only if this is the currently viewed exercise
          const isViewing = pe.id === currentPE.id;
          if (isViewing) {
            vibrate(VIBRATION_PATTERNS.restEnd);
            if (isRestEndFlashEnabled()) {
              setRestFlashCount(count => count + 1);
            }

            // Navigate if we haven't already
            if (!state.navigatedImmediately && state.nextExerciseIdx != null) {
              selectExercise(state.nextExerciseIdx);
            }
          }

          // Transition to input regardless of whether viewing
          next.set(pe.id, { kind: 'input' });
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, 1000);

  return () => clearInterval(interval);
}, [programExercises, currentPE?.id, globalMode]);
```

#### 1.6 Update selectExercise to NOT reset state (lines 687-692)
```typescript
function selectExercise(index: number) {
  const next = programExercises[index];
  if (!next) return;
  setSelectedIdx(index);
  window.history.replaceState(
    window.history.state,
    '',
    sessionExercisePath(session.id, next.id)
  );
  // NO setMode call - state is preserved!
}
```

#### 1.7 Update rest control handlers to use current exercise state

**handleRestEnd** (lines 694-701) - REMOVE, logic moved to global timer

**handleSkipRest** (lines 703-708):
```typescript
function handleSkipRest() {
  if (currentState.kind !== 'rest') return;

  // Navigate if we haven't already
  if (!currentState.navigatedImmediately && currentState.nextExerciseIdx != null) {
    selectExercise(currentState.nextExerciseIdx);
  }

  // Clear this exercise's rest state
  setExerciseStates(prev => {
    const next = new Map(prev);
    next.set(currentPE.id, { kind: 'input' });
    return next;
  });
}
```

**handlePauseRest** (lines 710-713):
```typescript
function handlePauseRest() {
  if (currentState.kind !== 'rest') return;
  setExerciseStates(prev => {
    const next = new Map(prev);
    next.set(currentPE.id, pauseRest(currentState, Date.now()));
    return next;
  });
}
```

**handleResumeRest** (lines 715-718):
```typescript
function handleResumeRest() {
  if (currentState.kind !== 'rest') return;
  setExerciseStates(prev => {
    const next = new Map(prev);
    next.set(currentPE.id, resumeRest(currentState, Date.now()));
    return next;
  });
}
```

**handleAdjustRest** (lines 720-723):
```typescript
function handleAdjustRest(deltaMs: number) {
  if (currentState.kind !== 'rest') return;
  setExerciseStates(prev => {
    const next = new Map(prev);
    next.set(currentPE.id, adjustRest(currentState, deltaMs, Date.now()));
    return next;
  });
}
```

#### 1.8 Update navigation buttons (lines 725-742)
```typescript
function goPrev() {
  selectExercise(Math.max(0, currentIdx - 1));
  // No setMode call
}

function goNext() {
  if (navNextIdx == null) return;
  selectExercise(navNextIdx);
  // No setMode call
}
```

#### 1.9 Update summary mode checks
```typescript
// Line 744: Replace `mode.kind === 'summary'` with `globalMode === 'summary'`
if (globalMode === 'summary') {
  return (
    <SessionSummary
      // ... props ...
      onBack={() => setGlobalMode('active')}
      // ... rest ...
    />
  );
}

// Line 984: Update Finish button
onClick={() => setGlobalMode('summary')}
```

#### 1.10 Update all render conditions using mode
- Line 772-792: Replace `mode.kind === 'rest'` checks with `currentState.kind === 'rest'`
- Line 837: Remove `disabled` prop from SessionExerciseStrip
- Line 838-841: Remove `setMode({ kind: 'input' })` from strip's onSelect
- Line 864: Remove `menuDisabled` prop from ExerciseCard
- Line 894: Replace `isInputActive={mode.kind === 'input'}` with `isInputActive={currentState.kind === 'input'}`
- Line 915: Replace `disabled={!hydrated || mode.kind !== 'input'}` with `disabled={!hydrated || currentState.kind !== 'input'}`
- Line 926: Replace `mode.kind === 'input'` with `currentState.kind === 'input'`
- Lines 944-956: Update RestTimer props to use currentState
- Lines 974, 995: Remove `mode.kind !== 'input'` from disabled conditions

### Step 2: Add Visual State Indicators to Strip

**File:** `components/session/session-exercise-strip.tsx`

#### 2.1 Update Props interface (lines 13-23)
```typescript
interface Props {
  exercises: SessionExercise[];
  currentIndex: number;
  completedProgramExerciseIds: ReadonlySet<string>;
  // NEW: per-exercise rest states
  exerciseStates: ReadonlyMap<string, {
    kind: 'input' | 'rest';
    endsAt?: number;
    pausedRemainingMs?: number | null;
  }>;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  // REMOVED: disabled prop
}
```

#### 2.2 Add state badge rendering (inside button loop, after line 128)
```typescript
{/* State indicator badges */}
{(() => {
  const state = exerciseStates.get(programExercise.id);
  if (!state) return null;

  if (state.kind === 'rest' && state.endsAt) {
    // Show timer countdown
    const remainingMs = state.pausedRemainingMs ??
      Math.max(0, state.endsAt - Date.now());
    const remainingSec = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(remainingSec / 60);
    const seconds = remainingSec % 60;
    const display = minutes > 0
      ? `${minutes}:${seconds.toString().padStart(2, '0')}`
      : `${seconds}`;

    return (
      <span
        className="absolute left-1 top-1 flex items-center gap-0.5 rounded-full bg-blue-500 px-1.5 py-0.5 text-xs font-medium text-white shadow-sm"
        aria-label={t('exerciseResting', { time: display })}
      >
        ⏱️ {display}
      </span>
    );
  }

  // Input state has no badge (ready for next set)
  return null;
})()}
```

#### 2.3 Add translation keys (need to add to i18n files)
```typescript
// en.json, session section:
"exerciseResting": "{time} remaining"
```

#### 2.4 Update click handler (lines 87-91) - remove disabled check
```typescript
onClick={() => {
  // No disabled check - always clickable
  if (isCurrent) onOpen(index);
  else onSelect(index);
}}
// Remove aria-disabled
```

#### 2.5 Remove disabled styling (line 96-98)
```typescript
className={`group relative shrink-0 transition-opacity ${
  isCurrent ? 'opacity-100' : 'opacity-45 hover:opacity-75'
}`}
// Remove disabled cursor
```

### Step 3: Update ExerciseCard to Remove menuDisabled

**File:** `components/session/exercise-card.tsx`

Find the `menuDisabled` prop (passed from session-runner line 864) and remove it entirely. The menu button should always be enabled.

### Step 4: Unit Tests

**File:** `components/session/session-runner.test.tsx` (create new)

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

describe('SessionRunner - Independent Exercise States', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves rest state when switching to another exercise', async () => {
    // Setup: 2 exercises, log set on first, verify rest starts
    // Switch to second exercise
    // Verify first exercise's timer continues (check internal state)
  });

  it('runs multiple rest timers simultaneously', async () => {
    // Setup: 3 exercises
    // Log set on exercise 1 -> 180s rest
    // Advance time 30s, switch to exercise 2
    // Log set on exercise 2 -> 120s rest
    // Advance time 30s, switch to exercise 3
    // Log set on exercise 3 -> 180s rest
    // Verify all three timers show correct remaining times
  });

  it('auto-advances only when viewing the exercise whose timer expires', async () => {
    // Setup: 2 exercises
    // Log set on exercise 1 -> 60s rest, auto-advance to ex 2
    // Switch to exercise 2 before timer ends
    // Advance time until ex 1 timer expires
    // Verify: still viewing exercise 2 (no auto-navigate)
    // Switch back to ex 1
    // Verify: ex 1 is in input mode (timer expired)
  });

  it('transitions expired exercise to input state in background', async () => {
    // Log set on ex 1 -> 60s rest
    // Switch to ex 2
    // Advance time 65s
    // Verify ex 1 state is 'input' (via internal check or behavior)
  });

  it('clears specific exercise state without affecting others', async () => {
    // Log sets on ex 1 and ex 2 -> both resting
    // Skip rest on ex 1
    // Verify ex 1 is input, ex 2 still resting
  });
});
```

### Step 5: Component Tests

**File:** `components/session/session-exercise-strip.test.tsx` (create new)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('SessionExerciseStrip - State Indicators', () => {
  it('shows timer badge for resting exercise', () => {
    // Render strip with one exercise in rest state
    // Verify timer badge is visible with correct time
  });

  it('shows no badge for input state exercise', () => {
    // Render strip with exercise in input state
    // Verify no badge shown
  });

  it('shows checkmark for completed exercise', () => {
    // Existing test - verify still works
  });

  it('is always clickable regardless of state', () => {
    // Render strip with resting exercise
    // Verify buttons are not disabled
    // Verify click handlers fire
  });

  it('updates timer badge as time decreases', () => {
    // Render with resting exercise
    // Re-render with updated time
    // Verify badge updates
  });
});
```

### Step 6: E2E Test

**File:** `tests/e2e/multi-exercise-rest.spec.ts` (create new)

```typescript
import { test, expect } from '@playwright/test';
import { signUp } from './helpers/sign-up';
import { deleteAccount } from './helpers/delete-account';

test.describe('Multi-Exercise Independent Rest', () => {
  test('switches between exercises preserving rest timers', async ({ page }) => {
    const { email } = await signUp(page);

    try {
      // Navigate to dashboard, create program with 3 exercises
      // ... setup code ...

      // Start session
      await page.click('[data-testid="start-session"]');

      // Log set on exercise 1
      await page.fill('[data-testid="weight-input"]', '100');
      await page.fill('[data-testid="reps-input"]', '10');
      await page.click('[data-testid="log-set"]');

      // Verify rest timer appears
      await expect(page.locator('[data-testid="rest-remaining"]')).toBeVisible();
      const initialTime = await page
        .locator('[data-testid="rest-remaining"]')
        .textContent();
      expect(parseInt(initialTime!)).toBeGreaterThan(0);

      // Wait 5 seconds
      await page.waitForTimeout(5000);

      // Click exercise 2 on strip
      await page.click('[data-testid="exercise-strip-item-1"]');

      // Verify we switched to exercise 2 (input screen visible)
      await expect(page.locator('[data-testid="weight-input"]')).toBeVisible();

      // Verify exercise 1 has timer badge on strip
      await expect(
        page.locator('[data-testid="exercise-strip-item-0"]')
          .locator('text=/⏱️/')
      ).toBeVisible();

      // Log set on exercise 2
      await page.fill('[data-testid="weight-input"]', '50');
      await page.fill('[data-testid="reps-input"]', '12');
      await page.click('[data-testid="log-set"]');

      // Verify rest timer appears for exercise 2
      await expect(page.locator('[data-testid="rest-remaining"]')).toBeVisible();

      // Wait 3 seconds
      await page.waitForTimeout(3000);

      // Switch back to exercise 1
      await page.click('[data-testid="exercise-strip-item-0"]');

      // Verify timer shows reduced time (5s + 3s = 8s elapsed minimum)
      const laterTime = await page
        .locator('[data-testid="rest-remaining"]')
        .textContent();
      expect(parseInt(laterTime!))
        .toBeLessThan(parseInt(initialTime!) - 7);

      // Verify exercise 2 still has timer badge
      await expect(
        page.locator('[data-testid="exercise-strip-item-1"]')
          .locator('text=/⏱️/')
      ).toBeVisible();

    } finally {
      await deleteAccount(page, email);
    }
  });

  test('does not auto-navigate when timer expires on non-viewed exercise', async ({ page }) => {
    const { email } = await signUp(page);

    try {
      // Setup with 2 exercises, rest time = 10s
      // Log set on ex 1 -> 10s rest
      // Switch to ex 2 immediately
      // Wait 12 seconds
      // Verify still viewing ex 2 (no auto-navigate)
      // Switch back to ex 1
      // Verify ex 1 is in input mode (set input visible, no timer)

    } finally {
      await deleteAccount(page, email);
    }
  });
});
```

### Step 7: Ensure Superset Compatibility

**Verification Steps:**
1. Review superset logic in `lib/supersets.ts` - auto-advance and transition rest
2. Test that superset A1/A2 flow still works:
   - Short transition rest when auto-advancing within group
   - Full rest after last member
   - Can still manually switch away during superset rest
3. Add unit test case for superset with multi-exercise state

**File:** `lib/supersets.test.ts` (add test case)
```typescript
it('works with per-exercise state map', () => {
  // Verify superset auto-advance logic is independent of state storage
  // The nextAutoAdvanceIndex function should work the same way
});
```

### Step 8: Changelog Fragment

**File:** `changelog.d/542-free-switching.md` (create)
```markdown
---
section: Added
---
During a session you can now switch between any exercises at any time - the exercise strip and exercise menu stay usable even while resting. Every exercise tracks its own rest timer independently; all timers continue running in the background when you switch away, and return showing the correct remaining time when you switch back. Visual indicators on the strip show which exercises are resting (⏱️ with countdown), ready for the next set, or completed (✓). Auto-advance still works but only when you're viewing the exercise whose rest timer expires - switching away lets you work at your own pace without the app interrupting you (#542).
```

## Acceptance Criteria

- [ ] Exercise strip always clickable, not disabled during rest
- [ ] Exercise menu always accessible (add/delete/replace moves to PR2)
- [ ] Switching exercises preserves all rest states
- [ ] Multiple exercises can be resting simultaneously
- [ ] All timers continue running in background
- [ ] Switching back shows correct remaining time
- [ ] Visual timer badge on strip for resting exercises
- [ ] Checkmark still shows for completed exercises
- [ ] Auto-advance only when viewing the exercise whose timer expires
- [ ] Pause/resume/adjust work on current exercise
- [ ] Skip rest clears current exercise's rest state
- [ ] Prev/Next navigation works during rest
- [ ] Superset A1/A2 flow still functions correctly
- [ ] Superset transition rest (20s) still applies
- [ ] Unit tests pass for state transitions
- [ ] Component tests pass for strip indicators
- [ ] E2E test passes for multi-exercise rest scenario
- [ ] `bash scripts/verify.sh --full` passes
- [ ] Changelog fragment added

## Testing Strategy

1. **Unit tests** - State transitions in isolation (pure functions)
2. **Component tests** - Strip renders correct indicators
3. **E2E test** - Full user flow with timing verification
4. **Manual superset testing** - Verify A1/A2 still works
5. **Cross-browser** - Timer accuracy on tab switch, screen lock

## Migration Notes

- No database schema changes
- No API changes
- State structure change is internal to session-runner component
- Existing sessions continue working (state doesn't persist across page loads)

## Known Limitations (Acceptable for PR1)

- Rest timers don't survive page reload (same as current behavior)
- Exercise menu operations (add/delete/replace) still require PR2
- Visual polish (blue dot for current, better timer formatting) can be follow-up

## Files to Modify

1. `components/session/session-runner.tsx` - State management refactor (main work)
2. `components/session/session-exercise-strip.tsx` - Add state indicators
3. `components/session/exercise-card.tsx` - Remove menuDisabled prop
4. `components/session/session-runner.test.tsx` - Unit tests (new file)
5. `components/session/session-exercise-strip.test.tsx` - Component tests (new file)
6. `tests/e2e/multi-exercise-rest.spec.ts` - E2E test (new file)
7. `lib/supersets.test.ts` - Add test case
8. `changelog.d/542-free-switching.md` - Changelog fragment (new file)
9. `messages/en.json` (and other locales) - Add exerciseResting translation

## Estimated Complexity

**Medium-High** - Significant refactoring but clean architecture. The timestamp-based timer foundation (`lib/rest-timer.ts`) already survives tab switches, so we're building on solid ground.

## Dependencies

- None (standalone feature)
- PR2 will build on this

## Review Focus Areas

1. Timer accuracy across tab switches and screen locks
2. State consistency when switching rapidly between exercises
3. Superset flow preservation (A1/A2 with transition rest)
4. Memory usage with large exercise state maps (not expected to be an issue)
5. Accessibility of always-enabled strip navigation
