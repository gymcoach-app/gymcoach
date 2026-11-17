import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH, fitText, type ShareCardData } from '@/lib/share-card';

// Draws the share card (issue #576 part 3) with plain Canvas 2D: no image, no
// web font, nothing fetched. The card is always light, whatever the app
// theme, so it reads on any feed. Every text goes through fitText, so a long
// workout or exercise name ends with an ellipsis instead of overflowing.

// Fonts every platform has; CJK and Cyrillic fall back to the system face.
const FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const COLORS = {
  background: '#ffffff',
  accent: '#2563eb',
  text: '#18181b',
  muted: '#52525b',
  tile: '#f4f4f5',
  rule: '#e4e4e7',
};

const PADDING = 72;
const STAT_HEIGHT = 132;
const STAT_GAP = 20;
const MAX_ROW_HEIGHT = 84;

function font(weight: number, size: number): string {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

export function drawShareCard(ctx: CanvasRenderingContext2D, card: ShareCardData): void {
  const width = SHARE_CARD_WIDTH;
  const height = SHARE_CARD_HEIGHT;
  const inner = width - PADDING * 2;
  const measure = (value: string) => ctx.measureText(value).width;
  // Sets the font, then draws the text cut to maxWidth.
  const text = (value: string, x: number, y: number, maxWidth: number, fontSpec: string) => {
    ctx.font = fontSpec;
    ctx.fillText(fitText(value, maxWidth, measure), x, y);
  };

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(0, 0, width, 16);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Header: app name, workout name, date.
  ctx.fillStyle = COLORS.accent;
  text(card.appName, PADDING, 116, inner, font(700, 38));
  ctx.fillStyle = COLORS.text;
  text(card.title, PADDING, 212, inner, font(800, 72));
  ctx.fillStyle = COLORS.muted;
  text(card.date, PADDING, 272, inner, font(500, 36));

  // Stat tiles fill the width: one row of up to three, or two rows of two.
  let y = 320;
  const statColumns = card.stats.length === 4 ? 2 : Math.min(Math.max(card.stats.length, 1), 3);
  const tileWidth = (inner - STAT_GAP * (statColumns - 1)) / statColumns;
  card.stats.forEach((stat, index) => {
    const column = index % statColumns;
    const row = Math.floor(index / statColumns);
    const x = PADDING + column * (tileWidth + STAT_GAP);
    const top = y + row * (STAT_HEIGHT + STAT_GAP);
    ctx.fillStyle = COLORS.tile;
    ctx.fillRect(x, top, tileWidth, STAT_HEIGHT);
    ctx.fillStyle = COLORS.muted;
    text(stat.label, x + 24, top + 48, tileWidth - 48, font(500, 28));
    ctx.fillStyle = COLORS.text;
    text(stat.value, x + 24, top + 104, tileWidth - 48, font(700, 44));
  });
  const statRows = Math.ceil(card.stats.length / statColumns);
  if (statRows > 0) y += statRows * (STAT_HEIGHT + STAT_GAP) + 16;

  ctx.fillStyle = COLORS.rule;
  ctx.fillRect(PADDING, y, inner, 2);
  y += 2;

  if (card.empty) {
    ctx.fillStyle = COLORS.muted;
    text(card.empty, PADDING, y + 72, inner, font(500, 36));
    return;
  }

  // Exercise rows share the height left, so eight rows and the "+N more"
  // line always fit above the bottom padding.
  const rows = card.exercises.length + (card.more ? 1 : 0);
  const rowHeight = Math.min(MAX_ROW_HEIGHT, (height - PADDING - y) / Math.max(rows, 1));
  const baseline = rowHeight * 0.64;
  const gap = 32;
  for (const line of card.exercises) {
    // The best set keeps up to 55% of the row, right-aligned; the name takes
    // what is left.
    ctx.font = font(500, 34);
    const detail = fitText(line.detail, inner * 0.55, measure);
    const detailWidth = measure(detail);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.fillText(detail, width - PADDING, y + baseline);
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.text;
    text(line.name, PADDING, y + baseline, inner - detailWidth - gap, font(600, 36));
    y += rowHeight;
    ctx.fillStyle = COLORS.rule;
    ctx.fillRect(PADDING, y - 1, inner, 1);
  }
  if (card.more) {
    ctx.fillStyle = COLORS.muted;
    text(card.more, PADDING, y + baseline, inner, font(500, 32));
  }
}
