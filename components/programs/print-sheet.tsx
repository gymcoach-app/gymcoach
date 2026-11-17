import {
  buildPrintSheet,
  cellsBySet,
  type PrintSheetExerciseInput,
  type PrintSheetOptions,
} from '@/lib/print-sheet';
import { cn } from '@/lib/utils';

// Printable A4 workout sheet (issue #333). Server-renderable, black on white
// on screen and on paper; every string comes through the caller so the sheet
// stays a pure presentation of the plan.

export interface PrintSheetLabels {
  date: string;
  exercise: string;
  plan: string;
  set: (n: number) => string;
  weight: string;
  reps: string;
  rir: string;
  /** Boxes of a cardio row (issue #576). */
  duration: string;
  distance: string;
  notes: string;
  planLine: (row: { sets: number; min: number; max: number; rir: number }) => string;
  rest: (seconds: number) => string;
  tempo: (tempo: string) => string;
  /** Plan of a cardio exercise without a duration target (issue #558). */
  cardio: string;
  empty: string;
}

export interface PrintSheetWorkout {
  id: string;
  name: string;
  exercises: PrintSheetExerciseInput[];
}

interface Props {
  programName: string;
  workout: PrintSheetWorkout;
  labels: PrintSheetLabels;
  exerciseName: (name: string) => string;
  /** Locale and distance unit the cardio targets are written in. */
  format?: PrintSheetOptions;
  /** Page break after the sheet (when several workouts print in a row). */
  breakAfter?: boolean;
}

export function PrintSheet({
  programName,
  workout,
  labels,
  exerciseName,
  format,
  breakAfter,
}: Props) {
  const sheet = buildPrintSheet(workout.exercises, format);
  const setColumns = Array.from({ length: sheet.maxSets }, (_, i) => i + 1);

  return (
    <section
      data-print-sheet={workout.id}
      className={cn(
        'print-sheet bg-white p-6 text-black print:p-0',
        breakAfter && 'break-after-page',
      )}
    >
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b-2 border-black pb-2">
        <div>
          <p className="text-xs uppercase tracking-wide">{programName}</p>
          <h2 className="text-xl font-bold">{workout.name}</h2>
        </div>
        <p className="text-sm">
          {labels.date}: <span className="inline-block w-32 border-b border-black align-baseline" />
        </p>
      </header>

      {sheet.rows.length === 0 ? (
        <p className="text-sm">{labels.empty}</p>
      ) : (
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr>
              <th className="w-[26%] border border-black px-1.5 py-1 text-left">
                {labels.exercise}
              </th>
              <th className="w-[16%] border border-black px-1.5 py-1 text-left">{labels.plan}</th>
              {setColumns.map((set) => (
                <th key={set} className="border border-black px-1 py-1 text-center">
                  {labels.set(set)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row) => (
              <tr key={row.id} className="break-inside-avoid align-top">
                <td className="border border-black px-1.5 py-1">
                  {row.supersetLabel && (
                    <span className="mr-1 rounded border border-black px-1 text-[10px] font-semibold">
                      {row.supersetLabel}
                    </span>
                  )}
                  <span className="font-semibold">{exerciseName(row.name)}</span>
                  {row.notes && <p className="mt-0.5 text-[10px] leading-tight">{row.notes}</p>}
                  <p className="mt-1 text-[10px]">
                    {labels.notes}: <span className="inline-block w-full border-b border-black" />
                  </p>
                </td>
                <td className="border border-black px-1.5 py-1 leading-tight">
                  {row.cardio ? (
                    <p>{row.cardioTarget ?? labels.cardio}</p>
                  ) : (
                    <>
                      <p>
                        {labels.planLine({
                          sets: row.targetSets,
                          min: row.targetRepsMin,
                          max: row.targetRepsMax,
                          rir: row.targetRIR,
                        })}
                      </p>
                      <p>{labels.rest(row.restSec)}</p>
                      {row.tempo && <p>{labels.tempo(row.tempo)}</p>}
                    </>
                  )}
                </td>
                {setColumns.map((set) => {
                  const cells = cellsBySet(row, set);
                  // A cardio row logs a duration and a distance (issue #576):
                  // two boxes, each with its target pre-printed when set.
                  if (row.cardio) {
                    return (
                      <td key={set} className="border border-black p-0">
                        {cells.length > 0 && (
                          <div className="grid grid-rows-2 divide-y divide-black">
                            {cells.map((cell) => (
                              <div
                                key={cell.kind}
                                data-print-cell={cell.kind}
                                className="flex h-9 flex-wrap content-end items-end justify-between gap-x-1 px-1 pb-0.5 text-[9px] leading-none text-neutral-600"
                              >
                                <span>
                                  {cell.kind === 'duration' && labels.duration}
                                  {cell.kind === 'distance' && labels.distance}
                                </span>
                                {cell.target && <span data-print-target>{cell.target}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  }
                  return (
                    <td key={set} className="border border-black p-0">
                      {cells.length > 0 && (
                        <div className="grid grid-rows-3 divide-y divide-black">
                          {cells.map((cell) => (
                            <div
                              key={cell.kind}
                              data-print-cell={cell.kind}
                              className="flex h-6 items-end px-1 pb-0.5 text-[9px] leading-none text-neutral-600"
                            >
                              {cell.kind === 'weight' && labels.weight}
                              {cell.kind === 'reps' && labels.reps}
                              {cell.kind === 'rir' && labels.rir}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
