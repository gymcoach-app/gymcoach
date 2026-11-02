'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Camera, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// One progress photo, as serialized at the Server Component boundary. The
// bytes are only reachable through the ownership-scoped image route.
export interface ProgressPhotoView {
  id: string;
  takenAt: string; // ISO
  note: string | null;
}

interface Props {
  // The user's photos, newest first.
  photos: ProgressPhotoView[];
}

function imageUrl(id: string) {
  return `/api/progress-photos/${id}/image`;
}

// Progress-photos card (issue #269): upload a photo (stored locally on the
// server, served only to its owner), browse the gallery, delete, and compare
// two photos side by side to see visual progress.
export function PhotosCard({ photos }: Props) {
  const router = useRouter();
  const t = useTranslations('progress.photos');
  const common = useTranslations('common');
  const format = useFormatter();
  const shortDate = (iso: string) =>
    format.dateTime(new Date(iso), { year: 'numeric', month: 'short', day: '2-digit' });
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [takenAt, setTakenAt] = useState('');
  const [busy, setBusy] = useState(false);
  // Before/after compare: ids of the two selected photos. Defaults pick the
  // oldest and newest so one click shows the widest span.
  const [beforeId, setBeforeId] = useState('');
  const [afterId, setAfterId] = useState('');

  const oldest = photos[photos.length - 1];
  const newest = photos[0];
  const before = photos.find((p) => p.id === (beforeId || oldest?.id));
  const after = photos.find((p) => p.id === (afterId || newest?.id));

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error(t('chooseFirst'));
      return;
    }
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (takenAt) {
        params.set('takenAt', new Date(`${takenAt}T12:00:00`).toISOString());
      }
      if (note.trim()) params.set('note', note.trim());
      const queryString = params.toString();
      const query = queryString ? `?${queryString}` : '';
      // Raw bytes as the body (not multipart): the server caps the size while
      // reading and decides the real type from the magic bytes.
      const res = await fetch(`/api/progress-photos${query}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? t('uploadError'));
        return;
      }
      toast.success(t('added'));
      setNote('');
      setTakenAt('');
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deletePhoto(photo: ProgressPhotoView) {
    if (!confirm(t('deleteConfirm', { date: shortDate(photo.takenAt) }))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/progress-photos/${photo.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? t('deleteError'));
        return;
      }
      toast.success(t('deleted'));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Camera className="size-4" />
          {t('title')}
        </h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Upload: photo file + optional date and note */}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void upload();
          }}
        >
          <div className="min-w-40 flex-1 space-y-1">
            <Label htmlFor="progress-photo-file">{t('photo')}</Label>
            <Input
              id="progress-photo-file"
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="progress-photo-date">{t('date')}</Label>
            <Input
              id="progress-photo-date"
              type="date"
              value={takenAt}
              onChange={(e) => setTakenAt(e.target.value)}
            />
          </div>
          <div className="min-w-32 flex-1 space-y-1">
            <Label htmlFor="progress-photo-note">{t('note')}</Label>
            <Input
              id="progress-photo-note"
              value={note}
              maxLength={500}
              placeholder={t('notePlaceholder')}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? t('uploading') : common('actions.upload')}
          </Button>
        </form>

        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <>
            {/* Gallery: newest first, deletable */}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {photos.map((p) => (
                <figure key={p.id} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(p.id)}
                    alt={`${t('imageAlt', { date: shortDate(p.takenAt) })}${p.note ? ` - ${p.note}` : ''}`}
                    className="aspect-square w-full rounded-md border object-cover"
                    loading="lazy"
                  />
                  <figcaption className="mt-1 truncate text-xs text-muted-foreground">
                    {shortDate(p.takenAt)}
                  </figcaption>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute right-1 top-1 size-7 opacity-80"
                    aria-label={t('deleteAria', { date: shortDate(p.takenAt) })}
                    onClick={() => void deletePhoto(p)}
                    disabled={busy}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </figure>
              ))}
            </div>

            {/* Before/after side-by-side compare */}
            {photos.length >= 2 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{t('compare')}</h3>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      {
                        key: 'before',
                        label: t('before'),
                        photo: before,
                        value: beforeId || oldest?.id || '',
                        set: setBeforeId,
                      },
                      {
                        key: 'after',
                        label: t('after'),
                        photo: after,
                        value: afterId || newest?.id || '',
                        set: setAfterId,
                      },
                    ] as const
                  ).map(({ key, label, photo, value, set }) => (
                    <div key={key} className="flex flex-col gap-1">
                      <Label htmlFor={`progress-photo-${key}`}>{label}</Label>
                      <select
                        id={`progress-photo-${key}`}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={value}
                        onChange={(e) => set(e.target.value)}
                      >
                        {photos.map((p) => (
                          <option key={p.id} value={p.id}>
                            {shortDate(p.takenAt)}
                            {p.note ? ` - ${p.note}` : ''}
                          </option>
                        ))}
                      </select>
                      {photo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageUrl(photo.id)}
                          alt={t('compareAlt', { label, date: shortDate(photo.takenAt) })}
                          className="w-full rounded-md border object-contain"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
