export const dashboard = {
  activeSession: 'Active session',
  sessionFallback: 'Session',
  startedOn: '{name} started on {date}',
  resumeSession: 'Resume session',
  noActiveProgram: 'No active program',
  noActiveProgramDescription: 'Activate a program to start a session.',
  viewPrograms: 'View programs',
  emptyProgram: 'Empty program',
  emptyProgramDescription: '{name} has no session configured.',
  configureProgram: 'Configure program',
  startSession: 'Start a session',
  startEmpty: 'Start empty session',
  activeProgram: 'Active program: {name}',
  chooseSession: 'Choose a session',
  programSessions: 'Program sessions',
  insight: {
    deloadTitle: 'Recovery may be due',
    stalledTitle: '{count, plural, one {A lift has stalled} other {# lifts have stalled}}',
    stalledDetail:
      '{count, plural, one {{names} has not progressed recently. A small change in load, reps, or technique can get it moving again.} other {{names} have not progressed recently. Check the progress page for what to adjust.}}',
    prTitle: 'New personal record',
    prWeightDetail: 'Your last session set a new heaviest set on {name}. Nice work.',
    prOneRmDetail: 'Your last session set a new best estimated 1RM on {name}. Nice work.',
    consistentTitle: 'You are training consistently',
    consistentDetail:
      'Trained {count, plural, one {# day} other {# days}} this week. Keep the momentum going.',
    deloadStalledReason:
      '{count, plural, one {# lift has stalled: {names}.} other {# lifts have stalled: {names}.}}',
    deloadReadinessReason:
      'Your readiness has averaged {average}/5 over your last {checkins, plural, one {# check-in} other {# check-ins}}.',
  },
};
