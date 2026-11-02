import { dashboard as english } from '../en/dashboard';
import type { MessageShape } from '@/i18n/message-types';

export const dashboard = {
  activeSession: 'Aktywna sesja',
  sessionFallback: 'Sesja',
  startedOn: '{name}, rozpoczęto {date}',
  resumeSession: 'Wznów sesję',
  noActiveProgram: 'Brak aktywnego programu',
  noActiveProgramDescription: 'Aktywuj program, aby rozpocząć sesję.',
  viewPrograms: 'Zobacz programy',
  emptyProgram: 'Pusty program',
  emptyProgramDescription: '{name} nie ma jeszcze żadnej sesji.',
  configureProgram: 'Skonfiguruj program',
  startSession: 'Rozpocznij sesję',
  activeProgram: 'Aktywny program: {name}',
  chooseSession: 'Wybierz sesję',
  programSessions: 'Sesje programu',
  insight: {
    deloadTitle: 'Może czas na regenerację',
    stalledTitle:
      '{count, plural, one {Jedno ćwiczenie stoi w miejscu} few {# ćwiczenia stoją w miejscu} many {# ćwiczeń stoi w miejscu} other {# ćwiczenia stoi w miejscu}}',
    stalledDetail:
      '{count, plural, one {{names} ostatnio nie robi postępów. Mała zmiana ciężaru, powtórzeń albo techniki może to ruszyć.} few {{names} ostatnio nie robią postępów. Na stronie postępów sprawdzisz, co zmienić.} many {{names} ostatnio nie robią postępów. Na stronie postępów sprawdzisz, co zmienić.} other {{names} ostatnio nie robią postępów. Na stronie postępów sprawdzisz, co zmienić.}}',
    prTitle: 'Nowy rekord',
    prWeightDetail: 'W ostatniej sesji padł nowy rekord ciężaru w ćwiczeniu {name}. Dobra robota.',
    prOneRmDetail:
      'W ostatniej sesji padł nowy rekord szacowanego 1RM w ćwiczeniu {name}. Dobra robota.',
    consistentTitle: 'Trenujesz regularnie',
    consistentDetail: 'Dni treningowe w tym tygodniu: {count}. Tak trzymaj.',
    deloadStalledReason:
      '{count, plural, one {# ćwiczenie stoi w miejscu: {names}.} few {# ćwiczenia stoją w miejscu: {names}.} many {# ćwiczeń stoi w miejscu: {names}.} other {# ćwiczenia stoi w miejscu: {names}.}}',
    deloadReadinessReason:
      'Twoja średnia gotowość {checkins, plural, one {z ostatniego check-inu} few {z ostatnich # check-inów} many {z ostatnich # check-inów} other {z ostatnich # check-inu}} to {average}/5.',
  },
} satisfies MessageShape<typeof english>;
