import { describe, expect, it } from 'vitest';
import { getTrainingDisplayName } from '@/i18n/training-names';

describe('getTrainingDisplayName', () => {
  it('keeps stored names unchanged in English and unsupported locales', () => {
    const name = 'Day 2 · Day 1';
    expect(getTrainingDisplayName(name, 'en')).toBe(name);
    expect(getTrainingDisplayName(name, 'ja')).toBe(name);
  });

  it('localizes imported day, week and plan names for display', () => {
    expect(getTrainingDisplayName('Day 2 · Day 1', 'ru')).toBe('День 2 · День 1');
    expect(getTrainingDisplayName('Day 3 · Week 5 · New plan', 'ru')).toBe(
      'День 3 · Неделя 5 · Новый план',
    );
  });

  it('uses correct Russian week plurals and preserves date suffixes', () => {
    expect(getTrainingDisplayName('New plan · 1 week (2026-04-23)', 'ru')).toBe(
      'Новый план · 1 неделя (2026-04-23)',
    );
    expect(getTrainingDisplayName('New plan · 2 weeks', 'ru')).toBe('Новый план · 2 недели');
    expect(getTrainingDisplayName('New plan · 5 weeks', 'ru')).toBe('Новый план · 5 недель');
    expect(getTrainingDisplayName('New plan · 11 weeks', 'ru')).toBe('Новый план · 11 недель');
  });

  it('localizes imported names into French with the right week plurals', () => {
    expect(getTrainingDisplayName('Day 3 · Week 5 · New plan', 'fr')).toBe(
      'Jour 3 · Semaine 5 · Nouveau plan',
    );
    expect(getTrainingDisplayName('New plan · 1 week (2026-04-23)', 'fr')).toBe(
      'Nouveau plan · 1 semaine (2026-04-23)',
    );
    expect(getTrainingDisplayName('New plan · 2 weeks', 'fr')).toBe('Nouveau plan · 2 semaines');
    expect(getTrainingDisplayName('Full Body · Day 1 · Full Body Hybrid', 'fr')).toBe(
      'Corps entier · Jour 1 · Hybride corps entier',
    );
  });

  it('localizes imported names into German with the right week plurals', () => {
    expect(getTrainingDisplayName('Day 3 · Week 5 · New plan', 'de')).toBe(
      'Tag 3 · Woche 5 · Neuer Plan',
    );
    expect(getTrainingDisplayName('New plan · 1 week (2026-04-23)', 'de')).toBe(
      'Neuer Plan · 1 Woche (2026-04-23)',
    );
    expect(getTrainingDisplayName('New plan · 2 weeks', 'de')).toBe('Neuer Plan · 2 Wochen');
    expect(getTrainingDisplayName('Full Body · Day 1 · Full Body Hybrid', 'de')).toBe(
      'Ganzkörper · Tag 1 · Ganzkörper-Hybrid',
    );
    expect(getTrainingDisplayName('Upper · Lower', 'de')).toBe('Oberkörper · Unterkörper');
  });

  it('localizes imported names into Spanish with the right week plurals', () => {
    expect(getTrainingDisplayName('Day 3 · Week 5 · New plan', 'es')).toBe(
      'Día 3 · Semana 5 · Nuevo plan',
    );
    expect(getTrainingDisplayName('New plan · 1 week (2026-04-23)', 'es')).toBe(
      'Nuevo plan · 1 semana (2026-04-23)',
    );
    expect(getTrainingDisplayName('New plan · 2 weeks', 'es')).toBe('Nuevo plan · 2 semanas');
    expect(getTrainingDisplayName('Full Body · Day 1 · Full Body Hybrid', 'es')).toBe(
      'Cuerpo completo · Día 1 · Cuerpo completo híbrido',
    );
    expect(getTrainingDisplayName('Upper · Lower', 'es')).toBe('Torso · Pierna');
  });

  it('localizes imported names into Portuguese with the right week plurals', () => {
    expect(getTrainingDisplayName('Day 3 · Week 5 · New plan', 'pt')).toBe(
      'Dia 3 · Semana 5 · Novo plano',
    );
    expect(getTrainingDisplayName('New plan · 1 week (2026-04-23)', 'pt')).toBe(
      'Novo plano · 1 semana (2026-04-23)',
    );
    expect(getTrainingDisplayName('New plan · 2 weeks', 'pt')).toBe('Novo plano · 2 semanas');
    expect(getTrainingDisplayName('Full Body · Day 1 · Full Body Hybrid', 'pt')).toBe(
      'Corpo inteiro · Dia 1 · Corpo inteiro híbrido',
    );
    expect(getTrainingDisplayName('Upper · Lower', 'pt')).toBe('Superiores · Inferiores');
  });

  it('localizes imported names into Italian with the right week plurals', () => {
    expect(getTrainingDisplayName('Day 3 · Week 5 · New plan', 'it')).toBe(
      'Giorno 3 · Settimana 5 · Nuovo piano',
    );
    expect(getTrainingDisplayName('New plan · 1 week (2026-04-23)', 'it')).toBe(
      'Nuovo piano · 1 settimana (2026-04-23)',
    );
    expect(getTrainingDisplayName('New plan · 2 weeks', 'it')).toBe('Nuovo piano · 2 settimane');
    expect(getTrainingDisplayName('Full Body · Day 1 · Full Body Hybrid', 'it')).toBe(
      'Total body · Giorno 1 · Total body ibrido',
    );
    expect(getTrainingDisplayName('Upper · Lower', 'it')).toBe('Parte superiore · Parte inferiore');
  });

  it('localizes imported names into Dutch with the right week plurals', () => {
    expect(getTrainingDisplayName('Day 3 · Week 5 · New plan', 'nl')).toBe(
      'Dag 3 · Week 5 · Nieuw plan',
    );
    expect(getTrainingDisplayName('New plan · 1 week (2026-04-23)', 'nl')).toBe(
      'Nieuw plan · 1 week (2026-04-23)',
    );
    expect(getTrainingDisplayName('New plan · 2 weeks', 'nl')).toBe('Nieuw plan · 2 weken');
    expect(getTrainingDisplayName('Full Body · Day 1 · Full Body Hybrid', 'nl')).toBe(
      'Full body · Dag 1 · Full body hybride',
    );
    expect(getTrainingDisplayName('Upper · Lower', 'nl')).toBe('Bovenlichaam · Onderlichaam');
  });

  it('localizes imported names into Polish with the right week plurals', () => {
    expect(getTrainingDisplayName('Day 3 · Week 5 · New plan', 'pl')).toBe(
      'Dzień 3 · Tydzień 5 · Nowy plan',
    );
    expect(getTrainingDisplayName('New plan · 1 week (2026-04-23)', 'pl')).toBe(
      'Nowy plan · 1 tydzień (2026-04-23)',
    );
    expect(getTrainingDisplayName('New plan · 3 weeks', 'pl')).toBe('Nowy plan · 3 tygodnie');
    expect(getTrainingDisplayName('New plan · 5 weeks', 'pl')).toBe('Nowy plan · 5 tygodni');
    expect(getTrainingDisplayName('New plan · 12 weeks', 'pl')).toBe('Nowy plan · 12 tygodni');
    expect(getTrainingDisplayName('Full Body · Day 1 · Full Body Hybrid', 'pl')).toBe(
      'FBW · Dzień 1 · Hybrydowy FBW',
    );
    expect(getTrainingDisplayName('Upper · Lower', 'pl')).toBe('Góra ciała · Dół ciała');
  });

  it('localizes imported names into Turkish', () => {
    expect(getTrainingDisplayName('Day 3 · Week 5 · New plan', 'tr')).toBe(
      'Gün 3 · Hafta 5 · Yeni plan',
    );
    expect(getTrainingDisplayName('New plan · 1 week (2026-04-23)', 'tr')).toBe(
      'Yeni plan · 1 hafta (2026-04-23)',
    );
    expect(getTrainingDisplayName('New plan · 5 weeks', 'tr')).toBe('Yeni plan · 5 hafta');
    expect(getTrainingDisplayName('Full Body · Day 1 · Full Body Hybrid', 'tr')).toBe(
      'Tüm vücut · Gün 1 · Tüm vücut hibrit',
    );
    expect(getTrainingDisplayName('Upper · Lower', 'tr')).toBe('Üst vücut · Alt vücut');
  });

  it('localizes common imported split names', () => {
    expect(getTrainingDisplayName('Full Body · Day 1 · Full Body Hybrid', 'ru')).toBe(
      'Всё тело · День 1 · Гибридная программа на всё тело',
    );
  });

  it('does not partially translate arbitrary user-defined names', () => {
    expect(getTrainingDisplayName('Upper body - Upper body body', 'ru')).toBe(
      'Upper body - Upper body body',
    );
  });
});
