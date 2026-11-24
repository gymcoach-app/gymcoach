import { describe, expect, it } from 'vitest';
import { EquipmentType, MuscleGroup } from '@/lib/prisma-client';
import { REGION_PATHS } from '@/components/progress/body-paths';
import { EXERCISE_CATALOG } from '@/lib/exercise-catalog';
import { MUSCLE_REGIONS } from '@/lib/muscle-map';
import {
  FILTER_MUSCLE_GROUPS,
  NO_CATALOG_FILTERS,
  buildGymInventory,
  catalogMuscleGroups,
  defaultFilterGym,
  filterCatalog,
  gymAvailability,
  hasActiveFilters,
  hasBodyRegion,
  isAvailableAtGym,
  isInventoryEmpty,
  toggleMuscle,
  type FilterableExercise,
  type GymInventory,
  type GymInventorySource,
} from './exercise-filters';

function ex(
  id: string,
  muscleGroup: MuscleGroup,
  equipmentType: EquipmentType,
  name = id,
): FilterableExercise {
  return { id, name, muscleGroup, equipmentType };
}

function source(over: Partial<GymInventorySource> = {}): GymInventorySource {
  return {
    id: 'g1',
    name: 'Home',
    dumbbellWeights: [],
    plateWeights: [],
    barWeights: [],
    equipment: [],
    exerciseConfigs: [],
    ...over,
  };
}

function gym(over: Partial<GymInventorySource> = {}): GymInventory {
  return buildGymInventory(source(over));
}

const bench = ex('bench', 'CHEST', 'BARBELL', 'Barbell bench press');
const dbPress = ex('db-press', 'CHEST', 'DUMBBELL', 'Incline dumbbell press');
const pecDeck = ex('pec-deck', 'CHEST', 'MACHINE', 'Pec deck');
const pushdown = ex('pushdown', 'TRICEPS', 'CABLE', 'Triceps pushdown');
const pullUp = ex('pull-up', 'BACK_WIDTH', 'BODYWEIGHT', 'Pull-up');
const running = ex('running', 'OTHER', 'CARDIO', 'Running');
const custom = ex('custom', 'QUADS', 'OTHER', 'Sled push');
const all = [bench, dbPress, pecDeck, pushdown, pullUp, running, custom];

function ids(list: FilterableExercise[]): string[] {
  return list.map((exercise) => exercise.id);
}

describe('muscle groups and body regions', () => {
  it('offers every catalog muscle group exactly once', () => {
    expect([...FILTER_MUSCLE_GROUPS].sort()).toEqual(Object.values(MuscleGroup).sort());
  });

  it('draws every group that has a region on the view it is mapped to', () => {
    for (const group of FILTER_MUSCLE_GROUPS) {
      const mapping = MUSCLE_REGIONS[group];
      expect(hasBodyRegion(group), group).toBe(mapping !== null);
      if (!mapping) continue;
      for (const regionId of mapping.regionIds) {
        expect(REGION_PATHS[mapping.view][regionId], `${group} ${regionId}`).toBeTruthy();
      }
    }
  });

  it('leaves no silhouette region without a muscle group', () => {
    const mapped = new Set(
      FILTER_MUSCLE_GROUPS.flatMap((group) => {
        const mapping = MUSCLE_REGIONS[group];
        return mapping ? mapping.regionIds.map((id) => `${mapping.view}/${id}`) : [];
      }),
    );
    const drawn = (['front', 'back'] as const).flatMap((view) =>
      Object.keys(REGION_PATHS[view]).map((id) => `${view}/${id}`),
    );
    expect(drawn.filter((id) => !mapped.has(id))).toEqual([]);
  });

  it('has OTHER, the group without a region, as the only list-only group', () => {
    expect(FILTER_MUSCLE_GROUPS.filter((group) => !hasBodyRegion(group))).toEqual(['OTHER']);
  });

  it('keeps built-in cardio reachable: it sits in the list-only OTHER group', () => {
    const cardio = EXERCISE_CATALOG.filter((exercise) => exercise.category === 'CARDIO');
    expect(cardio.length).toBeGreaterThan(0);
    expect(new Set(cardio.map((exercise) => exercise.muscleGroup))).toEqual(new Set(['OTHER']));
  });

  it('lists only the groups present in the catalog, in list order', () => {
    expect(catalogMuscleGroups([running, custom, bench, pushdown])).toEqual([
      'CHEST',
      'TRICEPS',
      'QUADS',
      'OTHER',
    ]);
    expect(catalogMuscleGroups([])).toEqual([]);
  });

  it('toggles a muscle without mutating the previous selection', () => {
    const none: ReadonlySet<MuscleGroup> = new Set();
    const chest = toggleMuscle(none, 'CHEST');
    expect([...chest]).toEqual(['CHEST']);
    expect(none.size).toBe(0);
    expect([...toggleMuscle(chest, 'CHEST')]).toEqual([]);
    expect([...toggleMuscle(chest, 'QUADS')]).toEqual(['CHEST', 'QUADS']);
  });
});

describe('buildGymInventory', () => {
  it('reduces a gym to flags and id lists', () => {
    const inventory = gym({
      dumbbellWeights: [10, 12.5],
      barWeights: [20],
      equipment: [
        { equipmentType: 'MACHINE', exerciseLinks: [{ exerciseId: 'a' }, { exerciseId: 'b' }] },
        { equipmentType: 'MACHINE', exerciseLinks: [{ exerciseId: 'a' }] },
        { equipmentType: 'CABLE', exerciseLinks: [] },
      ],
      exerciseConfigs: [
        { exerciseId: 'c', isAvailable: false, weightOptions: [5, 10] },
        { exerciseId: 'd', isAvailable: true, weightOptions: [5, 10] },
        { exerciseId: 'e', isAvailable: true, weightOptions: [] },
      ],
    });
    expect(inventory).toEqual({
      id: 'g1',
      name: 'Home',
      hasDumbbells: true,
      hasBarbell: true,
      itemTypes: ['MACHINE', 'CABLE'],
      linkedExerciseIds: ['a', 'b'],
      loadedExerciseIds: ['d'],
      unavailableExerciseIds: ['c'],
    });
  });

  it('reads plates without a saved bar as barbell equipment', () => {
    expect(gym({ plateWeights: [20] }).hasBarbell).toBe(true);
    expect(gym().hasBarbell).toBe(false);
  });

  it('calls an inventory empty only without free weights and items', () => {
    expect(isInventoryEmpty(gym())).toBe(true);
    expect(
      isInventoryEmpty(
        gym({ exerciseConfigs: [{ exerciseId: 'x', isAvailable: false, weightOptions: [] }] }),
      ),
    ).toBe(true);
    expect(isInventoryEmpty(gym({ dumbbellWeights: [5] }))).toBe(false);
    expect(isInventoryEmpty(gym({ plateWeights: [5] }))).toBe(false);
    expect(
      isInventoryEmpty(gym({ equipment: [{ equipmentType: 'CARDIO', exerciseLinks: [] }] })),
    ).toBe(false);
  });
});

describe('defaultFilterGym', () => {
  const home = gym({ id: 'home', name: 'Home' });
  const club = gym({ id: 'club', name: 'Club' });

  it('starts on the active gym', () => {
    expect(defaultFilterGym([home, club], 'club')).toBe(club);
  });

  it('falls back to the first gym when none is active or the active one is gone', () => {
    expect(defaultFilterGym([home, club], null)).toBe(home);
    expect(defaultFilterGym([home, club], 'deleted')).toBe(home);
  });

  it('is null without a saved gym', () => {
    expect(defaultFilterGym([], 'club')).toBeNull();
  });
});

describe('gymAvailability', () => {
  it('matches free-weight exercises against the shared free weights', () => {
    expect(gymAvailability(dbPress, gym({ dumbbellWeights: [10] }))).toBe('available');
    expect(gymAvailability(dbPress, gym({ barWeights: [20] }))).toBe('missing');
    expect(gymAvailability(bench, gym({ barWeights: [20] }))).toBe('available');
    expect(gymAvailability(bench, gym({ dumbbellWeights: [10] }))).toBe('missing');
  });

  it('accepts a saved item of the type in place of the free-weight lists', () => {
    const rack = gym({ equipment: [{ equipmentType: 'DUMBBELL', exerciseLinks: [] }] });
    expect(gymAvailability(dbPress, rack)).toBe('available');
    const bar = gym({ equipment: [{ equipmentType: 'BARBELL', exerciseLinks: [] }] });
    expect(gymAvailability(bench, bar)).toBe('available');
  });

  it('matches machine and cable exercises on the item type, each on its own', () => {
    const machines = gym({ equipment: [{ equipmentType: 'MACHINE', exerciseLinks: [] }] });
    expect(gymAvailability(pecDeck, machines)).toBe('available');
    expect(gymAvailability(pushdown, machines)).toBe('missing');
    const cables = gym({ equipment: [{ equipmentType: 'CABLE', exerciseLinks: [] }] });
    expect(gymAvailability(pushdown, cables)).toBe('available');
    expect(gymAvailability(pecDeck, cables)).toBe('missing');
  });

  it('keeps bodyweight exercises whatever the gym holds', () => {
    expect(gymAvailability(pullUp, gym())).toBe('no-equipment');
    expect(isAvailableAtGym(pullUp, gym())).toBe(true);
  });

  it('keeps exercises whose equipment type cannot be checked', () => {
    expect(gymAvailability(custom, gym())).toBe('unknown');
    expect(gymAvailability(running, gym())).toBe('unknown');
    expect(isAvailableAtGym(custom, gym())).toBe(true);
    expect(isAvailableAtGym(running, gym())).toBe(true);
  });

  it('accepts an exercise linked to an item of another type', () => {
    const linked = gym({
      equipment: [{ equipmentType: 'OTHER', exerciseLinks: [{ exerciseId: pecDeck.id }] }],
    });
    expect(gymAvailability(pecDeck, linked)).toBe('available');
  });

  it('accepts an exercise with its own saved load options at the gym', () => {
    const loaded = gym({
      exerciseConfigs: [{ exerciseId: pecDeck.id, isAvailable: true, weightOptions: [10, 20] }],
    });
    expect(gymAvailability(pecDeck, loaded)).toBe('available');
  });

  it('lets the per-gym "not available" switch win over everything else', () => {
    const off = (exerciseId: string) => ({ exerciseId, isAvailable: false, weightOptions: [10] });
    const inventory = gym({
      dumbbellWeights: [10],
      equipment: [{ equipmentType: 'MACHINE', exerciseLinks: [{ exerciseId: pecDeck.id }] }],
      exerciseConfigs: [off(dbPress.id), off(pecDeck.id), off(pullUp.id), off(custom.id)],
    });
    for (const exercise of [dbPress, pecDeck, pullUp, custom]) {
      expect(gymAvailability(exercise, inventory), exercise.id).toBe('excluded');
      expect(isAvailableAtGym(exercise, inventory), exercise.id).toBe(false);
    }
  });

  it('classifies every equipment type', () => {
    const empty = gym();
    for (const equipmentType of Object.values(EquipmentType)) {
      expect(gymAvailability({ id: 'x', equipmentType }, empty), equipmentType).toMatch(
        /^(missing|unknown|no-equipment)$/,
      );
    }
  });
});

describe('filterCatalog', () => {
  it('returns everything, in order, without filters', () => {
    expect(filterCatalog(all, NO_CATALOG_FILTERS)).toEqual(all);
    expect(hasActiveFilters(NO_CATALOG_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...NO_CATALOG_FILTERS, query: '   ' })).toBe(false);
  });

  it('reports each filter as active', () => {
    expect(hasActiveFilters({ ...NO_CATALOG_FILTERS, query: 'a' })).toBe(true);
    expect(hasActiveFilters({ ...NO_CATALOG_FILTERS, muscles: new Set(['ABS']) })).toBe(true);
    expect(hasActiveFilters({ ...NO_CATALOG_FILTERS, gym: gym() })).toBe(true);
  });

  it('filters by one muscle group, and widens with a second', () => {
    expect(
      ids(filterCatalog(all, { ...NO_CATALOG_FILTERS, muscles: new Set(['CHEST']) })),
    ).toEqual(['bench', 'db-press', 'pec-deck']);
    expect(
      ids(filterCatalog(all, { ...NO_CATALOG_FILTERS, muscles: new Set(['TRICEPS', 'OTHER']) })),
    ).toEqual(['pushdown', 'running']);
  });

  it('keeps only what the gym has', () => {
    const home = gym({ dumbbellWeights: [5, 10] });
    expect(ids(filterCatalog(all, { ...NO_CATALOG_FILTERS, gym: home }))).toEqual([
      'db-press',
      'pull-up',
      'running',
      'custom',
    ]);
  });

  it('never returns an empty catalog for an empty inventory when bodyweight work exists', () => {
    expect(ids(filterCatalog(all, { ...NO_CATALOG_FILTERS, gym: gym() }))).toEqual([
      'pull-up',
      'running',
      'custom',
    ]);
  });

  it('searches the stored and the displayed name, folded', () => {
    const displayName = (name: string) => (name === 'Pull-up' ? 'Traction' : name);
    expect(ids(filterCatalog(all, { ...NO_CATALOG_FILTERS, query: '  PRESS ' }))).toEqual([
      'bench',
      'db-press',
    ]);
    expect(
      ids(filterCatalog(all, { ...NO_CATALOG_FILTERS, query: 'tract' }, { displayName })),
    ).toEqual(['pull-up']);
    expect(ids(filterCatalog(all, { ...NO_CATALOG_FILTERS, query: 'tract' }))).toEqual([]);
  });

  it('intersects search, muscles and gym', () => {
    const home = gym({ dumbbellWeights: [5, 10] });
    const filters = { query: 'press', muscles: new Set<MuscleGroup>(['CHEST']), gym: home };
    expect(ids(filterCatalog(all, filters))).toEqual(['db-press']);
    expect(filterCatalog(all, { ...filters, query: 'deck' })).toEqual([]);
  });

  it('keeps the extra fields of the rows it is given', () => {
    const rows = [{ ...bench, isFavorite: true }];
    expect(filterCatalog(rows, NO_CATALOG_FILTERS)[0]?.isFavorite).toBe(true);
  });
});
