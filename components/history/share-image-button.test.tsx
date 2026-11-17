import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ELLIPSIS, type ShareCardData } from '@/lib/share-card';
import { ShareImageButton } from './share-image-button';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const card: ShareCardData = {
  appName: 'GymCoach',
  title: 'Leg day',
  date: 'November 17, 2026',
  stats: [
    { label: 'Duration', value: '62 min' },
    { label: 'Total volume', value: '5,500 kg' },
    { label: 'Avg HR', value: '128 bpm' },
    { label: 'Max HR', value: '171 bpm' },
  ],
  exercises: [
    { name: 'Back Squat', detail: '110 kg x 5' },
    { name: 'An exercise with a very long name that cannot fit on one row', detail: 'BW x 12' },
  ],
  more: '+ 3 more exercises',
  empty: null,
  fileName: 'gymcoach-2026-11-17.png',
};

// jsdom has no canvas: a recording 2D context where every character is 20px
// wide stands in for it.
function fakeContext() {
  return {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((value: string) => ({ width: Array.from(value).length * 20 })),
  };
}

const canvasProto = HTMLCanvasElement.prototype;
const originals = {
  getContext: Object.getOwnPropertyDescriptor(canvasProto, 'getContext'),
  toBlob: Object.getOwnPropertyDescriptor(canvasProto, 'toBlob'),
  share: Object.getOwnPropertyDescriptor(navigator, 'share'),
  canShare: Object.getOwnPropertyDescriptor(navigator, 'canShare'),
  createObjectURL: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
  revokeObjectURL: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
};

function define(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
}

function restore(target: object, key: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

let ctx: ReturnType<typeof fakeContext>;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
// The anchor the download path clicked, captured at click time (it is removed
// from the document right after).
let downloads: { href: string; download: string }[];

beforeEach(() => {
  ctx = fakeContext();
  define(
    canvasProto,
    'getContext',
    vi.fn(() => ctx),
  );
  define(
    canvasProto,
    'toBlob',
    vi.fn((callback: BlobCallback, type?: string) =>
      callback(new Blob(['png-bytes'], { type: type ?? 'image/png' })),
    ),
  );
  createObjectURL = vi.fn(() => 'blob:card');
  revokeObjectURL = vi.fn();
  define(URL, 'createObjectURL', createObjectURL);
  define(URL, 'revokeObjectURL', revokeObjectURL);
  downloads = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ href: this.getAttribute('href') ?? '', download: this.download });
  });
});

afterEach(() => {
  restore(canvasProto, 'getContext', originals.getContext);
  restore(canvasProto, 'toBlob', originals.toBlob);
  restore(navigator, 'share', originals.share);
  restore(navigator, 'canShare', originals.canShare);
  restore(URL, 'createObjectURL', originals.createObjectURL);
  restore(URL, 'revokeObjectURL', originals.revokeObjectURL);
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function clickShare() {
  render(<ShareImageButton card={card} />);
  const button = screen.getByRole('button', { name: 'Share as image' });
  fireEvent.click(button);
  return button;
}

describe('ShareImageButton (issue #576)', () => {
  it('shares the PNG through the system share sheet when files can be shared', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    define(navigator, 'share', share);
    define(navigator, 'canShare', canShare);

    const button = clickShare();
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));

    const data = share.mock.calls[0]![0] as { files: File[]; title: string };
    expect(data.title).toBe('Leg day');
    expect(data.files).toHaveLength(1);
    expect(data.files[0]).toBeInstanceOf(File);
    expect(data.files[0]!.name).toBe('gymcoach-2026-11-17.png');
    expect(data.files[0]!.type).toBe('image/png');
    expect(canShare).toHaveBeenCalledWith(data);
    // Shared, not downloaded, and no toast on top of the share sheet.
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('draws the card on a 1080x1350 canvas, cutting long text with an ellipsis', async () => {
    define(navigator, 'share', vi.fn().mockResolvedValue(undefined));
    define(navigator, 'canShare', vi.fn().mockReturnValue(true));
    const getContext = canvasProto.getContext as unknown as ReturnType<typeof vi.fn>;

    clickShare();
    await waitFor(() => expect(navigator.share).toHaveBeenCalled());

    const canvas = getContext.mock.instances[0] as HTMLCanvasElement;
    expect(canvas.width).toBe(1080);
    expect(canvas.height).toBe(1350);
    expect(getContext).toHaveBeenCalledWith('2d');
    // Light background over the whole card.
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1080, 1350);

    const drawn = ctx.fillText.mock.calls.map((call) => String(call[0]));
    for (const expected of [
      'GymCoach',
      'Leg day',
      'November 17, 2026',
      'Duration',
      '62 min',
      'Total volume',
      '5,500 kg',
      'Avg HR',
      '128 bpm',
      'Max HR',
      '171 bpm',
      'Back Squat',
      '110 kg x 5',
      'BW x 12',
      '+ 3 more exercises',
    ]) {
      expect(drawn).toContain(expected);
    }
    const long = drawn.find((value) => value.startsWith('An exercise with'));
    expect(long).toBeDefined();
    expect(long!.endsWith(ELLIPSIS)).toBe(true);
    // Nothing drawn is wider than the card minus its side padding.
    for (const value of drawn) {
      expect(Array.from(value).length * 20).toBeLessThanOrEqual(1080 - 2 * 72);
    }
  });

  it('downloads the PNG and revokes its URL when files cannot be shared', async () => {
    define(navigator, 'share', vi.fn());
    define(navigator, 'canShare', vi.fn().mockReturnValue(false));

    clickShare();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Image saved.'));

    expect(navigator.share).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0]![0]).toBeInstanceOf(File);
    expect(downloads).toEqual([{ href: 'blob:card', download: 'gymcoach-2026-11-17.png' }]);
    // The temporary link is gone and the object URL is released.
    expect(document.querySelector('a[download]')).toBeNull();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:card'));
  });

  it('downloads when the browser has no Web Share API at all', async () => {
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'canShare');

    clickShare();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Image saved.'));
    expect(downloads).toHaveLength(1);
  });

  it('stays quiet when the user cancels the share sheet', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Share canceled', 'AbortError'));
    define(navigator, 'share', share);
    define(navigator, 'canShare', vi.fn().mockReturnValue(true));

    const button = clickShare();
    await waitFor(() => expect(share).toHaveBeenCalled());
    await waitFor(() => expect(button).not.toBeDisabled());

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });

  it('falls back to the download when sharing fails for another reason', async () => {
    define(
      navigator,
      'share',
      vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError')),
    );
    define(navigator, 'canShare', vi.fn().mockReturnValue(true));

    clickShare();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Image saved.'));
    expect(downloads).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports an error when the canvas cannot produce an image', async () => {
    define(
      canvasProto,
      'toBlob',
      vi.fn((callback: BlobCallback) => callback(null)),
    );
    define(navigator, 'share', vi.fn());
    define(navigator, 'canShare', vi.fn().mockReturnValue(true));

    clickShare();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not create the image.'));
    expect(navigator.share).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });

  it('reports an error when there is no 2D context', async () => {
    define(
      canvasProto,
      'getContext',
      vi.fn(() => null),
    );

    clickShare();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not create the image.'));
    expect(downloads).toEqual([]);
  });
});
