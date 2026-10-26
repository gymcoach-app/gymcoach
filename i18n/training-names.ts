import type { Locale } from '@/i18n/config';

interface TrainingNameRules {
  phrases: Readonly<Record<string, string>>;
  day: (number: string) => string;
  week: (number: string) => string;
  weeks: (count: number) => string;
}

// Program and workout identity remains exactly as imported or entered by the
// user. These rules only localize common generated names at display time.
const rulesByLocale: Partial<Record<Locale, TrainingNameRules>> = {
  ru: {
    phrases: {
      'New plan': 'Новый план',
      'Full Body Hybrid': 'Гибридная программа на всё тело',
      'Full Body': 'Всё тело',
      Upper: 'Верх тела',
      Lower: 'Низ тела',
    },
    day: (number) => `День ${number}`,
    week: (number) => `Неделя ${number}`,
    weeks: (count) => `${count} ${russianWeekWord(count)}`,
  },
  fr: {
    phrases: {
      'New plan': 'Nouveau plan',
      'Full Body Hybrid': 'Hybride corps entier',
      'Full Body': 'Corps entier',
      Upper: 'Haut du corps',
      Lower: 'Bas du corps',
    },
    day: (number) => `Jour ${number}`,
    week: (number) => `Semaine ${number}`,
    weeks: (count) => `${count} ${count === 1 ? 'semaine' : 'semaines'}`,
  },
  de: {
    phrases: {
      'New plan': 'Neuer Plan',
      'Full Body Hybrid': 'Ganzkörper-Hybrid',
      'Full Body': 'Ganzkörper',
      Upper: 'Oberkörper',
      Lower: 'Unterkörper',
    },
    day: (number) => `Tag ${number}`,
    week: (number) => `Woche ${number}`,
    weeks: (count) => `${count} ${count === 1 ? 'Woche' : 'Wochen'}`,
  },
  es: {
    phrases: {
      'New plan': 'Nuevo plan',
      'Full Body Hybrid': 'Cuerpo completo híbrido',
      'Full Body': 'Cuerpo completo',
      Upper: 'Torso',
      Lower: 'Pierna',
    },
    day: (number) => `Día ${number}`,
    week: (number) => `Semana ${number}`,
    weeks: (count) => `${count} ${count === 1 ? 'semana' : 'semanas'}`,
  },
  pt: {
    phrases: {
      'New plan': 'Novo plano',
      'Full Body Hybrid': 'Corpo inteiro híbrido',
      'Full Body': 'Corpo inteiro',
      Upper: 'Superiores',
      Lower: 'Inferiores',
    },
    day: (number) => `Dia ${number}`,
    week: (number) => `Semana ${number}`,
    weeks: (count) => `${count} ${count === 1 ? 'semana' : 'semanas'}`,
  },
};

function russianWeekWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'неделя';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'недели';
  return 'недель';
}

export function getTrainingDisplayName(name: string, locale: string): string {
  const rules = rulesByLocale[locale as Locale];
  if (!rules) return name;

  return name
    .split(/(\s*·\s*)/)
    .map((part) => (part.includes('·') ? part : localizeSegment(part, rules)))
    .join('');
}

function localizeSegment(segment: string, rules: TrainingNameRules): string {
  const leading = segment.match(/^\s*/)?.[0] ?? '';
  const trailing = segment.match(/\s*$/)?.[0] ?? '';
  const value = segment.trim();
  const phrase = Object.entries(rules.phrases).find(
    ([source]) => source.toLocaleLowerCase('en-US') === value.toLocaleLowerCase('en-US'),
  );
  const localized = (phrase?.[1] ?? value)
    .replace(/\bDay\s+(\d+)\b/gi, (_, number: string) => rules.day(number))
    .replace(/\bWeek\s+(\d+)\b/gi, (_, number: string) => rules.week(number))
    .replace(/\b(\d+)\s+weeks?\b/gi, (_, count: string) => rules.weeks(Number(count)));
  return `${leading}${localized}${trailing}`;
}
