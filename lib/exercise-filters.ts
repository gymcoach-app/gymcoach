// Catalog filters (issue #402): narrow the exercise catalog by muscle group
// (picked on the body silhouette or in the muscle list) and by what a saved
// gym can actually offer, both combined with the text search. Pure and
// display-only: nothing here writes data or influences progression.

import type { EquipmentType, MuscleGroup } from '@/lib/prisma-client';
import { MUSCLE_REGIONS } from '@/lib/muscle-map';
import { matchesSearch } from '@/lib/search-fold';

// Every catalog muscle group, in the order the muscle list shows them. The
// order follows MUSCLE_REGIONS, which is typed against the MuscleGroup enum,
// so a group added to the schema cannot be left out of the filter. OTHER (the
// bucket that holds cardio and unclassified exercises) has no silhouette
// region and is reachable through the list only.
export const FILTER_MUSCLE_GROUPS = Object.keys(MUSCLE_REGIONS) as MuscleGroup[];

// Whether a group can be tapped on the body silhouette.
export function hasBodyRegion(group: MuscleGroup): boolean {
  return MUSCLE_REGIONS[group] !== null;
}

// The part of a saved gym the equipment filter reads. Built on the server so
// the page ships a few flags and id lists instead of gym rows.
export interface GymInventory {
  id: string;
  name: string;
  // Shared free weights saved on the gym itself.
  hasDumbbells: boolean;
  hasBarbell: boolean;
  // Types of the physical items saved in the gym (a leg press, a dumbbell
  // rack). Items only come from the API, the MCP tools and a backup: the
  // settings screen saves free weights and per-exercise rows, never items.
  itemTypes: EquipmentType[];
  // Exercises linked to one of those items.
  linkedExerciseIds: string[];
  // Exercises with their own saved load options at this gym (a pin stack).
  loadedExerciseIds: string[];
  // Exercises the user switched off for this gym in the settings.
  unavailableExerciseIds: string[];
}

export interface GymInventorySource {
  id: string;
  name: string;
  dumbbellWeights: number[];
  plateWeights: number[];
  barWeights: number[];
  equipment: Array<{ equipmentType: EquipmentType; exerciseLinks: Array<{ exerciseId: string }> }>;
  exerciseConfigs: Array<{ exerciseId: string; isAvailable: boolean; weightOptions: number[] }>;
}

export function buildGymInventory(gym: GymInventorySource): GymInventory {
  return {
    id: gym.id,
    name: gym.name,
    hasDumbbells: gym.dumbbellWeights.length > 0,
    // Plates without a saved bar still mean barbell work: the bar list is the
    // field people skip.
    hasBarbell: gym.barWeights.length > 0 || gym.plateWeights.length > 0,
    itemTypes: [...new Set(gym.equipment.map((item) => item.equipmentType))],
    linkedExerciseIds: [
      ...new Set(gym.equipment.flatMap((item) => item.exerciseLinks.map((l) => l.exerciseId))),
    ],
    loadedExerciseIds: gym.exerciseConfigs
      .filter((config) => config.isAvailable && config.weightOptions.length > 0)
      .map((config) => config.exerciseId),
    unavailableExerciseIds: gym.exerciseConfigs
      .filter((config) => !config.isAvailable)
      .map((config) => config.exerciseId),
  };
}

// A gym with no free weights, no items and no exercise load options says
// nothing about its equipment. The filter still applies (see
// gymAvailability), and the view explains why dumbbell and barbell work is
// gone instead of showing a bare short list.
export function isInventoryEmpty(gym: GymInventory): boolean {
  return (
    !gym.hasDumbbells &&
    !gym.hasBarbell &&
    gym.itemTypes.length === 0 &&
    gym.loadedExerciseIds.length === 0
  );
}

// The gym the equipment filter starts on: the active gym when it is still
// among the saved ones, otherwise the first saved gym. Null without any gym.
export function defaultFilterGym(
  gyms: readonly GymInventory[],
  activeGymId: string | null | undefined,
): GymInventory | null {
  return gyms.find((gym) => gym.id === activeGymId) ?? gyms[0] ?? null;
}

// Why an exercise passes or fails "only what my gym has":
// - 'excluded': the user switched it off for this gym. This wins over every
//   other signal, bodyweight included.
// - 'available': it is linked to an item of the gym, has its own load options
//   there, or is a free-weight exercise in a gym that has those weights.
// - 'no-equipment': a bodyweight exercise, which needs nothing from the gym.
// - 'unknown': a saved gym cannot say whether the exercise can be done there,
//   so it stays visible.
//   MACHINE and CABLE: a gym saved in the settings holds free weights and
//   per-exercise rows, and an exercise with no row counts as available there.
//   It has no list of machines to be absent from, so "no machine saved" is
//   not evidence of "no machine". A saved item or stack of the same type does
//   not change that either: knowing one machine says nothing about another,
//   and evidence about one must not hide the rest. The per-exercise switch
//   is the one way to rule a machine or cable exercise out.
//   CARDIO covers a run outdoors as well as a rowing machine, and OTHER is
//   the default type of custom and imported exercises.
// - 'missing': a dumbbell or barbell exercise in a gym with no such weights.
//   Free weights are the one kind of equipment the settings screen lists per
//   gym, so their absence is the only type-level reason to hide an exercise.
export type GymAvailability = 'excluded' | 'available' | 'no-equipment' | 'unknown' | 'missing';

export interface FilterableExercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipmentType: EquipmentType;
}

export function gymAvailability(
  exercise: Pick<FilterableExercise, 'id' | 'equipmentType'>,
  gym: GymInventory,
): GymAvailability {
  if (gym.unavailableExerciseIds.includes(exercise.id)) return 'excluded';
  if (gym.linkedExerciseIds.includes(exercise.id)) return 'available';
  if (gym.loadedExerciseIds.includes(exercise.id)) return 'available';
  switch (exercise.equipmentType) {
    case 'BODYWEIGHT':
      return 'no-equipment';
    case 'MACHINE':
    case 'CABLE':
    case 'CARDIO':
    case 'OTHER':
      return 'unknown';
    case 'DUMBBELL':
      return gym.hasDumbbells || gym.itemTypes.includes('DUMBBELL') ? 'available' : 'missing';
    case 'BARBELL':
      return gym.hasBarbell || gym.itemTypes.includes('BARBELL') ? 'available' : 'missing';
  }
}

export function isAvailableAtGym(
  exercise: Pick<FilterableExercise, 'id' | 'equipmentType'>,
  gym: GymInventory,
): boolean {
  const availability = gymAvailability(exercise, gym);
  return availability !== 'excluded' && availability !== 'missing';
}

export interface CatalogFilters {
  // Raw search box content; blank means no text filter.
  query: string;
  // Selected muscle groups; empty means every group. Several selected groups
  // widen the result (chest or triceps), they do not intersect.
  muscles: ReadonlySet<MuscleGroup>;
  // The gym to check equipment against; null when the filter is off.
  gym: GymInventory | null;
}

export const NO_CATALOG_FILTERS: CatalogFilters = { query: '', muscles: new Set(), gym: null };

export function hasActiveFilters(filters: CatalogFilters): boolean {
  return filters.query.trim() !== '' || filters.muscles.size > 0 || filters.gym !== null;
}

export interface CatalogFilterOptions {
  locale?: string;
  // Localized name shown for a built-in exercise, searched alongside the
  // stored name so a search works in either language.
  displayName?: (name: string) => string;
}

// The filters intersect: an exercise must match the search, belong to one of
// the selected muscle groups and be available at the gym. Order is preserved.
export function filterCatalog<T extends FilterableExercise>(
  exercises: readonly T[],
  filters: CatalogFilters,
  options: CatalogFilterOptions = {},
): T[] {
  const query = filters.query.trim();
  const { gym, muscles } = filters;
  const { locale, displayName } = options;
  return exercises.filter((exercise) => {
    if (muscles.size > 0 && !muscles.has(exercise.muscleGroup)) return false;
    if (gym && !isAvailableAtGym(exercise, gym)) return false;
    if (!query) return true;
    return (
      matchesSearch(exercise.name, query, locale) ||
      (displayName !== undefined && matchesSearch(displayName(exercise.name), query, locale))
    );
  });
}

// The groups the catalog actually holds, in list order: the only ones the
// muscle filter offers, so no choice leads to an empty list on its own.
export function catalogMuscleGroups(
  exercises: readonly Pick<FilterableExercise, 'muscleGroup'>[],
): MuscleGroup[] {
  const present = new Set(exercises.map((exercise) => exercise.muscleGroup));
  return FILTER_MUSCLE_GROUPS.filter((group) => present.has(group));
}

export function toggleMuscle(
  muscles: ReadonlySet<MuscleGroup>,
  group: MuscleGroup,
): ReadonlySet<MuscleGroup> {
  const next = new Set(muscles);
  if (!next.delete(group)) next.add(group);
  return next;
}
