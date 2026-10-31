import type { Locale } from '@/i18n/config';

interface TrainingNameRules {
  phrases: Readonly<Record<string, string>>;
  generatedSegmentPattern?: RegExp;
  day: (number: string) => string;
  week: (number: string) => string;
  weeks: (count: number) => string;
}

// Program and workout identity remains exactly as imported or entered by the
// user. These rules only localize common generated names at display time.
const rulesByLocale: Partial<Record<Locale, TrainingNameRules>> = {
  'zh-CN': {
    phrases: {
      'New plan': '新训练计划',
      'Full Body Hybrid': '全身混合训练',
      'Full Body': '全身训练',
      Upper: '上肢训练',
      Lower: '下肢训练',
      'Upper Body': '上肢训练',
      'Lower Body': '下肢训练',
      'Push Day': '推训练日',
      'Pull Day': '拉训练日',
      'Leg Day': '腿部训练日',
      'Push Pull Legs': '推拉腿分化训练',
      'Upper Lower': '上下肢分化训练',
      Strength: '力量',
      Hypertrophy: '增肌',
      General: '综合训练',
      'Day 1 - Overhead Press': '第 1 天 - 过顶推举',
      'Day 2 - Deadlift': '第 2 天 - 硬拉',
      'Day 3 - Bench Press': '第 3 天 - 卧推',
      'Day 4 - Squat': '第 4 天 - 深蹲',
      'Day A - Squat / Bench': '训练日 A - 深蹲 / 卧推',
      'Day B - Overhead Press / Deadlift': '训练日 B - 过顶推举 / 硬拉',
      'Day C - Bench / Squat': '训练日 C - 卧推 / 深蹲',
      'Push A': '推训练 A',
      'Push B': '推训练 B',
      'Pull A': '拉训练 A',
      'Pull B': '拉训练 B',
      'Legs A': '腿部训练 A',
      'Legs B': '腿部训练 B',
      'Upper A': '上肢训练 A',
      'Upper B': '上肢训练 B',
      'Lower A': '下肢训练 A',
      'Lower B': '下肢训练 B',
      'Day 1 - Bench / OHP': '第 1 天 - 卧推 / OHP',
      'Day 2 - Squat / Sumo Deadlift': '第 2 天 - 深蹲 / 相扑硬拉',
      'Day 3 - OHP / Incline Bench': '第 3 天 - OHP / 上斜卧推',
      'Day 4 - Deadlift / Front Squat': '第 4 天 - 硬拉 / 前蹲',
      'Workout A - Squat / Bench / Deadlift': '训练 A - 深蹲 / 卧推 / 硬拉',
      'Workout B - Squat / Press / Power Clean': '训练 B - 深蹲 / 推举 / 高翻',
      'Workout A - Squat / Bench / Row': '训练 A - 深蹲 / 卧推 / 划船',
      'Workout B - Squat / Press / Deadlift': '训练 B - 深蹲 / 推举 / 硬拉',
      'Monday - Heavy Ramp': '周一 - 大重量递增训练',
      'Wednesday - Light': '周三 - 轻重量训练',
      'Friday - Top Set / PR': '周五 - 顶组 / PR',
      'Upper Power': '上肢力量训练',
      'Lower Power': '下肢力量训练',
      'Upper Hypertrophy': '上肢增肌训练',
      'Lower Hypertrophy': '下肢增肌训练',
      'Back / Shoulders Hypertrophy': '背部 / 肩部增肌训练',
      'Chest / Arms Hypertrophy': '胸部 / 手臂增肌训练',
      'Full Body 3x': '全身训练（每周 3 次）',
      'Full Body A': '全身训练 A',
      'Full Body B': '全身训练 B',
      'Full Body C': '全身训练 C',
    },
    // Only translate complete generated segments, not numbers embedded in custom names.
    generatedSegmentPattern:
      /^(?:Day\s+\d+|Week\s+\d+|\d+\s+weeks?)(?:\s+\(\d{4}-\d{2}-\d{2}\))?$/i,
    day: (number) => `第 ${number} 天`,
    week: (number) => `第 ${number} 周`,
    weeks: (count) => `${count} 周`,
  },
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
  it: {
    phrases: {
      'New plan': 'Nuovo piano',
      'Full Body Hybrid': 'Total body ibrido',
      'Full Body': 'Total body',
      Upper: 'Parte superiore',
      Lower: 'Parte inferiore',
    },
    day: (number) => `Giorno ${number}`,
    week: (number) => `Settimana ${number}`,
    weeks: (count) => `${count} ${count === 1 ? 'settimana' : 'settimane'}`,
  },
  nl: {
    phrases: {
      'New plan': 'Nieuw plan',
      'Full Body Hybrid': 'Full body hybride',
      'Full Body': 'Full body',
      Upper: 'Bovenlichaam',
      Lower: 'Onderlichaam',
    },
    day: (number) => `Dag ${number}`,
    week: (number) => `Week ${number}`,
    weeks: (count) => `${count} ${count === 1 ? 'week' : 'weken'}`,
  },
  pl: {
    phrases: {
      'New plan': 'Nowy plan',
      'Full Body Hybrid': 'Hybrydowy FBW',
      'Full Body': 'FBW',
      Upper: 'Góra ciała',
      Lower: 'Dół ciała',
    },
    day: (number) => `Dzień ${number}`,
    week: (number) => `Tydzień ${number}`,
    weeks: (count) => `${count} ${polishWeekWord(count)}`,
  },
  tr: {
    phrases: {
      'New plan': 'Yeni plan',
      'Full Body Hybrid': 'Tüm vücut hibrit',
      'Full Body': 'Tüm vücut',
      Upper: 'Üst vücut',
      Lower: 'Alt vücut',
    },
    day: (number) => `Gün ${number}`,
    week: (number) => `Hafta ${number}`,
    // Turkish keeps the noun singular after a number.
    weeks: (count) => `${count} hafta`,
  },
};

function polishWeekWord(count: number): string {
  if (count === 1) return 'tydzień';
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'tygodnie';
  return 'tygodni';
}

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
  if (!phrase && rules.generatedSegmentPattern && !rules.generatedSegmentPattern.test(value)) {
    return segment;
  }
  const localized = (phrase?.[1] ?? value)
    .replace(/\bDay\s+(\d+)\b/gi, (_, number: string) => rules.day(number))
    .replace(/\bWeek\s+(\d+)\b/gi, (_, number: string) => rules.week(number))
    .replace(/\b(\d+)\s+weeks?\b/gi, (_, count: string) => rules.weeks(Number(count)));
  return `${leading}${localized}${trailing}`;
}
